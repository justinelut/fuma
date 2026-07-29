import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { HostedResolvedSession } from '../../auth/hosted/auth'
import { FUMA_STAFF_FRESH_SESSION_SECONDS } from '../../auth/hosted/auth'
import type { DbClient } from '../../db/client'
import { EditorSiteDocumentSchema } from '../editor/contracts'
import { AiCatalogService, PostgresAiCatalogRepository } from '../aiCatalog'
import { createHostedAiCreditRuntime, importAiByokMetadataKey } from '../aiCredits'
import type { FumaJobService } from '../jobs'
import { PLATFORM_ORGANIZATION_ID } from '../organizations/contracts'
import { publishSnapshotHash } from '../publishing/postgresAdapters'
import type { McpConnector, McpPublishConfirmation, McpScope, McpSession } from './contracts'
import { sameMcpScope } from './contracts'
import type { McpHostedPublishPort } from './nativeAdapter'
import { createHostedMcpRuntime } from './runtime'
import {
  McpAuthorityError,
  type McpPublishConfirmationIssuerPort,
  type McpPublishConfirmationPort,
} from './service'

export const FUMA_PLATFORM_ID = 'fuma'
const CONFIRMATION_DOMAIN = 'fuma:mcp-publish-confirmation:v1'
const CONFIRMATION_MAX_AGE_MS = FUMA_STAFF_FRESH_SESSION_SECONDS * 1_000
const KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/

type ResolveHostedSession = (headers: Headers) => Promise<HostedResolvedSession | null>

function confirmationBinding(input: Readonly<{
  connector: McpConnector
  operationId: string
  confirmationId: string
  confirmedAt: string
}>): string {
  const scope = input.connector.scope
  return JSON.stringify([
    CONFIRMATION_DOMAIN,
    input.connector.connectorId,
    input.connector.version,
    input.connector.actorId,
    scope.platformId,
    scope.organizationId,
    scope.workspaceId,
    scope.siteId,
    scope.ownerKey,
    scope.ownerGeneration,
    scope.profileId,
    input.operationId,
    input.confirmationId,
    input.confirmedAt,
  ])
}

/** Same-origin fresh staff issuance plus exact operation-bound HMAC verification. */
export class HostedMcpPublishConfirmationAuthority implements McpPublishConfirmationPort, McpPublishConfirmationIssuerPort {
  readonly #key: Buffer
  readonly #resolveSession: ResolveHostedSession
  readonly #now: () => Date

  constructor(input: Readonly<{ secret: string; resolveSession: ResolveHostedSession; now?: () => Date }>) {
    if (Buffer.byteLength(input.secret, 'utf8') < 32) throw new TypeError('Hosted MCP confirmation secret must contain at least 32 bytes.')
    this.#key = createHash('sha256').update(CONFIRMATION_DOMAIN).update('\0').update(input.secret).digest()
    this.#resolveSession = input.resolveSession
    this.#now = input.now ?? (() => new Date())
  }

  async issue(input: Readonly<{ connector: McpConnector; operationId: string; request: Request }>): Promise<McpPublishConfirmation> {
    const session = await this.#resolveSession(input.request.headers)
    const ageMs = session ? this.#now().getTime() - session.createdAt.getTime() : Number.NaN
    if (!session || session.impersonatedBy !== null || session.userId !== input.connector.actorId || !Number.isFinite(ageMs) || ageMs < 0 || ageMs >= CONFIRMATION_MAX_AGE_MS) {
      throw new McpAuthorityError('confirmation', 'A fresh direct hosted staff session is required.')
    }
    if (input.connector.state !== 'active' || (!input.connector.capabilities.includes('site.publish') && !input.connector.capabilities.includes('component.publish')) || Date.parse(input.connector.expiresAt) <= this.#now().getTime()) {
      throw new McpAuthorityError('confirmation', 'An active publish connector is required.')
    }
    const confirmationId = crypto.randomUUID()
    const confirmedAt = this.#now().toISOString()
    const stepUpReceiptId = this.#sign({ connector: input.connector, operationId: input.operationId, confirmationId, confirmedAt })
    return Object.freeze({ confirmationId, stepUpReceiptId, confirmedAt })
  }

  async verify(input: Readonly<{ connector: McpConnector; session: McpSession; operationId: string; confirmation: McpPublishConfirmation }>): Promise<void> {
    const confirmedAt = Date.parse(input.confirmation.confirmedAt)
    const ageMs = this.#now().getTime() - confirmedAt
    const exactSession = input.session.connectorId === input.connector.connectorId
      && input.session.actorId === input.connector.actorId
      && sameMcpScope(input.session.scope, input.connector.scope)
    const expected = this.#sign({ connector: input.connector, operationId: input.operationId, confirmationId: input.confirmation.confirmationId, confirmedAt: input.confirmation.confirmedAt })
    const actual = input.confirmation.stepUpReceiptId
    const validSignature = /^[a-f0-9]{64}$/.test(actual)
      && timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))
    if (!exactSession || !Number.isFinite(ageMs) || ageMs < 0 || ageMs >= CONFIRMATION_MAX_AGE_MS || !validSignature) {
      throw new McpAuthorityError('confirmation', 'MCP publish confirmation is invalid or expired.')
    }
  }

  #sign(input: Readonly<{ connector: McpConnector; operationId: string; confirmationId: string; confirmedAt: string }>): string {
    return createHmac('sha256', this.#key).update(confirmationBinding(input)).digest('hex')
  }
}

type PublishSourceRow = Readonly<{
  mutation_id: string
  accepted_sequence: string | number | bigint
  document_json: unknown
}>

function publishDigest(input: Readonly<{ scope: McpScope; connectorId: string; operationId: string; snapshotId: string; snapshotHash: string }>): string {
  return createHash('sha256').update(JSON.stringify([
    input.scope.platformId,
    input.scope.organizationId,
    input.scope.workspaceId,
    input.scope.siteId,
    input.scope.ownerKey,
    input.scope.ownerGeneration,
    input.scope.profileId,
    input.connectorId,
    input.operationId,
    input.snapshotId,
    input.snapshotHash,
  ])).digest('hex')
}

/** Enqueues the existing exact-snapshot `fuma.publish-release` worker; it never publishes in the web process. */
export class PostgresMcpHostedPublishPort implements McpHostedPublishPort {
  readonly #db: DbClient
  readonly #jobs: Pick<FumaJobService, 'enqueue'>

  constructor(input: Readonly<{ db: DbClient; jobs: Pick<FumaJobService, 'enqueue'> }>) {
    if (input.db.dialect !== 'postgres') throw new TypeError('Hosted MCP publishing requires PostgreSQL.')
    this.#db = input.db
    this.#jobs = input.jobs
  }

  async publish(input: Readonly<{ scope: McpScope; actorId: string; connectorId: string; operationId: string }>): Promise<unknown> {
    const result = await this.#db.unsafe<PublishSourceRow>(`
      select mutation.mutation_id, mutation.accepted_sequence, mutation.document_json
      from fuma_editor_draft_mutations mutation
      join fuma_tenant_owner_keys owner
        on owner.platform_id=mutation.platform_id and owner.owner_key=mutation.owner_key
        and owner.organization_id=$2 and owner.workspace_id=$3 and owner.site_id=$4
        and owner.generation=mutation.owner_generation
      where mutation.platform_id=$1 and mutation.owner_key=$5
        and mutation.owner_generation=$6 and mutation.profile_id=$7
        and mutation.resource_kind='site-document' and mutation.logical_id=$4
        and owner.state='active' and owner.transfer_id is null
        and owner.transfer_lock_id is null and owner.transfer_fence is null
      order by mutation.accepted_sequence desc, mutation.mutation_id desc
      limit 1
    `, [input.scope.platformId, input.scope.organizationId, input.scope.workspaceId, input.scope.siteId, input.scope.ownerKey, input.scope.ownerGeneration, input.scope.profileId])
    const source = result.rows[0]
    const parsed = source ? safeParseValue(EditorSiteDocumentSchema, source.document_json) : null
    const sequence = source ? Number(source.accepted_sequence) : Number.NaN
    if (!source || !parsed?.ok || parsed.value.site.id !== input.scope.siteId || !Number.isSafeInteger(sequence) || sequence < 1) {
      throw new McpAuthorityError('denied', 'An exact immutable site draft is required for publishing.')
    }
    const snapshotHash = publishSnapshotHash(parsed.value)
    const digest = publishDigest({ scope: input.scope, connectorId: input.connectorId, operationId: input.operationId, snapshotId: source.mutation_id, snapshotHash })
    const releaseId = `mcp-release-${digest}`
    const jobId = `mcp-publish-${digest}`
    const queued = await this.#jobs.enqueue({
      id: jobId,
      organizationId: input.scope.organizationId,
      siteId: input.scope.siteId,
      kind: 'fuma.publish-release',
      payload: {
        releaseId,
        sourceSnapshotId: source.mutation_id,
        sourceSnapshotHashSha256: snapshotHash,
        auditCorrelationId: `mcp-${digest}`,
      },
      priority: 10,
      maxAttempts: 5,
      idempotencyKey: `mcp-publish:${digest}`,
    })
    return Object.freeze({
      jobId: queued.job.id,
      releaseId,
      sourceSnapshotId: source.mutation_id,
      state: queued.job.status,
      replay: !queued.created,
    })
  }
}

export function readHostedAiByokMetadataKey(env: Readonly<Record<string, string | undefined>> = process.env): Readonly<{ bytes: Uint8Array; keyId: string }> {
  const encoded = env.FUMA_AI_BYOK_METADATA_KEY?.trim() ?? ''
  if (!KEY_PATTERN.test(encoded)) throw new TypeError('FUMA_AI_BYOK_METADATA_KEY must be one base64url-encoded 256-bit key.')
  const bytes = new Uint8Array(Buffer.from(encoded, 'base64url'))
  if (bytes.byteLength !== 32 || Buffer.from(bytes).toString('base64url') !== encoded) throw new TypeError('FUMA_AI_BYOK_METADATA_KEY must be one canonical base64url-encoded 256-bit key.')
  const keyId = `fuma-ai-byok-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}`
  return Object.freeze({ bytes, keyId })
}

/** Central hosted composition over the existing native AI/MCP and durable publish runtimes. */
export async function createHostedMcpProductionRuntime(input: Readonly<{
  db: DbClient
  productHost: string
  staffSecret: string
  resolveStaffSession: ResolveHostedSession
  publishJobs: Pick<FumaJobService, 'enqueue'>
  byokMetadataKey: Uint8Array
  byokMetadataKeyId: string
  now?: () => Date
}>) {
  const catalog = new AiCatalogService({
    repository: new PostgresAiCatalogRepository(input.db),
    sources: Object.freeze({ exact: () => null }),
    platformId: FUMA_PLATFORM_ID,
    ...(input.now ? { now: input.now } : {}),
  })
  const cipher = await importAiByokMetadataKey(input.byokMetadataKey, input.byokMetadataKeyId)
  const aiCredits = createHostedAiCreditRuntime({
    db: input.db,
    catalog,
    cipher,
    protectedOrganizationId: PLATFORM_ORGANIZATION_ID,
    ...(input.now ? { now: input.now } : {}),
  })
  const confirmations = new HostedMcpPublishConfirmationAuthority({
    secret: input.staffSecret,
    resolveSession: input.resolveStaffSession,
    ...(input.now ? { now: input.now } : {}),
  })
  const mcp = createHostedMcpRuntime({
    db: input.db,
    productHost: input.productHost,
    credits: aiCredits.service,
    confirmations,
    publisher: new PostgresMcpHostedPublishPort({ db: input.db, jobs: input.publishJobs }),
    ...(input.now ? { now: input.now } : {}),
  })
  return Object.freeze({ catalog, aiCredits, confirmations, ...mcp })
}

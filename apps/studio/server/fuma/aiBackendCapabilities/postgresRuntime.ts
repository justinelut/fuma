import type { CoreCapability } from '@core/capabilities'
import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import { InsertDataBackedSectionInputSchema } from './componentInsertion'
import type { ComponentCatalogService } from '../componentCatalog/service'
import {
  MeteringCollector,
  MeteringService,
  PostgresProviderCostCatalog,
  PostgresUsageLedger,
} from '../metering'
import {
  INSERT_DATA_BACKED_SECTION_CAPABILITY,
  createInsertDataBackedSectionCapability,
} from './componentInsertion'
import {
  ReviewedBackendCapabilityRegistry,
  type BackendCapabilityEvidencePort,
} from './registry'
import type {
  BackendCapabilityMetadata,
  BackendCapabilityReceipt,
  TrustedBackendCapabilityAuthority,
} from './contracts'

const Strict = { additionalProperties: false } as const
const AuthorityRowSchema = Type.Object({
  platform_id: Type.String({ minLength: 1 }),
  organization_id: Type.String({ minLength: 1 }),
  workspace_id: Type.String({ minLength: 1 }),
  site_id: Type.String({ minLength: 1 }),
  owner_key: Type.String({ minLength: 1 }),
  owner_generation: Type.Union([Type.String(), Type.Number(), Type.BigInt()]),
  profile_id: Type.Union([Type.Literal('website'), Type.Literal('publication')]),
  actor_id: Type.String({ minLength: 1 }),
  session_id: Type.String({ minLength: 1 }),
  outer_receipt_id: Type.String({ minLength: 1 }),
  reservation_id: Type.String({ minLength: 1 }),
  input_hash_sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
}, Strict)
type AuthorityRow = typeof AuthorityRowSchema.static

export type BackendCapabilityToolBinding = Readonly<{
  conversationId: string
  actorId: string
  operationId: string
  permissions: readonly CoreCapability[]
  signal?: AbortSignal
}>

export interface BackendCapabilityMeteringPort {
  record(raw: unknown): Promise<unknown>
}

function integer(value: string | number | bigint): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('Capability owner generation is invalid.')
  }
  return parsed
}

function lockIdentity(authority: TrustedBackendCapabilityAuthority, metadata: BackendCapabilityMetadata): string {
  return [
    'fuma-086',
    metadata.id,
    authority.scope.platformId,
    authority.scope.organizationId,
    authority.scope.workspaceId,
    authority.scope.siteId,
    authority.scope.ownerKey,
    authority.scope.ownerGeneration,
    authority.actor.actorId,
  ].join(':')
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

async function inputHash(value: unknown): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical(value)),
  ))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Production bridge for the existing `site_insert_component` tool. The caller
 * contributes no tenant coordinates; they come only from the already-claimed
 * native Site AI or MCP operation and current owner-key authority.
 */
export class PostgresAiBackendCapabilityRuntime {
  readonly #db: DbClient
  readonly #registry: ReviewedBackendCapabilityRegistry
  readonly #metering: BackendCapabilityMeteringPort
  readonly #now: () => Date

  constructor(input: Readonly<{
    db: DbClient
    components: Pick<ComponentCatalogService, 'execute'>
    metering?: BackendCapabilityMeteringPort
    now?: () => Date
  }>) {
    if (input.db.dialect !== 'postgres') {
      throw new TypeError('AI backend capabilities require PostgreSQL authority.')
    }
    this.#db = input.db
    this.#now = input.now ?? (() => new Date())
    this.#registry = new ReviewedBackendCapabilityRegistry(this.#now)
      .register(createInsertDataBackedSectionCapability(input.components))
    this.#metering = input.metering ?? new MeteringCollector(new MeteringService(
      new PostgresUsageLedger(input.db),
      new PostgresProviderCostCatalog(input.db, this.#now),
    ))
  }

  async insertDataBackedSection(binding: BackendCapabilityToolBinding, raw: unknown) {
    // Duplicate the capability-specific preflight outside the transaction so
    // SQL/scope/credential fields and oversized input cause zero DB contact.
    const parsed = safeParseValue(InsertDataBackedSectionInputSchema, raw)
    if (!parsed.ok) throw new TypeError('Reviewed capability input is invalid.')
    let inputBytes: number
    try {
      inputBytes = new TextEncoder().encode(JSON.stringify(parsed.value)).byteLength
    } catch {
      throw new TypeError('Reviewed capability input is invalid.')
    }
    if (inputBytes > 65_536) throw new TypeError('Reviewed capability input exceeds its bounded size.')
    const expectedInputHash = await inputHash(parsed.value)
    return this.#db.transaction(async (tx) => {
      const authority = await this.#resolve(tx, binding, expectedInputHash)
      await tx.unsafe('select pg_advisory_xact_lock(hashtextextended($1,0))', [
        lockIdentity(authority, this.#definition()),
      ])
      const evidence = this.#evidence(tx)
      return this.#registry.invoke({
        ...INSERT_DATA_BACKED_SECTION_CAPABILITY,
        rawInput: parsed.value,
        resolveAuthority: async () => authority,
        evidence,
        ...(binding.signal ? { signal: binding.signal } : {}),
      })
    })
  }

  #definition(): BackendCapabilityMetadata {
    const definition = this.#registry.definition(
      INSERT_DATA_BACKED_SECTION_CAPABILITY.id,
      INSERT_DATA_BACKED_SECTION_CAPABILITY.version,
    )
    if (!definition) throw new Error('Reviewed component capability is unavailable.')
    return definition.metadata
  }

  async #resolve(
    db: DbClient,
    binding: BackendCapabilityToolBinding,
    expectedInputHash: string,
  ): Promise<TrustedBackendCapabilityAuthority> {
    const mcp = binding.conversationId.startsWith('mcp:')
    const rows = mcp
      ? await db.unsafe<AuthorityRow>(`
        select binding.platform_id,binding.organization_id,binding.workspace_id,
          binding.site_id,binding.owner_key,binding.owner_generation,binding.profile_id,
          binding.actor_id,receipt.session_id,receipt.operation_id outer_receipt_id,
          receipt.reservation_id,receipt.input_hash_sha256
        from fuma_mcp_connector_bindings_v2 binding
        join fuma_mcp_tool_receipts_v2 receipt
          on receipt.connector_id=binding.connector_id
        join fuma_mcp_sessions_v2 session
          on session.session_id=receipt.session_id and session.connector_id=binding.connector_id
        join fuma_tenant_owner_keys owner
          on owner.platform_id=binding.platform_id and owner.organization_id=binding.organization_id
          and owner.workspace_id=binding.workspace_id and owner.site_id=binding.site_id
          and owner.owner_key=binding.owner_key and owner.generation=binding.owner_generation
        where binding.connector_id=$1 and binding.actor_id=$2 and receipt.operation_id=$3
          and receipt.tool_name='site_insert_component' and receipt.capability='mutate'
          and receipt.state='started' and session.state='active' and binding.state='active'
          and binding.connector_capabilities_json ? 'component.mutate'
          and owner.state='active' and owner.transfer_id is null
      `, [binding.conversationId.slice(4), binding.actorId, binding.operationId])
      : await db.unsafe<AuthorityRow>(`
        select conversation.platform_id,conversation.organization_id,conversation.workspace_id,
          conversation.site_id,conversation.owner_key,conversation.owner_generation,
          conversation.profile_id,conversation.actor_id,conversation.session_id,
          (job.job_id || ':' || receipt.tool_call_id) outer_receipt_id,
          job.reservation_id,receipt.input_hash_sha256
        from fuma_site_ai_conversation_bindings conversation
        join fuma_site_ai_turn_jobs job
          on job.conversation_id=conversation.conversation_id
          and job.actor_id=conversation.actor_id and job.state='running'
        join fuma_site_ai_tool_receipts receipt
          on receipt.job_id=job.job_id
        join fuma_tenant_owner_keys owner
          on owner.platform_id=conversation.platform_id
          and owner.organization_id=conversation.organization_id
          and owner.workspace_id=conversation.workspace_id and owner.site_id=conversation.site_id
          and owner.owner_key=conversation.owner_key and owner.generation=conversation.owner_generation
        where conversation.conversation_id=$1 and conversation.actor_id=$2
          and receipt.tool_call_id=$3 and receipt.tool_name='site_insert_component'
          and receipt.mutates=true and receipt.state='started'
          and owner.state='active' and owner.transfer_id is null
      `, [binding.conversationId, binding.actorId, binding.operationId])
    if (rows.rows.length !== 1) throw new Error('Exact live reviewed capability authority is unavailable.')
    const parsed = safeParseValue(AuthorityRowSchema, rows.rows[0])
    if (!parsed.ok) throw new Error('Stored reviewed capability authority is invalid.')
    const row = parsed.value
    if (row.input_hash_sha256 !== expectedInputHash) {
      throw new Error('Reviewed capability input does not match its outer receipt.')
    }
    const ownerGeneration = integer(row.owner_generation)
    return Object.freeze({
      channel: mcp ? 'mcp' as const : 'site-ai' as const,
      operationId: binding.operationId,
      outerReceiptId: row.outer_receipt_id,
      reservationId: row.reservation_id,
      scope: Object.freeze({
        platformId: row.platform_id,
        organizationId: row.organization_id,
        workspaceId: row.workspace_id,
        siteId: row.site_id,
        ownerKey: row.owner_key,
        ownerGeneration,
        profileId: row.profile_id,
      }),
      actor: Object.freeze({
        kind: 'staff' as const,
        actorId: row.actor_id,
        sessionId: row.session_id,
        impersonatorId: null,
      }),
      permissions: [...binding.permissions],
      grants: [mcp ? 'component.mutate' : 'ai.tools.write'],
      authorityRevision: ownerGeneration,
      state: 'active' as const,
      resolvedAt: this.#now().toISOString(),
      confirmation: null,
    })
  }

  #evidence(db: DbClient): BackendCapabilityEvidencePort {
    return Object.freeze({
      admit: async ({ metadata, authority }: Readonly<{
        metadata: BackendCapabilityMetadata
        authority: TrustedBackendCapabilityAuthority
      }>) => {
        const prior = await db.unsafe<{ count: string }>(`
          select count(*)::text count
          from fuma_component_catalog_audit_v1
          where platform_id=$1 and organization_id=$2 and workspace_id=$3 and site_id=$4
            and owner_key=$5 and owner_generation=$6 and actor_id=$7
            and operation_id=$8 and action='component.inserted'
        `, [
          authority.scope.platformId,
          authority.scope.organizationId,
          authority.scope.workspaceId,
          authority.scope.siteId,
          authority.scope.ownerKey,
          authority.scope.ownerGeneration,
          authority.actor.actorId,
          authority.operationId,
        ])
        if (Number(prior.rows[0]?.count ?? 0) > 0) {
          throw new Error('Reviewed capability operation already executed.')
        }
        const result = await db.unsafe<{ count: string }>(`
          select count(*)::text count
          from fuma_component_catalog_audit_v1
          where platform_id=$1 and organization_id=$2 and workspace_id=$3 and site_id=$4
            and owner_key=$5 and owner_generation=$6 and actor_id=$7
            and action='component.inserted'
            and occurred_at >= $8::timestamptz - interval '1 minute'
        `, [
          authority.scope.platformId,
          authority.scope.organizationId,
          authority.scope.workspaceId,
          authority.scope.siteId,
          authority.scope.ownerKey,
          authority.scope.ownerGeneration,
          authority.actor.actorId,
          authority.resolvedAt,
        ])
        if (Number(result.rows[0]?.count ?? 0) >= metadata.limits.requestsPerMinute) {
          throw new Error('Reviewed capability rate limit exceeded.')
        }
      },
      record: async ({ metadata, authority, receipt }: Readonly<{
        metadata: BackendCapabilityMetadata
        authority: TrustedBackendCapabilityAuthority
        receipt: BackendCapabilityReceipt
      }>) => {
        const audit = await db.unsafe<{ count: string }>(`
          select count(*)::text count
          from fuma_component_catalog_audit_v1
          where platform_id=$1 and organization_id=$2 and workspace_id=$3 and site_id=$4
            and owner_key=$5 and owner_generation=$6 and profile_id=$7
            and actor_id=$8 and operation_id=$9 and action='component.inserted'
            and outcome='success'
        `, [
          authority.scope.platformId,
          authority.scope.organizationId,
          authority.scope.workspaceId,
          authority.scope.siteId,
          authority.scope.ownerKey,
          authority.scope.ownerGeneration,
          authority.scope.profileId,
          authority.actor.actorId,
          authority.operationId,
        ])
        if (audit.rows[0]?.count !== '1') {
          throw new Error('Immutable reviewed capability audit evidence is unavailable.')
        }
        await this.#metering.record({
          kind: metadata.metering.kind,
          idempotencyKey: `backend-capability:${receipt.receiptId}`,
          organizationId: authority.scope.organizationId,
          workspaceId: authority.scope.workspaceId,
          siteId: authority.scope.siteId,
          occurredAt: receipt.occurredAt,
          internalWorkload: false,
          logicalCredits: metadata.metering.logicalCredits,
          providerCredits: metadata.metering.providerCredits,
        })
        return Object.freeze({ metered: true as const, audited: true as const })
      },
    })
  }
}

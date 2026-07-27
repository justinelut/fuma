import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import type { EdgeHostAuthority } from './jobHandlers'
import type { TenantObjectStorage } from '../objectStorage'
import { sha256Hex } from '../objectStorage'
import {
  validateActiveReleasePointer,
  validateReleaseRecord,
  validateReleaseRetentionRoot,
  type ReleaseArtifact,
  type ReleaseManifest,
  type ReleaseRepository,
  type ReleaseService,
} from '../releases'
import type { FumaRepositoryScope } from '../tenancy'
import type { EdgeHoleDeclaration, EdgePointerAuthority, EdgeReleaseReader, EdgeRequestContext } from './service'
import { EdgeDeliveryError } from './service'

const HoleInputSchema = Type.Record(
  Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9._-]+$' }),
  Type.Union([Type.String({ maxLength: 2_048 }), Type.Number(), Type.Boolean(), Type.Null()]),
  { maxProperties: 16 },
)
const HoleSchema = Type.Object({
  resolverId: Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-z0-9]+(?:[.-][a-z0-9]+)*$' }),
  input: HoleInputSchema,
}, { additionalProperties: false })
const HOLE_PATTERN = /<!--fuma-hole:v1:([A-Za-z0-9_-]{1,4096})-->/g
const MAX_HOLES = 100

function repositoryScope(context: EdgeRequestContext): FumaRepositoryScope {
  return Object.freeze({
    platformId: context.platformId,
    organizationId: context.organizationId,
    workspaceId: context.workspaceId,
    siteId: context.siteId,
    ownerKey: context.ownerKey,
    generation: context.ownerGeneration,
    state: 'active' as const,
    transferFence: null
  })
}
function objectScope(context: EdgeRequestContext) {
  return { organizationId: context.organizationId, workspaceId: context.workspaceId, siteId: context.siteId }
}
function candidates(path: string): readonly string[] {
  if (path === '/') return ['/index.html']
  if (path.endsWith('/')) return [`${path}index.html`]
  return path.includes('.') ? [path] : [path, `${path}.html`]
}
function artifactFor(manifest: ReleaseManifest, path: string): ReleaseArtifact | null {
  const expected = candidates(path)
  return manifest.artifacts.find((artifact) => expected.includes(artifact.logicalPath)) ?? null
}
function parseHoles(bytes: Uint8Array, mimeType: string): readonly EdgeHoleDeclaration[] {
  if (!mimeType.toLowerCase().startsWith('text/html')) return Object.freeze([])
  let html: string
  try { html = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch {
    throw new EdgeDeliveryError('oversized-html', 'HTML release artifact must be valid UTF-8.')
  }
  const holes: EdgeHoleDeclaration[] = []
  for (const match of html.matchAll(HOLE_PATTERN)) {
    if (holes.length >= MAX_HOLES) throw new EdgeDeliveryError('oversized-html', 'HTML release artifact exceeds the dynamic-hole count limit.')
    let decoded: unknown
    try { decoded = JSON.parse(Buffer.from(match[1]!, 'base64url').toString('utf8')) } catch {
      throw new EdgeDeliveryError('unknown-hole', 'Dynamic hole declaration is malformed.')
    }
    const parsed = safeParseValue(HoleSchema, decoded)
    if (!parsed.ok) throw new EdgeDeliveryError('unknown-hole', 'Dynamic hole declaration is invalid.')
    holes.push(Object.freeze({ marker: match[0], resolverId: parsed.value.resolverId, input: Object.freeze(parsed.value.input) }))
  }
  return Object.freeze(holes)
}

/** Reads only the exact active immutable release under current owner authority. */
export class PostgresEdgeReleaseReader implements EdgeReleaseReader {
  readonly #releases: ReleaseRepository
  readonly #storage: TenantObjectStorage

  constructor(releases: ReleaseRepository, storage: TenantObjectStorage) {
    this.#releases = releases
    this.#storage = storage
  }

  async read(context: EdgeRequestContext) {
    const bound = this.#releases.forScope(repositoryScope(context))
    const resolved = await bound.transaction(async (transaction) => {
      const pointer = await transaction.getActivePointer()
      if (!pointer || pointer.releaseId !== context.releaseId) throw new EdgeDeliveryError('stale-pointer', 'Requested release is no longer active.')
      const release = await transaction.get(context.releaseId)
      if (!release || release.status !== 'active' || !release.manifest) throw new EdgeDeliveryError('stale-pointer', 'Active release manifest is unavailable.')
      const artifact = artifactFor(release.manifest, context.path)
      if (!artifact) throw new EdgeDeliveryError('invalid-context', 'Release artifact was not found.')
      return structuredClone(artifact)
    })
    const bytes = await this.#storage.get(objectScope(context), resolved.objectKey)
    if (bytes.byteLength !== resolved.sizeBytes || sha256Hex(bytes) !== resolved.contentHashSha256) {
      throw new EdgeDeliveryError('invalid-context', 'Immutable release artifact failed integrity verification.')
    }
    return Object.freeze({
      bytes: bytes.slice(),
      hashSha256: resolved.contentHashSha256,
      mimeType: resolved.mimeType,
      holes: parseHoles(bytes, resolved.mimeType),
    })
  }
}

/** Exact-current compare-and-set rollback; retry after process death is idempotent. */
export class PostgresEdgePointerAuthority implements EdgePointerAuthority {
  readonly #releases: ReleaseRepository
  readonly #service: Pick<ReleaseService, 'verify'>
  readonly #now: () => Date

  constructor(releases: ReleaseRepository, service: Pick<ReleaseService, 'verify'>, now: () => Date = () => new Date()) {
    this.#releases = releases
    this.#service = service
    this.#now = now
  }

  async rollback(context: EdgeRequestContext, targetReleaseId: string, expectedCurrentReleaseId: string): Promise<void> {
    const scope = repositoryScope(context)
    const verified = await this.#service.verify(scope, { releaseId: targetReleaseId })
    const now = this.#now().toISOString()
    await this.#releases.forScope(scope).transaction(async (transaction) => {
      const pointer = await transaction.getActivePointer()
      if (pointer?.releaseId === targetReleaseId) {
        const replay = await transaction.get(targetReleaseId)
        if (replay?.status === 'active') return
      }
      if (!pointer || pointer.releaseId !== expectedCurrentReleaseId) throw new EdgeDeliveryError('stale-pointer', 'Active release changed before rollback.')
      const current = await transaction.get(expectedCurrentReleaseId)
      const target = await transaction.get(targetReleaseId)
      if (!current || current.status !== 'active' || !target || target.status !== 'ready' || target.version !== verified.version) {
        throw new EdgeDeliveryError('stale-pointer', 'Rollback releases are not in the required states.')
      }
      const demoted = validateReleaseRecord({ ...current, status: 'ready', version: current.version + 1, updatedAt: now })
      if (!await transaction.update(demoted, current.version)) throw new EdgeDeliveryError('stale-pointer', 'Current release changed during rollback.')
      if (!await transaction.deleteRetentionRoot('active', 'active')) throw new EdgeDeliveryError('stale-pointer', 'Active retention root changed during rollback.')
      const promoted = validateReleaseRecord({ ...target, status: 'active', activatedAt: now, version: target.version + 1, updatedAt: now })
      if (!await transaction.update(promoted, target.version)) throw new EdgeDeliveryError('stale-pointer', 'Rollback target changed during rollback.')
      const nextPointer = validateActiveReleasePointer({
        platformId: scope.platformId,
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        siteId: scope.siteId,
        ownerKey: scope.ownerKey,
        releaseId: targetReleaseId,
        version: pointer.version + 1,
        activatedAt: now,
      })
      if (!await transaction.putActivePointer(nextPointer, pointer.version)) throw new EdgeDeliveryError('stale-pointer', 'Active pointer changed during rollback.')
      const root = validateReleaseRetentionRoot({
        platformId: scope.platformId,
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        siteId: scope.siteId,
        ownerKey: scope.ownerKey,
        rootId: 'active',
        releaseId: targetReleaseId,
        kind: 'active',
        createdAt: now,
      })
      if (!await transaction.insertRetentionRoot(root)) throw new EdgeDeliveryError('stale-pointer', 'Rollback retention root conflicts.')
    })
  }
}

export class PostgresEdgeHostAuthority implements EdgeHostAuthority {
  readonly #db: DbClient
  constructor(db: DbClient) { this.#db = db }

  async exact(scope: FumaRepositoryScope): Promise<string> {
    const result = await this.#db<{ host: string }>`
      select free_host.host
      from fuma_free_hosts free_host
      join fuma_tenant_owner_keys owner
        on owner.platform_id = free_host.platform_id
       and owner.owner_key = free_host.owner_key
       and owner.organization_id = free_host.organization_id
       and owner.workspace_id = free_host.workspace_id
       and owner.site_id = free_host.site_id
      where free_host.platform_id = ${scope.platformId}
        and free_host.organization_id = ${scope.organizationId}
        and free_host.workspace_id = ${scope.workspaceId}
        and free_host.site_id = ${scope.siteId}
        and free_host.owner_key = ${scope.ownerKey}
        and free_host.owner_generation = ${scope.generation}
        and free_host.state = 'active'
        and free_host.canonical_host is null
        and owner.generation = ${scope.generation}
        and owner.state = 'active'
        and owner.transfer_id is null
        and owner.transfer_lock_id is null
        and owner.transfer_fence is null
      limit 2
    `
    if (result.rows.length !== 1) throw new EdgeDeliveryError('invalid-context', 'Exact active free-host authority is unavailable.')
    return result.rows[0]!.host
  }
}

export function encodeEdgeHole(resolverId: string, input: Readonly<Record<string, string | number | boolean | null>>): string {
  const parsed = safeParseValue(HoleSchema, { resolverId, input })
  if (!parsed.ok) throw new TypeError('Dynamic hole declaration is invalid.')
  return `<!--fuma-hole:v1:${Buffer.from(JSON.stringify(parsed.value)).toString('base64url')}-->`
}

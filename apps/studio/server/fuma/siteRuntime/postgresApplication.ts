import { createHash } from 'node:crypto'
import type { DbClient } from '../../db/client'
import type { TenantObjectStorage } from '../objectStorage'
import { sha256Hex } from '../objectStorage'
import { assertReleaseManifest, type ReleaseManifest } from '../releases'
import { RUNTIME_ROUTE_MIME, RUNTIME_SNAPSHOT_MIME, RUNTIME_SNAPSHOT_PATH } from '../publishing/runtimeTree/contracts'
import { parseRuntimeSnapshotBytes, validateRuntimeRouteArtifact } from '../publishing/runtimeTree/renderer'
import {
  SiteApplicationError,
  SiteApplicationMutationResponseSchema,
  SiteRuntimeRolloutPolicySchema,
  parseSiteApplicationContract,
  type SiteApplicationMutationResponse,
  type SiteRuntimeLegacyDocument,
  type SiteRuntimeRolloutPolicy,
} from './applicationContracts'
import type {
  SiteRuntimeExactBinding,
  SiteRuntimeLegacyReader,
  SiteRuntimeMutationReceipt,
  SiteRuntimeMutationReceiptRepository,
  SiteRuntimeRolloutRepository,
} from './application'

interface PolicyRow { route: string; target: 'react' | 'legacy'; shadow: 'off' | 'compare'; fallback: 'deny' | 'legacy'; legacy_release_id: string | null; policy_version: string | number | bigint }
interface ReceiptRow { request_hash_sha256: string; response_json: unknown; created_at: string | Date }
interface ReleaseRow { manifest_json: unknown; manifest_hash: string; retained: boolean }

const LEGACY_CSP = "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'" as const

function integer(value: string | number | bigint): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result)) throw new SiteApplicationError('invalid', 'Stored runtime application integer is invalid.')
  return result
}
function iso(value: string | Date): string { return new Date(value).toISOString() }
function scope(binding: SiteRuntimeExactBinding) { return { organizationId: binding.organizationId, workspaceId: binding.workspaceId, siteId: binding.siteId } }
function manifest(raw: unknown): ReleaseManifest {
  let value = raw
  if (typeof value === 'string') value = JSON.parse(value) as unknown
  assertReleaseManifest(value)
  return structuredClone(value)
}

export class PostgresSiteRuntimeApplicationRepository implements SiteRuntimeRolloutRepository, SiteRuntimeMutationReceiptRepository {
  readonly #db: DbClient
  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new TypeError('Hosted site application state requires PostgreSQL.')
    this.#db = db
  }

  get(binding: SiteRuntimeExactBinding, route: string): Promise<SiteRuntimeRolloutPolicy | null>
  get(binding: SiteRuntimeExactBinding, memberId: string, idempotencyKey: string): Promise<SiteRuntimeMutationReceipt | null>
  async get(binding: SiteRuntimeExactBinding, routeOrMember: string, idempotencyKey?: string): Promise<SiteRuntimeRolloutPolicy | SiteRuntimeMutationReceipt | null> {
    if (idempotencyKey === undefined) {
      const row = (await this.#db<PolicyRow>`select route,target,shadow,fallback,legacy_release_id,policy_version from fuma_site_runtime_route_policies_v2
        where platform_id=${binding.platformId} and organization_id=${binding.organizationId} and workspace_id=${binding.workspaceId}
          and site_id=${binding.siteId} and owner_key=${binding.ownerKey} and owner_generation=${binding.ownerGeneration} and route=${routeOrMember}`).rows[0]
      return row ? parseSiteApplicationContract(SiteRuntimeRolloutPolicySchema, {
        route: row.route, target: row.target, shadow: row.shadow, fallback: row.fallback,
        legacyReleaseId: row.legacy_release_id, version: integer(row.policy_version),
      }, 'stored route rollout policy') as SiteRuntimeRolloutPolicy : null
    }
    const row = (await this.#db<ReceiptRow>`select request_hash_sha256,response_json,created_at from fuma_site_runtime_mutation_receipts_v2
      where platform_id=${binding.platformId} and organization_id=${binding.organizationId} and workspace_id=${binding.workspaceId}
        and site_id=${binding.siteId} and owner_key=${binding.ownerKey} and owner_generation=${binding.ownerGeneration}
        and member_id=${routeOrMember} and idempotency_key=${idempotencyKey}`).rows[0]
    if (!row) return null
    const response = parseSiteApplicationContract(SiteApplicationMutationResponseSchema, row.response_json, 'stored mutation receipt') as SiteApplicationMutationResponse
    return Object.freeze({ binding, memberId: routeOrMember, idempotencyKey, requestHashSha256: row.request_hash_sha256, response, createdAt: iso(row.created_at) })
  }

  put(binding: SiteRuntimeExactBinding, policy: SiteRuntimeRolloutPolicy, expectedVersion: number | null): Promise<boolean>
  put(receipt: SiteRuntimeMutationReceipt): Promise<boolean>
  async put(bindingOrReceipt: SiteRuntimeExactBinding | SiteRuntimeMutationReceipt, policy?: SiteRuntimeRolloutPolicy, expectedVersion?: number | null): Promise<boolean> {
    if ('idempotencyKey' in bindingOrReceipt) {
      const receipt = bindingOrReceipt
      const result = await this.#db`insert into fuma_site_runtime_mutation_receipts_v2
        (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,release_id,release_hash_sha256,member_id,idempotency_key,request_hash_sha256,response_json,created_at)
        values (${receipt.binding.platformId},${receipt.binding.organizationId},${receipt.binding.workspaceId},${receipt.binding.siteId},${receipt.binding.ownerKey},${receipt.binding.ownerGeneration},${receipt.binding.releaseId},${receipt.binding.releaseHashSha256},${receipt.memberId},${receipt.idempotencyKey},${receipt.requestHashSha256},${JSON.stringify(receipt.response)}::text::jsonb,${receipt.createdAt})
        on conflict do nothing`
      return result.rowCount === 1
    }
    if (!policy) throw new TypeError('Route rollout policy is required.')
    const binding = bindingOrReceipt
    const result = expectedVersion === null
      ? await this.#db`insert into fuma_site_runtime_route_policies_v2
        (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,route,target,shadow,fallback,legacy_release_id,policy_version,updated_at)
        values (${binding.platformId},${binding.organizationId},${binding.workspaceId},${binding.siteId},${binding.ownerKey},${binding.ownerGeneration},${policy.route},${policy.target},${policy.shadow},${policy.fallback},${policy.legacyReleaseId},${policy.version},now()) on conflict do nothing`
      : await this.#db`update fuma_site_runtime_route_policies_v2 set target=${policy.target},shadow=${policy.shadow},fallback=${policy.fallback},legacy_release_id=${policy.legacyReleaseId},policy_version=${policy.version},updated_at=now()
        where platform_id=${binding.platformId} and organization_id=${binding.organizationId} and workspace_id=${binding.workspaceId}
          and site_id=${binding.siteId} and owner_key=${binding.ownerKey} and owner_generation=${binding.ownerGeneration}
          and route=${policy.route} and policy_version=${expectedVersion}`
    return result.rowCount === 1
  }
}

export class PostgresSiteRuntimeLegacyReader implements SiteRuntimeLegacyReader {
  readonly #db: DbClient
  readonly #storage: TenantObjectStorage
  constructor(db: DbClient, storage: TenantObjectStorage) { this.#db = db; this.#storage = storage }

  async #release(binding: SiteRuntimeExactBinding, releaseId: string): Promise<ReleaseManifest> {
    const rows = (await this.#db<ReleaseRow>`select release.manifest_json,release.manifest_hash,
      exists(select 1 from fuma_release_retention_roots root where root.platform_id=release.platform_id and root.owner_key=release.owner_key and root.release_id=release.release_id) as retained
      from fuma_releases release join fuma_tenant_owner_keys owner on owner.platform_id=release.platform_id and owner.owner_key=release.owner_key
        and owner.organization_id=release.organization_id and owner.workspace_id=release.workspace_id and owner.site_id=release.site_id
      where release.platform_id=${binding.platformId} and release.organization_id=${binding.organizationId} and release.workspace_id=${binding.workspaceId}
        and release.site_id=${binding.siteId} and release.owner_key=${binding.ownerKey} and release.release_id=${releaseId}
        and release.status in ('ready','active') and release.manifest_json is not null and release.manifest_hash is not null
        and owner.generation=${binding.ownerGeneration} and owner.state='active' and owner.transfer_id is null and owner.transfer_lock_id is null and owner.transfer_fence is null limit 2`).rows
    if (rows.length !== 1 || !rows[0]!.retained) throw new SiteApplicationError('legacy-unavailable', 'Exact retained legacy release is unavailable.')
    const result = manifest(rows[0]!.manifest_json)
    if (result.releaseId !== releaseId || result.siteId !== binding.siteId || result.ownerKey !== binding.ownerKey || result.manifestHashSha256 !== rows[0]!.manifest_hash) {
      throw new SiteApplicationError('legacy-unavailable', 'Retained legacy manifest binding changed.')
    }
    return result
  }

  async #bytes(binding: SiteRuntimeExactBinding, release: ReleaseManifest, logicalPath: string, mime?: string): Promise<Uint8Array> {
    const artifact = release.artifacts.find((item) => item.logicalPath === logicalPath && (mime === undefined || item.mimeType === mime))
    if (!artifact) throw new SiteApplicationError('legacy-unavailable', 'Retained legacy artifact is unavailable.')
    const bytes = await this.#storage.get(scope(binding), artifact.objectKey)
    if (bytes.byteLength !== artifact.sizeBytes || sha256Hex(bytes) !== artifact.contentHashSha256) throw new SiteApplicationError('legacy-unavailable', 'Retained legacy artifact failed integrity verification.')
    return bytes
  }

  async read(binding: SiteRuntimeExactBinding, releaseId: string, route: string): Promise<SiteRuntimeLegacyDocument> {
    const release = await this.#release(binding, releaseId)
    const snapshot = parseRuntimeSnapshotBytes(await this.#bytes(binding, release, RUNTIME_SNAPSHOT_PATH, RUNTIME_SNAPSHOT_MIME))
    const routeRecord = snapshot.routes.find((candidate) => candidate.route === route)
    if (!routeRecord || snapshot.releaseId !== releaseId || snapshot.ownerGeneration !== binding.ownerGeneration) throw new SiteApplicationError('legacy-unavailable', 'Retained legacy route is unavailable.')
    const routeArtifact = validateRuntimeRouteArtifact(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await this.#bytes(binding, release, routeRecord.artifactPath, RUNTIME_ROUTE_MIME))) as unknown)
    if (routeArtifact.releaseId !== releaseId || routeArtifact.route.route !== route || routeArtifact.ownerKey !== binding.ownerKey) throw new SiteApplicationError('legacy-unavailable', 'Retained legacy route artifact binding changed.')
    const htmlBytes = await this.#bytes(binding, release, routeArtifact.route.semanticHtmlPath)
    let html: string
    try { html = new TextDecoder('utf-8', { fatal: true }).decode(htmlBytes) } catch { throw new SiteApplicationError('legacy-unavailable', 'Legacy HTML must be UTF-8.') }
    const scriptRefs = routeArtifact.artifactReferences.filter((item) => item.role === 'client-bundle' && /(?:javascript|ecmascript)/i.test(item.mimeType))
    if (scriptRefs.length > 32) throw new SiteApplicationError('legacy-unavailable', 'Legacy route exceeds its script budget.')
    const scripts = []
    for (const reference of scriptRefs) {
      const bytes = await this.#bytes(binding, release, reference.logicalPath, reference.mimeType)
      let source: string
      try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new SiteApplicationError('legacy-unavailable', 'Legacy script must be UTF-8.') }
      scripts.push(Object.freeze({ logicalPath: reference.logicalPath, source, contentHashSha256: createHash('sha256').update(source, 'utf8').digest('hex') }))
    }
    return Object.freeze({ releaseId, route, html, contentHashSha256: createHash('sha256').update(html, 'utf8').digest('hex'), scripts, csp: LEGACY_CSP })
  }
}

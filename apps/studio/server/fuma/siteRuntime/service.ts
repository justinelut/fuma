import { createHash } from 'node:crypto'
import {
  SiteRuntimeApplicationAuthority,
  type SiteRuntimeExactBinding,
} from './application'
import {
  SiteApplicationMutationRequestSchema,
  parseSiteApplicationContract,
  type SiteApplicationMutationRequest,
  type SiteApplicationMutationResponse,
} from './applicationContracts'
import type { DbClient } from '../../db/client'
import { sha256Hex, type TenantObjectStorage } from '../objectStorage'
import { assertReleaseManifest, type ReleaseManifest } from '../releases'
import { normalizePublicHost } from '../freeHosts'
import {
  RUNTIME_ROUTE_MIME,
  RUNTIME_SNAPSHOT_MIME,
  RUNTIME_SNAPSHOT_PATH,
} from '../publishing/runtimeTree/contracts'
import {
  parseRuntimeSnapshotBytes,
  validateRuntimeRouteArtifact,
} from '../publishing/runtimeTree/renderer'
import {
  SiteRuntimeContractError,
  SiteRuntimeResolveRequestSchema,
  SiteRuntimeResolveResponseSchema,
  canonicalSiteRuntimeQuery,
  parseSiteRuntimeContract,
  type SiteRuntimeCacheIdentity,
  type SiteRuntimeResolveRequest,
  type SiteRuntimeResolveResponse,
} from './contracts'

interface BindingRow {
  host: string
  platform_id: string
  organization_id: string
  workspace_id: string
  site_id: string
  owner_key: string
  owner_generation: string | number | bigint
  release_id: string
  manifest_json: unknown
}

type ExactBinding = Readonly<{
  host: string
  platformId: string
  organizationId: string
  workspaceId: string
  siteId: string
  ownerKey: string
  ownerGeneration: number
  releaseId: string
  manifest: ReleaseManifest
}>

export interface SiteRuntimeCacheCoordination {
  cacheGet(key: string): Promise<string | null>
  cacheSet(key: string, value: string, ttlMs: number): Promise<boolean>
}

function objectScope(binding: ExactBinding) {
  return Object.freeze({
    organizationId: binding.organizationId,
    workspaceId: binding.workspaceId,
    siteId: binding.siteId,
  })
}

function applicationBinding(binding: ExactBinding): SiteRuntimeExactBinding {
  return Object.freeze({
    host: binding.host,
    platformId: binding.platformId,
    organizationId: binding.organizationId,
    workspaceId: binding.workspaceId,
    siteId: binding.siteId,
    ownerKey: binding.ownerKey,
    ownerGeneration: binding.ownerGeneration,
    releaseId: binding.releaseId,
    releaseHashSha256: binding.manifest.manifestHashSha256,
  })
}

function manifestValue(value: unknown): ReleaseManifest | null {
  let candidate = value
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate) as unknown } catch { return null }
  }
  try {
    assertReleaseManifest(candidate)
    return Object.freeze(structuredClone(candidate))
  } catch {
    return null
  }
}

function safeGeneration(value: string | number | bigint): number | null {
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null
}

function sameBinding(left: ExactBinding, right: ExactBinding): boolean {
  return left.host === right.host
    && left.platformId === right.platformId
    && left.organizationId === right.organizationId
    && left.workspaceId === right.workspaceId
    && left.siteId === right.siteId
    && left.ownerKey === right.ownerKey
    && left.ownerGeneration === right.ownerGeneration
    && left.releaseId === right.releaseId
    && left.manifest.manifestHashSha256 === right.manifest.manifestHashSha256
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Readonly<Record<string, unknown>>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function cacheKey(identity: SiteRuntimeCacheIdentity): string {
  return `site-runtime:v1:${createHash('sha256').update(canonicalJson(identity)).digest('hex')}`
}

function sameIdentity(left: SiteRuntimeCacheIdentity, right: SiteRuntimeCacheIdentity): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** Studio-owned authority. The Next runtime receives validated release data, never database or object credentials. */
export class PostgresSiteRuntimeAuthority {
  readonly #db: DbClient
  readonly #storage: TenantObjectStorage
  readonly #application: SiteRuntimeApplicationAuthority
  readonly #coordination: SiteRuntimeCacheCoordination
  readonly #supportedDeployments: ReadonlySet<string>

  constructor(input: Readonly<{
    db: DbClient
    storage: TenantObjectStorage
    application: SiteRuntimeApplicationAuthority
    coordination: SiteRuntimeCacheCoordination
    supportedDeployments: readonly string[]
  }>) {
    if (input.db.dialect !== 'postgres') throw new TypeError('Hosted site runtime requires PostgreSQL authority.')
    if (input.supportedDeployments.length === 0) throw new TypeError('At least one site-runtime deployment version is required.')
    this.#db = input.db
    this.#storage = input.storage
    this.#application = input.application
    this.#coordination = input.coordination
    this.#supportedDeployments = new Set(input.supportedDeployments)
  }

  async #readBinding(rawHost: string): Promise<ExactBinding | null> {
    let host: string
    try { host = normalizePublicHost(rawHost) } catch { return null }
    const result = await this.#db<BindingRow>`
      with exact_host as (
        select free.host, free.platform_id, free.organization_id, free.workspace_id,
          free.site_id, free.owner_key, free.owner_generation
        from fuma_free_hosts_v2 free
        where free.host = ${host}
          and free.state = 'active'
          and free.canonical_host is null
        union all
        select domain.hostname_ascii as host, domain.platform_id, domain.organization_id,
          domain.workspace_id, domain.site_id, domain.owner_key, domain.owner_generation
        from fuma_domain_records_v2 domain
        join fuma_cloudflare_hostname_authority_v2 cloudflare
          on cloudflare.platform_id = domain.platform_id
         and cloudflare.organization_id = domain.organization_id
         and cloudflare.workspace_id = domain.workspace_id
         and cloudflare.site_id = domain.site_id
         and cloudflare.owner_key = domain.owner_key
         and cloudflare.owner_generation = domain.owner_generation
         and cloudflare.profile_id = domain.profile_id
         and cloudflare.domain_id = domain.domain_id
        where domain.hostname_ascii = ${host}
          and domain.owner_state = 'active'
          and domain.transfer_fence is null
          and domain.desired_state = 'active'
          and domain.observed_state = 'active'
          and domain.certificate_state = 'active'
          and cloudflare.lifecycle = 'active'
          and cloudflare.provider_status = 'active'
          and cloudflare.ssl_status = 'active'
          and cloudflare.ownership_verified
      )
      select exact.host, exact.platform_id, exact.organization_id, exact.workspace_id,
        exact.site_id, exact.owner_key, exact.owner_generation,
        pointer.release_id, release.manifest_json
      from exact_host exact
      join fuma_tenant_owner_keys owner
        on owner.platform_id = exact.platform_id
       and owner.organization_id = exact.organization_id
       and owner.workspace_id = exact.workspace_id
       and owner.site_id = exact.site_id
       and owner.owner_key = exact.owner_key
       and owner.generation = exact.owner_generation
      join fuma_release_active_pointers pointer
        on pointer.platform_id = exact.platform_id
       and pointer.organization_id = exact.organization_id
       and pointer.workspace_id = exact.workspace_id
       and pointer.site_id = exact.site_id
       and pointer.owner_key = exact.owner_key
      join fuma_releases release
        on release.platform_id = pointer.platform_id
       and release.organization_id = pointer.organization_id
       and release.workspace_id = pointer.workspace_id
       and release.site_id = pointer.site_id
       and release.owner_key = pointer.owner_key
       and release.release_id = pointer.release_id
      where owner.state = 'active'
        and owner.transfer_id is null
        and owner.transfer_lock_id is null
        and owner.transfer_fence is null
        and release.status = 'active'
        and release.manifest_json is not null
      limit 2
    `
    if (result.rows.length !== 1) return null
    const row = result.rows[0]!
    const ownerGeneration = safeGeneration(row.owner_generation)
    const manifest = manifestValue(row.manifest_json)
    if (ownerGeneration === null || !manifest
      || manifest.releaseId !== row.release_id
      || manifest.ownerKey !== row.owner_key
      || manifest.siteId !== row.site_id) return null
    return Object.freeze({
      host: row.host,
      platformId: row.platform_id,
      organizationId: row.organization_id,
      workspaceId: row.workspace_id,
      siteId: row.site_id,
      ownerKey: row.owner_key,
      ownerGeneration,
      releaseId: row.release_id,
      manifest,
    })
  }

  async #readArtifact(binding: ExactBinding, logicalPath: string, mimeType: string): Promise<Uint8Array> {
    const artifact = binding.manifest.artifacts.find((candidate) => candidate.logicalPath === logicalPath && candidate.mimeType === mimeType)
    if (!artifact) throw new SiteRuntimeContractError('invalid-artifact', 'Required immutable runtime artifact is unavailable.')
    const bytes = await this.#storage.get(objectScope(binding), artifact.objectKey)
    if (bytes.byteLength !== artifact.sizeBytes || sha256Hex(bytes) !== artifact.contentHashSha256) {
      throw new SiteRuntimeContractError('invalid-artifact', 'Immutable runtime artifact failed integrity verification.')
    }
    return bytes
  }

  async resolve(raw: unknown): Promise<SiteRuntimeResolveResponse> {
    const request = parseSiteRuntimeContract(SiteRuntimeResolveRequestSchema, raw, 'site runtime request') as SiteRuntimeResolveRequest
    canonicalSiteRuntimeQuery(request.canonicalQuery)
    if (!this.#supportedDeployments.has(request.runtimeDeploymentVersion)) {
      throw new SiteRuntimeContractError('incompatible-deployment', 'Runtime deployment is not accepted during this rollout.')
    }
    const binding = await this.#readBinding(request.host)
    if (!binding) throw new SiteRuntimeContractError('unknown-host', 'Exact active host is unavailable.')
    const exactBinding = applicationBinding(binding)
    const projection = await this.#application.project(exactBinding, request.memberSessionToken)
    const snapshotBytes = await this.#readArtifact(binding, RUNTIME_SNAPSHOT_PATH, RUNTIME_SNAPSHOT_MIME)
    const snapshot = parseRuntimeSnapshotBytes(snapshotBytes)
    if (snapshot.platformId !== binding.platformId
      || snapshot.organizationId !== binding.organizationId
      || snapshot.workspaceId !== binding.workspaceId
      || snapshot.siteId !== binding.siteId
      || snapshot.ownerKey !== binding.ownerKey
      || snapshot.ownerGeneration !== binding.ownerGeneration
      || snapshot.releaseId !== binding.releaseId
      || snapshot.sourceSnapshotHashSha256 !== binding.manifest.sourceSnapshotHashSha256) {
      throw new SiteRuntimeContractError('invalid-artifact', 'Runtime snapshot authority does not match the active host binding.')
    }
    const route = snapshot.routes.find((candidate) => candidate.route === request.route)
    if (!route) throw new SiteRuntimeContractError('route-not-found', 'Route is not present in the active immutable release.')
    const rolloutPolicy = await this.#application.policy(exactBinding, request.route)
    const identity: SiteRuntimeCacheIdentity = {
      host: binding.host,
      platformId: binding.platformId,
      organizationId: binding.organizationId,
      workspaceId: binding.workspaceId,
      siteId: binding.siteId,
      ownerKey: binding.ownerKey,
      ownerGeneration: binding.ownerGeneration,
      releaseId: binding.releaseId,
      releaseHashSha256: binding.manifest.manifestHashSha256,
      route: request.route,
      canonicalQuery: request.canonicalQuery,
      audience: projection.audience,
      runtimeDeploymentVersion: request.runtimeDeploymentVersion,
      componentRegistryVersion: snapshot.componentRegistryVersion,
      rolloutPolicyVersion: rolloutPolicy.version,
    }
    const key = cacheKey(identity)
    if (projection.audience.kind === 'public') try {
      const cached = await this.#coordination.cacheGet(key)
      if (cached !== null) {
        const parsed = parseSiteRuntimeContract(SiteRuntimeResolveResponseSchema, JSON.parse(cached) as unknown, 'cached site runtime response') as SiteRuntimeResolveResponse
        if (sameIdentity(parsed.cacheIdentity, identity)) return parsed
      }
    } catch {
      // Cache is an optimization. Exact PostgreSQL and immutable object authority remain available.
    }
    const routeBytes = await this.#readArtifact(binding, route.artifactPath, RUNTIME_ROUTE_MIME)
    const routeArtifact = validateRuntimeRouteArtifact(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(routeBytes)) as unknown)
    if (routeArtifact.route.route !== request.route
      || routeArtifact.route.artifactPath !== route.artifactPath
      || routeArtifact.releaseId !== binding.releaseId
      || routeArtifact.ownerKey !== binding.ownerKey
      || routeArtifact.ownerGeneration !== binding.ownerGeneration
      || routeArtifact.componentRegistryVersion !== snapshot.componentRegistryVersion) {
      throw new SiteRuntimeContractError('invalid-artifact', 'Runtime route artifact is not bound to the active route and release.')
    }
    const current = await this.#readBinding(binding.host)
    if (!current || !sameBinding(binding, current)) {
      throw new SiteRuntimeContractError('stale-release', 'Active release changed while the runtime route was resolving.')
    }
    const application = this.#application.context(identity, projection)
    const delivery = await this.#application.delivery(exactBinding, routeArtifact, rolloutPolicy)
    const response = parseSiteRuntimeContract(SiteRuntimeResolveResponseSchema, {
      schemaVersion: 1,
      contractVersion: '1.0.0',
      cacheIdentity: identity,
      sourceSnapshotHashSha256: snapshot.sourceSnapshotHashSha256,
      application,
      delivery,
      routeArtifact,
    }, 'site runtime response') as SiteRuntimeResolveResponse
    if (projection.audience.kind === 'public') try { await this.#coordination.cacheSet(key, JSON.stringify(response), 15 * 60_000) } catch { /* optional cache */ }
    return response
  }

  async mutate(raw: unknown): Promise<SiteApplicationMutationResponse> {
    const request = parseSiteApplicationContract(SiteApplicationMutationRequestSchema, raw, 'site application mutation request') as SiteApplicationMutationRequest
    const binding = await this.#readBinding(request.host)
    if (!binding) throw new SiteRuntimeContractError('unknown-host', 'Exact active host is unavailable.')
    return await this.#application.mutate(applicationBinding(binding), request)
  }
}

import { describe, expect, it } from 'bun:test'
import type { FumaSiteAuthorizationInput } from '../../../server/fuma/context/requestContext'
import {
  createFumaScopedRouteBoundary,
  type FumaJobContextAuthority,
  type FumaSiteJobAuthority,
  type FumaTrustedContext,
} from '../../../server/fuma/context'
import {
  FumaJobScopeBoundary,
  FumaJobScopeResolutionError,
  scopeFumaJobHandlers,
  type FumaJobHandlerContext,
  type FumaJobJsonValue,
  type FumaJobRecord,
  type FumaScopedJobHandlerContext,
  type FumaScopedSiteRepositoryFactory,
} from '../../../server/fuma/jobs'
import {
  createFumaScopedObjectKeyFactory,
} from '../../../server/fuma/objectStorage'
import {
  FumaHostedPluginCallBoundaryError,
  bindFumaHostedPluginCalls,
  type FumaHostedPluginCallBoundary,
  type FumaHostedPluginDispatchCall,
} from '../../../server/fuma/plugins'
import {
  createFumaScopedKeyFactory,
} from '../../../server/fuma/runtime/scopedKeys'
import type {
  BoundSiteRepository,
  BoundSiteRepositoryTransaction,
  SiteRecord,
} from '../../../server/fuma/sites'
import {
  FumaRepositoryScopeResolutionError,
  type FumaRepositoryScope,
  type FumaRepositoryScopeCoordinate,
  type FumaRepositoryScopeOwnerKeyAuthority,
  type TenantOwnerKeyRecord,
} from '../../../server/fuma/tenancy'

const ORIGIN = 'https://hosted.fuma.test'
const PLATFORM_ID = 'platform-fuma'
const PLATFORM_ORGANIZATION_ID = 'organization-platform'
const USER_ID = 'user-integration'
const WORKSPACE_ID = 'workspace-collision'
const SITE_ID = 'site-collision'
const RESOURCE = 'documents/shared'
const OBJECT_RESOURCE = 'media/shared/logo.png'
const CAPABILITY = 'website.content'
const KEY_VERSION = 3
const NOW = new Date('2026-07-25T15:30:00.000Z')
const CREATED_AT = '2026-07-25T15:00:00.000Z'
const CLAIM_EXPIRES_AT = '2026-07-25T16:00:00.000Z'

const SITES = Object.freeze([
  Object.freeze({ organizationId: 'organization-alpha', ownerKey: 'owner-alpha' }),
  Object.freeze({ organizationId: 'organization-beta', ownerKey: 'owner-beta' }),
])

type SiteCoordinate = Readonly<{
  platformId: string
  organizationId: string
  workspaceId: string
  siteId: string
}>

type KeyEvidence = Readonly<{
  cache: string
  pubsub: string
  lock: string
  object: string
}>

type PipelineEvidence = Readonly<{
  organizationId: string
  requestId: string
  jobRequestId: string
  pluginKeys: KeyEvidence
  jobKeys: KeyEvidence
  jobId: string
  siteName: string
}>

type RuntimeLog = Readonly<{
  stage: 'plugin' | 'job'
  organizationId: string
  requestId: string
  actorKind: 'staff' | 'internal-job'
  keys: KeyEvidence
}>

function coordinate(organizationId: string): SiteCoordinate {
  return {
    platformId: PLATFORM_ID,
    organizationId,
    workspaceId: WORKSPACE_ID,
    siteId: SITE_ID,
  }
}

function authorization(
  organizationId: string,
  subjectId: string,
): FumaSiteAuthorizationInput {
  const binding = coordinate(organizationId)
  return {
    platformOrganizationId: PLATFORM_ORGANIZATION_ID,
    platform: { id: PLATFORM_ID, status: 'active' },
    organization: {
      id: organizationId,
      platformId: PLATFORM_ID,
      kind: 'customer',
      status: 'active',
    },
    workspace: {
      id: WORKSPACE_ID,
      platformId: PLATFORM_ID,
      organizationId,
      status: 'active',
    },
    site: {
      id: SITE_ID,
      platformId: PLATFORM_ID,
      organizationId,
      workspaceId: WORKSPACE_ID,
      profileId: 'website',
      status: 'active',
    },
    profile: { ...binding, id: 'website', status: 'active' },
    capabilities: {
      ...binding,
      profileId: 'website',
      overrides: { grant: [], revoke: [] },
    },
    permissions: {
      subjectId,
      scope: { kind: 'site', ...binding },
      protectedOwnerInvariant: null,
      roleAssignments: [{
        id: `assignment.${organizationId}.${subjectId}`,
        subjectId,
        scope: {
          kind: 'organization',
          platformId: PLATFORM_ID,
          organizationId,
        },
        role: { kind: 'launch-persona', persona: 'member' },
      }],
      permissionOverrides: [],
      customRoles: [],
    },
  }
}

function ownerRecord(
  organizationId: string,
  ownerKey: string,
  changes: Partial<TenantOwnerKeyRecord> = {},
): TenantOwnerKeyRecord {
  return {
    ownerKey,
    coordinate: coordinate(organizationId),
    state: 'active',
    generation: 4,
    transferId: null,
    transferLockId: null,
    transferFence: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...changes,
  }
}

function sameCoordinate(
  left: FumaRepositoryScopeCoordinate,
  right: SiteCoordinate,
): boolean {
  return left.platformId === right.platformId
    && left.organizationId === right.organizationId
    && left.workspaceId === right.workspaceId
    && left.siteId === right.siteId
}

class MutableOwnerKeys implements FumaRepositoryScopeOwnerKeyAuthority {
  readonly records = new Map<string, TenantOwnerKeyRecord>()

  constructor() {
    for (const site of SITES) {
      this.records.set(
        site.organizationId,
        ownerRecord(site.organizationId, site.ownerKey),
      )
    }
  }

  loadOwnerKey(scope: FumaRepositoryScopeCoordinate): Promise<unknown | null> {
    const record = this.records.get(scope.organizationId)
    if (!record || !sameCoordinate(scope, record.coordinate)) return Promise.resolve(null)
    return Promise.resolve(structuredClone(record))
  }

  transfer(organizationId: string): void {
    const current = this.records.get(organizationId)
    if (!current) throw new Error('Missing owner record.')
    this.records.set(organizationId, ownerRecord(
      organizationId,
      current.ownerKey,
      {
        state: 'transferring',
        generation: current.generation + 1,
        transferId: `transfer.${organizationId}`,
        transferLockId: `lock.${organizationId}`,
        transferFence: 11,
      },
    ))
  }
}

class FakeScopedSiteRepositories implements FumaScopedSiteRepositoryFactory {
  constructor(private readonly ownerKeys: MutableOwnerKeys) {}

  #assertCurrent(scope: FumaRepositoryScope): void {
    const owner = this.ownerKeys.records.get(scope.organizationId)
    if (
      !owner
      || !sameCoordinate(scope, owner.coordinate)
      || owner.state !== 'active'
      || owner.ownerKey !== scope.ownerKey
      || owner.generation !== scope.generation
      || owner.transferFence !== scope.transferFence
    ) {
      throw new FumaRepositoryScopeResolutionError()
    }
  }

  forScope(scope: FumaRepositoryScope): BoundSiteRepository {
    const siteRecord = (): SiteRecord => ({
      id: scope.siteId,
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      slug: 'shared-home',
      name: `Site ${scope.organizationId}`,
      status: 'active',
      profileId: 'website',
      capabilityOverrides: { grant: [], revoke: [] },
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })
    const assertCurrent = () => this.#assertCurrent(scope)
    const transaction: BoundSiteRepositoryTransaction = Object.freeze({
      scope,
      async get() {
        assertCurrent()
        return siteRecord()
      },
      async findBySlug(slug) {
        assertCurrent()
        const site = siteRecord()
        return site.slug === slug ? site : null
      },
      async countActiveOwnedSites() {
        assertCurrent()
        return 1
      },
      async update(input) {
        assertCurrent()
        return { ...siteRecord(), ...input }
      },
      async archive() {
        assertCurrent()
        return { ...siteRecord(), status: 'archived' as const }
      },
    })
    return Object.freeze({
      ...transaction,
      async transaction<T>(work: (repository: BoundSiteRepositoryTransaction) => Promise<T>) {
        assertCurrent()
        return await work(transaction)
      },
    })
  }
}

function claimedJob(
  organizationId: string,
  jobId = `job.${organizationId}`,
): FumaJobRecord {
  return {
    id: jobId,
    organizationId,
    siteId: SITE_ID,
    kind: 'website.publish',
    payload: { logicalName: RESOURCE },
    status: 'running',
    priority: 0,
    organizationWeight: 1,
    siteWeight: 1,
    maxAttempts: 3,
    attemptCount: 1,
    runAt: CREATED_AT,
    claimedBy: 'worker.integration',
    claimExpiresAt: CLAIM_EXPIRES_AT,
    fence: '1',
    cancellationRequestedAt: null,
    idempotencyKey: `publish.${organizationId}`,
    result: null,
    error: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    completedAt: null,
  }
}

function jobAuthority(record: FumaJobRecord, organizationId = record.organizationId): FumaSiteJobAuthority {
  return {
    kind: 'site',
    originatingRequestId: `request.${record.organizationId}`,
    authorization: authorization(organizationId, record.id),
  }
}

function keyEvidence(
  trustedContext: FumaTrustedContext,
  repositoryScope: FumaRepositoryScope,
): KeyEvidence {
  const coordination = createFumaScopedKeyFactory({
    trustedContext,
    repositoryScope,
    capabilityId: CAPABILITY,
    version: KEY_VERSION,
  })
  const objects = createFumaScopedObjectKeyFactory(repositoryScope)
  return Object.freeze({
    cache: coordination.cache(RESOURCE),
    pubsub: coordination.pubsub(RESOURCE),
    lock: coordination.lock(RESOURCE),
    object: objects.physicalKey(OBJECT_RESOURCE),
  })
}

function request(
  organizationId: string,
  body: unknown = { logicalName: RESOURCE },
  headers: Readonly<Record<string, string>> = {},
): Request {
  const requestHeaders = new Headers(headers)
  requestHeaders.set('content-type', 'application/json')
  requestHeaders.set('origin', ORIGIN)
  const NativeResponse = (globalThis as Record<PropertyKey, unknown>)[
    Symbol.for('instatic.test.nativeResponse')
  ] as typeof Response
  const retainedHeaders = new NativeResponse(null, { headers: requestHeaders }).headers

  function retainHeaders(current: Request): Request {
    const clone = current.clone.bind(current)
    Object.defineProperty(current, 'headers', { value: retainedHeaders })
    Object.defineProperty(current, 'clone', {
      value: () => retainHeaders(clone()),
    })
    return current
  }

  return retainHeaders(new Request(
    `${ORIGIN}/api/fuma/organizations/${organizationId}/workspaces/${WORKSPACE_ID}/sites/${SITE_ID}/runtime`,
    {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(body),
    },
  ))
}

class RuntimeHarness {
  readonly ownerKeys = new MutableOwnerKeys()
  readonly repositories = new FakeScopedSiteRepositories(this.ownerKeys)
  readonly logs: RuntimeLog[] = []
  readonly cache = new Map<string, string>()
  readonly publications = new Map<string, string[]>()
  readonly locks = new Set<string>()
  readonly objects = new Map<string, string>()
  readonly outputs = new Map<string, PipelineEvidence>()
  readonly pluginBoundaries = new Map<string, FumaHostedPluginCallBoundary>()
  readonly jobs = new Map<string, FumaJobRecord>()
  readonly jobAuthorities = new Map<string, FumaSiteJobAuthority>()
  readonly handlerContexts = new Map<string, FumaJobHandlerContext>()
  readonly capturedSiteRepositories = new Map<string, BoundSiteRepository>()
  readonly replayedClaims = new Set<string>()
  jobHandlerRuns = 0

  readonly authority: FumaJobContextAuthority = {
    loadTrustedJobAuthority: async (input) => {
      const record = this.jobs.get(input.jobId)
      const authority = this.jobAuthorities.get(input.jobId)
      if (
        !record
        || !authority
        || input.organizationId !== record.organizationId
        || input.siteId !== record.siteId
        || input.jobKind !== record.kind
      ) {
        return null
      }
      return structuredClone(authority)
    },
  }

  readonly jobBoundary = new FumaJobScopeBoundary({
    authority: this.authority,
    ownerKeys: this.ownerKeys,
    siteRepositories: this.repositories,
    now: () => NOW,
  })

  readonly workers = scopeFumaJobHandlers({
    'website.publish': async (input) => await this.#runJob(input),
  }, this.jobBoundary)

  readonly http = createFumaScopedRouteBoundary({
    ports: {
      sessions: {
        async authenticateSameOriginHostedSession() {
          return {
            kind: 'staff',
            userId: USER_ID,
            sessionId: 'session.integration',
            impersonator: null,
          }
        },
      },
      authorization: {
        async loadExactSiteAuthorization(input) {
          return authorization(input.routeScope.organizationId, USER_ID)
        },
      },
    },
    ownerKeys: this.ownerKeys,
    allowsMutationOrigin: (candidate) => candidate.headers.get('origin') === ORIGIN,
    generateRequestId: () => `request.${crypto.randomUUID()}`,
    routes: [{
      method: 'POST',
      path: '/runtime',
      permission: 'content.pages.write',
      handler: async ({ context, repositoryScope }) => {
        const organizationId = repositoryScope.organizationId
        const dispatch = async (call: FumaHostedPluginDispatchCall): Promise<unknown> => {
          const keys = keyEvidence(
            { kind: 'request', context },
            call.authority.repositoryScope,
          )
          this.cache.set(keys.cache, organizationId)
          this.publications.set(keys.pubsub, [`event:${organizationId}`])
          this.locks.add(keys.lock)
          this.objects.set(keys.object, organizationId)
          this.logs.push({
            stage: 'plugin',
            organizationId,
            requestId: context.requestId,
            actorKind: context.actor.kind,
            keys,
          })

          const record = claimedJob(organizationId)
          this.jobs.set(record.id, record)
          this.jobAuthorities.set(record.id, jobAuthority(record))
          return { jobId: record.id }
        }
        const plugin = await bindFumaHostedPluginCalls({
          pluginId: 'plugin.runtime-evidence',
          trustedContext: { kind: 'request', context },
          ownerKeys: this.ownerKeys,
          grantedPermissions: ['unstable.internals'],
          requirements: [{
            kind: 'rpc',
            target: 'runtime.execute',
            requiredCapabilities: [CAPABILITY],
            requiredPluginPermissions: ['unstable.internals'],
          }],
          persistence: { dispatch },
          rpc: { dispatch },
        })
        this.pluginBoundaries.set(organizationId, plugin)
        await plugin.call({
          kind: 'rpc',
          target: 'runtime.execute',
          payload: { logicalName: RESOURCE },
        })
        const record = this.jobs.get(`job.${organizationId}`)
        if (!record) throw new Error('Plugin did not enqueue its site job.')
        await this.runClaim(record)
        return Response.json({ ok: true })
      },
    }],
  })

  async #runJob(input: FumaScopedJobHandlerContext): Promise<FumaJobJsonValue> {
    if (input.jobContext.kind !== 'site' || input.repositoryScope === null || input.siteRepository === null) {
      throw new Error('Expected trusted site-job authority.')
    }
    this.jobHandlerRuns += 1
    const keys = keyEvidence(
      { kind: 'job', context: input.jobContext },
      input.repositoryScope,
    )
    const site = await input.siteRepository.get()
    if (!site) throw new Error('Scoped site disappeared.')
    const organizationId = input.repositoryScope.organizationId
    const pluginLog = this.logs.find((entry) => (
      entry.stage === 'plugin' && entry.organizationId === organizationId
    ))
    if (!pluginLog) throw new Error('Missing plugin-stage evidence.')
    this.logs.push({
      stage: 'job',
      organizationId,
      requestId: input.jobContext.requestId,
      actorKind: input.jobContext.actor.kind,
      keys,
    })
    this.capturedSiteRepositories.set(organizationId, input.siteRepository)
    this.outputs.set(organizationId, Object.freeze({
      organizationId,
      requestId: pluginLog.requestId,
      jobRequestId: input.jobContext.requestId,
      pluginKeys: pluginLog.keys,
      jobKeys: keys,
      jobId: input.job.id,
      siteName: site.name,
    }))
    return { organizationId, cacheKey: keys.cache, objectKey: keys.object }
  }

  handlerContext(record: FumaJobRecord): FumaJobHandlerContext {
    const existing = this.handlerContexts.get(record.id)
    if (existing) return existing
    const context: FumaJobHandlerContext = {
      job: record,
      attemptNumber: record.attemptCount,
      fence: record.fence,
      cancellationRequested: async () => {
        if (this.replayedClaims.has(record.id)) throw new Error('stale claim replay')
        return false
      },
      readDurableResult: () => Promise.resolve(null),
      commitDurableResult: (_effectKey, result) => Promise.resolve({ result, created: true }),
    }
    this.handlerContexts.set(record.id, context)
    return context
  }

  async runClaim(record: FumaJobRecord): Promise<FumaJobJsonValue> {
    const worker = this.workers[record.kind]
    if (!worker) throw new Error(`Missing worker for ${record.kind}.`)
    return await worker(this.handlerContext(record))
  }

  async dispatch(candidate: Request): Promise<Response> {
    const response = await this.http.handle(candidate)
    if (!response) throw new Error('Runtime boundary did not own request.')
    return response
  }
}

describe('FUMA-026 runtime boundary integration evidence', () => {
  it('separates equal operations for colliding site resources through HTTP, plugin, keys, and queued jobs', async () => {
    const harness = new RuntimeHarness()

    for (const site of SITES) {
      const response = await harness.dispatch(request(site.organizationId))
      expect(response.status).toBe(200)
    }

    const alpha = harness.outputs.get(SITES[0].organizationId)
    const beta = harness.outputs.get(SITES[1].organizationId)
    expect(alpha).toBeDefined()
    expect(beta).toBeDefined()
    if (!alpha || !beta) throw new Error('Missing pipeline evidence.')

    expect(alpha.organizationId).not.toBe(beta.organizationId)
    expect(alpha.requestId).not.toBe(beta.requestId)
    expect(alpha.jobRequestId).not.toBe(beta.jobRequestId)
    expect(alpha.siteName).not.toBe(beta.siteName)
    expect(alpha.pluginKeys).toEqual(alpha.jobKeys)
    expect(beta.pluginKeys).toEqual(beta.jobKeys)
    for (const kind of ['cache', 'pubsub', 'lock', 'object'] as const) {
      expect(alpha.pluginKeys[kind]).not.toBe(beta.pluginKeys[kind])
    }

    expect(harness.cache.get(alpha.pluginKeys.cache)).toBe(alpha.organizationId)
    expect(harness.cache.get(beta.pluginKeys.cache)).toBe(beta.organizationId)
    expect(harness.publications.get(alpha.pluginKeys.pubsub)).toEqual([`event:${alpha.organizationId}`])
    expect(harness.publications.get(beta.pluginKeys.pubsub)).toEqual([`event:${beta.organizationId}`])
    expect(harness.locks.has(alpha.pluginKeys.lock)).toBe(true)
    expect(harness.locks.has(beta.pluginKeys.lock)).toBe(true)
    expect(harness.objects.get(alpha.pluginKeys.object)).toBe(alpha.organizationId)
    expect(harness.objects.get(beta.pluginKeys.object)).toBe(beta.organizationId)

    expect(harness.logs).toHaveLength(4)
    expect(harness.logs.map(({ stage, organizationId, actorKind }) => ({
      stage,
      organizationId,
      actorKind,
    }))).toEqual([
      { stage: 'plugin', organizationId: alpha.organizationId, actorKind: 'staff' },
      { stage: 'job', organizationId: alpha.organizationId, actorKind: 'internal-job' },
      { stage: 'plugin', organizationId: beta.organizationId, actorKind: 'staff' },
      { stage: 'job', organizationId: beta.organizationId, actorKind: 'internal-job' },
    ])
    expect(harness.jobHandlerRuns).toBe(2)
  })

  it('denies cross-tenant claims, stale replay, and stale transfer handles before effects', async () => {
    const harness = new RuntimeHarness()
    const alphaId = SITES[0].organizationId
    const betaId = SITES[1].organizationId
    expect((await harness.dispatch(request(alphaId))).status).toBe(200)
    expect((await harness.dispatch(request(betaId))).status).toBe(200)

    const baselineLogs = harness.logs.length
    expect((await harness.dispatch(request(alphaId, { logicalName: RESOURCE }, {
      'x-owner-key': SITES[1].ownerKey,
    }))).status).toBe(404)
    expect((await harness.dispatch(request(alphaId, {
      logicalName: RESOURCE,
      organizationId: betaId,
    }))).status).toBe(404)
    expect(harness.logs).toHaveLength(baselineLogs)

    const alphaPlugin = harness.pluginBoundaries.get(alphaId)
    if (!alphaPlugin) throw new Error('Missing bound plugin.')
    await expect(alphaPlugin.call({
      kind: 'rpc',
      target: 'runtime.execute',
      payload: { logicalName: RESOURCE, tenantId: betaId },
    })).rejects.toBeInstanceOf(FumaHostedPluginCallBoundaryError)
    expect(harness.logs).toHaveLength(baselineLogs)

    const crossTenantJob = claimedJob(alphaId, 'job.cross-tenant')
    harness.jobs.set(crossTenantJob.id, crossTenantJob)
    harness.jobAuthorities.set(crossTenantJob.id, jobAuthority(crossTenantJob, betaId))
    const runsBeforeCrossTenant = harness.jobHandlerRuns
    await expect(harness.runClaim(crossTenantJob)).rejects.toBeInstanceOf(
      FumaJobScopeResolutionError,
    )
    expect(harness.jobHandlerRuns).toBe(runsBeforeCrossTenant)

    const alphaJob = harness.jobs.get(`job.${alphaId}`)
    if (!alphaJob) throw new Error('Missing alpha job.')
    harness.replayedClaims.add(alphaJob.id)
    await expect(harness.runClaim(alphaJob)).rejects.toBeInstanceOf(
      FumaJobScopeResolutionError,
    )
    expect(harness.jobHandlerRuns).toBe(runsBeforeCrossTenant)

    const staleRepository = harness.capturedSiteRepositories.get(alphaId)
    if (!staleRepository) throw new Error('Missing captured repository.')
    harness.replayedClaims.delete(alphaJob.id)
    harness.ownerKeys.transfer(alphaId)
    await expect(staleRepository.get()).rejects.toBeInstanceOf(
      FumaRepositoryScopeResolutionError,
    )
    await expect(alphaPlugin.call({
      kind: 'rpc',
      target: 'runtime.execute',
      payload: { logicalName: RESOURCE },
    })).rejects.toBeInstanceOf(FumaHostedPluginCallBoundaryError)
    expect(harness.logs).toHaveLength(baselineLogs)
  })
})

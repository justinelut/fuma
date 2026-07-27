import { describe, expect, it } from 'bun:test'
import {
  createFumaJobWorkerComponentFactory,
  FumaJobScopeBoundary,
  FumaJobScopeResolutionError,
  scopeFumaJobHandlers,
  type FumaJobHandlerContext,
  type FumaJobRecord,
  type FumaScopedJobHandlerContext,
} from '../../../server/fuma/jobs'
import type {
  FumaJobContextAuthority,
  FumaOrganizationJobAuthority,
  FumaSiteJobAuthority,
} from '../../../server/fuma/context'
import {
  ScopedSiteRepository,
  type SiteRepository,
  type SiteRepositoryTransaction,
  type SiteOwnerScopeAuthority,
} from '../../../server/fuma/sites'
import {
  FumaRepositoryScopeResolutionError,
  type FumaRepositoryScope,
  type FumaRepositoryScopeCoordinate,
  type FumaRepositoryScopeOwnerKeyAuthority,
  type TenantOwnerKeyRecord,
} from '../../../server/fuma/tenancy'
import { FumaRuntimeLifecycle } from '../../../server/fuma/runtime/lifecycle'
import {
  DeterministicJobReadyQueue,
  InMemoryFumaJobRepository,
} from '../helpers/fuma/deterministicJobs'

const PLATFORM_ID = 'platform-fuma'
const PLATFORM_ORGANIZATION_ID = 'organization-platform'
const ORGANIZATION_A = 'organization-a'
const ORGANIZATION_B = 'organization-b'
const WORKSPACE_A = 'workspace-a'
const WORKSPACE_B = 'workspace-b'
const SITE_ID = 'site-collision'
const JOB_ID = 'job-publish-01'
const NOW = new Date('2026-07-25T15:00:00.000Z')
const CREATED_AT = '2026-07-25T14:00:00.000Z'

function job(changes: Partial<FumaJobRecord> = {}): FumaJobRecord {
  return {
    id: JOB_ID,
    organizationId: ORGANIZATION_A,
    siteId: SITE_ID,
    kind: 'website.publish',
    payload: {
      documentId: 'document-01',
      organizationId: ORGANIZATION_B,
      workspaceId: WORKSPACE_B,
      siteId: 'site-substitution',
      ownerKey: 'owner-substitution',
      generation: 999,
      transferFence: 999,
      actor: { kind: 'staff', userId: 'attacker' },
    },
    status: 'running',
    priority: 0,
    organizationWeight: 1,
    siteWeight: 1,
    maxAttempts: 5,
    attemptCount: 1,
    runAt: '2026-07-25T14:59:00.000Z',
    claimedBy: 'worker-01',
    claimExpiresAt: '2026-07-25T15:05:00.000Z',
    fence: '7',
    cancellationRequestedAt: null,
    idempotencyKey: null,
    result: null,
    error: null,
    createdAt: CREATED_AT,
    updatedAt: '2026-07-25T14:59:00.000Z',
    completedAt: null,
    ...changes,
  }
}

function siteAuthority(
  organizationId = ORGANIZATION_A,
  workspaceId = WORKSPACE_A,
): FumaSiteJobAuthority {
  const binding = {
    platformId: PLATFORM_ID,
    organizationId,
    workspaceId,
    siteId: SITE_ID,
  }
  return {
    kind: 'site',
    originatingRequestId: 'request-enqueue-01',
    authorization: {
      platformOrganizationId: PLATFORM_ORGANIZATION_ID,
      platform: { id: PLATFORM_ID, status: 'active' },
      organization: {
        id: organizationId,
        platformId: PLATFORM_ID,
        kind: 'customer',
        status: 'active',
      },
      workspace: {
        id: workspaceId,
        platformId: PLATFORM_ID,
        organizationId,
        status: 'active',
      },
      site: {
        id: SITE_ID,
        platformId: PLATFORM_ID,
        organizationId,
        workspaceId,
        profileId: 'website',
        status: 'active',
      },
      profile: {
        ...binding,
        id: 'website',
        status: 'active',
      },
      capabilities: {
        ...binding,
        profileId: 'website',
        overrides: { grant: [], revoke: [] },
      },
      permissions: {
        subjectId: JOB_ID,
        scope: { kind: 'site', ...binding },
        protectedOwnerInvariant: null,
        roleAssignments: [{
          id: `assignment.${organizationId}.job`,
          subjectId: JOB_ID,
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
    },
  }
}

function organizationAuthority(): FumaOrganizationJobAuthority {
  return {
    kind: 'organization',
    originatingRequestId: 'request-enqueue-organization',
    platformOrganizationId: PLATFORM_ORGANIZATION_ID,
    job: {
      kind: 'organization.reconcile',
      permission: 'organization.read',
    },
    platform: { id: PLATFORM_ID, status: 'active' },
    organization: {
      id: ORGANIZATION_A,
      platformId: PLATFORM_ID,
      kind: 'customer',
      status: 'active',
    },
    permissions: {
      subjectId: JOB_ID,
      scope: {
        kind: 'organization',
        platformId: PLATFORM_ID,
        organizationId: ORGANIZATION_A,
      },
      protectedOwnerInvariant: null,
      roleAssignments: [{
        id: 'assignment.organization-job',
        subjectId: JOB_ID,
        scope: {
          kind: 'organization',
          platformId: PLATFORM_ID,
          organizationId: ORGANIZATION_A,
        },
        role: { kind: 'launch-persona', persona: 'member' },
      }],
      permissionOverrides: [],
      customRoles: [],
    },
  }
}

function ownerRecord(
  changes: Partial<TenantOwnerKeyRecord> = {},
): TenantOwnerKeyRecord {
  return {
    ownerKey: 'owner-a',
    coordinate: {
      platformId: PLATFORM_ID,
      organizationId: ORGANIZATION_A,
      workspaceId: WORKSPACE_A,
      siteId: SITE_ID,
    },
    state: 'active',
    generation: 7,
    transferId: null,
    transferLockId: null,
    transferFence: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...changes,
  }
}

class MutableOwnerAuthority implements FumaRepositoryScopeOwnerKeyAuthority {
  current = ownerRecord()
  readonly seen: FumaRepositoryScopeCoordinate[] = []

  loadOwnerKey(coordinate: FumaRepositoryScopeCoordinate): Promise<unknown | null> {
    this.seen.push(structuredClone(coordinate))
    return Promise.resolve(structuredClone(this.current))
  }
}

class ExactSiteRepository implements SiteRepository {
  owner = ownerRecord()
  transactionCount = 0

  transaction<T>(
    organizationId: string,
    workspaceId: string,
    work: (transaction: SiteRepositoryTransaction) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1
    const currentOwner = () => this.owner
    return work({
      getWorkspaceStatus: () => Promise.resolve('active'),
      getById: () => Promise.resolve({
        id: SITE_ID,
        organizationId,
        workspaceId,
        slug: 'home',
        name: 'Tenant A',
        status: 'active',
        profileId: 'website',
        capabilityOverrides: { grant: [], revoke: [] },
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      }),
      getSites: () => Promise.resolve([]),
      async assertActiveOwnerScope(authority: SiteOwnerScopeAuthority) {
        const current = currentOwner()
        if (
          organizationId !== current.coordinate.organizationId
          || workspaceId !== current.coordinate.workspaceId
          || authority.platformId !== current.coordinate.platformId
          || authority.siteId !== current.coordinate.siteId
          || authority.ownerKey !== current.ownerKey
          || authority.generation !== current.generation
          || current.state !== 'active'
          || current.transferId !== null
          || current.transferLockId !== null
          || current.transferFence !== null
        ) {
          throw new FumaRepositoryScopeResolutionError()
        }
      },
      insert: async (record) => record,
      update: async (record) => record,
    })
  }

  getWorkspaceStatus(): Promise<'active'> {
    return Promise.resolve('active')
  }

  getById(): Promise<null> {
    return Promise.resolve(null)
  }

  listByWorkspace(): Promise<[]> {
    return Promise.resolve([])
  }

  countActiveOwnedSites(): Promise<number> {
    return Promise.resolve(1)
  }
}

function context(
  record: FumaJobRecord,
  cancellationRequested: () => Promise<boolean> = () => Promise.resolve(false),
): FumaJobHandlerContext {
  return {
    job: record,
    attemptNumber: record.attemptCount,
    fence: record.fence,
    cancellationRequested,
    readDurableResult: () => Promise.resolve(null),
    commitDurableResult: (_effectKey, result) => Promise.resolve({ result, created: true }),
  }
}

function boundaryHarness(authorityValue: unknown) {
  const authorityInputs: Parameters<FumaJobContextAuthority['loadTrustedJobAuthority']>[0][] = []
  const authority: FumaJobContextAuthority = {
    async loadTrustedJobAuthority(input) {
      authorityInputs.push(structuredClone(input))
      return structuredClone(authorityValue)
    },
  }
  const ownerKeys = new MutableOwnerAuthority()
  const repository = new ExactSiteRepository()
  const siteRepositories = new ScopedSiteRepository(repository, () => NOW)
  const boundary = new FumaJobScopeBoundary({
    authority,
    ownerKeys,
    siteRepositories,
    now: () => NOW,
  })
  return { authorityInputs, boundary, ownerKeys, repository }
}

async function run(
  boundary: FumaJobScopeBoundary,
  record: FumaJobRecord,
  handler: (input: FumaScopedJobHandlerContext) => Promise<null>,
  cancellationRequested?: () => Promise<boolean>,
): Promise<null> {
  const handlers = scopeFumaJobHandlers({ [record.kind]: handler }, boundary)
  return await handlers[record.kind]!(context(record, cancellationRequested))
}

describe('FUMA-026 durable-job scope boundary', () => {
  it('ignores payload authority and binds exact server-resolved owner generation and transfer fence', async () => {
    const harness = boundaryHarness(siteAuthority())
    let captured: FumaScopedJobHandlerContext | undefined

    await run(harness.boundary, job(), async (input) => {
      captured = input
      if (input.jobContext.kind !== 'site') throw new Error('Expected site authority')
      expect((await input.siteRepository.get())?.name).toBe('Tenant A')
      return null
    })

    expect(harness.authorityInputs).toEqual([{
      jobId: JOB_ID,
      organizationId: ORGANIZATION_A,
      siteId: SITE_ID,
      jobKind: 'website.publish',
    }])
    expect(Object.keys(harness.authorityInputs[0]!)).not.toContain('payload')
    expect(harness.ownerKeys.seen).toEqual([{
      platformId: PLATFORM_ID,
      organizationId: ORGANIZATION_A,
      workspaceId: WORKSPACE_A,
      siteId: SITE_ID,
    }])
    expect(captured?.repositoryScope).toEqual({
      platformId: PLATFORM_ID,
      organizationId: ORGANIZATION_A,
      workspaceId: WORKSPACE_A,
      siteId: SITE_ID,
      ownerKey: 'owner-a',
      state: 'active',
      generation: 7,
      transferFence: null,
    })
    expect(Object.isFrozen(captured)).toBe(true)
    expect(Object.isFrozen(captured?.job)).toBe(true)
    expect(Object.isFrozen(captured?.job.payload)).toBe(true)
  })

  it('does not give actorless organization jobs a site repository capability', async () => {
    const harness = boundaryHarness(organizationAuthority())
    const record = job({
      siteId: null,
      kind: 'organization.reconcile',
      payload: { siteId: SITE_ID, workspaceId: WORKSPACE_A },
    })

    await run(harness.boundary, record, async (input) => {
      expect(input.jobContext.kind).toBe('organization')
      expect(input.repositoryScope).toBeNull()
      expect(input.siteRepository).toBeNull()
      return null
    })

    expect(harness.ownerKeys.seen).toEqual([])
    expect(harness.repository.transactionCount).toBe(0)
  })

  it('fails closed before handler entry for cross-tenant authority substitution and active transfer', async () => {
    const substituted = boundaryHarness(siteAuthority(ORGANIZATION_B, WORKSPACE_B))
    let handlerRuns = 0
    await expect(run(substituted.boundary, job(), async () => {
      handlerRuns += 1
      return null
    })).rejects.toBeInstanceOf(FumaJobScopeResolutionError)
    expect(handlerRuns).toBe(0)
    expect(substituted.ownerKeys.seen).toEqual([])

    const transferring = boundaryHarness(siteAuthority())
    transferring.ownerKeys.current = ownerRecord({
      state: 'transferring',
      generation: 8,
      transferId: 'transfer-01',
      transferLockId: 'lock-01',
      transferFence: 19,
    })
    await expect(run(transferring.boundary, job(), async () => {
      handlerRuns += 1
      return null
    })).rejects.toBeInstanceOf(FumaJobScopeResolutionError)
    expect(handlerRuns).toBe(0)
  })

  it('rejects stale claim replay and stale pre-transfer repository handles', async () => {
    const harness = boundaryHarness(siteAuthority())
    let staleClaim = false
    let captured: FumaScopedJobHandlerContext | undefined
    const cancellationRequested = async () => {
      if (staleClaim) throw new Error('stale durable claim fence')
      return false
    }

    await run(harness.boundary, job(), async (input) => {
      captured = input
      return null
    }, cancellationRequested)
    if (!captured || captured.jobContext.kind !== 'site') throw new Error('Expected captured site context')

    const transactionsBeforeReplay = harness.repository.transactionCount
    staleClaim = true
    await expect(captured.siteRepository.get()).rejects.toBeInstanceOf(FumaJobScopeResolutionError)
    expect(harness.repository.transactionCount).toBe(transactionsBeforeReplay)

    staleClaim = false
    harness.repository.owner = ownerRecord({
      state: 'transferring',
      generation: 8,
      transferId: 'transfer-01',
      transferLockId: 'lock-01',
      transferFence: 20,
    })
    await expect(captured.siteRepository.get()).rejects.toBeInstanceOf(
      FumaRepositoryScopeResolutionError,
    )
  })

  it('revokes a captured bound repository handle after same-fence completion clears the claim', async () => {
    const harness = boundaryHarness(siteAuthority())
    const jobs = new InMemoryFumaJobRepository()
    await jobs.enqueue({
      id: JOB_ID,
      organizationId: ORGANIZATION_A,
      siteId: SITE_ID,
      kind: 'website.publish',
      payload: null,
    }, { maxActivePerOrganization: 1, maxActivePerSite: 1 }, NOW)
    const claim = await jobs.claim(JOB_ID, 'worker-01', 300_000, NOW)
    if (!claim) throw new Error('Expected a claimed job.')
    let captured: FumaScopedJobHandlerContext | undefined

    await run(harness.boundary, claim.job, async (input) => {
      captured = input
      return null
    }, () => jobs.cancellationRequested(claim))
    if (!captured || captured.jobContext.kind !== 'site') {
      throw new Error('Expected captured site context')
    }

    await jobs.complete(claim, null, NOW)
    expect((await jobs.get(JOB_ID))?.fence).toBe(claim.fence)
    expect((await jobs.get(JOB_ID))?.claimedBy).toBeNull()
    const transactionsBeforeReplay = harness.repository.transactionCount
    await expect(captured.siteRepository.get()).rejects.toBeInstanceOf(
      FumaJobScopeResolutionError,
    )
    expect(harness.repository.transactionCount).toBe(transactionsBeforeReplay)
  })

  it('refuses to mount executable worker handlers without trusted authority', async () => {
    const factory = createFumaJobWorkerComponentFactory({
      repository: new InMemoryFumaJobRepository(),
      readyQueue: new DeterministicJobReadyQueue(),
      handlers: { demo: async () => null },
      instanceId: 'worker-untrusted',
      now: () => NOW,
    })
    const runtime = new FumaRuntimeLifecycle({
      role: 'worker',
      drainTimeoutMs: 1_000,
      components: [factory({
        id: 'durable-job-worker',
        role: 'worker',
        settings: { healthPort: 0, drainTimeoutMs: 1_000 },
        log() {},
      })],
    })

    await expect(runtime.start()).rejects.toThrow('The Fuma worker runtime failed to start.')
    expect(runtime.snapshot().state).toBe('failed')
  })
})

import { describe, expect, it } from 'bun:test'
import { Value } from '@core/utils/typeboxHelpers'
import {
  freezeFumaRequestContext,
  type FumaOrganizationJobContext,
  type FumaSiteJobContext,
  type FumaTrustedContext,
} from '../../../server/fuma/context'
import {
  FumaRepositoryScopeResolutionError,
  FumaRepositoryScopeSchema,
  deriveFumaRepositoryScope,
  type FumaRepositoryScopeCoordinate,
  type FumaRepositoryScopeOwnerKeyAuthority,
  type TenantOwnerKeyRecord,
} from '../../../server/fuma/tenancy'

const PLATFORM_ID = 'platform-fuma'
const ORGANIZATION_A = 'organization-a'
const ORGANIZATION_B = 'organization-b'
const SHARED_WORKSPACE_ID = 'workspace-collision'
const SHARED_SITE_ID = 'site-collision'

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

function requestContext(organizationId = ORGANIZATION_A) {
  return freezeFumaRequestContext({
    requestId: `request-${organizationId}`,
    source: {
      kind: 'staff-session',
      correlationId: `correlation-${organizationId}`,
      userId: 'staff-01',
      sessionId: 'session-01',
      impersonatedBy: null,
    },
    actor: {
      kind: 'staff',
      userId: 'staff-01',
      sessionId: 'session-01',
      impersonator: null,
    },
    scope: {
      platform: { id: PLATFORM_ID, status: 'active' },
      organization: {
        id: organizationId,
        platformId: PLATFORM_ID,
        status: 'active',
      },
      workspace: {
        id: SHARED_WORKSPACE_ID,
        platformId: PLATFORM_ID,
        organizationId,
        status: 'active',
      },
      site: {
        id: SHARED_SITE_ID,
        platformId: PLATFORM_ID,
        organizationId,
        workspaceId: SHARED_WORKSPACE_ID,
        profileId: 'website',
        status: 'active',
      },
    },
    profile: { id: 'website', status: 'active' },
    capabilities: ['site.home'],
    permissions: {
      subjectId: 'staff-01',
      allow: ['site.home.read'],
      deny: [],
    },
  })
}

function siteJobContext(organizationId = ORGANIZATION_A): FumaSiteJobContext {
  const request = requestContext(organizationId)
  return deepFreeze<FumaSiteJobContext>({
    kind: 'site',
    originatingRequestId: request.requestId,
    requestId: 'job-01:request:7',
    source: {
      kind: 'internal-job',
      correlationId: 'job-01:request:7',
      jobId: 'job-01',
      runId: 'job-01:run:7',
    },
    actor: {
      kind: 'internal-job',
      jobId: 'job-01',
      runId: 'job-01:run:7',
    },
    scope: request.scope,
    profile: request.profile,
    capabilities: request.capabilities,
    permissions: {
      subjectId: 'job-01',
      allow: ['content.pages.write'],
      deny: [],
    },
    requiredPermission: 'content.pages.write',
  })
}

function organizationJobContext(): FumaOrganizationJobContext {
  return deepFreeze<FumaOrganizationJobContext>({
    kind: 'organization',
    originatingRequestId: 'request-enqueue-01',
    requestId: 'job-org-01:request:3',
    source: {
      kind: 'internal-job',
      correlationId: 'job-org-01:request:3',
      jobId: 'job-org-01',
      runId: 'job-org-01:run:3',
    },
    actor: {
      kind: 'internal-job',
      jobId: 'job-org-01',
      runId: 'job-org-01:run:3',
    },
    scope: {
      platform: { id: PLATFORM_ID, status: 'active' },
      organization: {
        id: ORGANIZATION_A,
        platformId: PLATFORM_ID,
        status: 'active',
      },
    },
    permissions: {
      subjectId: 'job-org-01',
      allow: ['organization.read'],
      deny: [],
    },
    requiredPermission: 'organization.read',
  })
}

function ownerKey(
  organizationId = ORGANIZATION_A,
  changes: Partial<TenantOwnerKeyRecord> = {},
): TenantOwnerKeyRecord {
  return {
    ownerKey: 'owner-stable-01',
    coordinate: {
      platformId: PLATFORM_ID,
      organizationId,
      workspaceId: SHARED_WORKSPACE_ID,
      siteId: SHARED_SITE_ID,
    },
    state: 'active',
    generation: 4,
    transferId: null,
    transferLockId: null,
    transferFence: null,
    createdAt: '2026-07-25T12:00:00.000Z',
    updatedAt: '2026-07-25T12:05:00.000Z',
    ...changes,
  }
}

function authority(
  value: unknown | null,
  seen: FumaRepositoryScopeCoordinate[] = [],
): FumaRepositoryScopeOwnerKeyAuthority {
  return {
    async loadOwnerKey(coordinate) {
      seen.push(coordinate)
      return value
    },
  }
}

async function denied(run: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await run
  } catch (error) {
    expect(error).toBeInstanceOf(FumaRepositoryScopeResolutionError)
    if (!(error instanceof FumaRepositoryScopeResolutionError)) throw error
    return { name: error.name, code: error.code, message: error.message }
  }
  throw new Error('Expected repository-scope derivation to deny')
}

const UNIFORM_DENIAL = {
  name: 'FumaRepositoryScopeResolutionError',
  code: 'denied',
  message: 'Repository scope authority denied.',
}

function derive(
  trustedContext: FumaTrustedContext,
  owner: unknown | null,
) {
  return deriveFumaRepositoryScope({
    trustedContext,
    ownerKeys: authority(owner),
  })
}

describe('FUMA-025 trusted repository scope', () => {
  it('derives every repository predicate from an immutable trusted request context', async () => {
    const seen: FumaRepositoryScopeCoordinate[] = []
    const context = requestContext()
    const scope = await deriveFumaRepositoryScope({
      trustedContext: { kind: 'request', context },
      ownerKeys: authority(ownerKey(), seen),
    })

    expect(seen).toEqual([{
      platformId: PLATFORM_ID,
      organizationId: ORGANIZATION_A,
      workspaceId: SHARED_WORKSPACE_ID,
      siteId: SHARED_SITE_ID,
    }])
    expect(Object.keys(seen[0]!)).toEqual([
      'platformId',
      'organizationId',
      'workspaceId',
      'siteId',
    ])
    expect(Object.isFrozen(seen[0])).toBe(true)
    expect(scope).toEqual({
      platformId: PLATFORM_ID,
      organizationId: ORGANIZATION_A,
      workspaceId: SHARED_WORKSPACE_ID,
      siteId: SHARED_SITE_ID,
      ownerKey: 'owner-stable-01',
      state: 'active',
      generation: 4,
      transferFence: null,
    })
    expect(Value.Check(FumaRepositoryScopeSchema, scope)).toBe(true)
  })

  it('derives the same exact scope from a trusted site-job context', async () => {
    const scope = await derive(
      { kind: 'job', context: siteJobContext() },
      ownerKey(),
    )

    expect(scope).toMatchObject({
      platformId: PLATFORM_ID,
      organizationId: ORGANIZATION_A,
      workspaceId: SHARED_WORKSPACE_ID,
      siteId: SHARED_SITE_ID,
      ownerKey: 'owner-stable-01',
    })
  })

  it('rejects an organization job before owner-key lookup instead of inventing site scope', async () => {
    const seen: FumaRepositoryScopeCoordinate[] = []
    expect(await denied(deriveFumaRepositoryScope({
      trustedContext: { kind: 'job', context: organizationJobContext() },
      ownerKeys: authority(ownerKey(), seen),
    }))).toEqual(UNIFORM_DENIAL)
    expect(seen).toEqual([])
  })

  it('denies cross-organization substitution despite colliding workspace and site IDs', async () => {
    const tenantB = requestContext(ORGANIZATION_B)
    const tenantAOwner = ownerKey(ORGANIZATION_A)

    expect(tenantB.scope.workspace.id).toBe(tenantAOwner.coordinate.workspaceId)
    expect(tenantB.scope.site.id).toBe(tenantAOwner.coordinate.siteId)
    expect(await denied(derive(
      { kind: 'request', context: tenantB },
      tenantAOwner,
    ))).toEqual(UNIFORM_DENIAL)
  })

  it('carries the stable owner generation and active transfer fence', async () => {
    const transferring = ownerKey(ORGANIZATION_A, {
      state: 'transferring',
      generation: 9,
      transferId: 'transfer-01',
      transferLockId: 'lock-01',
      transferFence: 12,
    })
    const scope = await derive(
      { kind: 'request', context: requestContext() },
      transferring,
    )

    expect(scope).toMatchObject({
      ownerKey: 'owner-stable-01',
      state: 'transferring',
      generation: 9,
      transferFence: 12,
    })
  })

  it('uniformly denies absent, malformed, inconsistent, and failing owner authority', async () => {
    const trustedContext = { kind: 'request', context: requestContext() } as const
    const invalidOwners = [
      null,
      { ...ownerKey(), unexpected: true },
      ownerKey(ORGANIZATION_A, { generation: 0 }),
      ownerKey(ORGANIZATION_A, { transferFence: 1 }),
    ]
    for (const invalidOwner of invalidOwners) {
      expect(await denied(derive(trustedContext, invalidOwner))).toEqual(UNIFORM_DENIAL)
    }

    expect(await denied(deriveFumaRepositoryScope({
      trustedContext,
      ownerKeys: {
        async loadOwnerKey() {
          throw new Error('database detail must not escape')
        },
      },
    }))).toEqual(UNIFORM_DENIAL)
  })

  it('requires the immutable authority snapshots produced by trusted context derivation', async () => {
    const mutableReplay = structuredClone(requestContext())
    const seen: FumaRepositoryScopeCoordinate[] = []

    expect(await denied(deriveFumaRepositoryScope({
      trustedContext: { kind: 'request', context: mutableReplay },
      ownerKeys: authority(ownerKey(), seen),
    }))).toEqual(UNIFORM_DENIAL)
    expect(seen).toEqual([])
  })

  it('returns a detached deeply immutable scope with a strict TypeBox shape', async () => {
    const callerOwner = ownerKey()
    const scope = await derive(
      { kind: 'request', context: requestContext() },
      callerOwner,
    )

    expect(Object.isFrozen(scope)).toBe(true)
    expect(Object.isFrozen(callerOwner)).toBe(false)
    callerOwner.ownerKey = 'owner-mutated'
    callerOwner.generation = 99
    expect(scope.ownerKey).toBe('owner-stable-01')
    expect(scope.generation).toBe(4)

    expect(Value.Check(FumaRepositoryScopeSchema, {
      ...scope,
      routeSiteId: 'caller-claimed-site',
    })).toBe(false)
    expect(Value.Check(FumaRepositoryScopeSchema, {
      ...scope,
      transferFence: 1,
    })).toBe(false)
    expect(Value.Check(FumaRepositoryScopeSchema, {
      ...scope,
      state: 'transferring',
    })).toBe(false)
    const { ownerKey: _ownerKey, ...withoutOwnerKey } = scope
    expect(Value.Check(FumaRepositoryScopeSchema, withoutOwnerKey)).toBe(false)
  })
})

import { describe, expect, it } from 'bun:test'
import type { FumaJobRecord } from '../../../server/fuma/jobs'
import {
  FumaJobContextResolutionError,
  deriveFumaJobContext,
  type FumaJobContextAuthority,
  type FumaOrganizationJobAuthority,
  type FumaSiteJobAuthority,
} from '../../../server/fuma/context'

const PLATFORM_ID = 'platform-fuma'
const PLATFORM_ORGANIZATION_ID = 'organization-platform'
const ORGANIZATION_A = 'organization-a'
const ORGANIZATION_B = 'organization-b'
const SHARED_WORKSPACE_ID = 'workspace-collision'
const SHARED_SITE_ID = 'site-collision'
const JOB_ID = 'job-publish-01'
const NOW = new Date('2026-07-25T05:01:00.000Z')

function job(
  changes: Partial<FumaJobRecord> = {},
): FumaJobRecord {
  return {
    id: JOB_ID,
    organizationId: ORGANIZATION_A,
    siteId: SHARED_SITE_ID,
    kind: 'website.publish',
    payload: {
      actor: { kind: 'staff', userId: 'attacker' },
      organizationId: ORGANIZATION_B,
      siteId: 'site-attacker',
      profileId: 'publication',
      capabilities: ['publication.editorial'],
      permissions: ['site.delete'],
      requestId: 'request-payload-spoof',
    },
    status: 'running',
    priority: 0,
    organizationWeight: 1,
    siteWeight: 1,
    maxAttempts: 5,
    attemptCount: 1,
    runAt: '2026-07-25T05:00:00.000Z',
    claimedBy: 'worker-01',
    claimExpiresAt: '2026-07-25T05:05:00.000Z',
    fence: '7',
    cancellationRequestedAt: null,
    idempotencyKey: null,
    result: null,
    error: null,
    createdAt: '2026-07-25T04:59:00.000Z',
    updatedAt: '2026-07-25T05:00:00.000Z',
    completedAt: null,
    ...changes,
  }
}

function siteAuthority(
  organizationId = ORGANIZATION_A,
  profileId: 'website' | 'publication' = 'website',
): FumaSiteJobAuthority {
  const binding = {
    platformId: PLATFORM_ID,
    organizationId,
    workspaceId: SHARED_WORKSPACE_ID,
    siteId: SHARED_SITE_ID,
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
        profileId,
        status: 'active',
      },
      profile: {
        ...binding,
        id: profileId,
        status: 'active',
      },
      capabilities: {
        ...binding,
        profileId,
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

function siteAuthoritySubstitutions(
  tenantA: FumaSiteJobAuthority,
  tenantB: FumaSiteJobAuthority,
): readonly [string, FumaSiteJobAuthority][] {
  const substitutions: Array<[
    string,
    keyof FumaSiteJobAuthority['authorization'],
  ]> = [
    ['organization', 'organization'],
    ['workspace', 'workspace'],
    ['site', 'site'],
    ['profile', 'profile'],
    ['capabilities', 'capabilities'],
    ['permissions', 'permissions'],
  ]
  return substitutions.map(([label, key]) => {
    const replay = structuredClone(tenantA)
    Object.assign(replay.authorization, {
      [key]: structuredClone(tenantB.authorization[key]),
    })
    return [label, replay] as const
  })
}

function organizationAuthority(): FumaOrganizationJobAuthority {
  return {
    kind: 'organization',
    originatingRequestId: 'request-enqueue-org-01',
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

function authority(
  value: unknown | null,
  seen: Parameters<FumaJobContextAuthority['loadTrustedJobAuthority']>[0][] = [],
): FumaJobContextAuthority {
  return {
    async loadTrustedJobAuthority(input) {
      seen.push(input)
      return value
    },
  }
}

function derive(
  jobRecord: unknown,
  authorityValue: unknown | null,
) {
  return deriveFumaJobContext({
    jobRecord,
    authority: authority(authorityValue),
    now: () => NOW,
  })
}

const UNIFORM_DENIAL = {
  name: 'FumaJobContextResolutionError',
  code: 'denied',
  message: 'Internal job authority denied.',
}

async function denied(run: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await run
  } catch (error) {
    expect(error).toBeInstanceOf(FumaJobContextResolutionError)
    if (!(error instanceof FumaJobContextResolutionError)) throw error
    return {
      name: error.name,
      code: error.code,
      message: error.message,
    }
  }
  throw new Error('Expected trusted job-context derivation to deny')
}

describe('FUMA-021 trusted internal-job context derivation', () => {
  it('ignores payload actor, tenant, profile, capability, permission, and request claims', async () => {
    const seen: Parameters<FumaJobContextAuthority['loadTrustedJobAuthority']>[0][] = []
    const record = job()
    const context = await deriveFumaJobContext({
      jobRecord: record,
      authority: authority(siteAuthority(), seen),
      now: () => NOW,
    })

    expect(seen).toEqual([{
      jobId: JOB_ID,
      organizationId: ORGANIZATION_A,
      siteId: SHARED_SITE_ID,
      jobKind: 'website.publish',
    }])
    expect(Object.keys(seen[0]!)).not.toContain('payload')
    expect(context).toMatchObject({
      kind: 'site',
      originatingRequestId: 'request-enqueue-01',
      actor: {
        kind: 'internal-job',
        jobId: JOB_ID,
        runId: `${JOB_ID}:run:7`,
      },
      scope: {
        organization: { id: ORGANIZATION_A },
        site: { id: SHARED_SITE_ID, profileId: 'website' },
      },
      profile: { id: 'website' },
      requiredPermission: 'content.pages.write',
    })
    if (context.kind !== 'site') throw new Error('Expected a site job context')
    expect(context.capabilities).not.toContain('publication.editorial')
    expect(context.permissions.allow).toContain('content.pages.write')
  })

  it('uniformly denies cross-tenant authority despite colliding workspace and site IDs', async () => {
    const replay = siteAuthority(ORGANIZATION_B, 'publication')
    expect(replay.authorization.workspace.id).toBe(SHARED_WORKSPACE_ID)
    expect(replay.authorization.site.id).toBe(SHARED_SITE_ID)

    expect(await denied(derive(job(), replay))).toEqual(UNIFORM_DENIAL)
    expect(await denied(derive(job(), null))).toEqual(UNIFORM_DENIAL)
  })

  it('denies every Site B authority component replayed into Site A', async () => {
    const tenantA = siteAuthority(ORGANIZATION_A, 'website')
    const tenantB = siteAuthority(ORGANIZATION_B, 'publication')

    for (const [component, replay] of siteAuthoritySubstitutions(tenantA, tenantB)) {
      expect(await denied(derive(job(), replay)), component).toEqual(UNIFORM_DENIAL)
    }
  })

  it('denies expired, incomplete, over-attempted, and non-canonical durable claims before lookup', async () => {
    const invalidClaims = [
      job({ claimExpiresAt: NOW.toISOString() }),
      job({ claimedBy: '   ' }),
      job({ attemptCount: 6, maxAttempts: 5 }),
      job({ fence: '007' }),
      job({ completedAt: '2026-07-25T05:00:30.000Z' }),
    ]

    for (const record of invalidClaims) {
      const seen: Parameters<FumaJobContextAuthority['loadTrustedJobAuthority']>[0][] = []
      expect(await denied(deriveFumaJobContext({
        jobRecord: record,
        authority: authority(siteAuthority(), seen),
        now: () => NOW,
      }))).toEqual(UNIFORM_DENIAL)
      expect(seen).toEqual([])
    }
  })

  it('denies a registered job when its contributing capability is disabled', async () => {
    const record = job({
      kind: 'publication.publish-due',
    })
    const unavailable = siteAuthority(ORGANIZATION_A, 'publication')
    unavailable.authorization.capabilities.overrides.revoke.push(
      'publication.editorial.schedule',
    )

    expect(await denied(derive(record, unavailable))).toEqual(UNIFORM_DENIAL)
  })

  it('denies when FUMA-020 does not grant the job contribution permission', async () => {
    const deniedAuthority = siteAuthority()
    deniedAuthority.authorization.permissions.roleAssignments[0]!.role = {
      kind: 'launch-persona',
      persona: 'viewer',
    }

    expect(await denied(derive(job(), deniedAuthority))).toEqual(UNIFORM_DENIAL)
  })

  it('returns a detached deeply immutable authority snapshot', async () => {
    const callerJob = job()
    const callerAuthority = siteAuthority()
    const context = await derive(callerJob, callerAuthority)
    if (context.kind !== 'site') throw new Error('Expected a site job context')

    expect(Object.isFrozen(context)).toBe(true)
    expect(Object.isFrozen(context.source)).toBe(true)
    expect(Object.isFrozen(context.actor)).toBe(true)
    expect(Object.isFrozen(context.scope)).toBe(true)
    expect(Object.isFrozen(context.scope.site)).toBe(true)
    expect(Object.isFrozen(context.profile)).toBe(true)
    expect(Object.isFrozen(context.capabilities)).toBe(true)
    expect(Object.isFrozen(context.permissions)).toBe(true)
    expect(Object.isFrozen(context.permissions.allow)).toBe(true)

    expect(Object.isFrozen(callerJob)).toBe(false)
    expect(Object.isFrozen(callerJob.payload)).toBe(false)
    expect(Object.isFrozen(callerAuthority)).toBe(false)
    expect(Object.isFrozen(callerAuthority.authorization)).toBe(false)
    expect(Object.isFrozen(callerAuthority.authorization.capabilities)).toBe(false)

    callerAuthority.authorization.site.profileId = 'publication'
    callerAuthority.authorization.permissions.roleAssignments.length = 0
    expect(context.profile.id).toBe('website')
    expect(context.permissions.allow).toContain('content.pages.write')
  })

  it('uses deterministic per-claim IDs while preserving only trusted request-to-job correlation', async () => {
    const first = await derive(job(), siteAuthority())
    const repeat = await derive(job(), siteAuthority())
    const nextClaim = await derive(job({ fence: '8', attemptCount: 2 }), siteAuthority())

    expect(first.requestId).toBe(`${JOB_ID}:request:7`)
    expect(first.source.correlationId).toBe(first.requestId)
    expect(first.source.runId).toBe(`${JOB_ID}:run:7`)
    expect(first.originatingRequestId).toBe('request-enqueue-01')
    expect(repeat.requestId).toBe(first.requestId)
    expect(nextClaim.requestId).toBe(`${JOB_ID}:request:8`)
    expect(nextClaim.source.runId).toBe(`${JOB_ID}:run:8`)
    expect(nextClaim.originatingRequestId).not.toBe('request-payload-spoof')
  })

  it('gives organization-only jobs a bounded scope without fabricated site authority', async () => {
    const context = await derive(job({
      siteId: null,
      kind: 'organization.reconcile',
    }), organizationAuthority())

    expect(context).toMatchObject({
      kind: 'organization',
      scope: {
        platform: { id: PLATFORM_ID },
        organization: { id: ORGANIZATION_A },
      },
      requiredPermission: 'organization.read',
    })
    expect(context.permissions.allow).toContain('organization.read')
    expect('site' in context.scope).toBe(false)
    expect('profile' in context).toBe(false)
    expect('capabilities' in context).toBe(false)
  })
})

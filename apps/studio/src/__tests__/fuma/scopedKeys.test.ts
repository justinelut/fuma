import { describe, expect, it } from 'bun:test'
import { freezeFumaRequestContext } from '../../../server/fuma/context'
import {
  FumaScopedObjectKeyResolutionError,
  createFumaScopedObjectKeyFactory,
} from '../../../server/fuma/objectStorage'
import { FumaRedisKeyspace } from '../../../server/fuma/redis'
import {
  FumaScopedKeyResolutionError,
  createFumaScopedKeyFactory,
} from '../../../server/fuma/runtime/scopedKeys'
import type { FumaRepositoryScope } from '../../../server/fuma/tenancy'

const PLATFORM_ID = 'platform-fuma'
const WORKSPACE_ID = 'workspace-shared'
const SITE_ID = 'site-shared'

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

type CoordinateChanges = Readonly<Partial<{
  platformId: string
  workspaceId: string
  siteId: string
  profileId: string
}>>

function requestContext(
  organizationId: string,
  capabilityId = 'site.home',
  coordinate: CoordinateChanges = {},
) {
  const platformId = coordinate.platformId ?? PLATFORM_ID
  const workspaceId = coordinate.workspaceId ?? WORKSPACE_ID
  const siteId = coordinate.siteId ?? SITE_ID
  const profileId = coordinate.profileId ?? 'website'
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
      platform: { id: platformId, status: 'active' },
      organization: {
        id: organizationId,
        platformId,
        status: 'active',
      },
      workspace: {
        id: workspaceId,
        platformId,
        organizationId,
        status: 'active',
      },
      site: {
        id: siteId,
        platformId,
        organizationId,
        workspaceId,
        profileId,
        status: 'active',
      },
    },
    profile: { id: profileId, status: 'active' },
    capabilities: [capabilityId],
    permissions: {
      subjectId: 'staff-01',
      allow: ['site.home.read'],
      deny: [],
    },
  })
}

function repositoryScope(
  organizationId: string,
  changes: Partial<FumaRepositoryScope> = {},
  coordinate: CoordinateChanges = {},
): FumaRepositoryScope {
  return deepFreeze({
    platformId: coordinate.platformId ?? PLATFORM_ID,
    organizationId,
    workspaceId: coordinate.workspaceId ?? WORKSPACE_ID,
    siteId: coordinate.siteId ?? SITE_ID,
    ownerKey: `owner-${organizationId}`,
    generation: 4,
    state: 'active' as const,
    transferFence: null,
    ...changes,
  })
}

function coordinationFactory(
  organizationId: string,
  changes: Readonly<{
    scope?: FumaRepositoryScope
    capabilityId?: string
    contextCapabilityId?: string
    coordinate?: CoordinateChanges
    version?: number
  }> = {},
) {
  return createFumaScopedKeyFactory({
    trustedContext: {
      kind: 'request',
      context: requestContext(
        organizationId,
        changes.contextCapabilityId ?? changes.capabilityId ?? 'site.home',
        changes.coordinate,
      ),
    },
    repositoryScope: changes.scope
      ?? repositoryScope(organizationId, {}, changes.coordinate),
    capabilityId: changes.capabilityId ?? 'site.home',
    version: changes.version ?? 7,
  })
}

describe('FUMA-026 scoped coordination and object keys', () => {
  it('creates deterministic, kind-separated keys from every authority dimension', () => {
    const first = coordinationFactory('organization-a')
    const repeated = coordinationFactory('organization-a')

    expect(first.cache('pages/shared')).toBe(repeated.cache('pages/shared'))
    expect(new Set([
      first.cache('pages/shared'),
      first.pubsub('pages/shared'),
      first.lock('pages/shared'),
    ]).size).toBe(3)

    const variants = [
      coordinationFactory('organization-a', {
        coordinate: { platformId: 'platform-other' },
      }),
      coordinationFactory('organization-b'),
      coordinationFactory('organization-a', {
        coordinate: { workspaceId: 'workspace-other' },
      }),
      coordinationFactory('organization-a', {
        coordinate: { siteId: 'site-other' },
      }),
      coordinationFactory('organization-a', {
        scope: repositoryScope('organization-a', { ownerKey: 'owner-replaced' }),
      }),
      coordinationFactory('organization-a', {
        scope: repositoryScope('organization-a', { generation: 5 }),
      }),
      coordinationFactory('organization-a', {
        coordinate: { profileId: 'publication' },
      }),
      coordinationFactory('organization-a', {
        capabilityId: 'publication.editorial',
      }),
      coordinationFactory('organization-a', { version: 8 }),
    ]
    for (const variant of variants) {
      expect(variant.cache('pages/shared')).not.toBe(first.cache('pages/shared'))
    }
    expect(first.cache('pages/shared')).toStartWith('fuma-scope:v1:')

    const redis = new FumaRedisKeyspace('hosted')
    const firstPhysical = {
      cache: redis.key('cache', first.cache('pages/shared')),
      pubsub: redis.channel(first.pubsub('pages/shared')),
      lock: redis.lease(first.lock('pages/shared')).leaseKey,
    }
    const foreign = coordinationFactory('organization-b')
    expect(firstPhysical.cache).toStartWith('fuma:v1:hosted:cache:')
    expect(firstPhysical.pubsub).toStartWith('fuma:v1:hosted:pubsub:')
    expect(firstPhysical.lock).toStartWith('fuma:v1:hosted:leases:')
    expect(firstPhysical.cache).not.toBe(
      redis.key('cache', foreign.cache('pages/shared')),
    )
    expect(firstPhysical.pubsub).not.toBe(
      redis.channel(foreign.pubsub('pages/shared')),
    )
    expect(firstPhysical.lock).not.toBe(
      redis.lease(foreign.lock('pages/shared')).leaseKey,
    )

    expect(first.authority).toEqual({
      platformId: PLATFORM_ID,
      organizationId: 'organization-a',
      workspaceId: WORKSPACE_ID,
      siteId: SITE_ID,
      ownerKey: 'owner-organization-a',
      generation: 4,
      profileId: 'website',
      capabilityId: 'site.home',
      version: 7,
    })
  })

  it('fails closed on cross-tenant scope substitution and ungranted capability', () => {
    expect(() => createFumaScopedKeyFactory({
      trustedContext: {
        kind: 'request',
        context: requestContext('organization-a'),
      },
      repositoryScope: repositoryScope('organization-b'),
      capabilityId: 'site.home',
      version: 1,
    })).toThrow(FumaScopedKeyResolutionError)

    expect(() => coordinationFactory('organization-a', {
      capabilityId: 'publication.editorial',
      contextCapabilityId: 'site.home',
    })).toThrow(FumaScopedKeyResolutionError)
  })

  it('cannot mint coordination or object keys from transferring owner authority', () => {
    const transferringScope = repositoryScope('organization-a', {
      state: 'transferring',
      transferFence: 41,
    })
    const coordinationAttempts = [
      () => createFumaScopedKeyFactory({
        trustedContext: {
          kind: 'request',
          context: requestContext('organization-a'),
        },
        repositoryScope: transferringScope,
        capabilityId: 'site.home',
        version: 1,
      }).cache('pages/shared'),
      () => createFumaScopedKeyFactory({
        trustedContext: {
          kind: 'request',
          context: requestContext('organization-a'),
        },
        repositoryScope: transferringScope,
        capabilityId: 'site.home',
        version: 1,
      }).pubsub('pages/shared'),
      () => createFumaScopedKeyFactory({
        trustedContext: {
          kind: 'request',
          context: requestContext('organization-a'),
        },
        repositoryScope: transferringScope,
        capabilityId: 'site.home',
        version: 1,
      }).lock('pages/shared'),
    ]

    for (const attempt of coordinationAttempts) {
      expect(attempt).toThrow(FumaScopedKeyResolutionError)
    }
    expect(() => (
      createFumaScopedObjectKeyFactory(transferringScope)
        .physicalKey('media/shared/logo.png')
    )).toThrow(FumaScopedObjectKeyResolutionError)
  })

  it('fails closed on malformed authority and traversal-like resources', () => {
    const mutableScope = {
      ...repositoryScope('organization-a'),
      organizationId: 'organization-a',
    }
    expect(() => createFumaScopedKeyFactory({
      trustedContext: {
        kind: 'request',
        context: requestContext('organization-a'),
      },
      repositoryScope: mutableScope,
      capabilityId: 'site.home',
      version: 1,
    })).toThrow(FumaScopedKeyResolutionError)

    const keys = coordinationFactory('organization-a')
    for (const resource of [
      '../secret',
      'safe/../../secret',
      '/absolute',
      'trailing/',
      'double//segment',
      'encoded/%2e%2e/secret',
      'backslash\\secret',
    ]) {
      expect(() => keys.cache(resource)).toThrow(FumaScopedKeyResolutionError)
      expect(() => keys.pubsub(resource)).toThrow(FumaScopedKeyResolutionError)
      expect(() => keys.lock(resource)).toThrow(FumaScopedKeyResolutionError)
    }
  })

  it('binds object keys to the established tenant prefix and rejects foreign prefixes', () => {
    const alpha = createFumaScopedObjectKeyFactory(repositoryScope('organization-a'))
    const beta = createFumaScopedObjectKeyFactory(repositoryScope('organization-b'))
    const alphaPhysical = alpha.physicalKey('media/shared/logo.png')
    const betaPhysical = beta.physicalKey('media/shared/logo.png')

    expect(alpha.prefix).toBe(
      'organizations/organization-a/workspaces/workspace-shared/sites/site-shared/objects/',
    )
    expect(alphaPhysical).not.toBe(betaPhysical)
    expect(alpha.logicalKey(alphaPhysical)).toBe('media/shared/logo.png')
    expect(() => alpha.logicalKey(betaPhysical)).toThrow()
    expect(() => alpha.physicalKey('../foreign.txt')).toThrow()
  })

  it('rejects malformed or mutable repository authority at the object boundary', () => {
    expect(() => createFumaScopedObjectKeyFactory({
      ...repositoryScope('organization-a'),
      organizationId: '../organization-b',
    })).toThrow(FumaScopedObjectKeyResolutionError)
    expect(() => createFumaScopedObjectKeyFactory({
      ...repositoryScope('organization-a'),
    })).toThrow(FumaScopedObjectKeyResolutionError)
  })
})

import { describe, expect, it } from 'bun:test'
import type { PluginPermission } from '@core/plugin-sdk'
import {
  freezeFumaRequestContext,
  type FumaTrustedContext,
} from '../../../server/fuma/context'
import {
  FumaHostedPluginCallBoundaryError,
  bindFumaHostedPluginCalls,
  createLegacySelfHostPluginCallBoundary,
  type FumaHostedPluginCallDispatcher,
  type FumaHostedPluginDispatchCall,
} from '../../../server/fuma/plugins'
import type {
  FumaRepositoryScopeCoordinate,
  FumaRepositoryScopeOwnerKeyAuthority,
  TenantOwnerKeyRecord,
} from '../../../server/fuma/tenancy'

const PLATFORM_ID = 'platform-fuma'
const ORGANIZATION_ID = 'organization-a'
const WORKSPACE_ID = 'workspace-a'
const SITE_ID = 'site-a'
const GRANTED_PERMISSIONS = [
  'cms.content.read',
  'cms.content.publish',
] satisfies readonly PluginPermission[]

function requestContext(
  capabilities: readonly string[] = ['website.content', 'content.pages'],
): FumaTrustedContext {
  return {
    kind: 'request',
    context: freezeFumaRequestContext({
      requestId: 'request-plugin-01',
      source: {
        kind: 'staff-session',
        correlationId: 'correlation-plugin-01',
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
          id: ORGANIZATION_ID,
          platformId: PLATFORM_ID,
          status: 'active',
        },
        workspace: {
          id: WORKSPACE_ID,
          platformId: PLATFORM_ID,
          organizationId: ORGANIZATION_ID,
          status: 'active',
        },
        site: {
          id: SITE_ID,
          platformId: PLATFORM_ID,
          organizationId: ORGANIZATION_ID,
          workspaceId: WORKSPACE_ID,
          profileId: 'website',
          status: 'active',
        },
      },
      profile: { id: 'website', status: 'active' },
      capabilities: [...capabilities],
      permissions: {
        subjectId: 'staff-01',
        allow: ['website.content.read', 'content.pages.read'],
        deny: [],
      },
    }),
  }
}

function ownerKey(changes: Partial<TenantOwnerKeyRecord> = {}): TenantOwnerKeyRecord {
  return {
    ownerKey: 'owner-stable-a',
    coordinate: {
      platformId: PLATFORM_ID,
      organizationId: ORGANIZATION_ID,
      workspaceId: WORKSPACE_ID,
      siteId: SITE_ID,
    },
    state: 'active',
    generation: 7,
    transferId: null,
    transferLockId: null,
    transferFence: null,
    createdAt: '2026-07-25T12:00:00.000Z',
    updatedAt: '2026-07-25T12:05:00.000Z',
    ...changes,
  }
}

class MutableOwnerAuthority implements FumaRepositoryScopeOwnerKeyAuthority {
  current: unknown | null = ownerKey()
  seen: FumaRepositoryScopeCoordinate[] = []

  loadOwnerKey(coordinate: FumaRepositoryScopeCoordinate): Promise<unknown | null> {
    this.seen.push(coordinate)
    return Promise.resolve(this.current)
  }
}

class RecordingDispatcher implements FumaHostedPluginCallDispatcher {
  calls: FumaHostedPluginDispatchCall[] = []

  dispatch(call: FumaHostedPluginDispatchCall): Promise<unknown> {
    this.calls.push(call)
    return Promise.resolve({
      kind: call.kind,
      target: call.target,
      organizationId: call.authority.repositoryScope.organizationId,
    })
  }
}

const REQUIREMENTS = [
  {
    kind: 'persistence' as const,
    target: 'cms.content.read',
    requiredCapabilities: ['website.content'],
    requiredPluginPermissions: ['cms.content.read'] as const,
  },
  {
    kind: 'rpc' as const,
    target: 'cms.page.publish',
    requiredCapabilities: ['content.pages'],
    requiredPluginPermissions: ['cms.content.publish'] as const,
  },
]

async function harness(input: Readonly<{
  capabilities?: readonly string[]
  grantedPermissions?: readonly PluginPermission[]
}> = {}) {
  const ownerKeys = new MutableOwnerAuthority()
  const persistence = new RecordingDispatcher()
  const rpc = new RecordingDispatcher()
  const boundary = await bindFumaHostedPluginCalls({
    pluginId: 'plugin.example',
    trustedContext: requestContext(input.capabilities),
    ownerKeys,
    grantedPermissions: input.grantedPermissions ?? GRANTED_PERMISSIONS,
    requirements: REQUIREMENTS,
    persistence,
    rpc,
  })
  return { boundary, ownerKeys, persistence, rpc }
}

async function expectDenied(run: Promise<unknown>): Promise<void> {
  try {
    await run
  } catch (error) {
    expect(error).toBeInstanceOf(FumaHostedPluginCallBoundaryError)
    expect(error).toMatchObject({
      code: 'denied',
      message: 'Hosted plugin call denied.',
    })
    return
  }
  throw new Error('Expected hosted plugin call to be denied.')
}

async function expectInvalid(run: Promise<unknown>): Promise<void> {
  try {
    await run
  } catch (error) {
    expect(error).toBeInstanceOf(FumaHostedPluginCallBoundaryError)
    expect(error).toMatchObject({
      code: 'invalid-call',
      message: 'Hosted plugin call is invalid.',
    })
    return
  }
  throw new Error('Expected hosted plugin call to be invalid.')
}

describe('FUMA-026 hosted plugin call boundary', () => {
  it('dispatches with one immutable scope, capability, and plugin-grant snapshot', async () => {
    const { boundary, ownerKeys, persistence, rpc } = await harness()

    expect(await boundary.call({
      kind: 'persistence',
      target: 'cms.content.read',
      payload: { rowId: 'row-shared' },
    })).toEqual({
      kind: 'persistence',
      target: 'cms.content.read',
      organizationId: ORGANIZATION_ID,
    })
    expect(await boundary.call({
      kind: 'rpc',
      target: 'cms.page.publish',
      payload: { pageId: 'page-shared' },
    })).toEqual({
      kind: 'rpc',
      target: 'cms.page.publish',
      organizationId: ORGANIZATION_ID,
    })

    expect(ownerKeys.seen).toHaveLength(3)
    expect(persistence.calls).toHaveLength(1)
    expect(rpc.calls).toHaveLength(1)
    for (const call of [...persistence.calls, ...rpc.calls]) {
      expect(call.authority).toBe(boundary.authority)
      expect(call.authority.repositoryScope).toEqual({
        platformId: PLATFORM_ID,
        organizationId: ORGANIZATION_ID,
        workspaceId: WORKSPACE_ID,
        siteId: SITE_ID,
        ownerKey: 'owner-stable-a',
        state: 'active',
        generation: 7,
        transferFence: null,
      })
      expect(call.authority.grantedCapabilities).toEqual([
        'website.content',
        'content.pages',
      ])
      expect(call.authority.grantedPermissions).toEqual(GRANTED_PERMISSIONS)
      expect(Object.isFrozen(call)).toBe(true)
      expect(Object.isFrozen(call.authority)).toBe(true)
      expect(Object.isFrozen(call.authority.repositoryScope)).toBe(true)
      expect(Object.isFrozen(call.authority.grantedCapabilities)).toBe(true)
      expect(Object.isFrozen(call.authority.grantedPermissions)).toBe(true)
      expect(Object.isFrozen(call.payload)).toBe(true)
    }
  })

  it('requires site capabilities and operator-approved plugin grants independently', async () => {
    const siteDenied = await harness({ capabilities: ['website.content'] })
    await expectDenied(siteDenied.boundary.call({
      kind: 'rpc',
      target: 'cms.page.publish',
      payload: null,
    }))
    await expectDenied(siteDenied.boundary.call({
      kind: 'rpc',
      target: 'cms.unknown',
      payload: null,
    }))
    expect(siteDenied.persistence.calls).toHaveLength(0)
    expect(siteDenied.rpc.calls).toHaveLength(0)

    const grantDenied = await harness({
      grantedPermissions: ['cms.content.read'],
    })
    await expectDenied(grantDenied.boundary.call({
      kind: 'rpc',
      target: 'cms.page.publish',
      payload: null,
    }))
    expect(grantDenied.persistence.calls).toHaveLength(0)
    expect(grantDenied.rpc.calls).toHaveLength(0)
  })

  it('rejects missing and undeclared plugin grant authority at bind time', async () => {
    const ownerKeys = new MutableOwnerAuthority()
    const dispatcher = new RecordingDispatcher()
    const base = {
      pluginId: 'plugin.example',
      trustedContext: requestContext(),
      ownerKeys,
      requirements: REQUIREMENTS,
      persistence: dispatcher,
      rpc: dispatcher,
    }

    await expectInvalid(bindFumaHostedPluginCalls(base as never))
    await expectInvalid(bindFumaHostedPluginCalls({
      ...base,
      grantedPermissions: ['cms.database.drop'],
    } as never))
    await expectInvalid(bindFumaHostedPluginCalls({
      ...base,
      grantedPermissions: GRANTED_PERMISSIONS,
      requirements: [{
        kind: 'rpc',
        target: 'cms.page.publish',
        requiredCapabilities: ['content.pages'],
        requiredPluginPermissions: ['cms.database.drop'],
      }],
    } as never))
    expect(dispatcher.calls).toHaveLength(0)
  })

  it('rejects nested normalized owner, tenant, profile, capability, and grant substitution', async () => {
    const { boundary, persistence } = await harness()

    for (const payload of [
      { organizationId: 'organization-b' },
      { site_id: 'site-b' },
      { nested: { owner_key: 'owner-b' } },
      { nested: [{ 'repository-scope': boundary.authority.repositoryScope }] },
      { nested: { PROFILE_ID: 'publication' } },
      { nested: [{ GrAnTeD_CaPaBiLiTiEs: ['content.pages'] }] },
      { nested: { granted_permissions: ['cms.content.publish'] } },
      { nested: [{ 'required-plugin-permissions': ['cms.content.publish'] }] },
    ]) {
      await expectDenied(boundary.call({
        kind: 'persistence',
        target: 'cms.content.read',
        payload,
      }))
    }

    try {
      await boundary.call({
        kind: 'persistence',
        target: 'cms.content.read',
        payload: null,
        ownerKey: 'owner-b',
      })
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid-call' })
    }
    expect(persistence.calls).toHaveLength(0)
  })

  it('fails closed when payload traversal exceeds its depth bound', async () => {
    const { boundary, persistence } = await harness()
    let payload: unknown = { value: 'leaf' }
    for (let depth = 0; depth < 40; depth += 1) {
      payload = { nested: payload }
    }

    await expectDenied(boundary.call({
      kind: 'persistence',
      target: 'cms.content.read',
      payload,
    }))
    expect(persistence.calls).toHaveLength(0)
  })

  it('denies every later call when transfer state or owner generation makes the bound scope stale', async () => {
    const transferring = await harness()
    transferring.ownerKeys.current = ownerKey({
      state: 'transferring',
      generation: 8,
      transferId: 'transfer-01',
      transferLockId: 'lock-01',
      transferFence: 19,
    })
    await expectDenied(transferring.boundary.call({
      kind: 'persistence',
      target: 'cms.content.read',
      payload: null,
    }))
    expect(transferring.persistence.calls).toHaveLength(0)

    const completed = await harness()
    completed.ownerKeys.current = ownerKey({
      ownerKey: 'owner-after-transfer',
      generation: 9,
    })
    await expectDenied(completed.boundary.call({
      kind: 'rpc',
      target: 'cms.page.publish',
      payload: null,
    }))
    expect(completed.rpc.calls).toHaveLength(0)
  })

  it('rejects a transferring owner at initial bind and does not expose a boundary', async () => {
    const ownerKeys = new MutableOwnerAuthority()
    ownerKeys.current = ownerKey({
      state: 'transferring',
      generation: 8,
      transferId: 'transfer-01',
      transferLockId: 'lock-01',
      transferFence: 19,
    })
    const dispatcher = new RecordingDispatcher()

    await expectDenied(bindFumaHostedPluginCalls({
      pluginId: 'plugin.example',
      trustedContext: requestContext(),
      ownerKeys,
      grantedPermissions: GRANTED_PERMISSIONS,
      requirements: REQUIREMENTS,
      persistence: dispatcher,
      rpc: dispatcher,
    }))
    expect(dispatcher.calls).toHaveLength(0)
  })

  it('keeps legacy self-host calls as identity-preserving pass-throughs', async () => {
    const seen: object[] = []
    const legacy = createLegacySelfHostPluginCallBoundary(async (input: object) => {
      seen.push(input)
      return input
    })
    const call = {
      pluginId: 'legacy.plugin',
      target: 'cms.storage.list',
      callerSelectedLegacyValue: 'unchanged',
    }

    expect(await legacy.call(call)).toBe(call)
    expect(seen).toEqual([call])
    expect(Object.isFrozen(call)).toBe(false)
  })
})

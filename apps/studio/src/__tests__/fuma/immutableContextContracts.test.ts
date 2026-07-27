import { describe, expect, it } from 'bun:test'
import { Value } from '@core/utils/typeboxHelpers'
import {
  FumaActiveProfileSchema,
  FumaExactContextScopeSchema,
  FumaInternalJobActorSchema,
  FumaPermissionDecisionSummarySchema,
  FumaRequestContextSchema,
  FumaRequestSourceCorrelationSchema,
  FumaStaffActorSchema,
  FumaTrustedActorSchema,
  UntrustedFumaRouteScopeSchema,
  assertFumaRequestContext,
  assertUntrustedFumaRouteScope,
  cloneFumaRequestContext,
  freezeFumaRequestContext,
  type FumaInternalJobActor,
  type FumaInternalJobSourceCorrelation,
  type FumaRequestContext,
  type FumaStaffActor,
  type FumaStaffSourceCorrelation,
} from '../../../server/fuma/context/contracts'

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T

type StaffContextInput = Mutable<
  Omit<FumaRequestContext, 'actor' | 'source'> & {
    actor: FumaStaffActor
    source: FumaStaffSourceCorrelation
  }
>

type InternalJobContextInput = Mutable<
  Omit<FumaRequestContext, 'actor' | 'source'> & {
    actor: FumaInternalJobActor
    source: FumaInternalJobSourceCorrelation
  }
>

function contextInput(): StaffContextInput {
  return {
    requestId: 'request-01',
    source: {
      kind: 'staff-session',
      correlationId: 'correlation-01',
      userId: 'staff-effective',
      sessionId: 'session-01',
      impersonatedBy: 'staff-operator',
    },
    actor: {
      kind: 'staff',
      userId: 'staff-effective',
      sessionId: 'session-01',
      impersonator: { userId: 'staff-operator' },
    },
    scope: {
      platform: {
        id: 'platform-fuma',
        status: 'active',
      },
      organization: {
        id: 'organization-acme',
        platformId: 'platform-fuma',
        status: 'active',
      },
      workspace: {
        id: 'workspace-primary',
        platformId: 'platform-fuma',
        organizationId: 'organization-acme',
        status: 'active',
      },
      site: {
        id: 'site-main',
        platformId: 'platform-fuma',
        organizationId: 'organization-acme',
        workspaceId: 'workspace-primary',
        profileId: 'website',
        status: 'active',
      },
    },
    profile: {
      id: 'website',
      status: 'active',
    },
    capabilities: ['site.home', 'content.pages'],
    permissions: {
      subjectId: 'staff-effective',
      allow: ['site.home.read', 'content.pages.read'],
      deny: ['content.pages.write'],
    },
  }
}

function internalJobContextInput(): InternalJobContextInput {
  const input = contextInput()
  return {
    ...input,
    source: {
      kind: 'internal-job',
      correlationId: 'correlation-job-01',
      jobId: 'publication.publish-due',
      runId: 'run-01',
    },
    actor: {
      kind: 'internal-job',
      jobId: 'publication.publish-due',
      runId: 'run-01',
    },
    permissions: {
      ...input.permissions,
      subjectId: 'publication.publish-due',
    },
  }
}

function expectContextError(
  value: unknown,
  code: string,
  path?: string,
): void {
  try {
    assertFumaRequestContext(value)
  } catch (error) {
    expect(error).toMatchObject({
      name: 'FumaContextContractError',
      code,
      ...(path ? { path } : {}),
    })
    return
  }
  throw new Error(`Expected FumaContextContractError with code ${code}`)
}

describe('FUMA-021 immutable request-context contracts', () => {
  it('publishes strict TypeBox-derived contracts for both trusted actor sources', () => {
    const staff = contextInput()
    const job = internalJobContextInput()

    expect(Value.Check(FumaStaffActorSchema, staff.actor)).toBe(true)
    expect(Value.Check(FumaInternalJobActorSchema, job.actor)).toBe(true)
    expect(Value.Check(FumaTrustedActorSchema, staff.actor)).toBe(true)
    expect(Value.Check(FumaTrustedActorSchema, job.actor)).toBe(true)
    expect(Value.Check(FumaRequestSourceCorrelationSchema, staff.source)).toBe(true)
    expect(Value.Check(FumaRequestSourceCorrelationSchema, job.source)).toBe(true)
    expect(Value.Check(FumaExactContextScopeSchema, staff.scope)).toBe(true)
    expect(Value.Check(FumaActiveProfileSchema, staff.profile)).toBe(true)
    expect(Value.Check(FumaPermissionDecisionSummarySchema, staff.permissions)).toBe(true)
    expect(Value.Check(FumaRequestContextSchema, staff)).toBe(true)
    expect(Value.Check(FumaRequestContextSchema, job)).toBe(true)
    expect(() => assertFumaRequestContext(staff)).not.toThrow()
    expect(() => assertFumaRequestContext(job)).not.toThrow()
  })

  it('accepts an active extension profile with an empty capability composition', () => {
    const input = contextInput()
    input.capabilities = []
    input.permissions.allow = []
    input.permissions.deny = []

    expect(Value.Check(FumaRequestContextSchema, input)).toBe(true)
    expect(() => assertFumaRequestContext(input)).not.toThrow()
  })

  it('requires impersonation to be explicit and correlated with the trusted session', () => {
    const missingImpersonator = contextInput()
    const { impersonator: _impersonator, ...actorWithoutImpersonator } = missingImpersonator.actor
    expect(Value.Check(FumaStaffActorSchema, actorWithoutImpersonator)).toBe(false)

    const noImpersonation = contextInput()
    noImpersonation.actor.impersonator = null
    noImpersonation.source.impersonatedBy = null
    expect(() => assertFumaRequestContext(noImpersonation)).not.toThrow()

    const hiddenImpersonation = contextInput()
    hiddenImpersonation.actor.impersonator = null
    expectContextError(hiddenImpersonation, 'actor-source-mismatch', 'context.source')

    const selfImpersonation = contextInput()
    selfImpersonation.actor.impersonator = { userId: selfImpersonation.actor.userId }
    selfImpersonation.source.impersonatedBy = selfImpersonation.actor.userId
    expectContextError(
      selfImpersonation,
      'invalid-impersonation',
      'context.actor.impersonator.userId',
    )
  })

  it('keeps route scope untrusted, exact, and unable to carry authority claims', () => {
    const routeScope = {
      organizationId: 'organization-acme',
      workspaceId: 'workspace-primary',
      siteId: 'site-main',
    }
    expect(Value.Check(UntrustedFumaRouteScopeSchema, routeScope)).toBe(true)
    expect(() => assertUntrustedFumaRouteScope(routeScope)).not.toThrow()

    for (const authorityClaim of [
      { actor: contextInput().actor },
      { profile: contextInput().profile },
      { capabilities: contextInput().capabilities },
      { permissions: contextInput().permissions },
    ]) {
      expect(Value.Check(UntrustedFumaRouteScopeSchema, {
        ...routeScope,
        ...authorityClaim,
      })).toBe(false)
    }

    expect(Value.Check(UntrustedFumaRouteScopeSchema, {
      organizationId: routeScope.organizationId,
      workspaceId: routeScope.workspaceId,
    })).toBe(false)
    expect(Value.Check(UntrustedFumaRouteScopeSchema, {
      ...routeScope,
      platformId: 'caller-claimed-platform',
    })).toBe(false)
  })

  it('rejects every ownership ancestry substitution', () => {
    const organization = contextInput()
    organization.scope.organization.platformId = 'platform-other'
    expectContextError(
      organization,
      'ancestry-mismatch',
      'context.scope.organization.platformId',
    )

    const workspacePlatform = contextInput()
    workspacePlatform.scope.workspace.platformId = 'platform-other'
    expectContextError(workspacePlatform, 'ancestry-mismatch', 'context.scope.workspace')

    const workspaceOrganization = contextInput()
    workspaceOrganization.scope.workspace.organizationId = 'organization-other'
    expectContextError(workspaceOrganization, 'ancestry-mismatch', 'context.scope.workspace')

    for (const field of ['platformId', 'organizationId', 'workspaceId'] as const) {
      const site = contextInput()
      site.scope.site[field] = `${field}-other`
      expectContextError(site, 'ancestry-mismatch', 'context.scope.site')
    }
  })

  it('rejects duplicate capabilities and duplicate permissions', () => {
    const duplicateCapability = contextInput()
    duplicateCapability.capabilities.push(duplicateCapability.capabilities[0])
    expect(Value.Check(FumaRequestContextSchema, duplicateCapability)).toBe(false)
    expectContextError(duplicateCapability, 'duplicate-capability', 'context.capabilities')

    const duplicateAllowedPermission = contextInput()
    duplicateAllowedPermission.permissions.allow.push(
      duplicateAllowedPermission.permissions.allow[0],
    )
    expect(Value.Check(FumaRequestContextSchema, duplicateAllowedPermission)).toBe(false)
    expectContextError(
      duplicateAllowedPermission,
      'duplicate-permission',
      'context.permissions.allow',
    )

    const duplicateDeniedPermission = contextInput()
    duplicateDeniedPermission.permissions.deny.push(
      duplicateDeniedPermission.permissions.deny[0],
    )
    expect(Value.Check(FumaRequestContextSchema, duplicateDeniedPermission)).toBe(false)
    expectContextError(
      duplicateDeniedPermission,
      'duplicate-permission',
      'context.permissions.deny',
    )
  })

  it('rejects permissions present in both the allow and deny summaries', () => {
    const input = contextInput()
    input.permissions.deny.push(input.permissions.allow[0])
    expect(Value.Check(FumaRequestContextSchema, input)).toBe(true)
    expectContextError(input, 'permission-overlap', 'context.permissions')
  })

  it('rejects malformed identifiers at every trust-bearing layer', () => {
    const mutations: Array<(input: ReturnType<typeof contextInput>) => void> = [
      (input) => { input.requestId = 'request id with spaces' },
      (input) => { input.source.correlationId = '../correlation' },
      (input) => { input.actor.userId = ' staff' },
      (input) => { input.scope.platform.id = '' },
      (input) => { input.scope.organization.id = 'organization/acme' },
      (input) => { input.scope.workspace.id = 'workspace primary' },
      (input) => { input.scope.site.id = 'site/main' },
      (input) => { input.profile.id = 'Website' },
      (input) => { input.capabilities[0] = 'Content Pages' },
      (input) => { input.permissions.allow[0] = 'Site Home Read' },
    ]

    for (const mutate of mutations) {
      const input = contextInput()
      mutate(input)
      expectContextError(input, 'invalid-contract', 'context')
    }

    expect(Value.Check(UntrustedFumaRouteScopeSchema, {
      organizationId: 'organization-acme',
      workspaceId: '../workspace',
      siteId: 'site-main',
    })).toBe(false)
  })

  it('rejects actor, source, impersonator, and permission-subject mismatches', () => {
    const staffSession = contextInput()
    staffSession.source.sessionId = 'session-other'
    expectContextError(staffSession, 'actor-source-mismatch', 'context.source')

    const staffIdentity = contextInput()
    staffIdentity.source.userId = 'staff-other'
    expectContextError(staffIdentity, 'actor-source-mismatch', 'context.source')

    const sourceKind = {
      ...contextInput(),
      source: internalJobContextInput().source,
    }
    expectContextError(sourceKind, 'actor-source-mismatch', 'context.source')

    const jobRun = internalJobContextInput()
    jobRun.source.runId = 'run-other'
    expectContextError(jobRun, 'actor-source-mismatch', 'context.source')

    const permissionSubject = contextInput()
    permissionSubject.permissions.subjectId = 'staff-other'
    expectContextError(
      permissionSubject,
      'actor-source-mismatch',
      'context.permissions.subjectId',
    )
  })

  it('rejects inactive platform, organization, workspace, site, and profile claims', () => {
    const inactiveContexts: Array<[
      (input: ReturnType<typeof contextInput>) => void,
      string,
    ]> = [
      [(input) => { input.scope.platform.status = 'suspended' }, 'context.scope.platform.status'],
      [(input) => { input.scope.organization.status = 'suspended' }, 'context.scope.organization.status'],
      [(input) => { input.scope.workspace.status = 'archived' }, 'context.scope.workspace.status'],
      [(input) => { input.scope.site.status = 'archived' }, 'context.scope.site.status'],
      [(input) => { input.profile.status = 'inactive' }, 'context.profile.status'],
    ]

    for (const [mutate, path] of inactiveContexts) {
      const input = contextInput()
      mutate(input)
      expect(Value.Check(FumaRequestContextSchema, input)).toBe(true)
      expectContextError(input, 'inactive-context', path)
    }
  })

  it('binds the active profile to the exact site assignment', () => {
    const input = contextInput()
    input.profile.id = 'publication'
    expectContextError(input, 'profile-mismatch', 'context.profile.id')
  })

  it('clones independently and freezes a detached deeply immutable snapshot', () => {
    const caller = contextInput()
    const clone = cloneFumaRequestContext(caller)
    const frozen = freezeFumaRequestContext(caller)

    expect(clone).toEqual(caller)
    expect(clone).not.toBe(caller)
    expect(clone.scope).not.toBe(caller.scope)
    expect(clone.permissions.allow).not.toBe(caller.permissions.allow)

    expect(Object.isFrozen(frozen)).toBe(true)
    expect(Object.isFrozen(frozen.source)).toBe(true)
    expect(Object.isFrozen(frozen.actor)).toBe(true)
    expect(Object.isFrozen(frozen.actor.kind === 'staff' && frozen.actor.impersonator)).toBe(true)
    expect(Object.isFrozen(frozen.scope)).toBe(true)
    expect(Object.isFrozen(frozen.scope.site)).toBe(true)
    expect(Object.isFrozen(frozen.profile)).toBe(true)
    expect(Object.isFrozen(frozen.capabilities)).toBe(true)
    expect(Object.isFrozen(frozen.permissions)).toBe(true)
    expect(Object.isFrozen(frozen.permissions.allow)).toBe(true)

    expect(Object.isFrozen(caller)).toBe(false)
    expect(Object.isFrozen(caller.source)).toBe(false)
    expect(Object.isFrozen(caller.actor)).toBe(false)
    expect(Object.isFrozen(caller.actor.impersonator)).toBe(false)
    expect(Object.isFrozen(caller.scope)).toBe(false)
    expect(Object.isFrozen(caller.scope.site)).toBe(false)
    expect(Object.isFrozen(caller.capabilities)).toBe(false)
    expect(Object.isFrozen(caller.permissions.allow)).toBe(false)

    caller.scope.site.id = 'site-mutated-after-snapshot'
    caller.capabilities.push('website.media')
    caller.permissions.allow.push('website.media.read')
    expect(frozen.scope.site.id).toBe('site-main')
    expect(frozen.capabilities).toEqual(['site.home', 'content.pages'])
    expect(frozen.permissions.allow).toEqual(['site.home.read', 'content.pages.read'])
  })

  it('rejects unknown fields throughout the final authority snapshot', () => {
    const input = contextInput()
    expect(Value.Check(FumaRequestContextSchema, { ...input, headers: {} })).toBe(false)
    expect(Value.Check(FumaRequestContextSchema, {
      ...input,
      actor: { ...input.actor, role: 'owner' },
    })).toBe(false)
    expect(Value.Check(FumaRequestContextSchema, {
      ...input,
      profile: { ...input.profile, capabilityOverrides: { grant: [], revoke: [] } },
    })).toBe(false)
    expect(Value.Check(FumaRequestContextSchema, {
      ...input,
      permissions: { ...input.permissions, inherited: [] },
    })).toBe(false)
  })
})

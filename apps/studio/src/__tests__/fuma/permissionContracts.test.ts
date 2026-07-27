import { describe, expect, it } from 'bun:test'
import { Value } from '@core/utils/typeboxHelpers'
import {
  CapabilityPermissionAvailabilitySchema,
  CustomRoleDefinitionSchema,
  LAUNCH_PERMISSION_PERSONAS,
  LaunchPermissionPersonaSchema,
  PERMISSION_RESOLUTION_PRECEDENCE,
  PermissionOverrideSetSchema,
  PermissionResolverInputSchema,
  PermissionResolverOutputSchema,
  ResourceScopeSchema,
  ScopedPermissionOverrideSchema,
  ScopedRoleAssignmentSchema,
  assertCustomRoleDefinition,
  assertPermissionOverrideSet,
  assertPermissionResolverInput,
  type CustomRoleDefinition,
  type PermissionResolverInput,
  type ResourceScope,
} from '@core/fuma'

const PLATFORM = {
  kind: 'platform',
  platformId: 'platform-fuma',
} as const

const ORGANIZATION = {
  kind: 'organization',
  platformId: 'platform-fuma',
  organizationId: 'organization-acme',
} as const

const WORKSPACE = {
  kind: 'workspace',
  platformId: 'platform-fuma',
  organizationId: 'organization-acme',
  workspaceId: 'workspace-main',
} as const

const SITE = {
  kind: 'site',
  platformId: 'platform-fuma',
  organizationId: 'organization-acme',
  workspaceId: 'workspace-main',
  siteId: 'site-primary',
} as const

const CUSTOM_ROLE: CustomRoleDefinition = {
  id: 'role.site-publisher',
  name: 'Site publisher',
  scope: ORGANIZATION,
  constraints: {
    basePersona: 'member',
    assignableScopeKinds: ['workspace', 'site'],
  },
  permissionOverrides: {
    grant: ['content.pages.write'],
    deny: ['site.settings.write'],
  },
}

function resolverInput(): PermissionResolverInput {
  return {
    subjectId: 'user-editor',
    permissionId: 'content.pages.write',
    scope: SITE,
    capabilityPermission: {
      kind: 'available',
      capabilityId: 'content.pages',
    },
    protectedOwnerInvariant: null,
    roleAssignments: [
      {
        id: 'assignment.organization-member',
        subjectId: 'user-editor',
        scope: ORGANIZATION,
        role: { kind: 'launch-persona', persona: 'member' },
      },
      {
        id: 'assignment.site-publisher',
        subjectId: 'user-editor',
        scope: SITE,
        role: { kind: 'custom-role', roleId: CUSTOM_ROLE.id },
      },
    ],
    permissionOverrides: [{
      id: 'override.workspace-editor',
      subjectId: 'user-editor',
      scope: WORKSPACE,
      permissions: {
        grant: ['website.media.read'],
        deny: ['publication.newsletters.send'],
      },
    }],
    customRoles: [CUSTOM_ROLE],
  }
}

function protectedOwnerInput(): PermissionResolverInput {
  return {
    subjectId: 'user-protected-owner',
    permissionId: 'platform.roles.manage',
    scope: SITE,
    capabilityPermission: {
      kind: 'available',
      capabilityId: 'platform.roles',
    },
    protectedOwnerInvariant: {
      subjectId: 'user-protected-owner',
      platformId: PLATFORM.platformId,
      permissionIds: ['platform.roles.manage'],
    },
    roleAssignments: [{
      id: 'assignment.protected-owner',
      subjectId: 'user-protected-owner',
      scope: PLATFORM,
      role: { kind: 'launch-persona', persona: 'protected-owner' },
    }],
    permissionOverrides: [],
    customRoles: [],
  }
}

function without<Key extends string>(
  value: Readonly<Record<string, unknown>>,
  key: Key,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key))
}

describe('FUMA-020 layered permission contracts', () => {
  it('defines exactly the five launch personas', () => {
    expect(LAUNCH_PERMISSION_PERSONAS).toEqual([
      'protected-owner',
      'owner',
      'admin',
      'member',
      'viewer',
    ])
    expect(Object.isFrozen(LAUNCH_PERMISSION_PERSONAS)).toBe(true)

    for (const persona of LAUNCH_PERMISSION_PERSONAS) {
      expect(Value.Check(LaunchPermissionPersonaSchema, persona)).toBe(true)
    }
    for (const invalid of ['editor', 'client', 'super-admin', '', null]) {
      expect(Value.Check(LaunchPermissionPersonaSchema, invalid)).toBe(false)
    }
  })

  it('requires the complete ownership chain at every resource scope', () => {
    for (const scope of [PLATFORM, ORGANIZATION, WORKSPACE, SITE]) {
      expect(Value.Check(ResourceScopeSchema, scope)).toBe(true)
    }

    expect(Value.Check(ResourceScopeSchema, without(PLATFORM, 'platformId'))).toBe(false)
    expect(Value.Check(ResourceScopeSchema, without(ORGANIZATION, 'organizationId'))).toBe(false)
    expect(Value.Check(ResourceScopeSchema, without(WORKSPACE, 'workspaceId'))).toBe(false)
    expect(Value.Check(ResourceScopeSchema, without(SITE, 'siteId'))).toBe(false)
    expect(Value.Check(ResourceScopeSchema, without(SITE, 'organizationId'))).toBe(false)
    expect(Value.Check(ResourceScopeSchema, without(SITE, 'workspaceId'))).toBe(false)
  })

  it('rejects cross-scope fields and unknown fields instead of accepting partial hybrids', () => {
    const crossScopeValues = [
      { ...PLATFORM, organizationId: ORGANIZATION.organizationId },
      { ...ORGANIZATION, workspaceId: WORKSPACE.workspaceId },
      { ...WORKSPACE, siteId: SITE.siteId },
      { ...SITE, kind: 'workspace' },
      { ...SITE, unexpected: true },
    ]
    for (const value of crossScopeValues) {
      expect(Value.Check(ResourceScopeSchema, value)).toBe(false)
    }

    expect(Value.Check(ScopedRoleAssignmentSchema, {
      id: 'assignment.viewer',
      subjectId: 'user-viewer',
      scope: SITE,
      role: { kind: 'launch-persona', persona: 'viewer', unexpected: true },
    })).toBe(false)
    expect(Value.Check(ScopedPermissionOverrideSchema, {
      id: 'override.viewer',
      subjectId: 'user-viewer',
      scope: SITE,
      permissions: { grant: [], deny: [] },
      unexpected: true,
    })).toBe(false)
  })

  it('enforces exclusive override lists and rejects duplicates', () => {
    expect(Value.Check(PermissionOverrideSetSchema, {
      grant: ['content.pages.read', 'content.pages.read'],
      deny: [],
    })).toBe(false)
    expect(Value.Check(PermissionOverrideSetSchema, {
      grant: [],
      deny: ['content.pages.write', 'content.pages.write'],
    })).toBe(false)
    expect(Value.Check(PermissionOverrideSetSchema, {
      grant: [],
      deny: [],
      inherit: ['content.pages.read'],
    })).toBe(false)

    expect(() => assertPermissionOverrideSet({
      grant: ['content.pages.write'],
      deny: ['content.pages.write'],
    })).toThrow(expect.objectContaining({
      name: 'PermissionContractError',
      code: 'overlapping-permission-override',
      path: 'permissionOverrides',
    }))

    expect(() => assertPermissionOverrideSet({
      grant: ['content.pages.write'],
      deny: ['site.settings.write'],
    })).not.toThrow()
  })

  it('keeps custom roles below owner semantics and within their ownership layer', () => {
    expect(Value.Check(CustomRoleDefinitionSchema, CUSTOM_ROLE)).toBe(true)
    expect(() => assertCustomRoleDefinition(CUSTOM_ROLE)).not.toThrow()

    for (const forbiddenBase of ['owner', 'protected-owner']) {
      expect(Value.Check(CustomRoleDefinitionSchema, {
        ...CUSTOM_ROLE,
        constraints: {
          ...CUSTOM_ROLE.constraints,
          basePersona: forbiddenBase,
        },
      })).toBe(false)
    }

    const siteOwnedPlatformRole = {
      ...CUSTOM_ROLE,
      scope: SITE,
      constraints: {
        basePersona: 'admin' as const,
        assignableScopeKinds: ['platform' as const],
      },
    }
    expect(Value.Check(CustomRoleDefinitionSchema, siteOwnedPlatformRole)).toBe(true)
    expect(() => assertCustomRoleDefinition(siteOwnedPlatformRole)).toThrow(
      expect.objectContaining({ code: 'invalid-custom-role-scope' }),
    )
  })

  it('makes precedence explicit with capability failure closed and deny before grants/defaults', () => {
    expect(PERMISSION_RESOLUTION_PRECEDENCE).toEqual([
      'capability-unavailable',
      'protected-owner-invariant',
      'explicit-deny',
      'explicit-grant',
      'custom-role',
      'launch-persona',
      'default-deny',
    ])
    expect(Object.isFrozen(PERMISSION_RESOLUTION_PRECEDENCE)).toBe(true)

    expect(Value.Check(CapabilityPermissionAvailabilitySchema, {
      kind: 'unavailable',
      reason: 'capability-disabled',
    })).toBe(true)
    expect(Value.Check(CapabilityPermissionAvailabilitySchema, {
      kind: 'unavailable',
      reason: 'capability-disabled',
      capabilityId: 'content.pages',
    })).toBe(false)

    expect(Value.Check(PermissionResolverOutputSchema, {
      permissionId: 'content.pages.write',
      scope: SITE,
      decision: 'deny',
      precedence: 'capability-unavailable',
      source: {
        kind: 'capability-unavailable',
        reason: 'permission-undeclared',
      },
    })).toBe(true)
    expect(Value.Check(PermissionResolverOutputSchema, {
      permissionId: 'content.pages.write',
      scope: SITE,
      decision: 'allow',
      precedence: 'capability-unavailable',
      source: {
        kind: 'capability-unavailable',
        reason: 'permission-undeclared',
      },
    })).toBe(false)
  })

  it('represents protected-owner and explicit-deny decisions without ambiguous combinations', () => {
    expect(Value.Check(PermissionResolverOutputSchema, {
      permissionId: 'platform.roles.manage',
      scope: SITE,
      decision: 'allow',
      precedence: 'protected-owner-invariant',
      source: {
        kind: 'protected-owner-invariant',
        subjectId: 'user-protected-owner',
      },
    })).toBe(true)

    expect(Value.Check(PermissionResolverOutputSchema, {
      permissionId: 'content.pages.write',
      scope: SITE,
      decision: 'deny',
      precedence: 'explicit-deny',
      source: {
        kind: 'permission-override',
        overrideId: 'override.site-editor',
      },
    })).toBe(true)
    expect(Value.Check(PermissionResolverOutputSchema, {
      permissionId: 'content.pages.write',
      scope: SITE,
      decision: 'allow',
      precedence: 'explicit-deny',
      source: {
        kind: 'permission-override',
        overrideId: 'override.site-editor',
      },
    })).toBe(false)
  })

  it('accepts a complete layered resolver input and rejects unknown boundary fields', () => {
    const input = resolverInput()
    expect(Value.Check(PermissionResolverInputSchema, input)).toBe(true)
    expect(() => assertPermissionResolverInput(input)).not.toThrow()

    expect(Value.Check(PermissionResolverInputSchema, {
      ...input,
      profileId: 'website',
    })).toBe(false)
    expect(Value.Check(PermissionResolverInputSchema, {
      ...input,
      capabilityPermission: {
        ...input.capabilityPermission,
        profileId: 'publication',
      },
    })).toBe(false)
  })

  it('fails closed on records from another ownership hierarchy or subject', () => {
    const input = resolverInput()
    const crossWorkspace: ResourceScope = {
      ...WORKSPACE,
      workspaceId: 'workspace-other',
    }

    expect(() => assertPermissionResolverInput({
      ...input,
      permissionOverrides: [{
        ...input.permissionOverrides[0],
        scope: crossWorkspace,
      }],
    })).toThrow(expect.objectContaining({ code: 'scope-mismatch' }))

    expect(() => assertPermissionResolverInput({
      ...input,
      roleAssignments: [{
        ...input.roleAssignments[0],
        subjectId: 'user-other',
      }],
    })).toThrow(expect.objectContaining({ code: 'scope-mismatch' }))
  })

  it('rejects duplicate scoped records and unresolved or out-of-layer custom roles', () => {
    const input = resolverInput()
    expect(() => assertPermissionResolverInput({
      ...input,
      roleAssignments: [
        input.roleAssignments[0],
        {
          ...input.roleAssignments[0],
          id: 'assignment.organization-viewer',
          role: { kind: 'launch-persona', persona: 'viewer' },
        },
      ],
    })).toThrow(expect.objectContaining({ code: 'duplicate-record' }))

    expect(() => assertPermissionResolverInput({
      ...input,
      roleAssignments: [{
        id: 'assignment.unknown-role',
        subjectId: input.subjectId,
        scope: SITE,
        role: { kind: 'custom-role', roleId: 'role.missing' },
      }],
    })).toThrow(expect.objectContaining({ code: 'unknown-custom-role' }))

    expect(() => assertPermissionResolverInput({
      ...input,
      roleAssignments: [{
        id: 'assignment.organization-publisher',
        subjectId: input.subjectId,
        scope: ORGANIZATION,
        role: { kind: 'custom-role', roleId: CUSTOM_ROLE.id },
      }],
    })).toThrow(expect.objectContaining({ code: 'invalid-custom-role-scope' }))
  })

  it('requires the protected-owner persona to match one platform invariant', () => {
    const input = protectedOwnerInput()
    expect(Value.Check(PermissionResolverInputSchema, input)).toBe(true)
    expect(() => assertPermissionResolverInput(input)).not.toThrow()

    expect(() => assertPermissionResolverInput({
      ...input,
      protectedOwnerInvariant: null,
    })).toThrow(expect.objectContaining({
      code: 'invalid-protected-owner-assignment',
    }))

    expect(() => assertPermissionResolverInput({
      ...input,
      protectedOwnerInvariant: {
        ...input.protectedOwnerInvariant,
        subjectId: 'user-other',
      },
    })).toThrow(expect.objectContaining({
      code: 'scope-mismatch',
      path: 'resolverInput.protectedOwnerInvariant',
    }))

    expect(() => assertPermissionResolverInput({
      ...input,
      roleAssignments: [{
        ...input.roleAssignments[0],
        scope: ORGANIZATION,
      }],
    })).toThrow(expect.objectContaining({
      code: 'invalid-protected-owner-assignment',
    }))
  })
})

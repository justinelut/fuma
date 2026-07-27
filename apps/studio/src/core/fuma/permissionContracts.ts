import { Type, type Static, type TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { PermissionIdSchema } from './contracts'

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T

type Contract<T> = DeepReadonly<T>

const ID_OPTIONS = { minLength: 1, maxLength: 255 } as const
const ContractIdSchema = Type.String(ID_OPTIONS)

export const PermissionSubjectIdSchema = Type.String(ID_OPTIONS)
export type PermissionSubjectId = Contract<Static<typeof PermissionSubjectIdSchema>>

export const PermissionPlatformIdSchema = Type.String(ID_OPTIONS)
export type PermissionPlatformId = Contract<Static<typeof PermissionPlatformIdSchema>>

export const PermissionOrganizationIdSchema = Type.String(ID_OPTIONS)
export type PermissionOrganizationId = Contract<Static<typeof PermissionOrganizationIdSchema>>

export const PermissionWorkspaceIdSchema = Type.String(ID_OPTIONS)
export type PermissionWorkspaceId = Contract<Static<typeof PermissionWorkspaceIdSchema>>

export const PermissionSiteIdSchema = Type.String(ID_OPTIONS)
export type PermissionSiteId = Contract<Static<typeof PermissionSiteIdSchema>>

export const ResourceScopeKindSchema = Type.Union([
  Type.Literal('platform'),
  Type.Literal('organization'),
  Type.Literal('workspace'),
  Type.Literal('site'),
])
export type ResourceScopeKind = Contract<Static<typeof ResourceScopeKindSchema>>

export const PlatformResourceScopeSchema = Type.Object({
  kind: Type.Literal('platform'),
  platformId: PermissionPlatformIdSchema,
}, { additionalProperties: false })
export type PlatformResourceScope = Contract<Static<typeof PlatformResourceScopeSchema>>

export const OrganizationResourceScopeSchema = Type.Object({
  kind: Type.Literal('organization'),
  platformId: PermissionPlatformIdSchema,
  organizationId: PermissionOrganizationIdSchema,
}, { additionalProperties: false })
export type OrganizationResourceScope = Contract<Static<typeof OrganizationResourceScopeSchema>>

export const WorkspaceResourceScopeSchema = Type.Object({
  kind: Type.Literal('workspace'),
  platformId: PermissionPlatformIdSchema,
  organizationId: PermissionOrganizationIdSchema,
  workspaceId: PermissionWorkspaceIdSchema,
}, { additionalProperties: false })
export type WorkspaceResourceScope = Contract<Static<typeof WorkspaceResourceScopeSchema>>

export const SiteResourceScopeSchema = Type.Object({
  kind: Type.Literal('site'),
  platformId: PermissionPlatformIdSchema,
  organizationId: PermissionOrganizationIdSchema,
  workspaceId: PermissionWorkspaceIdSchema,
  siteId: PermissionSiteIdSchema,
}, { additionalProperties: false })
export type SiteResourceScope = Contract<Static<typeof SiteResourceScopeSchema>>

export const ResourceScopeSchema = Type.Union([
  PlatformResourceScopeSchema,
  OrganizationResourceScopeSchema,
  WorkspaceResourceScopeSchema,
  SiteResourceScopeSchema,
])
export type ResourceScope = Contract<Static<typeof ResourceScopeSchema>>

export const LAUNCH_PERMISSION_PERSONAS = Object.freeze([
  'protected-owner',
  'owner',
  'admin',
  'member',
  'viewer',
] as const)

export const LaunchPermissionPersonaSchema = Type.Union([
  Type.Literal('protected-owner'),
  Type.Literal('owner'),
  Type.Literal('admin'),
  Type.Literal('member'),
  Type.Literal('viewer'),
])
export type LaunchPermissionPersona = Contract<Static<typeof LaunchPermissionPersonaSchema>>

export const CustomRoleBasePersonaSchema = Type.Union([
  Type.Literal('admin'),
  Type.Literal('member'),
  Type.Literal('viewer'),
])
export type CustomRoleBasePersona = Contract<Static<typeof CustomRoleBasePersonaSchema>>

export const PermissionOverrideSetSchema = Type.Object({
  grant: Type.Array(PermissionIdSchema, { uniqueItems: true }),
  deny: Type.Array(PermissionIdSchema, { uniqueItems: true }),
}, { additionalProperties: false })
export type PermissionOverrideSet = Contract<Static<typeof PermissionOverrideSetSchema>>

export const CustomRoleConstraintsSchema = Type.Object({
  basePersona: CustomRoleBasePersonaSchema,
  assignableScopeKinds: Type.Array(ResourceScopeKindSchema, {
    minItems: 1,
    uniqueItems: true,
  }),
}, { additionalProperties: false })
export type CustomRoleConstraints = Contract<Static<typeof CustomRoleConstraintsSchema>>

export const CustomRoleDefinitionSchema = Type.Object({
  id: ContractIdSchema,
  name: Type.String({ minLength: 1, maxLength: 120 }),
  scope: ResourceScopeSchema,
  constraints: CustomRoleConstraintsSchema,
  permissionOverrides: PermissionOverrideSetSchema,
}, { additionalProperties: false })
export type CustomRoleDefinition = Contract<Static<typeof CustomRoleDefinitionSchema>>

export const LaunchPersonaRoleReferenceSchema = Type.Object({
  kind: Type.Literal('launch-persona'),
  persona: LaunchPermissionPersonaSchema,
}, { additionalProperties: false })
export type LaunchPersonaRoleReference = Contract<Static<typeof LaunchPersonaRoleReferenceSchema>>

export const CustomRoleReferenceSchema = Type.Object({
  kind: Type.Literal('custom-role'),
  roleId: ContractIdSchema,
}, { additionalProperties: false })
export type CustomRoleReference = Contract<Static<typeof CustomRoleReferenceSchema>>

export const AssignedRoleSchema = Type.Union([
  LaunchPersonaRoleReferenceSchema,
  CustomRoleReferenceSchema,
])
export type AssignedRole = Contract<Static<typeof AssignedRoleSchema>>

export const ScopedRoleAssignmentSchema = Type.Object({
  id: ContractIdSchema,
  subjectId: PermissionSubjectIdSchema,
  scope: ResourceScopeSchema,
  role: AssignedRoleSchema,
}, { additionalProperties: false })
export type ScopedRoleAssignment = Contract<Static<typeof ScopedRoleAssignmentSchema>>

export const ScopedPermissionOverrideSchema = Type.Object({
  id: ContractIdSchema,
  subjectId: PermissionSubjectIdSchema,
  scope: ResourceScopeSchema,
  permissions: PermissionOverrideSetSchema,
}, { additionalProperties: false })
export type ScopedPermissionOverride = Contract<Static<typeof ScopedPermissionOverrideSchema>>

export const CapabilityPermissionAvailabilitySchema = Type.Union([
  Type.Object({
    kind: Type.Literal('available'),
    capabilityId: ContractIdSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('unavailable'),
    reason: Type.Union([
      Type.Literal('capability-disabled'),
      Type.Literal('permission-undeclared'),
    ]),
  }, { additionalProperties: false }),
])
export type CapabilityPermissionAvailability = Contract<
  Static<typeof CapabilityPermissionAvailabilitySchema>
>

export const ProtectedOwnerInvariantSchema = Type.Object({
  subjectId: PermissionSubjectIdSchema,
  platformId: PermissionPlatformIdSchema,
  permissionIds: Type.Array(PermissionIdSchema, { minItems: 1, uniqueItems: true }),
}, { additionalProperties: false })
export type ProtectedOwnerInvariant = Contract<Static<typeof ProtectedOwnerInvariantSchema>>

/** Lower indexes are evaluated first and therefore outrank every later stage. */
export const PERMISSION_RESOLUTION_PRECEDENCE = Object.freeze([
  'capability-unavailable',
  'protected-owner-invariant',
  'explicit-deny',
  'explicit-grant',
  'custom-role',
  'launch-persona',
  'default-deny',
] as const)

export const PermissionResolutionPrecedenceSchema = Type.Union([
  Type.Literal('capability-unavailable'),
  Type.Literal('protected-owner-invariant'),
  Type.Literal('explicit-deny'),
  Type.Literal('explicit-grant'),
  Type.Literal('custom-role'),
  Type.Literal('launch-persona'),
  Type.Literal('default-deny'),
])
export type PermissionResolutionPrecedence = Contract<
  Static<typeof PermissionResolutionPrecedenceSchema>
>

export const PermissionResolverInputSchema = Type.Object({
  subjectId: PermissionSubjectIdSchema,
  permissionId: PermissionIdSchema,
  scope: ResourceScopeSchema,
  capabilityPermission: CapabilityPermissionAvailabilitySchema,
  protectedOwnerInvariant: Type.Union([ProtectedOwnerInvariantSchema, Type.Null()]),
  roleAssignments: Type.Array(ScopedRoleAssignmentSchema),
  permissionOverrides: Type.Array(ScopedPermissionOverrideSchema),
  customRoles: Type.Array(CustomRoleDefinitionSchema),
}, { additionalProperties: false })
export type PermissionResolverInput = Contract<Static<typeof PermissionResolverInputSchema>>

const decisionBase = {
  permissionId: PermissionIdSchema,
  scope: ResourceScopeSchema,
}

export const PermissionDecisionSchema = Type.Union([
  Type.Object({
    ...decisionBase,
    decision: Type.Literal('allow'),
    precedence: Type.Literal('protected-owner-invariant'),
    source: Type.Object({
      kind: Type.Literal('protected-owner-invariant'),
      subjectId: PermissionSubjectIdSchema,
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
  Type.Object({
    ...decisionBase,
    decision: Type.Literal('allow'),
    precedence: Type.Literal('explicit-grant'),
    source: Type.Object({
      kind: Type.Literal('permission-override'),
      overrideId: ContractIdSchema,
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
  Type.Object({
    ...decisionBase,
    decision: Type.Literal('allow'),
    precedence: Type.Literal('custom-role'),
    source: Type.Object({
      kind: Type.Literal('custom-role-assignment'),
      assignmentId: ContractIdSchema,
      roleId: ContractIdSchema,
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
  Type.Object({
    ...decisionBase,
    decision: Type.Literal('allow'),
    precedence: Type.Literal('launch-persona'),
    source: Type.Object({
      kind: Type.Literal('launch-persona-assignment'),
      assignmentId: ContractIdSchema,
      persona: LaunchPermissionPersonaSchema,
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
  Type.Object({
    ...decisionBase,
    decision: Type.Literal('deny'),
    precedence: Type.Literal('capability-unavailable'),
    source: Type.Object({
      kind: Type.Literal('capability-unavailable'),
      reason: Type.Union([
        Type.Literal('capability-disabled'),
        Type.Literal('permission-undeclared'),
      ]),
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
  Type.Object({
    ...decisionBase,
    decision: Type.Literal('deny'),
    precedence: Type.Literal('explicit-deny'),
    source: Type.Object({
      kind: Type.Literal('permission-override'),
      overrideId: ContractIdSchema,
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
  Type.Object({
    ...decisionBase,
    decision: Type.Literal('deny'),
    precedence: Type.Literal('custom-role'),
    source: Type.Object({
      kind: Type.Literal('custom-role-assignment'),
      assignmentId: ContractIdSchema,
      roleId: ContractIdSchema,
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
  Type.Object({
    ...decisionBase,
    decision: Type.Literal('deny'),
    precedence: Type.Literal('launch-persona'),
    source: Type.Object({
      kind: Type.Literal('launch-persona-assignment'),
      assignmentId: ContractIdSchema,
      persona: LaunchPermissionPersonaSchema,
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
  Type.Object({
    ...decisionBase,
    decision: Type.Literal('deny'),
    precedence: Type.Literal('default-deny'),
    source: Type.Object({
      kind: Type.Literal('default-deny'),
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
])
export type PermissionDecision = Contract<Static<typeof PermissionDecisionSchema>>

export const PermissionResolverOutputSchema = PermissionDecisionSchema
export type PermissionResolverOutput = Contract<Static<typeof PermissionResolverOutputSchema>>

export const PermissionContractErrorCodeSchema = Type.Union([
  Type.Literal('invalid-contract'),
  Type.Literal('overlapping-permission-override'),
  Type.Literal('duplicate-record'),
  Type.Literal('scope-mismatch'),
  Type.Literal('invalid-protected-owner-assignment'),
  Type.Literal('unknown-custom-role'),
  Type.Literal('invalid-custom-role-scope'),
])
export type PermissionContractErrorCode = Contract<
  Static<typeof PermissionContractErrorCodeSchema>
>

export class PermissionContractError extends Error {
  readonly code: PermissionContractErrorCode
  readonly path: string

  constructor(code: PermissionContractErrorCode, message: string, path: string) {
    super(message)
    this.name = 'PermissionContractError'
    this.code = code
    this.path = path
  }
}

const SCOPE_RANK: Readonly<Record<ResourceScopeKind, number>> = Object.freeze({
  platform: 0,
  organization: 1,
  workspace: 2,
  site: 3,
})

function scopeKey(scope: ResourceScope): string {
  switch (scope.kind) {
    case 'platform':
      return `platform:${scope.platformId}`
    case 'organization':
      return `organization:${scope.platformId}:${scope.organizationId}`
    case 'workspace':
      return `workspace:${scope.platformId}:${scope.organizationId}:${scope.workspaceId}`
    case 'site':
      return `site:${scope.platformId}:${scope.organizationId}:${scope.workspaceId}:${scope.siteId}`
  }
}

function scopeContains(container: ResourceScope, target: ResourceScope): boolean {
  if (container.platformId !== target.platformId) return false
  if (container.kind === 'platform') return true
  if (target.kind === 'platform' || container.organizationId !== target.organizationId) return false
  if (container.kind === 'organization') return true
  if (target.kind === 'organization' || container.workspaceId !== target.workspaceId) return false
  if (container.kind === 'workspace') return true
  return target.kind === 'site' && container.siteId === target.siteId
}

function assertSchema(schema: TSchema, value: unknown, path: string): void {
  if (!Value.Check(schema, value)) {
    const error = Value.Errors(schema, value).First()
    throw new PermissionContractError(
      'invalid-contract',
      `${path} does not match its TypeBox contract${error ? `: ${error.path || '/'} ${error.message}` : ''}.`,
      path,
    )
  }
}

function assertUnique(values: readonly string[], path: string): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) {
      throw new PermissionContractError(
        'duplicate-record',
        `${path} contains duplicate value "${value}".`,
        path,
      )
    }
    seen.add(value)
  }
}

export function assertPermissionOverrideSet(
  overrides: PermissionOverrideSet,
  path = 'permissionOverrides',
): void {
  assertSchema(PermissionOverrideSetSchema, overrides, path)
  const denied = new Set(overrides.deny)
  const overlap = overrides.grant.find((permissionId) => denied.has(permissionId))
  if (overlap) {
    throw new PermissionContractError(
      'overlapping-permission-override',
      `Permission "${overlap}" cannot be both explicitly granted and explicitly denied.`,
      path,
    )
  }
}

export function assertCustomRoleDefinition(
  role: CustomRoleDefinition,
  path = 'customRole',
): void {
  assertSchema(CustomRoleDefinitionSchema, role, path)
  assertPermissionOverrideSet(role.permissionOverrides, `${path}.permissionOverrides`)
  const roleRank = SCOPE_RANK[role.scope.kind]
  const broaderKind = role.constraints.assignableScopeKinds.find(
    (kind) => SCOPE_RANK[kind] < roleRank,
  )
  if (broaderKind) {
    throw new PermissionContractError(
      'invalid-custom-role-scope',
      `A ${role.scope.kind}-owned custom role cannot be assigned at ${broaderKind} scope.`,
      `${path}.constraints.assignableScopeKinds`,
    )
  }
}

export function assertPermissionResolverInput(input: PermissionResolverInput): void {
  assertSchema(PermissionResolverInputSchema, input, 'resolverInput')
  assertUnique(input.roleAssignments.map(({ id }) => id), 'resolverInput.roleAssignments')
  assertUnique(input.permissionOverrides.map(({ id }) => id), 'resolverInput.permissionOverrides')
  assertUnique(input.customRoles.map(({ id }) => id), 'resolverInput.customRoles')

  const roleScopes = input.roleAssignments.map(({ scope }) => scopeKey(scope))
  assertUnique(roleScopes, 'resolverInput.roleAssignments.scope')
  const overrideScopes = input.permissionOverrides.map(({ scope }) => scopeKey(scope))
  assertUnique(overrideScopes, 'resolverInput.permissionOverrides.scope')

  const customRoles = new Map(input.customRoles.map((role) => [role.id, role]))
  for (const [index, role] of input.customRoles.entries()) {
    assertCustomRoleDefinition(role, `resolverInput.customRoles.${index}`)
    if (!scopeContains(role.scope, input.scope)) {
      throw new PermissionContractError(
        'scope-mismatch',
        `Custom role "${role.id}" is outside the requested resource hierarchy.`,
        `resolverInput.customRoles.${index}.scope`,
      )
    }
  }

  const invariant = input.protectedOwnerInvariant
  if (
    invariant
    && (
      invariant.subjectId !== input.subjectId
      || invariant.platformId !== input.scope.platformId
    )
  ) {
    throw new PermissionContractError(
      'scope-mismatch',
      'The protected-owner invariant belongs to another subject or platform.',
      'resolverInput.protectedOwnerInvariant',
    )
  }

  for (const [index, assignment] of input.roleAssignments.entries()) {
    const path = `resolverInput.roleAssignments.${index}`
    if (assignment.subjectId !== input.subjectId || !scopeContains(assignment.scope, input.scope)) {
      throw new PermissionContractError(
        'scope-mismatch',
        `Role assignment "${assignment.id}" is outside the requested subject or resource hierarchy.`,
        path,
      )
    }
    if (assignment.role.kind === 'launch-persona') {
      if (assignment.role.persona === 'protected-owner') {
        const invariant = input.protectedOwnerInvariant
        if (
          assignment.scope.kind !== 'platform'
          || !invariant
          || invariant.subjectId !== assignment.subjectId
          || invariant.platformId !== assignment.scope.platformId
        ) {
          throw new PermissionContractError(
            'invalid-protected-owner-assignment',
            'The protected-owner persona requires its matching platform invariant and platform scope.',
            path,
          )
        }
      }
      continue
    }

    const role = customRoles.get(assignment.role.roleId)
    if (!role) {
      throw new PermissionContractError(
        'unknown-custom-role',
        `Role assignment "${assignment.id}" references unknown custom role "${assignment.role.roleId}".`,
        `${path}.role.roleId`,
      )
    }
    if (
      !scopeContains(role.scope, assignment.scope)
      || !role.constraints.assignableScopeKinds.includes(assignment.scope.kind)
    ) {
      throw new PermissionContractError(
        'invalid-custom-role-scope',
        `Custom role "${role.id}" cannot be assigned at this resource scope.`,
        `${path}.scope`,
      )
    }
  }

  for (const [index, override] of input.permissionOverrides.entries()) {
    const path = `resolverInput.permissionOverrides.${index}`
    assertPermissionOverrideSet(override.permissions, `${path}.permissions`)
    if (override.subjectId !== input.subjectId || !scopeContains(override.scope, input.scope)) {
      throw new PermissionContractError(
        'scope-mismatch',
        `Permission override "${override.id}" is outside the requested subject or resource hierarchy.`,
        path,
      )
    }
  }

}

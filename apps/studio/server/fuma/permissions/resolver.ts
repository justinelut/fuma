import {
  CapabilityOverridesSchema,
  PermissionCatalogError,
  PermissionOrganizationIdSchema,
  PermissionSubjectIdSchema,
  ProtectedOwnerInvariantSchema,
  ScopedPermissionOverrideSchema,
  ScopedRoleAssignmentSchema,
  SiteResourceScopeSchema,
  CustomRoleDefinitionSchema,
  assertCustomRolePermissions,
  assertPermissionResolverInput,
  composePermissionCatalog,
  fumaLaunchRegistry,
  type FumaRegistry,
  type PermissionCatalog,
  type PermissionCatalogEntry,
  type PermissionDecision,
  type PermissionId,
  type PermissionResolutionPrecedence,
  type PermissionResolverInput,
  type ResourceScope,
  type ResourceScopeKind,
  type ScopedPermissionOverride,
  type SiteResourceScope,
} from '@core/fuma'
import {
  Type,
  Value,
  safeParseValue,
  type Static,
} from '@core/utils/typeboxHelpers'

const ID_OPTIONS = { minLength: 1, maxLength: 255 } as const
const ContextIdSchema = Type.String(ID_OPTIONS)

const OrganizationStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('suspended'),
  Type.Literal('archived'),
])
const ArchivedResourceStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('archived'),
])

export const LayeredRoleResolverInputSchema = Type.Object({
  subjectId: PermissionSubjectIdSchema,
  platformOrganizationId: PermissionOrganizationIdSchema,
  scope: SiteResourceScopeSchema,
  organization: Type.Object({
    id: ContextIdSchema,
    platformId: ContextIdSchema,
    kind: Type.Union([Type.Literal('platform'), Type.Literal('customer')]),
    status: OrganizationStatusSchema,
  }, { additionalProperties: false }),
  workspace: Type.Object({
    id: ContextIdSchema,
    platformId: ContextIdSchema,
    organizationId: ContextIdSchema,
    status: ArchivedResourceStatusSchema,
  }, { additionalProperties: false }),
  site: Type.Object({
    id: ContextIdSchema,
    platformId: ContextIdSchema,
    organizationId: ContextIdSchema,
    workspaceId: ContextIdSchema,
    status: ArchivedResourceStatusSchema,
    profileId: ContextIdSchema,
    capabilityOverrides: CapabilityOverridesSchema,
  }, { additionalProperties: false }),
  protectedOwnerInvariant: Type.Union([ProtectedOwnerInvariantSchema, Type.Null()]),
  roleAssignments: Type.Array(ScopedRoleAssignmentSchema),
  permissionOverrides: Type.Array(ScopedPermissionOverrideSchema),
  customRoles: Type.Array(CustomRoleDefinitionSchema),
}, { additionalProperties: false })

export type LayeredRoleResolverInput = Static<typeof LayeredRoleResolverInputSchema>

export type LayeredPermissionReason =
  | 'capability-disabled'
  | 'permission-undeclared'
  | 'no-membership'
  | 'organization-suspended'
  | 'organization-archived'
  | 'workspace-archived'
  | 'site-archived'
  | 'protected-owner-invariant'
  | 'explicit-deny'
  | 'explicit-grant'
  | 'custom-role-grant'
  | 'custom-role-deny'
  | 'launch-persona-grant'
  | 'launch-persona-deny'
  | 'default-deny'

export type LayeredPermissionSource =
  | PermissionDecision['source']
  | Readonly<{
    kind: 'membership'
    reason: 'role-assignment-required'
  }>
  | Readonly<{
    kind: 'lifecycle'
    resource: 'organization'
    status: 'suspended' | 'archived'
  }>
  | Readonly<{
    kind: 'lifecycle'
    resource: 'workspace' | 'site'
    status: 'archived'
  }>

export type LayeredPermissionDecision = Readonly<{
  permissionId: PermissionId
  scope: SiteResourceScope
  decision: 'allow' | 'deny'
  precedence: PermissionResolutionPrecedence | 'membership-required' | 'lifecycle'
  source: LayeredPermissionSource
  reason: LayeredPermissionReason
}>

export type LayeredPermissionResolution = Readonly<{
  subjectId: string
  scope: SiteResourceScope
  profileId: string
  activeCapabilityIds: readonly string[]
  decisions: readonly LayeredPermissionDecision[]
  allowedPermissionIds: readonly PermissionId[]
  deniedPermissionIds: readonly PermissionId[]
}>

export type LayeredPermissionResolverErrorCode =
  | 'invalid-contract'
  | 'scope-mismatch'
  | 'unknown-permission'
  | 'invalid-protected-owner-invariant'
  | 'protected-owner-demotion'
  | 'platform-organization-invariant'

export class LayeredPermissionResolverError extends Error {
  readonly code: LayeredPermissionResolverErrorCode
  readonly path: string

  constructor(
    code: LayeredPermissionResolverErrorCode,
    message: string,
    path: string,
  ) {
    super(message)
    this.name = 'LayeredPermissionResolverError'
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

function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) immutable(nested)
    Object.freeze(value)
  }
  return value
}

function readInput(input: unknown): LayeredRoleResolverInput {
  const parsed = safeParseValue(LayeredRoleResolverInputSchema, input)
  if (!parsed.ok) {
    const firstError = Value.Errors(LayeredRoleResolverInputSchema, input).First()
    throw new LayeredPermissionResolverError(
      'invalid-contract',
      `Layered permission resolver input is malformed${firstError ? `: ${firstError.path || '/'} ${firstError.message}` : ''}.`,
      firstError?.path || 'resolverInput',
    )
  }
  return structuredClone(parsed.value)
}

function scopeRank(scope: ResourceScope): number {
  return SCOPE_RANK[scope.kind]
}

function mostSpecific<T extends { readonly scope: ResourceScope }>(values: readonly T[]): T | undefined {
  return values.toSorted((left, right) => scopeRank(right.scope) - scopeRank(left.scope))[0]
}

function decision(
  input: PermissionResolverInput,
  result: Omit<PermissionDecision, 'permissionId' | 'scope'>,
): PermissionDecision {
  return immutable({
    permissionId: input.permissionId,
    scope: structuredClone(input.scope),
    ...result,
  } as PermissionDecision)
}

function assertKnownOverridePermissions(
  overrides: readonly ScopedPermissionOverride[],
  knownPermissionIds: ReadonlySet<PermissionId>,
): void {
  for (const [overrideIndex, override] of overrides.entries()) {
    for (const listName of ['grant', 'deny'] as const) {
      for (const [permissionIndex, permissionId] of override.permissions[listName].entries()) {
        if (!knownPermissionIds.has(permissionId)) {
          throw new LayeredPermissionResolverError(
            'unknown-permission',
            `Permission override "${override.id}" references unknown permission "${permissionId}".`,
            `permissionOverrides.${overrideIndex}.permissions.${listName}.${permissionIndex}`,
          )
        }
      }
    }
  }
}

function assertInvariantSubject(input: PermissionResolverInput): void {
  const invariant = input.protectedOwnerInvariant
  if (invariant && invariant.subjectId !== input.subjectId) {
    throw new LayeredPermissionResolverError(
      'scope-mismatch',
      'The protected-owner invariant belongs to another subject.',
      'protectedOwnerInvariant.subjectId',
    )
  }
  if (
    invariant
    && !input.roleAssignments.some(({ scope, role }) => (
      scope.kind === 'platform'
      && role.kind === 'launch-persona'
      && role.persona === 'protected-owner'
    ))
  ) {
    throw new LayeredPermissionResolverError(
      'invalid-protected-owner-invariant',
      'A protected-owner invariant requires the matching platform-scoped protected-owner assignment.',
      'protectedOwnerInvariant',
    )
  }
}

/** Resolves one already-composed permission contract with deterministic source precedence. */
export function resolvePermission(
  input: PermissionResolverInput,
  catalog: PermissionCatalog,
): PermissionDecision {
  assertPermissionResolverInput(input)
  assertInvariantSubject(input)

  const permissionsById = new Map(catalog.permissions.map((entry) => [entry.id, entry]))
  assertKnownOverridePermissions(input.permissionOverrides, new Set(permissionsById.keys()))
  for (const [index, role] of input.customRoles.entries()) {
    assertCustomRolePermissions(role, catalog, `customRoles.${index}`)
  }

  const catalogEntry = permissionsById.get(input.permissionId)
  if (!catalogEntry && input.capabilityPermission.kind === 'available') {
    throw new LayeredPermissionResolverError(
      'unknown-permission',
      `Permission "${input.permissionId}" is not declared by the composed catalog.`,
      'permissionId',
    )
  }

  if (input.capabilityPermission.kind === 'unavailable') {
    return decision(input, {
      decision: 'deny',
      precedence: 'capability-unavailable',
      source: {
        kind: 'capability-unavailable',
        reason: input.capabilityPermission.reason,
      },
    })
  }

  const invariant = input.protectedOwnerInvariant
  if (
    invariant
    && invariant.subjectId === input.subjectId
    && invariant.platformId === input.scope.platformId
    && invariant.permissionIds.includes(input.permissionId)
  ) {
    return decision(input, {
      decision: 'allow',
      precedence: 'protected-owner-invariant',
      source: {
        kind: 'protected-owner-invariant',
        subjectId: invariant.subjectId,
      },
    })
  }

  const explicitDeny = mostSpecific(input.permissionOverrides.filter(({ permissions }) => (
    permissions.deny.includes(input.permissionId)
  )))
  if (explicitDeny) {
    return decision(input, {
      decision: 'deny',
      precedence: 'explicit-deny',
      source: { kind: 'permission-override', overrideId: explicitDeny.id },
    })
  }

  // Platform, support, and protected-owner permissions are internal-console
  // authority. A customer persona or explicit grant cannot synthesize them.
  if (catalogEntry?.authority !== 'customer' && !invariant) {
    return decision(input, {
      decision: 'deny',
      precedence: 'default-deny',
      source: { kind: 'default-deny' },
    })
  }

  const explicitGrant = mostSpecific(input.permissionOverrides.filter(({ permissions }) => (
    permissions.grant.includes(input.permissionId)
  )))
  if (explicitGrant) {
    return decision(input, {
      decision: 'allow',
      precedence: 'explicit-grant',
      source: { kind: 'permission-override', overrideId: explicitGrant.id },
    })
  }

  const assignment = mostSpecific(input.roleAssignments)
  if (!assignment) {
    return decision(input, {
      decision: 'deny',
      precedence: 'default-deny',
      source: { kind: 'default-deny' },
    })
  }

  if (assignment.role.kind === 'custom-role') {
    const roleId = assignment.role.roleId
    const role = input.customRoles.find(({ id }) => id === roleId)
    if (!role) {
      throw new LayeredPermissionResolverError(
        'invalid-contract',
        `Custom role assignment "${assignment.id}" has no matching definition.`,
        'roleAssignments',
      )
    }
    const granted = role.permissionOverrides.grant.includes(input.permissionId)
      || (
        !role.permissionOverrides.deny.includes(input.permissionId)
        && catalog.defaultGrants[role.constraints.basePersona].includes(input.permissionId)
      )
    return decision(input, {
      decision: granted ? 'allow' : 'deny',
      precedence: 'custom-role',
      source: {
        kind: 'custom-role-assignment',
        assignmentId: assignment.id,
        roleId: role.id,
      },
    })
  }

  const granted = catalog.defaultGrants[assignment.role.persona].includes(input.permissionId)
  return decision(input, {
    decision: granted ? 'allow' : 'deny',
    precedence: 'launch-persona',
    source: {
      kind: 'launch-persona-assignment',
      assignmentId: assignment.id,
      persona: assignment.role.persona,
    },
  })
}

type ResolvablePermission = Readonly<{
  id: PermissionId
  scopeKind: ResourceScopeKind
  capabilityId: string | null
  activeEntry: PermissionCatalogEntry | null
}>

function registeredPermissions(
  registry: FumaRegistry,
  catalog: PermissionCatalog,
): readonly ResolvablePermission[] {
  const result: ResolvablePermission[] = catalog.permissions.map((entry) => ({
    id: entry.id,
    scopeKind: entry.scopeKind,
    capabilityId: entry.source.kind === 'capability' ? entry.source.capabilityId : null,
    activeEntry: entry,
  }))
  const registeredById = new Map(result.map((permission) => [permission.id, permission]))

  for (const [capabilityIndex, capability] of registry.capabilities.entries()) {
    for (const [permissionIndex, permission] of (capability.permissions ?? []).entries()) {
      const existing = registeredById.get(permission.id)
      if (existing) {
        if (
          existing.activeEntry?.source.kind === 'capability'
          && existing.capabilityId === capability.id
        ) {
          continue
        }
        throw new PermissionCatalogError(
          'duplicate-permission-id',
          `Permission "${permission.id}" collides with the core or another registered permission.`,
          `registry.capabilities.${capabilityIndex}.permissions.${permissionIndex}`,
        )
      }
      const registered = {
        id: permission.id,
        scopeKind: 'site' as const,
        capabilityId: capability.id,
        activeEntry: null,
      }
      result.push(registered)
      registeredById.set(permission.id, registered)
    }
  }
  return result
}

function assertHierarchy(input: LayeredRoleResolverInput): void {
  const { scope, organization, workspace, site } = input
  if (
    organization.id !== scope.organizationId
    || organization.platformId !== scope.platformId
    || workspace.id !== scope.workspaceId
    || workspace.platformId !== scope.platformId
    || workspace.organizationId !== scope.organizationId
    || site.id !== scope.siteId
    || site.platformId !== scope.platformId
    || site.organizationId !== scope.organizationId
    || site.workspaceId !== scope.workspaceId
  ) {
    throw new LayeredPermissionResolverError(
      'scope-mismatch',
      'Organization, workspace, and site records must exactly own the requested site scope.',
      'scope',
    )
  }

  const isPlatformOrganization = organization.id === input.platformOrganizationId
  if (
    (organization.kind === 'platform' && !isPlatformOrganization)
    || (organization.kind === 'customer' && isPlatformOrganization)
  ) {
    throw new LayeredPermissionResolverError(
      'platform-organization-invariant',
      'The platform organization ID and organization kind must identify the same reserved organization.',
      'organization.kind',
    )
  }
  if (organization.kind === 'platform' && organization.status !== 'active') {
    throw new LayeredPermissionResolverError(
      'platform-organization-invariant',
      'The reserved platform organization cannot be suspended or archived.',
      'organization.status',
    )
  }
}

function assertScopeCompatibleOverrides(
  input: LayeredRoleResolverInput,
  permissionsById: ReadonlyMap<PermissionId, ResolvablePermission>,
): void {
  for (const [overrideIndex, override] of input.permissionOverrides.entries()) {
    for (const listName of ['grant', 'deny'] as const) {
      for (const [permissionIndex, permissionId] of override.permissions[listName].entries()) {
        const permission = permissionsById.get(permissionId)
        if (!permission) continue
        if (scopeRank(override.scope) > SCOPE_RANK[permission.scopeKind]) {
          throw new LayeredPermissionResolverError(
            'scope-mismatch',
            `A ${override.scope.kind}-scoped override cannot alter ${permission.scopeKind}-scoped permission "${permissionId}".`,
            `permissionOverrides.${overrideIndex}.permissions.${listName}.${permissionIndex}`,
          )
        }
      }
    }
  }

  const rolesById = new Map(input.customRoles.map((role) => [role.id, role]))
  for (const [assignmentIndex, assignment] of input.roleAssignments.entries()) {
    if (assignment.role.kind !== 'custom-role') continue
    const role = rolesById.get(assignment.role.roleId)
    if (!role) continue
    for (const listName of ['grant', 'deny'] as const) {
      for (const permissionId of role.permissionOverrides[listName]) {
        const permission = permissionsById.get(permissionId)
        if (permission && scopeRank(assignment.scope) > SCOPE_RANK[permission.scopeKind]) {
          throw new LayeredPermissionResolverError(
            'scope-mismatch',
            `Custom role "${role.id}" cannot alter ${permission.scopeKind}-scoped permission "${permissionId}" from a ${assignment.scope.kind} assignment.`,
            `roleAssignments.${assignmentIndex}`,
          )
        }
      }
    }
  }
}

function assertProtectedOwnerPolicy(input: LayeredRoleResolverInput): void {
  const invariant = input.protectedOwnerInvariant
  if (!invariant) return
  if (invariant.subjectId !== input.subjectId || invariant.platformId !== input.scope.platformId) {
    throw new LayeredPermissionResolverError(
      'scope-mismatch',
      'The protected-owner invariant must match the resolved subject and platform.',
      'protectedOwnerInvariant',
    )
  }

  const protectedAssignment = input.roleAssignments.find(({ scope, role }) => (
    scope.kind === 'platform'
    && role.kind === 'launch-persona'
    && role.persona === 'protected-owner'
  ))
  if (!protectedAssignment) {
    throw new LayeredPermissionResolverError(
      'invalid-protected-owner-invariant',
      'A protected-owner invariant requires the matching platform-scoped protected-owner assignment.',
      'protectedOwnerInvariant',
    )
  }
  if (
    input.organization.id === input.platformOrganizationId
    && input.roleAssignments.some(({ id }) => id !== protectedAssignment.id)
  ) {
    throw new LayeredPermissionResolverError(
      'protected-owner-demotion',
      'The protected platform owner cannot receive a descendant role assignment in the platform organization.',
      'roleAssignments',
    )
  }
}

function isRelevantScope(
  record: { readonly scope: ResourceScope },
  permissionScopeKind: ResourceScopeKind,
): boolean {
  return scopeRank(record.scope) <= SCOPE_RANK[permissionScopeKind]
}

function lifecycleReason(
  input: LayeredRoleResolverInput,
  permission: ResolvablePermission,
): Exclude<LayeredPermissionReason,
  | 'capability-disabled'
  | 'permission-undeclared'
  | 'no-membership'
  | 'protected-owner-invariant'
  | 'explicit-deny'
  | 'explicit-grant'
  | 'custom-role-grant'
  | 'custom-role-deny'
  | 'launch-persona-grant'
  | 'launch-persona-deny'
  | 'default-deny'> | null {
  const action = permission.activeEntry?.action ?? permission.id.slice(permission.id.lastIndexOf('.') + 1)
  if (action === 'read' || action === 'access') return null
  if (permission.scopeKind === 'platform') return null

  if (input.organization.status === 'suspended') return 'organization-suspended'
  if (input.organization.status === 'archived') return 'organization-archived'
  if (permission.scopeKind === 'organization') return null
  if (input.workspace.status === 'archived') return 'workspace-archived'
  if (permission.scopeKind === 'workspace') return null
  if (input.site.status === 'archived') return 'site-archived'
  return null
}

function permissionReason(resolved: PermissionDecision): LayeredPermissionReason {
  switch (resolved.precedence) {
    case 'capability-unavailable':
      return resolved.source.kind === 'capability-unavailable'
        ? resolved.source.reason
        : 'permission-undeclared'
    case 'protected-owner-invariant':
      return 'protected-owner-invariant'
    case 'explicit-deny':
      return 'explicit-deny'
    case 'explicit-grant':
      return 'explicit-grant'
    case 'custom-role':
      return resolved.decision === 'allow' ? 'custom-role-grant' : 'custom-role-deny'
    case 'launch-persona':
      return resolved.decision === 'allow' ? 'launch-persona-grant' : 'launch-persona-deny'
    case 'default-deny':
      return 'default-deny'
  }
}

function noMembershipDecision(
  permissionId: PermissionId,
  scope: SiteResourceScope,
): LayeredPermissionDecision {
  return immutable({
    permissionId,
    scope,
    decision: 'deny',
    precedence: 'membership-required',
    source: { kind: 'membership', reason: 'role-assignment-required' },
    reason: 'no-membership',
  })
}

function lifecycleDecision(
  permissionId: PermissionId,
  scope: SiteResourceScope,
  reason: 'organization-suspended' | 'organization-archived' | 'workspace-archived' | 'site-archived',
): LayeredPermissionDecision {
  if (reason === 'organization-suspended' || reason === 'organization-archived') {
    return immutable({
      permissionId,
      scope,
      decision: 'deny',
      precedence: 'lifecycle',
      source: {
        kind: 'lifecycle',
        resource: 'organization',
        status: reason === 'organization-suspended' ? 'suspended' : 'archived',
      },
      reason,
    })
  }
  return immutable({
    permissionId,
    scope,
    decision: 'deny',
    precedence: 'lifecycle',
    source: {
      kind: 'lifecycle',
      resource: reason === 'workspace-archived' ? 'workspace' : 'site',
      status: 'archived',
    },
    reason,
  })
}

function inactiveCapabilityDecision(
  permission: ResolvablePermission,
  scope: SiteResourceScope,
): LayeredPermissionDecision {
  return immutable({
    permissionId: permission.id,
    scope,
    decision: 'deny',
    precedence: 'capability-unavailable',
    source: { kind: 'capability-unavailable', reason: 'capability-disabled' },
    reason: 'capability-disabled',
  })
}

/** Resolves every core and registered capability permission for one exact actor/site hierarchy. */
export function resolveLayeredPermissions(
  rawInput: unknown,
  registry: FumaRegistry = fumaLaunchRegistry,
): LayeredPermissionResolution {
  const input = readInput(rawInput)
  assertHierarchy(input)

  const composedProfile = registry.compose(
    input.site.profileId,
    input.site.capabilityOverrides,
  )
  const catalog = composePermissionCatalog(composedProfile)
  const permissions = registeredPermissions(registry, catalog)
  const permissionsById = new Map(permissions.map((permission) => [permission.id, permission]))
  const knownPermissionIds = new Set(permissionsById.keys())

  assertKnownOverridePermissions(input.permissionOverrides, knownPermissionIds)
  for (const [index, role] of input.customRoles.entries()) {
    assertCustomRolePermissions(role, catalog, `customRoles.${index}`)
  }
  for (const [index, permissionId] of (input.protectedOwnerInvariant?.permissionIds ?? []).entries()) {
    if (!knownPermissionIds.has(permissionId)) {
      throw new LayeredPermissionResolverError(
        'unknown-permission',
        `Protected-owner invariant references unknown permission "${permissionId}".`,
        `protectedOwnerInvariant.permissionIds.${index}`,
      )
    }
  }

  const semanticProbe: PermissionResolverInput = {
    subjectId: input.subjectId,
    permissionId: catalog.permissions[0]?.id ?? 'site.read',
    scope: input.scope,
    capabilityPermission: { kind: 'available', capabilityId: 'core' },
    protectedOwnerInvariant: input.protectedOwnerInvariant,
    roleAssignments: input.roleAssignments,
    permissionOverrides: input.permissionOverrides,
    customRoles: input.customRoles,
  }
  assertPermissionResolverInput(semanticProbe)
  assertProtectedOwnerPolicy(input)
  assertScopeCompatibleOverrides(input, permissionsById)

  const decisions = permissions.map((permission): LayeredPermissionDecision => {
    if (!permission.activeEntry) return inactiveCapabilityDecision(permission, input.scope)

    const relevantAssignments = input.roleAssignments.filter((assignment) => (
      isRelevantScope(assignment, permission.scopeKind)
    ))
    if (relevantAssignments.length === 0) {
      return noMembershipDecision(permission.id, input.scope)
    }

    const deniedByLifecycle = lifecycleReason(input, permission)
    if (deniedByLifecycle) {
      return lifecycleDecision(permission.id, input.scope, deniedByLifecycle)
    }

    const relevantOverrides = input.permissionOverrides
      .filter((override) => isRelevantScope(override, permission.scopeKind))
      .map((override): ScopedPermissionOverride => ({
        ...override,
        permissions: {
          grant: override.permissions.grant.filter((id) => id === permission.id),
          deny: override.permissions.deny.filter((id) => id === permission.id),
        },
      }))

    const resolved = resolvePermission({
      subjectId: input.subjectId,
      permissionId: permission.id,
      scope: input.scope,
      capabilityPermission: permission.capabilityId
        ? { kind: 'available', capabilityId: permission.capabilityId }
        : { kind: 'available', capabilityId: 'core' },
      protectedOwnerInvariant: input.protectedOwnerInvariant,
      roleAssignments: relevantAssignments,
      permissionOverrides: relevantOverrides,
      customRoles: input.customRoles,
    }, catalog)

    return immutable({
      ...resolved,
      scope: input.scope,
      reason: permissionReason(resolved),
    })
  })

  return immutable({
    subjectId: input.subjectId,
    scope: input.scope,
    profileId: input.site.profileId,
    activeCapabilityIds: composedProfile.capabilities.map(({ id }) => id),
    decisions,
    allowedPermissionIds: decisions
      .filter(({ decision: outcome }) => outcome === 'allow')
      .map(({ permissionId }) => permissionId),
    deniedPermissionIds: decisions
      .filter(({ decision: outcome }) => outcome === 'deny')
      .map(({ permissionId }) => permissionId),
  })
}

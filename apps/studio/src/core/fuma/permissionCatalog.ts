import { Type, type Static } from '@sinclair/typebox'
import {
  PermissionDefinitionSchema,
  PermissionIdSchema,
  type ComposedProductProfile,
  type PermissionDefinition,
  type PermissionId,
} from './contracts'
import {
  LAUNCH_PERMISSION_PERSONAS,
  ResourceScopeKindSchema,
  assertCustomRoleDefinition,
  type CustomRoleDefinition,
  type LaunchPermissionPersona,
  type ResourceScopeKind,
} from './permissionContracts'

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T

type Contract<T> = DeepReadonly<T>

export const PermissionAuthoritySchema = Type.Union([
  Type.Literal('customer'),
  Type.Literal('platform'),
  Type.Literal('support'),
  Type.Literal('protected-owner'),
])
export type PermissionAuthority = Contract<Static<typeof PermissionAuthoritySchema>>

export const PermissionCatalogSourceSchema = Type.Union([
  Type.Object({ kind: Type.Literal('core') }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('capability'),
    capabilityId: Type.String({
      minLength: 1,
      pattern: '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$',
    }),
  }, { additionalProperties: false }),
])
export type PermissionCatalogSource = Contract<Static<typeof PermissionCatalogSourceSchema>>

export const PermissionCatalogEntrySchema = Type.Object({
  ...PermissionDefinitionSchema.properties,
  resource: PermissionIdSchema,
  action: Type.String({ minLength: 1, pattern: '^[a-z][a-z0-9-]*$' }),
  scopeKind: ResourceScopeKindSchema,
  authority: PermissionAuthoritySchema,
  source: PermissionCatalogSourceSchema,
  defaultDecision: Type.Literal('deny'),
  assignableToCustomRoles: Type.Boolean(),
}, { additionalProperties: false })
export type PermissionCatalogEntry = Contract<Static<typeof PermissionCatalogEntrySchema>>

const PermissionGrantListSchema = Type.Array(PermissionIdSchema, { uniqueItems: true })

export const PermissionDefaultGrantsSchema = Type.Object({
  'protected-owner': PermissionGrantListSchema,
  owner: PermissionGrantListSchema,
  admin: PermissionGrantListSchema,
  member: PermissionGrantListSchema,
  viewer: PermissionGrantListSchema,
}, { additionalProperties: false })
export type PermissionDefaultGrants = Contract<Static<typeof PermissionDefaultGrantsSchema>>

export const PermissionCatalogSchema = Type.Object({
  permissions: Type.Array(PermissionCatalogEntrySchema, { uniqueItems: true }),
  defaultGrants: PermissionDefaultGrantsSchema,
  customRoleAssignablePermissionIds: PermissionGrantListSchema,
}, { additionalProperties: false })
export type PermissionCatalog = Contract<Static<typeof PermissionCatalogSchema>>

export type PermissionCatalogCompositionOptions = Readonly<{
  capabilityDefaultGrants?: Readonly<
    Partial<Record<LaunchPermissionPersona, readonly PermissionId[]>>
  >
}>

export const PermissionCatalogErrorCodeSchema = Type.Union([
  Type.Literal('duplicate-permission-id'),
  Type.Literal('conflicting-permission-resource'),
  Type.Literal('invalid-permission-id'),
  Type.Literal('unknown-permission'),
  Type.Literal('invalid-capability-default-grant'),
  Type.Literal('permission-above-custom-role-ceiling'),
  Type.Literal('permission-outside-custom-role-scope'),
])
export type PermissionCatalogErrorCode = Contract<
  Static<typeof PermissionCatalogErrorCodeSchema>
>

export class PermissionCatalogError extends Error {
  readonly code: PermissionCatalogErrorCode
  readonly path: string

  constructor(code: PermissionCatalogErrorCode, message: string, path: string) {
    super(message)
    this.name = 'PermissionCatalogError'
    this.code = code
    this.path = path
  }
}

type CorePermissionSeed = Readonly<{
  definition: PermissionDefinition
  scopeKind: ResourceScopeKind
  authority: PermissionAuthority
  defaultPersonas: readonly LaunchPermissionPersona[]
  assignableToCustomRoles: boolean
}>

const SCOPE_RANK: Readonly<Record<ResourceScopeKind, number>> = Object.freeze({
  platform: 0,
  organization: 1,
  workspace: 2,
  site: 3,
})

const PROTECTED_OWNER = ['protected-owner'] as const
const CUSTOMER_OWNERS = ['protected-owner', 'owner'] as const
const CUSTOMER_ADMINS = ['protected-owner', 'owner', 'admin'] as const
const CUSTOMER_MEMBERS = ['protected-owner', 'owner', 'admin', 'member'] as const
const CUSTOMER_VIEWERS = [
  'protected-owner',
  'owner',
  'admin',
  'member',
  'viewer',
] as const

const CORE_PERMISSION_SEEDS: readonly CorePermissionSeed[] = [
  corePermission('platform.organizations.read', 'View organizations', 'View organizations hosted by the platform.', 'platform', 'platform', PROTECTED_OWNER, false),
  corePermission('platform.organizations.manage', 'Manage organizations', 'Create, suspend, and restore platform organizations.', 'platform', 'platform', PROTECTED_OWNER, false),
  corePermission('platform.roles.manage', 'Manage platform roles', 'Manage platform-level authority and protected-owner policy.', 'platform', 'protected-owner', PROTECTED_OWNER, false),
  corePermission('platform.settings.read', 'View platform settings', 'View platform-wide settings.', 'platform', 'platform', PROTECTED_OWNER, false),
  corePermission('platform.settings.write', 'Edit platform settings', 'Edit platform-wide settings.', 'platform', 'protected-owner', PROTECTED_OWNER, false),
  corePermission('support.access', 'Access support tools', 'Access internal customer-support tools.', 'platform', 'support', PROTECTED_OWNER, false),
  corePermission('support.organizations.read', 'Inspect supported organizations', 'Inspect organization state for an authorized support case.', 'platform', 'support', PROTECTED_OWNER, false),
  corePermission('support.sessions.revoke', 'Revoke supported sessions', 'Revoke customer sessions during an authorized support case.', 'platform', 'support', PROTECTED_OWNER, false),

  corePermission('organization.read', 'View organization', 'View organization identity and status.', 'organization', 'customer', CUSTOMER_VIEWERS, true),
  corePermission('organization.update', 'Edit organization', 'Edit organization identity and settings.', 'organization', 'customer', CUSTOMER_ADMINS, true),
  corePermission('organization.delete', 'Delete organization', 'Delete an organization through its protected lifecycle.', 'organization', 'customer', CUSTOMER_OWNERS, false),
  corePermission('organization.members.read', 'View organization members', 'View organization membership.', 'organization', 'customer', CUSTOMER_ADMINS, true),
  corePermission('organization.members.manage', 'Manage organization members', 'Invite, update, and remove organization members.', 'organization', 'customer', CUSTOMER_OWNERS, false),
  corePermission('organization.workspaces.create', 'Create workspaces', 'Create workspaces in the organization.', 'organization', 'customer', CUSTOMER_ADMINS, true),

  corePermission('workspace.read', 'View workspace', 'View workspace identity and status.', 'workspace', 'customer', CUSTOMER_VIEWERS, true),
  corePermission('workspace.update', 'Edit workspace', 'Edit workspace identity and settings.', 'workspace', 'customer', CUSTOMER_ADMINS, true),
  corePermission('workspace.delete', 'Delete workspace', 'Delete a workspace through its protected lifecycle.', 'workspace', 'customer', CUSTOMER_OWNERS, false),
  corePermission('workspace.members.read', 'View workspace members', 'View workspace membership.', 'workspace', 'customer', CUSTOMER_ADMINS, true),
  corePermission('workspace.members.manage', 'Manage workspace members', 'Add, update, and remove workspace members.', 'workspace', 'customer', CUSTOMER_OWNERS, false),
  corePermission('workspace.sites.create', 'Create sites', 'Create sites in the workspace.', 'workspace', 'customer', CUSTOMER_ADMINS, true),

  corePermission('site.read', 'View site', 'View site identity and status.', 'site', 'customer', CUSTOMER_VIEWERS, true),
  corePermission('site.update', 'Edit site', 'Edit site identity and non-profile settings.', 'site', 'customer', CUSTOMER_MEMBERS, true),
  corePermission('site.delete', 'Delete site', 'Delete a site through its protected lifecycle.', 'site', 'customer', CUSTOMER_OWNERS, false),
  corePermission('site.members.read', 'View site members', 'View site-level access assignments.', 'site', 'customer', CUSTOMER_ADMINS, true),
  corePermission('site.members.manage', 'Manage site members', 'Add, update, and remove site-level access assignments.', 'site', 'customer', CUSTOMER_OWNERS, false),
  corePermission('site.profile.manage', 'Manage site profile', 'Change site capability grants and profile settings.', 'site', 'customer', CUSTOMER_ADMINS, true),
]

function corePermission(
  id: PermissionId,
  label: string,
  description: string,
  scopeKind: ResourceScopeKind,
  authority: PermissionAuthority,
  defaultPersonas: readonly LaunchPermissionPersona[],
  assignableToCustomRoles: boolean,
): CorePermissionSeed {
  return {
    definition: { id, label, description },
    scopeKind,
    authority,
    defaultPersonas,
    assignableToCustomRoles,
  }
}

function permissionCoordinates(permissionId: PermissionId, path: string): {
  resource: PermissionId
  action: string
} {
  const separator = permissionId.lastIndexOf('.')
  if (separator <= 0 || separator === permissionId.length - 1) {
    throw new PermissionCatalogError(
      'invalid-permission-id',
      `Permission "${permissionId}" must identify both a resource and an action.`,
      path,
    )
  }
  return {
    resource: permissionId.slice(0, separator),
    action: permissionId.slice(separator + 1),
  }
}

function entryFromSeed(seed: CorePermissionSeed, index: number): PermissionCatalogEntry {
  return {
    ...seed.definition,
    ...permissionCoordinates(seed.definition.id, `corePermissions.${index}.id`),
    scopeKind: seed.scopeKind,
    authority: seed.authority,
    source: { kind: 'core' },
    defaultDecision: 'deny',
    assignableToCustomRoles: seed.assignableToCustomRoles,
  }
}

function entryFromCapability(
  permission: PermissionDefinition,
  capabilityId: string,
  path: string,
): PermissionCatalogEntry {
  const coordinates = permissionCoordinates(permission.id, `${path}.id`)
  const reservedAuthority = [
    'admin',
    'console',
    'internal',
    'organization',
    'platform',
    'protected-owner',
    'support',
    'workspace',
  ].find((namespace) => (
    coordinates.resource === namespace || coordinates.resource.startsWith(`${namespace}.`)
  ))
  if (reservedAuthority) {
    throw new PermissionCatalogError(
      'conflicting-permission-resource',
      `Site capability "${capabilityId}" cannot claim reserved ${reservedAuthority} resource "${coordinates.resource}".`,
      path,
    )
  }

  return {
    ...permission,
    ...coordinates,
    scopeKind: 'site',
    authority: 'customer',
    source: { kind: 'capability', capabilityId },
    defaultDecision: 'deny',
    assignableToCustomRoles: true,
  }
}

function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) immutable(nested)
    Object.freeze(value)
  }
  return value
}

function emptyDefaultGrants(): Record<LaunchPermissionPersona, PermissionId[]> {
  return {
    'protected-owner': [],
    owner: [],
    admin: [],
    member: [],
    viewer: [],
  }
}

function resourceAuthoritiesAreCompatible(
  existing: PermissionCatalogEntry,
  incoming: PermissionCatalogEntry,
): boolean {
  if (existing.authority === incoming.authority) return true
  if (existing.scopeKind !== 'platform' || incoming.scopeKind !== 'platform') return false
  const platformAuthorities = new Set<PermissionAuthority>([
    'platform',
    'protected-owner',
  ])
  return platformAuthorities.has(existing.authority)
    && platformAuthorities.has(incoming.authority)
}

function addEntry(
  entry: PermissionCatalogEntry,
  path: string,
  permissions: PermissionCatalogEntry[],
  permissionsById: Map<PermissionId, PermissionCatalogEntry>,
  resources: Map<PermissionId, PermissionCatalogEntry>,
): void {
  const existingPermission = permissionsById.get(entry.id)
  if (existingPermission) {
    throw new PermissionCatalogError(
      'duplicate-permission-id',
      `Permission "${entry.id}" is declared by both ${sourceLabel(existingPermission)} and ${sourceLabel(entry)}.`,
      path,
    )
  }

  const existingResource = resources.get(entry.resource)
  if (
    existingResource
    && (
      existingResource.scopeKind !== entry.scopeKind
      || !resourceAuthoritiesAreCompatible(existingResource, entry)
    )
    && (
      existingResource.source.kind === 'capability'
      || entry.source.kind === 'capability'
    )
  ) {
    throw new PermissionCatalogError(
      'conflicting-permission-resource',
      `Resource "${entry.resource}" cannot be both ${resourceLabel(existingResource)} and ${resourceLabel(entry)}.`,
      path,
    )
  }

  permissions.push(entry)
  permissionsById.set(entry.id, entry)
  resources.set(entry.resource, existingResource ?? entry)
}

function sourceLabel(entry: PermissionCatalogEntry): string {
  return entry.source.kind === 'core'
    ? 'the core catalog'
    : `capability "${entry.source.capabilityId}"`
}

function resourceLabel(entry: PermissionCatalogEntry): string {
  return `${entry.scopeKind}-scoped ${entry.authority} authority`
}

function appendUniqueGrant(
  grants: Record<LaunchPermissionPersona, PermissionId[]>,
  persona: LaunchPermissionPersona,
  permissionId: PermissionId,
  path: string,
): void {
  if (grants[persona].includes(permissionId)) {
    throw new PermissionCatalogError(
      'invalid-capability-default-grant',
      `Default grants for "${persona}" repeat permission "${permissionId}".`,
      path,
    )
  }
  grants[persona].push(permissionId)
}

function appendHierarchicalCapabilityGrant(
  grants: Record<LaunchPermissionPersona, PermissionId[]>,
  persona: LaunchPermissionPersona,
  permissionId: PermissionId,
  path: string,
): void {
  appendUniqueGrant(grants, persona, permissionId, path)
  const personaIndex = LAUNCH_PERMISSION_PERSONAS.indexOf(persona)
  for (const strongerPersona of LAUNCH_PERMISSION_PERSONAS.slice(0, personaIndex)) {
    if (!grants[strongerPersona].includes(permissionId)) {
      grants[strongerPersona].push(permissionId)
    }
  }
}

function createBasePermissionCatalog(): PermissionCatalog {
  const permissions: PermissionCatalogEntry[] = []
  const permissionsById = new Map<PermissionId, PermissionCatalogEntry>()
  const resources = new Map<PermissionId, PermissionCatalogEntry>()
  const defaultGrants = emptyDefaultGrants()

  for (const [index, seed] of CORE_PERMISSION_SEEDS.entries()) {
    const entry = entryFromSeed(seed, index)
    addEntry(entry, `corePermissions.${index}`, permissions, permissionsById, resources)
    for (const persona of seed.defaultPersonas) defaultGrants[persona].push(entry.id)
  }

  return immutable({
    permissions,
    defaultGrants,
    customRoleAssignablePermissionIds: permissions
      .filter(({ assignableToCustomRoles }) => assignableToCustomRoles)
      .map(({ id }) => id),
  })
}

const CAPABILITY_OWNERS = ['protected-owner', 'owner'] as const
const CAPABILITY_ADMINS = ['protected-owner', 'owner', 'admin'] as const
const CAPABILITY_MEMBERS = ['protected-owner', 'owner', 'admin', 'member'] as const
const CAPABILITY_VIEWERS = [
  'protected-owner',
  'owner',
  'admin',
  'member',
  'viewer',
] as const

/** Launch permission policy is keyed by permission contribution, never by profile identity. */
export const FUMA_CAPABILITY_PERMISSION_DEFAULT_PERSONAS: Readonly<
  Partial<Record<PermissionId, readonly LaunchPermissionPersona[]>>
> = immutable({
  'site.home.read': CAPABILITY_VIEWERS,
  'website.content.read': CAPABILITY_VIEWERS,
  'content.pages.read': CAPABILITY_VIEWERS,
  'content.pages.write': CAPABILITY_MEMBERS,
  'website.data.read': CAPABILITY_VIEWERS,
  'website.media.read': CAPABILITY_VIEWERS,
  'website.analytics.read': CAPABILITY_VIEWERS,
  'website.design.read': CAPABILITY_VIEWERS,
  'website.design.write': CAPABILITY_ADMINS,
  'site.settings.read': CAPABILITY_VIEWERS,
  'site.settings.write': CAPABILITY_ADMINS,
  'publication.posts.read': CAPABILITY_VIEWERS,
  'publication.posts.write': CAPABILITY_MEMBERS,
  'publication.workflow.read': CAPABILITY_VIEWERS,
  'publication.workflow.assign': CAPABILITY_ADMINS,
  'publication.workflow.review': CAPABILITY_MEMBERS,
  'publication.workflow.approve': CAPABILITY_ADMINS,
  'publication.posts.schedule': CAPABILITY_ADMINS,
  'publication.tags.read': CAPABILITY_VIEWERS,
  'publication.tags.write': CAPABILITY_ADMINS,
  'publication.members.read': CAPABILITY_VIEWERS,
  'publication.members.write': CAPABILITY_ADMINS,
  'publication.newsletters.read': CAPABILITY_VIEWERS,
  'publication.newsletters.write': CAPABILITY_ADMINS,
  'publication.newsletters.send': CAPABILITY_OWNERS,
  'publication.analytics.read': CAPABILITY_VIEWERS,
})

/** Management permissions and launch-persona grants before any site capabilities are composed. */
export const FUMA_BASE_PERMISSION_CATALOG = createBasePermissionCatalog()

/**
 * Merges the permissions emitted by a composed Fuma profile into the management catalog.
 * Capability declarations are profile-agnostic, site-scoped, custom-role assignable, and
 * deny-by-default until a resolver sees an explicit role or a declared default grant.
 */
export function composePermissionCatalog(
  composedProfile: ComposedProductProfile,
  options: PermissionCatalogCompositionOptions = {},
): PermissionCatalog {
  const permissions = [...FUMA_BASE_PERMISSION_CATALOG.permissions]
  const permissionsById = new Map(permissions.map((entry) => [entry.id, entry]))
  const resources = new Map<PermissionId, PermissionCatalogEntry>()
  for (const entry of permissions) resources.set(entry.resource, resources.get(entry.resource) ?? entry)

  for (const [capabilityIndex, capability] of composedProfile.capabilities.entries()) {
    for (const [permissionIndex, permission] of (capability.permissions ?? []).entries()) {
      const path = `composedProfile.capabilities.${capabilityIndex}.permissions.${permissionIndex}`
      addEntry(
        entryFromCapability(permission, capability.id, path),
        path,
        permissions,
        permissionsById,
        resources,
      )
    }
  }

  const defaultGrants = Object.fromEntries(
    LAUNCH_PERMISSION_PERSONAS.map((persona) => [
      persona,
      [...FUMA_BASE_PERMISSION_CATALOG.defaultGrants[persona]],
    ]),
  ) as Record<LaunchPermissionPersona, PermissionId[]>

  for (const entry of permissions) {
    if (entry.source.kind !== 'capability') continue
    for (const persona of FUMA_CAPABILITY_PERMISSION_DEFAULT_PERSONAS[entry.id] ?? []) {
      defaultGrants[persona].push(entry.id)
    }
  }

  for (const persona of LAUNCH_PERMISSION_PERSONAS) {
    for (const [index, permissionId] of (
      options.capabilityDefaultGrants?.[persona] ?? []
    ).entries()) {
      const path = `options.capabilityDefaultGrants.${persona}.${index}`
      const entry = permissionsById.get(permissionId)
      if (!entry) {
        throw new PermissionCatalogError(
          'unknown-permission',
          `Capability default references unknown permission "${permissionId}".`,
          path,
        )
      }
      if (entry.source.kind !== 'capability') {
        throw new PermissionCatalogError(
          'invalid-capability-default-grant',
          `Permission "${permissionId}" is not contributed by a composed capability.`,
          path,
        )
      }
      appendHierarchicalCapabilityGrant(defaultGrants, persona, permissionId, path)
    }
  }

  for (const persona of LAUNCH_PERMISSION_PERSONAS) {
    if (persona === 'protected-owner') continue
    const forbidden = defaultGrants[persona].find((permissionId) => {
      const entry = permissionsById.get(permissionId)
      return entry?.authority !== 'customer'
    })
    if (forbidden) {
      throw new PermissionCatalogError(
        'invalid-capability-default-grant',
        `Customer persona "${persona}" cannot receive platform, support, or protected-owner permission "${forbidden}".`,
        `defaultGrants.${persona}`,
      )
    }
  }

  return immutable({
    permissions,
    defaultGrants,
    customRoleAssignablePermissionIds: permissions
      .filter(({ assignableToCustomRoles, authority }) => (
        assignableToCustomRoles && authority === 'customer'
      ))
      .map(({ id }) => id),
  })
}

/** Validates custom-role references against one composed catalog and its assignable ceiling. */
export function assertCustomRolePermissions(
  role: CustomRoleDefinition,
  catalog: PermissionCatalog,
  path = 'customRole',
): void {
  assertCustomRoleDefinition(role, path)
  const permissionsById = new Map(catalog.permissions.map((entry) => [entry.id, entry]))
  const ceiling = new Set(catalog.customRoleAssignablePermissionIds)

  for (const listName of ['grant', 'deny'] as const) {
    for (const [index, permissionId] of role.permissionOverrides[listName].entries()) {
      const permissionPath = `${path}.permissionOverrides.${listName}.${index}`
      const entry = permissionsById.get(permissionId)
      if (!entry) {
        throw new PermissionCatalogError(
          'unknown-permission',
          `Custom role "${role.id}" references unknown permission "${permissionId}".`,
          permissionPath,
        )
      }
      if (
        !ceiling.has(permissionId)
        || !entry.assignableToCustomRoles
        || entry.authority !== 'customer'
      ) {
        throw new PermissionCatalogError(
          'permission-above-custom-role-ceiling',
          `Custom role "${role.id}" cannot reference ${entry.authority} permission "${permissionId}".`,
          permissionPath,
        )
      }
      if (SCOPE_RANK[role.scope.kind] > SCOPE_RANK[entry.scopeKind]) {
        throw new PermissionCatalogError(
          'permission-outside-custom-role-scope',
          `A ${role.scope.kind}-owned custom role cannot alter ${entry.scopeKind}-scoped permission "${permissionId}".`,
          permissionPath,
        )
      }
    }
  }
}

import {
  CapabilityOverridesSchema,
  ComposedProductProfileSchema,
  type CapabilityOverrides,
  type ComposedProductProfile,
} from './contracts'
import { Type, Value, type Static } from '@core/utils/typeboxHelpers'
import { ManagedClientCatalogEntrySchema } from './managedClientContracts'
export {
  ManagedClientCatalogEntrySchema,
  ManagedClientSiteViewSchema,
  ManagedClientWorkspaceViewSchema,
  ManagedClientsViewSchema,
} from './managedClientContracts'
export type {
  ManagedClientCatalogEntry,
  ManagedClientSiteView,
  ManagedClientWorkspaceView,
  ManagedClientsView,
} from './managedClientContracts'

const ID_OPTIONS = { minLength: 1, maxLength: 255 } as const
const NAME_OPTIONS = { minLength: 1, maxLength: 255 } as const
const PROFILE_RELATIVE_PATH_PATTERN = '^/admin(?:/[A-Za-z0-9._~-]+)*$'

const ContextIdSchema = Type.String(ID_OPTIONS)
const ContextNameSchema = Type.String(NAME_OPTIONS)

export const OrganizationCatalogEntrySchema = Type.Object({
  id: ContextIdSchema,
  name: ContextNameSchema,
  status: Type.Union([Type.Literal('active'), Type.Literal('suspended')]),
  /**
   * Who owns this organization, for display.
   *
   * OPTIONAL rather than required: an organization can legitimately have no membership row with the
   * owner role (mid-transfer, or an owner whose account was removed), and a required field would make
   * the whole catalog fail to validate for every other organization the user can see. Absent means
   * "not known", which the interface can omit rather than assert.
   */
  ownerLabel: Type.Optional(ContextNameSchema),
}, { additionalProperties: false })
export type OrganizationCatalogEntry = Static<typeof OrganizationCatalogEntrySchema>

export const WorkspaceCatalogEntrySchema = Type.Object({
  id: ContextIdSchema,
  organizationId: ContextIdSchema,
  name: ContextNameSchema,
  status: Type.Union([Type.Literal('active'), Type.Literal('archived')]),
  isDefault: Type.Boolean(),
}, { additionalProperties: false })
export type WorkspaceCatalogEntry = Static<typeof WorkspaceCatalogEntrySchema>

export const SiteCatalogEntrySchema = Type.Object({
  id: ContextIdSchema,
  organizationId: ContextIdSchema,
  workspaceId: ContextIdSchema,
  name: ContextNameSchema,
  status: Type.Union([Type.Literal('active'), Type.Literal('archived')]),
  profileId: ContextIdSchema,
  capabilityOverrides: CapabilityOverridesSchema,
}, { additionalProperties: false })
export type SiteCatalogEntry = Static<typeof SiteCatalogEntrySchema>

export const AccessibleContextCatalogSchema = Type.Object({
  organizations: Type.Array(OrganizationCatalogEntrySchema),
  workspaces: Type.Array(WorkspaceCatalogEntrySchema),
  sites: Type.Array(SiteCatalogEntrySchema),
  managedClients: Type.Optional(Type.Array(ManagedClientCatalogEntrySchema)),
}, { additionalProperties: false })
export type AccessibleContextCatalog = Static<typeof AccessibleContextCatalogSchema>

export const StableContextSelectionSchema = Type.Object({
  organizationId: ContextIdSchema,
  workspaceId: ContextIdSchema,
  siteId: ContextIdSchema,
}, { additionalProperties: false })
export type StableContextSelection = Static<typeof StableContextSelectionSchema>

export const BrowserContextPreferenceSchema = Type.Object({
  version: Type.Literal(1),
  selection: StableContextSelectionSchema,
}, { additionalProperties: false })
export type BrowserContextPreference = Static<typeof BrowserContextPreferenceSchema>

export const ProfileRelativeSubpathSchema = Type.String({
  pattern: PROFILE_RELATIVE_PATH_PATTERN,
})
export type ProfileRelativeSubpath = Static<typeof ProfileRelativeSubpathSchema>

export const InvitationEntrySchema = Type.Object({
  kind: Type.Literal('invitation'),
  invitationId: Type.String({ minLength: 1, maxLength: 2048 }),
}, { additionalProperties: false })
export type InvitationEntry = Static<typeof InvitationEntrySchema>

export const ScopedSelectionRouteEntrySchema = Type.Object({
  kind: Type.Literal('selection'),
  selection: StableContextSelectionSchema,
  profileRelativeSubpath: ProfileRelativeSubpathSchema,
}, { additionalProperties: false })
export type ScopedSelectionRouteEntry = Static<typeof ScopedSelectionRouteEntrySchema>

export const ScopedAdminRouteEntrySchema = Type.Union([
  ScopedSelectionRouteEntrySchema,
  InvitationEntrySchema,
])
export type ScopedAdminRouteEntry = Static<typeof ScopedAdminRouteEntrySchema>

const ResolutionSourceSchema = Type.Union([
  Type.Literal('url'),
  Type.Literal('browser-preference'),
  Type.Literal('catalog-default'),
])

const MissingResolutionSchema = Type.Object({
  kind: Type.Literal('missing'),
  source: ResolutionSourceSchema,
  scope: Type.Union([
    Type.Literal('context'),
    Type.Literal('workspace'),
    Type.Literal('site'),
  ]),
}, { additionalProperties: false })

const UnauthorizedResolutionSchema = Type.Object({
  kind: Type.Literal('unauthorized'),
  source: ResolutionSourceSchema,
  scope: Type.Union([
    Type.Literal('organization'),
    Type.Literal('workspace'),
    Type.Literal('site'),
  ]),
  selection: StableContextSelectionSchema,
}, { additionalProperties: false })

const OwnedResolutionFields = {
  source: ResolutionSourceSchema,
  selection: StableContextSelectionSchema,
  profileRelativeSubpath: ProfileRelativeSubpathSchema,
  organization: OrganizationCatalogEntrySchema,
  workspace: WorkspaceCatalogEntrySchema,
  site: SiteCatalogEntrySchema,
}

const OrganizationSuspendedResolutionSchema = Type.Object({
  kind: Type.Literal('organization-suspended'),
  ...OwnedResolutionFields,
}, { additionalProperties: false })

const WorkspaceArchivedResolutionSchema = Type.Object({
  kind: Type.Literal('workspace-archived'),
  ...OwnedResolutionFields,
}, { additionalProperties: false })

const SiteArchivedResolutionSchema = Type.Object({
  kind: Type.Literal('site-archived'),
  ...OwnedResolutionFields,
}, { additionalProperties: false })

const ReadyResolutionSchema = Type.Object({
  kind: Type.Literal('ready'),
  ...OwnedResolutionFields,
  profile: ComposedProductProfileSchema,
}, { additionalProperties: false })

const InvitationResolutionSchema = Type.Object({
  kind: Type.Literal('invitation'),
  source: Type.Literal('url'),
  invitation: InvitationEntrySchema,
}, { additionalProperties: false })

export const ScopedContextResolutionSchema = Type.Union([
  ReadyResolutionSchema,
  MissingResolutionSchema,
  UnauthorizedResolutionSchema,
  OrganizationSuspendedResolutionSchema,
  WorkspaceArchivedResolutionSchema,
  SiteArchivedResolutionSchema,
  InvitationResolutionSchema,
])
export type ScopedContextResolution = Static<typeof ScopedContextResolutionSchema>
export type ReadyScopedContextResolution = Static<typeof ReadyResolutionSchema>

export const ScopedContextSelectionErrorCodeSchema = Type.Union([
  Type.Literal('invalid-catalog'),
  Type.Literal('invalid-profile'),
  Type.Literal('invalid-selection'),
  Type.Literal('invalid-subpath'),
  Type.Literal('invalid-url'),
])
export type ScopedContextSelectionErrorCode = Static<
  typeof ScopedContextSelectionErrorCodeSchema
>

export class ScopedContextSelectionError extends Error {
  readonly code: ScopedContextSelectionErrorCode

  constructor(code: ScopedContextSelectionErrorCode, message: string) {
    super(message)
    this.name = 'ScopedContextSelectionError'
    this.code = code
  }
}

export type ScopedContextProfileRegistry = Readonly<{
  compose: (
    profileId: string,
    overrides: CapabilityOverrides,
  ) => ComposedProductProfile
}>

export type ResolveScopedAdminContextInput = Readonly<{
  url: string
  catalog: AccessibleContextCatalog
  browserPreference?: unknown
}>

type ResolutionSource = Static<typeof ResolutionSourceSchema>

type OwnedContext = Readonly<{
  selection: StableContextSelection
  organization: OrganizationCatalogEntry
  workspace: WorkspaceCatalogEntry
  site: SiteCatalogEntry
}>

function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) immutable(nested)
    Object.freeze(value)
  }
  return value
}

function parseUrl(value: string): URL {
  try {
    return new URL(value, 'https://app.fuma.invalid')
  } catch (_error) {
    throw new ScopedContextSelectionError(
      'invalid-url',
      'scoped admin URL is invalid',
    )
  }
}

function decodeRouteSegment(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value)
    return Value.Check(ContextIdSchema, decoded) ? decoded : null
  } catch (_error) {
    // A malformed percent escape is an invalid route, not an ambient failure.
    return null
  }
}

/** Returns a normalized shell path only when it cannot escape the profile's /admin root. */
export function validateProfileRelativeSubpath(value: unknown): ProfileRelativeSubpath | null {
  if (!Value.Check(ProfileRelativeSubpathSchema, value)) return null
  const segments = value.split('/').slice(2)
  if (segments.some((segment) => segment === '.' || segment === '..')) return null
  return value.replace(/\/+$/, '') || '/admin'
}

function requiredProfileRelativeSubpath(value: unknown): ProfileRelativeSubpath {
  const validated = validateProfileRelativeSubpath(value)
  if (validated === null) {
    throw new ScopedContextSelectionError(
      'invalid-subpath',
      'profile-relative subpath must stay within the /admin shell',
    )
  }
  return validated
}

function assertSelection(value: unknown): asserts value is StableContextSelection {
  if (!Value.Check(StableContextSelectionSchema, value)) {
    throw new ScopedContextSelectionError(
      'invalid-selection',
      'stable context selection must contain a complete organization/workspace/site chain',
    )
  }
}

function encodedSelectionPrefix(selection: StableContextSelection): string {
  return [
    '/admin/organizations',
    encodeURIComponent(selection.organizationId),
    'workspaces',
    encodeURIComponent(selection.workspaceId),
    'sites',
    encodeURIComponent(selection.siteId),
  ].join('/')
}

/** Builds the sole canonical fully-qualified tenant route. */
export function buildScopedAdminUrl(
  selection: StableContextSelection,
  profileRelativeSubpath: ProfileRelativeSubpath = '/admin',
): string {
  assertSelection(selection)
  const subpath = requiredProfileRelativeSubpath(profileRelativeSubpath)
  const suffix = subpath === '/admin' ? '' : subpath.slice('/admin'.length)
  return `${encodedSelectionPrefix(selection)}${suffix}`
}

export function buildInvitationAdminUrl(invitationId: string): string {
  if (!Value.Check(InvitationEntrySchema, { kind: 'invitation', invitationId })) {
    throw new ScopedContextSelectionError(
      'invalid-selection',
      'invitation ID is invalid',
    )
  }
  return `/admin/invitations/${encodeURIComponent(invitationId)}`
}

/** Parses only canonical fully-qualified context routes or invitation entry routes. */
export function parseScopedAdminUrl(url: string): ScopedAdminRouteEntry | null {
  const { pathname } = parseUrl(url)
  const invitationPrefix = '/admin/invitations/'
  if (pathname.startsWith(invitationPrefix)) {
    const encodedId = pathname.slice(invitationPrefix.length)
    if (encodedId.length === 0 || encodedId.includes('/')) return null
    let invitationId: string
    try {
      invitationId = decodeURIComponent(encodedId)
    } catch (_error) {
      // A malformed percent escape is an invalid invitation route.
      return null
    }
    const entry: InvitationEntry = { kind: 'invitation', invitationId }
    return Value.Check(InvitationEntrySchema, entry) ? immutable(entry) : null
  }

  const segments = pathname.split('/').slice(1)
  if (
    segments.length < 7
    || segments[0] !== 'admin'
    || segments[1] !== 'organizations'
    || segments[3] !== 'workspaces'
    || segments[5] !== 'sites'
  ) return null

  const organizationId = decodeRouteSegment(segments[2] ?? '')
  const workspaceId = decodeRouteSegment(segments[4] ?? '')
  const siteId = decodeRouteSegment(segments[6] ?? '')
  if (organizationId === null || workspaceId === null || siteId === null) return null

  const tail = segments.slice(7)
  let decodedTail: string[]
  try {
    decodedTail = tail.map((segment) => decodeURIComponent(segment))
  } catch (_error) {
    // A malformed percent escape is an invalid route.
    return null
  }
  const profileRelativeSubpath = validateProfileRelativeSubpath(
    decodedTail.length === 0 ? '/admin' : `/admin/${decodedTail.join('/')}`,
  )
  if (profileRelativeSubpath === null) return null

  return immutable({
    kind: 'selection',
    selection: { organizationId, workspaceId, siteId },
    profileRelativeSubpath,
  })
}

export function assertAccessibleContextCatalog(catalog: AccessibleContextCatalog): void {
  if (!Value.Check(AccessibleContextCatalogSchema, catalog)) {
    throw new ScopedContextSelectionError(
      'invalid-catalog',
      'accessible context catalog does not match its TypeBox contract',
    )
  }

  const organizationKeys = new Set<string>()
  for (const organization of catalog.organizations) {
    if (organizationKeys.has(organization.id)) {
      throw new ScopedContextSelectionError('invalid-catalog', 'organization catalog IDs must be unique')
    }
    organizationKeys.add(organization.id)
  }

  const workspaceKeys = new Set<string>()
  for (const workspace of catalog.workspaces) {
    const key = `${workspace.organizationId}\u0000${workspace.id}`
    if (!organizationKeys.has(workspace.organizationId) || workspaceKeys.has(key)) {
      throw new ScopedContextSelectionError(
        'invalid-catalog',
        'every workspace must have one unique organization-qualified owner',
      )
    }
    workspaceKeys.add(key)
  }

  const managedClientKeys = new Set<string>()
  for (const managedClient of catalog.managedClients ?? []) {
    const workspaceKey = `${managedClient.organizationId}\u0000${managedClient.workspaceId}`
    if (!workspaceKeys.has(workspaceKey) || managedClientKeys.has(workspaceKey)) {
      throw new ScopedContextSelectionError(
        'invalid-catalog',
        'every managed client must reference one unique authorized workspace',
      )
    }
    if (managedClient.intendedOrganizationId === managedClient.organizationId) {
      throw new ScopedContextSelectionError(
        'invalid-catalog',
        'a managed-client destination cannot be its current owner',
      )
    }
    managedClientKeys.add(workspaceKey)
  }

  const siteKeys = new Set<string>()
  for (const site of catalog.sites) {
    const workspaceKey = `${site.organizationId}\u0000${site.workspaceId}`
    const siteKey = `${workspaceKey}\u0000${site.id}`
    if (!workspaceKeys.has(workspaceKey) || siteKeys.has(siteKey)) {
      throw new ScopedContextSelectionError(
        'invalid-catalog',
        'every site must have one unique organization/workspace-qualified owner',
      )
    }
    siteKeys.add(siteKey)
  }
}

function exactOwnedContext(
  selection: StableContextSelection,
  catalog: AccessibleContextCatalog,
  source: ResolutionSource,
  profileRelativeSubpath: ProfileRelativeSubpath,
): ScopedContextResolution | OwnedContext {
  const organization = catalog.organizations.find(({ id }) => id === selection.organizationId)
  if (!organization) {
    return { kind: 'unauthorized', source, scope: 'organization', selection }
  }

  const workspace = catalog.workspaces.find((entry) => (
    entry.organizationId === selection.organizationId
    && entry.id === selection.workspaceId
  ))
  if (!workspace) {
    const scope = catalog.workspaces.some(({ id }) => id === selection.workspaceId)
      ? 'workspace'
      : null

    return scope
      ? { kind: 'unauthorized', source, scope, selection }
      : { kind: 'missing', source, scope: 'workspace' }
  }

  const site = catalog.sites.find((entry) => (
    entry.organizationId === selection.organizationId
    && entry.workspaceId === selection.workspaceId
    && entry.id === selection.siteId
  ))
  if (!site) {
    const scope = catalog.sites.some(({ id }) => id === selection.siteId)
      ? 'site'
      : null
    return scope
      ? { kind: 'unauthorized', source, scope, selection }
      : { kind: 'missing', source, scope: 'site' }
  }

  const owned = { selection, organization, workspace, site }
  if (organization.status === 'suspended') {
    return { kind: 'organization-suspended', source, profileRelativeSubpath, ...owned }
  }
  if (workspace.status === 'archived') {
    return { kind: 'workspace-archived', source, profileRelativeSubpath, ...owned }
  }
  if (site.status === 'archived') {
    return { kind: 'site-archived', source, profileRelativeSubpath, ...owned }
  }
  return owned
}

function deterministicSelection(
  catalog: AccessibleContextCatalog,
  organizationId?: string,
  workspaceId?: string,
): StableContextSelection | null {
  const organizations = catalog.organizations
    .filter((entry) => entry.status === 'active' && (organizationId === undefined || entry.id === organizationId))
    .toSorted((left, right) => left.id.localeCompare(right.id))

  for (const organization of organizations) {
    const workspaces = catalog.workspaces
      .filter((entry) => (
        entry.organizationId === organization.id
        && entry.status === 'active'
        && (workspaceId === undefined || entry.id === workspaceId)
      ))
      .toSorted((left, right) => (
        Number(right.isDefault) - Number(left.isDefault)
        || left.id.localeCompare(right.id)
      ))

    for (const workspace of workspaces) {
      const site = catalog.sites
        .filter((entry) => (
          entry.organizationId === organization.id
          && entry.workspaceId === workspace.id
          && entry.status === 'active'
        ))
        .toSorted((left, right) => left.id.localeCompare(right.id))[0]
      if (site) {
        return {
          organizationId: organization.id,
          workspaceId: workspace.id,
          siteId: site.id,
        }
      }
    }
  }
  return null
}

function resolveSelection(
  selection: StableContextSelection,
  catalog: AccessibleContextCatalog,
  source: ResolutionSource,
  profileRelativeSubpath: ProfileRelativeSubpath,
  registry: ScopedContextProfileRegistry,
): ScopedContextResolution {
  const result = exactOwnedContext(
    selection,
    catalog,
    source,
    profileRelativeSubpath,
  )
  if ('kind' in result) return immutable(result)

  const profile = registry.compose(
    result.site.profileId,
    result.site.capabilityOverrides,
  )
  if (!Value.Check(ComposedProductProfileSchema, profile)) {
    throw new ScopedContextSelectionError(
      'invalid-profile',
      'selected site profile composition does not match its TypeBox contract',
    )
  }
  return immutable({
    kind: 'ready',
    source,
    profileRelativeSubpath,
    ...result,
    profile: structuredClone(profile),
  })
}

function unscopedProfileRelativeSubpath(pathname: string): ProfileRelativeSubpath {
  return validateProfileRelativeSubpath(pathname) ?? '/admin'
}

/**
 * Resolves a stable admin context. A complete URL scope always wins; browser
 * state is considered only on an unscoped profile-shell URL.
 */
export function resolveScopedAdminContext(
  input: ResolveScopedAdminContextInput,
  registry: ScopedContextProfileRegistry,
): ScopedContextResolution {
  assertAccessibleContextCatalog(input.catalog)
  const parsedUrl = parseUrl(input.url)
  const route = parseScopedAdminUrl(input.url)
  if (route?.kind === 'invitation') {
    return immutable({ kind: 'invitation', source: 'url', invitation: route })
  }
  if (route?.kind === 'selection') {
    return resolveSelection(
      route.selection,
      input.catalog,
      'url',
      route.profileRelativeSubpath,
      registry,
    )
  }

  const hasExplicitContext = parsedUrl.pathname === '/admin/organizations'
    || parsedUrl.pathname.startsWith('/admin/organizations/')
    || parsedUrl.pathname === '/admin/invitations'
    || parsedUrl.pathname.startsWith('/admin/invitations/')
  if (hasExplicitContext) {
    return immutable({ kind: 'missing', source: 'url', scope: 'context' })
  }

  const profileRelativeSubpath = unscopedProfileRelativeSubpath(parsedUrl.pathname)
  if (Value.Check(BrowserContextPreferenceSchema, input.browserPreference)) {
    const preferred = exactOwnedContext(
      input.browserPreference.selection,
      input.catalog,
      'browser-preference',
      profileRelativeSubpath,
    )
    if (!('kind' in preferred)) {
      return resolveSelection(
        input.browserPreference.selection,
        input.catalog,
        'browser-preference',
        profileRelativeSubpath,
        registry,
      )
    }
  }

  const fallback = deterministicSelection(input.catalog)
  if (!fallback) {
    return immutable({ kind: 'missing', source: 'catalog-default', scope: 'context' })
  }
  return resolveSelection(
    fallback,
    input.catalog,
    'catalog-default',
    profileRelativeSubpath,
    registry,
  )
}

/** Switches an exact site while preserving only a validated profile-shell subpath. */
export function buildSiteSwitchTarget(
  selection: StableContextSelection,
  profileRelativeSubpath: ProfileRelativeSubpath,
): string {
  return buildScopedAdminUrl(selection, requiredProfileRelativeSubpath(profileRelativeSubpath))
}

/** Selects the deterministic active default below an organization. */
export function buildOrganizationSwitchTarget(
  catalog: AccessibleContextCatalog,
  organizationId: string,
  profileRelativeSubpath: ProfileRelativeSubpath,
): string | null {
  assertAccessibleContextCatalog(catalog)
  const selection = deterministicSelection(catalog, organizationId)
  return selection
    ? buildScopedAdminUrl(selection, requiredProfileRelativeSubpath(profileRelativeSubpath))
    : null
}

/** Selects the deterministic active site below one fully-qualified workspace. */
export function buildWorkspaceSwitchTarget(
  catalog: AccessibleContextCatalog,
  organizationId: string,
  workspaceId: string,
  profileRelativeSubpath: ProfileRelativeSubpath,
): string | null {
  assertAccessibleContextCatalog(catalog)
  const selection = deterministicSelection(catalog, organizationId, workspaceId)
  return selection
    ? buildScopedAdminUrl(selection, requiredProfileRelativeSubpath(profileRelativeSubpath))
    : null
}

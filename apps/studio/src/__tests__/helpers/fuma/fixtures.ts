export const FUMA_FIXTURE_PROFILE_IDS = ['website', 'publication'] as const

export type FumaFixtureProfileId = (typeof FUMA_FIXTURE_PROFILE_IDS)[number]

export type FumaCapabilityOverrides = Readonly<{
  grant: readonly string[]
  revoke: readonly string[]
}>

export type FumaFixtureUser = Readonly<{
  id: string
  label: string
  email: string
  displayName: string
}>

export type FumaFixtureOrganization = Readonly<{
  id: string
  label: string
  ownerUserId: string
}>

export type FumaFixtureWorkspace = Readonly<{
  id: string
  organizationId: string
  label: string
}>

export type FumaFixtureSite = Readonly<{
  id: string
  organizationId: string
  workspaceId: string
  label: string
  profileId: FumaFixtureProfileId
  capabilityOverrides: FumaCapabilityOverrides
}>

export type FumaFixtureResource = Readonly<{
  id: string
  organizationId: string
  workspaceId: string
  siteId: string
  label: string
  value: string
}>

export type FumaTwoTenantMatrix = Readonly<{
  seed: string
  users: readonly FumaFixtureUser[]
  organizations: readonly FumaFixtureOrganization[]
  workspaces: readonly FumaFixtureWorkspace[]
  sites: readonly FumaFixtureSite[]
  resources: readonly FumaFixtureResource[]
}>

type FixtureIdentityInput = Readonly<{
  seed: string
  label: string
}>

function requiredLabel(value: string, field: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error(`${field} must not be empty`)
  return trimmed
}

function slug(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'fixture'
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Stable product-facing fixture ID. Inputs are explicit; no random source is read. */
export function fumaFixtureId(seed: string, kind: string, label: string): string {
  const safeSeed = requiredLabel(seed, 'seed')
  const safeKind = requiredLabel(kind, 'kind')
  const safeLabel = requiredLabel(label, 'label')
  return `fuma_${slug(safeKind)}_${slug(safeSeed)}_${slug(safeLabel)}_${fnv1a32(`${safeSeed}\u0000${safeKind}\u0000${safeLabel}`)}`
}

export function createFumaFixtureUser(input: FixtureIdentityInput): FumaFixtureUser {
  const label = requiredLabel(input.label, 'label')
  const id = fumaFixtureId(input.seed, 'user', label)
  return {
    id,
    label,
    email: `${slug(label)}.${fnv1a32(id)}@fixture.invalid`,
    displayName: `${label} Fixture User`,
  }
}

export function createFumaFixtureOrganization(
  input: FixtureIdentityInput & Readonly<{ ownerUserId: string }>,
): FumaFixtureOrganization {
  return {
    id: fumaFixtureId(input.seed, 'organization', input.label),
    label: requiredLabel(input.label, 'label'),
    ownerUserId: requiredLabel(input.ownerUserId, 'ownerUserId'),
  }
}

export function createFumaFixtureWorkspace(
  input: FixtureIdentityInput & Readonly<{ organizationId: string; idLabel?: string }>,
): FumaFixtureWorkspace {
  return {
    id: fumaFixtureId(input.seed, 'workspace', input.idLabel ?? input.label),
    organizationId: requiredLabel(input.organizationId, 'organizationId'),
    label: requiredLabel(input.label, 'label'),
  }
}

export function createFumaFixtureSite(
  input: FixtureIdentityInput & Readonly<{
    organizationId: string
    workspaceId: string
    profileId: FumaFixtureProfileId
    capabilityOverrides: FumaCapabilityOverrides
    idLabel?: string
  }>,
): FumaFixtureSite {
  return {
    id: fumaFixtureId(input.seed, 'site', input.idLabel ?? input.label),
    organizationId: requiredLabel(input.organizationId, 'organizationId'),
    workspaceId: requiredLabel(input.workspaceId, 'workspaceId'),
    label: requiredLabel(input.label, 'label'),
    profileId: input.profileId,
    capabilityOverrides: {
      grant: [...input.capabilityOverrides.grant],
      revoke: [...input.capabilityOverrides.revoke],
    },
  }
}

export function createFumaFixtureResource(
  input: FixtureIdentityInput & Readonly<{
    organizationId: string
    workspaceId: string
    siteId: string
    value: string
    idLabel?: string
  }>,
): FumaFixtureResource {
  return {
    id: fumaFixtureId(input.seed, 'resource', input.idLabel ?? input.label),
    organizationId: requiredLabel(input.organizationId, 'organizationId'),
    workspaceId: requiredLabel(input.workspaceId, 'workspaceId'),
    siteId: requiredLabel(input.siteId, 'siteId'),
    label: requiredLabel(input.label, 'label'),
    value: requiredLabel(input.value, 'value'),
  }
}

/**
 * Two organizations with colliding workspace/site/resource IDs. The complete
 * organization → workspace → site scope is the only unique resource address.
 */
export function createFumaTwoTenantMatrix(seed: string): FumaTwoTenantMatrix {
  const safeSeed = requiredLabel(seed, 'seed')
  const users: FumaFixtureUser[] = []
  const organizations: FumaFixtureOrganization[] = []
  const workspaces: FumaFixtureWorkspace[] = []
  const sites: FumaFixtureSite[] = []
  const resources: FumaFixtureResource[] = []

  for (const tenantLabel of ['acacia', 'baobab'] as const) {
    const user = createFumaFixtureUser({ seed: safeSeed, label: `${tenantLabel}-owner` })
    const organization = createFumaFixtureOrganization({
      seed: safeSeed,
      label: `${tenantLabel}-organization`,
      ownerUserId: user.id,
    })
    const workspace = createFumaFixtureWorkspace({
      seed: safeSeed,
      label: `${tenantLabel}-workspace`,
      idLabel: 'shared-lower-scope-id',
      organizationId: organization.id,
    })
    const website = createFumaFixtureSite({
      seed: safeSeed,
      label: `${tenantLabel}-website`,
      idLabel: 'shared-website-site-id',
      organizationId: organization.id,
      workspaceId: workspace.id,
      profileId: 'website',
      capabilityOverrides: {
        grant: ['publication.editorial.schedule'],
        revoke: ['website.analytics'],
      },
    })
    const publication = createFumaFixtureSite({
      seed: safeSeed,
      label: `${tenantLabel}-publication`,
      idLabel: 'shared-publication-site-id',
      organizationId: organization.id,
      workspaceId: workspace.id,
      profileId: 'publication',
      capabilityOverrides: {
        grant: ['website.design'],
        revoke: ['publication.newsletters.send'],
      },
    })

    users.push(user)
    organizations.push(organization)
    workspaces.push(workspace)
    sites.push(website, publication)
    for (const site of [website, publication]) {
      resources.push(createFumaFixtureResource({
        seed: safeSeed,
        label: `${tenantLabel}-${site.profileId}-resource`,
        idLabel: 'shared-resource-id',
        organizationId: organization.id,
        workspaceId: workspace.id,
        siteId: site.id,
        value: `${tenantLabel}:${site.profileId}`,
      }))
    }
  }

  return { seed: safeSeed, users, organizations, workspaces, sites, resources }
}

/** Stable IDs only, in deterministic entity order. Colliding IDs remain repeated. */
export function stableFumaFixtureIds(matrix: FumaTwoTenantMatrix): readonly string[] {
  return [
    ...matrix.users.map(({ id }) => id),
    ...matrix.organizations.map(({ id }) => id),
    ...matrix.workspaces.map(({ id }) => id),
    ...matrix.sites.map(({ id }) => id),
    ...matrix.resources.map(({ id }) => id),
  ]
}

/** Demo-safe rendering: the JSON array contains IDs and no environment metadata. */
export function formatStableFumaFixtureIds(matrix: FumaTwoTenantMatrix): string {
  return JSON.stringify(stableFumaFixtureIds(matrix))
}

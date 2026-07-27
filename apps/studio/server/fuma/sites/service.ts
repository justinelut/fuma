import {
  FumaRegistryError,
  fumaLaunchRegistry,
  type FumaRegistry,
} from '@core/fuma'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import {
  SiteArchiveInputSchema,
  SiteCreateInputSchema,
  SiteIdSchema,
  SiteOrganizationIdSchema,
  SiteRestoreInputSchema,
  SiteUpdateInputSchema,
  SiteWorkspaceIdSchema,
  normalizeSiteSlug,
  type SiteArchiveInput,
  type SiteCreateInput,
  type SiteId,
  type SiteOrganizationId,
  type SiteRecord,
  type SiteRestoreInput,
  type SiteUpdateInput,
  type SiteWorkspaceId,
} from './contracts'
import {
  SiteProfilePolicyError,
  createSiteProfileAssignment,
  updateSiteProfileAssignment,
  validateLaunchSiteSlug,
} from './profileAssignment'
import type {
  OwnedWorkspaceStatus,
  SiteRepository,
} from './repository'

export type SiteDomainErrorCode =
  | 'invalid-input'
  | 'workspace-not-found'
  | 'archived-workspace'
  | 'not-found'
  | 'id-conflict'
  | 'slug-conflict'
  | 'reserved-slug'
  | 'invalid-profile'
  | 'invalid-capability-overrides'
  | 'immutable-profile-assignment'
  | 'archived-site'

export class SiteDomainError extends Error {
  override readonly name = 'SiteDomainError'
  readonly code: SiteDomainErrorCode
  readonly organizationId: string | undefined
  readonly workspaceId: string | undefined
  readonly siteId: string | undefined

  constructor(
    code: SiteDomainErrorCode,
    message: string,
    organizationId?: string,
    workspaceId?: string,
    siteId?: string,
  ) {
    super(message)
    this.code = code
    this.organizationId = organizationId
    this.workspaceId = workspaceId
    this.siteId = siteId
  }
}

export interface SiteServiceOptions {
  repository: SiteRepository
  registry?: FumaRegistry
  now?: () => Date
}

function invalid(message: string): never {
  throw new SiteDomainError('invalid-input', message)
}

function normalizedCreateCandidate(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input
  const slug = 'slug' in input && typeof input.slug === 'string'
    ? normalizeSiteSlug(input.slug)
    : 'slug' in input ? input.slug : undefined
  const name = 'name' in input && typeof input.name === 'string'
    ? input.name.trim()
    : 'name' in input ? input.name : undefined
  return { ...input, slug, name }
}

function normalizedUpdateCandidate(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input
  const candidate = { ...input }
  if ('slug' in input) {
    Object.assign(candidate, {
      slug: typeof input.slug === 'string' ? normalizeSiteSlug(input.slug) : input.slug,
    })
  }
  if ('name' in input) {
    Object.assign(candidate, {
      name: typeof input.name === 'string' ? input.name.trim() : input.name,
    })
  }
  return candidate
}

function parseCreate(input: unknown): SiteCreateInput {
  const parsed = safeParseValue(SiteCreateInputSchema, normalizedCreateCandidate(input))
  if (!parsed.ok) invalid('Site creation input is invalid.')
  return parsed.value
}

function parseUpdate(input: unknown): SiteUpdateInput {
  if (
    typeof input === 'object'
    && input !== null
    && !Array.isArray(input)
    && 'profileId' in input
  ) {
    throw new SiteDomainError(
      'immutable-profile-assignment',
      'A site profile assignment cannot be changed after creation.',
    )
  }
  const parsed = safeParseValue(SiteUpdateInputSchema, normalizedUpdateCandidate(input))
  if (!parsed.ok) invalid('Site update input is invalid.')
  return parsed.value
}

function parseArchive(input: unknown): SiteArchiveInput {
  const parsed = safeParseValue(SiteArchiveInputSchema, input)
  if (!parsed.ok) invalid('Site archive input is invalid.')
  return parsed.value
}

function parseRestore(input: unknown): SiteRestoreInput {
  const parsed = safeParseValue(SiteRestoreInputSchema, input)
  if (!parsed.ok) invalid('Site restore input is invalid.')
  return parsed.value
}

function parseOrganizationId(input: unknown): SiteOrganizationId {
  const parsed = safeParseValue(SiteOrganizationIdSchema, input)
  if (!parsed.ok) invalid('Organization ID is invalid.')
  return parsed.value
}

function parseWorkspaceId(input: unknown): SiteWorkspaceId {
  const parsed = safeParseValue(SiteWorkspaceIdSchema, input)
  if (!parsed.ok) invalid('Workspace ID is invalid.')
  return parsed.value
}

function parseSiteId(input: unknown): SiteId {
  const parsed = safeParseValue(SiteIdSchema, input)
  if (!parsed.ok) invalid('Site ID is invalid.')
  return parsed.value
}

function assertWorkspace(
  status: OwnedWorkspaceStatus | null,
  organizationId: SiteOrganizationId,
  workspaceId: SiteWorkspaceId,
  mutation: boolean,
): void {
  if (status === null) {
    throw new SiteDomainError(
      'workspace-not-found',
      `Workspace ${workspaceId} does not exist in organization ${organizationId}.`,
      organizationId,
      workspaceId,
    )
  }
  if (mutation && status === 'archived') {
    throw new SiteDomainError(
      'archived-workspace',
      `Archived workspace ${workspaceId} cannot mutate sites.`,
      organizationId,
      workspaceId,
    )
  }
}

function ownedSite(
  site: SiteRecord | null,
  organizationId: SiteOrganizationId,
  workspaceId: SiteWorkspaceId,
  siteId: SiteId,
): SiteRecord {
  if (site === null) {
    throw new SiteDomainError(
      'not-found',
      `Site ${siteId} does not exist in the requested organization and workspace.`,
      organizationId,
      workspaceId,
      siteId,
    )
  }
  return site
}

function profileError(
  error: unknown,
  organizationId: SiteOrganizationId,
  workspaceId: SiteWorkspaceId,
  siteId: SiteId,
): never {
  if (error instanceof SiteProfilePolicyError) {
    const code = error.code === 'reserved-slug'
      ? 'reserved-slug'
      : error.code === 'immutable-profile-assignment'
        ? 'immutable-profile-assignment'
        : 'invalid-input'
    throw new SiteDomainError(code, error.message, organizationId, workspaceId, siteId)
  }
  if (error instanceof FumaRegistryError) {
    const code = error.code === 'unknown-profile'
      ? 'invalid-profile'
      : 'invalid-capability-overrides'
    throw new SiteDomainError(code, error.message, organizationId, workspaceId, siteId)
  }
  throw error
}

function validatedSlug(
  slug: string,
  organizationId: SiteOrganizationId,
  workspaceId: SiteWorkspaceId,
  siteId: SiteId,
) {
  try {
    return validateLaunchSiteSlug(slug)
  } catch (error) {
    return profileError(error, organizationId, workspaceId, siteId)
  }
}

export class SiteService {
  readonly #repository: SiteRepository
  readonly #registry: FumaRegistry
  readonly #now: () => Date

  constructor(options: SiteServiceOptions) {
    this.#repository = options.repository
    this.#registry = options.registry ?? fumaLaunchRegistry
    this.#now = options.now ?? (() => new Date())
  }

  #timestamp(): string {
    const now = this.#now()
    if (!Number.isFinite(now.getTime())) invalid('Site service clock returned an invalid date.')
    return now.toISOString()
  }

  async #assertWorkspace(
    repository: SiteRepository,
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
    mutation: boolean,
  ): Promise<void> {
    assertWorkspace(
      await repository.getWorkspaceStatus(organizationId, workspaceId),
      organizationId,
      workspaceId,
      mutation,
    )
  }

  async create(input: unknown): Promise<SiteRecord> {
    const value = parseCreate(input)
    const slug = validatedSlug(value.slug, value.organizationId, value.workspaceId, value.id)
    let assignment
    try {
      assignment = createSiteProfileAssignment({
        profileId: value.profileId,
        capabilityOverrides: value.capabilityOverrides,
      }, this.#registry)
    } catch (error) {
      return profileError(error, value.organizationId, value.workspaceId, value.id)
    }
    const timestamp = this.#timestamp()

    return await this.#repository.transaction(value.organizationId, value.workspaceId, async (tx) => {
      assertWorkspace(await tx.getWorkspaceStatus(), value.organizationId, value.workspaceId, true)
      if (await tx.getById(value.id)) {
        throw new SiteDomainError(
          'id-conflict',
          `Site ID ${value.id} already exists in workspace ${value.workspaceId}.`,
          value.organizationId,
          value.workspaceId,
          value.id,
        )
      }
      const sites = await tx.getSites()
      if (sites.some((site) => site.slug === slug)) {
        throw new SiteDomainError(
          'slug-conflict',
          `Site slug ${slug} already exists in workspace ${value.workspaceId}.`,
          value.organizationId,
          value.workspaceId,
          value.id,
        )
      }
      return await tx.insert({
        id: value.id,
        organizationId: value.organizationId,
        workspaceId: value.workspaceId,
        slug,
        name: value.name,
        status: 'active',
        profileId: assignment.profileId,
        capabilityOverrides: assignment.capabilityOverrides,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    })
  }

  async list(organizationId: unknown, workspaceId: unknown): Promise<SiteRecord[]> {
    const parsedOrganizationId = parseOrganizationId(organizationId)
    const parsedWorkspaceId = parseWorkspaceId(workspaceId)
    await this.#assertWorkspace(
      this.#repository,
      parsedOrganizationId,
      parsedWorkspaceId,
      false,
    )
    return await this.#repository.listByWorkspace(parsedOrganizationId, parsedWorkspaceId)
  }

  async get(
    organizationId: unknown,
    workspaceId: unknown,
    siteId: unknown,
  ): Promise<SiteRecord> {
    const parsedOrganizationId = parseOrganizationId(organizationId)
    const parsedWorkspaceId = parseWorkspaceId(workspaceId)
    const parsedSiteId = parseSiteId(siteId)
    await this.#assertWorkspace(
      this.#repository,
      parsedOrganizationId,
      parsedWorkspaceId,
      false,
    )
    return ownedSite(
      await this.#repository.getById(
        parsedOrganizationId,
        parsedWorkspaceId,
        parsedSiteId,
      ),
      parsedOrganizationId,
      parsedWorkspaceId,
      parsedSiteId,
    )
  }

  async update(input: unknown): Promise<SiteRecord> {
    const value = parseUpdate(input)
    const timestamp = this.#timestamp()
    return await this.#repository.transaction(value.organizationId, value.workspaceId, async (tx) => {
      assertWorkspace(await tx.getWorkspaceStatus(), value.organizationId, value.workspaceId, true)
      const current = ownedSite(
        await tx.getById(value.siteId),
        value.organizationId,
        value.workspaceId,
        value.siteId,
      )
      if (current.status === 'archived') {
        throw new SiteDomainError(
          'archived-site',
          'An archived site must be restored before it can be updated.',
          value.organizationId,
          value.workspaceId,
          value.siteId,
        )
      }

      const slug = value.slug === undefined
        ? current.slug
        : validatedSlug(value.slug, value.organizationId, value.workspaceId, value.siteId)
      if (slug !== current.slug) {
        const sites = await tx.getSites()
        if (sites.some((site) => site.id !== current.id && site.slug === slug)) {
          throw new SiteDomainError(
            'slug-conflict',
            `Site slug ${slug} already exists in workspace ${value.workspaceId}.`,
            value.organizationId,
            value.workspaceId,
            value.siteId,
          )
        }
      }

      let assignment = {
        profileId: current.profileId,
        capabilityOverrides: current.capabilityOverrides,
      }
      if (value.capabilityOverrides !== undefined) {
        try {
          assignment = updateSiteProfileAssignment(
            assignment,
            current.profileId,
            value.capabilityOverrides,
            this.#registry,
          )
        } catch (error) {
          return profileError(error, value.organizationId, value.workspaceId, value.siteId)
        }
      }
      return await tx.update({
        ...current,
        slug,
        name: value.name ?? current.name,
        capabilityOverrides: assignment.capabilityOverrides,
        updatedAt: timestamp,
      })
    })
  }

  async archive(input: unknown): Promise<SiteRecord> {
    const value = parseArchive(input)
    const timestamp = this.#timestamp()
    return await this.#repository.transaction(value.organizationId, value.workspaceId, async (tx) => {
      assertWorkspace(await tx.getWorkspaceStatus(), value.organizationId, value.workspaceId, true)
      const current = ownedSite(
        await tx.getById(value.siteId),
        value.organizationId,
        value.workspaceId,
        value.siteId,
      )
      if (current.status === 'archived') return current
      return await tx.update({ ...current, status: 'archived', updatedAt: timestamp })
    })
  }

  async restore(input: unknown): Promise<SiteRecord> {
    const value = parseRestore(input)
    const timestamp = this.#timestamp()
    return await this.#repository.transaction(value.organizationId, value.workspaceId, async (tx) => {
      assertWorkspace(await tx.getWorkspaceStatus(), value.organizationId, value.workspaceId, true)
      const current = ownedSite(
        await tx.getById(value.siteId),
        value.organizationId,
        value.workspaceId,
        value.siteId,
      )
      if (current.status === 'active') return current
      return await tx.update({ ...current, status: 'active', updatedAt: timestamp })
    })
  }
}

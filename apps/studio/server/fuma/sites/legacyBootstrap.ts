import {
  FumaRegistryError,
  fumaLaunchRegistry,
  type FumaRegistry,
} from '@core/fuma'
import {
  Type,
  safeParseValue,
  type Static,
} from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import {
  SiteCapabilityOverridesSchema,
  SiteOrganizationIdSchema,
  SiteRecordSchema,
  SiteSlugSchema,
  SiteWorkspaceIdSchema,
  normalizeSiteSlug,
  type SiteCapabilityOverrides,
  type SiteId,
  type SiteOrganizationId,
  type SiteProfileAssignment,
  type SiteRecord,
  type SiteSlug,
  type SiteWorkspaceId,
} from './contracts'
import {
  SiteProfilePolicyError,
  createSiteProfileAssignment,
  validateLaunchSiteSlug,
} from './profileAssignment'

export const LEGACY_WEBSITE_PROFILE_ID = 'website'

export const LegacySiteBootstrapInputSchema = Type.Object({
  organizationId: SiteOrganizationIdSchema,
  workspaceId: SiteWorkspaceIdSchema,
  slug: SiteSlugSchema,
  capabilityOverrides: SiteCapabilityOverridesSchema,
}, { additionalProperties: false })
export type LegacySiteBootstrapInput = Static<typeof LegacySiteBootstrapInputSchema>

export type LegacySiteBootstrapErrorCode =
  | 'invalid-input'
  | 'legacy-site-not-found'
  | 'legacy-site-authority-conflict'
  | 'workspace-org-mismatch'
  | 'archived-workspace'
  | 'ownership-conflict'
  | 'site-conflict'
  | 'slug-conflict'
  | 'invalid-profile'
  | 'invalid-capability-overrides'

export class LegacySiteBootstrapError extends Error {
  override readonly name = 'LegacySiteBootstrapError'
  readonly code: LegacySiteBootstrapErrorCode

  constructor(code: LegacySiteBootstrapErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.code = code
  }
}

export interface LegacySiteAuthority {
  id: string
  name: string
}

export interface LegacyBootstrapWorkspaceAuthority {
  organizationId: string
  workspaceId: string
  status: 'active' | 'archived'
  isDefault: boolean
}

export interface LegacySiteBootstrapTransaction {
  lockSiteOwnership(): Promise<void>
  readLegacySiteAuthority(): Promise<readonly LegacySiteAuthority[]>
  getWorkspaceAuthority(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
  ): Promise<LegacyBootstrapWorkspaceAuthority | null>
  findBySiteId(siteId: SiteId): Promise<SiteRecord[]>
  findBySlug(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
    slug: SiteSlug,
  ): Promise<SiteRecord | null>
  insert(record: SiteRecord): Promise<SiteRecord>
}

export interface LegacySiteBootstrapRepository {
  transaction<T>(work: (tx: LegacySiteBootstrapTransaction) => Promise<T>): Promise<T>
}

interface LegacySiteRow {
  id: string
  name: string
}

interface WorkspaceAuthorityRow {
  organization_id: string
  id: string
  status: string
  is_default: boolean
}

interface SiteRow {
  organization_id: string
  workspace_id: string
  id: string
  slug: string
  name: string
  status: string
  profile_id: string
  capability_overrides_json: unknown
  created_at: string | Date
  updated_at: string | Date
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value
}

function storedSite(row: SiteRow): SiteRecord {
  const parsed = safeParseValue(SiteRecordSchema, {
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    profileId: row.profile_id,
    capabilityOverrides: row.capability_overrides_json,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  })
  if (!parsed.ok) {
    throw new Error(`Stored Fuma site ${row.id} failed schema validation.`)
  }
  return parsed.value
}

function workspaceAuthority(
  row: WorkspaceAuthorityRow | undefined,
): LegacyBootstrapWorkspaceAuthority | null {
  if (!row) return null
  if (row.status !== 'active' && row.status !== 'archived') {
    throw new Error(`Stored workspace ${row.id} has an invalid status.`)
  }
  return {
    organizationId: row.organization_id,
    workspaceId: row.id,
    status: row.status,
    isDefault: row.is_default,
  }
}

class PostgresLegacySiteBootstrapTransaction implements LegacySiteBootstrapTransaction {
  readonly #db: DbClient

  constructor(db: DbClient) {
    this.#db = db
  }

  async lockSiteOwnership(): Promise<void> {
    // Stabilize the historical authority even when it is empty, then exclude hosted site writes
    // while this one-time seam takes its ID-global ownership view.
    await this.#db`lock table site in share mode`
    await this.#db`lock table fuma_sites in share row exclusive mode`
  }

  async readLegacySiteAuthority(): Promise<readonly LegacySiteAuthority[]> {
    const { rows } = await this.#db<LegacySiteRow>`
      select id, name
      from site
      order by id
      for update
    `
    return rows.map(({ id, name }) => ({ id, name }))
  }

  async getWorkspaceAuthority(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
  ): Promise<LegacyBootstrapWorkspaceAuthority | null> {
    const { rows } = await this.#db<WorkspaceAuthorityRow>`
      select organization_id, id, status, is_default
      from fuma_workspaces
      where organization_id = ${organizationId} and id = ${workspaceId}
      for update
    `
    return workspaceAuthority(rows[0])
  }

  async findBySiteId(siteId: SiteId): Promise<SiteRecord[]> {
    const { rows } = await this.#db<SiteRow>`
      select organization_id, workspace_id, id, slug, name, status, profile_id,
        capability_overrides_json, created_at, updated_at
      from fuma_sites
      where id = ${siteId}
      order by organization_id, workspace_id
    `
    return rows.map(storedSite)
  }

  async findBySlug(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
    slug: SiteSlug,
  ): Promise<SiteRecord | null> {
    const { rows } = await this.#db<SiteRow>`
      select organization_id, workspace_id, id, slug, name, status, profile_id,
        capability_overrides_json, created_at, updated_at
      from fuma_sites
      where organization_id = ${organizationId}
        and workspace_id = ${workspaceId}
        and lower(slug) = lower(${slug})
    `
    return rows[0] ? storedSite(rows[0]) : null
  }

  async insert(record: SiteRecord): Promise<SiteRecord> {
    const capabilityOverridesJson = JSON.stringify(record.capabilityOverrides)
    const { rows } = await this.#db<SiteRow>`
      insert into fuma_sites (
        organization_id, workspace_id, id, slug, name, status, profile_id,
        capability_overrides_json, created_at, updated_at
      ) values (
        ${record.organizationId}, ${record.workspaceId}, ${record.id}, ${record.slug},
        ${record.name}, ${record.status}, ${record.profileId}, ${capabilityOverridesJson},
        ${record.createdAt}, ${record.updatedAt}
      )
      returning organization_id, workspace_id, id, slug, name, status, profile_id,
        capability_overrides_json, created_at, updated_at
    `
    if (!rows[0]) throw new Error(`Failed to bootstrap legacy site ${record.id}.`)
    return storedSite(rows[0])
  }
}

export class PostgresLegacySiteBootstrapRepository implements LegacySiteBootstrapRepository {
  readonly #db: DbClient

  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') {
      throw new Error('Fuma legacy site bootstrap requires PostgreSQL authority.')
    }
    this.#db = db
  }

  transaction<T>(work: (tx: LegacySiteBootstrapTransaction) => Promise<T>): Promise<T> {
    return this.#db.transaction(async (db) => (
      await work(new PostgresLegacySiteBootstrapTransaction(db))
    ))
  }
}

export interface LegacySiteBootstrapServiceOptions {
  repository: LegacySiteBootstrapRepository
  registry?: FumaRegistry
  now?: () => Date
}

function invalidInput(message: string): never {
  throw new LegacySiteBootstrapError('invalid-input', message)
}

function normalizedInput(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input
  const candidate = { ...input }
  if ('slug' in input) {
    Object.assign(candidate, {
      slug: typeof input.slug === 'string' ? normalizeSiteSlug(input.slug) : input.slug,
    })
  }
  return candidate
}

function parseInput(input: unknown): LegacySiteBootstrapInput {
  const parsed = safeParseValue(LegacySiteBootstrapInputSchema, normalizedInput(input))
  if (!parsed.ok) invalidInput('Legacy site bootstrap input is invalid.')
  return parsed.value
}

function profileAssignment(
  capabilityOverrides: SiteCapabilityOverrides,
  registry: FumaRegistry,
): SiteProfileAssignment {
  try {
    return createSiteProfileAssignment({
      profileId: LEGACY_WEBSITE_PROFILE_ID,
      capabilityOverrides,
    }, registry)
  } catch (error) {
    if (error instanceof FumaRegistryError) {
      const code = error.code === 'unknown-profile'
        ? 'invalid-profile'
        : 'invalid-capability-overrides'
      throw new LegacySiteBootstrapError(code, error.message, error)
    }
    throw error
  }
}

function bootstrapSlug(value: string): SiteSlug {
  try {
    return validateLaunchSiteSlug(value)
  } catch (error) {
    if (error instanceof SiteProfilePolicyError) {
      throw new LegacySiteBootstrapError('invalid-input', error.message, error)
    }
    throw error
  }
}

function exactLegacyAuthority(rows: readonly LegacySiteAuthority[]): LegacySiteAuthority {
  if (rows.length === 0) {
    throw new LegacySiteBootstrapError(
      'legacy-site-not-found',
      'The historical site authority does not contain a site.',
    )
  }
  if (rows.length !== 1) {
    throw new LegacySiteBootstrapError(
      'legacy-site-authority-conflict',
      'The historical site authority must contain exactly one site.',
    )
  }
  const legacy = rows[0]
  if (!legacy || legacy.id.length > 255 || legacy.id.trim().length === 0) {
    throw new LegacySiteBootstrapError(
      'legacy-site-authority-conflict',
      'The historical site ID cannot be represented by the Fuma site contract.',
    )
  }
  if (legacy.name.length > 255 || legacy.name.trim().length === 0) {
    throw new LegacySiteBootstrapError(
      'legacy-site-authority-conflict',
      'The historical site name cannot be represented by the Fuma site contract.',
    )
  }
  return legacy
}

function validatedBootstrapRecord(candidate: SiteRecord): SiteRecord {
  const parsed = safeParseValue(SiteRecordSchema, candidate)
  if (!parsed.ok) {
    throw new LegacySiteBootstrapError(
      'legacy-site-authority-conflict',
      'The historical site cannot be represented by the Fuma site record contract.',
    )
  }
  return parsed.value
}

function sameOwner(
  site: SiteRecord,
  organizationId: SiteOrganizationId,
  workspaceId: SiteWorkspaceId,
): boolean {
  return site.organizationId === organizationId && site.workspaceId === workspaceId
}

function sameProfileAssignment(
  site: SiteRecord,
  assignment: SiteProfileAssignment,
): boolean {
  return site.profileId === assignment.profileId
}

export class LegacySiteBootstrapService {
  readonly #repository: LegacySiteBootstrapRepository
  readonly #registry: FumaRegistry
  readonly #clock: () => Date

  constructor(options: LegacySiteBootstrapServiceOptions) {
    this.#repository = options.repository
    this.#registry = options.registry ?? fumaLaunchRegistry
    this.#clock = options.now ?? (() => new Date())
  }

  async bootstrap(input: unknown): Promise<SiteRecord> {
    const value = parseInput(input)
    const slug = bootstrapSlug(value.slug)
    const assignment = profileAssignment(value.capabilityOverrides, this.#registry)
    const now = this.#clock()
    if (!Number.isFinite(now.getTime())) invalidInput('Legacy site bootstrap clock is invalid.')
    const timestamp = now.toISOString()

    return await this.#repository.transaction(async (tx) => {
      await tx.lockSiteOwnership()
      const legacy = exactLegacyAuthority(await tx.readLegacySiteAuthority())
      const workspace = await tx.getWorkspaceAuthority(value.organizationId, value.workspaceId)
      if (!workspace || !workspace.isDefault) {
        throw new LegacySiteBootstrapError(
          'workspace-org-mismatch',
          `Workspace ${value.workspaceId} is not the default workspace of organization ${value.organizationId}.`,
        )
      }
      if (workspace.status === 'archived') {
        throw new LegacySiteBootstrapError(
          'archived-workspace',
          `Default workspace ${value.workspaceId} is archived.`,
        )
      }

      const existing = await tx.findBySiteId(legacy.id)
      const conflictingOwner = existing.find((site) => (
        !sameOwner(site, value.organizationId, value.workspaceId)
      ))
      if (conflictingOwner) {
        throw new LegacySiteBootstrapError(
          'ownership-conflict',
          `Legacy site ${legacy.id} is already owned by another organization or workspace.`,
        )
      }
      const owned = existing.find((site) => (
        sameOwner(site, value.organizationId, value.workspaceId)
      ))
      if (owned) {
        if (!sameProfileAssignment(owned, assignment)) {
          throw new LegacySiteBootstrapError(
            'site-conflict',
            `Legacy site ${legacy.id} already exists with a conflicting profile assignment.`,
          )
        }
        return owned
      }

      const slugOwner = await tx.findBySlug(value.organizationId, value.workspaceId, slug)
      if (slugOwner) {
        throw new LegacySiteBootstrapError(
          'slug-conflict',
          `Site slug ${slug} already exists in default workspace ${value.workspaceId}.`,
        )
      }

      return await tx.insert(validatedBootstrapRecord({
        id: legacy.id,
        organizationId: value.organizationId,
        workspaceId: value.workspaceId,
        slug,
        name: legacy.name,
        status: 'active',
        profileId: assignment.profileId,
        capabilityOverrides: assignment.capabilityOverrides,
        createdAt: timestamp,
        updatedAt: timestamp,
      }))
    })
  }
}

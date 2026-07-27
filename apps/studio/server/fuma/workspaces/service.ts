import { safeParseValue } from '@core/utils/typeboxHelpers'
import {
  WorkspaceArchiveInputSchema,
  WorkspaceCreateInputSchema,
  WorkspaceIdSchema,
  WorkspaceOrganizationIdSchema,
  WorkspaceRestoreInputSchema,
  WorkspaceUpdateInputSchema,
  normalizeWorkspaceSlug,
  type WorkspaceArchiveInput,
  type WorkspaceCreateInput,
  type WorkspaceId,
  type WorkspaceOrganizationId,
  type WorkspaceRecord,
  type WorkspaceRestoreInput,
  type WorkspaceUpdateInput,
} from './contracts'
import type {
  WorkspaceRepository,
  WorkspaceRepositoryTransaction,
} from './repository'

export type WorkspaceDomainErrorCode =
  | 'invalid-input'
  | 'not-found'
  | 'organization-mismatch'
  | 'id-conflict'
  | 'slug-conflict'
  | 'archived-workspace'
  | 'default-required'
  | 'default-archive'
  | 'last-active'
  | 'active-sites'
  | 'invalid-site-count'

export class WorkspaceDomainError extends Error {
  override readonly name = 'WorkspaceDomainError'
  readonly code: WorkspaceDomainErrorCode
  readonly organizationId: string | undefined
  readonly workspaceId: string | undefined

  constructor(
    code: WorkspaceDomainErrorCode,
    message: string,
    organizationId?: string,
    workspaceId?: string,
  ) {
    super(message)
    this.code = code
    this.organizationId = organizationId
    this.workspaceId = workspaceId
  }
}

export interface WorkspaceSiteCountGuard {
  countActiveOwnedSites(
    organizationId: WorkspaceOrganizationId,
    workspaceId: WorkspaceId,
  ): Promise<number>
}

export interface WorkspaceServiceOptions {
  repository: WorkspaceRepository
  siteCountGuard: WorkspaceSiteCountGuard
  now?: () => Date
}

function invalid(message: string): never {
  throw new WorkspaceDomainError('invalid-input', message)
}

function normalizedCreateCandidate(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input
  const slug = 'slug' in input && typeof input.slug === 'string'
    ? normalizeWorkspaceSlug(input.slug)
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
      slug: typeof input.slug === 'string' ? normalizeWorkspaceSlug(input.slug) : input.slug,
    })
  }
  if ('name' in input) {
    Object.assign(candidate, {
      name: typeof input.name === 'string' ? input.name.trim() : input.name,
    })
  }
  return candidate
}

function parseCreate(input: unknown): WorkspaceCreateInput {
  const parsed = safeParseValue(WorkspaceCreateInputSchema, normalizedCreateCandidate(input))
  if (!parsed.ok) invalid('Workspace creation input is invalid.')
  return parsed.value
}

function parseUpdate(input: unknown): WorkspaceUpdateInput {
  const parsed = safeParseValue(WorkspaceUpdateInputSchema, normalizedUpdateCandidate(input))
  if (!parsed.ok) invalid('Workspace update input is invalid.')
  return parsed.value
}

function parseArchive(input: unknown): WorkspaceArchiveInput {
  const parsed = safeParseValue(WorkspaceArchiveInputSchema, input)
  if (!parsed.ok) invalid('Workspace archive input is invalid.')
  return parsed.value
}

function parseRestore(input: unknown): WorkspaceRestoreInput {
  const parsed = safeParseValue(WorkspaceRestoreInputSchema, input)
  if (!parsed.ok) invalid('Workspace restore input is invalid.')
  return parsed.value
}

function parseOrganizationId(input: unknown): WorkspaceOrganizationId {
  const parsed = safeParseValue(WorkspaceOrganizationIdSchema, input)
  if (!parsed.ok) invalid('Organization ID is invalid.')
  return parsed.value
}

function parseWorkspaceId(input: unknown): WorkspaceId {
  const parsed = safeParseValue(WorkspaceIdSchema, input)
  if (!parsed.ok) invalid('Workspace ID is invalid.')
  return parsed.value
}

function requireWorkspace(
  workspace: WorkspaceRecord | null,
  organizationId: WorkspaceOrganizationId,
  workspaceId: WorkspaceId,
): WorkspaceRecord {
  if (workspace === null) {
    throw new WorkspaceDomainError(
      'not-found',
      `Workspace ${workspaceId} does not exist in organization ${organizationId}.`,
      organizationId,
      workspaceId,
    )
  }
  return workspace
}

async function replaceDefault(
  tx: WorkspaceRepositoryTransaction,
  workspaces: readonly WorkspaceRecord[],
  target: WorkspaceRecord,
  updatedAt: string,
): Promise<WorkspaceRecord> {
  for (const workspace of workspaces) {
    if (workspace.isDefault && workspace.id !== target.id) {
      await tx.update({ ...workspace, isDefault: false, updatedAt })
    }
  }
  return await tx.update({ ...target, isDefault: true, updatedAt })
}

export class WorkspaceService {
  readonly #repository: WorkspaceRepository
  readonly #siteCountGuard: WorkspaceSiteCountGuard
  readonly #now: () => Date

  constructor(options: WorkspaceServiceOptions) {
    this.#repository = options.repository
    this.#siteCountGuard = options.siteCountGuard
    this.#now = options.now ?? (() => new Date())
  }

  #timestamp(): string {
    const now = this.#now()
    if (!Number.isFinite(now.getTime())) invalid('Workspace service clock returned an invalid date.')
    return now.toISOString()
  }

  async create(input: unknown): Promise<WorkspaceRecord> {
    const value = parseCreate(input)
    const timestamp = this.#timestamp()
    return await this.#repository.transaction(value.organizationId, async (tx) => {
      const idMatch = await tx.getById(value.id)
      if (idMatch !== null) {
        throw new WorkspaceDomainError(
          'id-conflict',
          `Workspace ID ${value.id} already exists.`,
          value.organizationId,
          value.id,
        )
      }

      const workspaces = await tx.list()
      if (workspaces.some((workspace) => workspace.slug === value.slug)) {
        throw new WorkspaceDomainError(
          'slug-conflict',
          `Workspace slug ${value.slug} already exists in organization ${value.organizationId}.`,
          value.organizationId,
          value.id,
        )
      }

      const workspace = await tx.insert({
        id: value.id,
        organizationId: value.organizationId,
        slug: value.slug,
        name: value.name,
        status: 'active',
        isDefault: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      const needsDefault = value.isDefault === true
        || workspaces.length === 0
        || !workspaces.some(({ isDefault }) => isDefault)
      return needsDefault
        ? await replaceDefault(tx, workspaces, workspace, timestamp)
        : workspace
    })
  }

  async list(organizationId: unknown): Promise<WorkspaceRecord[]> {
    return await this.#repository.listByOrganization(parseOrganizationId(organizationId))
  }

  async get(organizationId: unknown, workspaceId: unknown): Promise<WorkspaceRecord> {
    const parsedOrganizationId = parseOrganizationId(organizationId)
    const parsedWorkspaceId = parseWorkspaceId(workspaceId)
    return requireWorkspace(
      await this.#repository.getById(parsedOrganizationId, parsedWorkspaceId),
      parsedOrganizationId,
      parsedWorkspaceId,
    )
  }

  async update(input: unknown): Promise<WorkspaceRecord> {
    const value = parseUpdate(input)
    const timestamp = this.#timestamp()
    return await this.#repository.transaction(value.organizationId, async (tx) => {
      const current = requireWorkspace(
        await tx.getById(value.workspaceId),
        value.organizationId,
        value.workspaceId,
      )
      const workspaces = await tx.list()
      const slug = value.slug ?? current.slug
      if (slug !== current.slug && workspaces.some((workspace) => (
        workspace.id !== current.id && workspace.slug === slug
      ))) {
        throw new WorkspaceDomainError(
          'slug-conflict',
          `Workspace slug ${slug} already exists in organization ${value.organizationId}.`,
          value.organizationId,
          value.workspaceId,
        )
      }
      if (value.isDefault === false && current.isDefault) {
        throw new WorkspaceDomainError(
          'default-required',
          'Switch the default to another active workspace instead of clearing it.',
          value.organizationId,
          value.workspaceId,
        )
      }

      const updated: WorkspaceRecord = {
        ...current,
        slug,
        name: value.name ?? current.name,
        updatedAt: timestamp,
      }
      if (value.isDefault !== true) return await tx.update(updated)
      if (updated.status !== 'active') {
        throw new WorkspaceDomainError(
          'archived-workspace',
          'An archived workspace cannot become the organization default.',
          value.organizationId,
          value.workspaceId,
        )
      }
      return await replaceDefault(tx, workspaces, updated, timestamp)
    })
  }

  async setDefault(input: unknown): Promise<WorkspaceRecord> {
    const value = parseArchive(input)
    return await this.update({ ...value, isDefault: true })
  }

  async archive(input: unknown): Promise<WorkspaceRecord> {
    const value = parseArchive(input)
    const timestamp = this.#timestamp()
    return await this.#repository.transaction(value.organizationId, async (tx) => {
      const current = requireWorkspace(
        await tx.getById(value.workspaceId),
        value.organizationId,
        value.workspaceId,
      )
      if (current.status === 'archived') return current

      const workspaces = await tx.list()
      if (current.isDefault) {
        throw new WorkspaceDomainError(
          'default-archive',
          'The default workspace cannot be archived; switch the default first.',
          value.organizationId,
          value.workspaceId,
        )
      }
      if (workspaces.filter(({ status }) => status === 'active').length <= 1) {
        throw new WorkspaceDomainError(
          'last-active',
          'The last active workspace in an organization cannot be archived.',
          value.organizationId,
          value.workspaceId,
        )
      }

      const activeSiteCount = await this.#siteCountGuard.countActiveOwnedSites(
        value.organizationId,
        value.workspaceId,
      )
      if (!Number.isSafeInteger(activeSiteCount) || activeSiteCount < 0) {
        throw new WorkspaceDomainError(
          'invalid-site-count',
          'The workspace active-site guard returned an invalid count.',
          value.organizationId,
          value.workspaceId,
        )
      }
      if (activeSiteCount > 0) {
        throw new WorkspaceDomainError(
          'active-sites',
          `Workspace ${value.workspaceId} owns ${activeSiteCount} active site(s).`,
          value.organizationId,
          value.workspaceId,
        )
      }
      return await tx.update({
        ...current,
        status: 'archived',
        isDefault: false,
        updatedAt: timestamp,
      })
    })
  }

  async restore(input: unknown): Promise<WorkspaceRecord> {
    const value = parseRestore(input)
    const timestamp = this.#timestamp()
    return await this.#repository.transaction(value.organizationId, async (tx) => {
      const current = requireWorkspace(
        await tx.getById(value.workspaceId),
        value.organizationId,
        value.workspaceId,
      )
      if (current.status === 'active') return current

      const workspaces = await tx.list()
      const restored: WorkspaceRecord = {
        ...current,
        status: 'active',
        isDefault: false,
        updatedAt: timestamp,
      }
      return workspaces.some(({ isDefault }) => isDefault)
        ? await tx.update(restored)
        : await replaceDefault(tx, workspaces, restored, timestamp)
    })
  }
}

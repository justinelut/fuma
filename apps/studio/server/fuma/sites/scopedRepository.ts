import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import {
  FumaRepositoryScopeSchema,
  type FumaRepositoryScope,
} from '../tenancy'
import type {
  SiteCapabilityOverrides,
  SiteRecord,
  SiteSlug,
} from './contracts'
import {
  PostgresSiteRepository,
  type SiteRepository,
  type SiteRepositoryTransaction,
} from './repository'

export type ScopedSiteUpdate = Readonly<
  | {
      slug: SiteSlug
      name?: string
      capabilityOverrides?: SiteCapabilityOverrides
    }
  | {
      slug?: SiteSlug
      name: string
      capabilityOverrides?: SiteCapabilityOverrides
    }
  | {
      slug?: SiteSlug
      name?: string
      capabilityOverrides: SiteCapabilityOverrides
    }
>

export interface BoundSiteRepositoryReader {
  readonly scope: FumaRepositoryScope
  get(): Promise<SiteRecord | null>
  findBySlug(slug: SiteSlug): Promise<SiteRecord | null>
  countActiveOwnedSites(): Promise<number>
}

export interface BoundSiteRepositoryTransaction extends BoundSiteRepositoryReader {
  update(input: ScopedSiteUpdate): Promise<SiteRecord | null>
  archive(): Promise<SiteRecord | null>
}

export interface BoundSiteRepository extends BoundSiteRepositoryTransaction {
  transaction<T>(
    work: (repository: BoundSiteRepositoryTransaction) => Promise<T>,
  ): Promise<T>
}

export type ScopedSiteRepositoryErrorCode =
  | 'invalid-scope'
  | 'scope-transferring'

export class ScopedSiteRepositoryError extends Error {
  readonly code: ScopedSiteRepositoryErrorCode

  constructor(code: ScopedSiteRepositoryErrorCode, message: string) {
    super(message)
    this.name = 'ScopedSiteRepositoryError'
    this.code = code
  }
}

type Now = () => Date

function bindActiveScope(scope: FumaRepositoryScope): FumaRepositoryScope {
  const parsed = safeParseValue(FumaRepositoryScopeSchema, scope)
  if (!parsed.ok) {
    throw new ScopedSiteRepositoryError(
      'invalid-scope',
      'A valid Fuma repository scope is required.',
    )
  }
  if (parsed.value.state === 'transferring') {
    throw new ScopedSiteRepositoryError(
      'scope-transferring',
      'Site repository operations are blocked while ownership is transferring.',
    )
  }

  return Object.freeze({
    platformId: parsed.value.platformId,
    organizationId: parsed.value.organizationId,
    workspaceId: parsed.value.workspaceId,
    siteId: parsed.value.siteId,
    ownerKey: parsed.value.ownerKey,
    state: parsed.value.state,
    generation: parsed.value.generation,
    transferFence: parsed.value.transferFence,
  })
}

function withUpdate(
  scope: FumaRepositoryScope,
  current: SiteRecord,
  input: ScopedSiteUpdate,
  updatedAt: string,
): SiteRecord {
  return {
    id: scope.siteId,
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    slug: input.slug ?? current.slug,
    name: input.name ?? current.name,
    status: current.status,
    profileId: current.profileId,
    capabilityOverrides: input.capabilityOverrides ?? current.capabilityOverrides,
    createdAt: current.createdAt,
    updatedAt,
  }
}

class BoundSiteTransaction implements BoundSiteRepositoryTransaction {
  readonly scope: FumaRepositoryScope
  readonly #repository: SiteRepositoryTransaction
  readonly #now: Now

  constructor(
    scope: FumaRepositoryScope,
    repository: SiteRepositoryTransaction,
    now: Now,
  ) {
    this.scope = scope
    this.#repository = repository
    this.#now = now
    Object.freeze(this)
  }

  get(): Promise<SiteRecord | null> {
    return this.#repository.getById(this.scope.siteId)
  }

  async findBySlug(slug: SiteSlug): Promise<SiteRecord | null> {
    const site = await this.get()
    return site?.slug === slug ? site : null
  }

  async countActiveOwnedSites(): Promise<number> {
    const site = await this.get()
    return site?.status === 'active' ? 1 : 0
  }

  async update(input: ScopedSiteUpdate): Promise<SiteRecord | null> {
    const current = await this.get()
    if (current === null) return null
    return await this.#repository.update(withUpdate(
      this.scope,
      current,
      input,
      this.#now().toISOString(),
    ))
  }

  async archive(): Promise<SiteRecord | null> {
    const current = await this.get()
    if (current === null || current.status === 'archived') return current
    return await this.#repository.update({
      id: this.scope.siteId,
      organizationId: this.scope.organizationId,
      workspaceId: this.scope.workspaceId,
      slug: current.slug,
      name: current.name,
      status: 'archived',
      profileId: current.profileId,
      capabilityOverrides: current.capabilityOverrides,
      createdAt: current.createdAt,
      updatedAt: this.#now().toISOString(),
    })
  }
}

class BoundSite implements BoundSiteRepository {
  readonly scope: FumaRepositoryScope
  readonly #repository: SiteRepository
  readonly #now: Now

  constructor(scope: FumaRepositoryScope, repository: SiteRepository, now: Now) {
    this.scope = scope
    this.#repository = repository
    this.#now = now
    Object.freeze(this)
  }

  get(): Promise<SiteRecord | null> {
    return this.transaction(async (repository) => await repository.get())
  }

  findBySlug(slug: SiteSlug): Promise<SiteRecord | null> {
    return this.transaction(async (repository) => await repository.findBySlug(slug))
  }

  countActiveOwnedSites(): Promise<number> {
    return this.transaction(async (repository) => (
      await repository.countActiveOwnedSites()
    ))
  }

  update(input: ScopedSiteUpdate): Promise<SiteRecord | null> {
    return this.transaction(async (repository) => await repository.update(input))
  }

  archive(): Promise<SiteRecord | null> {
    return this.transaction(async (repository) => await repository.archive())
  }

  transaction<T>(
    work: (repository: BoundSiteRepositoryTransaction) => Promise<T>,
  ): Promise<T> {
    return this.#repository.transaction(
      this.scope.organizationId,
      this.scope.workspaceId,
      async (transaction) => {
        await transaction.assertActiveOwnerScope({
          platformId: this.scope.platformId,
          siteId: this.scope.siteId,
          ownerKey: this.scope.ownerKey,
          generation: this.scope.generation,
        })
        return await work(new BoundSiteTransaction(
          this.scope,
          transaction,
          this.#now,
        ))
      },
    )
  }
}

/**
 * Converts the caller-scoped site repository into a one-way scope-bound API.
 * Tenant coordinates can only enter through an immutable active authority
 * snapshot; no bound operation accepts replacement coordinates.
 */
export class ScopedSiteRepository {
  readonly #repository: SiteRepository
  readonly #now: Now

  constructor(repository: SiteRepository, now: Now = () => new Date()) {
    this.#repository = repository
    this.#now = now
  }

  forScope(scope: FumaRepositoryScope): BoundSiteRepository {
    return new BoundSite(bindActiveScope(scope), this.#repository, this.#now)
  }
}

/** Production PostgreSQL composition for callers that own the DbClient. */
export class PostgresScopedSiteRepository extends ScopedSiteRepository {
  constructor(db: DbClient, now?: Now) {
    super(new PostgresSiteRepository(db), now)
  }
}

import { describe, expect, it } from 'bun:test'
import type {
  SiteId,
  SiteOrganizationId,
  SiteRecord,
  SiteWorkspaceId,
} from '../../../server/fuma/sites/contracts'
import type {
  OwnedWorkspaceStatus,
  SiteRepository,
  SiteRepositoryTransaction,
  SiteOwnerScopeAuthority,
} from '../../../server/fuma/sites/repository'
import {
  ScopedSiteRepository,
  ScopedSiteRepositoryError,
} from '../../../server/fuma/sites/scopedRepository'
import {
  FumaRepositoryScopeResolutionError,
  type FumaRepositoryScope,
} from '../../../server/fuma/tenancy'

const NOW = '2026-07-25T14:00:00.000Z'
const NEXT = '2026-07-25T14:01:00.000Z'
const SHARED_SITE_ID = 'site-collision'
const WORKSPACE_A_ID = 'workspace-a'
const WORKSPACE_B_ID = 'workspace-b'
const SHARED_SLUG = 'shared-slug'

function key(organizationId: string, workspaceId: string, siteId: string): string {
  return `${organizationId}:${workspaceId}:${siteId}`
}

function scope(
  organizationId: string,
  workspaceId: string,
  ownerKey: string,
): FumaRepositoryScope {
  return Object.freeze({
    platformId: 'platform-fuma',
    organizationId,
    workspaceId,
    siteId: SHARED_SITE_ID,
    ownerKey,
    state: 'active' as const,
    generation: 7,
    transferFence: null,
  })
}

function record(
  organizationId: string,
  workspaceId: string,
  name: string,
): SiteRecord {
  return {
    id: SHARED_SITE_ID,
    organizationId,
    workspaceId,
    slug: SHARED_SLUG,
    name,
    status: 'active',
    profileId: 'website',
    capabilityOverrides: { grant: [], revoke: [] },
    createdAt: NOW,
    updatedAt: NOW,
  }
}

type CoordinateCall = Readonly<{
  operation: string
  organizationId: string
  workspaceId: string
  siteId?: string
}>

class InMemorySiteRepository implements SiteRepository {
  rows = new Map<string, SiteRecord>()
  authorities = new Map<string, FumaRepositoryScope>()
  calls: CoordinateCall[] = []
  failAfterNextUpdate = false

  constructor(records: readonly SiteRecord[]) {
    for (const site of records) {
      this.rows.set(key(site.organizationId, site.workspaceId, site.id), structuredClone(site))
    }
  }

  setAuthority(authority: FumaRepositoryScope): void {
    this.authorities.set([
      authority.platformId,
      authority.organizationId,
      authority.workspaceId,
      authority.siteId,
      authority.ownerKey,
    ].join(':'), structuredClone(authority))
  }

  async transaction<T>(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
    work: (tx: SiteRepositoryTransaction) => Promise<T>,
  ): Promise<T> {
    this.calls.push({ operation: 'transaction', organizationId, workspaceId })
    const snapshot = structuredClone(this.rows)
    try {
      return await work(new InMemorySiteTransaction(this, organizationId, workspaceId))
    } catch (error) {
      this.rows = snapshot
      throw error
    }
  }

  getWorkspaceStatus(
    _organizationId: SiteOrganizationId,
    _workspaceId: SiteWorkspaceId,
  ): Promise<OwnedWorkspaceStatus | null> {
    return Promise.resolve('active')
  }

  getById(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
    siteId: SiteId,
  ): Promise<SiteRecord | null> {
    this.calls.push({ operation: 'get', organizationId, workspaceId, siteId })
    return Promise.resolve(structuredClone(
      this.rows.get(key(organizationId, workspaceId, siteId)) ?? null,
    ))
  }

  listByWorkspace(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
  ): Promise<SiteRecord[]> {
    this.calls.push({ operation: 'search', organizationId, workspaceId })
    return Promise.resolve(structuredClone([...this.rows.values()].filter((site) => (
      site.organizationId === organizationId && site.workspaceId === workspaceId
    ))))
  }

  insert(site: SiteRecord): Promise<SiteRecord> {
    this.rows.set(key(site.organizationId, site.workspaceId, site.id), structuredClone(site))
    return Promise.resolve(structuredClone(site))
  }

  update(site: SiteRecord): Promise<SiteRecord> {
    this.calls.push({
      operation: 'update',
      organizationId: site.organizationId,
      workspaceId: site.workspaceId,
      siteId: site.id,
    })
    this.rows.set(key(site.organizationId, site.workspaceId, site.id), structuredClone(site))
    if (this.failAfterNextUpdate) {
      this.failAfterNextUpdate = false
      throw new Error('injected rollback')
    }
    return Promise.resolve(structuredClone(site))
  }

  countActiveOwnedSites(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
  ): Promise<number> {
    this.calls.push({ operation: 'count', organizationId, workspaceId })
    return Promise.resolve([...this.rows.values()].filter((site) => (
      site.organizationId === organizationId
      && site.workspaceId === workspaceId
      && site.status === 'active'
    )).length)
  }
}

class InMemorySiteTransaction implements SiteRepositoryTransaction {
  constructor(
    private readonly repository: InMemorySiteRepository,
    private readonly organizationId: SiteOrganizationId,
    private readonly workspaceId: SiteWorkspaceId,
  ) {}

  getWorkspaceStatus(): Promise<OwnedWorkspaceStatus | null> {
    return this.repository.getWorkspaceStatus(this.organizationId, this.workspaceId)
  }

  getById(siteId: SiteId): Promise<SiteRecord | null> {
    return this.repository.getById(this.organizationId, this.workspaceId, siteId)
  }

  getSites(): Promise<SiteRecord[]> {
    return this.repository.listByWorkspace(this.organizationId, this.workspaceId)
  }

  assertActiveOwnerScope(authority: SiteOwnerScopeAuthority): Promise<void> {
    this.repository.calls.push({
      operation: 'guard',
      organizationId: this.organizationId,
      workspaceId: this.workspaceId,
      siteId: authority.siteId,
    })
    const stored = this.repository.authorities.get([
      authority.platformId,
      this.organizationId,
      this.workspaceId,
      authority.siteId,
      authority.ownerKey,
    ].join(':'))
    if (
      stored?.state !== 'active'
      || stored.generation !== authority.generation
      || stored.transferFence !== null
    ) {
      throw new FumaRepositoryScopeResolutionError()
    }
    return Promise.resolve()
  }

  insert(site: SiteRecord): Promise<SiteRecord> {
    this.assertRecordCoordinates(site)
    return this.repository.insert(site)
  }

  update(site: SiteRecord): Promise<SiteRecord> {
    this.assertRecordCoordinates(site)
    return this.repository.update(site)
  }

  private assertRecordCoordinates(site: SiteRecord): void {
    if (
      site.organizationId !== this.organizationId
      || site.workspaceId !== this.workspaceId
    ) {
      throw new Error('Site record coordinates diverge from the bound transaction scope.')
    }
  }
}

function harness() {
  const tenantAScope = scope('organization-a', WORKSPACE_A_ID, 'owner-a')
  const tenantBScope = scope('organization-b', WORKSPACE_B_ID, 'owner-b')
  const repository = new InMemorySiteRepository([
    record('organization-a', WORKSPACE_A_ID, 'Tenant A'),
    { ...record('organization-a', WORKSPACE_A_ID, 'Sibling'), id: 'site-sibling', slug: 'sibling-slug' },
    record('organization-b', WORKSPACE_B_ID, 'Tenant B'),
  ])
  repository.setAuthority(tenantAScope)
  repository.setAuthority(tenantBScope)
  const scoped = new ScopedSiteRepository(repository, () => new Date(NEXT))
  return {
    repository,
    tenantA: scoped.forScope(tenantAScope),
    tenantB: scoped.forScope(tenantBScope),
  }
}

describe('FUMA-025 scoped site repository', () => {
  it('binds the full authority snapshot immutably and rejects transfer scope', () => {
    const authority = scope('organization-a', WORKSPACE_A_ID, 'owner-a')
    const repository = new ScopedSiteRepository(new InMemorySiteRepository([]))
    const bound = repository.forScope(authority)

    expect(bound.scope).toEqual(authority)
    expect(Object.isFrozen(bound.scope)).toBe(true)
    expect(Object.isFrozen(bound)).toBe(true)
    expect('forScope' in bound).toBe(false)

    const transferring: FumaRepositoryScope = Object.freeze({
      ...authority,
      state: 'transferring',
      transferFence: 9,
    })
    try {
      repository.forScope(transferring)
    } catch (error) {
      expect(error).toBeInstanceOf(ScopedSiteRepositoryError)
      if (!(error instanceof ScopedSiteRepositoryError)) throw error
      expect(error.code).toBe('scope-transferring')
      return
    }
    throw new Error('Expected transferring repository scope to be rejected.')
  })

  it('isolates colliding IDs and slugs for read, write, archive, search, and exact count', async () => {
    const { repository, tenantA, tenantB } = harness()

    expect((await tenantA.get())?.name).toBe('Tenant A')
    expect((await tenantB.get())?.name).toBe('Tenant B')
    expect((await tenantA.findBySlug(SHARED_SLUG))?.organizationId).toBe('organization-a')
    expect((await tenantB.findBySlug(SHARED_SLUG))?.organizationId).toBe('organization-b')
    expect(await tenantA.findBySlug('sibling-slug')).toBeNull()
    expect(await tenantA.countActiveOwnedSites()).toBe(1)
    expect(await tenantB.countActiveOwnedSites()).toBe(1)

    await tenantA.update({ name: 'Tenant A updated' })
    expect((await tenantA.get())?.name).toBe('Tenant A updated')
    expect((await tenantB.get())?.name).toBe('Tenant B')

    expect((await tenantB.archive())?.status).toBe('archived')
    expect((await tenantA.get())?.status).toBe('active')
    expect(await tenantA.countActiveOwnedSites()).toBe(1)
    expect(await tenantB.countActiveOwnedSites()).toBe(0)

    expect(repository.calls.some(({ operation }) => operation === 'search')).toBe(false)
    expect(repository.calls.some(({ operation }) => operation === 'count')).toBe(false)

    for (const call of repository.calls) {
      expect(call.workspaceId).toBe(
        call.organizationId === 'organization-a' ? WORKSPACE_A_ID : WORKSPACE_B_ID,
      )
      if (call.siteId !== undefined) expect(call.siteId).toBe(SHARED_SITE_ID)
      expect(['organization-a', 'organization-b']).toContain(call.organizationId)
    }
  })

  it('uniformly rejects every operation through a stale pre-transfer bound handle', async () => {
    const { repository, tenantA } = harness()
    repository.setAuthority(Object.freeze({
      ...tenantA.scope,
      state: 'transferring',
      generation: tenantA.scope.generation + 1,
      transferFence: 19,
    }))
    let callbackRan = false
    const attempts = [
      tenantA.get(),
      tenantA.findBySlug(SHARED_SLUG),
      tenantA.countActiveOwnedSites(),
      tenantA.update({ name: 'stale update' }),
      tenantA.archive(),
      tenantA.transaction(async () => {
        callbackRan = true
      }),
    ]
    const failures = await Promise.all(attempts.map(async (attempt) => {
      try {
        await attempt
        return null
      } catch (error) {
        return error
      }
    }))

    expect(callbackRan).toBe(false)
    expect(failures.every((error) => (
      error instanceof FumaRepositoryScopeResolutionError
      && error.code === 'denied'
      && error.message === 'Repository scope authority denied.'
    ))).toBe(true)
    expect(repository.calls.filter(({ operation }) => operation === 'get')).toHaveLength(0)
    expect(repository.calls.filter(({ operation }) => operation === 'update')).toHaveLength(0)
  })

  it('locks and checks the complete active owner tuple before exposing the bound callback', async () => {
    const source = await Bun.file(new URL(
      '../../../server/fuma/sites/repository.ts',
      import.meta.url,
    )).text()

    for (const predicate of [
      'platform_id = ${authority.platformId}',
      'organization_id = ${this.#organizationId}',
      'workspace_id = ${this.#workspaceId}',
      'site_id = ${authority.siteId}',
      'owner_key = ${authority.ownerKey}',
      'generation = ${authority.generation}',
      "state = 'active'",
      'transfer_id is null',
      'transfer_lock_id is null',
      'transfer_fence is null',
      'for share',
    ]) expect(source).toContain(predicate)
  })

  it('passes the same non-replaceable scope into a transaction and rolls back injected failure', async () => {
    const { repository, tenantA, tenantB } = harness()
    let transactionScope: FumaRepositoryScope | undefined

    repository.failAfterNextUpdate = true
    await expect(tenantA.transaction(async (transaction) => {
      transactionScope = transaction.scope
      expect(transaction.scope).toBe(tenantA.scope)
      expect(Object.isFrozen(transaction)).toBe(true)
      expect('forScope' in transaction).toBe(false)
      await transaction.update({ name: 'Must roll back' })
    })).rejects.toThrow('injected rollback')

    expect(transactionScope).toBe(tenantA.scope)
    expect((await tenantA.get())?.name).toBe('Tenant A')
    expect((await tenantB.get())?.name).toBe('Tenant B')
  })
})

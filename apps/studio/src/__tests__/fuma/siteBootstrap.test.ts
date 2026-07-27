import { describe, expect, it } from 'bun:test'
import { createFumaRegistry } from '@core/fuma'
import type {
  SiteId,
  SiteOrganizationId,
  SiteRecord,
  SiteSlug,
  SiteWorkspaceId,
} from '../../../server/fuma/sites/contracts'
import {
  LEGACY_WEBSITE_PROFILE_ID,
  LegacySiteBootstrapService,
  type LegacyBootstrapWorkspaceAuthority,
  type LegacySiteAuthority,
  type LegacySiteBootstrapRepository,
  type LegacySiteBootstrapTransaction,
} from '../../../server/fuma/sites/legacyBootstrap'
import type {
  OwnedWorkspaceStatus,
  SiteRepository,
  SiteRepositoryTransaction,
} from '../../../server/fuma/sites/repository'
import { SiteService } from '../../../server/fuma/sites/service'


class MemorySiteTransaction implements SiteRepositoryTransaction {
  constructor(
    private readonly repository: MemoryBootstrapRepository,
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

  assertActiveOwnerScope(): Promise<void> {
    return Promise.resolve()
  }

  insert(record: SiteRecord): Promise<SiteRecord> {
    this.assertRecordCoordinates(record)
    return this.repository.insert(record)
  }

  update(record: SiteRecord): Promise<SiteRecord> {
    this.assertRecordCoordinates(record)
    return this.repository.update(record)
  }

  private assertRecordCoordinates(record: SiteRecord): void {
    if (
      record.organizationId !== this.organizationId
      || record.workspaceId !== this.workspaceId
    ) {
      throw new Error('Site record coordinates diverge from the bound transaction scope.')
    }
  }
}

const NOW = '2026-07-24T20:02:37.898Z'
const EMPTY_OVERRIDES = { grant: [], revoke: [] } as const

function scopeKey(organizationId: string, workspaceId: string): string {
  return `${organizationId}:${workspaceId}`
}

function siteKey(organizationId: string, workspaceId: string, siteId: string): string {
  return `${scopeKey(organizationId, workspaceId)}:${siteId}`
}

class MemoryBootstrapRepository implements
  LegacySiteBootstrapRepository,
  LegacySiteBootstrapTransaction,
  SiteRepository {
  legacySites: LegacySiteAuthority[] = [{ id: 'default', name: 'Legacy site' }]
  legacyContent = new Map([
    ['data_rows:pages:home', { id: 'home', parentId: 'default' }],
    ['media:hero', { id: 'hero', usedBy: 'home' }],
  ])
  workspaces = new Map<string, LegacyBootstrapWorkspaceAuthority>()
  sites = new Map<string, SiteRecord>()
  transactionCount = 0
  ownershipLockCount = 0
  workspaceLocks: string[] = []
  insertCount = 0
  failInsert = false

  addWorkspace(
    organizationId: string,
    workspaceId: string,
    options: { isDefault?: boolean; status?: OwnedWorkspaceStatus } = {},
  ): void {
    this.workspaces.set(scopeKey(organizationId, workspaceId), {
      organizationId,
      workspaceId,
      isDefault: options.isDefault ?? true,
      status: options.status ?? 'active',
    })
  }

  transaction<T>(work: (tx: LegacySiteBootstrapTransaction) => Promise<T>): Promise<T>
  transaction<T>(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
    work: (tx: SiteRepositoryTransaction) => Promise<T>,
  ): Promise<T>
  async transaction<T>(
    scopeOrWork: SiteOrganizationId | ((tx: LegacySiteBootstrapTransaction) => Promise<T>),
    workspaceId?: SiteWorkspaceId,
    scopedWork?: (tx: SiteRepositoryTransaction) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1
    const sites = structuredClone(this.sites)
    try {
      if (typeof scopeOrWork === 'function') return await scopeOrWork(this)
      if (!workspaceId || !scopedWork) {
        throw new Error('Scoped site transaction requires a workspace ID and callback.')
      }
      await this.lockWorkspace(scopeOrWork, workspaceId)
      return await scopedWork(new MemorySiteTransaction(this, scopeOrWork, workspaceId))
    } catch (error) {
      this.sites = sites
      throw error
    }
  }

  lockSiteOwnership(): Promise<void> {
    this.ownershipLockCount += 1
    return Promise.resolve()
  }

  readLegacySiteAuthority(): Promise<readonly LegacySiteAuthority[]> {
    return Promise.resolve(structuredClone(this.legacySites))
  }

  getWorkspaceAuthority(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
  ): Promise<LegacyBootstrapWorkspaceAuthority | null> {
    return Promise.resolve(structuredClone(
      this.workspaces.get(scopeKey(organizationId, workspaceId)) ?? null,
    ))
  }

  findBySiteId(siteId: SiteId): Promise<SiteRecord[]> {
    return Promise.resolve(structuredClone(
      [...this.sites.values()].filter(({ id }) => id === siteId),
    ))
  }

  findBySlug(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
    slug: SiteSlug,
  ): Promise<SiteRecord | null> {
    const site = [...this.sites.values()].find((candidate) => (
      candidate.organizationId === organizationId
      && candidate.workspaceId === workspaceId
      && candidate.slug.toLowerCase() === slug.toLowerCase()
    ))
    return Promise.resolve(structuredClone(site ?? null))
  }

  lockWorkspace(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
  ): Promise<void> {
    this.workspaceLocks.push(scopeKey(organizationId, workspaceId))
    return Promise.resolve()
  }

  getWorkspaceStatus(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
  ): Promise<OwnedWorkspaceStatus | null> {
    return Promise.resolve(
      this.workspaces.get(scopeKey(organizationId, workspaceId))?.status ?? null,
    )
  }

  getById(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
    siteId: SiteId,
  ): Promise<SiteRecord | null> {
    return Promise.resolve(structuredClone(
      this.sites.get(siteKey(organizationId, workspaceId, siteId)) ?? null,
    ))
  }

  listByWorkspace(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
  ): Promise<SiteRecord[]> {
    return Promise.resolve(structuredClone(
      [...this.sites.values()].filter((site) => (
        site.organizationId === organizationId && site.workspaceId === workspaceId
      )),
    ))
  }

  insert(record: SiteRecord): Promise<SiteRecord> {
    if (this.failInsert) throw new Error('simulated bootstrap insert failure')
    const key = siteKey(record.organizationId, record.workspaceId, record.id)
    if (this.sites.has(key)) throw new Error(`duplicate site ${record.id}`)
    this.insertCount += 1
    this.sites.set(key, structuredClone(record))
    return Promise.resolve(structuredClone(record))
  }

  update(record: SiteRecord): Promise<SiteRecord> {
    const key = siteKey(record.organizationId, record.workspaceId, record.id)
    if (!this.sites.has(key)) throw new Error(`missing site ${record.id}`)
    this.sites.set(key, structuredClone(record))
    return Promise.resolve(structuredClone(record))
  }

  countActiveOwnedSites(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
  ): Promise<number> {
    return Promise.resolve([...this.sites.values()].filter((site) => (
      site.organizationId === organizationId
      && site.workspaceId === workspaceId
      && site.status === 'active'
    )).length)
  }
}

function harness() {
  const repository = new MemoryBootstrapRepository()
  repository.addWorkspace('organization-a', 'workspace-default')
  const bootstrap = new LegacySiteBootstrapService({
    repository,
    now: () => new Date(NOW),
  })
  return { bootstrap, repository }
}

function bootstrapInput(overrides: unknown = EMPTY_OVERRIDES) {
  return {
    organizationId: 'organization-a',
    workspaceId: 'workspace-default',
    slug: ' Legacy Website ',
    capabilityOverrides: overrides,
  }
}

function bootstrapError(code: string) {
  return expect.objectContaining({ name: 'LegacySiteBootstrapError', code })
}

function record(
  id: string,
  organizationId: string,
  workspaceId: string,
  profileId = LEGACY_WEBSITE_PROFILE_ID,
): SiteRecord {
  return {
    id,
    organizationId,
    workspaceId,
    slug: `${id}-slug`,
    name: id,
    status: 'active',
    profileId,
    capabilityOverrides: { grant: [], revoke: [] },
    createdAt: NOW,
    updatedAt: NOW,
  }
}

describe('FUMA-016 legacy site bootstrap integration', () => {
  it('creates the Website with exactly the historical ID and leaves all legacy authority/content untouched', async () => {
    const { bootstrap, repository } = harness()
    repository.legacySites = [{ id: 'legacy-site-id', name: 'Existing Instatic site' }]
    const legacyBefore = structuredClone(repository.legacySites)
    const contentBefore = structuredClone(repository.legacyContent)

    const created = await bootstrap.bootstrap(bootstrapInput())

    expect(created).toEqual({
      id: 'legacy-site-id',
      organizationId: 'organization-a',
      workspaceId: 'workspace-default',
      slug: 'legacy-website',
      name: 'Existing Instatic site',
      status: 'active',
      profileId: 'website',
      capabilityOverrides: EMPTY_OVERRIDES,
      createdAt: NOW,
      updatedAt: NOW,
    })
    expect(repository.legacySites).toEqual(legacyBefore)
    expect(repository.legacyContent).toEqual(contentBefore)
    expect(repository.transactionCount).toBe(1)
    expect(repository.ownershipLockCount).toBe(1)
  })

  it('is idempotent and returns the same owned record without inserting again', async () => {
    const { bootstrap, repository } = harness()
    const first = await bootstrap.bootstrap(bootstrapInput())
    const second = await bootstrap.bootstrap(bootstrapInput({
      grant: ['publication.editorial.schedule'],
      revoke: [],
    }))

    expect(second).toEqual(first)
    expect(repository.insertCount).toBe(1)
    expect(repository.transactionCount).toBe(2)
    expect(repository.ownershipLockCount).toBe(2)
  })

  it('rejects organization/workspace mismatch, non-default parents, and archived defaults', async () => {
    const { bootstrap, repository } = harness()
    repository.addWorkspace('organization-b', 'workspace-b')
    repository.addWorkspace('organization-a', 'workspace-secondary', { isDefault: false })
    repository.addWorkspace('organization-a', 'workspace-archived', { status: 'archived' })

    await expect(bootstrap.bootstrap({
      ...bootstrapInput(),
      workspaceId: 'workspace-b',
    })).rejects.toEqual(bootstrapError('workspace-org-mismatch'))
    await expect(bootstrap.bootstrap({
      ...bootstrapInput(),
      workspaceId: 'workspace-secondary',
    })).rejects.toEqual(bootstrapError('workspace-org-mismatch'))
    await expect(bootstrap.bootstrap({
      ...bootstrapInput(),
      workspaceId: 'workspace-archived',
    })).rejects.toEqual(bootstrapError('archived-workspace'))
  })

  it('rejects unknown profile surfaces, malformed or unknown overrides, and caller profile replacement', async () => {
    const { bootstrap } = harness()
    await expect(bootstrap.bootstrap(bootstrapInput({
      grant: ['unknown.capability'],
      revoke: [],
    }))).rejects.toEqual(bootstrapError('invalid-capability-overrides'))
    await expect(bootstrap.bootstrap(bootstrapInput({ grant: [] })))
      .rejects.toEqual(bootstrapError('invalid-input'))
    await expect(bootstrap.bootstrap({
      ...bootstrapInput(),
      profileId: 'unknown-profile',
    })).rejects.toEqual(bootstrapError('invalid-input'))

    const repository = new MemoryBootstrapRepository()
    repository.addWorkspace('organization-a', 'workspace-default')
    const registryWithoutWebsite = createFumaRegistry({
      capabilities: [{ id: 'publication.base' }],
      profiles: [{
        id: 'publication',
        label: 'Publication',
        capabilityPreset: ['publication.base'],
        navigationPreset: [],
        onboardingPreset: [],
        starterTemplatePreset: [],
      }],
    })
    const missingWebsite = new LegacySiteBootstrapService({
      repository,
      registry: registryWithoutWebsite,
      now: () => new Date(NOW),
    })
    await expect(missingWebsite.bootstrap(bootstrapInput()))
      .rejects.toEqual(bootstrapError('invalid-profile'))
  })

  it('rejects conflicting preexisting ownership and conflicting same-owner profile assignment', async () => {
    const { bootstrap, repository } = harness()
    repository.sites.set(
      siteKey('organization-b', 'workspace-b', 'default'),
      record('default', 'organization-b', 'workspace-b'),
    )
    await expect(bootstrap.bootstrap(bootstrapInput()))
      .rejects.toEqual(bootstrapError('ownership-conflict'))

    repository.sites.clear()
    repository.sites.set(
      siteKey('organization-a', 'workspace-default', 'default'),
      record('default', 'organization-a', 'workspace-default', 'publication'),
    )
    await expect(bootstrap.bootstrap(bootstrapInput()))
      .rejects.toEqual(bootstrapError('site-conflict'))
  })

  it('rolls back failed creation and rejects ambiguous historical authority', async () => {
    const { bootstrap, repository } = harness()
    repository.failInsert = true
    await expect(bootstrap.bootstrap(bootstrapInput()))
      .rejects.toThrow('simulated bootstrap insert failure')
    expect(repository.sites.size).toBe(0)

    repository.failInsert = false
    repository.legacySites.push({ id: 'second-site', name: 'Second' })
    await expect(bootstrap.bootstrap(bootstrapInput()))
      .rejects.toEqual(bootstrapError('legacy-site-authority-conflict'))
  })

  it('creates a Publication beside the bootstrapped Website through the normal service', async () => {
    const { bootstrap, repository } = harness()
    const website = await bootstrap.bootstrap(bootstrapInput())
    const sites = new SiteService({ repository, now: () => new Date(NOW) })
    const publication = await sites.create({
      id: 'editorial-publication',
      organizationId: 'organization-a',
      workspaceId: 'workspace-default',
      slug: 'editorial',
      name: 'Editorial publication',
      profileId: 'publication',
      capabilityOverrides: EMPTY_OVERRIDES,
    })

    expect(website.profileId).toBe('website')
    expect(publication.profileId).toBe('publication')
    expect((await sites.list('organization-a', 'workspace-default')).map(({ id }) => id))
      .toEqual(['default', 'editorial-publication'])
  })

  it('contains no legacy content rewrites, HTTP mounting, or profile-ID branch conditions', async () => {
    const source = await Bun.file(new URL(
      '../../../server/fuma/sites/legacyBootstrap.ts',
      import.meta.url,
    )).text()

    expect(source).toContain('from site')
    expect(source).not.toMatch(/(?:insert into|update|delete from)\s+(?:site|data_tables|data_rows|media)\b/i)
    expect(source).not.toContain('server/router')
    expect(source).not.toMatch(/if\s*\([^)]*profileId\s*[!=]==?\s*['"](?:website|publication)['"]/)
    expect(source).not.toMatch(/switch\s*\([^)]*profileId/)
  })
})

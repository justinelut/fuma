import { describe, expect, it } from 'bun:test'
import { createFumaRegistry } from '@core/fuma'
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
} from '../../../server/fuma/sites/repository'
import {
  SiteDomainError,
  SiteService,
} from '../../../server/fuma/sites/service'

function scopeKey(organizationId: string, workspaceId: string): string {
  return `${organizationId}:${workspaceId}`
}

function siteKey(organizationId: string, workspaceId: string, siteId: string): string {
  return `${scopeKey(organizationId, workspaceId)}:${siteId}`
}

class InMemorySiteRepository implements SiteRepository {
  rows = new Map<string, SiteRecord>()
  workspaces = new Map<string, OwnedWorkspaceStatus>()
  transactionCount = 0
  locks: string[] = []
  failNextUpdate = false

  addWorkspace(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
    status: OwnedWorkspaceStatus = 'active',
  ): void {
    this.workspaces.set(scopeKey(organizationId, workspaceId), status)
  }

  async transaction<T>(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
    work: (tx: SiteRepositoryTransaction) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1
    await this.lockWorkspace(organizationId, workspaceId)
    const snapshot = structuredClone(this.rows)
    try {
      return await work(new InMemorySiteTransaction(this, organizationId, workspaceId))
    } catch (error) {
      this.rows = snapshot
      throw error
    }
  }

  lockWorkspace(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
  ): Promise<void> {
    this.locks.push(scopeKey(organizationId, workspaceId))
    return Promise.resolve()
  }

  getWorkspaceStatus(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
  ): Promise<OwnedWorkspaceStatus | null> {
    return Promise.resolve(this.workspaces.get(scopeKey(organizationId, workspaceId)) ?? null)
  }

  getById(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
    siteId: SiteId,
  ): Promise<SiteRecord | null> {
    return Promise.resolve(structuredClone(
      this.rows.get(siteKey(organizationId, workspaceId, siteId)) ?? null,
    ))
  }

  listByWorkspace(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
  ): Promise<SiteRecord[]> {
    const rows = [...this.rows.values()]
      .filter((site) => (
        site.organizationId === organizationId && site.workspaceId === workspaceId
      ))
      .sort((left, right) => (
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      ))
    return Promise.resolve(structuredClone(rows))
  }

  insert(record: SiteRecord): Promise<SiteRecord> {
    const key = siteKey(record.organizationId, record.workspaceId, record.id)
    if (this.rows.has(key)) throw new Error(`duplicate site ID ${record.id}`)
    this.#assertSlugConstraint(record)
    this.rows.set(key, structuredClone(record))
    return Promise.resolve(structuredClone(record))
  }

  update(record: SiteRecord): Promise<SiteRecord> {
    const key = siteKey(record.organizationId, record.workspaceId, record.id)
    if (!this.rows.has(key)) throw new Error(`missing site ${record.id}`)
    if (this.failNextUpdate) {
      this.failNextUpdate = false
      throw new Error('simulated site update failure')
    }
    this.#assertSlugConstraint(record)
    this.rows.set(key, structuredClone(record))
    return Promise.resolve(structuredClone(record))
  }

  countActiveOwnedSites(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
  ): Promise<number> {
    const count = [...this.rows.values()].filter((site) => (
      site.organizationId === organizationId
      && site.workspaceId === workspaceId
      && site.status === 'active'
    )).length
    return Promise.resolve(count)
  }

  #assertSlugConstraint(candidate: SiteRecord): void {
    for (const row of this.rows.values()) {
      if (
        row.id === candidate.id
        || row.organizationId !== candidate.organizationId
        || row.workspaceId !== candidate.workspaceId
      ) continue
      if (row.slug.toLowerCase() === candidate.slug.toLowerCase()) {
        throw new Error(`duplicate workspace site slug ${candidate.slug}`)
      }
    }
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

const NOW = '2026-07-24T19:36:39.218Z'
const EMPTY_OVERRIDES = { grant: [], revoke: [] }

function harness() {
  const repository = new InMemorySiteRepository()
  repository.addWorkspace('organization-a', 'workspace-a')
  repository.addWorkspace('organization-a', 'workspace-b')
  repository.addWorkspace('organization-b', 'workspace-a')
  const sites = new SiteService({ repository, now: () => new Date(NOW) })
  return { repository, sites }
}

function createInput(
  id: string,
  organizationId: string,
  workspaceId: string,
  slug: string,
  profileId = 'website',
) {
  return {
    id,
    organizationId,
    workspaceId,
    slug,
    name: ` ${id} `,
    profileId,
    capabilityOverrides: EMPTY_OVERRIDES,
  }
}

function domainError(code: SiteDomainError['code']) {
  return expect.objectContaining({ name: 'SiteDomainError', code })
}

describe('FUMA-016 site service', () => {
  it('creates, lists, and gets normalized sites while allowing equal slugs in different workspaces', async () => {
    const { repository, sites } = harness()

    const first = await sites.create(createInput(
      'site-a',
      'organization-a',
      'workspace-a',
      '  Café North  ',
    ))
    const second = await sites.create(createInput(
      'site-b',
      'organization-a',
      'workspace-b',
      'CAFÉ NORTH',
    ))
    const third = await sites.create(createInput(
      'site-a',
      'organization-b',
      'workspace-a',
      'CAFÉ NORTH',
    ))

    expect(first).toMatchObject({ slug: 'cafe-north', name: 'site-a', status: 'active' })
    expect(second.slug).toBe('cafe-north')
    expect(third.slug).toBe('cafe-north')
    expect((await sites.list('organization-a', 'workspace-a')).map(({ id }) => id)).toEqual([
      'site-a',
    ])
    expect(await sites.get('organization-a', 'workspace-b', 'site-b')).toEqual(second)
    expect(repository.locks).toEqual([
      'organization-a:workspace-a',
      'organization-a:workspace-b',
      'organization-b:workspace-a',
    ])
    expect(await repository.countActiveOwnedSites('organization-a', 'workspace-a')).toBe(1)
    expect(await repository.countActiveOwnedSites('organization-a', 'workspace-b')).toBe(1)
  })

  it('explicitly denies cross-workspace and cross-organization reads and mutations', async () => {
    const { sites } = harness()
    await sites.create(createInput(
      'private-site',
      'organization-a',
      'workspace-a',
      'private',
    ))

    await expect(sites.get('organization-a', 'workspace-b', 'private-site'))
      .rejects.toEqual(domainError('not-found'))
    await expect(sites.get('organization-b', 'workspace-a', 'private-site'))
      .rejects.toEqual(domainError('not-found'))
    await expect(sites.update({
      organizationId: 'organization-a',
      workspaceId: 'workspace-b',
      siteId: 'private-site',
      name: 'Cross-workspace update',
    })).rejects.toEqual(domainError('not-found'))
    await expect(sites.archive({
      organizationId: 'organization-b',
      workspaceId: 'workspace-a',
      siteId: 'private-site',
    })).rejects.toEqual(domainError('not-found'))
    expect((await sites.get('organization-a', 'workspace-a', 'private-site')).name)
      .toBe('private-site')
  })

  it('enforces workspace ownership and blocks mutations under archived workspaces', async () => {
    const { repository, sites } = harness()
    repository.addWorkspace('organization-a', 'workspace-archived', 'archived')

    await expect(sites.list('organization-a', 'missing-workspace'))
      .rejects.toEqual(domainError('workspace-not-found'))
    await expect(sites.create(createInput(
      'missing-parent',
      'organization-b',
      'workspace-b',
      'missing-parent',
    ))).rejects.toEqual(domainError('workspace-not-found'))
    await expect(sites.create(createInput(
      'archived-parent',
      'organization-a',
      'workspace-archived',
      'archived-parent',
    ))).rejects.toEqual(domainError('archived-workspace'))
  })

  it('rejects reserved and tenant-local duplicate slugs while keeping profile assignment immutable', async () => {
    const { sites } = harness()

    await expect(sites.create(createInput(
      'reserved',
      'organization-a',
      'workspace-a',
      ' ADMIN ',
    ))).rejects.toEqual(domainError('reserved-slug'))
    await sites.create(createInput('one', 'organization-a', 'workspace-a', 'one'))
    await sites.create(createInput('two', 'organization-a', 'workspace-a', 'two'))
    await expect(sites.update({
      organizationId: 'organization-a',
      workspaceId: 'workspace-a',
      siteId: 'two',
      slug: ' ONE ',
    })).rejects.toEqual(domainError('slug-conflict'))
    await expect(sites.update({
      organizationId: 'organization-a',
      workspaceId: 'workspace-a',
      siteId: 'one',
      name: 'Changed',
      profileId: 'publication',
    })).rejects.toEqual(domainError('immutable-profile-assignment'))
    expect((await sites.get('organization-a', 'workspace-a', 'one')).profileId).toBe('website')
  })

  it('validates profiles and override updates through an injected registry without profile-ID branches', async () => {
    const repository = new InMemorySiteRepository()
    repository.addWorkspace('organization-custom', 'workspace-custom')
    const registry = createFumaRegistry({
      capabilities: [
        { id: 'custom.base' },
        { id: 'custom.extra', dependsOn: ['custom.base'] },
      ],
      profiles: [{
        id: 'custom-profile',
        label: 'Custom',
        capabilityPreset: ['custom.base'],
        navigationPreset: [],
        onboardingPreset: [],
        starterTemplatePreset: [],
      }],
    })
    const sites = new SiteService({ repository, registry, now: () => new Date(NOW) })

    const created = await sites.create(createInput(
      'custom-site',
      'organization-custom',
      'workspace-custom',
      'custom',
      'custom-profile',
    ))
    expect(created.profileId).toBe('custom-profile')
    const updated = await sites.update({
      organizationId: 'organization-custom',
      workspaceId: 'workspace-custom',
      siteId: 'custom-site',
      capabilityOverrides: { grant: ['custom.extra'], revoke: [] },
    })
    expect(updated.capabilityOverrides).toEqual({ grant: ['custom.extra'], revoke: [] })

    await expect(sites.create(createInput(
      'unknown-profile',
      'organization-custom',
      'workspace-custom',
      'unknown-profile',
      'website',
    ))).rejects.toEqual(domainError('invalid-profile'))
    await expect(sites.update({
      organizationId: 'organization-custom',
      workspaceId: 'workspace-custom',
      siteId: 'custom-site',
      capabilityOverrides: { grant: ['unknown-capability'], revoke: [] },
    })).rejects.toEqual(domainError('invalid-capability-overrides'))
  })

  it('archives and restores idempotently, guards archived updates, and counts only active owned sites', async () => {
    const { repository, sites } = harness()
    await sites.create(createInput('lifecycle', 'organization-a', 'workspace-a', 'lifecycle'))

    const archived = await sites.archive({
      organizationId: 'organization-a',
      workspaceId: 'workspace-a',
      siteId: 'lifecycle',
    })
    expect(archived.status).toBe('archived')
    expect(await repository.countActiveOwnedSites('organization-a', 'workspace-a')).toBe(0)
    await expect(sites.update({
      organizationId: 'organization-a',
      workspaceId: 'workspace-a',
      siteId: 'lifecycle',
      name: 'Cannot change',
    })).rejects.toEqual(domainError('archived-site'))
    expect(await sites.archive({
      organizationId: 'organization-a',
      workspaceId: 'workspace-a',
      siteId: 'lifecycle',
    })).toEqual(archived)

    const restored = await sites.restore({
      organizationId: 'organization-a',
      workspaceId: 'workspace-a',
      siteId: 'lifecycle',
    })
    expect(restored.status).toBe('active')
    expect(await repository.countActiveOwnedSites('organization-a', 'workspace-a')).toBe(1)
    expect(await sites.restore({
      organizationId: 'organization-a',
      workspaceId: 'workspace-a',
      siteId: 'lifecycle',
    })).toEqual(restored)
  })

  it('uses transactions and workspace locks for every slug and lifecycle mutation', async () => {
    const { repository, sites } = harness()
    await sites.create(createInput('atomic', 'organization-a', 'workspace-a', 'atomic'))
    await sites.update({
      organizationId: 'organization-a',
      workspaceId: 'workspace-a',
      siteId: 'atomic',
      slug: 'renamed',
    })
    await sites.archive({
      organizationId: 'organization-a',
      workspaceId: 'workspace-a',
      siteId: 'atomic',
    })
    repository.failNextUpdate = true
    await expect(sites.restore({
      organizationId: 'organization-a',
      workspaceId: 'workspace-a',
      siteId: 'atomic',
    })).rejects.toThrow('simulated site update failure')

    expect(repository.transactionCount).toBe(4)
    expect(repository.locks).toEqual(Array(4).fill('organization-a:workspace-a'))
    expect((await sites.get('organization-a', 'workspace-a', 'atomic')).status).toBe('archived')
  })

  it('rejects hostile record-coordinate substitution inside a bound transaction callback', async () => {
    const { repository, sites } = harness()
    const site = await sites.create(createInput(
      'bound-site',
      'organization-a',
      'workspace-a',
      'bound-site',
    ))

    await repository.transaction('organization-a', 'workspace-a', async (transaction) => {
      await expect(Promise.resolve().then(async () => await transaction.insert({
        ...site,
        id: 'hostile-insert',
        organizationId: 'organization-b',
      }))).rejects.toThrow('diverge from the bound transaction scope')
      await expect(Promise.resolve().then(async () => await transaction.update({
        ...site,
        workspaceId: 'workspace-b',
      }))).rejects.toThrow('diverge from the bound transaction scope')
    })

    expect(await sites.get('organization-a', 'workspace-a', 'bound-site')).toEqual(site)
    await expect(sites.get('organization-b', 'workspace-a', 'hostile-insert'))
      .rejects.toEqual(domainError('not-found'))
  })

  it('keeps repository queries tenant-qualified and profile behavior registry-driven', async () => {
    const [repositorySource, serviceSource] = await Promise.all([
      '../../../server/fuma/sites/repository.ts',
      '../../../server/fuma/sites/service.ts',
    ].map(async (path) => await Bun.file(new URL(path, import.meta.url)).text()))

    expect(repositorySource).toContain('SiteCapabilityOverridesSchema')
    expect(repositorySource).toContain('organization_id = ${organizationId}')
    expect(repositorySource).toContain('workspace_id = ${workspaceId}')
    expect(serviceSource).not.toMatch(/profileId\s*===?\s*['"](?:website|publication)['"]/)
    expect(serviceSource).not.toMatch(/\b(?:website|publication)\b/)
  })
})

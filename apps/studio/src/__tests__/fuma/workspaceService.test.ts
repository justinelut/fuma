import { describe, expect, it } from 'bun:test'
import type {
  WorkspaceId,
  WorkspaceOrganizationId,
  WorkspaceRecord,
} from '../../../server/fuma/workspaces/contracts'
import type {
  WorkspaceRepository,
  WorkspaceRepositoryTransaction,
} from '../../../server/fuma/workspaces/repository'
import {
  WorkspaceDomainError,
  WorkspaceService,
  type WorkspaceSiteCountGuard,
} from '../../../server/fuma/workspaces/service'

class InMemoryWorkspaceRepository implements WorkspaceRepository {
  rows = new Map<WorkspaceId, WorkspaceRecord>()
  transactionCount = 0
  lockCount = 0
  readonly transactionScopes: WorkspaceOrganizationId[] = []
  failDefaultAssignmentFor: WorkspaceId | null = null

  async transaction<T>(
    organizationId: WorkspaceOrganizationId,
    work: (tx: WorkspaceRepositoryTransaction) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1
    this.lockCount += 1
    this.transactionScopes.push(organizationId)
    const snapshot = structuredClone(this.rows)
    const transaction: WorkspaceRepositoryTransaction = {
      getById: async (workspaceId) => await this.#getById(organizationId, workspaceId),
      list: async () => await this.#list(organizationId),
      insert: async (record) => await this.#insert(organizationId, record),
      update: async (record) => await this.#update(organizationId, record),
    }
    try {
      return await work(transaction)
    } catch (error) {
      this.rows = snapshot
      throw error
    }
  }

  getById(
    organizationId: WorkspaceOrganizationId,
    workspaceId: WorkspaceId,
  ): Promise<WorkspaceRecord | null> {
    return this.#getById(organizationId, workspaceId)
  }

  listByOrganization(organizationId: WorkspaceOrganizationId): Promise<WorkspaceRecord[]> {
    return this.#list(organizationId)
  }

  #getById(
    organizationId: WorkspaceOrganizationId,
    workspaceId: WorkspaceId,
  ): Promise<WorkspaceRecord | null> {
    const workspace = this.rows.get(workspaceId)
    return Promise.resolve(structuredClone(
      workspace?.organizationId === organizationId ? workspace : null,
    ))
  }

  #list(organizationId: WorkspaceOrganizationId): Promise<WorkspaceRecord[]> {
    const rows = [...this.rows.values()]
      .filter((workspace) => workspace.organizationId === organizationId)
      .sort((left, right) => (
        Number(right.isDefault) - Number(left.isDefault)
        || left.createdAt.localeCompare(right.createdAt)
        || left.id.localeCompare(right.id)
      ))
    return Promise.resolve(structuredClone(rows))
  }

  #insert(
    organizationId: WorkspaceOrganizationId,
    record: WorkspaceRecord,
  ): Promise<WorkspaceRecord> {
    if (record.organizationId !== organizationId) throw new Error('cross-organization insert')
    if (this.rows.has(record.id)) throw new Error(`duplicate workspace ID ${record.id}`)
    this.#assertConstraints(record)
    this.rows.set(record.id, structuredClone(record))
    return Promise.resolve(structuredClone(record))
  }

  #update(
    organizationId: WorkspaceOrganizationId,
    record: WorkspaceRecord,
  ): Promise<WorkspaceRecord> {
    const existing = this.rows.get(record.id)
    if (record.organizationId !== organizationId || existing?.organizationId !== organizationId) {
      throw new Error(`missing workspace ${record.id}`)
    }
    if (record.isDefault && this.failDefaultAssignmentFor === record.id) {
      throw new Error(`simulated default assignment failure for ${record.id}`)
    }
    this.#assertConstraints(record)
    this.rows.set(record.id, structuredClone(record))
    return Promise.resolve(structuredClone(record))
  }

  #assertConstraints(candidate: WorkspaceRecord): void {
    for (const row of this.rows.values()) {
      if (row.id === candidate.id || row.organizationId !== candidate.organizationId) continue
      if (row.slug.toLowerCase() === candidate.slug.toLowerCase()) {
        throw new Error(`duplicate organization slug ${candidate.slug}`)
      }
      if (row.isDefault && candidate.isDefault) {
        throw new Error(`duplicate organization default ${candidate.organizationId}`)
      }
    }
  }
}

class DeterministicSiteCountGuard implements WorkspaceSiteCountGuard {
  readonly counts = new Map<string, number>()
  readonly calls: string[] = []

  countActiveOwnedSites(
    organizationId: WorkspaceOrganizationId,
    workspaceId: WorkspaceId,
  ): Promise<number> {
    const key = `${organizationId}:${workspaceId}`
    this.calls.push(key)
    return Promise.resolve(this.counts.get(key) ?? 0)
  }
}

const NOW = '2026-07-24T18:33:34.041Z'

function harness() {
  const repository = new InMemoryWorkspaceRepository()
  const siteCountGuard = new DeterministicSiteCountGuard()
  const workspaces = new WorkspaceService({
    repository,
    siteCountGuard,
    now: () => new Date(NOW),
  })
  return { repository, siteCountGuard, workspaces }
}

function createInput(
  id: string,
  organizationId: string,
  slug: string,
  name = slug,
) {
  return { id, organizationId, slug, name }
}

function domainError(code: WorkspaceDomainError['code']) {
  return expect.objectContaining({ name: 'WorkspaceDomainError', code })
}

function archivedRecord(
  id: string,
  organizationId: string,
  isDefault = false,
): WorkspaceRecord {
  return {
    id,
    organizationId,
    slug: id,
    name: id,
    status: 'archived',
    isDefault,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

describe('FUMA-015 workspace service', () => {
  it('normalizes tenant-qualified slugs, preserves the same slug across organizations, and defaults each first workspace', async () => {
    const { workspaces } = harness()

    const alpha = await workspaces.create(createInput(
      'workspace-alpha',
      'organization-alpha',
      '  Café North  ',
      ' Alpha Workspace ',
    ))
    const beta = await workspaces.create(createInput(
      'workspace-beta',
      'organization-beta',
      'CAFÉ NORTH',
      'Beta Workspace',
    ))
    const alphaSecond = await workspaces.create(createInput(
      'workspace-alpha-second',
      'organization-alpha',
      'Editorial',
      'Editorial',
    ))

    expect(alpha).toMatchObject({
      organizationId: 'organization-alpha',
      slug: 'cafe-north',
      name: 'Alpha Workspace',
      isDefault: true,
    })
    expect(beta).toMatchObject({
      organizationId: 'organization-beta',
      slug: 'cafe-north',
      isDefault: true,
    })
    expect(alphaSecond.isDefault).toBe(false)
    expect((await workspaces.list('organization-alpha')).map(({ id }) => id)).toEqual([
      'workspace-alpha',
      'workspace-alpha-second',
    ])
    expect((await workspaces.list('organization-beta')).map(({ id }) => id)).toEqual([
      'workspace-beta',
    ])

    process.stdout.write(
      `[FUMA-015 demo] shared-slug=${alpha.slug} orgs=${alpha.organizationId},${beta.organizationId} defaults=${alpha.id},${beta.id}\n`,
    )
  })

  it('switches the explicit default atomically and rolls back a partial repository failure', async () => {
    const { repository, workspaces } = harness()
    await workspaces.create(createInput('workspace-one', 'organization-one', 'one'))
    await workspaces.create(createInput('workspace-two', 'organization-one', 'two'))

    const switched = await workspaces.setDefault({
      organizationId: 'organization-one',
      workspaceId: 'workspace-two',
    })
    expect(switched.isDefault).toBe(true)
    expect((await workspaces.list('organization-one')).filter(({ isDefault }) => isDefault)).toEqual([
      expect.objectContaining({ id: 'workspace-two' }),
    ])

    repository.failDefaultAssignmentFor = 'workspace-one'
    await expect(workspaces.setDefault({
      organizationId: 'organization-one',
      workspaceId: 'workspace-one',
    })).rejects.toThrow('simulated default assignment failure')
    expect((await workspaces.list('organization-one')).filter(({ isDefault }) => isDefault)).toEqual([
      expect.objectContaining({ id: 'workspace-two' }),
    ])
    expect(repository.transactionCount).toBe(4)
    expect(repository.lockCount).toBe(4)
    expect(repository.transactionScopes).toEqual(Array(4).fill('organization-one'))

    process.stdout.write(
      '[FUMA-015 demo] default-switch=workspace-one->workspace-two rollback-preserved=workspace-two\n',
    )
  })

  it('renames with normalization, rejects organization-local slug collisions, and permits that slug elsewhere', async () => {
    const { workspaces } = harness()
    await workspaces.create(createInput('workspace-a', 'organization-a', 'first'))
    await workspaces.create(createInput('workspace-b', 'organization-a', 'reserved-slug'))
    await workspaces.create(createInput('workspace-c', 'organization-b', 'third'))

    const renamed = await workspaces.update({
      organizationId: 'organization-a',
      workspaceId: 'workspace-a',
      slug: '  Product & Design  ',
      name: ' Product and Design ',
    })
    expect(renamed).toMatchObject({ slug: 'product-design', name: 'Product and Design' })

    await expect(workspaces.update({
      organizationId: 'organization-a',
      workspaceId: 'workspace-a',
      slug: 'RESERVED SLUG',
    })).rejects.toEqual(domainError('slug-conflict'))

    await expect(workspaces.update({
      organizationId: 'organization-b',
      workspaceId: 'workspace-c',
      slug: 'RESERVED SLUG',
    })).resolves.toMatchObject({ slug: 'reserved-slug' })
  })

  it('requires tenant context and treats cross-organization IDs as absent', async () => {
    const { workspaces } = harness()
    await workspaces.create(createInput('workspace-private', 'organization-owner', 'private'))

    await expect(workspaces.get('organization-other', 'workspace-private'))
      .rejects.toEqual(domainError('not-found'))
    await expect(workspaces.update({
      organizationId: 'organization-other',
      workspaceId: 'workspace-private',
      name: 'Cross-tenant rename',
    })).rejects.toEqual(domainError('not-found'))
    await expect(workspaces.archive({
      organizationId: 'organization-other',
      workspaceId: 'workspace-private',
    })).rejects.toEqual(domainError('not-found'))
    await expect(workspaces.get('organization-owner', 'missing'))
      .rejects.toEqual(domainError('not-found'))
    await expect(workspaces.list('')).rejects.toEqual(domainError('invalid-input'))
  })

  it('guards default, last-active, and active-site ownership before archive', async () => {
    const { repository, siteCountGuard, workspaces } = harness()
    await workspaces.create(createInput('workspace-default', 'organization-archive', 'default'))
    await workspaces.create(createInput('workspace-candidate', 'organization-archive', 'candidate'))

    await expect(workspaces.archive({
      organizationId: 'organization-archive',
      workspaceId: 'workspace-default',
    })).rejects.toEqual(domainError('default-archive'))

    siteCountGuard.counts.set('organization-archive:workspace-candidate', 2)
    await expect(workspaces.archive({
      organizationId: 'organization-archive',
      workspaceId: 'workspace-candidate',
    })).rejects.toEqual(domainError('active-sites'))
    expect(repository.rows.get('workspace-candidate')?.status).toBe('active')

    repository.rows.set('workspace-only', {
      id: 'workspace-only',
      organizationId: 'organization-only',
      slug: 'only',
      name: 'Only',
      status: 'active',
      isDefault: false,
      createdAt: NOW,
      updatedAt: NOW,
    })
    await expect(workspaces.archive({
      organizationId: 'organization-only',
      workspaceId: 'workspace-only',
    })).rejects.toEqual(domainError('last-active'))
    expect(siteCountGuard.calls).toEqual(['organization-archive:workspace-candidate'])
  })

  it('archives and restores without stealing a default, but makes a restored workspace default when none exists', async () => {
    const { repository, workspaces } = harness()
    await workspaces.create(createInput('workspace-primary', 'organization-life', 'primary'))
    await workspaces.create(createInput('workspace-secondary', 'organization-life', 'secondary'))

    const archived = await workspaces.archive({
      organizationId: 'organization-life',
      workspaceId: 'workspace-secondary',

    })
    expect(archived).toMatchObject({ status: 'archived', isDefault: false })
    const restored = await workspaces.restore({
      organizationId: 'organization-life',
      workspaceId: 'workspace-secondary',
    })
    expect(restored).toMatchObject({ status: 'active', isDefault: false })
    expect((await workspaces.get('organization-life', 'workspace-primary')).isDefault).toBe(true)

    repository.rows.set(
      'workspace-orphaned',
      archivedRecord('workspace-orphaned', 'organization-without-default'),
    )
    const restoredDefault = await workspaces.restore({
      organizationId: 'organization-without-default',
      workspaceId: 'workspace-orphaned',
    })
    expect(restoredDefault).toMatchObject({ status: 'active', isDefault: true })
  })

  it('rejects clearing the default, assigning an archived default, invalid site counts, and invalid normalized input', async () => {
    const { repository, siteCountGuard, workspaces } = harness()
    await workspaces.create(createInput('workspace-default', 'organization-edge', 'default'))
    await workspaces.create(createInput('workspace-other', 'organization-edge', 'other'))

    await expect(workspaces.update({
      organizationId: 'organization-edge',
      workspaceId: 'workspace-default',
      isDefault: false,
    })).rejects.toEqual(domainError('default-required'))

    repository.rows.set(
      'workspace-archived',
      archivedRecord('workspace-archived', 'organization-edge'),
    )
    await expect(workspaces.setDefault({
      organizationId: 'organization-edge',
      workspaceId: 'workspace-archived',
    })).rejects.toEqual(domainError('archived-workspace'))

    siteCountGuard.counts.set('organization-edge:workspace-other', -1)
    await expect(workspaces.archive({
      organizationId: 'organization-edge',
      workspaceId: 'workspace-other',
    })).rejects.toEqual(domainError('invalid-site-count'))
    expect(repository.rows.get('workspace-other')?.status).toBe('active')

    await expect(workspaces.create(createInput(
      'workspace-invalid',
      'organization-edge',
      ' --- ',
    ))).rejects.toEqual(domainError('invalid-input'))
  })

  it('binds transaction scope and rejects hostile organization substitution in records', async () => {
    const repository = new InMemoryWorkspaceRepository()
    const boundRecord = archivedRecord('workspace-bound', 'organization-bound')
    repository.rows.set(boundRecord.id, boundRecord)

    await expect(repository.transaction('organization-bound', async (transaction) => (
      await transaction.insert(archivedRecord('workspace-hostile', 'organization-hostile'))
    ))).rejects.toThrow('cross-organization insert')

    await expect(repository.transaction('organization-bound', async (transaction) => (
      await transaction.update({ ...boundRecord, organizationId: 'organization-hostile' })
    ))).rejects.toThrow('missing workspace workspace-bound')

    expect(repository.rows.has('workspace-hostile')).toBe(false)
    expect(repository.rows.get(boundRecord.id)).toEqual(boundRecord)
  })

  it('keeps the owned lane free of singleton resources and alternate validation stacks', async () => {
    const source = (await Promise.all([
      '../../../server/fuma/workspaces/repository.ts',
      '../../../server/fuma/workspaces/service.ts',
    ].map(async (path) => await Bun.file(new URL(path, import.meta.url)).text()))).join('\n')

    expect(source).not.toMatch(/\bzod\b|new\s+(?:Redis|S3|Minio|Database)|(?:allocate|provision)\w*(?:Database|Redis|Worker)/i)
    expect(source).not.toMatch(/(?:globalThis|singleton)/)
    expect(source).toContain('readonly #organizationId: WorkspaceOrganizationId')
    expect(source).toContain('getById(workspaceId: WorkspaceId): Promise<WorkspaceRecord | null>')
    expect(source).toContain('list(): Promise<WorkspaceRecord[]>')
    expect(source).toContain('where organization_id = ${this.#organizationId} and id = ${workspaceId}')
    expect(source).toContain('where organization_id = ${this.#organizationId} and id = ${record.id}')
    expect(source).not.toContain('where id = ${workspaceId}')
  })
})

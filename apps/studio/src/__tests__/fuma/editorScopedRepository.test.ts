import { describe, expect, it } from 'bun:test'
import {
  EditorScopedRepository,
  EditorScopedRepositoryError,
  type EditorIncrementalSave,
  type EditorScopedStorage,
  type EditorScopedStorageEntry,
  type EditorScopedStorageKey,
  type EditorScopedStoragePrefix,
  type EditorScopedStorageTransaction,
  type EditorSiteDocument,
  type EditorSiteSessionIdentity,
} from '../../../server/fuma/editor'
import type {
  FumaRepositoryScope,
  FumaRepositoryScopeCoordinate,
} from '../../../server/fuma/tenancy'

const SHARED_SITE_ID = 'site-collision'
const SHARED_LOGICAL_ID = 'resource-collision'

function session(
  organizationId: string,
  workspaceId: string,
  ownerKey: string,
  profileId: string,
): EditorSiteSessionIdentity {
  return Object.freeze({
    platformId: 'platform-fuma',
    organizationId,
    workspaceId,
    siteId: SHARED_SITE_ID,
    ownerKey,
    generation: 7,
    state: 'active' as const,
    transferFence: null,
    profileId,
    editorSessionId: `editor-${organizationId}`,
  })
}

function authority(identity: EditorSiteSessionIdentity): FumaRepositoryScope {
  return Object.freeze({
    platformId: identity.platformId,
    organizationId: identity.organizationId,
    workspaceId: identity.workspaceId,
    siteId: identity.siteId,
    ownerKey: identity.ownerKey,
    generation: identity.generation,
    state: 'active' as const,
    transferFence: null,
  })
}

function node(id: string, moduleId: string) {
  return {
    id,
    moduleId,
    props: {},
    breakpointOverrides: {},
    children: [],
    parentId: null,
    classIds: [],
  }
}

function shell(name: string) {
  const structuralSection = { expandedFolders: [], emptyFolders: [], rowOrder: [] }
  const decorativeSection = { folders: [], items: [] }
  return {
    id: SHARED_SITE_ID,
    name,
    breakpoints: [{ id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor' }],
    settings: { shortcuts: {} },
    styleRules: {},
    files: [],
    explorer: {
      pages: structuredClone(structuralSection),
      styles: structuredClone(structuralSection),
      scripts: structuredClone(structuralSection),
      templates: structuredClone(decorativeSection),
      components: structuredClone(decorativeSection),
    },
    packageJson: { dependencies: {}, devDependencies: {} },
    runtime: {
      dependencyLock: { version: 1 as const, packages: {}, updatedAt: 1 },
      scripts: {},
      styles: {},
    },
    createdAt: 1,
    updatedAt: 2,
  }
}

function document(name: string): EditorSiteDocument {
  const root = node('root', 'base.body')
  const componentRoot = node('component-root', 'base.container')
  const layoutRoot = node('layout-root', 'base.container')
  return {
    site: shell(name),
    pages: [{
      id: SHARED_LOGICAL_ID,
      slug: 'index',
      title: `${name} page`,
      rootNodeId: root.id,
      nodes: { [root.id]: root },
    }],
    visualComponents: [{
      id: SHARED_LOGICAL_ID,
      name: `${name} component`,
      tree: {
        rootNodeId: componentRoot.id,
        nodes: { [componentRoot.id]: componentRoot },
      },
      params: [],
      classIds: [],
      createdAt: 1,
    }],
    layouts: [{
      id: SHARED_LOGICAL_ID,
      name: `${name} layout`,
      rootNodeId: layoutRoot.id,
      nodes: { [layoutRoot.id]: layoutRoot },
      classes: {},
      createdAt: 1,
    }],
  }
}

function coordinateKey(value: FumaRepositoryScopeCoordinate): string {
  return JSON.stringify([
    value.platformId,
    value.organizationId,
    value.workspaceId,
    value.siteId,
  ])
}

function storageKey(value: EditorScopedStorageKey): string {
  return JSON.stringify([
    value.platformId,
    value.ownerKey,
    value.generation,
    value.resourceKind,
    value.logicalId,
  ])
}

function matchesPrefix(
  key: EditorScopedStorageKey,
  prefix: EditorScopedStoragePrefix,
): boolean {
  return key.platformId === prefix.platformId
    && key.ownerKey === prefix.ownerKey
    && key.generation === prefix.generation
    && key.resourceKind === prefix.resourceKind
}

type StoredValue = Readonly<{
  key: EditorScopedStorageKey
  value: unknown
}>

class InMemoryEditorStorage implements EditorScopedStorage {
  rows = new Map<string, StoredValue>()
  authorities = new Map<string, FumaRepositoryScope>()
  authorityChecks = 0
  dataCalls = 0
  transactions = 0
  failOnPut: number | null = null

  setAuthority(value: FumaRepositoryScope): void {
    this.authorities.set(coordinateKey(value), structuredClone(value))
  }

  values(): StoredValue[] {
    return structuredClone([...this.rows.values()])
  }

  async transaction<T>(
    work: (transaction: EditorScopedStorageTransaction) => Promise<T>,
  ): Promise<T> {
    this.transactions += 1
    const workingRows = structuredClone(this.rows)
    const transaction = new InMemoryEditorTransaction(this, workingRows)
    const result = await work(transaction)
    this.rows = workingRows
    return result
  }
}

class InMemoryEditorTransaction implements EditorScopedStorageTransaction {
  readonly #storage: InMemoryEditorStorage
  readonly #rows: Map<string, StoredValue>
  #putCount = 0

  constructor(storage: InMemoryEditorStorage, rows: Map<string, StoredValue>) {
    this.#storage = storage
    this.#rows = rows
  }

  loadScopeAuthorityForUpdate(
    coordinate: FumaRepositoryScopeCoordinate,
  ): Promise<unknown | null> {
    this.#storage.authorityChecks += 1
    return Promise.resolve(structuredClone(
      this.#storage.authorities.get(coordinateKey(coordinate)) ?? null,
    ))
  }

  get(key: EditorScopedStorageKey): Promise<unknown | null> {
    this.#storage.dataCalls += 1
    return Promise.resolve(structuredClone(this.#rows.get(storageKey(key))?.value ?? null))
  }

  list(prefix: EditorScopedStoragePrefix): Promise<readonly EditorScopedStorageEntry[]> {
    this.#storage.dataCalls += 1
    return Promise.resolve(structuredClone([...this.#rows.values()]
      .filter((entry) => matchesPrefix(entry.key, prefix))))
  }

  put(key: EditorScopedStorageKey, value: unknown): Promise<void> {
    this.#storage.dataCalls += 1
    this.#putCount += 1
    if (this.#storage.failOnPut === this.#putCount) {
      this.#storage.failOnPut = null
      throw new Error('injected atomic write failure')
    }
    this.#rows.set(storageKey(key), structuredClone({ key, value }))
    return Promise.resolve()
  }

  delete(key: EditorScopedStorageKey): Promise<void> {
    this.#storage.dataCalls += 1
    this.#rows.delete(storageKey(key))
    return Promise.resolve()
  }

  deletePrefix(prefix: EditorScopedStoragePrefix): Promise<void> {
    this.#storage.dataCalls += 1
    for (const [serialized, entry] of this.#rows) {
      if (matchesPrefix(entry.key, prefix)) this.#rows.delete(serialized)
    }
    return Promise.resolve()
  }
}

function harness() {
  const tenantAIdentity = session('organization-a', 'workspace-a', 'owner-a', 'website')
  const tenantBIdentity = session('organization-b', 'workspace-b', 'owner-b', 'publication')
  const storage = new InMemoryEditorStorage()
  storage.setAuthority(authority(tenantAIdentity))
  storage.setAuthority(authority(tenantBIdentity))
  const repository = new EditorScopedRepository(storage)
  return {
    storage,
    tenantA: repository.forScope(tenantAIdentity),
    tenantB: repository.forScope(tenantBIdentity),
  }
}

function incremental(name: string): EditorIncrementalSave {
  return {
    site: shell(name),
    changedPages: document(name).pages,
    deletedPageIds: [],
    changedComponents: document(name).visualComponents,
    deletedComponentIds: [],
    changedLayouts: document(name).layouts,
    deletedLayoutIds: [],
  }
}

async function capturedFailure(work: Promise<unknown>): Promise<unknown> {
  try {
    await work
    return null
  } catch (error) {
    return error
  }
}

describe('FUMA-027 server scoped editor persistence foundation', () => {
  it('detaches and freezes the complete active site session identity', () => {
    const original = session('organization-a', 'workspace-a', 'owner-a', 'website')
    const storage = new InMemoryEditorStorage()
    storage.setAuthority(authority(original))
    const bound = new EditorScopedRepository(storage).forScope(original)

    expect(bound.identity).toEqual(original)
    expect(bound.identity).not.toBe(original)
    expect(Object.isFrozen(bound.identity)).toBe(true)
    expect(Object.isFrozen(bound)).toBe(true)
    expect('forScope' in bound).toBe(false)
    expect(Object.keys(bound).sort()).toEqual(['identity'])

    const invalid = { ...original, state: 'transferring' as const, transferFence: 4 }
    expect(() => new EditorScopedRepository(storage).forScope(
      invalid as unknown as EditorSiteSessionIdentity,
    )).toThrow(
      'A valid active editor site session identity is required.',
    )
    const additional = { ...original, organizationIdFromBody: 'organization-b' }
    expect(() => new EditorScopedRepository(storage).forScope(additional)).toThrow(
      'A valid active editor site session identity is required.',
    )
  })

  it('isolates colliding tenant and page/component/layout IDs with owner generation keys', async () => {
    const { storage, tenantA, tenantB } = harness()
    await tenantA.replaceFromImport(document('Tenant A'))
    await tenantB.replaceFromImport(document('Tenant B'))

    expect((await tenantA.load())?.site.name).toBe('Tenant A')
    expect((await tenantB.load())?.site.name).toBe('Tenant B')
    expect((await tenantA.load())?.pages[0]?.title).toBe('Tenant A page')
    expect((await tenantB.load())?.pages[0]?.title).toBe('Tenant B page')

    const collisionKeys = storage.values()
      .map(({ key }) => key)
      .filter(({ logicalId }) => logicalId === SHARED_LOGICAL_ID)
    expect(collisionKeys).toHaveLength(6)
    expect(new Set(collisionKeys.map(({ ownerKey }) => ownerKey))).toEqual(
      new Set(['owner-a', 'owner-b']),
    )
    expect(new Set(collisionKeys.map(({ generation }) => generation))).toEqual(new Set([7]))
    expect(new Set(collisionKeys.map(({ resourceKind }) => resourceKind))).toEqual(
      new Set(['page', 'component', 'layout']),
    )
  })

  it('revalidates exact active/null-transfer authority before every operation', async () => {
    const { storage, tenantA } = harness()
    await tenantA.replaceFromImport(document('Before transfer'))
    expect(storage.authorityChecks).toBe(1)

    storage.setAuthority(Object.freeze({
      ...authority(tenantA.identity),
      generation: tenantA.identity.generation + 1,
      state: 'transferring' as const,
      transferFence: 19,
    }))
    const dataCallsBefore = storage.dataCalls
    const failures = await Promise.all([
      capturedFailure(tenantA.load()),
      capturedFailure(tenantA.save(incremental('Stale save'))),
      capturedFailure(tenantA.replaceFromImport(document('Stale import'))),
    ])

    expect(storage.authorityChecks).toBe(4)
    expect(storage.dataCalls).toBe(dataCallsBefore)
    expect(failures.every((error) => (
      error instanceof EditorScopedRepositoryError
      && error.code === 'denied'
      && error.message === 'Editor repository scope authority denied.'
    ))).toBe(true)
  })

  it('commits incremental shell and collection changes atomically and rolls back failure', async () => {
    const { storage, tenantA } = harness()
    await tenantA.replaceFromImport(document('Original'))
    const replacement = document('Updated')
    storage.failOnPut = 2

    await expect(tenantA.save({
      site: replacement.site,
      changedPages: replacement.pages,
      deletedPageIds: [],
      changedComponents: replacement.visualComponents,
      deletedComponentIds: [],
      changedLayouts: replacement.layouts,
      deletedLayoutIds: [],
    })).rejects.toThrow('injected atomic write failure')

    const loaded = await tenantA.load()
    expect(loaded?.site.name).toBe('Original')
    expect(loaded?.pages[0]?.title).toBe('Original page')
    expect(loaded?.visualComponents[0]?.name).toBe('Original component')
    expect(loaded?.layouts[0]?.name).toBe('Original layout')
  })

  it('replaces import rosters atomically and keeps the previous document on failure', async () => {
    const { storage, tenantA, tenantB } = harness()
    await tenantA.replaceFromImport(document('Original A'))
    await tenantB.replaceFromImport(document('Tenant B'))

    const emptyImport: EditorSiteDocument = {
      site: shell('Imported A'),
      pages: [],
      visualComponents: [],
      layouts: [],
    }
    await tenantA.replaceFromImport(emptyImport)
    expect(await tenantA.load()).toEqual(emptyImport)
    expect((await tenantB.load())?.site.name).toBe('Tenant B')

    storage.failOnPut = 2
    await expect(tenantA.replaceFromImport(document('Broken import'))).rejects.toThrow(
      'injected atomic write failure',
    )
    expect(await tenantA.load()).toEqual(emptyImport)
  })

  it('rejects invalid contracts before a transaction and corrupt scoped storage inside it', async () => {
    const { storage, tenantA } = harness()
    const transactionsBefore = storage.transactions
    const duplicate = document('Duplicate')
    const invalid = {
      ...duplicate,
      pages: [duplicate.pages[0]!, duplicate.pages[0]!],
    }
    await expect(tenantA.replaceFromImport(invalid)).rejects.toMatchObject({
      code: 'invalid-input',
    })
    expect(storage.transactions).toBe(transactionsBefore)

    await tenantA.replaceFromImport(document('Valid'))
    const pageEntry = storage.values().find(({ key }) => key.resourceKind === 'page')
    if (!pageEntry) throw new Error('Expected a stored page fixture.')
    storage.rows.set(storageKey(pageEntry.key), {
      key: { ...pageEntry.key, logicalId: 'wrong-logical-id' },
      value: pageEntry.value,
    })
    await expect(tenantA.load()).rejects.toMatchObject({ code: 'invalid-storage' })
  })
})

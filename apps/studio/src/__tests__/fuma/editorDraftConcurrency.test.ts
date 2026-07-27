import { describe, expect, it } from 'bun:test'
import {
  EditorScopedRepository,
  EditorScopedRepositoryError,
  type EditorDraftMutationReceipt,
  type EditorDraftStreamKey,
  type EditorMutationId,
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

type Resource = Readonly<{ key: EditorScopedStorageKey; value: unknown }>
type State = {
  resources: Map<string, Resource>
  heads: Map<string, number>
  receipts: Map<string, EditorDraftMutationReceipt>
}

function session(profileId = 'website', generation = 3): EditorSiteSessionIdentity {
  return {
    platformId: 'platform-fuma',
    organizationId: 'organization-a',
    workspaceId: 'workspace-a',
    siteId: 'site-a',
    ownerKey: 'owner-a',
    generation,
    state: 'active',
    transferFence: null,
    profileId,
    editorSessionId: `session-${profileId}`,
  }
}

function authority(identity: EditorSiteSessionIdentity): FumaRepositoryScope {
  return {
    platformId: identity.platformId,
    organizationId: identity.organizationId,
    workspaceId: identity.workspaceId,
    siteId: identity.siteId,
    ownerKey: identity.ownerKey,
    generation: identity.generation,
    state: 'active',
    transferFence: null,
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

function resourceKey(value: EditorScopedStorageKey): string {
  return JSON.stringify([
    value.platformId,
    value.ownerKey,
    value.generation,
    value.resourceKind,
    value.logicalId,
  ])
}

function streamKey(value: EditorDraftStreamKey): string {
  return JSON.stringify([
    value.platformId,
    value.ownerKey,
    value.generation,
    value.profileId,
    value.resourceKind,
    value.logicalId,
  ])
}

function receiptKey(value: EditorDraftStreamKey, mutationId: string): string {
  return `${streamKey(value)}:${mutationId}`
}

function matches(key: EditorScopedStorageKey, prefix: EditorScopedStoragePrefix): boolean {
  return key.platformId === prefix.platformId
    && key.ownerKey === prefix.ownerKey
    && key.generation === prefix.generation
    && key.resourceKind === prefix.resourceKind
}

class SerializedMemoryStorage implements EditorScopedStorage {
  state: State = { resources: new Map(), heads: new Map(), receipts: new Map() }
  readonly authorities = new Map<string, FumaRepositoryScope>()
  authorityChecks = 0
  failPutAt: number | null = null
  #tail: Promise<void> = Promise.resolve()

  setAuthority(value: FumaRepositoryScope): void {
    this.authorities.set(coordinateKey(value), structuredClone(value))
  }

  async transaction<T>(work: (transaction: EditorScopedStorageTransaction) => Promise<T>): Promise<T> {
    const previous = this.#tail
    let release: (() => void) | undefined
    this.#tail = new Promise<void>((resolve) => { release = resolve })
    await previous
    const working = structuredClone(this.state)
    try {
      const result = await work(new MemoryTransaction(this, working))
      this.state = working
      return result
    } finally {
      release?.()
    }
  }
}

class MemoryTransaction implements EditorScopedStorageTransaction {
  #puts = 0

  constructor(
    private readonly storage: SerializedMemoryStorage,
    private readonly state: State,
  ) {}

  loadScopeAuthorityForUpdate(value: FumaRepositoryScopeCoordinate): Promise<unknown | null> {
    this.storage.authorityChecks += 1
    return Promise.resolve(structuredClone(
      this.storage.authorities.get(coordinateKey(value)) ?? null,
    ))
  }

  get(key: EditorScopedStorageKey): Promise<unknown | null> {
    return Promise.resolve(structuredClone(this.state.resources.get(resourceKey(key))?.value ?? null))
  }

  list(prefix: EditorScopedStoragePrefix): Promise<readonly EditorScopedStorageEntry[]> {
    return Promise.resolve([...this.state.resources.values()]
      .filter((entry) => matches(entry.key, prefix))
      .map((entry) => structuredClone(entry)))
  }

  put(key: EditorScopedStorageKey, value: unknown): Promise<void> {
    this.#puts += 1
    if (this.storage.failPutAt === this.#puts) throw new Error('injected batch failure')
    this.state.resources.set(resourceKey(key), structuredClone({ key, value }))
    return Promise.resolve()
  }

  delete(key: EditorScopedStorageKey): Promise<void> {
    this.state.resources.delete(resourceKey(key))
    return Promise.resolve()
  }

  deletePrefix(prefix: EditorScopedStoragePrefix): Promise<void> {
    for (const [key, entry] of this.state.resources) {
      if (matches(entry.key, prefix)) this.state.resources.delete(key)
    }
    return Promise.resolve()
  }

  lockDraftSequence(key: EditorDraftStreamKey): Promise<number> {
    const serialized = streamKey(key)
    if (!this.state.heads.has(serialized)) this.state.heads.set(serialized, 0)
    return Promise.resolve(this.state.heads.get(serialized)!)
  }

  setDraftSequence(key: EditorDraftStreamKey, expected: number, sequence: number): Promise<void> {
    const serialized = streamKey(key)
    if (this.state.heads.get(serialized) !== expected || sequence !== expected + 1) {
      throw new Error('sequence compare-and-swap failed')
    }
    this.state.heads.set(serialized, sequence)
    return Promise.resolve()
  }

  getDraftMutationReceipt(
    key: EditorDraftStreamKey,
    mutationId: EditorMutationId,
  ): Promise<EditorDraftMutationReceipt | null> {
    return Promise.resolve(structuredClone(
      this.state.receipts.get(receiptKey(key, mutationId)) ?? null,
    ))
  }

  putDraftMutationReceipt(
    key: EditorDraftStreamKey,
    mutationId: EditorMutationId,
    receipt: EditorDraftMutationReceipt,
  ): Promise<void> {
    const serialized = receiptKey(key, mutationId)
    if (this.state.receipts.has(serialized)) throw new Error('duplicate receipt')
    this.state.receipts.set(serialized, structuredClone(receipt))
    return Promise.resolve()
  }
}

function node(id: string) {
  return {
    id,
    moduleId: 'base.body',
    props: {},
    breakpointOverrides: {},
    children: [],
    parentId: null,
    classIds: [],
  }
}

function document(name: string): EditorSiteDocument {
  const root = node('root')
  const structural = { expandedFolders: [], emptyFolders: [], rowOrder: [] }
  const decorative = { folders: [], items: [] }
  return {
    site: {
      id: 'site-a',
      name,
      breakpoints: [{ id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor' }],
      settings: { shortcuts: {} },
      styleRules: {},
      files: [],
      explorer: {
        pages: structuredClone(structural),
        styles: structuredClone(structural),
        scripts: structuredClone(structural),
        templates: structuredClone(decorative),
        components: structuredClone(decorative),
      },
      packageJson: { dependencies: {}, devDependencies: {} },
      runtime: {
        dependencyLock: { version: 1, packages: {}, updatedAt: 1 },
        scripts: {},
        styles: {},
      },
      createdAt: 1,
      updatedAt: 2,
    },
    pages: [{
      id: 'page-a',
      slug: 'index',
      title: name,
      rootNodeId: root.id,
      nodes: { [root.id]: root },
    }],
    visualComponents: [],
    layouts: [],
  }
}

function replace(mutationId: string, expectedSequence: number, name: string) {
  return {
    mutationId,
    expectedSequence,
    operations: [{ kind: 'replace-document' as const, document: document(name) }],
  }
}

function harness(profileId = 'website') {
  const identity = session(profileId)
  const storage = new SerializedMemoryStorage()
  storage.setAuthority(authority(identity))
  const repository = new EditorScopedRepository(storage).forScope(identity)
  return { identity, storage, repository }
}

describe('FUMA-028 authoritative sequenced draft repository', () => {
  it('serializes two edits at one sequence and returns one deterministic visible conflict', async () => {
    const { repository } = harness()
    const [first, second] = await Promise.all([
      repository.mutateDraft(replace('tab-a.1', 0, 'First')),
      repository.mutateDraft(replace('tab-b.1', 0, 'Second')),
    ])

    expect(first).toMatchObject({
      outcome: 'accepted', mutationId: 'tab-a.1', expectedSequence: 0, sequence: 1,
    })
    expect(second).toEqual({
      outcome: 'conflict',
      code: 'draft-sequence-conflict',
      mutationId: 'tab-b.1',
      expectedSequence: 0,
      authoritativeSequence: 1,
      document: document('First'),
    })
    expect(await repository.loadDraft()).toEqual({ document: document('First'), sequence: 1 })
  })

  it('suppresses exact replay and rejects mutation-ID reuse without advancing the head', async () => {
    const { repository } = harness()
    const mutation = replace('tab-a.replay', 0, 'Accepted once')
    const accepted = await repository.mutateDraft(mutation)
    const replay = await repository.mutateDraft(structuredClone(mutation))
    const reused = await repository.mutateDraft(replace('tab-a.replay', 1, 'Different'))

    expect(accepted).toMatchObject({ outcome: 'accepted', sequence: 1, replayed: false })
    expect(replay).toEqual({ ...accepted, replayed: true })
    expect(reused).toMatchObject({
      outcome: 'conflict',
      code: 'mutation-id-reused',
      authoritativeSequence: 1,
      document: document('Accepted once'),
    })
    expect((await repository.loadDraft()).sequence).toBe(1)
  })

  it('rolls back every operation, receipt, and sequence when an atomic batch fails', async () => {
    const { storage, repository } = harness()
    storage.failPutAt = 3
    await expect(repository.mutateDraft({
      mutationId: 'tab-a.batch',
      expectedSequence: 0,
      operations: [
        { kind: 'replace-document', document: document('First operation') },
        { kind: 'replace-document', document: document('Second operation') },
      ],
    })).rejects.toThrow('injected batch failure')

    storage.failPutAt = null
    expect(await repository.loadDraft()).toEqual({ document: null, sequence: 0 })
    expect(storage.state.receipts.size).toBe(0)
  })

  it('isolates profile-qualified streams and denies stale owner generation before head access', async () => {
    const identity = session('website')
    const storage = new SerializedMemoryStorage()
    storage.setAuthority(authority(identity))
    const root = new EditorScopedRepository(storage)
    const website = root.forScope(identity)
    const publication = root.forScope({ ...identity, profileId: 'publication' })

    await website.mutateDraft(replace('website.1', 0, 'Website'))
    expect((await publication.loadDraft()).sequence).toBe(0)

    storage.setAuthority(authority(session('website', identity.generation + 1)))
    const headsBefore = storage.state.heads.size
    await expect(website.loadDraft()).rejects.toEqual(
      new EditorScopedRepositoryError('denied', 'Editor repository scope authority denied.'),
    )
    expect(storage.state.heads.size).toBe(headsBefore)
    expect(storage.authorityChecks).toBe(3)
  })
})

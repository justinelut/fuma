import {
  EditorScopedRepository,
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
import {
  createEditorSessionCoordinator,
  createEditorSessionTarget,
  type BoundEditorSessionAdapter,
  type EditorSessionTarget,
} from '../../../src/admin/fuma/editorSession'
import {
  CORE_EDITOR_SURFACE_CONTRIBUTIONS,
  resolveProfileEditorSurfaces,
} from '../../../src/admin/fuma/profileEditor'
import {
  fumaLaunchRegistry,
  type PermissionDecision,
} from '../../../src/core/fuma'

const SHARED_SITE_ID = 'site-collision'
const SHARED_LOGICAL_ID = 'resource-collision'

type StoredValue = Readonly<{
  key: EditorScopedStorageKey
  value: unknown
}>

type Deferred<T> = Readonly<{
  promise: Promise<T>
  resolve(value: T): void
}>

export type FumaEditorAcceptanceEvidence = Readonly<{
  persistedSiteNames: Readonly<{
    website: string
    publication: string
  }>
  collidingLogicalIdsHaveDistinctKeys: boolean
  websiteSurfaceIds: readonly string[]
  publicationSurfaceIds: readonly string[]
  independentTabHistory: boolean
  independentTabImportState: boolean
  staleLoadStayedOnPublication: boolean
}>

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  if (!resolvePromise) throw new Error('Deferred editor operation was not initialized')
  return Object.freeze({ promise, resolve: resolvePromise })
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

class AcceptanceStorage implements EditorScopedStorage {
  rows = new Map<string, StoredValue>()
  authorities = new Map<string, FumaRepositoryScope>()

  setAuthority(value: FumaRepositoryScope): void {
    this.authorities.set(coordinateKey(value), structuredClone(value))
  }

  keys(): EditorScopedStorageKey[] {
    return [...this.rows.values()].map(({ key }) => structuredClone(key))
  }

  async transaction<T>(
    work: (transaction: EditorScopedStorageTransaction) => Promise<T>,
  ): Promise<T> {
    const workingRows = structuredClone(this.rows)
    const result = await work(new AcceptanceTransaction(this, workingRows))
    this.rows = workingRows
    return result
  }
}

class AcceptanceTransaction implements EditorScopedStorageTransaction {
  readonly #storage: AcceptanceStorage
  readonly #rows: Map<string, StoredValue>

  constructor(storage: AcceptanceStorage, rows: Map<string, StoredValue>) {
    this.#storage = storage
    this.#rows = rows
  }

  loadScopeAuthorityForUpdate(
    coordinate: FumaRepositoryScopeCoordinate,
  ): Promise<unknown | null> {
    return Promise.resolve(structuredClone(
      this.#storage.authorities.get(coordinateKey(coordinate)) ?? null,
    ))
  }

  get(key: EditorScopedStorageKey): Promise<unknown | null> {
    return Promise.resolve(structuredClone(this.#rows.get(storageKey(key))?.value ?? null))
  }

  list(prefix: EditorScopedStoragePrefix): Promise<readonly EditorScopedStorageEntry[]> {
    return Promise.resolve(structuredClone(
      [...this.#rows.values()].filter((entry) => matchesPrefix(entry.key, prefix)),
    ))
  }

  put(key: EditorScopedStorageKey, value: unknown): Promise<void> {
    this.#rows.set(storageKey(key), structuredClone({ key, value }))
    return Promise.resolve()
  }

  delete(key: EditorScopedStorageKey): Promise<void> {
    this.#rows.delete(storageKey(key))
    return Promise.resolve()
  }

  deletePrefix(prefix: EditorScopedStoragePrefix): Promise<void> {
    for (const [serialized, entry] of this.#rows) {
      if (matchesPrefix(entry.key, prefix)) this.#rows.delete(serialized)
    }
    return Promise.resolve()
  }

  lockDraftSequence(_key: EditorDraftStreamKey): Promise<number> {
    return Promise.resolve(0)
  }

  setDraftSequence(
    _key: EditorDraftStreamKey,
    _expectedSequence: number,
    _sequence: number,
  ): Promise<void> {
    return Promise.resolve()
  }

  getDraftMutationReceipt(
    _key: EditorDraftStreamKey,
    _mutationId: EditorMutationId,
  ): Promise<EditorDraftMutationReceipt | null> {
    return Promise.resolve(null)
  }

  putDraftMutationReceipt(
    _key: EditorDraftStreamKey,
    _mutationId: EditorMutationId,
    _receipt: EditorDraftMutationReceipt,
  ): Promise<void> {
    return Promise.resolve()
  }
}

function identity(
  organizationId: string,
  ownerKey: string,
  profileId: string,
): EditorSiteSessionIdentity {
  return Object.freeze({
    platformId: 'platform-fuma',
    organizationId,
    workspaceId: 'workspace-collision',
    siteId: SHARED_SITE_ID,
    ownerKey,
    generation: 7,
    state: 'active' as const,
    transferFence: null,
    profileId,
    editorSessionId: `editor-${organizationId}`,
  })
}

function authority(value: EditorSiteSessionIdentity): FumaRepositoryScope {
  return Object.freeze({
    platformId: value.platformId,
    organizationId: value.organizationId,
    workspaceId: value.workspaceId,
    siteId: value.siteId,
    ownerKey: value.ownerKey,
    generation: value.generation,
    state: 'active' as const,
    transferFence: null,
  })
}

function target(value: EditorSiteSessionIdentity): EditorSessionTarget {
  return createEditorSessionTarget({
    organizationId: value.organizationId,
    workspaceId: value.workspaceId,
    siteId: value.siteId,
    profileId: value.profileId,
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

function siteShell(name: string) {
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

function editorDocument(name: string): EditorSiteDocument {
  const pageRoot = node('page-root', 'base.body')
  const componentRoot = node('component-root', 'base.container')
  const layoutRoot = node('layout-root', 'base.container')
  return {
    site: siteShell(name),
    pages: [{
      id: SHARED_LOGICAL_ID,
      slug: 'index',
      title: `${name} page`,
      rootNodeId: pageRoot.id,
      nodes: { [pageRoot.id]: pageRoot },
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

function decision(
  identity: EditorSiteSessionIdentity,
  permissionId: string,
): PermissionDecision {
  return {
    permissionId,
    scope: {
      kind: 'site',
      platformId: identity.platformId,
      organizationId: identity.organizationId,
      workspaceId: identity.workspaceId,
      siteId: identity.siteId,
    },
    decision: 'allow',
    precedence: 'launch-persona',
    source: {
      kind: 'launch-persona-assignment',
      assignmentId: `assignment-${identity.organizationId}`,
      persona: 'owner',
    },
  }
}

function profileSurfaceIds(value: EditorSiteSessionIdentity): string[] {
  const composed = fumaLaunchRegistry.compose(value.profileId)
  const resolution = resolveProfileEditorSurfaces({
    profileId: value.profileId,
    capabilityOverrides: { grant: [], revoke: [] },
    permissionDecisions: composed.permissions.map(({ id }) => decision(value, id)),
    contributions: CORE_EDITOR_SURFACE_CONTRIBUTIONS,
  }, fumaLaunchRegistry)
  return resolution.visible.map(({ id }) => id)
}

function adapterFor(
  repository: ReturnType<EditorScopedRepository['forScope']>,
): BoundEditorSessionAdapter<EditorSiteDocument> {
  let sequence = 0
  return {
    async load() {
      return { document: await repository.load(), sequence }
    },
    async save(command) {
      await repository.replaceFromImport(command.document)
      sequence = command.expectedSequence + 1
      return {
        outcome: 'accepted' as const,
        mutationId: command.mutationId,
        expectedSequence: command.expectedSequence,
        sequence,
        replayed: false,
        document: command.document,
      }
    },
  }
}

function activeSnapshot(
  coordinator: ReturnType<typeof createEditorSessionCoordinator<EditorSiteDocument>>,
) {
  const snapshot = coordinator.getSnapshot()
  if (snapshot.kind !== 'active') throw new Error('Expected an active editor session')
  return snapshot
}

/** Runs one black-box matrix over the exported server, session, and profile APIs. */
export async function runFumaEditorMultisiteAcceptance(): Promise<FumaEditorAcceptanceEvidence> {
  const websiteIdentity = identity('organization-acacia', 'owner-acacia', 'website')
  const publicationIdentity = identity('organization-baobab', 'owner-baobab', 'publication')
  const storage = new AcceptanceStorage()
  storage.setAuthority(authority(websiteIdentity))
  storage.setAuthority(authority(publicationIdentity))
  const repositories = new EditorScopedRepository(storage)
  const websiteRepository = repositories.forScope(websiteIdentity)
  const publicationRepository = repositories.forScope(publicationIdentity)

  await websiteRepository.replaceFromImport(editorDocument('Website'))
  await publicationRepository.replaceFromImport(editorDocument('Publication'))

  const pageKeys = storage.keys().filter((key) => (
    key.resourceKind === 'page' && key.logicalId === SHARED_LOGICAL_ID
  ))
  const collidingLogicalIdsHaveDistinctKeys = pageKeys.length === 2
    && new Set(pageKeys.map(storageKey)).size === 2

  const adapters = new Map([
    [coordinateKey(websiteIdentity), adapterFor(websiteRepository)],
    [coordinateKey(publicationIdentity), adapterFor(publicationRepository)],
  ])
  const bindAdapter = (boundTarget: EditorSessionTarget) => {
    const adapter = adapters.get(coordinateKey({
      platformId: 'platform-fuma',
      ...boundTarget,
    }))
    if (!adapter) throw new Error('No acceptance adapter exists for the target')
    return adapter
  }

  const websiteTab = createEditorSessionCoordinator<EditorSiteDocument>({ bindAdapter })
  const publicationTab = createEditorSessionCoordinator<EditorSiteDocument>({ bindAdapter })
  await Promise.all([
    websiteTab.switchTarget(target(websiteIdentity)),
    publicationTab.switchTarget(target(publicationIdentity)),
  ])
  websiteTab.replaceDocument(editorDocument('Website edited'))
  publicationTab.replaceDocument(editorDocument('Publication edited'))
  await websiteTab.save()
  await publicationTab.save()

  const firstTab = createEditorSessionCoordinator<EditorSiteDocument>({ bindAdapter })
  const secondTab = createEditorSessionCoordinator<EditorSiteDocument>({ bindAdapter })
  await Promise.all([
    firstTab.switchTarget(target(websiteIdentity)),
    secondTab.switchTarget(target(websiteIdentity)),
  ])
  firstTab.replaceDocument(editorDocument('First tab draft'))
  await firstTab.importDocument(async () => editorDocument('First tab import'))
  secondTab.replaceDocument(editorDocument('Second tab draft'))
  const firstSnapshot = activeSnapshot(firstTab)
  const secondSnapshot = activeSnapshot(secondTab)
  const independentTabHistory = firstSnapshot.undoDepth === 2
    && secondSnapshot.undoDepth === 1
    && firstSnapshot.document?.site.name !== secondSnapshot.document?.site.name
  const independentTabImportState = firstSnapshot.importState === 'succeeded'
    && secondSnapshot.importState === 'idle'

  const staleWebsiteLoad = deferred<EditorSiteDocument | null>()
  const staleCoordinator = createEditorSessionCoordinator<EditorSiteDocument>({
    bindAdapter(boundTarget) {
      if (boundTarget.organizationId === websiteIdentity.organizationId) {
        return {
          async load() {
            return { document: await staleWebsiteLoad.promise, sequence: 0 }
          },
          async save(command) {
            return {
              outcome: 'accepted' as const,
              mutationId: command.mutationId,
              expectedSequence: command.expectedSequence,
              sequence: command.expectedSequence + 1,
              replayed: false,
              document: command.document,
            }
          },
        }
      }
      return bindAdapter(boundTarget)
    },
  })
  const websiteLoad = staleCoordinator.switchTarget(target(websiteIdentity))
  const publicationLoad = staleCoordinator.switchTarget(target(publicationIdentity))
  await publicationLoad
  staleWebsiteLoad.resolve(editorDocument('Stale Website'))
  await websiteLoad
  const staleSnapshot = activeSnapshot(staleCoordinator)
  const staleLoadStayedOnPublication = staleSnapshot.target.organizationId
      === publicationIdentity.organizationId
    && staleSnapshot.document?.site.name === 'Publication edited'

  const website = await websiteRepository.load()
  const publication = await publicationRepository.load()
  if (!website || !publication) throw new Error('Acceptance documents disappeared')

  return Object.freeze({
    persistedSiteNames: Object.freeze({
      website: website.site.name,
      publication: publication.site.name,
    }),
    collidingLogicalIdsHaveDistinctKeys,
    websiteSurfaceIds: Object.freeze(profileSurfaceIds(websiteIdentity)),
    publicationSurfaceIds: Object.freeze(profileSurfaceIds(publicationIdentity)),
    independentTabHistory,
    independentTabImportState,
    staleLoadStayedOnPublication,
  })
}

import { describe, expect, it } from 'bun:test'
import {
  EditorScopedRepository,
  createEditorScopedRouteDeclarations,
  type BoundEditorScopedRepository,
  type EditorDraftMutationReceipt,
  type EditorDraftStreamKey,
  type EditorMutationId,
  type EditorScopedStorage,
  type EditorScopedStorageEntry,
  type EditorScopedStorageKey,
  type EditorScopedStoragePrefix,
  type EditorScopedStorageTransaction,
  type EditorSessionAuthorityPort,
  type EditorSiteSessionIdentity,
} from '../../../server/fuma/editor'
import {
  createFumaScopedRouteBoundary,
  type FumaRequestContext,
} from '../../../server/fuma/context'
import type {
  FumaRequestContextAuthorityPorts,
  FumaSiteAuthorizationInput,
} from '../../../server/fuma/context/requestContext'
import type {
  FumaRepositoryScope,
  FumaRepositoryScopeCoordinate,
} from '../../../server/fuma/tenancy'

const ORIGIN = 'https://hosted.fuma.test'
const PLATFORM_ID = 'platform-fuma'
const SHARED_SITE_ID = 'site-collision'
const SHARED_PAGE_ID = 'page-collision'
const USER_ID = 'user-editor'

type Tenant = Readonly<{
  organizationId: string
  workspaceId: string
  ownerKey: string
  profileId: 'website' | 'publication'
  name: string
}>

const TENANT_A: Tenant = Object.freeze({
  organizationId: 'organization-a',
  workspaceId: 'workspace-a',
  ownerKey: 'owner-a',
  profileId: 'website',
  name: 'Tenant A',
})
const TENANT_B: Tenant = Object.freeze({
  organizationId: 'organization-b',
  workspaceId: 'workspace-b',
  ownerKey: 'owner-b',
  profileId: 'publication',
  name: 'Tenant B',
})

function path(tenant: Tenant): string {
  return `/api/fuma/organizations/${tenant.organizationId}/workspaces/${tenant.workspaceId}/sites/${SHARED_SITE_ID}/editor/document`
}

function authorization(tenant: Tenant): FumaSiteAuthorizationInput {
  const binding = {
    platformId: PLATFORM_ID,
    organizationId: tenant.organizationId,
    workspaceId: tenant.workspaceId,
    siteId: SHARED_SITE_ID,
  }
  return {
    platformOrganizationId: 'organization-platform',
    platform: { id: PLATFORM_ID, status: 'active' },
    organization: {
      id: tenant.organizationId,
      platformId: PLATFORM_ID,
      kind: 'customer',
      status: 'active',
    },
    workspace: {
      id: tenant.workspaceId,
      platformId: PLATFORM_ID,
      organizationId: tenant.organizationId,
      status: 'active',
    },
    site: {
      id: SHARED_SITE_ID,
      platformId: PLATFORM_ID,
      organizationId: tenant.organizationId,
      workspaceId: tenant.workspaceId,
      profileId: tenant.profileId,
      status: 'active',
    },
    profile: { ...binding, id: tenant.profileId, status: 'active' },
    capabilities: {
      ...binding,
      profileId: tenant.profileId,
      overrides: { grant: [], revoke: [] },
    },
    permissions: {
      subjectId: USER_ID,
      scope: { kind: 'site', ...binding },
      protectedOwnerInvariant: null,
      roleAssignments: [{
        id: `assignment.${tenant.organizationId}`,
        subjectId: USER_ID,
        scope: {
          kind: 'organization',
          platformId: PLATFORM_ID,
          organizationId: tenant.organizationId,
        },
        role: { kind: 'launch-persona', persona: 'member' },
      }],
      permissionOverrides: [],
      customRoles: [],
    },
  }
}

function repositoryAuthority(tenant: Tenant, generation = 1): FumaRepositoryScope {
  return Object.freeze({
    platformId: PLATFORM_ID,
    organizationId: tenant.organizationId,
    workspaceId: tenant.workspaceId,
    siteId: SHARED_SITE_ID,
    ownerKey: tenant.ownerKey,
    generation,
    state: 'active' as const,
    transferFence: null,
  })
}

function ownerKeyRecord(tenant: Tenant) {
  return {
    ownerKey: tenant.ownerKey,
    coordinate: {
      platformId: PLATFORM_ID,
      organizationId: tenant.organizationId,
      workspaceId: tenant.workspaceId,
      siteId: SHARED_SITE_ID,
    },
    state: 'active' as const,
    generation: 1,
    transferId: null,
    transferLockId: null,
    transferFence: null,
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
  }
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
  const structural = { expandedFolders: [], emptyFolders: [], rowOrder: [] }
  const decorative = { folders: [], items: [] }
  return {
    id: SHARED_SITE_ID,
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
      dependencyLock: { version: 1 as const, packages: {}, updatedAt: 1 },
      scripts: {},
      styles: {},
    },
    createdAt: 1,
    updatedAt: 2,
  }
}

function saveBody(name: string, mutationId = `mutation.${name.replaceAll(' ', '-').toLowerCase()}`) {
  const root = node('root-collision', 'base.body')
  return {
    mutationId,
    expectedSequence: 0,
    operations: [{
      kind: 'incremental-save' as const,
      save: {
        site: shell(name),
        changedPages: [{
          id: SHARED_PAGE_ID,
          slug: 'index',
          title: `${name} page`,
          rootNodeId: root.id,
          nodes: { [root.id]: root },
        }],
        deletedPageIds: [],
        changedComponents: [],
        deletedComponentIds: [],
        changedLayouts: [],
        deletedLayoutIds: [],
      },
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

function rowKey(value: EditorScopedStorageKey): string {
  return JSON.stringify([
    value.platformId,
    value.ownerKey,
    value.generation,
    value.resourceKind,
    value.logicalId,
  ])
}

function draftKey(value: EditorDraftStreamKey): string {
  return JSON.stringify([
    value.platformId,
    value.ownerKey,
    value.generation,
    value.profileId,
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

class MemoryStorage implements EditorScopedStorage, EditorScopedStorageTransaction {
  readonly rows = new Map<string, StoredValue>()
  readonly authorities = new Map<string, FumaRepositoryScope>()
  readonly heads = new Map<string, number>()
  readonly receipts = new Map<string, EditorDraftMutationReceipt>()
  authorityChecks = 0
  dataCalls = 0

  setAuthority(authority: FumaRepositoryScope): void {
    this.authorities.set(coordinateKey(authority), structuredClone(authority))
  }

  transaction<T>(work: (transaction: EditorScopedStorageTransaction) => Promise<T>): Promise<T> {
    return work(this)
  }

  loadScopeAuthorityForUpdate(
    coordinate: FumaRepositoryScopeCoordinate,
  ): Promise<unknown | null> {
    this.authorityChecks += 1
    return Promise.resolve(structuredClone(
      this.authorities.get(coordinateKey(coordinate)) ?? null,
    ))
  }

  get(key: EditorScopedStorageKey): Promise<unknown | null> {
    this.dataCalls += 1
    return Promise.resolve(structuredClone(this.rows.get(rowKey(key))?.value ?? null))
  }

  list(prefix: EditorScopedStoragePrefix): Promise<readonly EditorScopedStorageEntry[]> {
    this.dataCalls += 1
    return Promise.resolve(structuredClone([...this.rows.values()]
      .filter((entry) => matchesPrefix(entry.key, prefix))))
  }

  put(key: EditorScopedStorageKey, value: unknown): Promise<void> {
    this.dataCalls += 1
    this.rows.set(rowKey(key), structuredClone({ key, value }))
    return Promise.resolve()
  }

  delete(key: EditorScopedStorageKey): Promise<void> {
    this.dataCalls += 1
    this.rows.delete(rowKey(key))
    return Promise.resolve()
  }

  deletePrefix(prefix: EditorScopedStoragePrefix): Promise<void> {
    this.dataCalls += 1
    for (const [key, entry] of this.rows) {
      if (matchesPrefix(entry.key, prefix)) this.rows.delete(key)
    }
    return Promise.resolve()
  }

  lockDraftSequence(key: EditorDraftStreamKey): Promise<number> {
    this.dataCalls += 1
    const serialized = draftKey(key)
    if (!this.heads.has(serialized)) this.heads.set(serialized, 0)
    return Promise.resolve(this.heads.get(serialized)!)
  }

  setDraftSequence(key: EditorDraftStreamKey, expected: number, sequence: number): Promise<void> {
    this.dataCalls += 1
    const serialized = draftKey(key)
    if (this.heads.get(serialized) !== expected) throw new Error('route fake sequence conflict')
    this.heads.set(serialized, sequence)
    return Promise.resolve()
  }

  getDraftMutationReceipt(
    key: EditorDraftStreamKey,
    mutationId: EditorMutationId,
  ): Promise<EditorDraftMutationReceipt | null> {
    this.dataCalls += 1
    return Promise.resolve(structuredClone(
      this.receipts.get(`${draftKey(key)}:${mutationId}`) ?? null,
    ))
  }

  putDraftMutationReceipt(
    key: EditorDraftStreamKey,
    mutationId: EditorMutationId,
    receipt: EditorDraftMutationReceipt,
  ): Promise<void> {
    this.dataCalls += 1
    this.receipts.set(`${draftKey(key)}:${mutationId}`, structuredClone(receipt))
    return Promise.resolve()
  }
}

class RecordingRepository extends EditorScopedRepository {
  readonly identities: EditorSiteSessionIdentity[] = []

  override forScope(identity: EditorSiteSessionIdentity): BoundEditorScopedRepository {
    this.identities.push(identity)
    return super.forScope(identity)
  }
}

class RecordingSessionAuthority implements EditorSessionAuthorityPort {
  readonly calls: Readonly<{
    context: FumaRequestContext
    repositoryScope: FumaRepositoryScope
  }>[] = []

  resolveEditorSessionKey(input: Readonly<{
    context: FumaRequestContext
    repositoryScope: FumaRepositoryScope
  }>): string {
    this.calls.push(input)
    return `editor.${input.context.actor.kind === 'staff'
      ? input.context.actor.sessionId
      : 'invalid'}.${input.repositoryScope.organizationId}`
  }
}

function harness() {
  const tenants = new Map([
    [TENANT_A.organizationId, TENANT_A],
    [TENANT_B.organizationId, TENANT_B],
  ])
  let hostedSessionCalls = 0
  let authorizationCalls = 0
  const contextPorts: FumaRequestContextAuthorityPorts = {
    sessions: {
      async authenticateSameOriginHostedSession() {
        hostedSessionCalls += 1
        return {
          kind: 'staff',
          userId: USER_ID,
          sessionId: 'hosted-session',
          impersonator: null,
        }
      },
    },
    authorization: {
      async loadExactSiteAuthorization({ routeScope }) {
        authorizationCalls += 1
        const tenant = tenants.get(routeScope.organizationId)
        if (
          !tenant
          || routeScope.workspaceId !== tenant.workspaceId
          || routeScope.siteId !== SHARED_SITE_ID
        ) return null
        return authorization(tenant)
      },
    },
  }
  const storage = new MemoryStorage()
  storage.setAuthority(repositoryAuthority(TENANT_A))
  storage.setAuthority(repositoryAuthority(TENANT_B))
  const repository = new RecordingRepository(storage)
  const sessions = new RecordingSessionAuthority()
  const declarations = createEditorScopedRouteDeclarations({ repository, sessions })
  const boundary = createFumaScopedRouteBoundary({
    ports: contextPorts,
    ownerKeys: {
      async loadOwnerKey(coordinate) {
        const tenant = tenants.get(coordinate.organizationId)
        return tenant ? ownerKeyRecord(tenant) : null
      },
    },
    allowsMutationOrigin: () => true,
    generateRequestId: () => 'request-editor-routes',
    routes: declarations,
  })
  return {
    boundary,
    declarations,
    storage,
    repository,
    sessions,
    hostedSessionCalls: () => hostedSessionCalls,
    authorizationCalls: () => authorizationCalls,
  }
}

function request(
  tenant: Tenant,
  method = 'GET',
  body?: unknown,
): Request {
  return new Request(`${ORIGIN}${path(tenant)}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function responseFor(
  boundary: ReturnType<typeof createFumaScopedRouteBoundary>,
  candidate: Request,
): Promise<Response> {
  const response = await boundary.handle(candidate)
  if (!response) throw new Error('Scoped boundary did not own editor request.')
  return response
}

describe('FUMA-027 scoped editor HTTP declarations', () => {
  it('declares exact read/write routes and isolates colliding sites through immutable complete identities', async () => {
    const fixture = harness()
    expect(fixture.declarations.map(({ method, path: routePath, permission }) => ({
      method,
      path: routePath,
      permission,
    }))).toEqual([
      { method: 'GET', path: '/editor/document', permission: 'content.pages.read' },
      { method: 'PUT', path: '/editor/document', permission: 'content.pages.write' },
    ])

    const saveA = await responseFor(
      fixture.boundary,
      request(TENANT_A, 'PUT', saveBody(TENANT_A.name)),
    )
    const saveB = await responseFor(
      fixture.boundary,
      request(TENANT_B, 'PUT', saveBody(TENANT_B.name)),
    )
    expect(saveA.status).toBe(200)
    expect(saveB.status).toBe(200)

    const readA = await responseFor(fixture.boundary, request(TENANT_A))
    const readB = await responseFor(fixture.boundary, request(TENANT_B))
    expect((await readA.json()).document.pages[0].title).toBe('Tenant A page')
    expect((await readB.json()).document.pages[0].title).toBe('Tenant B page')
    expect(readA.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(readA.headers.get('cache-control')).toBe('no-store')

    expect(fixture.repository.identities).toHaveLength(4)
    expect(fixture.repository.identities.every(Object.isFrozen)).toBe(true)
    expect(fixture.repository.identities[0]).toEqual({
      ...repositoryAuthority(TENANT_A),
      profileId: 'website',
      editorSessionId: 'editor.hosted-session.organization-a',
    })
    expect(fixture.repository.identities[1]).toEqual({
      ...repositoryAuthority(TENANT_B),
      profileId: 'publication',
      editorSessionId: 'editor.hosted-session.organization-b',
    })
    expect(fixture.sessions.calls.every((call) => (
      Object.isFrozen(call)
      && Object.isFrozen(call.context)
      && Object.isFrozen(call.repositoryScope)
    ))).toBe(true)
    expect(new Set([...fixture.storage.rows.values()].map(({ key }) => key.ownerKey)))
      .toEqual(new Set(['owner-a', 'owner-b']))
  })

  it('rejects caller authority through FUMA-026 before editor handler invocation', async () => {
    const fixture = harness()
    const claimed = {
      ...saveBody(TENANT_A.name),
      profileId: 'publication',
      editorSessionId: 'caller-session',
      ownerKey: TENANT_B.ownerKey,
    }
    const response = await responseFor(
      fixture.boundary,
      request(TENANT_A, 'PUT', claimed),
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Resource not found.' })
    expect(fixture.hostedSessionCalls()).toBe(0)
    expect(fixture.authorizationCalls()).toBe(0)
    expect(fixture.sessions.calls).toHaveLength(0)
    expect(fixture.repository.identities).toHaveLength(0)
    expect(fixture.storage.authorityChecks).toBe(0)
    expect(fixture.storage.dataCalls).toBe(0)
  })

  it('denies stale bound repository scope before editor data access', async () => {
    const fixture = harness()
    const saved = await responseFor(
      fixture.boundary,
      request(TENANT_A, 'PUT', saveBody('Before transfer')),
    )
    expect(saved.status).toBe(200)

    fixture.storage.setAuthority(Object.freeze({
      ...repositoryAuthority(TENANT_A, 2),
      state: 'transferring' as const,
      transferFence: 19,
    }))
    const dataCallsBefore = fixture.storage.dataCalls
    const response = await responseFor(fixture.boundary, request(TENANT_A))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Resource not found.' })
    expect(fixture.storage.authorityChecks).toBe(2)
    expect(fixture.storage.dataCalls).toBe(dataCallsBefore)
  })

  it('returns a deterministic visible 409 envelope when two writes use one sequence', async () => {
    const fixture = harness()
    const accepted = await responseFor(
      fixture.boundary,
      request(TENANT_A, 'PUT', saveBody('Winner', 'tab-a.1')),
    )
    const conflict = await responseFor(
      fixture.boundary,
      request(TENANT_A, 'PUT', saveBody('Loser', 'tab-b.1')),
    )

    expect(accepted.status).toBe(200)
    expect(await accepted.json()).toMatchObject({
      outcome: 'accepted', mutationId: 'tab-a.1', sequence: 1, replayed: false,
    })
    expect(conflict.status).toBe(409)
    expect(conflict.headers.get('cache-control')).toBe('no-store')
    expect(await conflict.json()).toEqual({
      outcome: 'conflict',
      code: 'draft-sequence-conflict',
      mutationId: 'tab-b.1',
      expectedSequence: 0,
      authoritativeSequence: 1,
      document: {
        site: shell('Winner'),
        pages: saveBody('Winner').operations[0]!.save.changedPages,
        visualComponents: [],
        layouts: [],
      },
    })
  })

  it('returns a validated error envelope for malformed PUT bodies without binding a repository', async () => {
    const fixture = harness()
    const response = await responseFor(
      fixture.boundary,
      request(TENANT_A, 'PUT', { site: { id: SHARED_SITE_ID } }),
    )

    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: 'Request body is invalid.' })
    expect(fixture.sessions.calls).toHaveLength(0)
    expect(fixture.repository.identities).toHaveLength(0)
    expect(fixture.storage.authorityChecks).toBe(0)
  })
})

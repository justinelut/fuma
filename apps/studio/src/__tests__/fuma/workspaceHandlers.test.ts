import { describe, expect, it } from 'bun:test'
import type {
  WorkspaceCreateInput,
  WorkspaceRecord,
  WorkspaceUpdateInput,
} from '../../../server/fuma/workspaces/contracts'
import {
  createWorkspaceHandlerBoundary,
  type AuthorizedWorkspaceServicePort,
  type WorkspaceHandlerActor,
} from '../../../server/fuma/workspaces/handlers'

const ORIGIN = 'https://app.fuma.example'
const NOW = '2026-07-24T18:00:00.000Z'
const ACTOR: WorkspaceHandlerActor = Object.freeze({ userId: 'user-owner' })

type Call = Readonly<{ method: string; args: readonly unknown[] }>

function workspace(overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    id: 'workspace-news',
    organizationId: 'org-a',
    slug: 'news',
    name: 'News',
    status: 'active',
    isDefault: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function serviceFixture(overrides: Partial<AuthorizedWorkspaceServicePort> = {}) {
  const calls: Call[] = []
  const service: AuthorizedWorkspaceServicePort = {
    async create(actor, input) {
      calls.push({ method: 'create', args: [actor, input] })
      return workspace({
        id: input.id,
        organizationId: input.organizationId,
        slug: input.slug,
        name: input.name,
        isDefault: input.isDefault ?? false,
      })
    },
    async list(actor, organizationId) {
      calls.push({ method: 'list', args: [actor, organizationId] })
      return [workspace({ organizationId })]
    },
    async get(actor, organizationId, workspaceId) {
      calls.push({ method: 'get', args: [actor, organizationId, workspaceId] })
      return workspace({ id: workspaceId, organizationId })
    },
    async update(actor, input) {
      calls.push({ method: 'update', args: [actor, input] })
      return workspace({
        id: input.workspaceId,
        organizationId: input.organizationId,
        slug: input.slug ?? 'news',
        name: input.name ?? 'News',
        isDefault: input.isDefault ?? true,
      })
    },
    async setDefault(actor, input) {
      calls.push({ method: 'setDefault', args: [actor, input] })
      return workspace({ id: input.workspaceId, organizationId: input.organizationId })
    },
    async archive(actor, input) {
      calls.push({ method: 'archive', args: [actor, input] })
      return workspace({
        id: input.workspaceId,
        organizationId: input.organizationId,
        status: 'archived',
        isDefault: false,
      })
    },
    async restore(actor, input) {
      calls.push({ method: 'restore', args: [actor, input] })
      return workspace({ id: input.workspaceId, organizationId: input.organizationId })
    },
    ...overrides,
  }
  return { calls, service }
}

function request(
  path: string,
  method = 'GET',
  body?: string,
  origin: string | null = ORIGIN,
): Request {
  const headers = new Headers()
  if (body !== undefined) headers.set('content-type', 'application/json')
  if (origin !== null) headers.set('origin', origin)
  return new Request(`${ORIGIN}${path}`, { method, body, headers })
}

function jsonRequest(path: string, method: string, body: unknown): Request {
  return request(path, method, JSON.stringify(body))
}

function boundary(
  service: AuthorizedWorkspaceServicePort,
  options: Readonly<{
    actor?: WorkspaceHandlerActor | null
    allowMutations?: boolean
  }> = {},
) {
  return createWorkspaceHandlerBoundary({
    service,
    resolveActor: async () => options.actor === undefined ? ACTOR : options.actor,
    allowsMutationOrigin: async () => options.allowMutations ?? true,
  })
}

async function dispatch(
  target: ReturnType<typeof createWorkspaceHandlerBoundary>,
  candidate: Request,
): Promise<Response> {
  const response = await target.handle(candidate)
  if (!response) throw new Error('Workspace boundary did not own the request')
  return response
}

describe('FUMA-015 workspace HTTP handlers', () => {
  it('rejects unauthenticated requests without trusting actor IDs in headers or bodies', async () => {
    const { calls, service } = serviceFixture()
    const target = boundary(service, { actor: null })
    const candidate = jsonRequest(
      '/api/fuma/organizations/org-a/workspaces',
      'POST',
      {
        id: 'workspace-news',
        slug: 'news',
        name: 'News',
        actorUserId: 'user-attacker',
      },
    )
    candidate.headers.set('x-actor-user-id', 'user-attacker')

    const response = await dispatch(target, candidate)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Authentication required' })
    expect(calls).toEqual([])
  })

  it('rejects caller-supplied organization scope and service responses outside the path scope', async () => {
    const first = serviceFixture()
    const bodyScope = await dispatch(boundary(first.service), jsonRequest(
      '/api/fuma/organizations/org-a/workspaces',
      'POST',
      {
        id: 'workspace-news',
        organizationId: 'org-b',
        slug: 'news',
        name: 'News',
      },
    ))
    expect(bodyScope.status).toBe(400)
    expect(first.calls).toEqual([])

    const leaked = serviceFixture({
      async get() {
        return workspace({ organizationId: 'org-b' })
      },
    })
    const originalConsoleError = console.error
    console.error = () => {}
    try {
      const response = await dispatch(boundary(leaked.service), request(
        '/api/fuma/organizations/org-a/workspaces/workspace-news',
      ))
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: 'Internal server error' })
    } finally {
      console.error = originalConsoleError
    }
  })

  it('rejects malformed create, empty update, and actor-bearing action bodies', async () => {
    const { calls, service } = serviceFixture()
    const target = boundary(service)

    const malformed = await dispatch(target, request(
      '/api/fuma/organizations/org-a/workspaces',
      'POST',
      '{not-json',
    ))
    expect(malformed.status).toBe(400)

    const emptyUpdate = await dispatch(target, jsonRequest(
      '/api/fuma/organizations/org-a/workspaces/workspace-news',
      'PATCH',
      {},
    ))
    expect(emptyUpdate.status).toBe(400)

    const actorBody = await dispatch(target, jsonRequest(
      '/api/fuma/organizations/org-a/workspaces/workspace-news/archive',
      'POST',
      { actorUserId: 'user-attacker' },
    ))
    expect(actorBody.status).toBe(400)
    expect(calls).toEqual([])
  })

  it('applies the caller-supplied Origin policy to mutations but not reads', async () => {
    const { calls, service } = serviceFixture()

    const allowed = await dispatch(boundary(service), jsonRequest(
      '/api/fuma/organizations/org-a/workspaces',
      'POST',
      { id: 'workspace-news', slug: 'news', name: 'News' },
    ))
    expect(allowed.status).toBe(201)

    const deniedTarget = boundary(service, { allowMutations: false })
    const hostile = await dispatch(deniedTarget, request(
      '/api/fuma/organizations/org-a/workspaces/workspace-news/archive',
      'POST',
      undefined,
      'https://evil.example',
    ))
    expect(hostile.status).toBe(403)

    const read = await dispatch(deniedTarget, request(
      '/api/fuma/organizations/org-a/workspaces',
      'GET',
      undefined,
      null,
    ))
    expect(read.status).toBe(200)
    expect(calls.map(({ method }) => method)).toEqual(['create', 'list'])
  })

  it('routes every operation with actor context and exact path-derived service scope', async () => {
    const { calls, service } = serviceFixture()
    const target = boundary(service)
    const base = '/api/fuma/organizations/org-a/workspaces'

    expect((await dispatch(target, request(base))).status).toBe(200)
    expect((await dispatch(target, jsonRequest(base, 'POST', {
      id: 'workspace-editorial',
      slug: 'editorial',
      name: 'Editorial',
    }))).status).toBe(201)
    expect((await dispatch(target, request(`${base}/workspace-news`))).status).toBe(200)
    expect((await dispatch(target, jsonRequest(`${base}/workspace-news`, 'PATCH', {
      name: 'Daily News',
    }))).status).toBe(200)
    expect((await dispatch(target, request(`${base}/workspace-news/set-default`, 'POST'))).status)
      .toBe(200)
    expect((await dispatch(target, request(`${base}/workspace-news/archive`, 'POST'))).status)
      .toBe(200)
    expect((await dispatch(target, request(`${base}/workspace-news/restore`, 'POST'))).status)
      .toBe(200)

    const createInput: WorkspaceCreateInput = {
      id: 'workspace-editorial',
      organizationId: 'org-a',
      slug: 'editorial',
      name: 'Editorial',
    }
    const updateInput: WorkspaceUpdateInput = {
      organizationId: 'org-a',
      workspaceId: 'workspace-news',
      name: 'Daily News',
    }
    const itemScope = { organizationId: 'org-a', workspaceId: 'workspace-news' }
    expect(calls).toEqual([
      { method: 'list', args: [ACTOR, 'org-a'] },
      { method: 'create', args: [ACTOR, createInput] },
      { method: 'get', args: [ACTOR, 'org-a', 'workspace-news'] },
      { method: 'update', args: [ACTOR, updateInput] },
      { method: 'setDefault', args: [ACTOR, itemScope] },
      { method: 'archive', args: [ACTOR, itemScope] },
      { method: 'restore', args: [ACTOR, itemScope] },
    ])
  })
})

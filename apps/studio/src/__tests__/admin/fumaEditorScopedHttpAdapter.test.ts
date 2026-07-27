import { describe, expect, it } from 'bun:test'
import type { FetchLike } from '@core/http'
import {
  EditorSessionConflictError,
  EditorSessionCoordinatorError,
  createFumaEditorScopedHttpAdapter,
} from '@admin/fuma/editorSession'

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

function document(name: string) {
  const pageRoot = node('page-root', 'base.body')
  const componentRoot = node('component-root', 'base.container')
  const layoutRoot = node('layout-root', 'base.container')
  const structuralSection = { expandedFolders: [], emptyFolders: [], rowOrder: [] }
  const decorativeSection = { folders: [], items: [] }
  return {
    site: {
      id: 'shared-site',
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
    },
    pages: [{
      id: 'page-1',
      slug: 'index',
      title: `${name} page`,
      rootNodeId: pageRoot.id,
      nodes: { [pageRoot.id]: pageRoot },
    }],
    visualComponents: [{
      id: 'component-1',
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
      id: 'layout-1',
      name: `${name} layout`,
      rootNodeId: layoutRoot.id,
      nodes: { [layoutRoot.id]: layoutRoot },
      classes: {},
      createdAt: 1,
    }],
  }
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init)
}

describe('FUMA-027 target-bound editor HTTP adapter', () => {
  it('validates the complete target and freezes an adapter exposing only load/save', () => {
    expect(() => createFumaEditorScopedHttpAdapter({
      organizationId: 'organization-a',
      workspaceId: 'workspace-a',
    } as never)).toThrow(EditorSessionCoordinatorError)
    expect(() => createFumaEditorScopedHttpAdapter({
      organizationId: 'organization-a',
      workspaceId: 'workspace-a',
      siteId: 'site-a',
    } as never)).toThrow(EditorSessionCoordinatorError)

    const adapter = createFumaEditorScopedHttpAdapter({
      organizationId: 'organization-a',
      workspaceId: 'workspace-a',
      siteId: 'site-a',
      profileId: 'website',
    }, async () => jsonResponse({ document: null, sequence: 0 }))

    expect(Object.isFrozen(adapter)).toBe(true)
    expect(Object.keys(adapter).sort()).toEqual(['load', 'save'])
  })

  it('encodes the full ancestry once and sends no caller authority in headers or bodies', async () => {
    const source = {
      organizationId: 'organization/acacia',
      workspaceId: 'workspace ? one',
      siteId: 'site#shared',
      profileId: 'website',
    }
    const expectedPath = '/api/fuma/organizations/organization%2Facacia/workspaces/workspace%20%3F%20one/sites/site%23shared/editor/document'
    const savedDocument = document('Saved')
    const requests: Array<{ path: string; init?: RequestInit }> = []
    const fetchImpl: FetchLike = async (input, init) => {
      requests.push({ path: String(input), init })
      return init?.method === 'PUT'
        ? jsonResponse({
            outcome: 'accepted',
            mutationId: 'tab-a.1',
            expectedSequence: 4,
            sequence: 5,
            replayed: false,
            document: savedDocument,
          })
        : jsonResponse({ document: document('Loaded'), sequence: 4 })
    }
    const adapter = createFumaEditorScopedHttpAdapter(source, fetchImpl)

    source.organizationId = 'substituted-organization'
    expect((await adapter.load()).document?.site.name).toBe('Loaded')
    await adapter.save({
      document: savedDocument,
      expectedSequence: 4,
      mutationId: 'tab-a.1',
    })

    expect(requests.map(({ path }) => path)).toEqual([expectedPath, expectedPath])
    expect(requests.map(({ init }) => init?.method)).toEqual(['GET', 'PUT'])
    expect(requests.every(({ init }) => init?.credentials === 'include')).toBe(true)

    const loadHeaders = new Headers(requests[0]?.init?.headers)
    expect([...loadHeaders.keys()]).toEqual([])
    expect(requests[0]?.init?.body).toBeUndefined()

    const saveHeaders = new Headers(requests[1]?.init?.headers)
    expect([...saveHeaders.keys()].map((key) => key.toLowerCase())).toEqual(['content-type'])
    const saveBody = String(requests[1]?.init?.body)
    expect(JSON.parse(saveBody)).toEqual({
      mutationId: 'tab-a.1',
      expectedSequence: 4,
      operations: [{
        kind: 'incremental-save',
        save: {
          site: savedDocument.site,
          changedPages: savedDocument.pages,
          deletedPageIds: [],
          changedComponents: savedDocument.visualComponents,
          deletedComponentIds: [],
          changedLayouts: savedDocument.layouts,
          deletedLayoutIds: [],
        },
      }],
    })
    for (const authorityField of [
      'organizationId',
      'workspaceId',
      'siteId',
      'profileId',
      'capability',
      'ownerKey',
      'generation',
    ]) {
      expect(saveBody).not.toContain(`"${authorityField}"`)
      expect(saveHeaders.has(authorityField)).toBe(false)
    }
  })

  it('keeps colliding site IDs distinct through their complete encoded ancestry', async () => {
    const paths: string[] = []
    const fetchImpl: FetchLike = async (input) => {
      paths.push(String(input))
      return jsonResponse({ document: null, sequence: 0 })
    }
    const siteId = 'shared/site'
    const first = createFumaEditorScopedHttpAdapter({
      organizationId: 'organization-a',
      workspaceId: 'workspace-a',
      siteId,
      profileId: 'website',
    }, fetchImpl)
    const second = createFumaEditorScopedHttpAdapter({
      organizationId: 'organization-b',
      workspaceId: 'workspace-b',
      siteId,
      profileId: 'publication',
    }, fetchImpl)

    await Promise.all([first.load(), second.load()])

    expect(paths[0]).not.toBe(paths[1])
    expect(paths).toEqual([
      '/api/fuma/organizations/organization-a/workspaces/workspace-a/sites/shared%2Fsite/editor/document',
      '/api/fuma/organizations/organization-b/workspaces/workspace-b/sites/shared%2Fsite/editor/document',
    ])
  })

  it('decodes deterministic 409 conflicts into a typed visible client error', async () => {
    const authoritative = document('Authoritative')
    const adapter = createFumaEditorScopedHttpAdapter({
      organizationId: 'organization-a',
      workspaceId: 'workspace-a',
      siteId: 'site-a',
      profileId: 'website',
    }, async () => jsonResponse({
      outcome: 'conflict',
      code: 'draft-sequence-conflict',
      mutationId: 'tab-b.1',
      expectedSequence: 0,
      authoritativeSequence: 1,
      document: authoritative,
    }, { status: 409 }))

    const error = await adapter.save({
      document: document('Local'),
      expectedSequence: 0,
      mutationId: 'tab-b.1',
    }).catch((failure: unknown) => failure)
    expect(error).toBeInstanceOf(EditorSessionConflictError)
    expect((error as EditorSessionConflictError<ReturnType<typeof document>>).conflict)
      .toEqual({
        code: 'draft-sequence-conflict',
        mutationId: 'tab-b.1',
        expectedSequence: 0,
        authoritativeSequence: 1,
        authoritativeDocument: authoritative,
      })
  })

  it('validates both load and save response envelopes with TypeBox', async () => {
    const target = {
      organizationId: 'organization-a',
      workspaceId: 'workspace-a',
      siteId: 'site-a',
      profileId: 'website',
    }
    const invalidLoad = createFumaEditorScopedHttpAdapter(
      target,
      async () => jsonResponse({ document: { site: { id: 'invalid' } }, sequence: 0 }),
    )
    await expect(invalidLoad.load()).rejects.toThrow()

    const invalidSave = createFumaEditorScopedHttpAdapter(
      target,
      async () => jsonResponse({ outcome: 'accepted', document: { site: { id: 'invalid' } } }),
    )
    await expect(invalidSave.save({
      document: document('Saved'),
      expectedSequence: 0,
      mutationId: 'tab-a.1',
    })).rejects.toThrow()
  })
})

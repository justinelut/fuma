import { describe, expect, test } from 'bun:test'
import type { EditorSiteDocument } from '../../../apps/studio/server/fuma/editor/contracts'
import { assertMimeType } from '../../../apps/studio/server/fuma/objectStorage/integrity'
import { CoreSemanticReleaseRenderer } from '../../../apps/studio/server/fuma/publishing/semanticRenderer'
import {
  RUNTIME_SNAPSHOT_MIME,
  RUNTIME_SNAPSHOT_PATH,
} from '../../../apps/studio/server/fuma/publishing/runtimeTree/contracts'
import { projectEditorRuntimeRelease } from '../../../apps/studio/server/fuma/publishing/runtimeTree/projector'
import {
  RuntimeTreeRendererAdapter,
  parseRuntimeSnapshotBytes,
  type WorkerRenderedArtifact,
} from '../../../apps/studio/server/fuma/publishing/runtimeTree/renderer'

const scope = Object.freeze({
  platformId: 'platform-prod',
  organizationId: 'organization-prod',
  workspaceId: 'workspace-prod',
  siteId: 'site-prod',
  ownerKey: 'owner-prod',
  generation: 3,
  state: 'active' as const,
  transferFence: null,
})

function document(): EditorSiteDocument {
  const structural = { expandedFolders: [], emptyFolders: [], rowOrder: [] }
  const decorative = { folders: [], items: [] }
  return {
    site: {
      id: scope.siteId,
      name: 'Runtime production projection',
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
      runtime: { dependencyLock: { version: 1, packages: {}, updatedAt: 1 }, scripts: {}, styles: {} },
      createdAt: 1,
      updatedAt: 2,
    },
    pages: [{
      id: 'page-prod',
      slug: 'index',
      title: 'Production runtime',
      rootNodeId: 'page-root',
      nodes: {
        'page-root': {
          id: 'page-root', moduleId: 'base.body', props: {}, breakpointOverrides: {},
          children: ['private-ref'], parentId: null, classIds: [],
        },
        'private-ref': {
          id: 'private-ref', moduleId: 'base.visual-component-ref',
          props: { componentId: 'component-card', propOverrides: {} },
          breakpointOverrides: {}, children: [], parentId: 'page-root', classIds: [],
        },
      },
    }],
    visualComponents: [{
      id: 'component-card',
      name: 'Private card',
      tree: {
        rootNodeId: 'component-root',
        nodes: {
          'component-root': {
            id: 'component-root', moduleId: 'base.container', props: {},
            breakpointOverrides: {}, children: [], parentId: null, classIds: [],
          },
        },
      },
      params: [],
      classIds: [],
      createdAt: 1,
    }],
    layouts: [],
  }
}

describe('FUMA-SITE-002 production publish integration', () => {
  test('projects a real editor snapshot through the existing semantic publisher into one exact release', async () => {
    const releaseId = 'release-production-site002'
    const adapter = new RuntimeTreeRendererAdapter({
      semanticRenderer: new CoreSemanticReleaseRenderer(),
      project: projectEditorRuntimeRelease,
    })
    const artifacts: WorkerRenderedArtifact[] = []
    for await (const artifact of adapter.render(
      { scope, profileId: 'website' },
      { id: 'snapshot-production', hashSha256: 'a'.repeat(64), immutableRevision: '7', document: document() },
      { releaseId },
    )) artifacts.push(artifact)

    expect(artifacts.some(({ logicalPath }) => logicalPath === '/index.html')).toBe(true)
    expect(artifacts.some(({ mimeType }) => mimeType === 'text/css')).toBe(true)
    expect(artifacts.some(({ logicalPath }) => logicalPath.startsWith('/runtime/routes/'))).toBe(true)
    const runtime = artifacts.find(({ logicalPath }) => logicalPath === RUNTIME_SNAPSHOT_PATH)
    expect(runtime?.mimeType).toBe(RUNTIME_SNAPSHOT_MIME)

    const snapshot = parseRuntimeSnapshotBytes(runtime!.bytes)
    expect(snapshot.releaseId).toBe(releaseId)
    expect(snapshot.sourceSnapshotId).toBe('snapshot-production')
    expect(snapshot.pages).toHaveLength(1)
    expect(snapshot.visualComponents).toHaveLength(1)
    expect(snapshot.components.some(({ source }) => source.kind === 'owner-private')).toBe(true)
    expect(snapshot.components.every(({ persistedExecutableJsx, dynamicTenantServerImport }) => !persistedExecutableJsx && !dynamicTenantServerImport)).toBe(true)
    expect(snapshot.routes[0]?.semanticHtmlPath).toBe('/index.html')
    expect(snapshot.routes[0]?.styleArtifactPaths.length).toBeGreaterThan(0)

    assertMimeType(runtime!.bytes, RUNTIME_SNAPSHOT_MIME, [RUNTIME_SNAPSHOT_MIME])
    assertMimeType(new TextEncoder().encode('(()=>{globalThis.__fuma=true})()'), 'text/javascript', ['text/javascript'])
  })

  test('rejects release-context substitution before artifact emission', async () => {
    const adapter = new RuntimeTreeRendererAdapter({
      semanticRenderer: new CoreSemanticReleaseRenderer(),
      project: async (authority, snapshot, context, legacy) => {
        const projection = projectEditorRuntimeRelease(authority, snapshot, context, legacy)
        return { ...projection, draft: { ...(projection.draft as object), releaseId: 'foreign-release' } }
      },
    })
    const render = async () => {
      for await (const _artifact of adapter.render(
        { scope, profileId: 'website' },
        { id: 'snapshot-production', hashSha256: 'a'.repeat(64), immutableRevision: '7', document: document() },
        { releaseId: 'expected-release' },
      )) { /* drain */ }
    }
    await expect(render()).rejects.toThrow('exact claimed snapshot and publish authority')
  })
})

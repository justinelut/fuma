/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Value } from '@sinclair/typebox/value'
import type { SemanticReleaseRenderer } from '../../../apps/studio/server/fuma/publishing/workerPublisher'
import {
  RuntimeArtifactReferenceSchema,
  RuntimeComponentRegistryEntrySchema,
  RuntimeReleaseSnapshotSchema,
  RuntimeRouteManifestSchema,
  RUNTIME_SNAPSHOT_PATH,
} from '../../../apps/studio/server/fuma/publishing/runtimeTree/contracts'
import {
  RuntimeTreeRendererAdapter,
  parseRuntimeSnapshotBytes,
  validateRuntimeRouteArtifact,
  type WorkerRenderedArtifact,
} from '../../../apps/studio/server/fuma/publishing/runtimeTree/renderer'
import {
  SITE_002_AUTHORITY,
  SeededLegacySemanticRenderer,
  seededProjection,
  seededRuntimeRelease,
} from '../runtimeReleaseFixtures'

const ROOT = join(import.meta.dir, '../../..')

async function rendered(adapter: RuntimeTreeRendererAdapter, revision: 1 | 2): Promise<WorkerRenderedArtifact[]> {
  const seed = seededRuntimeRelease(revision)
  const output: WorkerRenderedArtifact[] = []
  for await (const artifact of adapter.render(SITE_002_AUTHORITY, seed.sourceSnapshot)) output.push(artifact)
  return output
}

function snapshotBytes(artifacts: readonly WorkerRenderedArtifact[]): Uint8Array {
  return artifacts.find(({ logicalPath }) => logicalPath === RUNTIME_SNAPSHOT_PATH)!.bytes
}

describe('FUMA-SITE-002 runtime release architecture', () => {
  test('exposes strict independently typed snapshot, route, component, style and artifact contracts', async () => {
    const adapter = new RuntimeTreeRendererAdapter({ semanticRenderer: new SeededLegacySemanticRenderer(), project: seededProjection })
    const workerRenderer: SemanticReleaseRenderer = adapter
    expect(workerRenderer).toBe(adapter)
    const artifacts = await rendered(adapter, 1)
    const snapshot = parseRuntimeSnapshotBytes(snapshotBytes(artifacts))

    expect(Value.Check(RuntimeReleaseSnapshotSchema, snapshot)).toBe(true)
    expect(snapshot.routes.every((route) => Value.Check(RuntimeRouteManifestSchema, route))).toBe(true)
    expect(snapshot.components.every((component) => Value.Check(RuntimeComponentRegistryEntrySchema, component))).toBe(true)
    expect(snapshot.artifacts.every((artifact) => Value.Check(RuntimeArtifactReferenceSchema, artifact))).toBe(true)
    expect(snapshot.compatibility).toEqual({
      semanticHtmlCss: 'coexists',
      legacyReleaseReadable: true,
      runtimeQueriesDraftState: false,
      runtimeQueriesPlatformTables: false,
      tenantServerComponents: 'forbidden',
    })

    const drifted = { ...snapshot, draftTable: 'fuma_editor_drafts' }
    expect(Value.Check(RuntimeReleaseSnapshotSchema, drifted)).toBe(false)
  })

  test('serializes byte-identically regardless of registry, token and artifact input ordering', async () => {
    const seed = seededRuntimeRelease(1)
    const reordered = structuredClone(seed.projection) as any
    reordered.draft.components.reverse()
    reordered.draft.styles.tokens.reverse()
    reordered.draft.styles.breakpoints.reverse()
    reordered.artifacts.reverse()
    const canonical = new RuntimeTreeRendererAdapter({ semanticRenderer: new SeededLegacySemanticRenderer(), project: seededProjection })
    const shuffled = new RuntimeTreeRendererAdapter({ semanticRenderer: new SeededLegacySemanticRenderer(), project: () => reordered })

    const first = snapshotBytes(await rendered(canonical, 1))
    const second = snapshotBytes(await rendered(shuffled, 1))
    expect(second).toEqual(first)
    expect(parseRuntimeSnapshotBytes(second).runtimeTreeHashSha256).toBe(parseRuntimeSnapshotBytes(first).runtimeTreeHashSha256)
  })

  test('emits runtime route/tree bytes beside unchanged semantic HTML/CSS through one renderer seam', async () => {
    const adapter = new RuntimeTreeRendererAdapter({ semanticRenderer: new SeededLegacySemanticRenderer(), project: seededProjection })
    const artifacts = await rendered(adapter, 1)
    expect(artifacts.map(({ logicalPath }) => logicalPath)).toContain('/menu/index.html')
    expect(artifacts.map(({ logicalPath }) => logicalPath)).toContain('/assets/framework.css')
    expect(artifacts.map(({ logicalPath }) => logicalPath)).toContain('/runtime/routes/menu.json')
    expect(artifacts.map(({ logicalPath }) => logicalPath)).toContain(RUNTIME_SNAPSHOT_PATH)

    const route = artifacts.find(({ logicalPath }) => logicalPath === '/runtime/routes/menu.json')!
    const parsed = validateRuntimeRouteArtifact(JSON.parse(new TextDecoder().decode(route.bytes)))
    expect(parsed.route.route).toBe('/menu')
    expect(parsed.artifactReferences.some(({ role }) => role === 'semantic-html')).toBe(true)
    expect(parsed.artifactReferences.some(({ role }) => role === 'client-bundle')).toBe(true)
  })

  test('keeps the closed SITE-002 publisher independent from the SITE-003 application', () => {
    expect(existsSync(join(ROOT, 'apps/site-runtime'))).toBe(true)
    const runtimeManifest = readFileSync(join(ROOT, 'apps/site-runtime/runtime.manifest.json'), 'utf8')
    expect(runtimeManifest).toContain('"ticket": "FUMA-SITE-005"')
    const contracts = readFileSync(join(ROOT, 'apps/studio/server/fuma/publishing/runtimeTree/contracts.ts'), 'utf8')
    const adapter = readFileSync(join(ROOT, 'apps/studio/server/fuma/publishing/runtimeTree/renderer.ts'), 'utf8')
    const composition = readFileSync(join(ROOT, 'apps/studio/server/fuma/publishing/composition.ts'), 'utf8')
    expect(contracts).toContain("from '@sinclair/typebox'")
    expect(contracts).not.toContain("from 'zod'")
    expect(contracts).not.toMatch(/tooling\//)
    expect(adapter).not.toMatch(/from ['"][^'"]*tooling\//)
    expect(composition).toContain('new RuntimeTreeRendererAdapter({')
    expect(composition).toContain('project: projectEditorRuntimeRelease')
    expect(composition).not.toMatch(/from ['"][^'"]*tooling\//)
  })
})

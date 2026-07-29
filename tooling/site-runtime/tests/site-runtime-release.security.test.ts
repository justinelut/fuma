/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test } from 'bun:test'
import { RuntimeReleaseContractError, RUNTIME_SNAPSHOT_PATH } from '../../../apps/studio/server/fuma/publishing/runtimeTree/contracts'
import {
  RuntimeTreeRendererAdapter,
  parseRuntimeSnapshotBytes,
  validateRuntimeReleaseSnapshot,
  type WorkerRenderedArtifact,
} from '../../../apps/studio/server/fuma/publishing/runtimeTree/renderer'
import {
  SITE_002_AUTHORITY,
  SeededLegacySemanticRenderer,
  seededProjection,
  seededRuntimeRelease,
} from '../runtimeReleaseFixtures'

async function collect(projection: unknown): Promise<WorkerRenderedArtifact[]> {
  const seed = seededRuntimeRelease(1)
  const adapter = new RuntimeTreeRendererAdapter({
    semanticRenderer: new SeededLegacySemanticRenderer(),
    project: () => projection as never,
  })
  const output: WorkerRenderedArtifact[] = []
  for await (const artifact of adapter.render(SITE_002_AUTHORITY, seed.sourceSnapshot)) output.push(artifact)
  return output
}

function hostile(mutator: (projection: any) => void): unknown {
  const projection = structuredClone(seededRuntimeRelease(1).projection) as any
  mutator(projection)
  return projection
}

describe('FUMA-SITE-002 runtime release security', () => {
  test.each([
    ['cross-site private component substitution', hostile((projection) => { projection.draft.components.find((item: any) => item.source.kind === 'owner-private').source.siteId = 'site_attacker' }), 'identity-mismatch'],
    ['missing exact component version', hostile((projection) => { projection.draft.pages[0].root.component = { ...projection.draft.pages[0].root.component, exactVersion: '9.9.9' } }), 'version-mismatch'],
    ['undeclared capability', hostile((projection) => { projection.draft.pages[0].root.requiredCapabilities.push('browser.events') }), 'capability-mismatch'],
    ['missing artifact reference', hostile((projection) => { projection.artifacts[0].references.push('/runtime/components/missing.css') }), 'missing-reference'],
    ['cross-release artifact substitution', hostile((projection) => { projection.artifacts[0].releaseId = 'release_attacker' }), 'identity-mismatch'],
    ['unvalidated restricted client', hostile((projection) => { projection.draft.components.find((item: any) => item.execution === 'restricted-client').trust.validation.security = false }), 'invalid-contract'],
    ['persisted executable source', hostile((projection) => { projection.draft.pages[0].root.props.componentSource = 'export default function TenantServer(){}' }), 'persisted-executable-source'],
    ['unsafe artifact MIME', hostile((projection) => { projection.artifacts[0].mimeType = 'text/html' }), 'unsafe-artifact'],
    ['content-address mismatch', hostile((projection) => { projection.artifacts[0].bytes = new TextEncoder().encode('changed') }), 'unsafe-artifact'],
  ])('rejects %s before activation', async (_label, projection, code) => {
    await expect(collect(projection)).rejects.toEqual(expect.objectContaining({ code }))
  })

  test('rejects runtime snapshot hash and immutable reference tampering', async () => {
    const seed = seededRuntimeRelease(1)
    const adapter = new RuntimeTreeRendererAdapter({ semanticRenderer: new SeededLegacySemanticRenderer(), project: seededProjection })
    const output: WorkerRenderedArtifact[] = []
    for await (const artifact of adapter.render(SITE_002_AUTHORITY, seed.sourceSnapshot)) output.push(artifact)
    const snapshot = structuredClone(parseRuntimeSnapshotBytes(output.find(({ logicalPath }) => logicalPath === RUNTIME_SNAPSHOT_PATH)!.bytes)) as any

    snapshot.runtimeTreeHashSha256 = '0'.repeat(64)
    expect(() => validateRuntimeReleaseSnapshot(snapshot)).toThrow(expect.objectContaining({ code: 'hash-mismatch' }))

    const missing = structuredClone(parseRuntimeSnapshotBytes(output.find(({ logicalPath }) => logicalPath === RUNTIME_SNAPSHOT_PATH)!.bytes)) as any
    missing.artifacts.find((artifact: any) => artifact.role === 'client-bundle').references.push('/runtime/components/absent.css')
    expect(() => validateRuntimeReleaseSnapshot(missing)).toThrow(RuntimeReleaseContractError)
  })

  test('binds AI/designer private definitions and client artifacts without JSX or tenant Server Components', async () => {
    const artifacts = await collect(seededRuntimeRelease(1).projection)
    const snapshot = parseRuntimeSnapshotBytes(artifacts.find(({ logicalPath }) => logicalPath === RUNTIME_SNAPSHOT_PATH)!.bytes)
    const privateEntry = snapshot.components.find(({ execution }) => execution === 'private-declarative')!
    const restricted = snapshot.components.find(({ execution }) => execution === 'restricted-client')!
    const text = new TextDecoder().decode(artifacts.find(({ logicalPath }) => logicalPath === RUNTIME_SNAPSHOT_PATH)!.bytes)

    expect(privateEntry.source).toMatchObject({ kind: 'owner-private', origin: 'ai-designer', siteId: 'site_alpha' })
    expect(privateEntry.definition).not.toBeNull()
    expect(restricted.trust).toMatchObject({ tier: 'owner-private-restricted-client', ownerConfirmed: true })
    expect(restricted.artifactPaths).toHaveLength(3)
    expect(text).not.toMatch(/"(?:jsx|tsx|componentSource|serverComponentSource|executableSource|serverModule|modulePath|dynamicImport)"\s*:/i)
    expect(snapshot.components.some(({ execution }) => execution === ('tenant-server' as never))).toBe(false)
  })
})

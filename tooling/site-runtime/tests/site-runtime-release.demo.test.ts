/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test } from 'bun:test'
import { seededRuntimeRelease } from '../runtimeReleaseFixtures'
import { Site002LifecycleHarness } from './site-runtime-release.harness'

describe('FUMA-SITE-002 seeded dual-release demo', () => {
  test('publishes legacy and React artifacts, fails safely, retries exactly, activates, and rolls back', async () => {
    const harness = new Site002LifecycleHarness()
    const releaseOne = seededRuntimeRelease(1)
    const releaseTwo = seededRuntimeRelease(2)

    const firstManifest = await harness.publish(releaseOne)
    harness.retain(releaseOne.releaseId)
    const firstSnapshot = harness.runtimeSnapshot(releaseOne.releaseId)
    expect(firstManifest.artifacts.map((artifact: any) => artifact.logicalPath)).toContain('/menu/index.html')
    expect(firstManifest.artifacts.map((artifact: any) => artifact.logicalPath)).toContain('/assets/framework.css')
    expect(firstManifest.artifacts.map((artifact: any) => artifact.logicalPath)).toContain('/runtime/snapshot.json')
    expect(firstSnapshot.components.find(({ execution }) => execution === 'private-declarative')).toMatchObject({
      reference: { exactVersion: '1.0.0' },
      source: { kind: 'owner-private', origin: 'ai-designer' },
    })
    expect(firstSnapshot.artifacts.some(({ role }) => role === 'client-bundle')).toBe(true)

    await expect(harness.publish(releaseTwo, {
      fault: async (boundary) => {
        if (boundary === 'before-activation') throw new Error('demo blocks activation')
      },
    })).rejects.toThrow('demo blocks activation')
    expect(harness.activeReleaseId).toBe(releaseOne.releaseId)
    const finalizedHash = harness.releases.get(releaseTwo.releaseId)!.manifest.manifestHashSha256

    const retriedManifest = await harness.publish(releaseTwo)
    expect(retriedManifest.manifestHashSha256).toBe(finalizedHash)
    expect(harness.activeReleaseId).toBe(releaseTwo.releaseId)
    expect(harness.runtimeSnapshot(releaseTwo.releaseId).components.find(({ execution }) => execution === 'private-declarative')!.reference.exactVersion).toBe('1.1.0')
    expect(harness.runtimeSnapshot(releaseOne.releaseId).components.find(({ execution }) => execution === 'private-declarative')!.reference.exactVersion).toBe('1.0.0')

    harness.rollback(releaseOne.releaseId)
    expect(harness.activeReleaseId).toBe(releaseOne.releaseId)
    expect(harness.runtimeSnapshot(releaseOne.releaseId).runtimeTreeHashSha256).toBe(firstSnapshot.runtimeTreeHashSha256)

    process.stdout.write(`[FUMA-SITE-002 demo] ${releaseOne.releaseId} retained; ${releaseTwo.releaseId} failed then retried ${finalizedHash}; rollback restored ${releaseOne.releaseId}\n`)
  })
})

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test } from 'bun:test'
import { PublishWorkerError } from '../../../apps/studio/server/fuma/publishing/workerPublisher'
import { seededRuntimeRelease } from '../runtimeReleaseFixtures'
import { Site002LifecycleHarness } from './site-runtime-release.harness'

describe('FUMA-SITE-002 runtime release fault boundaries', () => {
  test('cancellation preserves the old active pointer and writes no new objects', async () => {
    const harness = new Site002LifecycleHarness()
    const first = seededRuntimeRelease(1)
    const second = seededRuntimeRelease(2)
    await harness.publish(first)
    const objectCount = harness.objects.size

    await expect(harness.publish(second, { cancelled: true })).rejects.toEqual(expect.objectContaining({ code: 'cancelled' }))
    expect(harness.activeReleaseId).toBe(first.releaseId)
    expect(harness.objects.size).toBe(objectCount)
    expect(harness.events).toContainEqual({ releaseId: second.releaseId, stage: 'cancelled' })
  })

  test('a pre-activation fault retries to the exact manifest and activates only after validation', async () => {
    const harness = new Site002LifecycleHarness()
    const first = seededRuntimeRelease(1)
    const second = seededRuntimeRelease(2)
    await harness.publish(first)

    await expect(harness.publish(second, {
      fault: async (boundary) => {
        if (boundary === 'before-activation') throw new Error('seeded activation fault')
      },
    })).rejects.toThrow('seeded activation fault')
    const readyManifest = structuredClone(harness.releases.get(second.releaseId)!.manifest)
    expect(harness.activeReleaseId).toBe(first.releaseId)

    const retried = await harness.publish(second)
    expect(retried).toEqual(readyManifest)
    expect(harness.activeReleaseId).toBe(second.releaseId)
    expect(harness.attempts.size).toBe(2)
  })

  test('cross-site projection failure closes before finalize and activation', async () => {
    const harness = new Site002LifecycleHarness()
    const first = seededRuntimeRelease(1)
    const second = seededRuntimeRelease(2)
    await harness.publish(first)
    const document = structuredClone(second.sourceSnapshot.document) as any
    document.draft.siteId = 'site_attacker'
    const hostile = { ...second, sourceSnapshot: { ...second.sourceSnapshot, document } }

    await expect(harness.publish(hostile)).rejects.toEqual(expect.objectContaining({ code: 'identity-mismatch' }))
    expect(harness.activeReleaseId).toBe(first.releaseId)
    expect(harness.releases.get(second.releaseId)?.manifest).toBeNull()
  })

  test('retained old component bytes remain readable after activation and rollback', async () => {
    const harness = new Site002LifecycleHarness()
    const first = seededRuntimeRelease(1)
    const second = seededRuntimeRelease(2)
    await harness.publish(first)
    harness.retain(first.releaseId)
    const oldHash = harness.runtimeSnapshot(first.releaseId).runtimeTreeHashSha256
    const oldPrivateVersion = harness.runtimeSnapshot(first.releaseId).components.find(({ execution }) => execution === 'private-declarative')!.reference.exactVersion

    await harness.publish(second)
    expect(harness.runtimeSnapshot(first.releaseId).runtimeTreeHashSha256).toBe(oldHash)
    expect(harness.runtimeSnapshot(first.releaseId).components.find(({ execution }) => execution === 'private-declarative')!.reference.exactVersion).toBe(oldPrivateVersion)

    harness.rollback(first.releaseId)
    expect(harness.activeReleaseId).toBe(first.releaseId)
    expect(harness.runtimeSnapshot(first.releaseId).runtimeTreeHashSha256).toBe(oldHash)
  })

  test('uses the AtomicPublishWorker cancellation error contract', () => {
    expect(new PublishWorkerError('cancelled', 'cancelled')).toMatchObject({ code: 'cancelled' })
  })
})

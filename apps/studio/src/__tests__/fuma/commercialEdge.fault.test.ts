import { describe, expect, it } from 'bun:test'
import {
  AtomicPublishWorker,
  PublishWorkerError,
  type PublishAttemptAuthority,
  type PublishExecutionContext,
} from '../../../server/fuma/publishing/workerPublisher'
import { RegistrarError, RegistrarService } from '../../../server/fuma/registrar/service'

const HASH = 'a'.repeat(64)
const scope = {
  platformId: 'p',
  organizationId: 'o',
  workspaceId: 'w',
  siteId: 's',
  ownerKey: 'k',
  generation: 1,
  state: 'active' as const,
  transferFence: null,
}
const job = {
  releaseId: 'r',
  sourceSnapshotId: 'snapshot-1',
  sourceSnapshotHashSha256: HASH,
  auditCorrelationId: 'audit-1',
}

const attempts: PublishAttemptAuthority = {
  exactAttemptId: () => 'attempt-1',
  async claimExact(claim) { return claim },
  async record() {},
}

function execution(
  durable: Map<string, unknown>,
  fault?: PublishExecutionContext['fault'],
): PublishExecutionContext {
  return {
    jobId: 'job-1',
    fence: '1',
    async cancellationRequested() { return false },
    async durableResult(key) { return durable.get(key) ?? null },
    async commitDurableResult(key, value) {
      const existing = durable.get(key)
      if (existing !== undefined) return existing
      durable.set(key, value)
      return value
    },
    fault,
  }
}

function worker(releases: Record<string, (...args: never[]) => unknown>) {
  return new AtomicPublishWorker({
    snapshots: {
      async claimExact() {
        return { id: 'snapshot-1', hashSha256: HASH, immutableRevision: '1', document: {} }
      },
    },
    renderer: {
      async *render() {
        yield {
          logicalPath: '/index.html',
          kind: 'html' as const,
          mimeType: 'text/html',
          bytes: new TextEncoder().encode('<!doctype html><html></html>'),
          references: [],
        }
      },
    },
    storage: {
      async put() {},
      async head() {
        return { key: '', sizeBytes: 0, mimeType: '', checksumSha256: '', createdAt: '' }
      },
    } as never,
    releases: releases as never,
    attempts,
    now: () => new Date('2026-07-26T00:00:00.000Z'),
  })
}

function releaseHarness() {
  let activated = 0
  let finalizedManifest: unknown = null
  let status: 'queued' | 'building' | 'ready' | 'active' = 'queued'
  return {
    get activated() { return activated },
    releases: {
      async queue() { return { status } },
      async startBuilding() {
        if (status === 'ready' || status === 'active') {
          return {
            status,
            buildClaim: { jobId: 'job-1', fence: '1' },
            manifest: finalizedManifest,
          }
        }
        status = 'building'
        return { status: 'building' }
      },
      async finalize(_scope: unknown, input: { manifest: unknown }) {
        finalizedManifest = input.manifest
        if (status !== 'active') status = 'ready'
      },
      async activate() {
        if (status !== 'active') activated += 1
        status = 'active'
        return { pointer: { version: 1 } }
      },
    },
  }
}

describe('FUMA commercial edge fault boundaries', () => {
  it.each([
    'after-claim',
    'after-render',
    'after-upload',
    'after-finalize',
    'before-activation',
  ] as const)('FUMA-049 fault %s leaves activation uncalled', async (boundary) => {
    const harness = releaseHarness()
    const publish = worker(harness.releases)
    await expect(publish.execute({ scope, profileId: 'website' }, job, execution(
      new Map(),
      async (at) => { if (at === boundary) throw new Error(`fault:${at}`) },
    ))).rejects.toThrow(`fault:${boundary}`)
    expect(harness.activated).toBe(0)
  })

  it('recovers a finalized manifest when the process dies before its durable result', async () => {
    const harness = releaseHarness()
    const publish = worker(harness.releases)
    const durable = new Map<string, unknown>()
    await expect(publish.execute(
      { scope, profileId: 'website' },
      job,
      execution(durable, async (at) => {
        if (at === 'after-finalize') throw new Error('process died after finalize')
      }),
    )).rejects.toThrow('process died after finalize')
    expect(durable.size).toBe(0)
    expect(harness.activated).toBe(0)

    await publish.execute({ scope, profileId: 'website' }, job, execution(durable))
    expect(harness.activated).toBe(1)
    expect(durable.size).toBe(2)
  })

  it('replays atomic activation after process death without a second pointer switch', async () => {
    const harness = releaseHarness()
    const publish = worker(harness.releases)
    const durable = new Map<string, unknown>()
    await expect(publish.execute(
      { scope, profileId: 'website' },
      job,
      execution(durable, async (at) => {
        if (at === 'after-activation-before-result') throw new Error('process died after activation')
      }),
    )).rejects.toThrow('process died after activation')
    expect(harness.activated).toBe(1)
    expect(durable.size).toBe(1)

    await publish.execute({ scope, profileId: 'website' }, job, execution(durable))
    expect(harness.activated).toBe(1)
    expect(durable.size).toBe(2)
  })

  it('FUMA-061 ambiguous registrar timeout fails closed until provider lookup reconciles', async () => {
    const service = new RegistrarService({
      async search() { return { available: true } },
      async quote() { throw new Error() },
      async purchase() { throw new Error('timeout') },
      async lookupByIdempotency() { return null },
      async renew() { throw new Error() },
    } as never, {
      async quote() {
        return {
          quoteId: 'q', provider: 'fake', hostname: 'example.co.ke', available: true,
          currency: 'KES', registrationAmountMinor: 100, renewalAmountMinor: 100,
          periodYears: 1, expiresAt: '2099-01-01T00:00:00.000Z',
          providerQuoteReference: 'p', termsHash: HASH,
        }
      },
      async saveQuote() {},
      async registrationForQuote() { return null },
      async saveRegistration(registration) { return registration },
    } as never, { async consume() { return true } }, async () => true)
    await expect(service.purchase({
      organizationId: 'o', quoteId: 'q', expectedAmountMinor: 100, currency: 'KES',
      contact: {
        name: 'N', email: 'n@example.test', phoneE164: '+254700000000',
        address: 'Nairobi', country: 'KE',
      },
      stepUpProof: 'proof',
    })).rejects.toBeInstanceOf(RegistrarError)
  })
})

describe('FUMA-049 durable publish retry boundary', () => {
  it('rejects an unvalidated durable manifest before activation', async () => {
    const harness = releaseHarness()
    const publish = worker(harness.releases)
    const durable = new Map<string, unknown>([[
      'fuma.publish-release:manifest:v1',
      { releaseId: 'foreign' },
    ]])
    await expect(publish.execute(
      { scope, profileId: 'website' },
      job,
      execution(durable),
    )).rejects.toBeInstanceOf(PublishWorkerError)
    expect(harness.activated).toBe(0)
  })

  it('rejects untrusted activation results without touching the pointer', async () => {
    const harness = releaseHarness()
    const publish = worker(harness.releases)
    const durable = new Map<string, unknown>()
    await expect(publish.execute(
      { scope, profileId: 'website' },
      job,
      execution(durable, async (boundary) => {
        if (boundary === 'before-activation') throw new Error('hold old pointer')
      }),
    )).rejects.toThrow('hold old pointer')
    durable.set('fuma.publish-release:activation:v1', { releaseId: 'foreign' })
    await expect(publish.execute(
      { scope, profileId: 'website' },
      job,
      execution(durable),
    )).rejects.toMatchObject({ code: 'untrusted-result' })
    expect(harness.activated).toBe(0)
  })

  it('does not reuse a durable result under another owner generation', async () => {
    const harness = releaseHarness()
    const publish = worker(harness.releases)
    const durable = new Map<string, unknown>()
    await expect(publish.execute(
      { scope, profileId: 'website' },
      job,
      execution(durable, async (boundary) => {
        if (boundary === 'before-activation') throw new Error('hold old generation')
      }),
    )).rejects.toThrow('hold old generation')
    await expect(publish.execute(
      { scope: { ...scope, generation: 2 }, profileId: 'website' },
      job,
      execution(durable),
    )).rejects.toMatchObject({ code: 'claim-mismatch' })
    expect(harness.activated).toBe(0)
  })
})

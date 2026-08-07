/**
 * Per-site publish state.
 *
 * Two properties decide whether this is correct, and they pull in opposite directions:
 * the SAME site must still serialize (ISS-038), and DIFFERENT sites must not. Both are asserted
 * by observing real interleaving rather than by inspecting structure.
 */

import { describe, it, expect, afterEach } from 'bun:test'
import {
  bumpPublishVersionFor,
  bumpPublishVersionForSerialized,
  publishVersionFor,
  resetSitePublishStateForTests,
  trackedSiteCount,
  withSitePublishLock,
} from '../../../server/publish/sitePublishState'

afterEach(() => { resetSitePublishStateForTests() })

/**
 * Let queued microtasks run.
 *
 * The lock releases its entry in a callback chained AFTER the caller's result, so it settles one
 * microtask turn later than the caller's `await`. That ordering is inherent — the release cannot
 * observe that nobody is waiting until the caller's continuation has run — so a test that asserts
 * release must yield first.
 */
async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

/** A promise plus its resolver, so a test can hold a publish open deliberately. */
function deferred(): Readonly<{ promise: Promise<void>, resolve: () => void }> {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((r) => { resolve = () => r() })
  return Object.freeze({ promise, resolve })
}

describe('versions are per site', () => {
  it('starts every site at zero', () => {
    expect(publishVersionFor('site-a')).toBe(0)
  })

  it('advances one site without touching another', () => {
    // The whole point: publishing site A must not invalidate site B's caches.
    bumpPublishVersionFor('site-a')
    bumpPublishVersionFor('site-a')
    expect(publishVersionFor('site-a')).toBe(2)
    expect(publishVersionFor('site-b')).toBe(0)
  })

  it('is monotonic per site', () => {
    const first = bumpPublishVersionFor('site-a')
    const second = bumpPublishVersionFor('site-a')
    expect(second).toBeGreaterThan(first)
  })

  it('never goes backwards across many bumps', () => {
    // A version that regressed would make entries cached at a higher version compare as NEWER
    // than current, so a site would serve retracted content with no way to flush it.
    let previous = publishVersionFor('site-a')
    for (let i = 0; i < 50; i += 1) {
      const next = bumpPublishVersionFor('site-a')
      expect(next).toBeGreaterThan(previous)
      previous = next
    }
  })

  it('does not release version entries', () => {
    // Eviction here is corruption, not tidiness: a recreated entry restarts at 0.
    bumpPublishVersionFor('site-a')
    bumpPublishVersionFor('site-b')
    expect(trackedSiteCount().versions).toBe(2)
  })
})

describe('the same site still serializes', () => {
  it('does not let two publishes of one site overlap', async () => {
    // ISS-038: overlapping read-version -> bake -> bump windows leave baked hole shells
    // permanently mis-stamped, and they are then served as stale.
    const order: string[] = []
    const first = deferred()

    const a = withSitePublishLock('site-a', async () => {
      order.push('a:start')
      await first.promise
      order.push('a:end')
    })
    const b = withSitePublishLock('site-a', async () => {
      order.push('b:start')
    })

    // b must not have begun while a is still open.
    await Promise.resolve()
    expect(order).toEqual(['a:start'])

    first.resolve()
    await Promise.all([a, b])
    expect(order).toEqual(['a:start', 'a:end', 'b:start'])
  })

  it('keeps serializing after a publish throws', async () => {
    // A failed publish must not wedge the chain, or one error stops the site publishing forever.
    const order: string[] = []
    const failing = withSitePublishLock('site-a', async () => {
      order.push('failed')
      throw new Error('publish blew up')
    })
    await expect(failing).rejects.toThrow('publish blew up')

    await withSitePublishLock('site-a', async () => { order.push('after') })
    expect(order).toEqual(['failed', 'after'])
  })

  it('serializes a serialized version bump against a publish', async () => {
    const order: string[] = []
    const held = deferred()
    const publish = withSitePublishLock('site-a', async () => {
      order.push('publish:start')
      await held.promise
      order.push('publish:end')
    })
    const bump = bumpPublishVersionForSerialized('site-a').then(() => { order.push('bump') })

    await Promise.resolve()
    expect(order).toEqual(['publish:start'])
    held.resolve()
    await Promise.all([publish, bump])
    expect(order).toEqual(['publish:start', 'publish:end', 'bump'])
  })
})

describe('different sites do not serialize', () => {
  it('runs two sites publishes concurrently', async () => {
    // This is what unblocks per-tenant builds: a build takes seconds, and there is no reason one
    // tenant should wait for another's.
    const order: string[] = []
    const held = deferred()

    const a = withSitePublishLock('site-a', async () => {
      order.push('a:start')
      await held.promise
      order.push('a:end')
    })
    const b = withSitePublishLock('site-b', async () => {
      order.push('b:start')
    })

    await b
    // B finished while A is still open — impossible under one global lock.
    expect(order).toContain('b:start')
    expect(order).not.toContain('a:end')

    held.resolve()
    await a
    expect(order).toEqual(['a:start', 'b:start', 'a:end'])
  })

  it('lets a slow site not delay a fast one', async () => {
    const held = deferred()
    const slow = withSitePublishLock('slow-site', async () => { await held.promise })
    let fastDone = false
    await withSitePublishLock('fast-site', async () => { fastDone = true })
    expect(fastDone).toBe(true)
    held.resolve()
    await slow
  })
})

describe('lock entries do not accumulate', () => {
  it('releases a site lock once nobody is waiting', async () => {
    // Versions are kept forever deliberately; lock chains are not, because a fresh chain behaves
    // identically to a settled one and holding one promise per site forever is a leak.
    await withSitePublishLock('site-a', async () => {})
    await withSitePublishLock('site-b', async () => {})
    await flush()
    expect(trackedSiteCount().locks).toBe(0)
  })

  it('keeps the entry while a publish is still queued', async () => {
    const held = deferred()
    const a = withSitePublishLock('site-a', async () => { await held.promise })
    const b = withSitePublishLock('site-a', async () => {})
    expect(trackedSiteCount().locks).toBe(1)
    held.resolve()
    await Promise.all([a, b])
  })

  it('still serializes correctly after an entry was released and recreated', async () => {
    const order: string[] = []
    await withSitePublishLock('site-a', async () => { order.push('one') })
    await flush()
    expect(trackedSiteCount().locks).toBe(0)

    const held = deferred()
    const second = withSitePublishLock('site-a', async () => {
      order.push('two:start')
      await held.promise
      order.push('two:end')
    })
    const third = withSitePublishLock('site-a', async () => { order.push('three') })
    await Promise.resolve()
    expect(order).toEqual(['one', 'two:start'])
    held.resolve()
    await Promise.all([second, third])
    expect(order).toEqual(['one', 'two:start', 'two:end', 'three'])
  })
})

describe('the result of the publish reaches the caller', () => {
  it('returns the value the operation produced', async () => {
    expect(await withSitePublishLock('site-a', async () => 'published')).toBe('published')
  })

  it('bumps the version through the serialized helper', async () => {
    await bumpPublishVersionForSerialized('site-a')
    expect(publishVersionFor('site-a')).toBe(1)
  })
})

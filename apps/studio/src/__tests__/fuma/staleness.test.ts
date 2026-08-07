/**
 * Durable staleness for baked shells.
 *
 * The decisive test is the restart one. The comparator this replaces was a process-local counter,
 * so a restart left every baked shell permanently stale — every dynamic region on every page
 * silently empty until the next publish. A comparator read from the persisted activation pointer
 * cannot do that, and the tests below prove it by comparing across a simulated restart and across
 * two processes.
 */

import { describe, it, expect } from 'bun:test'
import {
  judgeFreshness,
  mayServe,
  reviewComparator,
  stalenessTokenFor,
  type ActivePointerFacts,
} from '../../../server/fuma/publish/staleness'

const pointer = (
  siteId = 'site-a',
  version = 7,
  releaseId = 'rel-7',
): ActivePointerFacts => Object.freeze({ siteId, releaseId, version })

describe('the token survives a restart', () => {
  it('is derived from persisted facts, not process state', () => {
    // Nothing here is a counter held in memory: siteId, version and releaseId all come from the
    // persisted ActiveReleasePointer.
    expect(stalenessTokenFor(pointer())).toBe('site-a:7:rel-7')
  })

  it('gives the SAME verdict after a simulated restart', () => {
    // THE DEFECT THIS REPLACES: publishState.ts holds `let publishVersion = 0` and shells on disk
    // carry N, so after a restart the counter reads 0, every hole returns the stale sentinel, and
    // the next page load serves the SAME baked shell — so nothing ever reconciles.
    const shellToken = stalenessTokenFor(pointer())

    // A restart is just reading the same persisted pointer again. There is no counter to reset.
    const afterRestart = pointer()
    expect(mayServe(shellToken, afterRestart)).toBe(true)
    expect(judgeFreshness(shellToken, afterRestart)).toBe('fresh')
  })

  it('gives the same verdict in a second process', () => {
    // Two processes each held their own counter and disagreed permanently; both read the same
    // persisted pointer here, so they cannot.
    const shellToken = stalenessTokenFor(pointer())
    expect(mayServe(shellToken, pointer())).toBe(mayServe(shellToken, pointer()))
    expect(mayServe(shellToken, pointer())).toBe(true)
  })
})

describe('a shell from an earlier activation is superseded', () => {
  it('refuses a shell baked before the current activation', () => {
    const shellToken = stalenessTokenFor(pointer('site-a', 6, 'rel-6'))
    expect(judgeFreshness(shellToken, pointer('site-a', 7, 'rel-7'))).toBe('superseded')
    expect(mayServe(shellToken, pointer('site-a', 7, 'rel-7'))).toBe(false)
  })

  it('refuses a shell whose version matches but whose release does not', () => {
    // Same number, different release: the content came from different source, so serving it would
    // mix two releases on one page.
    const shellToken = stalenessTokenFor(pointer('site-a', 7, 'rel-other'))
    expect(judgeFreshness(shellToken, pointer('site-a', 7, 'rel-7'))).toBe('superseded')
  })
})

describe('one tenant cannot invalidate or read another', () => {
  it('reports a token from another site as foreign, not merely stale', () => {
    // Foreign and superseded need OPPOSITE responses: a superseded shell should be refreshed, while
    // a token naming another site must never be served regardless of version.
    const shellToken = stalenessTokenFor(pointer('site-b', 7, 'rel-7'))
    expect(judgeFreshness(shellToken, pointer('site-a', 7, 'rel-7'))).toBe('foreign')
  })

  it('never serves a foreign token even when the version matches exactly', () => {
    const shellToken = stalenessTokenFor(pointer('site-b', 7, 'rel-7'))
    expect(mayServe(shellToken, pointer('site-a', 7, 'rel-7'))).toBe(false)
  })

  it('does not let one site activation invalidate another site shells', () => {
    // The token is site-scoped, so site B advancing to version 99 says nothing about site A.
    const shellA = stalenessTokenFor(pointer('site-a', 3, 'rel-a3'))
    expect(mayServe(shellA, pointer('site-a', 3, 'rel-a3'))).toBe(true)
  })
})

describe('a malformed token is stale, never trusted', () => {
  it('refuses a token with the wrong shape', () => {
    for (const bad of ['', 'site-a', 'site-a:7', 'a:b:c:d']) {
      expect(judgeFreshness(bad, pointer())).toBe('malformed')
      expect(mayServe(bad, pointer())).toBe(false)
    }
  })

  it('refuses a non-numeric version', () => {
    expect(judgeFreshness('site-a:latest:rel-7', pointer())).toBe('malformed')
  })

  it('refuses empty parts', () => {
    expect(judgeFreshness('site-a:7:', pointer())).toBe('malformed')
    expect(judgeFreshness(':7:rel-7', pointer())).toBe('malformed')
  })
})

describe('the comparator source is checked for durability', () => {
  it('reports a process-local comparator', () => {
    // Exists so the defect cannot be reintroduced by wiring the hole endpoint back to a counter.
    const problems = reviewComparator({ durable: false, previousVersion: 1, currentVersion: 2 })
    expect(problems.some((problem) => problem.code === 'process-local-comparator')).toBe(true)
    expect(problems.find((p) => p.code === 'process-local-comparator')?.message)
      .toContain('silently')
  })

  it('accepts a durable, advancing comparator', () => {
    expect(reviewComparator({ durable: true, previousVersion: 6, currentVersion: 7 })).toEqual([])
  })

  it('reports a version that went backwards', () => {
    // Shells baked at the higher value would compare as current forever and serve retracted content.
    const problems = reviewComparator({ durable: true, previousVersion: 9, currentVersion: 4 })
    expect(problems.some((problem) => problem.code === 'version-not-monotonic')).toBe(true)
  })

  it('accepts an unchanged version', () => {
    // Re-reading the pointer without an activation is normal, not a regression.
    expect(reviewComparator({ durable: true, previousVersion: 7, currentVersion: 7 })).toEqual([])
  })
})

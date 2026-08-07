/**
 * Task 57: the dynamic content strategy per route.
 *
 * The decision is driven by the causes the EXISTING detector already reports, so there is one
 * definition of what makes a route dynamic.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_REVALIDATE_SECONDS,
  causeFromReason,
  causesFromReasons,
  reviewStrategy,
  strategyFor,
  factsFromDetection,
  strategyFromDetection,
  type RouteFacts,
} from '../../core/react-ir/routeStrategy'

function facts(overrides: Partial<RouteFacts> = {}): RouteFacts {
  return Object.freeze({
    routePath: 'app/page.tsx',
    causes: [],
    perVisitorRegionsAreIsolable: false,
    revalidateSeconds: null,
    ...overrides,
  })
}

describe('a route with nothing varying is static', () => {
  it('chooses static', () => {
    expect(strategyFor(facts()).strategy).toBe('static')
  })

  it('emits NO segment config', () => {
    // `revalidate = false` says what Next already does, and invites somebody to change it to a
    // number by mistake.
    expect(strategyFor(facts()).segmentConfig).toHaveLength(0)
  })

  it('is cacheable across visitors', () => {
    expect(strategyFor(facts()).cacheableAcrossVisitors).toBe(true)
  })
})

describe('time-varying content is revalidated, not made dynamic', () => {
  it('chooses revalidated', () => {
    const decided = strategyFor(facts({ causes: ['time-varying'] }))
    expect(decided.strategy).toBe('revalidated')
  })

  it('emits an EXPLICIT revalidate window', () => {
    // Next's own default has changed between versions; a route whose freshness depends on which
    // version built it is one nobody can reason about.
    const decided = strategyFor(facts({ causes: ['time-varying'] }))
    expect(decided.segmentConfig).toEqual([`export const revalidate = ${DEFAULT_REVALIDATE_SECONDS}`])
  })

  it('honours a caller window', () => {
    const decided = strategyFor(facts({ causes: ['time-varying'], revalidateSeconds: 300 }))
    expect(decided.segmentConfig).toEqual(['export const revalidate = 300'])
  })

  it('the default window is short enough to be useful and long enough to be sane', () => {
    expect(DEFAULT_REVALIDATE_SECONDS).toBeGreaterThanOrEqual(10)
    expect(DEFAULT_REVALIDATE_SECONDS).toBeLessThanOrEqual(3_600)
  })
})

describe('per-visitor content is never written to a shared cache', () => {
  it('a shell with ISOLABLE personalised regions keeps the page cached', () => {
    // Making the WHOLE route dynamic because one corner is personalised throws away caching for
    // every visitor and every part of the page that never varied - the commonest way a fast site
    // becomes slow. This is the shape the old publisher already used.
    const decided = strategyFor(facts({ causes: ['per-visitor'], perVisitorRegionsAreIsolable: true }))
    expect(decided.strategy).toBe('static-shell-with-islands')
  })

  it('the shell is shareable precisely BECAUSE the personalised parts are not in it', () => {
    const decided = strategyFor(facts({ causes: ['per-visitor'], perVisitorRegionsAreIsolable: true }))
    expect(decided.cacheableAcrossVisitors).toBe(true)
    expect(decided.reason).toContain('per request')
  })

  it('NON-isolable per-visitor content forces the whole route dynamic', () => {
    // A personalised heading woven through static prose has no boundary to draw, so there is
    // nothing safe to cache.
    const decided = strategyFor(facts({ causes: ['per-visitor'], perVisitorRegionsAreIsolable: false }))
    expect(decided.strategy).toBe('dynamic')
    expect(decided.segmentConfig).toEqual(["export const dynamic = 'force-dynamic'"])
  })

  it('and that route is NOT cacheable across visitors', () => {
    // If it were, one visitor's personalised page would reach another - the same class of defect
    // as the unscoped render cache, and just as invisible.
    const decided = strategyFor(facts({ causes: ['per-visitor'], perVisitorRegionsAreIsolable: false }))
    expect(decided.cacheableAcrossVisitors).toBe(false)
  })

  it('per-visitor OUTRANKS time-varying', () => {
    // Otherwise a page that is both would be put on a timer and shared.
    const decided = strategyFor(facts({ causes: ['time-varying', 'per-visitor'], perVisitorRegionsAreIsolable: false }))
    expect(decided.strategy).toBe('dynamic')
  })
})

describe('request-dependent but not per-visitor', () => {
  it('is dynamic yet still shareable between identical requests', () => {
    // It cannot be a build-time file, but two identical requests may legitimately share a response.
    const decided = strategyFor(facts({ causes: ['request-dependent'] }))
    expect(decided.strategy).toBe('dynamic')
    expect(decided.cacheableAcrossVisitors).toBe(true)
  })

  it('outranks time-varying', () => {
    const decided = strategyFor(facts({ causes: ['time-varying', 'request-dependent'] }))
    expect(decided.strategy).toBe('dynamic')
  })
})

describe('the review catches combinations that work in development and fail in production', () => {
  it('flags personalised content in a shared cache', () => {
    // Constructed deliberately: the most dangerous combination there is.
    const bad = Object.freeze({ strategy: 'revalidated' as const, segmentConfig: [], reason: '', cacheableAcrossVisitors: true })
    const problems = reviewStrategy(facts({ causes: ['per-visitor'] }), bad)
    expect(problems.map((p) => p.code)).toContain('personalised-content-in-shared-cache')
    expect(problems[0]!.message).toContain('another visitor')
  })

  it('flags a revalidate window that is not a duration', () => {
    const decided = strategyFor(facts({ causes: ['time-varying'], revalidateSeconds: 0 }))
    const problems = reviewStrategy(facts({ causes: ['time-varying'], revalidateSeconds: 0 }), decided)
    expect(problems.map((p) => p.code)).toContain('revalidate-not-a-duration')
  })

  it('flags a route forced dynamic with nothing dynamic in it', () => {
    // It pays the per-request cost forever and the reason is not in the file.
    const forced = Object.freeze({ strategy: 'dynamic' as const, segmentConfig: [], reason: '', cacheableAcrossVisitors: true })
    expect(reviewStrategy(facts(), forced).map((p) => p.code)).toContain('dynamic-without-cause')
  })

  it('flags islands chosen when the regions are not isolable', () => {
    const wrong = Object.freeze({ strategy: 'static-shell-with-islands' as const, segmentConfig: [], reason: '', cacheableAcrossVisitors: true })
    expect(reviewStrategy(facts({ causes: ['per-visitor'] }), wrong).map((p) => p.code)).toContain('islands-not-isolable')
  })

  it('reports NOTHING for each strategy its own decision produced', () => {
    // A review that flags its own correct output would be switched off.
    for (const f of [
      facts(),
      facts({ causes: ['time-varying'] }),
      facts({ causes: ['request-dependent'] }),
      facts({ causes: ['per-visitor'], perVisitorRegionsAreIsolable: true }),
      facts({ causes: ['per-visitor'], perVisitorRegionsAreIsolable: false }),
    ]) {
      expect(reviewStrategy(f, strategyFor(f))).toHaveLength(0)
    }
  })
})

describe('causes are read from the existing detector vocabulary', () => {
  it('recognises per-visitor', () => {
    // The exact wording dynamicDetection.ts already produces.
    expect(causeFromReason('node "x": loop source "y" is per-visitor')).toBe('per-visitor')
  })

  it('recognises request-dependent', () => {
    expect(causeFromReason('node "x": loop source "y" is request-dependent')).toBe('request-dependent')
  })

  it('treats an UNRECOGNISED reason as request-dependent, not static', () => {
    // Assuming static would cache something that varies - the failure that reaches visitors.
    // Assuming request-dependent only costs speed.
    expect(causeFromReason('node "x": module is flagged dynamic')).toBe('request-dependent')
  })

  it('collapses many reasons into distinct causes ordered by consequence', () => {
    const causes = causesFromReasons([
      'node "a": loop source is request-dependent',
      'node "b": loop source is per-visitor',
      'node "c": loop source is request-dependent',
    ])
    expect(causes).toEqual(['per-visitor', 'request-dependent'])
  })

  it('is deterministic regardless of input order', () => {
    const forward = causesFromReasons(['is per-visitor', 'is request-dependent'])
    const backward = causesFromReasons(['is request-dependent', 'is per-visitor'])
    expect(forward).toEqual(backward)
  })

  it('no reasons means no causes, so the route stays static', () => {
    expect(causesFromReasons([])).toHaveLength(0)
  })
})

describe('the detector this consumes really uses those words', () => {
  it('dynamicDetection.ts reports per-visitor and request-dependent', () => {
    // Asserted against the SHIPPED detector rather than assumed, so a change to its wording
    // surfaces here rather than silently downgrading every route to request-dependent.
    const source = readFileSync(
      join(import.meta.dir, '..', '..', 'core', 'publisher', 'dynamicDetection.ts'),
      'utf8',
    )
    expect(source).toContain("'per-visitor'")
    expect(source).toContain("'request-dependent'")
  })
})

describe('the decision is derived from the detector output', () => {
  it('no dynamic nodes and no reasons means static', () => {
    const decided = strategyFromDetection('app/page.tsx', {
      dynamicPageNodeIds: new Set(),
      reasons: [],
    })
    expect(decided.strategy).toBe('static')
  })

  it('a per-visitor reason WITH a node id keeps a cached shell', () => {
    // Every id the detector returns is a node the publisher already renders as its own
    // placeholder - that is what a hole IS - so the boundary exists by construction.
    const decided = strategyFromDetection('app/page.tsx', {
      dynamicPageNodeIds: new Set(['greeting']),
      reasons: ['node "greeting": loop source "viewer" is per-visitor'],
    })
    expect(decided.strategy).toBe('static-shell-with-islands')
  })

  it('a per-visitor reason with NO node id forces the whole route dynamic', () => {
    // Reasons with nothing to attach them to mean the variation is not confined to a placeholder,
    // so there is nothing safe to cache around it.
    const decided = strategyFromDetection('app/page.tsx', {
      dynamicPageNodeIds: new Set(),
      reasons: ['node "x": loop source "viewer" is per-visitor'],
    })
    expect(decided.strategy).toBe('dynamic')
    expect(decided.cacheableAcrossVisitors).toBe(false)
  })

  it('ISOLABILITY IS DERIVED, not taken as a caller claim', () => {
    // Taking it as a claim would let somebody assert it for a route where it is false, and the
    // consequence of that mistake is personalised content in a shared cache.
    expect(factsFromDetection('app/page.tsx', { dynamicPageNodeIds: new Set(['a']), reasons: [] })
      .perVisitorRegionsAreIsolable).toBe(true)
    expect(factsFromDetection('app/page.tsx', { dynamicPageNodeIds: new Set(), reasons: [] })
      .perVisitorRegionsAreIsolable).toBe(false)
  })

  it('carries a caller revalidate window through', () => {
    const decided = strategyFromDetection('app/blog/page.tsx', {
      dynamicPageNodeIds: new Set(),
      reasons: [],
    }, 120)
    // Nothing varies, so the window is irrelevant and no config is emitted - a revalidate on a
    // route with nothing to revalidate is noise a reader has to explain away.
    expect(decided.strategy).toBe('static')
    expect(decided.segmentConfig).toHaveLength(0)
  })
})

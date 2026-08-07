/**
 * The rendering strategy for one route, decided from what the route actually contains.
 *
 * Next offers three ways to render a route and they are not interchangeable:
 *  - STATIC: rendered at build time, served as a file. Fastest, and wrong the moment the content
 *    depends on the request.
 *  - REVALIDATED (ISR): rendered at build time, re-rendered on a timer. Right for content that
 *    changes without depending on WHO is asking.
 *  - DYNAMIC: rendered per request. Necessary when the answer differs per visitor, and the most
 *    expensive thing a route can be.
 *
 * The old publisher answered a related question with a different vocabulary: it baked a static
 * shell and left "holes" that were filled at request time. That shape is worth preserving rather
 * than replacing, and the reason is in `strategyFor` below.
 *
 * The facts come from the EXISTING detector (core/publisher/dynamicDetection.ts), which already
 * separates `per-visitor` from merely `request-dependent`. Re-deriving that here would create a
 * second definition of dynamic, and the two would disagree about some route nobody is looking at.
 */

/** Why a route cannot simply be static. Ordered from cheapest to most expensive consequence. */
export type DynamicCause =
  /** Content changes over time but not per visitor - a post list, a price table. */
  | 'time-varying'
  /** The answer depends on the request itself: a search query, a header, a cookie. */
  | 'request-dependent'
  /** The answer differs per visitor: a signed-in name, a cart, a personalised list. */
  | 'per-visitor'

export type RouteStrategy = 'static' | 'revalidated' | 'dynamic' | 'static-shell-with-islands'

export type RouteFacts = Readonly<{
  routePath: string
  /** Every cause found in the route's tree, from the shared detector. */
  causes: readonly DynamicCause[]
  /**
   * Whether the per-visitor parts are CONFINED to regions that can render on their own.
   *
   * This is what lets a page keep a cached shell: if the personalised part is a self-contained
   * region, only that region needs to be per-request. If it is woven through the page - a
   * personalised heading inside otherwise static prose - there is no boundary to draw.
   */
  perVisitorRegionsAreIsolable: boolean
  /** Seconds between rebuilds for time-varying content, or null to let the decision choose. */
  revalidateSeconds: number | null
}>

export type StrategyDecision = Readonly<{
  strategy: RouteStrategy
  /** The exact segment config to emit, or null when the route needs none. */
  segmentConfig: readonly string[]
  reason: string
  /** True when a response for this route may be shared between two visitors. */
  cacheableAcrossVisitors: boolean
}>

/**
 * The default revalidation window.
 *
 * Stated rather than left implicit, because Next's own default has changed between versions and a
 * route whose freshness depends on which version built it is a route nobody can reason about.
 * One minute is short enough that an editor sees their change without being told to wait, and long
 * enough that a busy site is not rebuilding the same page continuously.
 */
export const DEFAULT_REVALIDATE_SECONDS = 60

/**
 * THE RULE THAT MATTERS MOST: a per-visitor region must never be served from a shared cache.
 *
 * If it is, one visitor's personalised content reaches another - the same class of defect as the
 * unscoped render cache, and just as invisible, because both responses are valid HTML for that
 * path. So `cacheableAcrossVisitors` is false whenever anything per-visitor remains in the cached
 * output, and the strategy that keeps a shell cached is chosen ONLY when the per-visitor parts have
 * been moved out of it.
 */
export function strategyFor(facts: RouteFacts): StrategyDecision {
  const perVisitor = facts.causes.includes('per-visitor')
  const requestDependent = facts.causes.includes('request-dependent')
  const timeVarying = facts.causes.includes('time-varying')

  if (perVisitor) {
    if (facts.perVisitorRegionsAreIsolable) {
      // The shape the old publisher already used, and it is the right one: keep the page cached
      // and render only the personalised region per request. Making the WHOLE route dynamic
      // because one corner is personalised throws away caching for every visitor and for every
      // part of the page that never varied - and it is the commonest way a fast site becomes slow.
      return decision(
        'static-shell-with-islands',
        [],
        'Personalised regions render per request inside an otherwise cached page.',
        // The SHELL is shared, and that is safe precisely because the personalised parts are not
        // in it. The islands themselves are not cached across visitors.
        true,
      )
    }
    return decision(
      'dynamic',
      ["export const dynamic = 'force-dynamic'"],
      'Per-visitor content is not confined to a separable region, so the whole route must render per request.',
      false,
    )
  }

  if (requestDependent) {
    // Depends on the request but not on the visitor. It still cannot be a build-time file, but two
    // identical requests may legitimately share a response.
    return decision(
      'dynamic',
      ["export const dynamic = 'force-dynamic'"],
      'Content depends on the request, so it cannot be rendered at build time.',
      true,
    )
  }

  if (timeVarying) {
    const seconds = facts.revalidateSeconds ?? DEFAULT_REVALIDATE_SECONDS
    return decision(
      'revalidated',
      [`export const revalidate = ${seconds}`],
      `Content changes over time but not per visitor, so it is rebuilt every ${seconds} seconds.`,
      true,
    )
  }

  // Nothing varies. A static route needs NO segment config: emitting `revalidate = false` says the
  // same thing Next already does and invites somebody to change it to a number by mistake.
  return decision('static', [], 'Nothing in this route varies, so it is served as a file.', true)
}

function decision(
  strategy: RouteStrategy,
  segmentConfig: readonly string[],
  reason: string,
  cacheableAcrossVisitors: boolean,
): StrategyDecision {
  return Object.freeze({ strategy, segmentConfig: Object.freeze([...segmentConfig]), reason, cacheableAcrossVisitors })
}

/**
 * Problems worth reporting rather than silently accepting.
 *
 * Each of these produces a route that WORKS in development and is wrong in production, which is
 * the class of defect that reaches customers.
 */
export type StrategyProblem = Readonly<{ code: string, message: string }>

export function reviewStrategy(facts: RouteFacts, decided: StrategyDecision): readonly StrategyProblem[] {
  const problems: StrategyProblem[] = []

  if (facts.causes.includes('per-visitor') && decided.strategy === 'revalidated') {
    // The most dangerous combination there is: a personalised page written to a shared cache.
    problems.push({
      code: 'personalised-content-in-shared-cache',
      message: 'This route contains per-visitor content and is being cached for everyone. One visitor would be served another visitor\'s page.',
    })
  }

  if (decided.strategy === 'revalidated' && facts.revalidateSeconds !== null && facts.revalidateSeconds <= 0) {
    // Zero means "never cache" in some places and "always revalidate" in others; either way it is
    // not a duration, and a reader cannot tell which was intended.
    problems.push({
      code: 'revalidate-not-a-duration',
      message: 'A revalidate window of zero or less is not a duration. Use a positive number of seconds, or choose the dynamic strategy deliberately.',
    })
  }

  if (decided.strategy === 'dynamic' && facts.causes.length === 0) {
    // A route forced dynamic with nothing dynamic in it pays the per-request cost forever and
    // nobody can tell why, because the reason is not in the file.
    problems.push({
      code: 'dynamic-without-cause',
      message: 'This route renders per request but nothing in it varies. It will be slow for no reason anybody reading it can see.',
    })
  }

  if (decided.strategy === 'static-shell-with-islands' && !facts.perVisitorRegionsAreIsolable) {
    problems.push({
      code: 'islands-not-isolable',
      message: 'A cached shell was chosen but the per-visitor content is not confined to a separable region, so personalised content would be baked into the shared page.',
    })
  }

  return Object.freeze(problems)
}

/**
 * Maps the existing detector's reason strings onto causes.
 *
 * The detector reports human-readable reasons for diagnostics; this reads the two vocabulary words
 * it already uses ('per-visitor' and 'request-dependent') so there is ONE source of truth about
 * what makes a route dynamic. An unrecognised reason is treated as 'request-dependent' rather than
 * ignored: assuming static would cache something that varies, which is the failure that reaches
 * visitors, whereas assuming request-dependent only costs speed.
 */
export function causeFromReason(reason: string): DynamicCause {
  if (reason.includes('per-visitor')) return 'per-visitor'
  if (reason.includes('request-dependent')) return 'request-dependent'
  return 'request-dependent'
}

/** Collapses many detector reasons into the distinct causes a route carries. */
export function causesFromReasons(reasons: readonly string[]): readonly DynamicCause[] {
  const seen = new Set<DynamicCause>()
  for (const reason of reasons) seen.add(causeFromReason(reason))
  // Ordered by consequence so a reader sees the most expensive cause first, and so two routes with
  // the same causes always report them identically.
  const order: readonly DynamicCause[] = ['per-visitor', 'request-dependent', 'time-varying']
  return Object.freeze(order.filter((cause) => seen.has(cause)))
}

/**
 * The detector's own output shape, consumed structurally.
 *
 * Taken by structure rather than by import because findDynamicNodesWithReasons is private to
 * dynamicDetection.ts - exporting it to satisfy this file would widen that module's surface for
 * one caller's convenience.
 */
export type DetectedDynamics = Readonly<{
  dynamicPageNodeIds: ReadonlySet<string>
  reasons: readonly string[]
}>

/**
 * Derives the route facts from what the detector found.
 *
 * THE FINDING THAT MAKES ISOLABILITY DERIVABLE RATHER THAN ASSERTED: every id in
 * `dynamicPageNodeIds` is a node the old publisher already renders as its own placeholder - that is
 * precisely what a hole IS. So a dynamic region is separable by construction, because the existing
 * architecture already draws a boundary around it. Isolability is therefore true whenever the
 * detector produced any node ids at all, and false when it reported reasons with no node to attach
 * them to - which is the case where the variation is not confined to a placeholder and there is
 * nothing safe to cache around.
 *
 * Taking it as a caller's claim instead would let somebody assert isolability for a route where it
 * is false, and the consequence of that mistake is personalised content in a shared cache.
 */
export function factsFromDetection(
  routePath: string,
  detected: DetectedDynamics,
  revalidateSeconds: number | null = null,
): RouteFacts {
  return Object.freeze({
    routePath,
    causes: causesFromReasons(detected.reasons),
    perVisitorRegionsAreIsolable: detected.dynamicPageNodeIds.size > 0,
    revalidateSeconds,
  })
}

/** The whole decision for a route, from the detector's output to the segment config to emit. */
export function strategyFromDetection(
  routePath: string,
  detected: DetectedDynamics,
  revalidateSeconds: number | null = null,
): StrategyDecision {
  return strategyFor(factsFromDetection(routePath, detected, revalidateSeconds))
}

/**
 * Puts a route's chosen segment config into the module's preamble, which is what the generator emits.
 *
 * THIS IS THE CONSUMPTION STEP TASK 57 LEFT OPEN. The decision existed and was tested, and nothing
 * emitted it - so every generated route ran on Next's own default, which has changed between versions
 * and therefore makes a route's freshness depend on which version built it.
 *
 * The preamble is the right carrier rather than a new field, for the reason task 46 already
 * established: `export const revalidate = 60` is PLAIN TYPESCRIPT needing no type augmentation,
 * whereas `next: { revalidate }` on fetch is a Next augmentation of RequestInit that fails a tenant's
 * own typecheck on a fresh checkout. Task 50 built the preamble to preserve exactly this kind of
 * top-level statement.
 */
export function withSegmentConfig<T extends { preamble?: readonly string[] }>(
  module: T,
  decision: StrategyDecision,
): T {
  if (decision.segmentConfig.length === 0) return module
  const existing = module.preamble ?? []
  // A config already present is REPLACED rather than appended: two `export const revalidate`
  // statements in one file is a duplicate-identifier error, so appending would produce a module that
  // cannot build - worse than the default it was trying to correct.
  const kept = existing.filter((statement) => !isSegmentConfigStatement(statement))
  return Object.freeze({ ...module, preamble: Object.freeze([...kept, ...decision.segmentConfig]) })
}

/** The segment-config statements Next recognises, so a replacement removes only its own kind. */
const SEGMENT_CONFIG_NAMES = ['revalidate', 'dynamic', 'fetchCache', 'runtime', 'preferredRegion'] as const

export function isSegmentConfigStatement(statement: string): boolean {
  return SEGMENT_CONFIG_NAMES.some((name) =>
    new RegExp(`^\\s*export\\s+const\\s+${name}\\s*=`).test(statement))
}

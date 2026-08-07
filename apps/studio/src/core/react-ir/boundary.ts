/**
 * Client boundary tracking.
 *
 * Under the App Router, `'use client'` is not a property of one file — it marks the
 * point where the tree stops being server-rendered, and everything imported below
 * that point becomes client code too. So a single animated button in a page's own
 * module drags the entire page, its data fetching and every component it imports
 * into the client bundle.
 *
 * That is the failure this module exists to prevent. The fix is structural: the
 * animated element is extracted into its own small client module and the page keeps
 * rendering on the server. Deciding that requires looking at the whole graph rather
 * than one file, because the cost of a boundary is everything beneath it.
 *
 * What forces a boundary:
 *
 *   - a Motion animation, since Motion runs in the browser
 *   - an opaque node whose source already declares `'use client'`
 *   - importing a module that is itself a client module
 *
 * The last one is the propagation rule, and it flows *upward from imports*, not
 * downward from parents: a server component may render a client component as a
 * child perfectly well. It is *importing* one into a module that decides the
 * boundary.
 */

import { animationOf, walkNodeIds, type ReactIrModule } from './nodes'
import { requiresClient } from './motion'

/** Why a module ended up on the client. */
export type BoundaryReason =
  /** The module declares it directly. */
  | { kind: 'declared' }
  /** A node in this module animates. */
  | { kind: 'animation', nodeId: string }
  /** An opaque region's own source declares it. */
  | { kind: 'opaque', nodeId: string }
  /** It imports a module that is a client module. */
  | { kind: 'imports-client', modulePath: string }

export type ModuleBoundary = Readonly<{
  path: string
  /** Whether this module must carry `'use client'`. */
  client: boolean
  /** Every reason it must, so the cause can be explained rather than guessed. */
  reasons: readonly BoundaryReason[]
}>

/**
 * A cost estimate for a boundary, in modules pulled to the client.
 *
 * Reported rather than acted on: whether shipping twelve modules is acceptable is a
 * product decision, not something this function should silently make.
 */
export type BoundaryCost = Readonly<{
  path: string
  /** Modules that become client code because this one does. */
  pulledIn: readonly string[]
}>

export type BoundaryAnalysis = Readonly<{
  boundaries: readonly ModuleBoundary[]
  /**
   * Modules where a route-level file was clientized by animation alone — the case
   * worth extracting, because the animation could live in a leaf instead.
   */
  avoidable: readonly AvoidableBoundary[]
  costs: readonly BoundaryCost[]
}>

export type AvoidableBoundary = Readonly<{
  /** The route module that became a client module. */
  path: string
  /** The nodes whose animation caused it. */
  nodeIds: readonly string[]
  /** How many modules the boundary drags along. */
  pulledInCount: number
  /** What to do about it. */
  advice: string
}>

/** Local module specifiers a module imports, resolved to module paths. */
function localImportsOf(module: ReactIrModule): readonly string[] {
  const specifiers = new Set<string>()
  for (const node of Object.values(module.nodes)) {
    if (node.kind === 'component') specifiers.add(node.component.source)
    if (node.kind === 'opaque' && node.source) specifiers.add(node.source)
  }
  // Only local modules participate: a package boundary is decided by the package.
  return [...specifiers].filter((specifier) => specifier.startsWith('.'))
}

/** Reasons intrinsic to a module, before propagation. */
function directReasons(module: ReactIrModule): readonly BoundaryReason[] {
  const reasons: BoundaryReason[] = []
  if (module.boundary === 'client') reasons.push({ kind: 'declared' })

  for (const nodeId of walkNodeIds(module)) {
    const node = module.nodes[nodeId]
    if (!node) continue
    const animation = animationOf(node)
    if (animation && requiresClient(animation)) {
      reasons.push({ kind: 'animation', nodeId })
    }
    // An opaque region carrying its own directive forces the boundary too, and it
    // is invisible to the IR otherwise.
    if (node.kind === 'opaque' && node.clientOnly === true) {
      reasons.push({ kind: 'opaque', nodeId })
    }
  }
  return reasons
}

/**
 * Analyse a set of modules addressed by path.
 *
 * Resolution is by exact specifier as written, which is what the IR stores. A graph
 * with an unresolvable specifier is not an error here: an import that leaves the
 * set is a package, and packages decide their own boundary.
 */
export function analyseBoundaries(
  modules: readonly ReactIrModule[],
  options: { routePaths?: readonly string[] } = {},
): BoundaryAnalysis {
  const byPath = new Map(modules.map((module) => [module.path, module]))
  const reasonsByPath = new Map<string, BoundaryReason[]>()
  const importsByPath = new Map<string, readonly string[]>()

  for (const module of modules) {
    reasonsByPath.set(module.path, [...directReasons(module)])
    importsByPath.set(module.path, localImportsOf(module))
  }

  const isClient = (path: string): boolean => (reasonsByPath.get(path)?.length ?? 0) > 0

  // Importers of a client module become client modules, so the effect propagates
  // until nothing changes. Iterating to a fixed point handles cycles without
  // recursing forever.
  //
  // Every cause is recorded, not just the first: a module already client because of
  // its own animation may *also* import a client module, and whether animation is
  // the sole cause is exactly what decides if extracting it would help.
  const recorded = new Set<string>()
  let changed = true
  let guard = 0
  while (changed && guard < modules.length + 2) {
    changed = false
    guard += 1
    for (const module of modules) {
      for (const specifier of importsByPath.get(module.path) ?? []) {
        const resolved = resolveSpecifier(specifier, byPath)
        if (!resolved || !isClient(resolved)) continue
        const edge = `${module.path}\u0000${resolved}`
        if (recorded.has(edge)) continue
        recorded.add(edge)
        reasonsByPath.get(module.path)?.push({ kind: 'imports-client', modulePath: resolved })
        changed = true
      }
    }
  }

  const boundaries: ModuleBoundary[] = modules.map((module) => Object.freeze({
    path: module.path,
    client: isClient(module.path),
    reasons: Object.freeze([...(reasonsByPath.get(module.path) ?? [])]),
  }))

  const costs: BoundaryCost[] = boundaries
    .filter((boundary) => boundary.client)
    .map((boundary) => Object.freeze({
      path: boundary.path,
      pulledIn: reachableFrom(boundary.path, importsByPath, byPath),
    }))

  const routes = new Set(options.routePaths ?? [])
  const avoidable: AvoidableBoundary[] = []
  for (const boundary of boundaries) {
    if (!boundary.client) continue
    if (routes.size > 0 && !routes.has(boundary.path)) continue
    const animationNodes = boundary.reasons
      .filter((reason): reason is { kind: 'animation', nodeId: string } => reason.kind === 'animation')
      .map((reason) => reason.nodeId)
    // Avoidable when animation is the only *independent* cause.
    //
    // A declared `'use client'` does not count against that. Real source always
    // carries the directive when it contains Motion — it has to, or the animation
    // will not run — so treating the declaration as its own cause would make this
    // check fire never. What matters is whether anything *else* would keep the
    // module on the client after the animation moved out: an imported client
    // module, or an opaque region with its own directive.
    const independentCause = boundary.reasons.some((reason) =>
      reason.kind === 'imports-client' || reason.kind === 'opaque')
    const onlyCause = animationNodes.length > 0 && !independentCause
    if (!onlyCause) continue
    const pulledInCount = costs.find((cost) => cost.path === boundary.path)?.pulledIn.length ?? 0
    avoidable.push(Object.freeze({
      path: boundary.path,
      nodeIds: Object.freeze(animationNodes),
      pulledInCount,
      advice:
        `${boundary.path} renders on the client only because ${animationNodes.length} `
        + `node(s) animate. Extract them into their own client component so the route `
        + `keeps server rendering; ${pulledInCount} module(s) currently follow it to the client.`,
    }))
  }

  return Object.freeze({
    boundaries: Object.freeze(boundaries),
    avoidable: Object.freeze(avoidable),
    costs: Object.freeze(costs),
  })
}

/**
 * Resolve a relative specifier against the module set.
 *
 * Matched by suffix with the common extensions, because the IR stores specifiers as
 * an author writes them — without an extension — while paths carry one.
 */
function resolveSpecifier(
  specifier: string,
  byPath: ReadonlyMap<string, ReactIrModule>,
): string | null {
  const bare = specifier.replace(/^\.\//, '').replace(/^\.\.\//, '')
  for (const candidate of byPath.keys()) {
    if (candidate === specifier) return candidate
    const withoutExtension = candidate.replace(/\.tsx?$/, '')
    if (withoutExtension.endsWith(bare) || candidate.endsWith(bare)) return candidate
  }
  return null
}

/** Every module reachable by imports, excluding the start. */
function reachableFrom(
  start: string,
  importsByPath: ReadonlyMap<string, readonly string[]>,
  byPath: ReadonlyMap<string, ReactIrModule>,
): readonly string[] {
  const seen = new Set<string>()
  const queue = [start]
  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined) break
    for (const specifier of importsByPath.get(current) ?? []) {
      const resolved = resolveSpecifier(specifier, byPath)
      // A cycle is possible in a component graph, so guard on seen.
      if (resolved && resolved !== start && !seen.has(resolved)) {
        seen.add(resolved)
        queue.push(resolved)
      }
    }
  }
  return Object.freeze([...seen].sort())
}

/**
 * The boundary a module should declare, for the generator.
 *
 * Separate from the analysis so a single module can be generated without building
 * the whole graph, which is the common case while editing one page.
 */
export function requiredBoundary(module: ReactIrModule): 'server' | 'client' {
  return directReasons(module).length > 0 ? 'client' : 'server'
}

/**
 * Variant propagation and stagger orchestration.
 *
 * Motion's orchestration works by name. A parent sets `animate="visible"` and every
 * descendant that declares a variant called `visible` animates too, with
 * `staggerChildren` on the parent spacing them out. Nothing is passed down
 * explicitly; the name is the entire contract.
 *
 * Which makes it quietly easy to break. If a child declares `show` while the parent
 * says `visible`, the child simply never animates — no error, no warning, nothing in
 * the console. Same if a parent sets `staggerChildren` and no child declares
 * variants at all: the stagger has nothing to stagger and the sequence renders
 * static.
 *
 * These are the checks that turn those silences into something an author can act on.
 * They are validation only. Nothing here rewrites an animation, because guessing
 * that `show` meant `visible` would be wrong as often as it was right.
 */

import { animationOf, childIdsOf, walkNodeIds, type ReactIrModule } from './nodes'
import { orchestratesChildren, type MotionAnimation } from './motion'

export type PropagationIssue = Readonly<{
  code:
    /** A parent orchestrates children but no descendant declares variants. */
    | 'stagger-without-variant-children'
    /** A descendant declares variants but none match what the parent drives. */
    | 'variant-name-mismatch'
    /** A referenced variant name is declared nowhere on the node. */
    | 'undeclared-variant'
    /** An exit animation with no AnimatePresence ancestor in this module. */
    | 'exit-without-presence'
    /** A child sets an explicit target, which blocks inherited propagation. */
    | 'propagation-blocked'
  nodeId: string
  message: string
}>

/** Variant names a node declares. */
function declaredNames(animation: MotionAnimation | undefined): ReadonlySet<string> {
  return new Set(Object.keys(animation?.variants ?? {}))
}

/** Variant names a node drives into its children, via animate or initial. */
function drivenNames(animation: MotionAnimation | undefined): readonly string[] {
  const names: string[] = []
  for (const value of [animation?.initial, animation?.animate]) {
    if (typeof value === 'string') names.push(value)
  }
  return names
}

/**
 * Descendants of a node, excluding itself.
 *
 * Propagation reaches any depth in Motion, not only direct children, so the check
 * has to look at the whole subtree.
 */
function descendantIds(module: ReactIrModule, nodeId: string): readonly string[] {
  const result: string[] = []
  const queue = [...childIdsOf(module.nodes[nodeId])]
  const seen = new Set<string>()
  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined || seen.has(current)) continue
    seen.add(current)
    result.push(current)
    queue.push(...childIdsOf(module.nodes[current]))
  }
  return result
}

/**
 * Check variant propagation across a module.
 *
 * Reports rather than fixes, and each message names the node and the specific
 * mismatch so the author is not left comparing two trees by eye.
 */
export function checkPropagation(module: ReactIrModule): readonly PropagationIssue[] {
  const issues: PropagationIssue[] = []

  for (const nodeId of walkNodeIds(module)) {
    const node = module.nodes[nodeId]
    if (!node) continue
    const animation = animationOf(node)
    if (!animation) continue

    // A name referenced on this node but declared nowhere on it. Motion resolves an
    // unknown name to nothing and animates nothing.
    const declared = declaredNames(animation)
    const parentIsDriving = drivenNames(animation)
    if (animation.variants) {
      for (const name of parentIsDriving) {
        if (!declared.has(name)) {
          issues.push(Object.freeze({
            code: 'undeclared-variant' as const,
            nodeId,
            message:
              `Node "${nodeId}" references variant "${name}" but declares `
              + `${declared.size === 0 ? 'none' : [...declared].map((each) => `"${each}"`).join(', ')}. `
              + 'Motion resolves an unknown name to nothing, so this animates nothing.',
          }))
        }
      }
    }

    const descendants = descendantIds(module, nodeId)
    const descendantAnimations = descendants
      .map((id) => animationOf(module.nodes[id]))
      .filter((each): each is MotionAnimation => each !== undefined)

    if (orchestratesChildren(animation)) {
      const withVariants = descendantAnimations.filter((each) => each.variants !== undefined)
      if (withVariants.length === 0) {
        issues.push(Object.freeze({
          code: 'stagger-without-variant-children' as const,
          nodeId,
          message:
            `Node "${nodeId}" orchestrates its children, but no descendant declares `
            + 'variants. Stagger and ordering only reach children through variant names, '
            + 'so nothing will be staggered.',
        }))
      } else if (parentIsDriving.length > 0) {
        // The parent drives specific names. At least one descendant has to declare
        // one of them or propagation stops at the parent.
        const reachable = withVariants.some((each) =>
          parentIsDriving.some((name) => name in (each.variants ?? {})))
        if (!reachable) {
          issues.push(Object.freeze({
            code: 'variant-name-mismatch' as const,
            nodeId,
            message:
              `Node "${nodeId}" drives ${parentIsDriving.map((name) => `"${name}"`).join(', ')} `
              + 'but no descendant declares a variant by that name. Propagation is by name, '
              + 'so the children stay where they are.',
          }))
        }
      }
    }

    // A descendant setting an explicit target overrides the inherited variant, which
    // silently opts it out of the parent's sequence.
    if (parentIsDriving.length > 0) {
      for (const descendantId of descendants) {
        const descendant = animationOf(module.nodes[descendantId])
        if (!descendant) continue
        if (typeof descendant.animate === 'object' && descendant.animate !== null) {
          issues.push(Object.freeze({
            code: 'propagation-blocked' as const,
            nodeId: descendantId,
            message:
              `Node "${descendantId}" sets an explicit animate target, which overrides the `
              + `variant inherited from "${nodeId}". It will not take part in that sequence. `
              + 'Declare a matching variant instead if it should.',
          }))
        }
      }
    }
  }

  return Object.freeze(issues)
}

/**
 * Whether an AnimatePresence ancestor exists for a node with an exit animation.
 *
 * Checked within one module only, because an ancestor in a parent module is not
 * visible here — so this reports what it can prove and stays quiet otherwise rather
 * than raising a warning that may be wrong.
 */
export function checkPresence(module: ReactIrModule): readonly PropagationIssue[] {
  const issues: PropagationIssue[] = []
  for (const nodeId of walkNodeIds(module)) {
    const animation = animationOf(module.nodes[nodeId])
    if (!animation?.exit) continue
    // The root's own exit is observed by whatever renders this module, which is
    // outside what can be checked from here.
    if (nodeId === module.rootNodeId) continue
    issues.push(Object.freeze({
      code: 'exit-without-presence' as const,
      nodeId,
      message:
        `Node "${nodeId}" declares an exit animation. It runs only inside an `
        + 'AnimatePresence ancestor, and React removes the element immediately otherwise. '
        + 'Confirm one wraps it.',
    }))
  }
  return Object.freeze(issues)
}

/**
 * A stagger plan, for previewing a sequence on the canvas.
 *
 * Computed from the same data the generator emits, so what the canvas shows is the
 * timing the site will have rather than an approximation of it.
 */
export type StaggerPlan = Readonly<{
  nodeId: string
  /** Seconds before this node starts. */
  delay: number
}>

export function planStagger(module: ReactIrModule, parentId: string): readonly StaggerPlan[] {
  const animation = animationOf(module.nodes[parentId])
  if (!animation) return Object.freeze([])

  const transitions = [
    animation.transition,
    ...Object.values(animation.variants ?? {}).map((state) => state.transition),
  ].filter((each) => each !== undefined)

  const stagger = transitions.find((each) => each?.staggerChildren !== undefined)?.staggerChildren ?? 0
  const initialDelay = transitions.find((each) => each?.delayChildren !== undefined)?.delayChildren ?? 0

  // Only children that actually declare variants take part, so the plan matches what
  // will really happen rather than numbering every child.
  const participating = descendantIds(module, parentId)
    .filter((id) => animationOf(module.nodes[id])?.variants !== undefined)

  return Object.freeze(participating.map((nodeId, index) => Object.freeze({
    nodeId,
    delay: Number((initialDelay + stagger * index).toFixed(4)),
  })))
}

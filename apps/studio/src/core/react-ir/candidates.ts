/**
 * Collect the class candidates a module or workspace needs compiled.
 *
 * Tailwind generates CSS only for classes it can see. In a normal Next build it sees them
 * by scanning source files; the canvas has no files to scan, because the tree it renders
 * exists only as IR in memory. So the candidate list has to be gathered from the nodes.
 *
 * There is deliberately no handling of a class chosen at runtime, because the IR has no
 * way to express one: the reader refuses a dynamic `className`, and `isScannable` refuses
 * an assembled token. That refusal is what makes this collection complete — every class
 * in the tree is a literal, so gathering them is enough, and the canvas cannot be missing
 * CSS for a class that only appears once the page is interactive.
 *
 * Tokens that somehow are not scannable are still reported rather than dropped. They will
 * render unstyled, and the author is entitled to know which ones.
 */

import { classTokensOf } from './nodes'
import { isScannable } from './classTokens'
import type { ReactIrModule } from './nodes'

export type CandidateCollection = Readonly<{
  /** Every class the modules need, sorted and deduplicated. */
  candidates: readonly string[]
  /**
   * Classes that cannot be compiled because they are not complete literals.
   *
   * Reported with the node that carries each one, so a message can point at the element
   * rather than at the page.
   */
  unscannable: readonly Readonly<{ nodeId: string, token: string }>[]
}>

/** Collect candidates from one module. */
export function collectModuleCandidates(module: ReactIrModule): CandidateCollection {
  return collectWorkspaceCandidates([module])
}

/**
 * Collect candidates across several modules.
 *
 * The canvas compiles one stylesheet per frame, not one per component, so a page and
 * every component it renders contribute to the same list. Compiling per module would
 * leave a class that only a nested component uses without CSS.
 */
export function collectWorkspaceCandidates(
  modules: readonly ReactIrModule[],
): CandidateCollection {
  const candidates = new Set<string>()
  const unscannable: { nodeId: string, token: string }[] = []

  for (const module of modules) {
    for (const node of Object.values(module.nodes)) {
      for (const token of classTokensOf(node)) {
        if (isScannable(token)) candidates.add(token)
        else unscannable.push({ nodeId: node.id, token })
      }
    }
  }

  return Object.freeze({
    // Sorted so an unchanged tree yields an identical list and the canvas can compare it
    // cheaply instead of diffing compiled CSS.
    candidates: Object.freeze([...candidates].sort()),
    unscannable: Object.freeze(unscannable
      .sort((left, right) => (left.nodeId === right.nodeId
        ? left.token.localeCompare(right.token)
        : left.nodeId.localeCompare(right.nodeId)))
      .map((entry) => Object.freeze(entry))),
  })
}

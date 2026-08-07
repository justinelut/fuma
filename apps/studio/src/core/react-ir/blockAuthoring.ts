/**
 * Saving a designed subtree AS a block — the user-authored half of the Blocks library.
 *
 * Tasks 81/82/83 shipped a catalogue somebody else wrote. This is the part that lets an author keep
 * what they built: select a section on the canvas and it becomes a block they can insert again.
 *
 * The extraction is where the correctness lives. A block must be CLOSED — every id its nodes reference
 * has to be inside it — because `instantiateBlock` mints fresh ids and remaps references, and a
 * reference pointing outside the subtree survives that remap as a DANGLING id. The tree then fails
 * `verifyTree` at save time, far from the insert that produced it and further still from the save that
 * created the block.
 */
import { childIdsOf, isHidden, type ReactIrModule, type ReactIrNode } from './nodes'
import { reviewBlock, type BlockDefinition, type BlockProblem } from './blockLibrary'

export type BlockMetadata = Readonly<{
  id: string
  name: string
  category: BlockDefinition['category']
  description: string
}>

export type SaveBlockResult =
  | { ok: true; block: BlockDefinition }
  /** Every problem, not the first: an author fixing one wants to see the rest. */
  | { ok: false; problems: readonly BlockProblem[] }

/**
 * Collects a node and everything it reaches, transitively.
 *
 * Uses `childIdsOf` rather than reading `children` directly, because that is what the instantiator's
 * remap walks: it also covers component `slots`, node ids inside element `attributes` and component
 * `props`, repeat `variants` and slot `fallbackChildren`. Collecting only `children` would produce a
 * subtree that LOOKS closed and whose slots still point at the original page.
 */
function collectSubtree(
  module: ReactIrModule,
  rootId: string,
): { nodes: Record<string, ReactIrNode>; missing: readonly string[] } {
  const nodes: Record<string, ReactIrNode> = {}
  const missing: string[] = []
  const queue = [rootId]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (id in nodes) continue
    const node = module.nodes[id]
    if (!node) {
      // A dangling id in the SOURCE page: recorded rather than skipped, because silently dropping it
      // would produce a block whose tree differs from the section the author selected.
      missing.push(id)
      continue
    }
    nodes[id] = node
    queue.push(...childIdsOf(node))
  }
  return { nodes, missing }
}

/**
 * Builds a block from a subtree of a module.
 *
 * REFUSES rather than repairs. A block is inserted many times across many pages, so a defect saved
 * here is multiplied — and every copy has to be found and fixed by hand, because task 89's decision is
 * that blocks are copied rather than referenced.
 */
export function blockFromSubtree(
  module: ReactIrModule,
  rootId: string,
  meta: BlockMetadata,
  tenantComponents: readonly string[],
): SaveBlockResult {
  const problems: BlockProblem[] = []

  if (!(rootId in module.nodes)) {
    return { ok: false, problems: [{ code: 'root-not-in-subtree', message: `No node "${rootId}" on this page.` }] }
  }
  if (meta.id.trim() === '' || meta.name.trim() === '') {
    problems.push({ code: 'root-not-in-subtree', message: 'A block needs an id and a name.' })
  }
  if (meta.description.trim() === '') {
    // The picker states what a block is FOR so it is choosable without inserting each one; a blank
    // description makes the author's own block the one they cannot identify later.
    problems.push({ code: 'root-not-in-subtree', message: 'A block needs a one-line description.' })
  }

  const { nodes, missing } = collectSubtree(module, rootId)
  for (const id of missing) {
    problems.push({
      code: 'reference-outside-block',
      message: `"${id}" is referenced but is not on this page, so the block would carry a dangling id.`,
    })
  }

  if (isHidden(module.nodes[rootId]!)) {
    // Saving a hidden section produces a block that inserts and renders nothing, which reads as the
    // block being broken rather than as the selection having been hidden.
    problems.push({
      code: 'unreachable-node',
      message: 'This section is hidden, so the block would insert something that never renders.',
    })
  }

  if (problems.length > 0) return { ok: false, problems }

  const block: BlockDefinition = {
    id: meta.id.trim(),
    name: meta.name.trim(),
    category: meta.category,
    description: meta.description.trim(),
    // An author's own block is a BASE, never a variant: variantOf groups a base with variants somebody
    // deliberately authored as alternatives, and guessing a family from a saved selection would put
    // unrelated blocks under one heading in the picker.
    variantOf: null,
    subtree: Object.freeze(nodes),
    rootId,
  }

  // The SAME gate the shipped catalogue passes, so an author's block is held to the standard the
  // built-in ones are rather than a weaker one.
  const reviewed = reviewBlock(block, tenantComponents)
  if (reviewed.length > 0) return { ok: false, problems: reviewed }
  return { ok: true, block }
}

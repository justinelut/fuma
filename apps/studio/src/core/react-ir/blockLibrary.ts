/**
 * The Blocks library: saved node subtrees, instantiated with fresh ids.
 *
 * Task 89 decided a Block is a saved SUBTREE copied on insert rather than a props-only component,
 * because rearranging an inserted hero is ordinary work and a props-only Block either forbids it or
 * grows a prop per variation.
 *
 * THE CONSTRAINT THAT SHAPES THIS WHOLE FILE, established by running the real editor rather than by
 * reading it: a stored subtree carries fixed node ids, and `insertNodes` REFUSES a collision with
 * `duplicate-id` — "Give the inserted nodes fresh ids." Its own comment states why it refuses instead
 * of renaming: silently renaming would break the references INSIDE the subtree.
 *
 * So inserting the same block twice into one page fails. And inserting the same block twice is the
 * NORMAL case for blocks — three feature cards, two testimonials, a second call to action further
 * down the page. A library that stored and inserted verbatim would work exactly once per page and
 * then refuse, which reads as the block being broken rather than as ids colliding.
 *
 * Therefore instantiation is part of the model, not a detail: every insert mints fresh ids AND
 * remaps every internal reference. Remapping only `children` would leave the copy's slots and node-
 * valued props pointing at the ORIGINAL's nodes — two parents for one node, which `verifyTree`
 * refuses at save time, far from the insert that caused it.
 */
import {
  childIdsOf,
  type ReactIrModule,
  type ReactIrNode,
} from './nodes'
import { insertNodes, type EditResult } from './edit'

/** A saved subtree offered in the library. */
export type BlockDefinition = Readonly<{
  /** Stable library id. Survives across sites, so a page can record which block it came from. */
  id: string
  name: string
  /** Grouping in the picker. */
  category: 'hero' | 'features' | 'testimonial' | 'pricing' | 'call-to-action' | 'contact' | 'footer'
  /** One line stating what it is FOR, so the picker is choosable without inserting each one. */
  description: string
  /**
   * The family this is a variant of, or null when it is the base.
   *
   * A variant is its OWN saved subtree rather than a prop, which follows from task 89: a Block is
   * copied on insert, so there is no live definition a prop could switch on. The cost, stated rather
   * than hidden: fixing one variant does not reach its siblings. That is the same cost task 89 already
   * accepted for blocks in general, and consistency comes from the shadcn components inside them.
   */
  variantOf: string | null
  subtree: Readonly<Record<string, ReactIrNode>>
  rootId: string
}>

/** Mints an id for a copied node. Injected so an insert is reproducible in a test and unique in an app. */
export type IdSource = (hint: string) => string

/**
 * A counter-based source, suitable for one page's session.
 *
 * Deliberately takes the EXISTING module so it cannot mint an id the page already holds — otherwise
 * the mint itself would produce the collision it exists to avoid, and only on pages that already
 * contain a block.
 */
export function idSourceFor(module: ReactIrModule, seed = 0): IdSource {
  let n = seed
  return (hint: string) => {
    let candidate = `${hint}-${n++}`
    while (module.nodes[candidate]) candidate = `${hint}-${n++}`
    return candidate
  }
}

/** A block instantiated for one insertion: fresh ids, references remapped. */
export type BlockInstance = Readonly<{
  subtree: Readonly<Record<string, ReactIrNode>>
  rootId: string
  /** Old id -> new id, so a caller can select the inserted root or report what it added. */
  idMap: Readonly<Record<string, string>>
}>

/**
 * Copy a block's subtree under fresh ids.
 *
 * Every id is minted first and the whole map is applied afterwards, so a reference is remapped whether
 * it points forward or backward in iteration order. Doing it as we walk would leave references to
 * nodes not yet visited pointing at the original.
 */
export function instantiateBlock(block: BlockDefinition, mint: IdSource): BlockInstance {
  const idMap: Record<string, string> = {}
  for (const oldId of Object.keys(block.subtree)) {
    idMap[oldId] = mint(hintFor(oldId))
  }

  const subtree: Record<string, ReactIrNode> = {}
  for (const [oldId, node] of Object.entries(block.subtree)) {
    subtree[idMap[oldId]!] = remapNode(node, idMap)
  }

  return Object.freeze({
    subtree: Object.freeze(subtree),
    rootId: idMap[block.rootId]!,
    idMap: Object.freeze(idMap),
  })
}

/**
 * Keep the readable part of the original id.
 *
 * A minted id of `n-14` tells nobody anything when it appears in a diagnostic or a source anchor,
 * whereas `hero-title-14` says which node it is. The trailing counter from a previous instantiation is
 * stripped so a block inserted repeatedly does not grow `hero-title-3-7-9`.
 */
function hintFor(oldId: string): string {
  return oldId.replace(/-\d+$/, '')
}

/** Rewrite every node reference a node can hold. */
function remapNode(node: ReactIrNode, idMap: Readonly<Record<string, string>>): ReactIrNode {
  const to = (id: string): string => idMap[id] ?? id
  const copy = { ...node, id: to(node.id), children: node.children.map(to) } as ReactIrNode

  // Each of these carries node ids too, and childIdsOf reads all of them - so a remap that skipped
  // one would produce a copy sharing the original's nodes.
  if (copy.kind === 'component') {
    if (copy.slots) {
      const slots: Record<string, string[]> = {}
      for (const [name, ids] of Object.entries(copy.slots)) slots[name] = ids.map(to)
      Object.assign(copy, { slots })
    }
    if (copy.props) Object.assign(copy, { props: remapValues(copy.props, to) })
  }
  if (copy.kind === 'element' && copy.attributes) {
    Object.assign(copy, { attributes: remapValues(copy.attributes, to) })
  }
  if (copy.kind === 'opaque' && copy.props) {
    Object.assign(copy, { props: remapValues(copy.props, to) })
  }
  if (copy.kind === 'repeat') {
    Object.assign(copy, { variants: copy.variants.map(to) })
  }
  if (copy.kind === 'slot' && copy.fallbackChildren) {
    Object.assign(copy, { fallbackChildren: copy.fallbackChildren.map(to) })
  }
  return copy
}

/** Remap node ids held inside an attribute or prop bag. */
function remapValues(
  bag: Readonly<Record<string, unknown>>,
  to: (id: string) => string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(bag)) {
    const held = value as { kind?: string; children?: readonly string[] }
    out[key] = held?.kind === 'nodes' && Array.isArray(held.children)
      ? { ...held, children: held.children.map(to) }
      : value
  }
  return out
}

/**
 * Insert a block into a module.
 *
 * One `insertNodes` call, so a block insertion is ONE undo step — pulling an inserted hero back out
 * should not take eleven presses of undo, and edit.ts already made whole-subtree insertion the
 * mechanism for exactly that reason.
 */
export function insertBlock(
  module: ReactIrModule,
  parentId: string,
  block: BlockDefinition,
  mint: IdSource,
  index?: number,
): EditResult & { instance?: BlockInstance } {
  const instance = instantiateBlock(block, mint)
  const result = insertNodes(module, parentId, instance.subtree, instance.rootId, index)
  return result.ok ? { ...result, instance } : result
}

export type BlockProblem = Readonly<{ code: string; message: string; nodeId?: string }>

/**
 * Review a block before it is offered.
 *
 * `tenantComponents` is the set a generated site actually receives (task 71's TENANT_SHADCN_COMPONENTS).
 * Passed in rather than imported so this file does not depend on the generated-site layer, and so a
 * caller can review against a site that carries a different set.
 */
export function reviewBlock(
  block: BlockDefinition,
  tenantComponents: readonly string[],
): readonly BlockProblem[] {
  const problems: BlockProblem[] = []
  const available = new Set(tenantComponents)

  if (!block.subtree[block.rootId]) {
    problems.push({
      code: 'root-not-in-subtree',
      message: `Block "${block.id}" declares root "${block.rootId}" but its subtree does not contain it, so there is nothing to insert.`,
    })
    // Everything below walks from the root, so continuing would report the whole block as unreachable.
    return Object.freeze(problems)
  }

  let componentCount = 0
  for (const [id, node] of Object.entries(block.subtree)) {
    if (node.kind !== 'component') continue
    componentCount += 1
    const symbol = node.component.symbol
    // THE RULE THAT MAKES 82 CHECKABLE, and it is a dependency fact rather than taste: a block naming
    // a component the site does not receive inserts an import that does not resolve, so the tenant's
    // BUILD fails on a missing module - which reads as the generated site being broken rather than as
    // a block referencing something unavailable. Same failure class as task 71's seven exclusions.
    if (!available.has(componentKey(symbol))) {
      problems.push({
        code: 'component-not-available-to-tenant',
        nodeId: id,
        message: `"${symbol}" is not in the set a generated site receives, so a page using this block would fail to build on a missing import. Pin its package and add it to the tenant set first.`,
      })
    }
  }

  // A block of pure markup is legal source and a poor block: task 74 established that a component's
  // props become canvas controls while inline markup has none, so a block with nothing composed gives
  // whoever inserts it no fields at all.
  if (componentCount === 0) {
    problems.push({
      code: 'block-composes-nothing',
      message: `Block "${block.id}" contains no components, so nothing inside it is configurable once inserted and every change to it is a source edit.`,
    })
  }

  // A node nobody reaches is never rendered, so it is invisible on the canvas and still travels with
  // every insertion - carried weight that cannot be found to remove.
  const reachable = reachableIds(block)
  for (const id of Object.keys(block.subtree)) {
    if (!reachable.has(id)) {
      problems.push({
        code: 'unreachable-node',
        nodeId: id,
        message: `"${id}" is not reachable from the block's root, so it never renders but is copied on every insertion.`,
      })
    }
  }

  // A reference to a node the subtree does not carry survives instantiation as a dangling id, and the
  // failure appears at save time rather than at insert.
  for (const [id, node] of Object.entries(block.subtree)) {
    for (const childId of childIdsOf(node)) {
      if (!block.subtree[childId]) {
        problems.push({
          code: 'reference-outside-block',
          nodeId: id,
          message: `"${id}" references "${childId}", which the block does not contain - the insertion would leave a dangling reference.`,
        })
      }
    }
  }

  return Object.freeze(problems)
}

/**
 * The tenant set is keyed by file name (`button`), while a node names the exported symbol (`Button`).
 *
 * Compared case-insensitively on the file-name form rather than by trusting one spelling, because the
 * two vocabularies are genuinely different and a strict comparison would report every correct block as
 * naming an unavailable component.
 */
function componentKey(symbol: string): string {
  return symbol
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    // A compound export like CardHeader belongs to the `card` component's file.
    .split('-')[0]!
}

function reachableIds(block: BlockDefinition): ReadonlySet<string> {
  const seen = new Set<string>()
  const stack = [block.rootId]
  while (stack.length > 0) {
    const id = stack.pop()
    if (id === undefined || seen.has(id)) continue
    const node = block.subtree[id]
    if (!node) continue
    seen.add(id)
    stack.push(...childIdsOf(node))
  }
  return seen
}

/** Blocks in a family, base first, so a picker can show variants together. */
export function familyOf(
  blocks: readonly BlockDefinition[],
  familyId: string,
): readonly BlockDefinition[] {
  return Object.freeze(
    blocks
      .filter((b) => b.id === familyId || b.variantOf === familyId)
      .sort((a, b) => (a.variantOf === null ? -1 : b.variantOf === null ? 1 : a.id.localeCompare(b.id))),
  )
}

/**
 * What the library does and does not promise, recorded because a Block that looks like a component
 * invites expectations it cannot meet.
 */
export const BLOCK_CONTRACT = Object.freeze({
  copiedOnInsert: 'A block is copied into the page. It has no live link back to the library, so editing it afterwards is ordinary editing of ordinary nodes.',
  noRetroactiveUpdate: 'Improving a block does not change pages that already used it. Consistency comes from the shadcn components inside it, which are updated centrally.',
  freshIdsEveryInsert: 'Every insertion mints new ids, because the editor refuses colliding ids rather than renaming them - so the same block can be inserted as many times as a page needs.',
  variantsAreSeparateBlocks: 'A variant is its own saved subtree rather than a prop, because a copied block has no live definition a prop could switch on.',
})

/**
 * Component-first authoring, measured rather than requested.
 *
 * THE PROMPT ALREADY ASKS FOR IT, and a prompt is the weakest possible enforcement: a model that
 * produces one enormous page.tsx has broken no rule anybody can point at, and the page renders
 * perfectly, so nothing surfaces the problem until somebody tries to edit it.
 *
 * WHAT INLINE MARKUP ACTUALLY COSTS, which is the reason this is worth checking at all and not a
 * matter of taste: A COMPONENT'S PROPS BECOME CANVAS CONTROLS AND INLINE MARKUP HAS NONE. Task 35
 * derives controls from a component's props interface and task 72 derives them from a cva variants
 * block - both need a component. So a hero written inline is styleable on the canvas but not
 * CONFIGURABLE: there is no field for its heading, no field for its call-to-action label, and the
 * only way to change either is to edit source. The page looks identical and is materially less
 * editable, which is exactly the kind of loss nobody notices while authoring.
 *
 * THE REFINEMENT THAT MATTERS MOST, because without it this check would contradict task 71: A
 * SECTION ALREADY BUILT FROM shadcn COMPONENTS IS NOT AN UNEXTRACTED SECTION. Task 71 tells the
 * model to compose from Button, Card, Field and the rest, so a section containing ten component
 * nodes is precisely what was asked for. Counting nodes alone would flag it, and a check that
 * punishes the behaviour its sibling rule requires is worse than no check - it teaches authors to
 * ignore both. So the measure is size AND the absence of composition, never size alone.
 */
import { childIdsOf, type ReactIrNode } from '../react-ir/nodes'

/**
 * What the review actually reads.
 *
 * Deliberately a SUBSET rather than ReactIrModule: the measurement needs a kind, a root and the node
 * map, and demanding a whole module would mean the only caller able to run it is one holding a fully
 * constructed module. The TSX reader produces exactly these three, so the check can run at authoring
 * time on source that has not been assembled into a module yet - which is the moment the feedback is
 * worth anything. A ReactIrModule satisfies this structurally, so both callers work.
 */
export type ComposableModule = Readonly<{
  kind: 'page' | 'layout' | 'component'
  rootNodeId: string | null
  nodes: Readonly<Record<string, ReactIrNode>>
}>

/**
 * How many descendants a direct child of the page needs before its internals stop being visible at
 * a glance.
 *
 * A number rather than a truth, which is why this reports instead of refusing. Anchored to something
 * real: a shadcn Card with a header, title, description and body is about six nodes and is
 * legitimately written in place; a hero with a heading, a paragraph, two buttons and a media wrapper
 * is around ten and carries content somebody will want to edit without opening an editor.
 */
export const SECTION_DESCENDANT_THRESHOLD = 8

/**
 * The share of a section's own children that must be components before it counts as composed.
 *
 * Half, because a section is legitimately a container element wrapping components - demanding that
 * every child be a component would flag `<section><h2/><Card/><Card/></section>`, which is the right
 * shape.
 */
export const COMPOSED_CHILD_RATIO = 0.5

export type SectionMeasurement = Readonly<{
  /** The node id of the page's direct child this describes. */
  nodeId: string
  /** Everything beneath it, including itself. */
  descendantCount: number
  /** Direct children that are component nodes. */
  componentChildren: number
  /** Direct children in total. */
  childCount: number
  /** True when it is already built from components rather than raw elements. */
  composed: boolean
  /** True when it is large AND not composed, so its content has no canvas controls. */
  shouldExtract: boolean
}>

/** Measures each direct child of the page root. */
export function measureSections(module: ComposableModule): readonly SectionMeasurement[] {
  const root = module.rootNodeId === null ? undefined : module.nodes[module.rootNodeId]
  if (!root) return Object.freeze([])

  const measurements = childIdsOf(root).flatMap((childId) => {
    const child = module.nodes[childId]
    if (!child) return []
    return [measureSection(module, childId, child)]
  })
  return Object.freeze(measurements)
}

function measureSection(
  module: ComposableModule,
  nodeId: string,
  node: ReactIrNode,
): SectionMeasurement {
  const descendantCount = subtreeIds(module, nodeId).length
  const children = childIdsOf(node)
  const componentChildren = children.filter(
    (id) => module.nodes[id]?.kind === 'component',
  ).length
  // A component node is itself already extracted - there is nothing to pull out of it.
  const isComponent = node.kind === 'component'
  const composed = isComponent
    || (children.length > 0 && componentChildren / children.length >= COMPOSED_CHILD_RATIO)

  return Object.freeze({
    nodeId,
    descendantCount,
    componentChildren,
    childCount: children.length,
    composed,
    shouldExtract: !composed && descendantCount >= SECTION_DESCENDANT_THRESHOLD,
  })
}

/**
 * Ids in a subtree, including the root of it.
 *
 * Walked locally rather than through nodes.ts's walkNodeIds because that one takes a full
 * ReactIrModule, and the point of ComposableModule is to run before one exists. Cycle-guarded by a
 * seen set: a malformed tree must report nothing rather than loop, since this is a review and a
 * review that hangs is worse than one that stays quiet.
 */
function subtreeIds(module: ComposableModule, rootId: string): readonly string[] {
  const order: string[] = []
  const seen = new Set<string>()
  const stack: string[] = [rootId]
  while (stack.length > 0) {
    const id = stack.pop()
    if (id === undefined || seen.has(id)) continue
    const node = module.nodes[id]
    if (!node) continue
    seen.add(id)
    order.push(id)
    stack.push(...childIdsOf(node))
  }
  return order
}

export type AuthoringNote = Readonly<{ code: string; message: string; nodeId?: string }>

/**
 * Reviews an authored page for the component-first property.
 *
 * REPORTS RATHER THAN REFUSES, deliberately. A landing page can legitimately be one section; the
 * threshold is a judgement rather than a fact; and refusing a page that renders correctly would make
 * the authoring tools unusable for the simple case they should handle best. The note names the
 * consequence so the author can decide, which is the difference between a review and an obstacle.
 */
export function reviewComponentFirst(module: ComposableModule): readonly AuthoringNote[] {
  // Only pages and layouts compose. A component IS the extracted unit, so measuring its internals
  // would ask an author to extract the thing they just extracted.
  if (module.kind === 'component') return Object.freeze([])

  const notes: AuthoringNote[] = []
  const sections = measureSections(module)
  const total = module.rootNodeId === null ? 0 : subtreeIds(module, module.rootNodeId).length
  const componentNodes = (module.rootNodeId === null ? [] : subtreeIds(module, module.rootNodeId))
    .filter((id) => module.nodes[id]?.kind === 'component').length

  for (const section of sections) {
    if (!section.shouldExtract) continue
    notes.push({
      code: 'section-not-extracted',
      nodeId: section.nodeId,
      message: `${section.nodeId} holds ${section.descendantCount} nodes of raw markup. Its content has no properties panel, because controls are derived from a component's props - so the heading and copy inside it can only be changed by editing source.`,
    })
  }

  // The strongest signal, and it is a different problem from any single section: a page of real size
  // with no components at all was authored as one file, so NOTHING on it is configurable.
  if (componentNodes === 0 && total >= SECTION_DESCENDANT_THRESHOLD * 2) {
    notes.push({
      code: 'page-composes-nothing',
      message: `The page is ${total} nodes and imports no components, so none of its content is configurable on the canvas and every change to it is a source edit.`,
    })
  }

  return Object.freeze(notes)
}

/** Whether a page meets the property, for a caller that wants the answer rather than the notes. */
export function isComponentFirst(module: ComposableModule): boolean {
  return reviewComponentFirst(module).length === 0
}

/**
 * What the model is told, kept beside the check so the instruction and the measurement agree.
 *
 * Stated as data because the prompt and this review must name the same property: a prompt asking for
 * something the review does not check is advice, and a review checking something the prompt never
 * asked for is a trap.
 */
export const COMPONENT_FIRST_RULE = Object.freeze({
  instruction: 'Author each section of a page as its own component with typed props, then compose the page from them.',
  why: 'A component\'s props become editable controls on the canvas; inline markup has none, so its heading and copy can only be changed by editing source.',
  exception: 'A section already built from shadcn components is composed - it does not need extracting again.',
  smallPages: 'A short page can be one file. The check reports rather than refuses, because the threshold is a judgement rather than a fact.',
})

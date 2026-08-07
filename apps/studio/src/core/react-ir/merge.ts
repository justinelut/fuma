/**
 * Merging visual edits with hand edits.
 *
 * Two people can change the same page: someone dragging on the canvas, and
 * someone editing the generated TSX. Without a defined authority one of those
 * edits disappears — and it disappears silently, which is the worst version,
 * because the person who lost work has no way to know it happened.
 *
 * So merging is three-way, against the state at the last sync. For each node the
 * question is not "which side is newer" but "which side actually changed":
 *
 *   - neither changed          → keep it
 *   - only the visual side     → take the visual edit
 *   - only the source side     → take the hand edit
 *   - both changed             → conflict, reported, nothing chosen
 *
 * A conflict is never auto-resolved. Picking a winner would mean discarding work
 * the author can still see in their editor, and no heuristic is worth that. The
 * caller surfaces the conflict and the person decides.
 *
 * Opaque regions are compared by their recorded source hash rather than their
 * contents, because the builder never modelled the contents in the first place.
 * A changed hash means a developer edited the region, and that is exactly the case
 * where the builder must not write over it.
 */

import { childIdsOf, type ReactIrModule, type ReactIrNode } from './nodes'

export type MergeSide = 'visual' | 'source'

export type NodeChange = Readonly<{
  nodeId: string
  kind: 'added' | 'removed' | 'modified'
  side: MergeSide
}>

export type MergeConflict = Readonly<{
  nodeId: string
  /** What happened on each side, so the message can be specific. */
  visual: 'added' | 'removed' | 'modified'
  source: 'added' | 'removed' | 'modified'
  /** Plain description of the collision, in the author's terms. */
  detail: string
}>

export type MergeResult = Readonly<{
  /**
   * The merged document. Conflicted nodes keep their base state, so the result is
   * always coherent and always safe to render — it just does not yet include the
   * contested change.
   */
  merged: ReactIrModule
  /** Changes taken from each side, for an audit trail. */
  applied: readonly NodeChange[]
  /** Collisions that need a person. Non-empty means do not write anything yet. */
  conflicts: readonly MergeConflict[]
  /** True when nothing needs deciding and the merge can be written. */
  clean: boolean
}>

/**
 * Stable comparison of a node's meaningful content.
 *
 * Editor metadata is excluded deliberately: someone locking a layer on the canvas
 * has not changed the page, and treating that as a modification would manufacture
 * conflicts out of nothing. Keys are sorted so comparison never depends on
 * property order.
 */
export function nodeFingerprint(node: ReactIrNode): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable)
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== 'label' && key !== 'locked' && key !== 'hidden')
        .sort(([left], [right]) => left.localeCompare(right))
      return Object.fromEntries(entries.map(([key, inner]) => [key, stable(inner)]))
    }
    return value
  }

  // An opaque region is compared by hash, not contents: the builder never
  // modelled what is inside it, so it has no basis to diff it.
  if (node.kind === 'opaque') {
    return JSON.stringify({
      kind: node.kind,
      symbol: node.symbol,
      source: node.source,
      sourceHash: node.sourceHash,
      props: stable(node.props ?? {}),
      children: node.children,
    })
  }

  return JSON.stringify(stable(node))
}

type SideDiff = Readonly<{
  added: ReadonlySet<string>
  removed: ReadonlySet<string>
  modified: ReadonlySet<string>
}>

/** What one side changed relative to the base. */
function diffAgainstBase(base: ReactIrModule, side: ReactIrModule): SideDiff {
  const added = new Set<string>()
  const removed = new Set<string>()
  const modified = new Set<string>()

  for (const [id, node] of Object.entries(side.nodes)) {
    const baseNode = base.nodes[id]
    if (!baseNode) {
      added.add(id)
      continue
    }
    if (nodeFingerprint(baseNode) !== nodeFingerprint(node)) modified.add(id)
  }
  for (const id of Object.keys(base.nodes)) {
    if (!(id in side.nodes)) removed.add(id)
  }

  return Object.freeze({ added, removed, modified })
}

function describe(
  nodeId: string,
  visual: MergeConflict['visual'],
  source: MergeConflict['source'],
): string {
  if (visual === 'removed' && source === 'modified') {
    return `${nodeId} was deleted on the canvas and edited in source.`
  }
  if (visual === 'modified' && source === 'removed') {
    return `${nodeId} was edited on the canvas and deleted from source.`
  }
  if (visual === 'added' && source === 'added') {
    return `${nodeId} was added on both sides with different content.`
  }
  return `${nodeId} was changed on the canvas and in source.`
}

/**
 * Merge a visual document and a source-derived document against their base.
 *
 * The base is the state both sides diverged from — the document as it stood at the
 * last sync. Passing anything else makes every unchanged node look modified and
 * turns the whole page into one large conflict.
 */
export function mergeModules(input: Readonly<{
  base: ReactIrModule
  visual: ReactIrModule
  source: ReactIrModule
}>): MergeResult {
  const { base, visual, source } = input
  const visualDiff = diffAgainstBase(base, visual)
  const sourceDiff = diffAgainstBase(base, source)

  const applied: NodeChange[] = []
  const conflicts: MergeConflict[] = []
  const nodes: Record<string, ReactIrNode> = {}

  const changeOf = (diff: SideDiff, id: string): 'added' | 'removed' | 'modified' | null => {
    if (diff.added.has(id)) return 'added'
    if (diff.removed.has(id)) return 'removed'
    if (diff.modified.has(id)) return 'modified'
    return null
  }

  const allIds = new Set<string>([
    ...Object.keys(base.nodes),
    ...Object.keys(visual.nodes),
    ...Object.keys(source.nodes),
  ])

  for (const id of [...allIds].sort()) {
    const visualChange = changeOf(visualDiff, id)
    const sourceChange = changeOf(sourceDiff, id)
    const baseNode = base.nodes[id]

    // Both sides touched it. Nothing is chosen; the base is kept so the document
    // stays renderable while a person decides.
    if (visualChange && sourceChange) {
      const bothAddedIdentically = visualChange === 'added'
        && sourceChange === 'added'
        && visual.nodes[id] && source.nodes[id]
        && nodeFingerprint(visual.nodes[id]) === nodeFingerprint(source.nodes[id])

      if (bothAddedIdentically) {
        const node = visual.nodes[id]
        if (node) nodes[id] = node
        continue
      }

      conflicts.push(Object.freeze({
        nodeId: id,
        visual: visualChange,
        source: sourceChange,
        detail: describe(id, visualChange, sourceChange),
      }))
      if (baseNode) nodes[id] = baseNode
      continue
    }

    if (visualChange) {
      if (visualChange !== 'removed') {
        const node = visual.nodes[id]
        if (node) nodes[id] = node
      }
      applied.push(Object.freeze({ nodeId: id, kind: visualChange, side: 'visual' }))
      continue
    }

    if (sourceChange) {
      if (sourceChange !== 'removed') {
        const node = source.nodes[id]
        if (node) nodes[id] = node
      }
      applied.push(Object.freeze({ nodeId: id, kind: sourceChange, side: 'source' }))
      continue
    }

    if (baseNode) nodes[id] = baseNode
  }

  // The root can move. When only one side changed it, follow that side; when both
  // did, keep the base so the merged document still resolves.
  const rootChangedVisually = visual.rootNodeId !== base.rootNodeId
  const rootChangedInSource = source.rootNodeId !== base.rootNodeId
  let rootNodeId = base.rootNodeId
  if (rootChangedVisually && !rootChangedInSource) rootNodeId = visual.rootNodeId
  if (rootChangedInSource && !rootChangedVisually) rootNodeId = source.rootNodeId
  if (rootChangedVisually && rootChangedInSource && visual.rootNodeId !== source.rootNodeId) {
    conflicts.push(Object.freeze({
      nodeId: base.rootNodeId,
      visual: 'modified',
      source: 'modified',
      detail: 'The page root changed on the canvas and in source.',
    }))
  }

  const merged: ReactIrModule = {
    ...base,
    nodes,
    rootNodeId,
  }

  return Object.freeze({
    merged,
    applied: Object.freeze(applied),
    conflicts: Object.freeze(conflicts),
    clean: conflicts.length === 0,
  })
}

export type IntegrityProblem = Readonly<{
  code: 'missing-node' | 'orphaned-node' | 'missing-root'
  nodeId: string
  detail: string
}>

/**
 * Check a merged document actually holds together.
 *
 * A three-way merge can produce a coherent-looking document with a dangling
 * reference — one side deleted a node the other side still points at. Writing that
 * out would generate source referencing something that is not there, so the merge
 * has to be checked before it is trusted rather than after it breaks a build.
 */
export function verifyIntegrity(module: ReactIrModule): readonly IntegrityProblem[] {
  const problems: IntegrityProblem[] = []

  if (!module.nodes[module.rootNodeId]) {
    problems.push(Object.freeze({
      code: 'missing-root',
      nodeId: module.rootNodeId,
      detail: `The root ${module.rootNodeId} is not present in the document.`,
    }))
  }

  const referenced = new Set<string>([module.rootNodeId])
  for (const [id, node] of Object.entries(module.nodes)) {
    for (const childId of childIdsOf(node)) {
      referenced.add(childId)
      if (!module.nodes[childId]) {
        problems.push(Object.freeze({
          code: 'missing-node',
          nodeId: childId,
          detail: `${id} references ${childId}, which is not in the document.`,
        }))
      }
    }
  }

  for (const id of Object.keys(module.nodes)) {
    if (!referenced.has(id)) {
      problems.push(Object.freeze({
        code: 'orphaned-node',
        nodeId: id,
        detail: `${id} is present but nothing references it, so it would not render.`,
      }))
    }
  }

  return Object.freeze(problems)
}

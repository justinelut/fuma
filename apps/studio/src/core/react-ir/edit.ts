/**
 * Canvas editing on the React node union.
 *
 * The operations the canvas and the AI both perform: insert, move, delete,
 * duplicate, restyle, reparent. Under the old model these mutated a module+props
 * tree and regenerated HTML. Here they transform the IR, and the IR is regenerated
 * to TSX — so a drag on the canvas and a hand edit in the file produce the same kind
 * of change to the same artifact.
 *
 * Every operation is a pure function returning a new module, which is what makes
 * undo a matter of keeping the previous value rather than computing an inverse. It
 * also means a refused operation cannot leave a half-applied tree.
 *
 * The rules enforced here exist because each corresponds to a way a tree can be
 * corrupted into something that no longer generates valid source:
 *
 *   - No cycles. Moving a node into its own descendant would produce a tree that
 *     cannot be walked or generated, and the failure would appear far from the edit.
 *   - No orphans. Every node except the root must be reachable, or it lingers in the
 *     map contributing nothing and confusing every later traversal.
 *   - Text and expression nodes take no children. React has nowhere to put them.
 *   - The root cannot be deleted. A module with no root generates nothing.
 */

import {
  canHaveChildren,
  childIdsOf,
  classTokensOf,
  isLocked,
  walkNodeIds,
  type ReactIrModule,
  type ReactIrNode,
} from './nodes'
import type { MotionAnimation } from './motion'
import { mergeClassTokens, removeClassFamily, conflictKeyOf, parseClassToken } from './classTokens'

export type EditProblem = Readonly<{
  code:
    | 'unknown-node'
    | 'cycle-refused'
    | 'root-not-deletable'
    | 'children-not-allowed'
    | 'locked-node'
    | 'duplicate-id'
    | 'index-out-of-range'
  message: string
}>

export type EditResult = Readonly<{
  ok: boolean
  module: ReactIrModule
  problems: readonly EditProblem[]
  /** Nodes created by the operation, for selecting them afterwards. */
  createdIds?: readonly string[]
}>

function fail(module: ReactIrModule, code: EditProblem['code'], message: string): EditResult {
  // The original module is returned untouched, so a refusal cannot half-apply.
  return Object.freeze({
    ok: false,
    module,
    problems: Object.freeze([Object.freeze({ code, message })]),
  })
}

function succeed(module: ReactIrModule, createdIds?: readonly string[]): EditResult {
  return Object.freeze({
    ok: true,
    module,
    problems: Object.freeze([]),
    ...(createdIds ? { createdIds: Object.freeze(createdIds) } : {}),
  })
}

/** Replace one node, returning a new module. */
function withNode(module: ReactIrModule, node: ReactIrNode): ReactIrModule {
  return { ...module, nodes: { ...module.nodes, [node.id]: node } } as ReactIrModule
}

function withChildren(
  module: ReactIrModule,
  parentId: string,
  children: readonly string[],
): ReactIrModule {
  const parent = module.nodes[parentId]
  if (!parent) return module
  return withNode(module, { ...parent, children: [...children] } as ReactIrNode)
}

/** The parent of a node, or null for the root. */
export function parentOf(module: ReactIrModule, nodeId: string): string | null {
  for (const candidateId of Object.keys(module.nodes)) {
    if (childIdsOf(module.nodes[candidateId]).includes(nodeId)) return candidateId
  }
  return null
}

/** Whether `candidateId` is `nodeId` or inside it. */
export function isSelfOrDescendant(
  module: ReactIrModule,
  nodeId: string,
  candidateId: string,
): boolean {
  if (nodeId === candidateId) return true
  // walkNodeIds is cycle-guarded, so a corrupt tree cannot hang this.
  return walkNodeIds(module, nodeId).includes(candidateId)
}

/**
 * Insert a subtree under a parent.
 *
 * The subtree arrives as a node map so a whole block can be inserted in one
 * operation — which is what makes a block insertion a single undo step rather than
 * one per element.
 */
export function insertNodes(
  module: ReactIrModule,
  parentId: string,
  subtree: Readonly<Record<string, ReactIrNode>>,
  rootId: string,
  index?: number,
): EditResult {
  const parent = module.nodes[parentId]
  if (!parent) return fail(module, 'unknown-node', `No node "${parentId}" to insert into.`)
  if (!canHaveChildren(parent)) {
    return fail(module, 'children-not-allowed',
      `A ${parent.kind} node cannot contain children; React has nowhere to put them.`)
  }
  if (isLocked(parent)) {
    return fail(module, 'locked-node',
      `"${parentId}" is locked. Unlock it before changing its contents.`)
  }
  if (!subtree[rootId]) {
    return fail(module, 'unknown-node', `The subtree does not contain its declared root "${rootId}".`)
  }

  for (const id of Object.keys(subtree)) {
    if (module.nodes[id]) {
      // Silently renaming would break references inside the subtree, so the caller
      // has to supply ids that do not collide.
      return fail(module, 'duplicate-id',
        `"${id}" already exists in this module. Give the inserted nodes fresh ids.`)
    }
  }

  const siblings = childIdsOf(parent)
  const at = index ?? siblings.length
  if (at < 0 || at > siblings.length) {
    return fail(module, 'index-out-of-range',
      `Index ${at} is outside 0..${siblings.length} for "${parentId}".`)
  }

  const children = [...siblings.slice(0, at), rootId, ...siblings.slice(at)]
  const next = withChildren(
    { ...module, nodes: { ...module.nodes, ...subtree } } as ReactIrModule,
    parentId,
    children,
  )
  return succeed(next, Object.keys(subtree))
}

/**
 * Move a node to a new parent and position.
 *
 * Refuses to move a node inside itself. Without that check the tree would contain a
 * cycle and generation would either hang or emit nonsense, with nothing pointing
 * back at the drag that caused it.
 */
export function moveNode(
  module: ReactIrModule,
  nodeId: string,
  newParentId: string,
  index?: number,
): EditResult {
  if (!module.nodes[nodeId]) return fail(module, 'unknown-node', `No node "${nodeId}".`)
  const newParent = module.nodes[newParentId]
  if (!newParent) return fail(module, 'unknown-node', `No node "${newParentId}" to move into.`)
  if (nodeId === module.rootNodeId) {
    return fail(module, 'cycle-refused', 'The root cannot be moved; it has no parent.')
  }
  if (!canHaveChildren(newParent)) {
    return fail(module, 'children-not-allowed',
      `A ${newParent.kind} node cannot contain children.`)
  }
  if (isSelfOrDescendant(module, nodeId, newParentId)) {
    return fail(module, 'cycle-refused',
      `Moving "${nodeId}" into "${newParentId}" would place it inside itself.`)
  }
  if (isLocked(newParent)) {
    return fail(module, 'locked-node', `"${newParentId}" is locked.`)
  }

  const oldParentId = parentOf(module, nodeId)
  if (oldParentId !== null && isLocked(module.nodes[oldParentId])) {
    return fail(module, 'locked-node', `"${oldParentId}" is locked, so its children cannot move.`)
  }

  let next = module
  if (oldParentId !== null) {
    next = withChildren(next, oldParentId,
      childIdsOf(next.nodes[oldParentId]).filter((id) => id !== nodeId))
  }

  const siblings = childIdsOf(next.nodes[newParentId])
  const at = index ?? siblings.length
  if (at < 0 || at > siblings.length) {
    return fail(module, 'index-out-of-range',
      `Index ${at} is outside 0..${siblings.length} for "${newParentId}".`)
  }
  next = withChildren(next, newParentId,
    [...siblings.slice(0, at), nodeId, ...siblings.slice(at)])

  return succeed(next)
}

/**
 * Delete a node and everything under it.
 *
 * The whole subtree goes, because leaving descendants behind would orphan them: they
 * would sit in the node map unreachable, and every later traversal would have to
 * decide what to do about them.
 */
export function deleteNode(module: ReactIrModule, nodeId: string): EditResult {
  if (!module.nodes[nodeId]) return fail(module, 'unknown-node', `No node "${nodeId}".`)
  if (nodeId === module.rootNodeId) {
    return fail(module, 'root-not-deletable',
      'The root cannot be deleted; a module with no root generates nothing. '
      + 'Replace it instead, or delete the module.')
  }
  if (isLocked(module.nodes[nodeId])) {
    return fail(module, 'locked-node', `"${nodeId}" is locked. Unlock it before deleting.`)
  }

  const doomed = new Set(walkNodeIds(module, nodeId))
  doomed.add(nodeId)

  const nodes: Record<string, ReactIrNode> = {}
  for (const [id, node] of Object.entries(module.nodes)) {
    if (doomed.has(id)) continue
    nodes[id] = { ...node, children: childIdsOf(node).filter((child) => !doomed.has(child)) } as ReactIrNode
  }

  return succeed({ ...module, nodes } as ReactIrModule)
}

/**
 * Duplicate a subtree next to the original.
 *
 * Ids are regenerated through the supplied factory, and references *inside* the
 * subtree are remapped to the new ids — without that the copy's children would still
 * point at the original's, so editing one would change both.
 */
export function duplicateNode(
  module: ReactIrModule,
  nodeId: string,
  nextId: (original: string) => string,
): EditResult {
  if (!module.nodes[nodeId]) return fail(module, 'unknown-node', `No node "${nodeId}".`)
  if (nodeId === module.rootNodeId) {
    return fail(module, 'cycle-refused',
      'The root has no parent to duplicate alongside. Duplicate the module instead.')
  }
  const parentId = parentOf(module, nodeId)
  if (parentId === null) return fail(module, 'unknown-node', `"${nodeId}" has no parent.`)

  const originalIds = [nodeId, ...walkNodeIds(module, nodeId).filter((id) => id !== nodeId)]
  const mapping = new Map<string, string>()
  for (const id of originalIds) mapping.set(id, nextId(id))

  for (const created of mapping.values()) {
    if (module.nodes[created]) {
      return fail(module, 'duplicate-id', `Generated id "${created}" already exists.`)
    }
  }

  const subtree: Record<string, ReactIrNode> = {}
  for (const id of originalIds) {
    const original = module.nodes[id]
    if (!original) continue
    subtree[mapping.get(id) ?? id] = {
      ...original,
      id: mapping.get(id) ?? id,
      // Remapped, or the copy would share the original's children.
      children: childIdsOf(original).map((child) => mapping.get(child) ?? child),
    } as ReactIrNode
  }

  const siblings = childIdsOf(module.nodes[parentId])
  const at = siblings.indexOf(nodeId) + 1
  return insertNodes(module, parentId, subtree, mapping.get(nodeId) ?? nodeId, at)
}

/**
 * Apply class tokens to a node.
 *
 * Uses the conflict-aware merge, so setting padding replaces the padding that was
 * there rather than appending a second one and leaving the outcome to Tailwind's
 * emission order.
 */
export function setClassTokens(
  module: ReactIrModule,
  nodeId: string,
  tokens: readonly string[],
): EditResult {
  const node = module.nodes[nodeId]
  if (!node) return fail(module, 'unknown-node', `No node "${nodeId}".`)
  if (isLocked(node)) return fail(module, 'locked-node', `"${nodeId}" is locked.`)
  if (!('classTokens' in node)) {
    return fail(module, 'children-not-allowed',
      `A ${node.kind} node carries no classes; it renders no element of its own.`)
  }

  const merged = mergeClassTokens(classTokensOf(node), tokens)
  return succeed(withNode(module, { ...node, classTokens: [...merged] } as ReactIrNode))
}

/**
 * Replace a node's complete Tailwind token list.
 *
 * `setClassTokens` is intentionally additive and conflict-aware, which is right for a one-click
 * style control. A source-style field is different: removing a token from the field must remove it
 * from the module too, or the canvas says one thing while generated TSX keeps another.
 */
export function replaceClassTokens(
  module: ReactIrModule,
  nodeId: string,
  tokens: readonly string[],
): EditResult {
  const node = module.nodes[nodeId]
  if (!node) return fail(module, 'unknown-node', `No node "${nodeId}".`)
  if (isLocked(node)) return fail(module, 'locked-node', `"${nodeId}" is locked.`)
  if (!('classTokens' in node)) {
    return fail(module, 'children-not-allowed',
      `A ${node.kind} node carries no classes; it renders no element of its own.`)
  }

  return succeed(withNode(module, { ...node, classTokens: [...tokens] } as ReactIrNode))
}

/**
 * Set or clear Motion data on one renderable node.
 *
 * Only elements and component calls can become Motion elements. Refusing every other kind keeps the
 * panel from appearing to animate a text/expression node that has no element of its own.
 */
export function setNodeAnimation(
  module: ReactIrModule,
  nodeId: string,
  animation: MotionAnimation | null,
): EditResult {
  const node = module.nodes[nodeId]
  if (!node) return fail(module, 'unknown-node', `No node "${nodeId}".`)
  if (isLocked(node)) return fail(module, 'locked-node', `"${nodeId}" is locked.`)
  if (node.kind !== 'element' && node.kind !== 'component') {
    return fail(module, 'children-not-allowed',
      `A ${node.kind} node has no element for Motion to animate.`)
  }

  const next = { ...node, animation: animation ?? undefined } as ReactIrNode
  return succeed(withNode(module, next))
}

/**
 * Sets — or clears — one literal prop on a component node.
 *
 * THIS IS WHAT MAKES A PROPERTY PANEL POSSIBLE. Task 72 derived cva variant controls from a shadcn
 * component's own source and nothing could consume them, because no edit operation existed to APPLY a
 * chosen value: the only ops were structural (insert/move/delete) plus class tokens. A control that
 * cannot write is a control nobody can use.
 *
 * LITERAL VALUES ONLY. A prop that carries a member read or a template is data binding, which task 46
 * owns and which a select in a panel cannot express — accepting one here would let a panel silently
 * replace a binding with a constant, and the page would keep rendering while quietly showing the same
 * value for every row.
 *
 * Passing `null` REMOVES the prop rather than writing an empty value, because absent and empty mean
 * different things to a component: an absent variant falls back to the cva default, while an empty
 * string is a value that matches no variant and silently styles nothing.
 */
export function setComponentProp(
  module: ReactIrModule,
  nodeId: string,
  name: string,
  value: string | number | boolean | null,
): EditResult {
  const node = module.nodes[nodeId]
  if (!node) return fail(module, 'unknown-node', `No node "${nodeId}".`)
  if (isLocked(node)) return fail(module, 'locked-node', `"${nodeId}" is locked.`)
  if (node.kind !== 'component') {
    // An element's attributes and a component's props are different fields, and writing to the wrong
    // one produces a node the generator emits differently than the panel showed.
    return fail(module, 'children-not-allowed',
      `A ${node.kind} node has no component props. Only a component node does.`)
  }
  if (name.trim() === '') return fail(module, 'unknown-node', 'A prop name is required.')

  const props = { ...(node.props ?? {}) }
  if (value === null) {
    delete props[name]
  } else {
    // Stored in the same shape the generator reads, so the panel cannot produce a value the emitter
    // then has to guess at: a bare string here crashes the generator reading `.kind` off it.
    props[name] = { kind: 'expression', expression: { kind: 'literal', value } }
  }
  const next = Object.keys(props).length === 0
    // The field is optional, so an emptied record is REMOVED rather than left as `{}` - two spellings
    // of "no props" would make two otherwise identical modules compare as different.
    ? { ...node, props: undefined }
    : { ...node, props }
  return succeed(withNode(module, next as ReactIrNode))
}

/** Clear every class targeting the same property as the given token. */
export function clearClassFamily(
  module: ReactIrModule,
  nodeId: string,
  token: string,
): EditResult {
  const node = module.nodes[nodeId]
  if (!node) return fail(module, 'unknown-node', `No node "${nodeId}".`)
  if (isLocked(node)) return fail(module, 'locked-node', `"${nodeId}" is locked.`)
  if (!('classTokens' in node)) {
    return fail(module, 'children-not-allowed', `A ${node.kind} node carries no classes.`)
  }

  const family = conflictKeyOf(parseClassToken(token))
  const remaining = removeClassFamily(classTokensOf(node), family)
  return succeed(withNode(module, { ...node, classTokens: [...remaining] } as ReactIrNode))
}

/** Reorder a node among its existing siblings. */
export function reorderChild(
  module: ReactIrModule,
  parentId: string,
  nodeId: string,
  toIndex: number,
): EditResult {
  const parent = module.nodes[parentId]
  if (!parent) return fail(module, 'unknown-node', `No node "${parentId}".`)
  if (isLocked(parent)) return fail(module, 'locked-node', `"${parentId}" is locked.`)

  const siblings = childIdsOf(parent)
  const from = siblings.indexOf(nodeId)
  if (from === -1) {
    return fail(module, 'unknown-node', `"${nodeId}" is not a child of "${parentId}".`)
  }
  if (toIndex < 0 || toIndex >= siblings.length) {
    return fail(module, 'index-out-of-range',
      `Index ${toIndex} is outside 0..${siblings.length - 1}.`)
  }

  const without = siblings.filter((id) => id !== nodeId)
  const reordered = [...without.slice(0, toIndex), nodeId, ...without.slice(toIndex)]
  return succeed(withChildren(module, parentId, reordered))
}

/**
 * Check a module for structural damage.
 *
 * Run after a batch of edits. Each problem it reports is one that would otherwise
 * surface as a confusing generation failure rather than as a bad edit.
 */
export function verifyTree(module: ReactIrModule): readonly EditProblem[] {
  const problems: EditProblem[] = []

  if (!module.nodes[module.rootNodeId]) {
    problems.push(Object.freeze({
      code: 'unknown-node' as const,
      message: `Root "${module.rootNodeId}" is not in the node map.`,
    }))
    return Object.freeze(problems)
  }

  const reachable = new Set(walkNodeIds(module))
  for (const id of Object.keys(module.nodes)) {
    if (!reachable.has(id)) {
      problems.push(Object.freeze({
        code: 'unknown-node' as const,
        message: `"${id}" is unreachable from the root, so it contributes nothing.`,
      }))
    }
  }

  for (const [id, node] of Object.entries(module.nodes)) {
    for (const child of childIdsOf(node)) {
      if (!module.nodes[child]) {
        problems.push(Object.freeze({
          code: 'unknown-node' as const,
          message: `"${id}" lists child "${child}", which does not exist.`,
        }))
      }
    }
    if (!canHaveChildren(node) && childIdsOf(node).length > 0) {
      problems.push(Object.freeze({
        code: 'children-not-allowed' as const,
        message: `"${id}" is a ${node.kind} node but lists children.`,
      }))
    }
  }

  // A node appearing under two parents is not a cycle but is equally broken: the
  // generated output would contain it twice with one id.
  const seen = new Map<string, string>()
  for (const [id, node] of Object.entries(module.nodes)) {
    for (const child of childIdsOf(node)) {
      const existing = seen.get(child)
      if (existing !== undefined) {
        problems.push(Object.freeze({
          code: 'duplicate-id' as const,
          message: `"${child}" is a child of both "${existing}" and "${id}".`,
        }))
        continue
      }
      seen.set(child, id)
    }
  }

  return Object.freeze(problems)
}

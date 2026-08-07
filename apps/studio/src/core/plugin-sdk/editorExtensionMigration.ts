/**
 * Migrating `editor.code` extensions from mutating the editor store to declared operations.
 *
 * WHAT AN EXTENSION GETS TODAY, read from the shipped SDK rather than assumed. editorApi.ts
 * declares:
 *
 *     store: {
 *       read: () => EditorStore
 *       transaction: (mutate: (store: EditorStore) => void) => void
 *     }
 *
 * Two separate problems follow from that, and they are worth separating because only one of them
 * is about the engine change:
 *
 * 1. THE STORE TYPE IS THE ABI. `EditorStore` is imported from the editor's own internal types, so
 *    an extension is coupled to the SHAPE OF OUR STATE rather than to a contract we chose to
 *    publish. Any internal rename breaks every installed extension, and the engine change renames
 *    nearly everything: the old store holds module+props nodes, the new one holds the React node
 *    union. So under the new IR every extension breaks - not because its intent is wrong but
 *    because it was reading fields that no longer exist.
 *
 * 2. `transaction(mutate)` HANDS OUT A MUTABLE REFERENCE, which is the deeper problem and would
 *    matter even with no engine change. A plugin may write anything anywhere: there is no
 *    operation vocabulary, so nothing can be validated, and an extension can leave a tree the
 *    engine itself considers invalid - a node whose parent does not list it, two parents for one
 *    node, a child on a childless kind. The canvas then renders something that cannot be
 *    generated, and the failure surfaces at SAVE time, far from the extension that caused it.
 *
 * SO THE MIGRATION IS NOT A TYPE SWAP. Reaiming `EditorStore` at the new union would carry problem
 * 2 across intact and would break every extension anyway. The replacement is a declared set of
 * OPERATIONS that map onto the edit ops the engine already validates.
 */

/**
 * What an extension may ask the editor to do.
 *
 * A closed set, and every member corresponds to an operation edit.ts already implements and already
 * refuses when the result would be invalid. That is the point: an extension cannot express an edit
 * the engine cannot check.
 */
export type ExtensionOperation =
  /** Insert a subtree at a position. One operation so it is one undo step. */
  | 'insert-nodes'
  /** Move an existing node under a new parent. Refused if it would create a cycle. */
  | 'move-node'
  /** Remove a node and its subtree. */
  | 'delete-node'
  /** Copy a subtree, remapping internal references. */
  | 'duplicate-node'
  /** Replace the Tailwind class tokens on a node, conflict-aware. */
  | 'set-class-tokens'
  /** Reorder a child within its parent. */
  | 'reorder-child'

export const EXTENSION_OPERATIONS: readonly ExtensionOperation[] = Object.freeze([
  'insert-nodes',
  'move-node',
  'delete-node',
  'duplicate-node',
  'set-class-tokens',
  'reorder-child',
])

/**
 * What an extension may read.
 *
 * A PROJECTION, not the store. The distinction is the whole migration: a projection is a contract
 * we publish and can keep stable across internal change, whereas handing over the store makes
 * every internal field part of the ABI by accident.
 */
export type ExtensionReadSurface = Readonly<{
  /** The node ids currently selected, so an extension can act on what the author picked. */
  selection: readonly string[]
  /** The module path being edited, so an extension knows where it is. */
  modulePath: string
  /** A node's kind and class tokens - enough to decide, not enough to couple to the state shape. */
  nodeSummary: (nodeId: string) => Readonly<{ kind: string; classTokens: readonly string[] }> | null
}>

export type MigrationProblem = Readonly<{ code: string; message: string }>

/**
 * Reviews a proposed extension surface.
 *
 * Each check describes a way the boundary is crossed while the code still looks reasonable.
 */
export function reviewExtensionSurface(proposed: Readonly<{
  /** Whether the extension receives the editor store itself. */
  receivesStore: boolean
  /** Whether it mutates state directly rather than requesting operations. */
  mutatesDirectly: boolean
  /** Whether every requested operation is one the engine validates. */
  operationsValidated: boolean
  /** Whether a rejected operation is reported back to the extension. */
  refusalsReported: boolean
}>): readonly MigrationProblem[] {
  const problems: MigrationProblem[] = []

  if (proposed.receivesStore) {
    problems.push({
      code: 'store-is-the-abi',
      message: 'Handing over the editor store makes every internal field part of the published contract, so an ordinary rename breaks every installed extension. A projection can stay stable while the state underneath changes.',
    })
  }

  if (proposed.mutatesDirectly) {
    problems.push({
      code: 'unvalidated-mutation',
      message: 'Direct mutation can leave a tree the engine considers invalid - an orphaned node, two parents, a child on a childless kind. The canvas then shows something that cannot be generated, and the failure appears at save time rather than where it was caused.',
    })
  }

  if (!proposed.operationsValidated) {
    problems.push({
      code: 'operation-not-validated',
      message: 'An operation the engine does not check is an operation that can produce an invalid tree, which is the situation the vocabulary exists to remove.',
    })
  }

  if (!proposed.refusalsReported) {
    // Silently dropping a refused operation is worse than refusing loudly: the extension believes
    // it worked and the author sees nothing happen.
    problems.push({
      code: 'refusal-swallowed',
      message: 'A refused operation must be reported to the extension. Dropping it silently leaves the extension believing it succeeded and the author watching nothing happen.',
    })
  }

  return Object.freeze(problems)
}

/**
 * Whether an operation can be expressed at all under the new surface.
 *
 * Returns false for anything outside the closed set, so an extension asking for something the
 * engine cannot validate is refused rather than accommodated.
 */
export function isExpressible(operation: string): operation is ExtensionOperation {
  return (EXTENSION_OPERATIONS as readonly string[]).includes(operation)
}

/**
 * What genuinely cannot be carried across, stated rather than discovered.
 *
 * An extension that reached into the store to do something the vocabulary does not cover has no
 * migration path, and saying so is more useful than implying every extension will simply work.
 */
export const UNCARRIED_CAPABILITIES: readonly Readonly<{ capability: string; why: string; instead: string }>[] =
  Object.freeze([
    Object.freeze({
      capability: 'Reading arbitrary editor state.',
      why: 'The projection publishes selection, the module path and a node summary. An extension that read some other field was coupled to state we never promised to keep.',
      instead: 'Ask for the field to be added to the projection, so it becomes a contract rather than an accident.',
    }),
    Object.freeze({
      capability: 'Writing module+props node shapes directly.',
      why: 'Those shapes no longer exist. The engine holds the React node union, where a paragraph is an element with a tag rather than a module with props.',
      instead: 'insert-nodes with the element the module used to resolve to - the conversion map records which tag each built-in becomes.',
    }),
    Object.freeze({
      capability: 'Composing several edits and deciding what is one undo step.',
      why: 'Undo granularity is now a property of the operation: each op is one step, and a subtree insert is deliberately one op so an inserted block undoes as a unit.',
      instead: 'Request one operation per intended undo step, which is what an author expects anyway.',
    }),
  ])

/** Recorded so the sequencing matches ABI v2 rather than contradicting it. */
export const MIGRATION_ORDER = Object.freeze({
  dependsOn: 'The frame tier from ABI v2, because an extension still needs somewhere to render.',
  reason: 'Migrating the store surface without the render surface leaves an extension able to request edits and unable to draw anything, which is not a working extension.',
  firstStep: 'Publish the projection and the operation vocabulary alongside the existing store access, so an author can move without a flag day.',
  lastStep: 'Remove store.read and store.transaction once installed extensions have moved.',
})

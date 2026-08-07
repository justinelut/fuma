/**
 * Persisting a saved block as a real component module.
 *
 * WHY A COMPONENT FILE RATHER THAN A STORED BLOB. The module store's resource kinds are a closed union
 * (page | layout | component) and a block is none of them, so a saved block had nowhere to live. The
 * options were a new storage kind for opaque JSON, or emitting the block as source. Source wins for the
 * reason task 85 already established about templates: source is what both our reader and a human can
 * still open in a year, whereas an IR snapshot is readable only by the version that wrote it. It is
 * also the product's stated output — a tenant can read, edit, or take their own component and leave.
 *
 * A DELIBERATE DIVERGENCE FROM TASK 89, recorded rather than slipped in. Task 89 decided the built-in
 * Blocks are copied subtrees, because rearranging an inserted hero is ordinary work and a props-only
 * block either forbids it or grows a prop per variation. That reasoning holds for a LIBRARY somebody
 * else authored. It does not hold for a section this author just built and wants again: they already
 * have the arrangement they want, and a component gives them the thing a copy cannot — fixing it once
 * fixes every page using it. Task 89's stated cost ("fixing one variant does not reach its siblings")
 * is precisely what an author saving their own work is most likely to be bitten by.
 * Both remain available: the catalogue still inserts subtrees, and a saved block becomes a component.
 */
import { generateModule } from './generate'
import { REACT_IR_VERSION, type ReactIrModule, type ReactIrNode } from './nodes'
import type { BlockDefinition } from './blockLibrary'

/** Where a saved block's component file goes. Grouped so a tenant can see what they saved. */
export const SAVED_BLOCK_DIRECTORY = 'components/blocks'

/**
 * A valid PascalCase component identifier derived from a block name.
 *
 * Falls back to a fixed name rather than producing an empty identifier: a file whose symbol is `''`
 * fails the tenant's own build with an error about syntax rather than about the block's name.
 */
export function symbolForBlock(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter((part) => part !== '')
  const joined = parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
  // A leading digit is legal in a filename and NOT in an identifier, so it is prefixed rather than
  // dropped - dropping it would silently merge "2 Column" and "Column".
  const safe = /^[0-9]/.test(joined) ? `Block${joined}` : joined
  return safe === '' ? 'SavedBlock' : safe
}

export function pathForSavedBlock(name: string): string {
  return `${SAVED_BLOCK_DIRECTORY}/${symbolForBlock(name)}.tsx`
}

/** True when anything in the subtree animates, which decides the client boundary. */
function subtreeAnimates(nodes: Readonly<Record<string, ReactIrNode>>): boolean {
  return Object.values(nodes).some((node) => 'animation' in node && node.animation !== undefined)
}

/**
 * Builds the component module for a saved block.
 *
 * The BOUNDARY is derived rather than assumed: the generator REFUSES to emit Motion from a server
 * module (deliberately, so a route is not silently clientized), so a subtree carrying an animation must
 * be declared client or saving it would throw at generate time with an error about the boundary rather
 * than about the block.
 */
export function savedBlockModule(block: BlockDefinition): ReactIrModule {
  return {
    version: REACT_IR_VERSION,
    id: `saved-block-${block.id}`,
    kind: 'component',
    path: pathForSavedBlock(block.name),
    symbol: symbolForBlock(block.name),
    rootNodeId: block.rootId,
    // NO props. The section is fixed content the author already arranged; inventing props would mean
    // guessing which parts they meant to vary, and a wrong guess produces controls that change nothing
    // anybody wanted.
    propsInterface: [],
    boundary: subtreeAnimates(block.subtree) ? 'client' : 'server',
    nodes: block.subtree,
  } as ReactIrModule
}

export type SavedBlockSource = Readonly<{ path: string; symbol: string; source: string }>

/**
 * Generates the component's source.
 *
 * Returns a REFUSAL rather than throwing, because the caller is a button an author pressed: an
 * exception crossing that boundary reads as the product breaking rather than as this section not being
 * saveable.
 */
export function savedBlockSource(block: BlockDefinition):
  | { ok: true; file: SavedBlockSource }
  | { ok: false; reason: string } {
  if (!(block.rootId in block.subtree)) {
    // MEASURED, not assumed: the generator emits an EMPTY component for a root it cannot find rather
    // than refusing, so without this a block with a missing root would save a component that inserts
    // and renders nothing - which reads as the block being broken rather than as the save being wrong.
    return {
      ok: false,
      reason: `"${block.rootId}" is not in this block, so it would save an empty component.`,
    }
  }
  const module = savedBlockModule(block)
  try {
    const generated = generateModule(module)
    return { ok: true, file: { path: module.path, symbol: module.symbol, source: generated.code } }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : `Could not generate a component for ${block.name}.`,
    }
  }
}

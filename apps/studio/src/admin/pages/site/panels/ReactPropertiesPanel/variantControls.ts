/**
 * Turns a component node's import specifier into its editable variant controls.
 *
 * THE MISSING LINK task 72 left. It derived controls from a shadcn component's own `cva(...)` source
 * and nothing consumed them, partly because no edit op could apply a value (now `setComponentProp`)
 * and partly because of THIS gap: a component node stores a module SPECIFIER
 * ('@/components/ui/button'), not source code, so a panel holding a node had no way to reach the
 * variants. Resolving the specifier to a repository path is what closes it.
 */
import { deriveCvaVariants, controlsFromVariants } from '@core/react-ir/cvaControls'
import type { PropertyControl } from '@core/react-ir/propertyControls'
import type { ModuleStore } from '@core/react-ir/workspace'

/**
 * Maps a tenant import specifier to the path the module store keys on.
 *
 * Returns NULL for anything outside the tenant's own tree — a bare package name like 'react' or
 * 'lucide-react' is not a file we hold, and guessing a path for it would produce a read that always
 * fails and a panel that always looks broken.
 */
export function pathForSpecifier(specifier: string): string | null {
  if (!specifier.startsWith('@/')) return null
  const withoutAlias = specifier.slice(2)
  if (withoutAlias === '' || withoutAlias.includes('..')) return null
  // The alias '@/x' maps to 'x' at the repository root, and shadcn components are emitted as .tsx.
  return withoutAlias.endsWith('.tsx') ? withoutAlias : `${withoutAlias}.tsx`
}

export type VariantControlsOutcome =
  | { kind: 'controls'; controls: Readonly<Record<string, PropertyControl>> }
  /** The component exists and simply has no variants — card, input and table are like this. */
  | { kind: 'none'; reason: string }
  /** Distinct from 'none': we could not look, so the panel must not claim there is nothing. */
  | { kind: 'unavailable'; reason: string }

/**
 * Reads the component's source and derives its controls.
 *
 * 'none' and 'unavailable' are DIFFERENT outcomes for the same reason task 80's analytics needed
 * three: reporting a failed read as "this component has no options" is a claim about the component
 * when the truth is about us, and it sends somebody looking for a bug in their own file.
 */
export async function variantControlsFor(
  specifier: string,
  store: ModuleStore,
): Promise<VariantControlsOutcome> {
  const path = pathForSpecifier(specifier)
  if (path === null) {
    return {
      kind: 'unavailable',
      reason: `${specifier} is not a file in this site, so its options cannot be read.`,
    }
  }
  let found: Awaited<ReturnType<ModuleStore['get']>>
  try {
    found = await store.get(path)
  } catch (error) {
    return {
      kind: 'unavailable',
      reason: error instanceof Error ? error.message : `Could not read ${path}.`,
    }
  }
  if (found === null) {
    // Absent is reported as unavailable rather than as "no variants": the component is imported by a
    // node that renders, so a missing file is a problem worth surfacing rather than an empty panel.
    return { kind: 'unavailable', reason: `${path} was not found, so its options cannot be read.` }
  }

  const derivation = deriveCvaVariants(found.source)
  const controls = controlsFromVariants(derivation.groups)
  if (Object.keys(controls).length === 0) {
    return {
      kind: 'none',
      // The derivation's own note is preferred over wording invented here, so the panel and the
      // deriver cannot disagree about why there is nothing to show.
      reason: derivation.notes[0]?.message
        ?? 'This component has no variant options. Its classes are edited on the canvas instead.',
    }
  }
  return { kind: 'controls', controls }
}

/**
 * The value currently set for a prop, read from the node's stored props.
 *
 * Returns undefined for an ABSENT prop rather than the cva default, because the two are different
 * facts: absent means the component decides, and showing the default as though it were chosen would
 * make a panel claim a decision nobody made.
 */
export function currentPropValue(
  props: Readonly<Record<string, unknown>> | undefined,
  name: string,
): string | number | boolean | undefined {
  const entry = props?.[name] as { kind?: unknown, expression?: { kind?: unknown, value?: unknown } } | undefined
  if (entry?.kind !== 'expression') return undefined
  if (entry.expression?.kind !== 'literal') return undefined
  const value = entry.expression.value
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : undefined
}

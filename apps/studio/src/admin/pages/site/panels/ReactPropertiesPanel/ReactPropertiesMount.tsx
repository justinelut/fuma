/**
 * Wires the properties panel to the selected node: derives its controls and applies a change.
 *
 * Separate from `ReactPropertiesPanel` so the panel stays presentational and testable without a store
 * or a network — this file is the part that reaches real state.
 */
import { useEffect, useMemo, useState } from 'react'
import { useReactEditorStore, useOpenModule, useSelection } from '@site/canvas/reactEditorStore'
import { createHttpModuleStore } from '@site/canvas/httpModuleStore'
import { ReactPropertiesPanel } from './ReactPropertiesPanel'
import { variantControlsFor, currentPropValue, type VariantControlsOutcome } from './variantControls'
import type { ModuleStore } from '@core/react-ir/workspace'

export type ReactPropertiesMountProps = Readonly<{
  /** Injectable so a test drives the panel without a network. */
  store?: ModuleStore
}>

export function ReactPropertiesMount({ store }: ReactPropertiesMountProps) {
  const module = useOpenModule()
  const selection = useSelection()
  const setProp = useReactEditorStore((state) => state.setProp)
  const [outcome, setOutcome] = useState<VariantControlsOutcome | null>(null)

  // Memoised so the effect below does not refetch on every render.
  const resolved = useMemo(() => store ?? createHttpModuleStore(), [store])

  const selectedId = selection.length === 1 ? selection[0]! : null
  const node = selectedId === null ? null : module?.nodes[selectedId] ?? null
  const specifier = node !== null && node.kind === 'component' ? node.component.source : null

  useEffect(() => {
    if (specifier === null) {
      setOutcome(null)
      return
    }
    let active = true
    void variantControlsFor(specifier, resolved).then((next) => {
      // Guarded so a resolve landing after the selection moved cannot describe the previous node.
      if (active) setOutcome(next)
    })
    return () => { active = false }
  }, [specifier, resolved])

  if (selectedId === null) {
    return (
      <p className="p-3 text-sm text-muted-foreground" role="status">
        {selection.length > 1
          ? 'Select a single component — a property applies to one component.'
          : 'Select a component to see its properties.'}
      </p>
    )
  }

  if (node !== null && node.kind !== 'component') {
    // Stated rather than shown empty: an element's classes are edited on the canvas, and an empty
    // panel here would read as a component whose options failed to load.
    return (
      <p className="p-3 text-sm text-muted-foreground">
        A {node.kind} has no component properties. Its classes are edited on the canvas.
      </p>
    )
  }

  if (outcome === null) {
    return <p className="p-3 text-sm text-muted-foreground" role="status" aria-busy="true">Reading properties…</p>
  }

  if (outcome.kind === 'unavailable') {
    // A failed read is reported as OURS rather than as the component having no options, so nobody goes
    // looking for a bug in their own file.
    return <p className="p-3 text-sm text-destructive" role="alert">{outcome.reason}</p>
  }

  if (outcome.kind === 'none') {
    return <p className="p-3 text-sm text-muted-foreground">{outcome.reason}</p>
  }

  const props = node !== null && node.kind === 'component' ? node.props : undefined
  const values = Object.fromEntries(
    Object.keys(outcome.controls).map((name) => [name, currentPropValue(props, name)]),
  )

  return (
    <ReactPropertiesPanel
      controls={outcome.controls}
      values={values}
      onChange={(name, value) => setProp(name, value)}
    />
  )
}

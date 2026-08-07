/**
 * The properties panel for a React IR component node.
 *
 * This is where task 72's derived cva controls finally become something an author can use. Presentational
 * on purpose: it takes the controls, the current values and a change callback, so a test drives it
 * without a store or a network.
 */
import { Label } from '@admin/fuma/ui/label'
import { Button } from '@admin/fuma/ui/button'
import type { PropertyControl } from '@core/react-ir/propertyControls'

/** Above this many options a row of buttons wraps into an unreadable grid, so a select is clearer. */
const SEGMENTED_LIMIT = 4

export type ReactPropertiesPanelProps = Readonly<{
  /** Derived from the component's own source, so the panel cannot offer a prop it does not accept. */
  controls: Readonly<Record<string, PropertyControl>>
  /** Only the values actually SET. An absent entry means the component's own default applies. */
  values: Readonly<Record<string, string | number | boolean | undefined>>
  onChange: (name: string, value: string | null) => void
}>

function optionsOf(control: PropertyControl): readonly string[] {
  return 'options' in control && Array.isArray(control.options)
    ? (control.options as readonly string[])
    : []
}

export function ReactPropertiesPanel({ controls, values, onChange }: ReactPropertiesPanelProps) {
  const names = Object.keys(controls).sort()
  if (names.length === 0) {
    return (
      <p className="p-3 text-sm text-muted-foreground">
        This component has no options to configure. Its classes are edited on the canvas.
      </p>
    )
  }

  return (
    <div className="grid gap-4 p-3" data-testid="react-properties-panel">
      {names.map((name) => {
        const control = controls[name]!
        const options = optionsOf(control)
        const current = values[name]
        const label = 'title' in control && typeof control.title === 'string' ? control.title : name
        const fieldId = `react-prop-${name}`

        return (
          <div key={name} className="grid gap-2">
            <Label htmlFor={fieldId}>{label}</Label>

            {options.length === 0 ? (
              // A control with no options cannot be rendered as a choice, and inventing a text field
              // would let somebody type a value the component does not accept.
              <p className="text-sm text-muted-foreground">No options are declared for this property.</p>
            ) : options.length <= SEGMENTED_LIMIT ? (
              <div className="flex flex-wrap gap-1" role="group" aria-label={label} id={fieldId}>
                {options.map((option) => (
                  <Button
                    key={option}
                    type="button"
                    size="sm"
                    variant={current === option ? 'secondary' : 'ghost'}
                    // Announced rather than only shaded — colour alone is not a label.
                    aria-pressed={current === option}
                    onClick={() => onChange(name, current === option ? null : option)}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            ) : (
              <select
                id={fieldId}
                className="rounded-md border border-input bg-background p-2 text-sm"
                // The empty option is a real choice, not a placeholder: clearing the prop returns the
                // component to its own default, which is different from any explicit value.
                value={typeof current === 'string' ? current : ''}
                onChange={(event) => onChange(name, event.target.value === '' ? null : event.target.value)}
              >
                <option value="">Default</option>
                {options.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            )}

            {current === undefined && (
              // Stated rather than left blank, so "nothing chosen" does not read as a control that
              // failed to load.
              <p className="text-xs text-muted-foreground">
                Not set — the component&apos;s own default applies.
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

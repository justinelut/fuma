/**
 * The canvas animation panel.
 *
 * Renders whatever `animationPanel()` describes, so adding a field to the Motion model
 * puts it on screen without touching this file. Composed strictly from shadcn components.
 *
 * The behaviour worth noting: a field with no current effect is rendered **disabled with
 * its reason attached** rather than hidden. Hiding it would leave a designer looking for a
 * stiffness control that exists but is not shown, and would give no clue that switching to
 * a spring is what brings it back. Showing it enabled would be worse — it would accept a
 * value Motion silently ignores.
 */

import { useMemo } from 'react'
import { AlertTriangle, Sparkles } from 'lucide-react'
import {
  ANIMATION_PRESETS,
  animationPanel,
  applyPreset,
  setPanelField,
  type PanelField,
} from '@core/react-ir/animationPanel'
import type { MotionAnimation } from '@core/react-ir/motion'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@admin/fuma/ui/accordion'
import { Alert, AlertDescription } from '@admin/fuma/ui/alert'
import { Button } from '@admin/fuma/ui/button'
import { Input } from '@admin/fuma/ui/input'
import { Label } from '@admin/fuma/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@admin/fuma/ui/select'
import { Switch } from '@admin/fuma/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@admin/fuma/ui/tooltip'

export type AnimationPanelProps = {
  animation: MotionAnimation
  /** True when an ancestor declares AnimatePresence, so exit warnings are accurate. */
  hasPresenceAncestor?: boolean
  /**
   * Which sections start open.
   *
   * The caller decides because it knows the context: opening "In view" straight after the
   * author adds a scroll animation puts them where the next decision is, rather than
   * making them hunt for it.
   */
  defaultOpenSections?: readonly string[]
  onChange: (animation: MotionAnimation) => void
}

export function AnimationPanel({
  animation,
  hasPresenceAncestor,
  defaultOpenSections = ['states', 'timing'],
  onChange,
}: AnimationPanelProps) {
  const panel = useMemo(
    () => animationPanel(animation, { hasPresenceAncestor }),
    [animation, hasPresenceAncestor],
  )

  return (
    <div className="flex flex-col gap-4 p-4">
      <section aria-labelledby="animation-presets" className="flex flex-col gap-2">
        <h3 id="animation-presets" className="text-sm font-medium text-foreground">
          Presets
        </h3>
        {/* Its own provider: there is no global one, and a panel that works only when
            mounted under the sidebar is fragile. */}
        <TooltipProvider delayDuration={200}>
          <div className="flex flex-wrap gap-2">
            {ANIMATION_PRESETS.map((preset) => (
            <Tooltip key={preset.id}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const applied = applyPreset(preset.id, animation)
                    if (applied) onChange(applied.animation)
                  }}
                >
                  <Sparkles aria-hidden="true" className="size-3.5" />
                  {preset.title}
                </Button>
              </TooltipTrigger>
              {/* States what the preset produces, so it is a shortcut rather than a
                  black box. */}
              <TooltipContent>{preset.describe}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
      </section>

      {panel.warnings.length > 0 && (
        <div className="flex flex-col gap-2" role="status">
          {panel.warnings.map((warning) => (
            <Alert key={warning} variant="destructive">
              <AlertTriangle aria-hidden="true" className="size-4" />
              <AlertDescription>{warning}</AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      <Accordion type="multiple" defaultValue={[...defaultOpenSections]}>
        {panel.sections.map((section) => (
          <AccordionItem key={section.id} value={section.id}>
            <AccordionTrigger className="text-sm">{section.title}</AccordionTrigger>
            <AccordionContent>
              <div className="flex flex-col gap-3 pt-1">
                {section.fields.map((field) => (
                  <FieldRow
                    key={field.key}
                    field={field}
                    onChange={(value) => onChange(setPanelField(animation, field.key, value))}
                  />
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  )
}

function FieldRow({
  field,
  onChange,
}: {
  field: PanelField
  onChange: (value: unknown) => void
}) {
  const controlId = `animation-${field.key.replace(/\./g, '-')}`
  const describedBy = field.inactive ? `${controlId}-reason` : undefined
  const disabled = field.inactive !== null

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label
          htmlFor={controlId}
          className={disabled ? 'text-muted-foreground' : undefined}
        >
          {field.label}
        </Label>
        {field.kind === 'boolean' && (
          <Switch
            id={controlId}
            checked={field.value === true}
            disabled={disabled}
            aria-describedby={describedBy}
            onCheckedChange={(checked) => onChange(checked ? true : undefined)}
          />
        )}
      </div>

      {field.kind === 'number' && (
        <Input
          id={controlId}
          type="number"
          inputMode="decimal"
          value={field.value === undefined ? '' : String(field.value)}
          min={field.min}
          max={field.max}
          step={field.step}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(event) => {
            const raw = event.target.value
            // An empty control means "no opinion", which is not the same as zero: zero
            // duration is a real instruction to skip the animation.
            onChange(raw === '' ? undefined : Number(raw))
          }}
        />
      )}

      {(field.kind === 'text' || field.kind === 'target') && (
        <Input
          id={controlId}
          type="text"
          value={typeof field.value === 'string' ? field.value : formatTarget(field.value)}
          disabled={disabled || field.kind === 'target'}
          aria-describedby={describedBy}
          placeholder={field.kind === 'target' ? 'Edit on the canvas' : undefined}
          onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
        />
      )}

      {field.kind === 'enum' && (
        <Select
          value={field.value === undefined ? undefined : String(field.value)}
          disabled={disabled}
          onValueChange={(value) => onChange(value)}
        >
          <SelectTrigger id={controlId} aria-describedby={describedBy}>
            <SelectValue placeholder="Default" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option} value={option}>{option}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {field.inactive && (
        <p id={describedBy} className="text-xs text-muted-foreground">
          {field.inactive.message}
        </p>
      )}
    </div>
  )
}

/**
 * Show a target as a readable summary.
 *
 * Targets are edited by manipulating the element on canvas, not by typing JSON, so this is
 * a read-only description rather than an input.
 */
function formatTarget(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'enabled' : 'disabled'
  if (typeof value !== 'object' || value === null) return String(value)
  const entries = Object.entries(value as Record<string, unknown>)
  return entries.map(([property, target]) => `${property}: ${String(target)}`).join(', ')
}

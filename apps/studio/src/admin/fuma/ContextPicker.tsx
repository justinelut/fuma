/**
 * A context picker that stays usable as the number of choices grows.
 *
 * THE DEFECT: every organization, workspace and site was rendered as an option in a plain select. That
 * is right for three sites and unusable for three hundred — no search, no way to jump, and a list you
 * scroll past the thing you wanted. An agency or a staff account with many tenants could not reach a
 * site at all without scrolling a list ordered by somebody else's idea of relevance.
 *
 * TWO BEHAVIOURS, CHOSEN BY COUNT, and the switch is the point:
 *
 *   Few choices  -> a plain select. One click, pick, done. Making somebody type to choose between three
 *                   sites is a regression dressed as a feature.
 *   Many choices -> a searchable list. Typing is the only thing that scales, because it is the only
 *                   interaction whose cost does not grow with the number of options.
 *
 * SEARCHABLE_THRESHOLD is where scrolling stops being faster than typing. It is a judgement, but it is
 * ONE judgement in ONE place rather than a different answer on each surface.
 */
import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './ui/command'
import { Select } from '@ui/components/Select'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { cn } from './ui/cn'

/** Above this many choices, scrolling costs more than typing. */
export const SEARCHABLE_THRESHOLD = 8

/**
 * How many matches are rendered at once.
 *
 * A list of five thousand rows is slow to build and slower to paint, and nobody reads past the first
 * screen anyway. Capping is only honest if the cap is VISIBLE, so the count of hidden matches is
 * reported — otherwise a site that exists appears not to, which is worse than a long list.
 */
export const VISIBLE_MATCH_LIMIT = 50

export interface PickerChoice {
  value: string
  label: string
  /** Secondary line, e.g. which workspace a site belongs to. Disambiguates identical names. */
  hint?: string
}

export interface ContextPickerProps {
  id: string
  /**
   * SINGULAR field name, matching the visible label the caller renders.
   *
   * Used to build the search placeholder and the trigger's accessible name. Deliberately not applied
   * as an aria-label on the short-list select, because the caller already associates a real <label>
   * and an aria-label would override it - renaming a field that was correctly labelled.
   */
  label: string
  value: string
  choices: readonly PickerChoice[]
  onChange: (value: string) => void
}

export function matchChoices(
  choices: readonly PickerChoice[],
  query: string,
): readonly PickerChoice[] {
  const trimmed = query.trim().toLowerCase()
  if (trimmed.length === 0) return choices
  // Label and hint are both searched: somebody looking for a site often remembers the client rather
  // than the site's name.
  return choices.filter((choice) => (
    choice.label.toLowerCase().includes(trimmed)
    || (choice.hint ?? '').toLowerCase().includes(trimmed)
  ))
}

export function ContextPicker({ id, label, value, choices, onChange }: ContextPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selected = choices.find((choice) => choice.value === value)
  const searchable = choices.length > SEARCHABLE_THRESHOLD

  const matches = useMemo(() => matchChoices(choices, query), [choices, query])
  const visible = matches.slice(0, VISIBLE_MATCH_LIMIT)
  const hidden = matches.length - visible.length

  if (!searchable) {
    // THE SHARED Select, unchanged. A short list already worked, and swapping the control would have
    // changed the interaction (and the accessible name) on every surface that renders three sites - a
    // regression paid for nothing. Only the long-list path is new.
    return (
      <Select
        id={id}
        fieldSize="sm"
        value={value}
        options={choices.map((choice) => ({ value: choice.value, label: choice.label }))}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }

  return (
    <Popover open={open} onOpenChange={(next) => {
      setOpen(next)
      // Cleared on close so reopening does not start inside a stale filter, which reads as most of the
      // list having disappeared.
      if (!next) setQuery('')
    }}>
      <PopoverTrigger
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-label={`${label}: ${selected?.label ?? 'none selected'}. ${choices.length} to choose from`}
        className={cn(
          'flex h-8 w-full items-center justify-between gap-2 rounded-md border border-border',
          'bg-background px-2.5 text-left text-[0.8125rem] text-foreground transition-colors',
          'hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        )}
      >
        <span className="min-w-0 truncate">{selected?.label ?? 'Select…'}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[18rem] p-0">
        {/* shouldFilter is off because matchChoices does the filtering: it also searches the hint, and
            it is what the cap and the hidden-count are computed from. Two filters would disagree. */}
        <Command shouldFilter={false}>
          <div className="flex items-center gap-2 border-b border-border px-2.5">
            <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={`Search ${choices.length} ${label.toLowerCase()}s…`}
              className="h-9 border-0 px-0 focus-visible:ring-0"
            />
          </div>
          <CommandList>
            <CommandEmpty>Nothing matches “{query}”.</CommandEmpty>
            <CommandGroup>
              {visible.map((choice) => (
                <CommandItem
                  key={choice.value}
                  value={choice.value}
                  onSelect={() => {
                    setOpen(false)
                    setQuery('')
                    // Selecting the current value is a no-op rather than a navigation, so a stray click
                    // does not reload the surface the user is already on.
                    if (choice.value !== value) onChange(choice.value)
                  }}
                  className="gap-2"
                >
                  <Check
                    className={cn(
                      'size-3.5 shrink-0',
                      choice.value === value ? 'opacity-100' : 'opacity-0',
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{choice.label}</span>
                    {choice.hint ? (
                      <span className="block truncate text-[0.6875rem] text-muted-foreground">
                        {choice.hint}
                      </span>
                    ) : null}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            {hidden > 0 ? (
              // Stated rather than silently truncated: a site that exists but is not listed reads as
              // deleted, and somebody will go looking for it in the wrong place.
              <p className="border-t border-border px-3 py-2 text-[0.6875rem] text-muted-foreground">
                {hidden} more match{hidden === 1 ? '' : 'es'} — keep typing to narrow it down.
              </p>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

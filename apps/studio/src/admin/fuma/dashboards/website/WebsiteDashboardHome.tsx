/**
 * Website dashboard content.
 *
 * The bento from docs/reference/design/dribbble-website-dashboard.png, matched
 * structurally: a four-column grid over two rows where the fourth column is one
 * tall card spanning both rows, the first column carries the feature card above
 * an accordion, and the middle two columns carry two metric cards above one wide
 * card.
 *
 * The reference's card vocabulary is reproduced exactly — arrow-out affordance
 * in each metric card header, a thin-bar chart with one highlighted bar and a
 * floating value pill, a ticked circular dial with transport controls, a
 * segmented progress row with labelled percentages, and a nested dark checklist
 * with icon tiles and completion marks. The figures behind them are real
 * platform state; a series with nothing in it says so.
 */
import { useState } from 'react'
import { Link } from '@admin/lib/routing'
import { ButtonLink, Card } from '../../ui/primitives'
import { GROUP, GROUP_GAP, RELATED, RELATED_GAP, SECTION, TIGHT } from '../../ui/rhythm'
import { cn } from '../../ui/cn'

export type SetupStep = Readonly<{
  id: string
  title: string
  description: string
  completed: boolean
}>

export type PlatformArea = Readonly<{
  id: string
  label: string
  detail: string
  path: string
}>

export interface WebsiteDashboardHomeProps {
  siteName: string
  builderPath: string
  publicUrl: string | null
  steps: readonly SetupStep[]
  areas: readonly PlatformArea[]
}

/** Builder workspaces. The platform reproduces none of them. */
const BUILDER_SECTIONS: readonly Readonly<{
  path: string
  label: string
  detail: string
}>[] = Object.freeze([
  { path: '/admin/dashboard', label: 'Insights', detail: 'Site stats and activity' },
  { path: '/admin/site', label: 'Canvas', detail: 'Design and layout' },
  { path: '/admin/content', label: 'Content', detail: 'Write posts and entries' },
  { path: '/admin/data', label: 'Data', detail: 'Collections and rows' },
  { path: '/admin/media', label: 'Media', detail: 'Files and folders' },
  { path: '/admin/plugins', label: 'Plugins', detail: 'Installed extensions' },
])

/** The small circular arrow-out affordance each metric card carries. */



const AREA_PATHS: Readonly<Record<string, string>> = {
  'nav.bookings': 'M3 6.2h10M4.6 3.4v1.6M11.4 3.4v1.6M3 6.2h10v6.4H3z',
  'nav.website-analytics': 'M3.4 12.6V8.4M6.8 12.6V5M10.2 12.6V9M13.6 12.6V3.4',
  'nav.domains': 'M8 2.6a5.4 5.4 0 1 0 0 10.8A5.4 5.4 0 0 0 8 2.6ZM2.6 8h10.8M8 2.6c1.7 1.7 1.7 9.1 0 10.8',
  'nav.team': 'M6 6.4a2 2 0 1 0 0-.1ZM2.6 13c.3-2 1.7-3.2 3.4-3.2S9.1 11 9.4 13M11 5.4a1.8 1.8 0 0 1 0 3.6M11.8 10c1.2.3 2 1.4 2.2 3',
  'nav.settings': 'M8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M12.4 3.6l-1 1M4.6 11.4l-1 1',
}

function AreaIcon({ id }: { id: string }) {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
      <path
        d={AREA_PATHS[id] ?? 'M3 4h10M3 8h10M3 12h6'}
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}


function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
      aria-hidden="true"
      fill="none"
    >
      <path d="m4 6.5 4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Ticked dial, as the reference's time tracker draws it. */

export function WebsiteDashboardHome({
  siteName,
  builderPath,
  publicUrl,
  steps,
  areas,
}: WebsiteDashboardHomeProps) {
  const [openArea, setOpenArea] = useState<string | null>(areas[0]?.id ?? null)
  const completed = steps.filter((step) => step.completed).length
  const nextIndex = steps.findIndex((step) => !step.completed)
  const remaining = Math.max(0, steps.length - completed)

  const nextStep = nextIndex >= 0 ? steps[nextIndex] : null

  return (
    <div>
      {/*
        ONBOARDING AS AN OPEN SURFACE, NOT A CARD — and there is now ONE of it.

        This dashboard previously rendered the same `steps` data FOUR times: a bar-chart card
        ("Setup"), a dial card ("Readiness"), a segmented bar with a percentage, and the task list.
        Three of those were cards. That is the card overuse and the redundancy in one: a reader had to
        work out that four panels were four drawings of one number, and the answer to "how far along am
        I" was in every one of them and settled by none.

        So the two decorative restatements are gone, and what remains is one progress surface with no
        card chrome. Progress is the page's own state rather than an item on it, so boxing it made it
        look like one panel among peers — the opposite of its importance.
      */}
      <section aria-labelledby="onboarding-heading">
        <div className={cn('flex flex-wrap items-end justify-between', RELATED_GAP)}>
          <div className="min-w-0">
            <h2
              id="onboarding-heading"
              className="text-[0.9375rem] leading-snug font-semibold tracking-tight text-foreground"
            >
              Getting {siteName} ready
            </h2>
            <p className={cn('text-xs text-muted-foreground', TIGHT)}>
              {remaining === 0
                ? 'Everything is set up.'
                : nextStep
                  ? `Next: ${nextStep.title}`
                  : `${remaining} remaining`}
            </p>
          </div>
          {/* The figure sits with the steps it counts, so the number and its meaning read together. */}
          <p className="flex items-baseline gap-1.5 tabular-nums">
            <span className="text-[2rem] leading-none font-semibold tracking-tight text-foreground">
              {completed}
            </span>
            <span className="text-xs text-muted-foreground">of {steps.length} done</span>
          </p>
        </div>

        {/* One rail, one reading. Each segment is a step; the next one is distinguishable so the
            answer to "what do I do now" is visible without reading the list. */}
        <ol className={cn('flex items-stretch', RELATED_GAP, GROUP)}>
          {steps.map((step, index) => {
            const isNext = index === nextIndex
            return (
              <li key={step.id} className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block h-1.5 rounded-full transition-colors',
                    step.completed
                      ? 'bg-primary'
                      : isNext
                        ? 'bg-primary/45'
                        : 'bg-border',
                  )}
                />
                <span
                  className={cn(
                    'mt-2 block truncate text-[0.6875rem] leading-snug',
                    isNext
                      ? 'font-medium text-foreground'
                      : step.completed
                        ? 'text-muted-foreground'
                        : 'text-muted-foreground/70',
                  )}
                  title={step.title}
                >
                  {step.title}
                </span>
              </li>
            )
          })}
        </ol>

        {nextStep ? (
          <div className={cn('flex flex-wrap items-center', RELATED_GAP, GROUP)}>
            <p className="min-w-0 flex-1 text-[0.8125rem] leading-relaxed text-muted-foreground">
              {nextStep.description}
            </p>
            <ButtonLink href={builderPath} variant="accent" size="md">
              Open visual builder
            </ButtonLink>
            {publicUrl ? (
              <ButtonLink
                href={publicUrl}
                variant="outline"
                size="md"
                target="_blank"
                rel="noreferrer noopener"
              >
                View site
              </ButtonLink>
            ) : null}
          </div>
        ) : (
          <div className={cn('flex flex-wrap items-center', RELATED_GAP, GROUP)}>
            <ButtonLink href={builderPath} variant="accent" size="md">
              Open visual builder
            </ButtonLink>
            {publicUrl ? (
              <ButtonLink
                href={publicUrl}
                variant="outline"
                size="md"
                target="_blank"
                rel="noreferrer noopener"
              >
                View site
              </ButtonLink>
            ) : null}
          </div>
        )}
      </section>

      <div className={cn('grid items-start lg:grid-cols-3', GROUP_GAP, SECTION)}>




      {/* Accordion list, first column second row. The reference expands one row
          into a detail line with an icon tile and a trailing action. */}
      <Card className="py-2">
        <ul className="divide-y divide-border">
          {areas.map((area) => {
            const open = openArea === area.id
            return (
              <li key={area.id}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-[var(--radius-md)]',
                    'px-1 py-3 text-left transition-colors hover:bg-accent/60',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  )}
                  aria-expanded={open}
                  onClick={() => setOpenArea(open ? null : area.id)}
                >
                  <span className="min-w-0 truncate text-sm text-foreground">{area.label}</span>
                  <Chevron open={open} />
                </button>
                {open ? (
                  <div className="pb-3">
                    <Link
                      to={area.path}
                      className={cn(
                        'flex items-center gap-3 rounded-[var(--radius-md)] px-1 py-2',
                        'transition-colors hover:bg-accent/60',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                      )}
                    >
                      <span
                        className={cn(
                          'inline-flex size-9 shrink-0 items-center justify-center',
                          'rounded-[var(--radius-md)] bg-muted text-foreground',
                        )}
                        aria-hidden="true"
                      >
                        <AreaIcon id={area.id} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.8125rem] text-foreground">
                          Open {area.label.toLowerCase()}
                        </span>
                        <span className="block truncate text-[0.6875rem] text-muted-foreground">
                          {area.detail}
                        </span>
                      </span>
                      <span className="shrink-0 text-muted-foreground" aria-hidden="true">
                        <svg viewBox="0 0 16 16" className="size-4" fill="none">
                          <path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </Link>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      </Card>

      </div>

      {/* A plain section, not a card of cards: the tiles are the surfaces here. */}
      <section className={SECTION}>
        <div className={cn('flex flex-wrap items-baseline justify-between px-1', RELATED_GAP)}>
          <h2 className="text-[0.9375rem] leading-snug font-semibold tracking-tight text-foreground">
            Visual builder
          </h2>
          <p className="text-[0.6875rem] text-muted-foreground">
            Everything about the site itself lives here
          </p>
        </div>
        <ul className={cn('grid sm:grid-cols-2 lg:grid-cols-3', RELATED_GAP, RELATED)}>
          {BUILDER_SECTIONS.map((section) => (
            <li key={section.path}>
              <a
                href={section.path}
                className={cn(
                  'flex h-full flex-col justify-between gap-3 rounded-[var(--radius-md)]',
                  'border border-border bg-background p-3.5 transition-colors',
                  'hover:border-primary/40 hover:bg-muted',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                )}
              >
                <span className="text-sm font-medium text-foreground">{section.label}</span>
                <span className="text-[0.6875rem] leading-snug text-muted-foreground">
                  {section.detail}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

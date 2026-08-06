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
import { Badge, ButtonLink, Card, CardCaption, CardTitle } from '../../ui/primitives'
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
function ArrowOut({ to }: { to: string }) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-full',
        'border border-dash-hairline text-dash-ink transition-colors hover:bg-dash-rail',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dash-ink',
      )}
      aria-label="Open"
    >
      <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
        <path d="M5.5 10.5l5-5M6.5 5.5h4v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  )
}

function CheckMark({ done }: { done: boolean }) {
  return done
    ? (
      <svg viewBox="0 0 16 16" className="size-4 text-dash-accent" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="currentColor" />
        <path d="m5 8.2 2 2 4-4.2" stroke="#ffffff" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
    : (
      <svg viewBox="0 0 16 16" className="size-4 text-white/25" aria-hidden="true">
        <circle cx="8" cy="8" r="6.2" fill="currentColor" />
      </svg>
    )
}

function StepTile({ index }: { index: number }) {
  return (
    <span
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-[0.625rem]',
        'bg-white/10 text-[0.625rem] font-semibold text-white/70',
      )}
      aria-hidden="true"
    >
      {String(index + 1).padStart(2, '0')}
    </span>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn('size-4 shrink-0 text-dash-ink-muted transition-transform', open && 'rotate-180')}
      aria-hidden="true"
      fill="none"
    >
      <path d="m4 6.5 4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Ticked dial, as the reference's time tracker draws it. */
function Dial({ percent }: { percent: number }) {
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const dash = (Math.max(0, Math.min(100, percent)) / 100) * circumference
  const ticks = Array.from({ length: 60 }, (_, index) => index)
  return (
    <svg viewBox="0 0 140 140" className="size-[150px]" role="img" aria-label={`${percent}% complete`}>
      {ticks.map((tick) => {
        const angle = (tick / ticks.length) * Math.PI * 2 - Math.PI / 2
        const inner = 62
        const outer = tick % 5 === 0 ? 68 : 65
        return (
          <line
            key={tick}
            x1={70 + Math.cos(angle) * inner}
            y1={70 + Math.sin(angle) * inner}
            x2={70 + Math.cos(angle) * outer}
            y2={70 + Math.sin(angle) * outer}
            stroke="var(--color-dash-ink)"
            strokeOpacity={tick % 5 === 0 ? 0.35 : 0.16}
            strokeWidth="1"
          />
        )
      })}
      <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--color-dash-rail)" strokeWidth="9" />
      <circle
        cx="70"
        cy="70"
        r={radius}
        fill="none"
        stroke="var(--color-dash-accent)"
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference}`}
        transform="rotate(-90 70 70)"
      />
      <text
        x="70"
        y="68"
        textAnchor="middle"
        className="fill-dash-ink"
        style={{ fontSize: '1.6rem', fontWeight: 600, letterSpacing: '-0.02em' }}
      >
        {percent}%
      </text>
      <text x="70" y="86" textAnchor="middle" className="fill-dash-ink-muted" style={{ fontSize: '0.6rem' }}>
        Ready
      </text>
    </svg>
  )
}

export function WebsiteDashboardHome({
  siteName,
  builderPath,
  publicUrl,
  steps,
  areas,
}: WebsiteDashboardHomeProps) {
  const [openArea, setOpenArea] = useState<string | null>(areas[0]?.id ?? null)
  const completed = steps.filter((step) => step.completed).length
  const percent = steps.length === 0 ? 100 : Math.round((completed / steps.length) * 100)
  const nextIndex = steps.findIndex((step) => !step.completed)
  const remaining = Math.max(0, steps.length - completed)

  return (
    <div className="grid items-start gap-4 lg:grid-cols-4">
      {/* Feature card — the reference's tall portrait card position. */}
      <Card tone="ink" className="flex min-h-[248px] flex-col justify-between">
        <div>
          <Badge variant="accent" size="sm">Design</Badge>
          <p className="mt-6 text-xl leading-tight font-semibold tracking-tight">{siteName}</p>
          <p className="mt-2 text-xs leading-relaxed text-white/55">
            The visual builder designs and manages this site. Opening it hands
            over the whole screen — canvas, content, media and data.
          </p>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <ButtonLink href={builderPath} variant="accent" size="md">
            Open visual builder
          </ButtonLink>
          {publicUrl ? (
            <ButtonLink
              href={publicUrl}
              variant="ghostDark"
              size="md"
              target="_blank"
              rel="noreferrer noopener"
            >
              View site
            </ButtonLink>
          ) : null}
        </div>
      </Card>

      {/* Bar-chart card with the highlighted bar and floating value pill. */}
      <Card className="flex min-h-[248px] flex-col">
        <div className="flex items-start justify-between gap-3">
          <CardTitle>Setup</CardTitle>
          <ArrowOut to={areas[0]?.path ?? builderPath} />
        </div>
        <div className="mt-3 flex items-end gap-2">
          <p className="text-[1.9rem] leading-none font-semibold tracking-tight text-dash-ink">
            {completed}
          </p>
          <p className="pb-0.5 text-[0.6875rem] leading-tight text-dash-ink-muted">
            of {steps.length}
            <br />
            steps done
          </p>
        </div>
        <div className="relative mt-auto flex h-[104px] items-end gap-3 pt-7">
          {nextIndex >= 0 ? (
            <span
              className={cn(
                'absolute top-0 rounded-full bg-dash-accent px-2 py-1',
                'text-[0.625rem] font-medium text-white',
              )}
              style={{
                left: `${((nextIndex + 0.5) / Math.max(1, steps.length)) * 100}%`,
                transform: 'translateX(-50%)',
              }}
            >
              {remaining} left
            </span>
          ) : null}
          {steps.map((step, index) => (
            <div key={step.id} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <span
                className={cn(
                  'w-[5px] rounded-full',
                  step.completed
                    ? 'bg-dash-ink'
                    : index === nextIndex
                      ? 'bg-dash-accent'
                      : 'bg-dash-rail',
                )}
                style={{ height: `${step.completed ? 100 : index === nextIndex ? 72 : 34}%` }}
                title={step.title}
              />
              <span className="text-[0.625rem] text-dash-ink-muted">{index + 1}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Dial card with transport controls, as the reference's time tracker. */}
      <Card tone="warm" className="flex min-h-[248px] flex-col">
        <div className="flex items-start justify-between gap-3">
          <CardTitle>Readiness</CardTitle>
          <ArrowOut to={builderPath} />
        </div>
        <div className="mt-1 grid flex-1 place-items-center">
          <Dial percent={percent} />
        </div>
        <div className="mt-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ButtonLink href={builderPath} variant="outline" size="iconSm" aria-label="Open builder">
              <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
                <path d="M5.5 3.5l7 4.5-7 4.5v-9Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
            </ButtonLink>
            {publicUrl ? (
              <ButtonLink
                href={publicUrl}
                variant="outline"
                size="iconSm"
                aria-label="View published site"
                target="_blank"
                rel="noreferrer noopener"
              >
                <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
                  <circle cx="8" cy="8" r="5.4" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M2.6 8h10.8M8 2.6c1.6 1.7 1.6 9.1 0 10.8" stroke="currentColor" strokeWidth="1.3" />
                </svg>
              </ButtonLink>
            ) : null}
          </div>
          <span
            className={cn(
              'inline-flex size-9 items-center justify-center rounded-full',
              'bg-dash-ink text-dash-surface',
            )}
            aria-hidden="true"
          >
            <svg viewBox="0 0 16 16" className="size-4" fill="none">
              <circle cx="8" cy="8.4" r="5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M8 6.2v2.4l1.6 1M6 2.4h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </span>
        </div>
      </Card>

      {/* Tall card spanning both rows, with the nested dark checklist. */}
      <Card className="flex flex-col lg:row-span-2">
        <div className="flex items-baseline justify-between">
          <CardTitle>Onboarding</CardTitle>
          <span className="text-sm font-semibold text-dash-ink">{percent}%</span>
        </div>
        <div className="mt-4 flex items-end gap-1.5">
          {[
            { label: `${percent}%`, className: 'bg-dash-accent' },
            { label: `${Math.max(0, 100 - percent)}%`, className: 'bg-dash-ink' },
            { label: '0%', className: 'bg-dash-rail' },
          ].map((segment) => (
            <span key={segment.label + segment.className} className="flex-1">
              <span className="mb-1.5 block text-[0.625rem] text-dash-ink-muted">{segment.label}</span>
              <span className={cn('block h-2 rounded-full', segment.className)} />
            </span>
          ))}
        </div>
        <div className="mt-4 flex-1 rounded-[var(--radius-bento-inner)] bg-dash-ink p-4 text-dash-surface">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium">Onboarding task</p>
            <p className="text-sm font-semibold">{completed}/{steps.length}</p>
          </div>
          <ul className="mt-4 space-y-3.5">
            {steps.map((step, index) => (
              <li key={step.id} className="flex items-center gap-3">
                <StepTile index={index} />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block truncate text-xs',
                      step.completed ? 'text-white/40 line-through' : 'text-white',
                    )}
                  >
                    {step.title}
                  </span>
                  <span className="block truncate text-[0.625rem] text-white/35">
                    {step.description}
                  </span>
                </span>
                <CheckMark done={step.completed} />
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {/* Accordion list, first column second row. */}
      <Card>
        <ul className="divide-y divide-dash-hairline">
          {areas.map((area) => {
            const open = openArea === area.id
            return (
              <li key={area.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 py-3 text-left"
                  aria-expanded={open}
                  onClick={() => setOpenArea(open ? null : area.id)}
                >
                  <span className="text-sm text-dash-ink">{area.label}</span>
                  <Chevron open={open} />
                </button>
                {open ? (
                  <div className="pb-3">
                    <p className="text-xs leading-relaxed text-dash-ink-muted">{area.detail}</p>
                    <Link
                      to={area.path}
                      className={cn(
                        'mt-2 inline-block text-xs font-medium text-dash-ink',
                        'underline decoration-dash-accent decoration-2 underline-offset-4',
                      )}
                    >
                      Open {area.label.toLowerCase()}
                    </Link>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      </Card>

      {/* Wide card across the middle columns, the reference's calendar slot. */}
      <Card className="lg:col-span-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Visual builder</CardTitle>
          <CardCaption>Everything about the site itself lives here</CardCaption>
        </div>
        <ul className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {BUILDER_SECTIONS.map((section) => (
            <li key={section.path}>
              <a
                href={section.path}
                className={cn(
                  'flex h-full flex-col justify-between gap-3 rounded-[var(--radius-bento-inner)]',
                  'border border-dash-hairline bg-dash-surface p-3.5 transition-colors',
                  'hover:border-dash-accent/40 hover:bg-dash-card-warm',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dash-ink',
                )}
              >
                <span className="text-sm font-medium text-dash-ink">{section.label}</span>
                <span className="text-[0.6875rem] leading-snug text-dash-ink-muted">
                  {section.detail}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

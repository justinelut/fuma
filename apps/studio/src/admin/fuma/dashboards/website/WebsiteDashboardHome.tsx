/**
 * Website dashboard content.
 *
 * The bento from docs/reference/design/dribbble-website-dashboard.png, with the
 * reference's card vocabulary carrying real platform state:
 *
 *  - the feature card is the handoff into Instatic, which owns site design;
 *  - the bar-chart card shows setup steps with the next one highlighted;
 *  - the ring card shows readiness;
 *  - the segmented card nests a dark checklist of the real onboarding steps;
 *  - the accordion lists platform areas;
 *  - the wide card is the Instatic launcher, because Instatic already owns
 *    insights, pages, content, data, media and plugins.
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

/** Instatic's own workspaces. The hosted product reproduces none of them. */
const INSTATIC_SECTIONS: readonly Readonly<{
  path: string
  label: string
  detail: string
}>[] = Object.freeze([
  { path: '/admin/dashboard', label: 'Insights', detail: 'Site stats and activity' },
  { path: '/admin/site', label: 'Builder', detail: 'Canvas and design tokens' },
  { path: '/admin/content', label: 'Content', detail: 'Write posts and entries' },
  { path: '/admin/data', label: 'Data', detail: 'Collections and rows' },
  { path: '/admin/media', label: 'Media', detail: 'Files and folders' },
  { path: '/admin/plugins', label: 'Plugins', detail: 'Installed extensions' },
])

function CheckIcon({ done }: { done: boolean }) {
  return done
    ? (
      <svg viewBox="0 0 16 16" className="size-4 text-dash-accent" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="currentColor" />
        <path d="m5 8.2 2 2 4-4.2" stroke="#171717" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
    : (
      <svg viewBox="0 0 16 16" className="size-4 text-white/25" aria-hidden="true">
        <circle cx="8" cy="8" r="6.2" fill="currentColor" />
      </svg>
    )
}

function ChevronIcon({ open }: { open: boolean }) {
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

function Ring({ percent }: { percent: number }) {
  const radius = 54
  const circumference = 2 * Math.PI * radius
  const dash = (Math.max(0, Math.min(100, percent)) / 100) * circumference
  return (
    <svg viewBox="0 0 140 140" className="size-[148px]" role="img" aria-label={`${percent}% ready`}>
      <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--color-dash-rail)" strokeWidth="10" />
      <circle
        cx="70"
        cy="70"
        r={radius}
        fill="none"
        stroke="var(--color-dash-accent)"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference}`}
        transform="rotate(-90 70 70)"
      />
      <text
        x="70"
        y="66"
        textAnchor="middle"
        className="fill-dash-ink"
        style={{ fontSize: '1.55rem', fontWeight: 600, letterSpacing: '-0.02em' }}
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

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      {/* Instatic handoff — the feature card position in the reference. */}
      <Card tone="ink" className="flex flex-col justify-between lg:row-span-1">
        <div>
          <Badge variant="accent" size="sm">Design</Badge>
          <p className="mt-5 text-xl leading-tight font-semibold tracking-tight">
            {siteName}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-white/55">
            Instatic builds and manages this site. Opening it hands over the whole
            screen — canvas, content, media and data.
          </p>
        </div>
        <div className="mt-6 flex items-center gap-2">
          <ButtonLink href={builderPath} variant="accent" size="md">
            Open Instatic
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

      {/* Setup steps as the highlighted bar chart. */}
      <Card>
        <CardTitle>Setup</CardTitle>
        <div className="mt-4 flex items-end gap-2">
          <p className="text-[2rem] leading-none font-semibold tracking-tight text-dash-ink">
            {completed}
          </p>
          <p className="pb-1 text-xs leading-tight text-dash-ink-muted">
            of {steps.length}
            <br />
            steps done
          </p>
        </div>
        <div className="mt-5 flex h-24 items-end gap-2">
          {steps.map((step, index) => (
            <div key={step.id} className="flex flex-1 flex-col items-center gap-2">
              <div
                className={cn(
                  'w-1.5 rounded-full',
                  step.completed ? 'bg-dash-ink' : index === nextIndex ? 'bg-dash-accent' : 'bg-dash-rail',
                )}
                style={{ height: `${step.completed ? 100 : index === nextIndex ? 74 : 34}%` }}
                title={step.title}
              />
              <span className="text-[0.625rem] text-dash-ink-muted">{index + 1}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Readiness ring. */}
      <Card tone="warm" className="flex flex-col items-center justify-between">
        <CardTitle className="self-start">Readiness</CardTitle>
        <Ring percent={percent} />
        <CardCaption className="self-start">
          {percent === 100 ? 'Everything is set up.' : 'Finish setup to go live properly.'}
        </CardCaption>
      </Card>

      {/* Segmented progress with the nested dark checklist. */}
      <Card className="flex flex-col">
        <div className="flex items-baseline justify-between">
          <CardTitle>Onboarding</CardTitle>
          <span className="text-sm font-semibold text-dash-ink">{percent}%</span>
        </div>
        <div className="mt-4 flex gap-1.5">
          <div className="h-2 flex-1 rounded-full bg-dash-accent" />
          <div className="h-2 flex-1 rounded-full bg-dash-ink" />
          <div className="h-2 flex-1 rounded-full bg-dash-rail" />
        </div>
        <div className="mt-4 rounded-[var(--radius-bento-inner)] bg-dash-ink p-4 text-dash-surface">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium">Onboarding task</p>
            <p className="text-sm font-semibold">{completed}/{steps.length}</p>
          </div>
          <ul className="mt-3 space-y-3">
            {steps.slice(0, 5).map((step) => (
              <li key={step.id} className="flex items-start gap-3">
                <span className="mt-0.5"><CheckIcon done={step.completed} /></span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      'block truncate text-xs',
                      step.completed ? 'text-white/45 line-through' : 'text-white',
                    )}
                  >
                    {step.title}
                  </span>
                  <span className="block truncate text-[0.625rem] text-white/35">
                    {step.description}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {/* Accordion list of platform areas. */}
      <Card className="lg:col-span-1">
        <ul className="divide-y divide-dash-hairline">
          {areas.map((area) => {
            const open = openArea === area.id
            return (
              <li key={area.id} className="py-1">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 py-2.5 text-left"
                  aria-expanded={open}
                  onClick={() => setOpenArea(open ? null : area.id)}
                >
                  <span className="text-sm text-dash-ink">{area.label}</span>
                  <ChevronIcon open={open} />
                </button>
                {open ? (
                  <div className="pb-3">
                    <p className="text-xs leading-relaxed text-dash-ink-muted">{area.detail}</p>
                    <Link
                      to={area.path}
                      className="mt-2 inline-block text-xs font-medium text-dash-ink underline decoration-dash-accent decoration-2 underline-offset-4"
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

      {/* Instatic launcher — the wide card position in the reference. */}
      <Card className="lg:col-span-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Instatic</CardTitle>
          <CardCaption>Everything about this site itself lives here</CardCaption>
        </div>
        <ul className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {INSTATIC_SECTIONS.map((section) => (
            <li key={section.path}>
              <a
                href={section.path}
                className={cn(
                  'flex h-full flex-col justify-between gap-3 rounded-[var(--radius-bento-inner)]',
                  'border border-dash-hairline bg-dash-surface p-3.5 transition-colors',
                  'hover:border-dash-ink/25 hover:bg-dash-card-warm',
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

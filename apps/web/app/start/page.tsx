import { PublicHandoffRequestSchema, type PublicHandoffRequest } from '@fuma/public-contracts'
import { Value } from '@sinclair/typebox/value'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { IntentForm } from '@/components/intent-form'
import { PageMain } from '@/components/site-shell'
import { publicMetadata } from '@/lib/seo'

export const metadata = publicMetadata('Continue with Fuma', 'Log in or create an account to continue.', '/start', true)

const BASE_KEYS = new Set(['kind', 'source'])
const KIND_KEYS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  sign_up: new Set([...BASE_KEYS, 'profile']),
  sign_in: new Set([...BASE_KEYS, 'profile']),
  create_site: new Set([...BASE_KEYS, 'profile']),
  choose_plan: new Set([...BASE_KEYS, 'planId', 'priceBookVersion', 'cadence']),
  use_template: new Set([...BASE_KEYS, 'templateId']),
  contact_expert: new Set([...BASE_KEYS, 'expertId']),
})

const INTENT_PRESENTATION = Object.freeze({
  sign_up: {
    eyebrow: 'Get started',
    title: 'Create your Fuma account',
    detail: 'Create an account, then start building your first site.',
    next: 'Account setup',
  },
  sign_in: {
    eyebrow: 'Welcome back',
    title: 'Log in to Fuma',
    detail: 'Use your Fuma account to return to your work.',
    next: 'Your workspace',
  },
  create_site: {
    eyebrow: 'Start building',
    title: 'Create your site',
    detail: 'Log in or create an account, then choose the setup that fits your work.',
    next: 'Site setup',
  },
  choose_plan: {
    eyebrow: 'Choose your plan',
    title: 'Review your Fuma plan',
    detail: 'Log in to check the current plan details before you decide.',
    next: 'Plan review',
  },
  use_template: {
    eyebrow: 'Use this design',
    title: 'Start with this template',
    detail: 'Log in, choose a site, and review the template before adding it.',
    next: 'Template review',
  },
  contact_expert: {
    eyebrow: 'Work with an expert',
    title: 'Contact this expert',
    detail: 'Log in to review the listing and send your enquiry.',
    next: 'Your enquiry',
  },
}) satisfies Readonly<Record<PublicHandoffRequest['kind'], Readonly<{
  eyebrow: string
  title: string
  detail: string
  next: string
}>>>

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const raw = await searchParams
  if (Object.values(raw).some(Array.isArray)) notFound()
  const kind = raw.kind
  const source = raw.source
  const allowedKeys = typeof kind === 'string' ? KIND_KEYS[kind] : undefined
  if (!allowedKeys || Object.keys(raw).some((key) => !allowedKeys.has(key))) notFound()

  let value: unknown
  if (kind === 'sign_up' || kind === 'sign_in') {
    value = { kind, source, ...(raw.profile ? { profile: raw.profile } : {}) }
  } else if (kind === 'create_site') {
    value = { kind, source, profile: raw.profile }
  } else if (kind === 'choose_plan') {
    value = {
      kind,
      source,
      planId: raw.planId,
      priceBookVersion: raw.priceBookVersion,
      cadence: raw.cadence,
    }
  } else if (kind === 'use_template') {
    value = { kind, source, templateId: raw.templateId }
  } else if (kind === 'contact_expert') {
    value = { kind, source, expertId: raw.expertId }
  } else {
    notFound()
  }
  if (!Value.Check(PublicHandoffRequestSchema, value)) notFound()

  const intent = value as PublicHandoffRequest
  const presentation = INTENT_PRESENTATION[intent.kind]

  return <PageMain className="max-w-6xl">
    <div className="grid min-h-[70svh] content-center py-4 sm:py-8">
      <div className="grid overflow-hidden rounded-surface border border-border bg-card lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
        <header className="fuma-rise p-7 sm:p-10 lg:p-14">
          <p className="font-mono text-eyebrow uppercase tracking-widest text-signal-bright">{presentation.eyebrow}</p>
          <h1 className="mt-5 max-w-2xl font-display text-display-xl text-balance">{presentation.title}</h1>
          <p className="mt-6 max-w-xl text-lede text-muted-foreground text-pretty">{presentation.detail}</p>

          <div className="mt-10 max-w-xl border-t border-border pt-7">
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Next</p>
            <p className="mt-2 font-display text-display-md">{presentation.next}</p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">We’ll ask you to sign in if needed, then take you to the right place.</p>
          </div>
        </header>

        <section aria-labelledby="continue-title" className="fuma-rise border-t border-border bg-surface-inset p-7 sm:p-10 lg:border-l lg:border-t-0 lg:p-14">
          <div className="flex h-full flex-col justify-center">
            <p className="font-mono text-xs uppercase tracking-widest text-signal-bright">Ready</p>
            <h2 className="mt-3 font-display text-display-md" id="continue-title">Continue with Fuma</h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">Your selection will be waiting after you log in.</p>
            <div className="mt-7 max-w-md [&_button]:w-full">
              <IntentForm intent={intent} />
            </div>
            <Link className="mt-5 inline-flex min-h-11 w-fit items-center text-sm text-muted-foreground underline decoration-line-strong underline-offset-4 transition-colors hover:text-foreground" href="/">Back to Fuma</Link>
          </div>
        </section>
      </div>
    </div>
  </PageMain>
}

import { PublicHandoffRequestSchema, type PublicHandoffRequest } from '@fuma/public-contracts'
import { Value } from '@sinclair/typebox/value'
import { IntentForm } from '@/components/intent-form'
import { PageMain } from '@/components/site-shell'
import { publicMetadata } from '@/lib/seo'
import { notFound } from 'next/navigation'

export const metadata = publicMetadata('Continue to Fuma', 'Securely continue to the Fuma application.', '/start', true)

const BASE_KEYS = new Set(['kind', 'source'])
const KIND_KEYS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  sign_up: new Set([...BASE_KEYS, 'profile']),
  sign_in: new Set([...BASE_KEYS, 'profile']),
  create_site: new Set([...BASE_KEYS, 'profile']),
  choose_plan: new Set([...BASE_KEYS, 'planId']),
  use_template: new Set([...BASE_KEYS, 'templateId']),
  contact_expert: new Set([...BASE_KEYS, 'expertId']),
})

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
    value = { kind, source, planId: raw.planId }
  } else if (kind === 'use_template') {
    value = { kind, source, templateId: raw.templateId }
  } else if (kind === 'contact_expert') {
    value = { kind, source, expertId: raw.expertId }
  } else {
    notFound()
  }
  if (!Value.Check(PublicHandoffRequestSchema, value)) notFound()

  return <PageMain className="max-w-2xl">
    <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Secure handoff</p>
    <h1 className="mt-4 text-4xl font-semibold">Continue to the Fuma application</h1>
    <p className="my-6 leading-7 text-muted-foreground">Your selection will be exchanged for a short-lived opaque intent only when the application handoff authority is available. The application will re-check availability after sign-in. This page does not carry identity or session data.</p>
    <aside aria-labelledby="handoff-ownership" className="mb-7 rounded-xl bg-secondary p-5">
      <h2 id="handoff-ownership" className="font-semibold">Public journey ends here</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">Authentication, session creation, cancellation and resume belong to the application and identity layers. This public page cannot sign you in or create an account by itself.</p>
    </aside>
    <IntentForm intent={value as PublicHandoffRequest} />
    <a className="mt-5 inline-block text-sm underline" href="/">Cancel and return home</a>
  </PageMain>
}

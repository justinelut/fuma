'use client'

import { useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { CONTACT_NOTICE_VERSION } from '@/lib/contact-boundary'

type ContactKind = 'general' | 'security' | 'privacy' | 'abuse'
type ContactFormProps =
  | Readonly<{ kind?: ContactKind; expertId?: never }>
  | Readonly<{ kind: 'expert_inquiry'; expertId: string }>

type FormState = 'idle' | 'busy' | 'sent' | 'invalid' | 'rate_limited' | 'unavailable'

const descriptions: Record<ContactKind | 'expert_inquiry', string> = {
  general: 'Send a product or general question.',
  security: 'Send the minimum details needed to report a security concern.',
  privacy: 'Ask about access, correction, deletion, or another privacy concern.',
  abuse: 'Report suspected abuse without including unnecessary personal or harmful material.',
  expert_inquiry: 'Send a bounded inquiry for this public expert profile.',
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function ContactForm({ kind = 'general', expertId }: ContactFormProps) {
  const [state, setState] = useState<FormState>('idle')
  const replayToken = useRef<string | null>(null)
  const startedAt = useRef(timestamp(new Date()))
  const descriptionId = useId()
  const feedbackId = useId()

  return <form className="mt-8 grid gap-5 rounded-xl border bg-card p-5 sm:p-7" aria-describedby={`${descriptionId} ${feedbackId}`} onSubmit={async (event) => {
    event.preventDefault()
    setState('busy')
    const form = new FormData(event.currentTarget)
    replayToken.current ??= crypto.randomUUID().replaceAll('-', '')
    const body = {
      kind,
      name: form.get('name'),
      email: form.get('email'),
      message: form.get('message'),
      website: form.get('website'),
      startedAt: startedAt.current,
      consentVersion: CONTACT_NOTICE_VERSION,
      replayToken: replayToken.current,
      ...(kind === 'expert_inquiry' ? { expertId } : {}),
    }
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'omit',
        redirect: 'error',
      })
      setState(response.status === 202
        ? 'sent'
        : response.status === 429
          ? 'rate_limited'
          : response.status >= 500
            ? 'unavailable'
            : 'invalid')
    } catch {
      setState('unavailable')
    }
  }}>
    <p id={descriptionId} className="text-sm leading-6 text-muted-foreground">{descriptions[kind]}</p>
    <label className="grid gap-2 font-medium">Name
      <input required maxLength={100} name="name" autoComplete="name" className="min-h-11 rounded-md border bg-background px-4 py-2 font-normal" />
    </label>
    <label className="grid gap-2 font-medium">Reply email
      <input required maxLength={254} type="email" name="email" autoComplete="email" inputMode="email" className="min-h-11 rounded-md border bg-background px-4 py-2 font-normal" />
    </label>
    <label className="grid gap-2 font-medium">Message
      <textarea required minLength={10} maxLength={4000} rows={7} name="message" className="rounded-md border bg-background px-4 py-3 font-normal" />
    </label>
    <label className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">Leave this field empty
      <input name="website" tabIndex={-1} autoComplete="off" />
    </label>
    <p className="text-sm leading-6 text-muted-foreground">By sending, you ask Fuma to process your name, reply address, message, and limited anti-abuse data for this request under the <a className="underline underline-offset-4" href="/legal/privacy">privacy notice effective 26 July 2026</a>. Do not send passwords, secret keys, identity documents, payment details, or sensitive personal information.</p>
    <Button type="submit" size="lg" disabled={state === 'busy' || state === 'sent'} className="min-h-11 w-fit">
      {state === 'busy' ? 'Sending…' : state === 'sent' ? 'Request accepted' : 'Send request'}
    </Button>
    <div id={feedbackId} aria-live="polite" aria-atomic="true" className="min-h-6 text-sm">
      {state === 'sent' && <p role="status">The request was accepted for routing. This does not confirm delivery or promise a response time.</p>}
      {state === 'rate_limited' && <p role="alert">Too many requests were attempted. Wait at least ten minutes before trying again.</p>}
      {state === 'unavailable' && <p role="alert">The contact route is temporarily unavailable. Your message was not confirmed as accepted; keep a local copy and try later.</p>}
      {state === 'invalid' && <p role="alert">The request could not be accepted. Check the fields, wait a moment, and submit again.</p>}
    </div>
  </form>
}

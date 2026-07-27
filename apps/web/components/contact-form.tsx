'use client'

import { useRef, useState } from 'react'

type ContactFormProps =
  | Readonly<{ kind?: 'general' | 'security' | 'privacy'; expertId?: never }>
  | Readonly<{ kind: 'expert_inquiry'; expertId: string }>

export function ContactForm({ kind = 'general', expertId }: ContactFormProps) {
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'error'>('idle')
  const replayToken = useRef<string | null>(null)

  return <form className="mt-8 grid gap-4" onSubmit={async (event) => {
    event.preventDefault()
    setState('busy')
    const form = new FormData(event.currentTarget)
    replayToken.current ??= crypto.randomUUID().replaceAll('-', '')
    const body = {
      kind,
      name: form.get('name'),
      email: form.get('email'),
      message: form.get('message'),
      consentVersion: '2026-07-26',
      replayToken: replayToken.current,
      ...(kind === 'expert_inquiry' ? { expertId } : {}),
    }
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'omit',
      })
      setState(response.status === 202 ? 'sent' : 'error')
    } catch {
      setState('error')
    }
  }}>
    <label>Name<input required maxLength={100} name="name" autoComplete="name" className="mt-1 block w-full rounded-md border bg-background px-4 py-2" /></label>
    <label>Reply email<input required maxLength={254} type="email" name="email" autoComplete="email" className="mt-1 block w-full rounded-md border bg-background px-4 py-2" /></label>
    <label>Message<textarea required minLength={10} maxLength={4000} rows={7} name="message" className="mt-1 block w-full rounded-md border bg-background px-4 py-2" /></label>
    <p className="text-sm text-muted-foreground">By sending this form, you consent to Fuma processing these details to respond under the privacy policy dated 26 July 2026. Do not submit passwords, secrets or sensitive personal information.</p>
    <button disabled={state === 'busy' || state === 'sent'} className="w-fit rounded-md bg-primary px-5 py-3 text-primary-foreground">
      {state === 'busy' ? 'Sending…' : state === 'sent' ? 'Message accepted' : 'Send message'}
    </button>
    {state === 'sent' && <p role="status">Your bounded request was accepted.</p>}
    {state === 'error' && <p role="alert">We could not accept the request. Please wait and try again.</p>}
  </form>
}

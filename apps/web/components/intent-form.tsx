'use client'

import type { PublicHandoffRequest } from '@fuma/public-contracts'
import { useState } from 'react'
import {
  consentStateFromSession,
  handoffStartedEvent,
  PUBLIC_CONSENT_STORAGE_KEY,
} from '@/lib/acquisition-client'
import { safeAppResumeUrl } from '@/lib/handoff-target'

export function IntentForm({ intent }: Readonly<{ intent: PublicHandoffRequest }>) {
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle')

  return <form aria-describedby="handoff-boundary" onSubmit={async (event) => {
    event.preventDefault()
    setState('busy')
    try {
      const response = await fetch('/api/handoff', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(intent),
        credentials: 'omit',
      })
      const body = await response.json() as { redirectUrl?: unknown }
      const target = response.ok ? safeAppResumeUrl(body.redirectUrl) : null
      if (!target) throw new Error('handoff unavailable')

      const correlation = target.searchParams.get('correlation')!
      const acquisitionEvent = handoffStartedEvent(
        intent,
        correlation,
        new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        consentStateFromSession(sessionStorage.getItem(PUBLIC_CONSENT_STORAGE_KEY)),
      )
      await fetch('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(acquisitionEvent),
        credentials: 'omit',
        keepalive: true,
      }).catch(() => undefined)
      window.location.assign(target.toString())
    } catch {
      setState('error')
    }
  }}>
    <button aria-describedby="handoff-boundary" disabled={state === 'busy'} className="min-h-11 rounded-md bg-primary px-6 py-3 font-semibold text-primary-foreground disabled:cursor-wait disabled:opacity-70" type="submit">
      {state === 'busy' ? 'Preparing a safe transition…' : 'Continue to the Fuma application'}
    </button>
    <p id="handoff-boundary" className="mt-3 text-sm leading-6 text-muted-foreground">Only an opaque, short-lived intent and correlation may cross to <strong>app.fuma.co.ke</strong>. No public-site cookie is sent.</p>
    {state === 'error' && <div aria-live="assertive" role="alert" className="mt-5 rounded-lg border border-dashed p-4 text-sm leading-6"><p className="font-semibold">The secure handoff is temporarily unavailable.</p><p className="mt-1">Stay on this page and try again later. Do not add personal information to the address.</p></div>}
  </form>
}

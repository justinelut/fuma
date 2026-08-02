'use client'

import type { PublicHandoffRequest } from '@fuma/public-contracts'
import { useState } from 'react'
import {
  handoffStartedEvent,
  readConsentPreference,
  sendOptionalAcquisition,
} from '@/lib/acquisition-client'
import { safeAppResumeUrl } from '@/lib/handoff-target'

export function IntentForm({ intent }: Readonly<{ intent: PublicHandoffRequest }>) {
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle')

  const action = ({
    sign_up: 'Create account',
    sign_in: 'Log in',
    create_site: 'Create site',
    choose_plan: 'Review plan',
    use_template: 'Use this template',
    contact_expert: 'Contact expert',
  } as const)[intent.kind]

  return <form aria-describedby="continue-help" onSubmit={async (event) => {
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
      const preference = readConsentPreference(sessionStorage)
      const consent = preference.choice === 'optional'
        ? 'granted'
        : preference.choice === 'essential' ? 'denied' : 'not_required'
      if (consent === 'granted') {
        const acquisitionEvent = handoffStartedEvent(
          intent,
          correlation,
          new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
          consent,
        )
        sendOptionalAcquisition(acquisitionEvent, consent)
      }
      window.location.assign(target.toString())
    } catch {
      setState('error')
    }
  }}>
    <button aria-describedby="continue-help" disabled={state === 'busy'} className="min-h-11 rounded-md bg-primary px-6 py-3 font-semibold text-primary-foreground disabled:cursor-wait disabled:opacity-70" type="submit">
      {state === 'busy' ? 'Opening Fuma…' : action}
    </button>
    <p id="continue-help" className="mt-3 text-sm leading-6 text-muted-foreground">You’ll be asked to sign in if needed.</p>
    {state === 'error' && <div aria-live="assertive" role="alert" className="mt-5 rounded-lg border border-dashed p-4 text-sm leading-6"><p className="font-semibold">Fuma couldn’t open.</p><p className="mt-1">Try again in a moment.</p></div>}
  </form>
}

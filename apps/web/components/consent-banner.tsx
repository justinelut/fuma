'use client'

import { useEffect, useState } from 'react'
import {
  clearConsentPreference,
  persistConsentPreference,
  readConsentPreference,
  type PublicConsentChoice,
} from '@/lib/acquisition-client'

type Choice = PublicConsentChoice

export function ConsentBanner() {
  const [visible, setVisible] = useState(false)
  const [choice, setChoice] = useState<Choice | null>(null)
  const [suppressed, setSuppressed] = useState(true)

  useEffect(() => {
    const gpc = (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true
    const dnt = navigator.doNotTrack === '1'
    const privacySuppressed = gpc || dnt
    if (privacySuppressed) clearConsentPreference(sessionStorage)
    const preference = privacySuppressed
      ? Object.freeze({ available: true, choice: null })
      : readConsentPreference(sessionStorage)
    const nextSuppressed = privacySuppressed || !preference.available
    const nextChoice: Choice | null = nextSuppressed ? null : preference.choice
    const nextVisible = !nextSuppressed && nextChoice === null

    const frame = requestAnimationFrame(() => {
      setSuppressed(nextSuppressed)
      setVisible(nextVisible)
      setChoice(nextChoice)
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  const choose = (next: Choice) => {
    const saved = persistConsentPreference(
      sessionStorage,
      next,
      new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    )
    if (!saved) {
      setSuppressed(true)
      setVisible(false)
      setChoice(null)
      return
    }
    setChoice(next)
    setVisible(false)
  }

  if (suppressed) return null
  if (!visible) {
    return <button
      className="mx-auto my-4 block min-h-11 rounded-md border bg-card px-3 py-2 text-xs shadow"
      onClick={() => choice === 'optional' ? choose('essential') : setVisible(true)}
      type="button"
    >{choice === 'optional' ? 'Withdraw optional analytics' : 'Review analytics preference'}</button>
  }

  return <aside aria-label="Analytics preference" className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-2xl rounded-xl border bg-card p-5 shadow-xl">
    <p className="font-semibold">Your privacy, your choice</p>
    <p className="mt-2 text-sm text-muted-foreground">Essential cookieless measurements help us understand reliability. Optional measurement stays off unless you choose it. This preference is session-only on this host.</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <button className="min-h-11 rounded-md border px-4 py-2 text-sm" onClick={() => choose('essential')} type="button">Essential only</button>
      <button className="min-h-11 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={() => choose('optional')} type="button">Allow optional</button>
    </div>
  </aside>
}

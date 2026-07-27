'use client'

import { useEffect, useState } from 'react'
import { PUBLIC_CONSENT_STORAGE_KEY } from '@/lib/acquisition-client'

type Choice = 'essential' | 'optional'

export function ConsentBanner() {
  const [visible, setVisible] = useState(false)
  const [choice, setChoice] = useState<Choice | null>(null)
  const [suppressed, setSuppressed] = useState(true)

  useEffect(() => {
    const gpc = (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true
    const dnt = navigator.doNotTrack === '1'
    const nextSuppressed = gpc || dnt
    let nextVisible = false
    let nextChoice: Choice | null = null

    if (nextSuppressed) {
      sessionStorage.removeItem(PUBLIC_CONSENT_STORAGE_KEY)
    } else {
      const raw = sessionStorage.getItem(PUBLIC_CONSENT_STORAGE_KEY)
      if (raw) {
        try {
          const value = JSON.parse(raw) as { version?: unknown; choice?: unknown }
          if (value.version === 1 && (value.choice === 'essential' || value.choice === 'optional')) {
            nextChoice = value.choice
          } else {
            sessionStorage.removeItem(PUBLIC_CONSENT_STORAGE_KEY)
            nextVisible = true
          }
        } catch {
          sessionStorage.removeItem(PUBLIC_CONSENT_STORAGE_KEY)
          nextVisible = true
        }
      } else {
        nextVisible = true
      }
    }

    const frame = requestAnimationFrame(() => {
      setSuppressed(nextSuppressed)
      setVisible(nextVisible)
      setChoice(nextChoice)
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  const choose = (next: Choice) => {
    sessionStorage.setItem(PUBLIC_CONSENT_STORAGE_KEY, JSON.stringify({
      version: 1,
      choice: next,
      updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    }))
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
      <button className="rounded-md border px-4 py-2 text-sm" onClick={() => choose('essential')} type="button">Essential only</button>
      <button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={() => choose('optional')} type="button">Allow optional</button>
    </div>
  </aside>
}

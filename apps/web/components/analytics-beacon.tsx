'use client'

import { useEffect } from 'react'
import {
  readConsentPreference,
  routeClassForPath,
} from '@/lib/acquisition-client'

export function AnalyticsBeacon() {
  useEffect(() => {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
    if (nav.globalPrivacyControl || navigator.doNotTrack === '1') return

    const preference = readConsentPreference(sessionStorage)
    const consent = preference.choice === 'optional'
      ? 'granted'
      : preference.choice === 'essential' ? 'denied' : 'not_required'

    void fetch('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        version: 1,
        kind: 'page_view',
        routeClass: routeClassForPath(location.pathname),
        timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        consent,
      }),
      credentials: 'omit',
      keepalive: true,
    }).catch(() => undefined)
  }, [])
  return null
}

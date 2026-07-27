'use client'

import { useEffect } from 'react'
import {
  consentStateFromSession,
  PUBLIC_CONSENT_STORAGE_KEY,
  routeClassForPath,
} from '@/lib/acquisition-client'

export function AnalyticsBeacon() {
  useEffect(() => {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
    if (nav.globalPrivacyControl || navigator.doNotTrack === '1') return

    void fetch('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        version: 1,
        kind: 'page_view',
        routeClass: routeClassForPath(location.pathname),
        timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        consent: consentStateFromSession(sessionStorage.getItem(PUBLIC_CONSENT_STORAGE_KEY)),
      }),
      credentials: 'omit',
      keepalive: true,
    }).catch(() => undefined)
  }, [])
  return null
}

'use client'

import { useEffect, useState } from 'react'

const AUTH_STATUS_URL = 'https://auth.trimly.co.ke/session/status'
const APP_DASHBOARD_URL = 'https://app.trimly.co.ke/admin'

type IdentityStatus = 'loading' | 'anonymous' | 'authenticated'

export function useCentralIdentityStatus(): IdentityStatus {
  const [status, setStatus] = useState<IdentityStatus>('loading')
  useEffect(() => {
    const controller = new AbortController()
    void fetch(AUTH_STATUS_URL, { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const value: unknown = await response.json()
        const authenticated = response.ok && value !== null && typeof value === 'object' && !Array.isArray(value)
          && Object.keys(value).length === 1 && (value as { authenticated?: unknown }).authenticated === true
        setStatus(authenticated ? 'authenticated' : 'anonymous')
      })
      .catch(() => { if (!controller.signal.aborted) setStatus('anonymous') })
    return () => controller.abort()
  }, [])
  return status
}

const secondary = 'inline-flex min-h-11 items-center rounded-lg px-3 text-[0.9375rem] text-muted-foreground transition-colors hover:text-foreground max-[22rem]:hidden lg:min-h-10'
const primary = 'inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-[0.9375rem] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 max-[22rem]:hidden lg:min-h-10'

export function CentralAccountActions() {
  const status = useCentralIdentityStatus()
  if (status === 'authenticated') return <>
    <a className={secondary} href={APP_DASHBOARD_URL}>Account</a>
    <a className={primary} href={APP_DASHBOARD_URL}>Dashboard</a>
  </>
  return <>
    <a className={secondary} href="/start?kind=sign_in&source=direct">Log in</a>
    <a className={primary} href="/start?kind=sign_up&source=direct"><span className="sm:hidden">Sign up</span><span className="hidden sm:inline">Sign up free</span></a>
  </>
}

export function AuthenticatedStartRedirect() {
  const status = useCentralIdentityStatus()
  useEffect(() => {
    if (status === 'authenticated') window.location.replace(APP_DASHBOARD_URL)
  }, [status])
  return null
}

export const CENTRAL_APP_DASHBOARD_URL = APP_DASHBOARD_URL

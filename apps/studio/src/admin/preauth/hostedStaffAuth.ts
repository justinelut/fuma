import { useEffect, useState } from 'react'
import { getHostedStaffSession, type HostedStaffSession } from '@core/fuma/auth'
import { getErrorMessage } from '@core/utils/errorMessage'

export function hostedStaffAuthSelected(): boolean {
  if (typeof window === 'undefined') return false
  return (window as unknown as { __fumaHostedStaffAuth?: number }).__fumaHostedStaffAuth === 1
}

type HostedStaffBoot =
  | { status: 'loading'; session: null; error: null }
  | { status: 'ready'; session: HostedStaffSession | null; error: string | null }

export function useHostedStaffBoot(): HostedStaffBoot {
  const [result, setResult] = useState<HostedStaffBoot>({
    status: 'loading',
    session: null,
    error: null,
  })

  useEffect(() => {
    let cancelled = false
    void getHostedStaffSession().then(
      (session) => {
        if (!cancelled) setResult({ status: 'ready', session, error: null })
      },
      (error: unknown) => {
        if (!cancelled) setResult({
          status: 'ready',
          session: null,
          error: getErrorMessage(error, 'Fuma authentication is unavailable'),
        })
      },
    )
    return () => { cancelled = true }
  }, [])

  return result
}

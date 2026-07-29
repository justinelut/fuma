'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { SiteApplicationMutationResponseSchema, parseContract, type SiteApplicationContext, type SiteApplicationMutationResponse, type SiteApplicationSnapshot } from '../lib/contracts'
import { mergeApplicationSeed, optimisticApplicationSnapshot, rollbackApplicationSnapshot, sameApplicationRealm } from '../lib/application-state-machine'

type MutationInput = Readonly<{
  kind: 'cart.update' | 'booking.update' | 'account.update' | 'payment.initialize'
  payload: unknown
  optimistic(snapshot: SiteApplicationSnapshot): SiteApplicationSnapshot
}>
type ApplicationStateValue = Readonly<{
  context: SiteApplicationContext | null
  pending: boolean
  error: string | null
  mutate(input: MutationInput): Promise<SiteApplicationSnapshot>
  seed(context: SiteApplicationContext): void
}>

const ApplicationStateContext = createContext<ApplicationStateValue | null>(null)

export function ApplicationStateProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [context, setContext] = useState<SiteApplicationContext | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const seed = useCallback((next: SiteApplicationContext) => {
    setContext((current) => mergeApplicationSeed(current, next))
  }, [])

  const mutate = useCallback(async (input: MutationInput): Promise<SiteApplicationSnapshot> => {
    if (pending) throw new Error('A site application mutation is already pending.')
    const current = context
    if (!current?.member.authenticated || current.cachePolicy !== 'private') throw new Error('Site-member authentication is required.')
    const previous = current.snapshot
    const optimistic = optimisticApplicationSnapshot(previous, input.optimistic(previous))
    const mutationId = crypto.randomUUID()
    setPending(true)
    setError(null)
    setContext(Object.freeze({ ...current, snapshot: optimistic }))
    try {
      const response = await fetch('/__fuma/runtime/v1/mutations', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          context: current,
          operation: {
            mutationId,
            idempotencyKey: `site-mutation:${mutationId}`,
            kind: input.kind,
            expectedVersion: previous.version,
            payload: input.payload,
            issuedAt: new Date().toISOString(),
          },
        }),
      })
      if (!response.ok) throw new Error(response.status === 409 ? 'State changed; refresh and try again.' : 'Mutation was not accepted.')
      const result = parseContract(SiteApplicationMutationResponseSchema, await response.json() as unknown, 'browser mutation response') as SiteApplicationMutationResponse
      if (result.mutationId !== mutationId || result.snapshot.version <= previous.version) throw new Error('Mutation response did not match the pending operation.')
      setContext((latest) => latest && sameApplicationRealm(latest, current) ? Object.freeze({ ...latest, snapshot: result.snapshot }) : latest)
      return result.snapshot
    } catch (cause) {
      setContext((latest) => rollbackApplicationSnapshot(latest, current, optimistic.version, previous))
      const message = cause instanceof Error ? cause.message : 'Mutation failed.'
      setError(message)
      throw cause
    } finally {
      setPending(false)
    }
  }, [context, pending])

  const value = useMemo(() => Object.freeze({ context, pending, error, mutate, seed }), [context, error, mutate, pending, seed])
  return (
    <ApplicationStateContext value={value}>
      <output hidden data-fuma-application-site={context?.cacheIdentity.siteId ?? ''} data-fuma-application-member={context?.member.memberId ?? ''} data-fuma-cart-items={context?.snapshot.cart.items.length ?? 0} data-fuma-application-pending={pending ? 'true' : 'false'}>{context?.snapshot.version ?? 0}</output>
      {children}
    </ApplicationStateContext>
  )
}

export function ApplicationStateSeed({ context }: Readonly<{ context: SiteApplicationContext }>) {
  const { seed } = useSiteApplicationState()
  useEffect(() => { seed(context) }, [context, seed])
  return null
}

export function useSiteApplicationState(): ApplicationStateValue {
  const value = useContext(ApplicationStateContext)
  if (!value) throw new Error('Site application state is outside its runtime provider.')
  return value
}

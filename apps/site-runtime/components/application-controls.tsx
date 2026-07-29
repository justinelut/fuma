'use client'

import type { CSSProperties } from 'react'
import { useSiteApplicationState } from './application-state'

export type ApplicationControlDecoration = Readonly<{ className?: string; style?: CSSProperties; 'data-fuma-node'?: string; 'data-fuma-component'?: string }>

export function ApplicationMemberStatus({ label, decoration }: Readonly<{ label: string; decoration: ApplicationControlDecoration }>) {
  const { context } = useSiteApplicationState()
  const member = context?.member
  return <output {...decoration} data-fuma-member-status={member?.authenticated ? 'authenticated' : 'public'}>{member?.authenticated ? member.displayName : label}</output>
}

export function ApplicationCartAction({ itemId, quantity, label, decoration }: Readonly<{ itemId: string; quantity: number; label: string; decoration: ApplicationControlDecoration }>) {
  const { context, error, mutate, pending } = useSiteApplicationState()
  const count = context?.snapshot.cart.items.reduce((total, item) => total + item.quantity, 0) ?? 0
  return <div {...decoration} data-fuma-cart-control>
    <button type="button" disabled={pending || !context?.member.authenticated} onClick={() => {
      void mutate({
        kind: 'cart.update', payload: { itemId, quantity },
        optimistic: (snapshot) => ({ ...snapshot, cart: { items: [...snapshot.cart.items.filter((item) => item.itemId !== itemId), { itemId, quantity }] } }),
      }).catch(() => undefined)
    }}>{label}</button>
    <output aria-live="polite" data-fuma-cart-count>{count}</output>
    {error ? <span role="alert" data-fuma-application-error>{error}</span> : null}
  </div>
}

export function ApplicationBookingAction({ selectionId, resourceId, startsAt, label, decoration }: Readonly<{ selectionId: string; resourceId: string; startsAt: string; label: string; decoration: ApplicationControlDecoration }>) {
  const { context, error, mutate, pending } = useSiteApplicationState()
  return <div {...decoration} data-fuma-booking-control>
    <button type="button" disabled={pending || !context?.member.authenticated} onClick={() => {
      void mutate({
        kind: 'booking.update', payload: { selectionId, resourceId, startsAt },
        optimistic: (snapshot) => ({ ...snapshot, booking: { selections: [...snapshot.booking.selections.filter((item) => item.selectionId !== selectionId), { selectionId, resourceId, startsAt }] } }),
      }).catch(() => undefined)
    }}>{label}</button>
    <output aria-live="polite" data-fuma-booking-count>{context?.snapshot.booking.selections.length ?? 0}</output>
    {error ? <span role="alert" data-fuma-application-error>{error}</span> : null}
  </div>
}

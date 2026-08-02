import { describe, expect, it } from 'bun:test'
import { MemoryBookingRepository, SequentialBookingIdentity } from '../memory'
import { BookingLifecycleService, type BookingScope } from '../service'
import type { BookingCustomer, BookingLocation, BookingResource, BookingService } from '../contracts'

const NAIROBI = 'Africa/Nairobi'

const scope: BookingScope = Object.freeze({
  organizationId: 'org_alpha', workspaceId: 'wsp_alpha', siteId: 'site_alpha',
})
const otherScope: BookingScope = Object.freeze({
  organizationId: 'org_beta', workspaceId: 'wsp_beta', siteId: 'site_beta',
})

const location: BookingLocation = Object.freeze({
  locationId: 'loc_kilimani',
  name: 'Kilimani Studio',
  timeZone: NAIROBI,
  addressLine: 'Wood Avenue',
  town: 'Nairobi',
  country: 'KE',
  mapUrl: null,
  state: 'active',
})

const service: BookingService = Object.freeze({
  serviceId: 'svc_cut',
  slug: 'haircut',
  name: 'Haircut',
  description: 'Precision cut and finish.',
  category: 'salon',
  durationMinutes: 60,
  bufferAfterMinutes: 0,
  capacityPerSlot: 1,
  slotIntervalMinutes: 60,
  minimumNoticeMinutes: 0,
  maximumAdvanceDays: 30,
  cancellationWindowMinutes: 120,
  priceMinor: 250_000,
  currency: 'KES',
  requiresPrepayment: false,
  state: 'active',
})

const resource: BookingResource = Object.freeze({
  resourceId: 'res_asha',
  name: 'Asha',
  kind: 'staff',
  locationId: 'loc_kilimani',
  serviceIds: ['svc_cut'],
  concurrency: 1,
  state: 'active',
})

const customer: BookingCustomer = Object.freeze({
  name: 'Wanjiku Mwangi',
  email: 'wanjiku@example.com',
  phone: '+254700000000',
  notes: 'Prefers a short fade.',
})

/** Monday 2026-03-02, 09:00–17:00 Nairobi. */
const workingHours = Object.freeze([
  Object.freeze({ resourceId: 'res_asha', weekday: 1, startMinute: 540, endMinute: 1_020 }),
])

function harness(now = new Date('2026-03-01T06:00:00Z')) {
  const repository = new MemoryBookingRepository([
    { scope, services: [service], locations: [location], resources: [resource], workingHours },
  ])
  const lifecycle = new BookingLifecycleService({
    repository,
    identity: new SequentialBookingIdentity(),
    now: () => now,
  })
  return { repository, lifecycle }
}

const SLOT_10 = '2026-03-02T07:00:00.000Z'

describe('booking lifecycle', () => {
  it('lists availability and holds a slot', async () => {
    const { lifecycle } = harness()
    const slots = await lifecycle.availability(scope, {
      serviceId: 'svc_cut', fromDate: '2026-03-02', toDate: '2026-03-02', partySize: 1,
    })
    expect(slots).toHaveLength(8)

    const hold = await lifecycle.hold(scope, {
      serviceId: 'svc_cut', resourceId: 'res_asha', startAt: SLOT_10, partySize: 1,
    })
    expect(hold.state).toBe('held')
    expect(hold.fence).toBe(1)
    expect(hold.expiresAt).toBe('2026-03-01T06:10:00.000Z')
  })

  it('a live hold removes the slot from availability', async () => {
    const { lifecycle } = harness()
    await lifecycle.hold(scope, { serviceId: 'svc_cut', resourceId: 'res_asha', startAt: SLOT_10, partySize: 1 })
    const slots = await lifecycle.availability(scope, {
      serviceId: 'svc_cut', fromDate: '2026-03-02', toDate: '2026-03-02', partySize: 1,
    })
    expect(slots.map((slot) => slot.startAt)).not.toContain(SLOT_10)
  })

  it('books a held slot and schedules a reminder', async () => {
    const { repository, lifecycle } = harness()
    const hold = await lifecycle.hold(scope, {
      serviceId: 'svc_cut', resourceId: 'res_asha', startAt: SLOT_10, partySize: 1,
    })
    const booking = await lifecycle.book(scope, {
      holdId: hold.holdId, fence: hold.fence, customer, requestKey: 'req-aaaaaaa1',
    })
    expect(booking.status).toBe('confirmed')
    expect(booking.reference).toBe('FUMA-0001')
    expect(booking.startAt).toBe(SLOT_10)
    expect(booking.endAt).toBe('2026-03-02T08:00:00.000Z')

    const reminders = repository.reminders(scope)
    expect(reminders).toHaveLength(1)
    expect(reminders[0]?.sendAt).toBe('2026-03-01T07:00:00.000Z')
    expect(repository.events(scope).map((event) => event.kind)).toEqual(['held', 'booked'])
  })

  it('is idempotent on requestKey rather than double-booking', async () => {
    const { repository, lifecycle } = harness()
    const hold = await lifecycle.hold(scope, {
      serviceId: 'svc_cut', resourceId: 'res_asha', startAt: SLOT_10, partySize: 1,
    })
    const first = await lifecycle.book(scope, {
      holdId: hold.holdId, fence: hold.fence, customer, requestKey: 'req-bbbbbbb1',
    })
    const second = await lifecycle.book(scope, {
      holdId: hold.holdId, fence: hold.fence, customer, requestKey: 'req-bbbbbbb1',
    })
    expect(second.bookingId).toBe(first.bookingId)
    expect(repository.bookings(scope)).toHaveLength(1)
  })

  it('refuses a stale fence and a replayed hold', async () => {
    const { lifecycle } = harness()
    const hold = await lifecycle.hold(scope, {
      serviceId: 'svc_cut', resourceId: 'res_asha', startAt: SLOT_10, partySize: 1,
    })
    await expect(lifecycle.book(scope, {
      holdId: hold.holdId, fence: hold.fence + 5, customer, requestKey: 'req-ccccccc1',
    })).rejects.toThrow(/fence is stale/)

    await lifecycle.book(scope, {
      holdId: hold.holdId, fence: hold.fence, customer, requestKey: 'req-ccccccc2',
    })
    // The hold is redeemed; a different request key cannot reuse it.
    await expect(lifecycle.book(scope, {
      holdId: hold.holdId, fence: hold.fence, customer, requestKey: 'req-ccccccc3',
    })).rejects.toThrow(/fence is stale|already redeemed/)
  })

  it('rejects an expired hold and records the expiry', async () => {
    const now = new Date('2026-03-01T06:00:00Z')
    const repository = new MemoryBookingRepository([
      { scope, services: [service], locations: [location], resources: [resource], workingHours },
    ])
    let clock = now
    const lifecycle = new BookingLifecycleService({
      repository, identity: new SequentialBookingIdentity(), now: () => clock,
    })
    const hold = await lifecycle.hold(scope, {
      serviceId: 'svc_cut', resourceId: 'res_asha', startAt: SLOT_10, partySize: 1,
    })
    clock = new Date('2026-03-01T06:20:00Z')
    await expect(lifecycle.book(scope, {
      holdId: hold.holdId, fence: hold.fence, customer, requestKey: 'req-ddddddd1',
    })).rejects.toThrow(/expired/)
    expect(repository.events(scope).map((event) => event.kind)).toContain('hold-expired')
  })

  it('two concurrent redemptions of one hold produce exactly one booking', async () => {
    const { repository, lifecycle } = harness()
    const hold = await lifecycle.hold(scope, {
      serviceId: 'svc_cut', resourceId: 'res_asha', startAt: SLOT_10, partySize: 1,
    })
    const results = await Promise.allSettled([
      lifecycle.book(scope, { holdId: hold.holdId, fence: hold.fence, customer, requestKey: 'req-eeeeeee1' }),
      lifecycle.book(scope, { holdId: hold.holdId, fence: hold.fence, customer, requestKey: 'req-eeeeeee2' }),
    ])
    expect(results.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((entry) => entry.status === 'rejected')).toHaveLength(1)
    expect(repository.bookings(scope)).toHaveLength(1)
  })

  it('two holds cannot both take the same single-capacity slot', async () => {
    const { lifecycle } = harness()
    await lifecycle.hold(scope, { serviceId: 'svc_cut', resourceId: 'res_asha', startAt: SLOT_10, partySize: 1 })
    await expect(lifecycle.hold(scope, {
      serviceId: 'svc_cut', resourceId: 'res_asha', startAt: SLOT_10, partySize: 1,
    })).rejects.toThrow(/unavailable/)
  })

  it('releases a hold so the slot returns', async () => {
    const { lifecycle } = harness()
    const hold = await lifecycle.hold(scope, {
      serviceId: 'svc_cut', resourceId: 'res_asha', startAt: SLOT_10, partySize: 1,
    })
    await lifecycle.releaseHold(scope, hold.holdId, hold.fence)
    const slots = await lifecycle.availability(scope, {
      serviceId: 'svc_cut', fromDate: '2026-03-02', toDate: '2026-03-02', partySize: 1,
    })
    expect(slots.map((slot) => slot.startAt)).toContain(SLOT_10)
  })

  it('reschedules onto a free slot and re-arms the reminder', async () => {
    const { repository, lifecycle } = harness()
    const hold = await lifecycle.hold(scope, {
      serviceId: 'svc_cut', resourceId: 'res_asha', startAt: SLOT_10, partySize: 1,
    })
    const booking = await lifecycle.book(scope, {
      holdId: hold.holdId, fence: hold.fence, customer, requestKey: 'req-fffffff1',
    })
    const moved = await lifecycle.reschedule(scope, {
      bookingId: booking.bookingId, startAt: '2026-03-02T09:00:00.000Z',
    })
    expect(moved.status).toBe('rescheduled')
    expect(moved.startAt).toBe('2026-03-02T09:00:00.000Z')
    const pending = repository.reminders(scope).filter((reminder) => reminder.state === 'pending')
    expect(pending).toHaveLength(1)
    expect(repository.events(scope).map((event) => event.kind)).toContain('rescheduled')
  })

  it('refuses to reschedule onto an occupied slot', async () => {
    const { lifecycle } = harness()
    const first = await lifecycle.hold(scope, {
      serviceId: 'svc_cut', resourceId: 'res_asha', startAt: SLOT_10, partySize: 1,
    })
    const booked = await lifecycle.book(scope, {
      holdId: first.holdId, fence: first.fence, customer, requestKey: 'req-ggggggg1',
    })
    const second = await lifecycle.hold(scope, {
      serviceId: 'svc_cut', resourceId: 'res_asha', startAt: '2026-03-02T09:00:00.000Z', partySize: 1,
    })
    await lifecycle.book(scope, {
      holdId: second.holdId, fence: second.fence, customer, requestKey: 'req-ggggggg2',
    })
    await expect(lifecycle.reschedule(scope, {
      bookingId: booked.bookingId, startAt: '2026-03-02T09:00:00.000Z',
    })).rejects.toThrow(/unavailable/)
  })

  it('cancels outside the window and refuses inside it', async () => {
    const repository = new MemoryBookingRepository([
      { scope, services: [service], locations: [location], resources: [resource], workingHours },
    ])
    let clock = new Date('2026-03-01T06:00:00Z')
    const lifecycle = new BookingLifecycleService({
      repository, identity: new SequentialBookingIdentity(), now: () => clock,
    })
    const hold = await lifecycle.hold(scope, {
      serviceId: 'svc_cut', resourceId: 'res_asha', startAt: SLOT_10, partySize: 1,
    })
    const booking = await lifecycle.book(scope, {
      holdId: hold.holdId, fence: hold.fence, customer, requestKey: 'req-hhhhhhh1',
    })

    clock = new Date('2026-03-02T06:30:00Z')
    await expect(lifecycle.cancel(scope, booking.bookingId, 'late change')).rejects.toThrow(/cancellation window/)

    clock = new Date('2026-03-02T04:00:00Z')
    const cancelled = await lifecycle.cancel(scope, booking.bookingId, 'plans changed')
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.cancelledAt).toBe('2026-03-02T04:00:00.000Z')
    expect(repository.reminders(scope).every((reminder) => reminder.state !== 'pending')).toBe(true)
  })

  it('cancelling twice is idempotent', async () => {
    const repository = new MemoryBookingRepository([
      { scope, services: [service], locations: [location], resources: [resource], workingHours },
    ])
    let clock = new Date('2026-03-01T06:00:00Z')
    const lifecycle = new BookingLifecycleService({
      repository, identity: new SequentialBookingIdentity(), now: () => clock,
    })
    const hold = await lifecycle.hold(scope, {
      serviceId: 'svc_cut', resourceId: 'res_asha', startAt: SLOT_10, partySize: 1,
    })
    const booking = await lifecycle.book(scope, {
      holdId: hold.holdId, fence: hold.fence, customer, requestKey: 'req-iiiiiii1',
    })
    clock = new Date('2026-03-02T04:00:00Z')
    await lifecycle.cancel(scope, booking.bookingId, 'first')
    const again = await lifecycle.cancel(scope, booking.bookingId, 'second')
    expect(again.status).toBe('cancelled')
  })

  it('settles completed and no-show, and refuses settling a cancelled booking', async () => {
    const repository = new MemoryBookingRepository([
      { scope, services: [service], locations: [location], resources: [resource], workingHours },
    ])
    let clock = new Date('2026-03-01T06:00:00Z')
    const lifecycle = new BookingLifecycleService({
      repository, identity: new SequentialBookingIdentity(), now: () => clock,
    })
    const first = await lifecycle.hold(scope, {
      serviceId: 'svc_cut', resourceId: 'res_asha', startAt: SLOT_10, partySize: 1,
    })
    const booking = await lifecycle.book(scope, {
      holdId: first.holdId, fence: first.fence, customer, requestKey: 'req-jjjjjjj1',
    })
    expect((await lifecycle.settle(scope, booking.bookingId, 'completed')).status).toBe('completed')

    const second = await lifecycle.hold(scope, {
      serviceId: 'svc_cut', resourceId: 'res_asha', startAt: '2026-03-02T09:00:00.000Z', partySize: 1,
    })
    const other = await lifecycle.book(scope, {
      holdId: second.holdId, fence: second.fence, customer, requestKey: 'req-jjjjjjj2',
    })
    clock = new Date('2026-03-02T04:00:00Z')
    await lifecycle.cancel(scope, other.bookingId, 'gone')
    await expect(lifecycle.settle(scope, other.bookingId, 'no-show')).rejects.toThrow(/cancelled booking/)
  })

  it('returns an ordered operator day schedule', async () => {
    const { lifecycle } = harness()
    const first = await lifecycle.hold(scope, {
      serviceId: 'svc_cut', resourceId: 'res_asha', startAt: '2026-03-02T09:00:00.000Z', partySize: 1,
    })
    await lifecycle.book(scope, { holdId: first.holdId, fence: first.fence, customer, requestKey: 'req-kkkkkkk1' })
    const second = await lifecycle.hold(scope, {
      serviceId: 'svc_cut', resourceId: 'res_asha', startAt: SLOT_10, partySize: 1,
    })
    await lifecycle.book(scope, { holdId: second.holdId, fence: second.fence, customer, requestKey: 'req-kkkkkkk2' })

    const day = await lifecycle.schedule(scope, { serviceId: 'svc_cut', date: '2026-03-02' })
    expect(day.map((booking) => booking.startAt)).toEqual([SLOT_10, '2026-03-02T09:00:00.000Z'])
  })

  it('keeps tenants isolated', async () => {
    const { lifecycle } = harness()
    await expect(lifecycle.availability(otherScope, {
      serviceId: 'svc_cut', fromDate: '2026-03-02', toDate: '2026-03-02', partySize: 1,
    })).rejects.toThrow(/unavailable/)
  })

  it('rejects unknown service, resource and booking ids', async () => {
    const { lifecycle } = harness()
    await expect(lifecycle.hold(scope, {
      serviceId: 'svc_missing', resourceId: 'res_asha', startAt: SLOT_10, partySize: 1,
    })).rejects.toThrow(/service is unavailable/)
    await expect(lifecycle.hold(scope, {
      serviceId: 'svc_cut', resourceId: 'res_missing', startAt: SLOT_10, partySize: 1,
    })).rejects.toThrow(/resource is unavailable/)
    await expect(lifecycle.cancel(scope, 'bkg_missing', 'x')).rejects.toThrow(/Booking is unavailable/)
  })
})

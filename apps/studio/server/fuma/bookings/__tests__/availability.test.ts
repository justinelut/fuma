import { describe, expect, it } from 'bun:test'
import {
  cancellationIsAllowed,
  computeAvailability,
  enumerateDates,
  resourceWindows,
  spanIsBookable,
  zoneOffsetMinutes,
  zonedDate,
  zonedInstant,
  zonedWeekday,
} from '../availability'
import type {
  Booking,
  BookingException,
  BookingHold,
  BookingResource,
  BookingService,
  BookingWorkingHour,
} from '../contracts'

const NAIROBI = 'Africa/Nairobi'
/** A zone with real DST, to prove wall-clock handling is not offset arithmetic. */
const LONDON = 'Europe/London'

function service(overrides: Partial<BookingService> = {}): BookingService {
  return Object.freeze({
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
    ...overrides,
  })
}

function resource(overrides: Partial<BookingResource> = {}): BookingResource {
  return Object.freeze({
    resourceId: 'res_asha',
    name: 'Asha',
    kind: 'staff',
    locationId: 'loc_kilimani',
    serviceIds: ['svc_cut'],
    concurrency: 1,
    state: 'active',
    ...overrides,
  })
}

function hours(resourceId: string, weekdays: readonly number[], startMinute = 9 * 60, endMinute = 17 * 60): readonly BookingWorkingHour[] {
  return Object.freeze(weekdays.map((weekday) => Object.freeze({ resourceId, weekday, startMinute, endMinute })))
}

function booking(overrides: Partial<Booking> = {}): Booking {
  return Object.freeze({
    bookingId: 'bkg_1',
    reference: 'FUMA-0001',
    serviceId: 'svc_cut',
    resourceId: 'res_asha',
    locationId: 'loc_kilimani',
    startAt: '2026-03-02T07:00:00.000Z',
    endAt: '2026-03-02T08:00:00.000Z',
    timeZone: NAIROBI,
    status: 'confirmed',
    customer: { name: 'Wanjiku', email: 'wanjiku@example.com', phone: null, notes: '' },
    intake: [],
    partySize: 1,
    priceMinor: 250_000,
    currency: 'KES',
    paymentReference: null,
    createdAt: '2026-03-01T07:00:00.000Z',
    updatedAt: '2026-03-01T07:00:00.000Z',
    cancelledAt: null,
    requestKey: 'req-00000001',
    ...overrides,
  })
}

function hold(overrides: Partial<BookingHold> = {}): BookingHold {
  return Object.freeze({
    holdId: 'hld_1',
    serviceId: 'svc_cut',
    resourceId: 'res_asha',
    startAt: '2026-03-02T08:00:00.000Z',
    endAt: '2026-03-02T09:00:00.000Z',
    expiresAt: '2026-03-01T08:10:00.000Z',
    fence: 1,
    state: 'held',
    ...overrides,
  })
}

describe('zone arithmetic', () => {
  it('resolves Nairobi as a fixed +03:00 zone', () => {
    expect(zoneOffsetMinutes(NAIROBI, new Date('2026-01-15T00:00:00Z'))).toBe(180)
    expect(zoneOffsetMinutes(NAIROBI, new Date('2026-07-15T00:00:00Z'))).toBe(180)
  })

  it('tracks a real DST transition instead of assuming a fixed offset', () => {
    expect(zoneOffsetMinutes(LONDON, new Date('2026-01-15T12:00:00Z'))).toBe(0)
    expect(zoneOffsetMinutes(LONDON, new Date('2026-07-15T12:00:00Z'))).toBe(60)
  })

  it('converts wall clock to the exact instant on both sides of a DST shift', () => {
    // 2026-03-29 is the UK spring-forward date; 09:00 local is 08:00Z after it.
    expect(zonedInstant(LONDON, '2026-03-28', 9 * 60).toISOString()).toBe('2026-03-28T09:00:00.000Z')
    expect(zonedInstant(LONDON, '2026-03-30', 9 * 60).toISOString()).toBe('2026-03-30T08:00:00.000Z')
  })

  it('round-trips a Nairobi wall clock through instant and back', () => {
    const instant = zonedInstant(NAIROBI, '2026-03-02', 10 * 60)
    expect(instant.toISOString()).toBe('2026-03-02T07:00:00.000Z')
    expect(zonedDate(NAIROBI, instant)).toBe('2026-03-02')
  })

  it('derives weekday in the target zone', () => {
    expect(zonedWeekday(NAIROBI, '2026-03-02')).toBe(1)
    expect(zonedWeekday(NAIROBI, '2026-03-08')).toBe(0)
  })

  it('enumerates an inclusive bounded date range', () => {
    expect(enumerateDates('2026-03-02', '2026-03-05', 10)).toEqual(['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05'])
    expect(enumerateDates('2026-03-02', '2026-03-30', 3)).toHaveLength(3)
  })
})

describe('resource windows', () => {
  it('uses weekday working hours when no exception applies', () => {
    const windows = resourceWindows('res_asha', NAIROBI, '2026-03-02', hours('res_asha', [1]), [])
    expect(windows).toEqual([{ startMinute: 540, endMinute: 1_020 }])
  })

  it('a closed exception removes the whole day', () => {
    const closed: BookingException[] = [{
      resourceId: 'res_asha', date: '2026-03-02', kind: 'closed', startMinute: null, endMinute: null, note: 'Public holiday',
    }]
    expect(resourceWindows('res_asha', NAIROBI, '2026-03-02', hours('res_asha', [1]), closed)).toEqual([])
  })

  it('a window exception replaces the weekday hours', () => {
    const override: BookingException[] = [{
      resourceId: 'res_asha', date: '2026-03-02', kind: 'window', startMinute: 600, endMinute: 720, note: 'Short day',
    }]
    expect(resourceWindows('res_asha', NAIROBI, '2026-03-02', hours('res_asha', [1]), override))
      .toEqual([{ startMinute: 600, endMinute: 720 }])
  })
})

describe('availability computation', () => {
  const base = {
    workingHours: hours('res_asha', [1]),
    exceptions: [] as readonly BookingException[],
    timeZone: NAIROBI,
    fromDate: '2026-03-02',
    toDate: '2026-03-02',
    now: new Date('2026-03-01T06:00:00Z'),
    partySize: 1,
    maxSlots: 50,
  }

  it('produces one slot per interval inside the working window', () => {
    const slots = computeAvailability({
      ...base, service: service(), resources: [resource()], bookings: [], holds: [],
    })
    expect(slots).toHaveLength(8)
    expect(slots[0]?.localStart).toBe('09:00')
    expect(slots[0]?.startAt).toBe('2026-03-02T06:00:00.000Z')
    expect(slots.at(-1)?.localStart).toBe('16:00')
  })

  it('is deterministic and ordered by instant then resource', () => {
    const twoResources = [resource(), resource({ resourceId: 'res_brian', name: 'Brian' })]
    const request = {
      ...base,
      service: service(),
      resources: twoResources,
      workingHours: [...hours('res_asha', [1]), ...hours('res_brian', [1])],
      bookings: [],
      holds: [],
    }
    const first = computeAvailability(request)
    const second = computeAvailability(request)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(first[0]?.resourceId).toBe('res_asha')
    expect(first[1]?.resourceId).toBe('res_brian')
  })

  it('removes a slot already consumed by a confirmed booking', () => {
    const slots = computeAvailability({
      ...base, service: service(), resources: [resource()], bookings: [booking()], holds: [],
    })
    expect(slots.map((slot) => slot.localStart)).not.toContain('10:00')
    expect(slots).toHaveLength(7)
  })

  it('ignores a cancelled booking so its capacity returns', () => {
    const slots = computeAvailability({
      ...base,
      service: service(),
      resources: [resource()],
      bookings: [booking({ status: 'cancelled', cancelledAt: '2026-03-01T07:30:00.000Z' })],
      holds: [],
    })
    expect(slots.map((slot) => slot.localStart)).toContain('10:00')
  })

  it('a live hold consumes capacity but an expired hold does not', () => {
    const live = computeAvailability({
      ...base, service: service(), resources: [resource()], bookings: [], holds: [hold()],
    })
    expect(live.map((slot) => slot.localStart)).not.toContain('11:00')

    const stale = computeAvailability({
      ...base,
      service: service(),
      resources: [resource()],
      bookings: [],
      holds: [hold({ expiresAt: '2026-03-01T05:00:00.000Z' })],
    })
    expect(stale.map((slot) => slot.localStart)).toContain('11:00')
  })

  it('keeps a shared slot open while group capacity remains', () => {
    const slots = computeAvailability({
      ...base,
      service: service({ capacityPerSlot: 10 }),
      resources: [resource({ concurrency: 10 })],
      bookings: [booking({ partySize: 4 })],
      holds: [],
      partySize: 6,
    })
    const ten = slots.find((slot) => slot.localStart === '10:00')
    expect(ten?.remainingCapacity).toBe(6)

    const tooLarge = computeAvailability({
      ...base,
      service: service({ capacityPerSlot: 10 }),
      resources: [resource({ concurrency: 10 })],
      bookings: [booking({ partySize: 4 })],
      holds: [],
      partySize: 7,
    })
    expect(tooLarge.map((slot) => slot.localStart)).not.toContain('10:00')
  })

  it('honours minimum notice and maximum advance', () => {
    const notice = computeAvailability({
      ...base,
      service: service({ minimumNoticeMinutes: 48 * 60 }),
      resources: [resource()],
      bookings: [],
      holds: [],
    })
    expect(notice).toHaveLength(0)

    const advance = computeAvailability({
      ...base,
      service: service({ maximumAdvanceDays: 1 }),
      resources: [resource()],
      bookings: [],
      holds: [],
      fromDate: '2026-03-30',
      toDate: '2026-03-30',
    })
    expect(advance).toHaveLength(0)
  })

  it('excludes suspended resources and unrelated services', () => {
    expect(computeAvailability({
      ...base, service: service(), resources: [resource({ state: 'suspended' })], bookings: [], holds: [],
    })).toHaveLength(0)
    expect(computeAvailability({
      ...base, service: service(), resources: [resource({ serviceIds: ['svc_other'] })], bookings: [], holds: [],
    })).toHaveLength(0)
    expect(computeAvailability({
      ...base, service: service({ state: 'paused' }), resources: [resource()], bookings: [], holds: [],
    })).toHaveLength(0)
  })

  it('reserves buffer time so back-to-back slots stay honest', () => {
    const slots = computeAvailability({
      ...base,
      service: service({ durationMinutes: 45, bufferAfterMinutes: 15, slotIntervalMinutes: 60 }),
      resources: [resource()],
      bookings: [],
      holds: [],
    })
    expect(slots).toHaveLength(8)
    expect(slots[0]?.endAt).toBe('2026-03-02T06:45:00.000Z')
  })

  it('keeps DST-day slots on their real wall clock', () => {
    const slots = computeAvailability({
      ...base,
      timeZone: LONDON,
      fromDate: '2026-03-30',
      toDate: '2026-03-30',
      now: new Date('2026-03-29T00:00:00Z'),
      service: service(),
      resources: [resource()],
      workingHours: hours('res_asha', [1]),
      bookings: [],
      holds: [],
    })
    expect(slots[0]?.localStart).toBe('09:00')
    // After spring-forward London is UTC+1, so 09:00 local is 08:00Z.
    expect(slots[0]?.startAt).toBe('2026-03-30T08:00:00.000Z')
  })

  it('bounds the result to maxSlots', () => {
    const slots = computeAvailability({
      ...base, service: service(), resources: [resource()], bookings: [], holds: [], maxSlots: 3,
    })
    expect(slots).toHaveLength(3)
  })
})

describe('span validation and cancellation', () => {
  const common = {
    service: service(),
    resource: resource(),
    workingHours: hours('res_asha', [1]),
    exceptions: [] as readonly BookingException[],
    bookings: [] as readonly Booking[],
    holds: [] as readonly BookingHold[],
    timeZone: NAIROBI,
    partySize: 1,
    now: new Date('2026-03-01T06:00:00Z'),
  }

  it('accepts an aligned in-window span', () => {
    expect(spanIsBookable({ ...common, startAt: new Date('2026-03-02T06:00:00Z') })).toBe(true)
  })

  it('rejects a span outside the window, misaligned, or already taken', () => {
    expect(spanIsBookable({ ...common, startAt: new Date('2026-03-02T05:00:00Z') })).toBe(false)
    expect(spanIsBookable({ ...common, startAt: new Date('2026-03-02T06:30:00Z') })).toBe(false)
    expect(spanIsBookable({
      ...common,
      startAt: new Date('2026-03-02T07:00:00Z'),
      bookings: [booking()],
    })).toBe(false)
  })

  it('can ignore the booking being rescheduled so its own slot is reusable', () => {
    expect(spanIsBookable({
      ...common,
      startAt: new Date('2026-03-02T07:00:00Z'),
      bookings: [booking()],
      ignoreBookingId: 'bkg_1',
    })).toBe(true)
  })

  it('allows cancellation only outside the cancellation window', () => {
    expect(cancellationIsAllowed(service(), booking(), new Date('2026-03-02T04:00:00Z'))).toBe(true)
    expect(cancellationIsAllowed(service(), booking(), new Date('2026-03-02T06:30:00Z'))).toBe(false)
  })
})

import { describe, expect, it } from 'bun:test'
import {
  ReviewedBackendCapabilityRegistry,
  type BackendCapabilityEvidencePort,
  type TrustedBackendCapabilityAuthority,
} from '../../aiBackendCapabilities'
import { LifecycleBookingCapabilityAuthority } from '../authority'
import { BOOKING_CAPABILITY_IDS, registerBookingCapabilities } from '../capabilities'
import { MemoryBookingRepository, SequentialBookingIdentity } from '../memory'
import { BookingLifecycleService } from '../service'
import type { Booking, BookingLocation, BookingResource, BookingService } from '../contracts'

const NAIROBI = 'Africa/Nairobi'
const NOW = new Date('2026-03-01T06:00:00Z')
const SLOT_10 = '2026-03-02T07:00:00.000Z'

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

const workingHours = Object.freeze([
  Object.freeze({ resourceId: 'res_asha', weekday: 1, startMinute: 540, endMinute: 1_020 }),
])

function evidence(): BackendCapabilityEvidencePort {
  return {
    async admit() {},
    async record() { return { metered: true as const, audited: true as const } },
  }
}

function authorityFor(siteId: string, extra: Partial<TrustedBackendCapabilityAuthority> = {}): TrustedBackendCapabilityAuthority {
  return {
    channel: 'site-ai',
    operationId: `op_${siteId}`,
    outerReceiptId: `rcp_${siteId}`,
    reservationId: `rsv_${siteId}`,
    scope: {
      platformId: 'platform',
      organizationId: 'org_alpha',
      workspaceId: 'wsp_alpha',
      siteId,
      ownerKey: `owner_${siteId}`,
      ownerGeneration: 1,
      profileId: 'website',
    },
    actor: { kind: 'staff', actorId: 'usr_1', sessionId: 'ses_1', impersonatorId: null },
    permissions: [
      'bookings.services.read', 'bookings.availability.read',
      'bookings.holds.write', 'bookings.write', 'bookings.read',
    ],
    grants: ['ai.chat', 'ai.tools.write'],
    authorityRevision: 1,
    state: 'active',
    resolvedAt: NOW.toISOString(),
    confirmation: null,
    ...extra,
  } as TrustedBackendCapabilityAuthority
}

function harness() {
  const repository = new MemoryBookingRepository([
    {
      scope: { organizationId: 'org_alpha', workspaceId: 'wsp_alpha', siteId: 'site_alpha' },
      services: [service], locations: [location], resources: [resource], workingHours,
    },
    {
      // A second site with its own identical catalogue, to prove isolation.
      scope: { organizationId: 'org_alpha', workspaceId: 'wsp_alpha', siteId: 'site_beta' },
      services: [service], locations: [location], resources: [resource], workingHours,
    },
  ])
  const lifecycle = new BookingLifecycleService({
    repository,
    identity: new SequentialBookingIdentity(),
    now: () => NOW,
  })
  const registry = registerBookingCapabilities(
    new ReviewedBackendCapabilityRegistry(() => NOW),
    new LifecycleBookingCapabilityAuthority(lifecycle),
  )
  const invoke = (id: string, rawInput: unknown, siteId = 'site_alpha', extra: Partial<TrustedBackendCapabilityAuthority> = {}) =>
    registry.invoke({
      id,
      version: '1.0.0',
      rawInput,
      resolveAuthority: async () => authorityFor(siteId, extra),
      evidence: evidence(),
    })
  return { repository, invoke }
}

describe('FUMA-093 capability-driven booking journey', () => {
  it('runs list → availability → hold → confirm → reschedule → cancel through capabilities only', async () => {
    const { repository, invoke } = harness()

    const services = await invoke(BOOKING_CAPABILITY_IDS.listServices, { limit: 10 })
    expect((services.output as { services: BookingService[] }).services.map((s) => s.slug)).toEqual(['haircut'])

    const availability = await invoke(BOOKING_CAPABILITY_IDS.availability, {
      serviceId: 'svc_cut', fromDate: '2026-03-02', toDate: '2026-03-02',
      partySize: 1, resourceId: null, maxSlots: 50,
    })
    const slots = (availability.output as { slots: { startAt: string; localStart: string }[] }).slots
    expect(slots).toHaveLength(8)
    expect(slots[0]?.localStart).toBe('09:00')

    const held = await invoke(BOOKING_CAPABILITY_IDS.hold, {
      serviceId: 'svc_cut', resourceId: 'res_asha', startAt: SLOT_10, partySize: 1,
    })
    const hold = held.output as { holdId: string; fence: number; expiresAt: string }
    expect(hold.fence).toBe(1)

    const confirmed = await invoke(BOOKING_CAPABILITY_IDS.book, {
      holdId: hold.holdId, fence: hold.fence,
      customer: { name: 'Wanjiku', email: 'wanjiku@example.test', phone: '+254700000000', notes: '' },
      intake: [{ fieldId: 'style', label: 'Preferred style', value: 'Short fade' }],
      requestKey: 'req-journey01',
    })
    const booking = (confirmed.output as { booking: Booking }).booking
    expect(booking.status).toBe('confirmed')
    expect(booking.startAt).toBe(SLOT_10)
    expect(booking.intake).toHaveLength(1)

    const moved = await invoke(BOOKING_CAPABILITY_IDS.reschedule, {
      bookingId: booking.bookingId, startAt: '2026-03-02T09:00:00.000Z', resourceId: null,
    })
    expect((moved.output as { booking: Booking }).booking.status).toBe('rescheduled')

    const day = await invoke(BOOKING_CAPABILITY_IDS.schedule, { serviceId: 'svc_cut', date: '2026-03-02' })
    expect((day.output as { bookings: Booking[] }).bookings).toHaveLength(1)

    const cancelled = await invoke(BOOKING_CAPABILITY_IDS.cancel, {
      bookingId: booking.bookingId, reason: 'plans changed',
    })
    expect((cancelled.output as { booking: Booking }).booking.status).toBe('cancelled')

    const scope = { organizationId: 'org_alpha', workspaceId: 'wsp_alpha', siteId: 'site_alpha' }
    expect(repository.events(scope).map((event) => event.kind))
      .toEqual(['held', 'booked', 'rescheduled', 'cancelled'])
  })

  it('keeps a duplicate confirmation idempotent through the capability boundary', async () => {
    const { repository, invoke } = harness()
    const held = await invoke(BOOKING_CAPABILITY_IDS.hold, {
      serviceId: 'svc_cut', resourceId: 'res_asha', startAt: SLOT_10, partySize: 1,
    })
    const hold = held.output as { holdId: string; fence: number }
    const payload = {
      holdId: hold.holdId, fence: hold.fence,
      customer: { name: 'Wanjiku', email: 'wanjiku@example.test', phone: null, notes: '' },
      intake: [], requestKey: 'req-idempot1',
    }
    const first = await invoke(BOOKING_CAPABILITY_IDS.book, payload)
    const second = await invoke(BOOKING_CAPABILITY_IDS.book, payload)
    expect((second.output as { booking: Booking }).booking.bookingId)
      .toBe((first.output as { booking: Booking }).booking.bookingId)
    expect(repository.bookings({ organizationId: 'org_alpha', workspaceId: 'wsp_alpha', siteId: 'site_alpha' }))
      .toHaveLength(1)
  })

  it('does not let one site see or take another site capacity', async () => {
    const { invoke } = harness()
    await invoke(BOOKING_CAPABILITY_IDS.hold, {
      serviceId: 'svc_cut', resourceId: 'res_asha', startAt: SLOT_10, partySize: 1,
    }, 'site_alpha')

    // The same slot is still free for the other site.
    const betaSlots = await invoke(BOOKING_CAPABILITY_IDS.availability, {
      serviceId: 'svc_cut', fromDate: '2026-03-02', toDate: '2026-03-02',
      partySize: 1, resourceId: null, maxSlots: 50,
    }, 'site_beta')
    expect((betaSlots.output as { slots: { startAt: string }[] }).slots.map((s) => s.startAt)).toContain(SLOT_10)

    // And it is taken for the originating site.
    const alphaSlots = await invoke(BOOKING_CAPABILITY_IDS.availability, {
      serviceId: 'svc_cut', fromDate: '2026-03-02', toDate: '2026-03-02',
      partySize: 1, resourceId: null, maxSlots: 50,
    }, 'site_alpha')
    expect((alphaSlots.output as { slots: { startAt: string }[] }).slots.map((s) => s.startAt)).not.toContain(SLOT_10)
  })

  it('surfaces a slot conflict as a capability failure rather than a silent overwrite', async () => {
    const { invoke } = harness()
    await invoke(BOOKING_CAPABILITY_IDS.hold, {
      serviceId: 'svc_cut', resourceId: 'res_asha', startAt: SLOT_10, partySize: 1,
    })
    await expect(invoke(BOOKING_CAPABILITY_IDS.hold, {
      serviceId: 'svc_cut', resourceId: 'res_asha', startAt: SLOT_10, partySize: 1,
    })).rejects.toThrow(/unavailable/)
  })

  it('records an owner-confirmed settlement receipt', async () => {
    const { invoke } = harness()
    const held = await invoke(BOOKING_CAPABILITY_IDS.hold, {
      serviceId: 'svc_cut', resourceId: 'res_asha', startAt: SLOT_10, partySize: 1,
    })
    const hold = held.output as { holdId: string; fence: number }
    const confirmed = await invoke(BOOKING_CAPABILITY_IDS.book, {
      holdId: hold.holdId, fence: hold.fence,
      customer: { name: 'Wanjiku', email: 'wanjiku@example.test', phone: null, notes: '' },
      intake: [], requestKey: 'req-settle001',
    })
    const booking = (confirmed.output as { booking: Booking }).booking
    const settled = await invoke(
      BOOKING_CAPABILITY_IDS.settle,
      { bookingId: booking.bookingId, outcome: 'completed' },
      'site_alpha',
      {
        confirmation: {
          confirmationId: 'cnf_1',
          actorId: 'usr_1',
          operationId: 'op_site_alpha',
          capabilityId: BOOKING_CAPABILITY_IDS.settle,
          capabilityVersion: '1.0.0',
          ownerKey: 'owner_site_alpha',
          ownerGeneration: 1,
          confirmedAt: NOW.toISOString(),
        },
      },
    )
    expect((settled.output as { booking: Booking }).booking.status).toBe('completed')
    expect(settled.receipt.capabilityId).toBe(BOOKING_CAPABILITY_IDS.settle)
    expect(settled.receipt.outcome).toBe('succeeded')
  })
})

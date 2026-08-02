import { describe, expect, it } from 'bun:test'
import {
  ReviewedBackendCapabilityRegistry,
  assertStrictCapabilitySchema,
  type BackendCapabilityEvidencePort,
  type TrustedBackendCapabilityAuthority,
} from '../../aiBackendCapabilities'
import {
  BOOKING_CAPABILITY_IDS,
  bookingBlockingDiagnostic,
  createBookingCapabilities,
  registerBookingCapabilities,
  type BookingCapabilityAuthority,
} from '../capabilities'

const NAIROBI = 'Africa/Nairobi'

const booking = Object.freeze({
  bookingId: 'bkg_0001',
  reference: 'FUMA-0001',
  serviceId: 'svc_cut',
  resourceId: 'res_asha',
  locationId: 'loc_kilimani',
  startAt: '2026-03-02T07:00:00.000Z',
  endAt: '2026-03-02T08:00:00.000Z',
  timeZone: NAIROBI,
  status: 'confirmed' as const,
  customer: { name: 'Wanjiku', email: 'wanjiku@example.test', phone: null, notes: '' },
  intake: [],
  partySize: 1,
  priceMinor: 250_000,
  currency: 'KES' as const,
  paymentReference: null,
  createdAt: '2026-03-01T06:00:00.000Z',
  updatedAt: '2026-03-01T06:00:00.000Z',
  cancelledAt: null,
  requestKey: 'req-aaaaaaa1',
})

/** Records what each capability received so scope derivation can be asserted. */
function stubAuthority() {
  const calls: { id: string; scopeSiteId: string }[] = []
  const authority: BookingCapabilityAuthority = {
    async listServices(_input, ctx) { calls.push({ id: 'listServices', scopeSiteId: ctx.scope.siteId }); return { services: [] } },
    async availability(_input, ctx) { calls.push({ id: 'availability', scopeSiteId: ctx.scope.siteId }); return { slots: [] } },
    async hold(_input, ctx) {
      calls.push({ id: 'hold', scopeSiteId: ctx.scope.siteId })
      return { holdId: 'hld_0001', fence: 1, expiresAt: '2026-03-01T06:10:00.000Z' }
    },
    async releaseHold(_input, ctx) { calls.push({ id: 'releaseHold', scopeSiteId: ctx.scope.siteId }); return { released: true as const } },
    async confirm(_input, ctx) { calls.push({ id: 'confirm', scopeSiteId: ctx.scope.siteId }); return { booking } },
    async reschedule(_input, ctx) { calls.push({ id: 'reschedule', scopeSiteId: ctx.scope.siteId }); return { booking } },
    async cancel(_input, ctx) { calls.push({ id: 'cancel', scopeSiteId: ctx.scope.siteId }); return { booking } },
    async settle(_input, ctx) { calls.push({ id: 'settle', scopeSiteId: ctx.scope.siteId }); return { booking } },
    async daySchedule(_input, ctx) {
      calls.push({ id: 'daySchedule', scopeSiteId: ctx.scope.siteId })
      return { date: '2026-03-02', bookings: [booking] }
    },
  }
  return { authority, calls }
}

function evidence(): BackendCapabilityEvidencePort & { admitted: number; recorded: number } {
  const port = {
    admitted: 0,
    recorded: 0,
    async admit() { port.admitted += 1 },
    async record() { port.recorded += 1; return { metered: true as const, audited: true as const } },
  }
  return port
}

function trustedAuthority(overrides: Partial<TrustedBackendCapabilityAuthority> = {}): TrustedBackendCapabilityAuthority {
  return {
    channel: 'site-ai',
    operationId: 'op_0001',
    outerReceiptId: 'rcp_outer_0001',
    reservationId: 'rsv_0001',
    scope: {
      platformId: 'platform',
      organizationId: 'org_alpha',
      workspaceId: 'wsp_alpha',
      siteId: 'site_alpha',
      ownerKey: 'owner_alpha',
      ownerGeneration: 4,
      profileId: 'website',
    },
    actor: { kind: 'staff', actorId: 'usr_1', sessionId: 'ses_1', impersonatorId: null },
    permissions: [
      'bookings.services.read', 'bookings.availability.read',
      'bookings.holds.write', 'bookings.write', 'bookings.read',
    ],
    grants: ['ai.chat', 'ai.tools.write'],
    authorityRevision: 4,
    state: 'active',
    resolvedAt: '2026-03-01T06:00:00.000Z',
    confirmation: null,
    ...overrides,
  } as TrustedBackendCapabilityAuthority
}

describe('booking capability contracts', () => {
  it('registers every booking capability exactly once', () => {
    const { authority } = stubAuthority()
    const registry = registerBookingCapabilities(new ReviewedBackendCapabilityRegistry(), authority)
    for (const id of Object.values(BOOKING_CAPABILITY_IDS)) {
      expect(registry.definition(id, '1.0.0')).not.toBeNull()
    }
    expect(() => registerBookingCapabilities(registry, authority)).toThrow(/already registered/)
  })

  it('uses capability ids the registry pattern accepts', () => {
    for (const id of Object.values(BOOKING_CAPABILITY_IDS)) {
      expect(id).toMatch(/^[a-z][a-z0-9.-]*$/)
    }
  })

  it('exposes only strict schemas with no Any or Unknown', () => {
    const { authority } = stubAuthority()
    for (const capability of createBookingCapabilities(authority)) {
      expect(() => assertStrictCapabilitySchema(capability.inputSchema, `${capability.metadata.id}.input`)).not.toThrow()
      expect(() => assertStrictCapabilitySchema(capability.outputSchema, `${capability.metadata.id}.output`)).not.toThrow()
    }
  })

  it('extends the website profile rather than inventing one, on every channel', () => {
    const { authority } = stubAuthority()
    for (const capability of createBookingCapabilities(authority)) {
      expect(capability.metadata.profiles).toEqual(['website'])
      expect(capability.metadata.channels).toEqual(['site-ai', 'mcp', 'imported-runtime', 'export-adapter'])
      expect(capability.metadata.metering.kind).toBe('ai')
      expect(capability.metadata.state).toBe('active')
    }
  })

  it('requires owner confirmation only for settling an outcome', () => {
    const { authority } = stubAuthority()
    const confirmations = new Map(createBookingCapabilities(authority)
      .map((capability) => [capability.metadata.id, capability.metadata.confirmation]))
    expect(confirmations.get(BOOKING_CAPABILITY_IDS.settle)).toBe('owner')
    expect(confirmations.get(BOOKING_CAPABILITY_IDS.book)).toBe('none')
    expect(confirmations.get(BOOKING_CAPABILITY_IDS.availability)).toBe('none')
  })

  it('classifies reads and writes with distinct permissions', () => {
    const { authority } = stubAuthority()
    const byId = new Map(createBookingCapabilities(authority).map((c) => [c.metadata.id, c.metadata]))
    expect(byId.get(BOOKING_CAPABILITY_IDS.availability)?.class).toBe('read')
    expect(byId.get(BOOKING_CAPABILITY_IDS.availability)?.requiredPermission).toBe('bookings.availability.read')
    expect(byId.get(BOOKING_CAPABILITY_IDS.book)?.class).toBe('mutate')
    expect(byId.get(BOOKING_CAPABILITY_IDS.book)?.requiredPermission).toBe('bookings.write')
  })
})

describe('booking capability invocation', () => {
  it('derives tenant scope from the trusted authority, not from input', async () => {
    const { authority, calls } = stubAuthority()
    const registry = registerBookingCapabilities(new ReviewedBackendCapabilityRegistry(), authority)
    const port = evidence()
    const result = await registry.invoke({
      id: BOOKING_CAPABILITY_IDS.availability,
      version: '1.0.0',
      rawInput: {
        serviceId: 'svc_cut', fromDate: '2026-03-02', toDate: '2026-03-02',
        partySize: 1, resourceId: null, maxSlots: 50,
      },
      resolveAuthority: async () => trustedAuthority(),
      evidence: port,
    })
    expect(calls).toEqual([{ id: 'availability', scopeSiteId: 'site_alpha' }])
    expect((result.output as { slots: unknown[] }).slots).toEqual([])
    expect(result.receipt.metered).toBe(true)
    expect(result.receipt.audited).toBe(true)
    expect(port.admitted).toBe(1)
    expect(port.recorded).toBe(1)
  })

  it('rejects hostile input fields before any authority resolution', async () => {
    const { authority, calls } = stubAuthority()
    const registry = registerBookingCapabilities(new ReviewedBackendCapabilityRegistry(), authority)
    let resolved = 0
    await expect(registry.invoke({
      id: BOOKING_CAPABILITY_IDS.availability,
      version: '1.0.0',
      rawInput: {
        serviceId: 'svc_cut', fromDate: '2026-03-02', toDate: '2026-03-02',
        partySize: 1, resourceId: null, maxSlots: 50,
        // Hostile additions the strict schema must refuse.
        organizationId: 'org_other', sql: 'select 1', table: 'fuma_bookings_v1',
      },
      resolveAuthority: async () => { resolved += 1; return trustedAuthority() },
      evidence: evidence(),
    })).rejects.toThrow(/input is invalid/)
    expect(resolved).toBe(0)
    expect(calls).toEqual([])
  })

  it('denies a caller missing the required permission', async () => {
    const { authority } = stubAuthority()
    const registry = registerBookingCapabilities(new ReviewedBackendCapabilityRegistry(), authority)
    await expect(registry.invoke({
      id: BOOKING_CAPABILITY_IDS.book,
      version: '1.0.0',
      rawInput: {
        holdId: 'hld_0001', fence: 1,
        customer: { name: 'A', email: 'a@example.test', phone: null, notes: '' },
        intake: [], requestKey: 'req-aaaaaaa1',
      },
      resolveAuthority: async () => trustedAuthority({ permissions: ['bookings.read'] }),
      evidence: evidence(),
    })).rejects.toThrow(/permission is unavailable/)
  })

  it('denies settling without exact owner confirmation', async () => {
    const { authority } = stubAuthority()
    const registry = registerBookingCapabilities(new ReviewedBackendCapabilityRegistry(), authority)
    await expect(registry.invoke({
      id: BOOKING_CAPABILITY_IDS.settle,
      version: '1.0.0',
      rawInput: { bookingId: 'bkg_0001', outcome: 'completed' },
      resolveAuthority: async () => trustedAuthority(),
      evidence: evidence(),
    })).rejects.toThrow(/owner confirmation is required/)
  })

  it('accepts settling with an exact owner confirmation', async () => {
    const { authority, calls } = stubAuthority()
    const registry = registerBookingCapabilities(new ReviewedBackendCapabilityRegistry(), authority)
    const result = await registry.invoke({
      id: BOOKING_CAPABILITY_IDS.settle,
      version: '1.0.0',
      rawInput: { bookingId: 'bkg_0001', outcome: 'completed' },
      resolveAuthority: async () => trustedAuthority({
        confirmation: {
          confirmationId: 'cnf_1',
          actorId: 'usr_1',
          operationId: 'op_0001',
          capabilityId: BOOKING_CAPABILITY_IDS.settle,
          capabilityVersion: '1.0.0',
          ownerKey: 'owner_alpha',
          ownerGeneration: 4,
          confirmedAt: '2026-03-01T06:00:00.000Z',
        },
      }),
      evidence: evidence(),
    })
    expect(calls.map((call) => call.id)).toEqual(['settle'])
    expect((result.output as { booking: { bookingId: string } }).booking.bookingId).toBe('bkg_0001')
  })

  it('denies a revoked authority and a stale owner generation', async () => {
    const { authority } = stubAuthority()
    const registry = registerBookingCapabilities(new ReviewedBackendCapabilityRegistry(), authority)
    const call = (overrides: Partial<TrustedBackendCapabilityAuthority>) => registry.invoke({
      id: BOOKING_CAPABILITY_IDS.listServices,
      version: '1.0.0',
      rawInput: { limit: 10 },
      resolveAuthority: async () => trustedAuthority(overrides),
      evidence: evidence(),
    })
    await expect(call({ state: 'revoked' })).rejects.toThrow(/revoked/)
    await expect(call({ authorityRevision: 3 })).rejects.toThrow(/stale/)
  })

  it('denies an impersonated invocation', async () => {
    const { authority } = stubAuthority()
    const registry = registerBookingCapabilities(new ReviewedBackendCapabilityRegistry(), authority)
    await expect(registry.invoke({
      id: BOOKING_CAPABILITY_IDS.listServices,
      version: '1.0.0',
      rawInput: { limit: 10 },
      resolveAuthority: async () => trustedAuthority({
        actor: { kind: 'staff', actorId: 'usr_1', sessionId: 'ses_1', impersonatorId: 'support_1' },
      }),
      evidence: evidence(),
    })).rejects.toThrow(/Impersonated/)
  })

  it('denies the publication profile for a website-only pack', async () => {
    const { authority } = stubAuthority()
    const registry = registerBookingCapabilities(new ReviewedBackendCapabilityRegistry(), authority)
    await expect(registry.invoke({
      id: BOOKING_CAPABILITY_IDS.listServices,
      version: '1.0.0',
      rawInput: { limit: 10 },
      resolveAuthority: async () => trustedAuthority({
        scope: { ...trustedAuthority().scope, profileId: 'publication' },
      }),
      evidence: evidence(),
    })).rejects.toThrow(/site profile or channel/)
  })
})

describe('booking deferrals', () => {
  it('names an explicit reason for each deliberately unsupported request', () => {
    expect(bookingBlockingDiagnostic('bookings.sql')).toMatch(/Direct SQL/)
    expect(bookingBlockingDiagnostic('bookings.charge')).toMatch(/payment authority/)
    expect(bookingBlockingDiagnostic('bookings.clinical')).toMatch(/out of scope/)
    expect(bookingBlockingDiagnostic('bookings.availability')).toBeNull()
  })
})

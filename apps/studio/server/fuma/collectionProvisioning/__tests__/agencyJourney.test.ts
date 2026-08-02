import { describe, expect, it } from 'bun:test'
import type { DataField, DataTable } from '@core/data/schemas'
import { validateFormSubmission } from '@core/forms/validation'
import {
  CollectionProvisioningService,
  blueprintByKey,
  blueprintProvisionOrder,
  type CollectionStore,
} from '../../collectionProvisioning'
import { LifecycleBookingCapabilityAuthority } from '../../bookings/authority'
import { BOOKING_CAPABILITY_IDS, registerBookingCapabilities } from '../../bookings/capabilities'
import { MemoryBookingRepository, SequentialBookingIdentity } from '../../bookings/memory'
import { BookingLifecycleService } from '../../bookings/service'
import {
  ReviewedBackendCapabilityRegistry,
  type BackendCapabilityEvidencePort,
  type TrustedBackendCapabilityAuthority,
} from '../../aiBackendCapabilities'

/**
 * The decisive integration proof for the narrowed scope.
 *
 * It shows that an agency/business site — and the events and hospitality cases —
 * are fully expressible with the primitives that already exist:
 *
 *   universal data model  →  collections and rows
 *   existing forms        →  lead capture with validation and limits
 *   FUMA-093 bookings     →  the only contention-sensitive part
 *
 * No vertical engine is involved. If this passes, shipping Events, Hospitality
 * or Ecommerce packs is not required to serve those businesses.
 */

const NOW = new Date('2026-03-01T06:00:00Z')

class MemoryCollectionStore implements CollectionStore {
  readonly tables = new Map<string, DataTable>()
  #next = 0
  async listCollections(): Promise<readonly DataTable[]> { return [...this.tables.values()] }
  async getCollectionBySlug(slug: string): Promise<DataTable | null> { return this.tables.get(slug) ?? null }
  async createCollection(input: Parameters<CollectionStore['createCollection']>[0]): Promise<DataTable> {
    this.#next += 1
    const created = {
      id: `tbl_${this.#next}`,
      name: input.name,
      slug: input.slug,
      kind: input.kind,
      routeBase: input.routeBase,
      singularLabel: input.singularLabel,
      pluralLabel: input.pluralLabel,
      primaryFieldId: input.primaryFieldId,
      fields: [...input.fields] as DataField[],
      system: false,
      createdByUserId: null,
      updatedByUserId: null,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    } as DataTable
    this.tables.set(created.slug, created)
    return created
  }
  async updateCollectionFields(collectionId: string, fields: readonly DataField[]): Promise<DataTable | null> {
    for (const [slug, entry] of this.tables) {
      if (entry.id !== collectionId) continue
      const updated = { ...entry, fields: [...fields] } as DataTable
      this.tables.set(slug, updated)
      return updated
    }
    return null
  }
}

/** A lead collection is an ordinary record collection, so forms can target it. */
const leadCollection = {
  slug: 'enquiries',
  name: 'Enquiries',
  singularLabel: 'Enquiry',
  pluralLabel: 'Enquiries',
  shape: 'records' as const,
  primaryFieldId: 'name',
  fields: [
    { id: 'name', label: 'Name', type: 'text' as const, required: true },
    { id: 'email', label: 'Email', type: 'email' as const, required: true },
    { id: 'phone', label: 'Phone', type: 'text' as const },
    { id: 'service', label: 'Service of interest', type: 'relation' as const, targetCollectionSlug: 'services' },
    { id: 'message', label: 'Message', type: 'longText' as const, required: true },
    { id: 'consent', label: 'Consent to be contacted', type: 'boolean' as const, required: true },
    { id: 'source', label: 'Campaign source', type: 'text' as const },
  ],
}

/** Control bindings are what a published form emits for each input node. */
function controls(fieldIds: readonly string[], required: readonly string[] = []) {
  return fieldIds.map((fieldId) => ({
    nodeId: `node_${fieldId}`,
    fieldId,
    name: fieldId,
    ...(required.includes(fieldId) ? { required: true } : {}),
  }))
}

describe('AI-built agency site on existing primitives', () => {
  it('models a full agency site with provisioning alone', async () => {
    const store = new MemoryCollectionStore()
    const provisioning = new CollectionProvisioningService(store)

    // What an agency actually needs, in dependency order.
    const wanted = ['services', 'team', 'case-studies', 'testimonials', 'faqs', 'locations', 'pricing-tiers']
    for (const key of blueprintProvisionOrder(wanted)) {
      const entry = blueprintByKey(key)
      if (!entry) throw new Error(`missing blueprint ${key}`)
      await provisioning.provision(entry.definition)
    }
    // Plus a lead collection the blueprints do not prescribe.
    await provisioning.provision(leadCollection)

    expect([...store.tables.keys()].sort()).toEqual([
      'case-studies', 'enquiries', 'faqs', 'locations', 'pricing-tiers', 'services', 'team', 'testimonials',
    ])

    // Content collections are routable; record collections are not.
    expect(store.tables.get('services')?.routeBase).toBe('/services')
    expect(store.tables.get('case-studies')?.routeBase).toBe('/case-studies')
    expect(store.tables.get('team')?.routeBase).toBe('')
    expect(store.tables.get('enquiries')?.routeBase).toBe('')

    // The case-study → service relation resolved to a real table id.
    const relation = store.tables.get('case-studies')?.fields.find((field) => field.id === 'service')
    expect((relation as { targetTableId?: string }).targetTableId).toBe(store.tables.get('services')?.id)
  })

  it('lets AI discover the model it just created, with no hidden structure', async () => {
    const store = new MemoryCollectionStore()
    const provisioning = new CollectionProvisioningService(store)
    await provisioning.provision(blueprintByKey('services')!.definition)
    await provisioning.provision(blueprintByKey('team')!.definition)

    const described = await provisioning.describe({ limit: 50 })
    const services = described.collections.find((entry) => entry.slug === 'services')
    expect(services?.shape).toBe('content')
    expect(services?.editable).toBe(true)
    // Every field AI needs to bind a section is present and typed.
    expect(services?.fields.map((field) => `${field.id}:${field.type}`)).toEqual([
      'title:text', 'summary:longText', 'body:richText',
      'fromPrice:number', 'icon:media', 'featured:boolean',
    ])
  })

  it('captures a lead through the existing form authority into the provisioned collection', async () => {
    const store = new MemoryCollectionStore()
    const provisioning = new CollectionProvisioningService(store)
    await provisioning.provision(blueprintByKey('services')!.definition)
    await provisioning.provision(leadCollection)
    const table = store.tables.get('enquiries')!

    const valid = validateFormSubmission({
      table,
      controls: controls(['name', 'email', 'phone', 'message', 'consent', 'source'], ['name', 'email', 'message']),
      values: {
        name: 'Wanjiku Mwangi',
        email: 'wanjiku@example.test',
        phone: '+254700000000',
        message: 'We need a brand refresh for our Nairobi office.',
        consent: true,
        source: 'campaign-q1',
      },
    })
    expect(valid.ok).toBe(true)
    if (valid.ok) {
      expect(valid.cells.name).toBe('Wanjiku Mwangi')
      expect(valid.cells.consent).toBe(true)
    }
  })

  it('rejects an invalid or oversized lead rather than storing it', async () => {
    const store = new MemoryCollectionStore()
    const provisioning = new CollectionProvisioningService(store)
    await provisioning.provision(blueprintByKey('services')!.definition)
    await provisioning.provision(leadCollection)
    const table = store.tables.get('enquiries')!

    const missingRequired = validateFormSubmission({
      table,
      controls: controls(['name', 'email', 'message', 'consent'], ['name', 'email', 'message']),
      values: { name: 'No Email', email: '', message: '', consent: true },
    })
    expect(missingRequired.ok).toBe(false)

    const badEmail = validateFormSubmission({
      table,
      controls: controls(['name', 'email', 'message', 'consent'], ['name', 'email', 'message']),
      values: { name: 'Bad', email: 'not-an-email', message: 'hello', consent: true },
    })
    expect(badEmail.ok).toBe(false)

    const unknownField = validateFormSubmission({
      table,
      controls: controls(['name', 'email', 'message', 'consent'], ['name']),
      values: { name: 'X', email: 'x@example.test', message: 'hi', consent: true, injected: 'nope' },
    })
    expect(unknownField.ok).toBe(false)

    const oversized = validateFormSubmission({
      table,
      controls: controls(['name', 'email', 'message', 'consent'], ['name']),
      values: {
        name: 'Long',
        email: 'long@example.test',
        message: 'x'.repeat(50_000),
        consent: true,
      },
      limits: { maxStringLength: 1_000 },
    })
    expect(oversized.ok).toBe(false)
  })

  it('serves the events case as content plus bookings capacity, with no ticketing engine', async () => {
    const store = new MemoryCollectionStore()
    const provisioning = new CollectionProvisioningService(store)
    for (const key of blueprintProvisionOrder(['locations', 'events', 'speakers'])) {
      await provisioning.provision(blueprintByKey(key)!.definition)
    }
    const events = store.tables.get('events')!
    // The event row carries schedule and presentation only.
    expect(events.fields.map((field) => field.id)).toEqual([
      'title', 'summary', 'details', 'startsAt', 'endsAt', 'timeZone',
      'venue', 'coverImage', 'registrationUrl', 'status',
    ])
    // Nothing in the content model tracks seats, so it cannot oversell.
    expect(events.fields.some((field) => /capacity|seats|tickets/i.test(field.id))).toBe(false)

    // Capacity for a session comes from the bookings authority instead.
    const bookingScope = { organizationId: 'org_a', workspaceId: 'wsp_a', siteId: 'site_a' }
    const repository = new MemoryBookingRepository([{
      scope: bookingScope,
      locations: [{
        locationId: 'loc_venue', name: 'Sarit Expo', timeZone: 'Africa/Nairobi',
        addressLine: '', town: 'Nairobi', country: 'KE', mapUrl: null, state: 'active',
      }],
      services: [{
        serviceId: 'svc_session', slug: 'keynote', name: 'Keynote seat',
        description: '', category: 'event', durationMinutes: 60, bufferAfterMinutes: 0,
        capacityPerSlot: 2, slotIntervalMinutes: 60, minimumNoticeMinutes: 0,
        maximumAdvanceDays: 30, cancellationWindowMinutes: 0,
        priceMinor: 0, currency: 'KES', requiresPrepayment: false, state: 'active',
      }],
      resources: [{
        resourceId: 'res_hall', name: 'Main hall', kind: 'room', locationId: 'loc_venue',
        serviceIds: ['svc_session'], concurrency: 2, state: 'active',
      }],
      workingHours: [{ resourceId: 'res_hall', weekday: 1, startMinute: 540, endMinute: 1_020 }],
    }])
    const lifecycle = new BookingLifecycleService({
      repository, identity: new SequentialBookingIdentity(), now: () => NOW,
    })

    // Two seats exist; a third registration must be refused.
    const first = await lifecycle.hold(bookingScope, {
      serviceId: 'svc_session', resourceId: 'res_hall', startAt: '2026-03-02T07:00:00.000Z', partySize: 1,
    })
    const second = await lifecycle.hold(bookingScope, {
      serviceId: 'svc_session', resourceId: 'res_hall', startAt: '2026-03-02T07:00:00.000Z', partySize: 1,
    })
    expect(first.holdId).not.toBe(second.holdId)
    await expect(lifecycle.hold(bookingScope, {
      serviceId: 'svc_session', resourceId: 'res_hall', startAt: '2026-03-02T07:00:00.000Z', partySize: 1,
    })).rejects.toThrow(/unavailable/)
  })

  it('serves the hospitality case the same way', async () => {
    const store = new MemoryCollectionStore()
    const provisioning = new CollectionProvisioningService(store)
    for (const key of blueprintProvisionOrder(['locations', 'rooms', 'tours', 'menu-items', 'testimonials', 'faqs'])) {
      await provisioning.provision(blueprintByKey(key)!.definition)
    }
    expect([...store.tables.keys()].sort()).toEqual([
      'faqs', 'locations', 'menu-items', 'rooms', 'testimonials', 'tours',
    ])
    const rooms = store.tables.get('rooms')!
    // Rate presentation only; availability is not modelled as content.
    expect(rooms.fields.some((field) => field.id === 'nightlyRate')).toBe(true)
    expect(rooms.fields.some((field) => /available|booked|occupanc/i.test(field.id))).toBe(false)
    expect((rooms.fields.find((field) => field.id === 'property') as { targetTableId?: string }).targetTableId)
      .toBe(store.tables.get('locations')?.id)
  })

  it('runs the whole journey through reviewed capabilities with owner confirmation', async () => {
    const store = new MemoryCollectionStore()
    const provisioning = new CollectionProvisioningService(store)
    const bookingScope = { organizationId: 'org_a', workspaceId: 'wsp_a', siteId: 'site_a' }
    const repository = new MemoryBookingRepository([{
      scope: bookingScope,
      locations: [{
        locationId: 'loc_office', name: 'Kilimani office', timeZone: 'Africa/Nairobi',
        addressLine: '', town: 'Nairobi', country: 'KE', mapUrl: null, state: 'active',
      }],
      services: [{
        serviceId: 'svc_consult', slug: 'consultation', name: 'Consultation',
        description: '', category: 'consulting', durationMinutes: 60, bufferAfterMinutes: 0,
        capacityPerSlot: 1, slotIntervalMinutes: 60, minimumNoticeMinutes: 0,
        maximumAdvanceDays: 30, cancellationWindowMinutes: 120,
        priceMinor: 500_000, currency: 'KES', requiresPrepayment: false, state: 'active',
      }],
      resources: [{
        resourceId: 'res_lead', name: 'Lead consultant', kind: 'staff', locationId: 'loc_office',
        serviceIds: ['svc_consult'], concurrency: 1, state: 'active',
      }],
      workingHours: [{ resourceId: 'res_lead', weekday: 1, startMinute: 540, endMinute: 1_020 }],
    }])
    const registry = registerBookingCapabilities(
      new ReviewedBackendCapabilityRegistry(() => NOW),
      new LifecycleBookingCapabilityAuthority(new BookingLifecycleService({
        repository, identity: new SequentialBookingIdentity(), now: () => NOW,
      })),
    )

    const evidence: BackendCapabilityEvidencePort = {
      async admit() {},
      async record() { return { metered: true as const, audited: true as const } },
    }
    const bookingAuthority = (): TrustedBackendCapabilityAuthority => ({
      channel: 'site-ai',
      operationId: 'op_1',
      outerReceiptId: 'rcp_1',
      reservationId: 'rsv_1',
      scope: {
        platformId: 'platform', organizationId: 'org_a', workspaceId: 'wsp_a',
        siteId: 'site_a', ownerKey: 'owner_a', ownerGeneration: 1, profileId: 'website',
      },
      actor: { kind: 'staff', actorId: 'usr_1', sessionId: 'ses_1', impersonatorId: null },
      permissions: ['bookings.availability.read', 'bookings.holds.write', 'bookings.write'],
      grants: ['ai.chat', 'ai.tools.write'],
      authorityRevision: 1,
      state: 'active',
      resolvedAt: NOW.toISOString(),
      confirmation: null,
    }) as TrustedBackendCapabilityAuthority

    // 1. AI models the business.
    await provisioning.provision(blueprintByKey('services')!.definition)
    await provisioning.provision(leadCollection)

    // 2. A visitor submits an enquiry through the existing form authority.
    const lead = validateFormSubmission({
      table: store.tables.get('enquiries')!,
      controls: controls(['name', 'email', 'message', 'consent'], ['name', 'email', 'message']),
      values: {
        name: 'Wanjiku Mwangi', email: 'wanjiku@example.test',
        message: 'Interested in a consultation.', consent: true,
      },
    })
    expect(lead.ok).toBe(true)

    // 3. The same visitor books a consultation through reviewed capabilities.
    const availability = await registry.invoke({
      id: BOOKING_CAPABILITY_IDS.availability,
      version: '1.0.0',
      rawInput: {
        serviceId: 'svc_consult', fromDate: '2026-03-02', toDate: '2026-03-02',
        partySize: 1, resourceId: null, maxSlots: 20,
      },
      resolveAuthority: async () => bookingAuthority(),
      evidence,
    })
    const slots = (availability.output as { slots: { startAt: string }[] }).slots
    expect(slots.length).toBeGreaterThan(0)

    const held = await registry.invoke({
      id: BOOKING_CAPABILITY_IDS.hold,
      version: '1.0.0',
      rawInput: {
        serviceId: 'svc_consult', resourceId: 'res_lead',
        startAt: slots[0]!.startAt, partySize: 1,
      },
      resolveAuthority: async () => bookingAuthority(),
      evidence,
    })
    const hold = held.output as { holdId: string; fence: number }

    const confirmed = await registry.invoke({
      id: BOOKING_CAPABILITY_IDS.book,
      version: '1.0.0',
      rawInput: {
        holdId: hold.holdId, fence: hold.fence,
        customer: { name: 'Wanjiku Mwangi', email: 'wanjiku@example.test', phone: null, notes: '' },
        intake: [], requestKey: 'req-journey001',
      },
      resolveAuthority: async () => bookingAuthority(),
      evidence,
    })
    const booking = (confirmed.output as { booking: { status: string; reference: string } }).booking
    expect(booking.status).toBe('confirmed')
    expect(booking.reference).toMatch(/^FUMA-\d{4}$/)

    // The whole journey used provisioning, forms and bookings only.
    expect(store.tables.size).toBe(2)
    expect(repository.bookings(bookingScope)).toHaveLength(1)
  })
})

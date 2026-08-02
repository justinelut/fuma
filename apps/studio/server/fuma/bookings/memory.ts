/**
 * FUMA-093 — deterministic in-memory repository.
 *
 * Used by tests and seeded demos. `transitionHold` is the fenced serialisation
 * point, mirroring the PostgreSQL conditional update exactly, so contention
 * behaviour proven here matches the native adapter.
 */
import type {
  Booking,
  BookingEvent,
  BookingException,
  BookingHold,
  BookingLocation,
  BookingReminder,
  BookingResource,
  BookingService,
} from './contracts'
import type {
  BookingRepository,
  BookingScope,
  BookingWorkingHourRow,
} from './service'

function scopeKey(scope: BookingScope): string {
  return `${scope.organizationId}/${scope.workspaceId}/${scope.siteId}`
}

export type MemoryBookingSeed = Readonly<{
  scope: BookingScope
  services?: readonly BookingService[]
  locations?: readonly BookingLocation[]
  resources?: readonly BookingResource[]
  workingHours?: readonly BookingWorkingHourRow[]
  exceptions?: readonly BookingException[]
  bookings?: readonly Booking[]
  holds?: readonly BookingHold[]
}>

type Tenant = {
  services: Map<string, BookingService>
  locations: Map<string, BookingLocation>
  resources: Map<string, BookingResource>
  workingHours: BookingWorkingHourRow[]
  exceptions: BookingException[]
  bookings: Map<string, Booking>
  holds: Map<string, BookingHold>
  events: BookingEvent[]
  reminders: Map<string, BookingReminder>
}

export class MemoryBookingRepository implements BookingRepository {
  readonly #tenants = new Map<string, Tenant>()

  constructor(seeds: readonly MemoryBookingSeed[] = []) {
    for (const seed of seeds) this.seed(seed)
  }

  seed(seed: MemoryBookingSeed): this {
    const tenant = this.#tenant(seed.scope)
    for (const service of seed.services ?? []) tenant.services.set(service.serviceId, service)
    for (const location of seed.locations ?? []) tenant.locations.set(location.locationId, location)
    for (const resource of seed.resources ?? []) tenant.resources.set(resource.resourceId, resource)
    tenant.workingHours.push(...(seed.workingHours ?? []))
    tenant.exceptions.push(...(seed.exceptions ?? []))
    for (const booking of seed.bookings ?? []) tenant.bookings.set(booking.bookingId, booking)
    for (const hold of seed.holds ?? []) tenant.holds.set(hold.holdId, hold)
    return this
  }

  events(scope: BookingScope): readonly BookingEvent[] {
    return Object.freeze([...this.#tenant(scope).events])
  }

  reminders(scope: BookingScope): readonly BookingReminder[] {
    return Object.freeze([...this.#tenant(scope).reminders.values()])
  }

  bookings(scope: BookingScope): readonly Booking[] {
    return Object.freeze([...this.#tenant(scope).bookings.values()])
  }

  holds(scope: BookingScope): readonly BookingHold[] {
    return Object.freeze([...this.#tenant(scope).holds.values()])
  }

  async listServices(scope: BookingScope): Promise<readonly BookingService[]> {
    return Object.freeze([...this.#tenant(scope).services.values()])
  }

  async getService(scope: BookingScope, serviceId: string): Promise<BookingService | null> {
    return this.#tenant(scope).services.get(serviceId) ?? null
  }

  async getLocation(scope: BookingScope, locationId: string): Promise<BookingLocation | null> {
    return this.#tenant(scope).locations.get(locationId) ?? null
  }

  async listResources(scope: BookingScope, serviceId: string): Promise<readonly BookingResource[]> {
    return Object.freeze([...this.#tenant(scope).resources.values()]
      .filter((resource) => resource.serviceIds.includes(serviceId))
      .sort((left, right) => left.resourceId.localeCompare(right.resourceId)))
  }

  async getResource(scope: BookingScope, resourceId: string): Promise<BookingResource | null> {
    return this.#tenant(scope).resources.get(resourceId) ?? null
  }

  async listWorkingHours(scope: BookingScope, resourceIds: readonly string[]): Promise<readonly BookingWorkingHourRow[]> {
    const wanted = new Set(resourceIds)
    return Object.freeze(this.#tenant(scope).workingHours.filter((row) => wanted.has(row.resourceId)))
  }

  async listExceptions(
    scope: BookingScope,
    resourceIds: readonly string[],
    fromDate: string,
    toDate: string,
  ): Promise<readonly BookingException[]> {
    const wanted = new Set(resourceIds)
    return Object.freeze(this.#tenant(scope).exceptions.filter((row) => wanted.has(row.resourceId)
      && row.date >= fromDate
      && row.date <= toDate))
  }

  async listBookingsInRange(
    scope: BookingScope,
    resourceIds: readonly string[],
    fromInstant: string,
    toInstant: string,
  ): Promise<readonly Booking[]> {
    const wanted = new Set(resourceIds)
    return Object.freeze([...this.#tenant(scope).bookings.values()].filter((booking) => wanted.has(booking.resourceId)
      && booking.endAt >= fromInstant
      && booking.startAt <= toInstant))
  }

  async listActiveHolds(scope: BookingScope, resourceIds: readonly string[]): Promise<readonly BookingHold[]> {
    const wanted = new Set(resourceIds)
    return Object.freeze([...this.#tenant(scope).holds.values()]
      .filter((hold) => wanted.has(hold.resourceId) && hold.state === 'held'))
  }

  async getBooking(scope: BookingScope, bookingId: string): Promise<Booking | null> {
    return this.#tenant(scope).bookings.get(bookingId) ?? null
  }

  async findBookingByRequestKey(scope: BookingScope, requestKey: string): Promise<Booking | null> {
    return [...this.#tenant(scope).bookings.values()].find((booking) => booking.requestKey === requestKey) ?? null
  }

  async getHold(scope: BookingScope, holdId: string): Promise<BookingHold | null> {
    return this.#tenant(scope).holds.get(holdId) ?? null
  }

  async insertHold(scope: BookingScope, hold: BookingHold): Promise<void> {
    this.#tenant(scope).holds.set(hold.holdId, hold)
  }

  /** Fenced compare-and-set: mirrors `update ... where fence = $n and state = 'held'`. */
  async transitionHold(
    scope: BookingScope,
    holdId: string,
    fence: number,
    next: BookingHold['state'],
  ): Promise<boolean> {
    const tenant = this.#tenant(scope)
    const current = tenant.holds.get(holdId)
    if (!current || current.fence !== fence || current.state !== 'held') return false
    tenant.holds.set(holdId, Object.freeze({ ...current, state: next, fence: current.fence + 1 }))
    return true
  }

  async insertBooking(scope: BookingScope, booking: Booking): Promise<void> {
    this.#tenant(scope).bookings.set(booking.bookingId, booking)
  }

  async updateBooking(scope: BookingScope, booking: Booking): Promise<void> {
    this.#tenant(scope).bookings.set(booking.bookingId, booking)
  }

  async appendEvent(scope: BookingScope, event: BookingEvent): Promise<void> {
    this.#tenant(scope).events.push(event)
  }

  async scheduleReminder(scope: BookingScope, reminder: BookingReminder): Promise<void> {
    this.#tenant(scope).reminders.set(reminder.reminderId, reminder)
  }

  async cancelReminders(scope: BookingScope, bookingId: string): Promise<void> {
    const tenant = this.#tenant(scope)
    for (const [id, reminder] of tenant.reminders) {
      if (reminder.bookingId === bookingId && reminder.state === 'pending') {
        tenant.reminders.set(id, Object.freeze({ ...reminder, state: 'cancelled' }))
      }
    }
  }

  #tenant(scope: BookingScope): Tenant {
    const key = scopeKey(scope)
    const found = this.#tenants.get(key)
    if (found) return found
    const created: Tenant = {
      services: new Map(),
      locations: new Map(),
      resources: new Map(),
      workingHours: [],
      exceptions: [],
      bookings: new Map(),
      holds: new Map(),
      events: [],
      reminders: new Map(),
    }
    this.#tenants.set(key, created)
    return created
  }
}

/** Deterministic identity port so tests and demos produce stable output. */
export class SequentialBookingIdentity {
  #holds = 0
  #bookings = 0
  #events = 0
  #reminders = 0
  #references = 0

  holdId(): string { this.#holds += 1; return `hld_${String(this.#holds).padStart(4, '0')}` }
  bookingId(): string { this.#bookings += 1; return `bkg_${String(this.#bookings).padStart(4, '0')}` }
  eventId(): string { this.#events += 1; return `evt_${String(this.#events).padStart(4, '0')}` }
  reminderId(): string { this.#reminders += 1; return `rem_${String(this.#reminders).padStart(4, '0')}` }
  reference(): string { this.#references += 1; return `FUMA-${String(this.#references).padStart(4, '0')}` }
}

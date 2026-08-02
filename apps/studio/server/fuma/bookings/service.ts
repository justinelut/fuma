/**
 * FUMA-093 — booking lifecycle service.
 *
 * Owns hold → book → reschedule → cancel/complete/no-show. Contention safety
 * comes from two independent guards:
 *
 *  1. A hold reserves capacity for a bounded time and carries a monotonic
 *     `fence`. Redeeming a hold requires the exact fence, so a retried or
 *     replayed request can never consume capacity twice.
 *  2. Every mutation re-validates the span against live bookings and holds
 *     immediately before writing, so two concurrent requests cannot both win.
 *
 * The repository port is intentionally narrow and provider-neutral: no SQL,
 * table names, predicates or credentials cross this boundary.
 */
import {
  BookingContractError,
  BookingSchema,
  parseBooking,
  type Booking,
  type BookingCustomer,
  type BookingEvent,
  type BookingException,
  type BookingHold,
  type BookingLocation,
  type BookingReminder,
  type BookingResource,
  type BookingService,
  type BookingSlot,
  type BookingStatus,
} from './contracts'
import { cancellationIsAllowed, computeAvailability, spanIsBookable, zonedDate } from './availability'

const MINUTE_MS = 60_000

export type BookingScope = Readonly<{
  organizationId: string
  workspaceId: string
  siteId: string
}>

export interface BookingRepository {
  listServices(scope: BookingScope): Promise<readonly BookingService[]>
  getService(scope: BookingScope, serviceId: string): Promise<BookingService | null>
  getLocation(scope: BookingScope, locationId: string): Promise<BookingLocation | null>
  listResources(scope: BookingScope, serviceId: string): Promise<readonly BookingResource[]>
  getResource(scope: BookingScope, resourceId: string): Promise<BookingResource | null>
  listWorkingHours(scope: BookingScope, resourceIds: readonly string[]): Promise<readonly BookingWorkingHourRow[]>
  listExceptions(scope: BookingScope, resourceIds: readonly string[], fromDate: string, toDate: string): Promise<readonly BookingException[]>
  listBookingsInRange(scope: BookingScope, resourceIds: readonly string[], fromInstant: string, toInstant: string): Promise<readonly Booking[]>
  listActiveHolds(scope: BookingScope, resourceIds: readonly string[]): Promise<readonly BookingHold[]>
  getBooking(scope: BookingScope, bookingId: string): Promise<Booking | null>
  findBookingByRequestKey(scope: BookingScope, requestKey: string): Promise<Booking | null>
  getHold(scope: BookingScope, holdId: string): Promise<BookingHold | null>
  insertHold(scope: BookingScope, hold: BookingHold): Promise<void>
  /** Must be atomic and fenced: only transitions when the stored fence matches. */
  transitionHold(scope: BookingScope, holdId: string, fence: number, next: BookingHold['state']): Promise<boolean>
  insertBooking(scope: BookingScope, booking: Booking): Promise<void>
  updateBooking(scope: BookingScope, booking: Booking): Promise<void>
  appendEvent(scope: BookingScope, event: BookingEvent): Promise<void>
  scheduleReminder(scope: BookingScope, reminder: BookingReminder): Promise<void>
  cancelReminders(scope: BookingScope, bookingId: string): Promise<void>
}

export type BookingWorkingHourRow = Readonly<{
  resourceId: string
  weekday: number
  startMinute: number
  endMinute: number
}>

export interface BookingIdentityPort {
  bookingId(): string
  holdId(): string
  eventId(): string
  reminderId(): string
  reference(): string
}

export class BookingServiceError extends Error {
  override readonly name = 'BookingServiceError'
  readonly code:
    | 'unknown-service'
    | 'unknown-resource'
    | 'unknown-location'
    | 'unknown-booking'
    | 'unknown-hold'
    | 'hold-expired'
    | 'hold-consumed'
    | 'fence-mismatch'
    | 'slot-unavailable'
    | 'cancellation-window'
    | 'invalid-transition'

  constructor(code: BookingServiceError['code'], message: string) {
    super(message)
    this.code = code
  }
}

export type AvailabilityQuery = Readonly<{
  serviceId: string
  fromDate: string
  toDate: string
  partySize: number
  resourceId?: string | null
  maxSlots?: number
}>

export type HoldRequest = Readonly<{
  serviceId: string
  resourceId: string
  startAt: string
  partySize: number
}>

export type BookRequest = Readonly<{
  holdId: string
  fence: number
  customer: BookingCustomer
  intake?: Booking['intake']
  requestKey: string
}>

const HOLD_TTL_MINUTES = 10
const REMINDER_LEAD_MINUTES = 24 * 60

export class BookingLifecycleService {
  readonly #repository: BookingRepository
  readonly #identity: BookingIdentityPort
  readonly #now: () => Date

  constructor(input: Readonly<{
    repository: BookingRepository
    identity: BookingIdentityPort
    now?: () => Date
  }>) {
    this.#repository = input.repository
    this.#identity = input.identity
    this.#now = input.now ?? (() => new Date())
  }

  async listServices(scope: BookingScope): Promise<readonly BookingService[]> {
    const services = await this.#repository.listServices(scope)
    return Object.freeze(services.filter((entry) => entry.state !== 'retired'))
  }

  async availability(scope: BookingScope, query: AvailabilityQuery): Promise<readonly BookingSlot[]> {
    const service = await this.#requireService(scope, query.serviceId)
    const resources = await this.#repository.listResources(scope, service.serviceId)
    if (resources.length === 0) return Object.freeze([])
    const location = await this.#repository.getLocation(scope, resources[0]!.locationId)
    if (!location) throw new BookingServiceError('unknown-location', 'Booking location is unavailable.')

    const resourceIds = resources.map((entry) => entry.resourceId)
    const now = this.#now()
    const fromInstant = new Date(Date.parse(`${query.fromDate}T00:00:00Z`) - MINUTE_MS * 1_440).toISOString()
    const toInstant = new Date(Date.parse(`${query.toDate}T00:00:00Z`) + MINUTE_MS * 2_880).toISOString()

    const [workingHours, exceptions, bookings, holds] = await Promise.all([
      this.#repository.listWorkingHours(scope, resourceIds),
      this.#repository.listExceptions(scope, resourceIds, query.fromDate, query.toDate),
      this.#repository.listBookingsInRange(scope, resourceIds, fromInstant, toInstant),
      this.#repository.listActiveHolds(scope, resourceIds),
    ])

    return computeAvailability({
      service,
      resources,
      workingHours,
      exceptions,
      bookings,
      holds,
      timeZone: location.timeZone,
      fromDate: query.fromDate,
      toDate: query.toDate,
      now,
      partySize: query.partySize,
      maxSlots: query.maxSlots ?? 200,
      resourceId: query.resourceId ?? null,
    })
  }

  /** Reserve capacity briefly so a customer can complete their details. */
  async hold(scope: BookingScope, request: HoldRequest): Promise<BookingHold> {
    const service = await this.#requireService(scope, request.serviceId)
    const resource = await this.#requireResource(scope, request.resourceId)
    const location = await this.#requireLocation(scope, resource.locationId)
    const startAt = new Date(request.startAt)
    if (Number.isNaN(startAt.getTime())) throw new BookingContractError('bookings.hold.startAt')

    await this.#assertSpanOpen({
      scope, service, resource, timeZone: location.timeZone, startAt, partySize: request.partySize,
    })

    const now = this.#now()
    const span = service.durationMinutes + service.bufferAfterMinutes
    const hold: BookingHold = Object.freeze({
      holdId: this.#identity.holdId(),
      serviceId: service.serviceId,
      resourceId: resource.resourceId,
      startAt: startAt.toISOString(),
      endAt: new Date(startAt.getTime() + span * MINUTE_MS).toISOString(),
      expiresAt: new Date(now.getTime() + HOLD_TTL_MINUTES * MINUTE_MS).toISOString(),
      fence: 1,
      state: 'held',
    })
    await this.#repository.insertHold(scope, hold)
    await this.#append(scope, { holdId: hold.holdId, bookingId: null, kind: 'held', detail: `hold ${HOLD_TTL_MINUTES}m` })
    return hold
  }

  async releaseHold(scope: BookingScope, holdId: string, fence: number): Promise<void> {
    const hold = await this.#repository.getHold(scope, holdId)
    if (!hold) throw new BookingServiceError('unknown-hold', 'Booking hold is unavailable.')
    if (hold.fence !== fence) throw new BookingServiceError('fence-mismatch', 'Booking hold fence is stale.')
    if (hold.state !== 'held') return
    const moved = await this.#repository.transitionHold(scope, holdId, fence, 'released')
    if (moved) await this.#append(scope, { holdId, bookingId: null, kind: 'hold-released', detail: 'released' })
  }

  /**
   * Redeem a live hold into a booking. Idempotent on `requestKey`: a duplicate
   * submit returns the original booking rather than double-booking.
   */
  async book(scope: BookingScope, request: BookRequest): Promise<Booking> {
    const existing = await this.#repository.findBookingByRequestKey(scope, request.requestKey)
    if (existing) return existing

    const hold = await this.#repository.getHold(scope, request.holdId)
    if (!hold) throw new BookingServiceError('unknown-hold', 'Booking hold is unavailable.')
    if (hold.fence !== request.fence) throw new BookingServiceError('fence-mismatch', 'Booking hold fence is stale.')
    if (hold.state === 'redeemed') throw new BookingServiceError('hold-consumed', 'Booking hold is already redeemed.')
    if (hold.state !== 'held') throw new BookingServiceError('hold-expired', 'Booking hold is no longer live.')

    const now = this.#now()
    if (Date.parse(hold.expiresAt) <= now.getTime()) {
      await this.#repository.transitionHold(scope, hold.holdId, hold.fence, 'expired')
      await this.#append(scope, { holdId: hold.holdId, bookingId: null, kind: 'hold-expired', detail: 'expired' })
      throw new BookingServiceError('hold-expired', 'Booking hold expired before confirmation.')
    }

    const service = await this.#requireService(scope, hold.serviceId)
    const resource = await this.#requireResource(scope, hold.resourceId)
    const location = await this.#requireLocation(scope, resource.locationId)

    // Re-check with this hold excluded: its own reservation must not block it.
    await this.#assertSpanOpen({
      scope,
      service,
      resource,
      timeZone: location.timeZone,
      startAt: new Date(hold.startAt),
      partySize: 1,
      ignoreHoldId: hold.holdId,
    })

    // Fenced transition is the single point of serialisation.
    const claimed = await this.#repository.transitionHold(scope, hold.holdId, hold.fence, 'redeemed')
    if (!claimed) throw new BookingServiceError('hold-consumed', 'Booking hold was consumed concurrently.')

    const booking = parseBooking('bookings.booking', BookingSchema, {
      bookingId: this.#identity.bookingId(),
      reference: this.#identity.reference(),
      serviceId: service.serviceId,
      resourceId: resource.resourceId,
      locationId: location.locationId,
      startAt: hold.startAt,
      endAt: new Date(Date.parse(hold.startAt) + service.durationMinutes * MINUTE_MS).toISOString(),
      timeZone: location.timeZone,
      status: 'confirmed' satisfies BookingStatus,
      customer: request.customer,
      intake: request.intake ?? [],
      partySize: 1,
      priceMinor: service.priceMinor,
      currency: service.currency,
      paymentReference: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      cancelledAt: null,
      requestKey: request.requestKey,
    }) as Booking

    await this.#repository.insertBooking(scope, booking)
    await this.#append(scope, { bookingId: booking.bookingId, holdId: hold.holdId, kind: 'booked', detail: booking.reference })
    await this.#scheduleReminder(scope, booking)
    return booking
  }

  async reschedule(scope: BookingScope, input: Readonly<{
    bookingId: string
    startAt: string
    resourceId?: string | null
  }>): Promise<Booking> {
    const booking = await this.#requireBooking(scope, input.bookingId)
    if (booking.status === 'cancelled' || booking.status === 'completed') {
      throw new BookingServiceError('invalid-transition', 'Only a live booking can be rescheduled.')
    }
    const service = await this.#requireService(scope, booking.serviceId)
    const resource = await this.#requireResource(scope, input.resourceId ?? booking.resourceId)
    const location = await this.#requireLocation(scope, resource.locationId)
    const startAt = new Date(input.startAt)
    if (Number.isNaN(startAt.getTime())) throw new BookingContractError('bookings.reschedule.startAt')

    await this.#assertSpanOpen({
      scope,
      service,
      resource,
      timeZone: location.timeZone,
      startAt,
      partySize: booking.partySize,
      ignoreBookingId: booking.bookingId,
    })

    const now = this.#now()
    const next: Booking = Object.freeze({
      ...booking,
      resourceId: resource.resourceId,
      locationId: location.locationId,
      timeZone: location.timeZone,
      startAt: startAt.toISOString(),
      endAt: new Date(startAt.getTime() + service.durationMinutes * MINUTE_MS).toISOString(),
      status: 'rescheduled' satisfies BookingStatus,
      updatedAt: now.toISOString(),
    })
    await this.#repository.updateBooking(scope, next)
    await this.#repository.cancelReminders(scope, booking.bookingId)
    await this.#scheduleReminder(scope, next)
    await this.#append(scope, {
      bookingId: booking.bookingId,
      holdId: null,
      kind: 'rescheduled',
      detail: `${booking.startAt} -> ${next.startAt}`,
    })
    return next
  }

  async cancel(scope: BookingScope, bookingId: string, reason: string): Promise<Booking> {
    const booking = await this.#requireBooking(scope, bookingId)
    if (booking.status === 'cancelled') return booking
    if (booking.status === 'completed') {
      throw new BookingServiceError('invalid-transition', 'A completed booking cannot be cancelled.')
    }
    const service = await this.#requireService(scope, booking.serviceId)
    const now = this.#now()
    if (!cancellationIsAllowed(service, booking, now)) {
      throw new BookingServiceError('cancellation-window', 'The cancellation window has closed.')
    }
    const next: Booking = Object.freeze({
      ...booking,
      status: 'cancelled' satisfies BookingStatus,
      cancelledAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
    await this.#repository.updateBooking(scope, next)
    await this.#repository.cancelReminders(scope, bookingId)
    await this.#append(scope, { bookingId, holdId: null, kind: 'cancelled', detail: reason.slice(0, 240) })
    return next
  }

  async settle(scope: BookingScope, bookingId: string, outcome: 'completed' | 'no-show'): Promise<Booking> {
    const booking = await this.#requireBooking(scope, bookingId)
    if (booking.status === 'cancelled') {
      throw new BookingServiceError('invalid-transition', 'A cancelled booking cannot be settled.')
    }
    const now = this.#now()
    const next: Booking = Object.freeze({
      ...booking,
      status: outcome satisfies BookingStatus,
      updatedAt: now.toISOString(),
    })
    await this.#repository.updateBooking(scope, next)
    await this.#repository.cancelReminders(scope, bookingId)
    await this.#append(scope, { bookingId, holdId: null, kind: outcome, detail: outcome })
    return next
  }

  /** Operator day view grouped by resource, in the location's zone. */
  async schedule(scope: BookingScope, input: Readonly<{
    serviceId: string
    date: string
  }>): Promise<readonly Booking[]> {
    const service = await this.#requireService(scope, input.serviceId)
    const resources = await this.#repository.listResources(scope, service.serviceId)
    if (resources.length === 0) return Object.freeze([])
    const location = await this.#requireLocation(scope, resources[0]!.locationId)
    const from = new Date(Date.parse(`${input.date}T00:00:00Z`) - 1_440 * MINUTE_MS).toISOString()
    const to = new Date(Date.parse(`${input.date}T00:00:00Z`) + 2_880 * MINUTE_MS).toISOString()
    const bookings = await this.#repository.listBookingsInRange(
      scope,
      resources.map((entry) => entry.resourceId),
      from,
      to,
    )
    const onDate = bookings
      .filter((booking) => zonedDate(location.timeZone, new Date(booking.startAt)) === input.date)
      .sort((left, right) => (
        left.startAt === right.startAt
          ? left.resourceId.localeCompare(right.resourceId)
          : left.startAt.localeCompare(right.startAt)
      ))
    return Object.freeze(onDate)
  }

  async #assertSpanOpen(input: Readonly<{
    scope: BookingScope
    service: BookingService
    resource: BookingResource
    timeZone: string
    startAt: Date
    partySize: number
    ignoreBookingId?: string | null
    ignoreHoldId?: string | null
  }>): Promise<void> {
    const { scope, resource } = input
    const date = zonedDate(input.timeZone, input.startAt)
    const [workingHours, exceptions, bookings, holds] = await Promise.all([
      this.#repository.listWorkingHours(scope, [resource.resourceId]),
      this.#repository.listExceptions(scope, [resource.resourceId], date, date),
      this.#repository.listBookingsInRange(
        scope,
        [resource.resourceId],
        new Date(input.startAt.getTime() - 1_440 * MINUTE_MS).toISOString(),
        new Date(input.startAt.getTime() + 1_440 * MINUTE_MS).toISOString(),
      ),
      this.#repository.listActiveHolds(scope, [resource.resourceId]),
    ])
    const open = spanIsBookable({
      service: input.service,
      resource,
      workingHours,
      exceptions,
      bookings,
      holds,
      timeZone: input.timeZone,
      startAt: input.startAt,
      partySize: input.partySize,
      now: this.#now(),
      ignoreBookingId: input.ignoreBookingId ?? null,
      ignoreHoldId: input.ignoreHoldId ?? null,
    })
    if (!open) throw new BookingServiceError('slot-unavailable', 'The requested slot is unavailable.')
  }

  async #scheduleReminder(scope: BookingScope, booking: Booking): Promise<void> {
    const sendAt = Date.parse(booking.startAt) - REMINDER_LEAD_MINUTES * MINUTE_MS
    if (sendAt <= this.#now().getTime()) return
    await this.#repository.scheduleReminder(scope, Object.freeze({
      reminderId: this.#identity.reminderId(),
      bookingId: booking.bookingId,
      sendAt: new Date(sendAt).toISOString(),
      channel: 'email',
      state: 'pending',
    }))
  }

  async #append(scope: BookingScope, input: Readonly<{
    bookingId: string | null
    holdId: string | null
    kind: BookingEvent['kind']
    detail: string
  }>): Promise<void> {
    await this.#repository.appendEvent(scope, Object.freeze({
      eventId: this.#identity.eventId(),
      bookingId: input.bookingId,
      holdId: input.holdId,
      kind: input.kind,
      occurredAt: this.#now().toISOString(),
      detail: input.detail,
    }))
  }

  async #requireService(scope: BookingScope, serviceId: string): Promise<BookingService> {
    const service = await this.#repository.getService(scope, serviceId)
    if (!service || service.state === 'retired') {
      throw new BookingServiceError('unknown-service', 'Booking service is unavailable.')
    }
    return service
  }

  async #requireResource(scope: BookingScope, resourceId: string): Promise<BookingResource> {
    const resource = await this.#repository.getResource(scope, resourceId)
    if (!resource || resource.state !== 'active') {
      throw new BookingServiceError('unknown-resource', 'Booking resource is unavailable.')
    }
    return resource
  }

  async #requireLocation(scope: BookingScope, locationId: string): Promise<BookingLocation> {
    const location = await this.#repository.getLocation(scope, locationId)
    if (!location || location.state !== 'active') {
      throw new BookingServiceError('unknown-location', 'Booking location is unavailable.')
    }
    return location
  }

  async #requireBooking(scope: BookingScope, bookingId: string): Promise<Booking> {
    const booking = await this.#repository.getBooking(scope, bookingId)
    if (!booking) throw new BookingServiceError('unknown-booking', 'Booking is unavailable.')
    return booking
  }
}

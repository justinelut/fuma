/**
 * PostgreSQL bookings repository for FUMA-093.
 *
 * Storage is migration `000081_bookings_authority`. The schema, not this
 * adapter, owns capacity safety, so the two rules that matter are enforced
 * twice — once in SQL and once here as a translated domain error:
 *
 *  - `fuma_booking_hold_live_v1` is a partial unique index over
 *    (resource, start_at) where state='held'. Two callers racing for the same
 *    slot cannot both hold it; the loser's insert raises 23505, which becomes
 *    `slot-unavailable` rather than leaking a driver error to the boundary.
 *  - `transitionHold` is a fenced compare-and-set. It is the single point of
 *    serialisation for confirmation, so it must stay one statement: reading
 *    then writing would reopen the race the fence exists to close.
 *
 * Behaviour is deliberately identical to `MemoryBookingRepository`, including
 * `listActiveHolds` returning every `held` row regardless of expiry — expiry is
 * filtered by the availability calculation (`availability.ts:192`), and moving
 * it here would silently change results for the existing suite.
 */
import { placeholder, type DbClient } from '../../db/client'
import {
  BookingExceptionSchema,
  BookingHoldSchema,
  BookingLocationSchema,
  BookingReminderSchema,
  BookingResourceSchema,
  BookingSchema,
  BookingServiceSchema,
  parseBooking,
  type Booking,
  type BookingEvent,
  type BookingException,
  type BookingHold,
  type BookingLocation,
  type BookingReminder,
  type BookingResource,
  type BookingService,
} from './contracts'
import {
  BookingServiceError,
  type BookingRepository,
  type BookingScope,
  type BookingWorkingHourRow,
} from './service'

/** PostgreSQL `unique_violation`. Bun surfaces SQLSTATE on `errno`. */
const UNIQUE_VIOLATION = '23505'

function sqlState(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const errno = (error as Readonly<{ errno?: unknown }>).errno
  return typeof errno === 'string' ? errno : null
}

function violated(error: unknown, fragment: string): boolean {
  if (sqlState(error) !== UNIQUE_VIOLATION) return false
  const message = error instanceof Error ? error.message : String(error)
  return message.includes(fragment)
}

/** Row shapes are the migration's columns; the wrapper already yields ISO instants. */
type ServiceRow = Readonly<{
  service_id: string; slug: string; name: string; description: string; category: string
  duration_minutes: number; buffer_after_minutes: number; capacity_per_slot: number
  slot_interval_minutes: number; minimum_notice_minutes: number; maximum_advance_days: number
  cancellation_window_minutes: number; price_minor: number; currency: string
  requires_prepayment: boolean; state: string
}>

type LocationRow = Readonly<{
  location_id: string; name: string; time_zone: string; address_line: string
  town: string; country: string; map_url: string | null; state: string
}>

type ResourceRow = Readonly<{
  resource_id: string; name: string; kind: string; location_id: string
  concurrency: number; state: string; service_ids: readonly string[] | null
}>

type WorkingHourRow = Readonly<{
  resource_id: string; weekday: number; start_minute: number; end_minute: number
}>

type ExceptionRow = Readonly<{
  resource_id: string; exception_date: string; kind: string
  start_minute: number | null; end_minute: number | null; note: string
}>

type HoldRow = Readonly<{
  hold_id: string; service_id: string; resource_id: string
  start_at: string; end_at: string; expires_at: string; fence: number; state: string
}>

type BookingRow = Readonly<{
  booking_id: string; reference: string; service_id: string; resource_id: string
  location_id: string; start_at: string; end_at: string; time_zone: string; status: string
  customer_name: string; customer_email: string; customer_phone: string | null
  customer_notes: string; intake_json: unknown; party_size: number; price_minor: number
  currency: string; payment_reference: string | null; request_key: string
  created_at: string; updated_at: string; cancelled_at: string | null
}>

function toService(row: ServiceRow): BookingService {
  return parseBooking('bookings.service', BookingServiceSchema, {
    serviceId: row.service_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    durationMinutes: row.duration_minutes,
    bufferAfterMinutes: row.buffer_after_minutes,
    capacityPerSlot: row.capacity_per_slot,
    slotIntervalMinutes: row.slot_interval_minutes,
    minimumNoticeMinutes: row.minimum_notice_minutes,
    maximumAdvanceDays: row.maximum_advance_days,
    cancellationWindowMinutes: row.cancellation_window_minutes,
    priceMinor: row.price_minor,
    currency: row.currency.trim(),
    requiresPrepayment: row.requires_prepayment,
    state: row.state,
  }) as BookingService
}

function toLocation(row: LocationRow): BookingLocation {
  return parseBooking('bookings.location', BookingLocationSchema, {
    locationId: row.location_id,
    name: row.name,
    timeZone: row.time_zone,
    addressLine: row.address_line,
    town: row.town,
    country: row.country.trim(),
    mapUrl: row.map_url,
    state: row.state,
  }) as BookingLocation
}

function toResource(row: ResourceRow): BookingResource {
  return parseBooking('bookings.resource', BookingResourceSchema, {
    resourceId: row.resource_id,
    name: row.name,
    kind: row.kind,
    locationId: row.location_id,
    serviceIds: [...(row.service_ids ?? [])],
    concurrency: row.concurrency,
    state: row.state,
  }) as BookingResource
}

function toException(row: ExceptionRow): BookingException {
  // `exception_date` is a DATE column; the driver may hand back a full instant.
  const date = row.exception_date.slice(0, 10)
  return parseBooking('bookings.exception', BookingExceptionSchema, {
    resourceId: row.resource_id,
    date,
    kind: row.kind,
    startMinute: row.start_minute,
    endMinute: row.end_minute,
    note: row.note,
  }) as BookingException
}

function toHold(row: HoldRow): BookingHold {
  return parseBooking('bookings.hold', BookingHoldSchema, {
    holdId: row.hold_id,
    serviceId: row.service_id,
    resourceId: row.resource_id,
    startAt: row.start_at,
    endAt: row.end_at,
    expiresAt: row.expires_at,
    fence: row.fence,
    state: row.state,
  }) as BookingHold
}

function toBookingRecord(row: BookingRow): Booking {
  return parseBooking('bookings.booking', BookingSchema, {
    bookingId: row.booking_id,
    reference: row.reference,
    serviceId: row.service_id,
    resourceId: row.resource_id,
    locationId: row.location_id,
    startAt: row.start_at,
    endAt: row.end_at,
    timeZone: row.time_zone,
    status: row.status,
    customer: {
      name: row.customer_name,
      email: row.customer_email,
      phone: row.customer_phone,
      notes: row.customer_notes,
    },
    intake: Array.isArray(row.intake_json) ? row.intake_json : [],
    partySize: row.party_size,
    priceMinor: row.price_minor,
    currency: row.currency.trim(),
    paymentReference: row.payment_reference,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cancelledAt: row.cancelled_at,
    requestKey: row.request_key,
  }) as Booking
}

const BOOKING_COLUMNS = `booking_id, reference, service_id, resource_id, location_id,
  start_at, end_at, time_zone, status, customer_name, customer_email, customer_phone,
  customer_notes, intake_json, party_size, price_minor, currency, payment_reference,
  request_key, created_at, updated_at, cancelled_at`

export class PostgresBookingRepository implements BookingRepository {
  readonly #db: DbClient

  constructor(db: DbClient) {
    this.#db = db
  }

  /**
   * Build `in (...)` from a bounded id list. Bun serialises a JS array to
   * `a,b`, which PostgreSQL rejects for `any()`, so the repository binds one
   * placeholder per id using the shared helper instead of interpolating.
   */
  #inList(values: readonly string[], offset: number): string {
    return values.map((_, index) => placeholder('postgres', offset + index + 1)).join(',')
  }

  async listServices(scope: BookingScope): Promise<readonly BookingService[]> {
    const result = await this.#db<ServiceRow>`
      select service_id, slug, name, description, category, duration_minutes,
        buffer_after_minutes, capacity_per_slot, slot_interval_minutes, minimum_notice_minutes,
        maximum_advance_days, cancellation_window_minutes, price_minor, currency,
        requires_prepayment, state
      from fuma_booking_services_v1
      where organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId}
        and site_id=${scope.siteId}
      order by slug`
    return Object.freeze(result.rows.map(toService))
  }

  async getService(scope: BookingScope, serviceId: string): Promise<BookingService | null> {
    const result = await this.#db<ServiceRow>`
      select service_id, slug, name, description, category, duration_minutes,
        buffer_after_minutes, capacity_per_slot, slot_interval_minutes, minimum_notice_minutes,
        maximum_advance_days, cancellation_window_minutes, price_minor, currency,
        requires_prepayment, state
      from fuma_booking_services_v1
      where organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId}
        and site_id=${scope.siteId} and service_id=${serviceId}`
    return result.rows[0] ? toService(result.rows[0]) : null
  }

  async getLocation(scope: BookingScope, locationId: string): Promise<BookingLocation | null> {
    const result = await this.#db<LocationRow>`
      select location_id, name, time_zone, address_line, town, country, map_url, state
      from fuma_booking_locations_v1
      where organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId}
        and site_id=${scope.siteId} and location_id=${locationId}`
    return result.rows[0] ? toLocation(result.rows[0]) : null
  }

  async listResources(scope: BookingScope, serviceId: string): Promise<readonly BookingResource[]> {
    // Filter to resources serving this service, but return each resource's
    // complete service set so the domain sees the same shape memory returns.
    const result = await this.#db<ResourceRow>`
      select r.resource_id, r.name, r.kind, r.location_id, r.concurrency, r.state,
        coalesce((
          select array_agg(l.service_id order by l.service_id)
          from fuma_booking_resource_services_v1 l
          where l.organization_id=r.organization_id and l.workspace_id=r.workspace_id
            and l.site_id=r.site_id and l.resource_id=r.resource_id
        ), '{}') as service_ids
      from fuma_booking_resources_v1 r
      where r.organization_id=${scope.organizationId} and r.workspace_id=${scope.workspaceId}
        and r.site_id=${scope.siteId}
        and exists (
          select 1 from fuma_booking_resource_services_v1 m
          where m.organization_id=r.organization_id and m.workspace_id=r.workspace_id
            and m.site_id=r.site_id and m.resource_id=r.resource_id and m.service_id=${serviceId}
        )
      order by r.resource_id`
    return Object.freeze(result.rows.map(toResource))
  }

  async getResource(scope: BookingScope, resourceId: string): Promise<BookingResource | null> {
    const result = await this.#db<ResourceRow>`
      select r.resource_id, r.name, r.kind, r.location_id, r.concurrency, r.state,
        coalesce((
          select array_agg(l.service_id order by l.service_id)
          from fuma_booking_resource_services_v1 l
          where l.organization_id=r.organization_id and l.workspace_id=r.workspace_id
            and l.site_id=r.site_id and l.resource_id=r.resource_id
        ), '{}') as service_ids
      from fuma_booking_resources_v1 r
      where r.organization_id=${scope.organizationId} and r.workspace_id=${scope.workspaceId}
        and r.site_id=${scope.siteId} and r.resource_id=${resourceId}`
    return result.rows[0] ? toResource(result.rows[0]) : null
  }

  async listWorkingHours(
    scope: BookingScope,
    resourceIds: readonly string[],
  ): Promise<readonly BookingWorkingHourRow[]> {
    if (resourceIds.length === 0) return Object.freeze([])
    const params: unknown[] = [scope.organizationId, scope.workspaceId, scope.siteId, ...resourceIds]
    const result = await this.#db.unsafe<WorkingHourRow>(
      `select resource_id, weekday, start_minute, end_minute
       from fuma_booking_working_hours_v1
       where organization_id=$1 and workspace_id=$2 and site_id=$3
         and resource_id in (${this.#inList(resourceIds, 3)})
       order by resource_id, weekday, start_minute`,
      params,
    )
    return Object.freeze(result.rows.map((row) => Object.freeze({
      resourceId: row.resource_id,
      weekday: row.weekday,
      startMinute: row.start_minute,
      endMinute: row.end_minute,
    })))
  }

  async listExceptions(
    scope: BookingScope,
    resourceIds: readonly string[],
    fromDate: string,
    toDate: string,
  ): Promise<readonly BookingException[]> {
    if (resourceIds.length === 0) return Object.freeze([])
    const params: unknown[] = [
      scope.organizationId, scope.workspaceId, scope.siteId, fromDate, toDate, ...resourceIds,
    ]
    const result = await this.#db.unsafe<ExceptionRow>(
      `select resource_id, to_char(exception_date, 'YYYY-MM-DD') as exception_date, kind,
         start_minute, end_minute, note
       from fuma_booking_exceptions_v1
       where organization_id=$1 and workspace_id=$2 and site_id=$3
         and exception_date >= $4::date and exception_date <= $5::date
         and resource_id in (${this.#inList(resourceIds, 5)})
       order by exception_date, resource_id`,
      params,
    )
    return Object.freeze(result.rows.map(toException))
  }

  async listBookingsInRange(
    scope: BookingScope,
    resourceIds: readonly string[],
    fromInstant: string,
    toInstant: string,
  ): Promise<readonly Booking[]> {
    if (resourceIds.length === 0) return Object.freeze([])
    const params: unknown[] = [
      scope.organizationId, scope.workspaceId, scope.siteId, fromInstant, toInstant, ...resourceIds,
    ]
    // Overlap test matches memory: end >= from and start <= to.
    const result = await this.#db.unsafe<BookingRow>(
      `select ${BOOKING_COLUMNS}
       from fuma_bookings_v1
       where organization_id=$1 and workspace_id=$2 and site_id=$3
         and end_at >= $4::timestamptz and start_at <= $5::timestamptz
         and resource_id in (${this.#inList(resourceIds, 5)})
       order by start_at, booking_id`,
      params,
    )
    return Object.freeze(result.rows.map(toBookingRecord))
  }

  async listActiveHolds(
    scope: BookingScope,
    resourceIds: readonly string[],
  ): Promise<readonly BookingHold[]> {
    if (resourceIds.length === 0) return Object.freeze([])
    const params: unknown[] = [scope.organizationId, scope.workspaceId, scope.siteId, ...resourceIds]
    const result = await this.#db.unsafe<HoldRow>(
      `select hold_id, service_id, resource_id, start_at, end_at, expires_at, fence, state
       from fuma_booking_holds_v1
       where organization_id=$1 and workspace_id=$2 and site_id=$3 and state='held'
         and resource_id in (${this.#inList(resourceIds, 3)})
       order by start_at, hold_id`,
      params,
    )
    return Object.freeze(result.rows.map(toHold))
  }

  async getBooking(scope: BookingScope, bookingId: string): Promise<Booking | null> {
    const result = await this.#db<BookingRow>`
      select booking_id, reference, service_id, resource_id, location_id,
        start_at, end_at, time_zone, status, customer_name, customer_email, customer_phone,
        customer_notes, intake_json, party_size, price_minor, currency, payment_reference,
        request_key, created_at, updated_at, cancelled_at
      from fuma_bookings_v1
      where organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId}
        and site_id=${scope.siteId} and booking_id=${bookingId}`
    return result.rows[0] ? toBookingRecord(result.rows[0]) : null
  }

  async findBookingByRequestKey(scope: BookingScope, requestKey: string): Promise<Booking | null> {
    const result = await this.#db<BookingRow>`
      select booking_id, reference, service_id, resource_id, location_id,
        start_at, end_at, time_zone, status, customer_name, customer_email, customer_phone,
        customer_notes, intake_json, party_size, price_minor, currency, payment_reference,
        request_key, created_at, updated_at, cancelled_at
      from fuma_bookings_v1
      where organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId}
        and site_id=${scope.siteId} and request_key=${requestKey}`
    return result.rows[0] ? toBookingRecord(result.rows[0]) : null
  }

  async getHold(scope: BookingScope, holdId: string): Promise<BookingHold | null> {
    const result = await this.#db<HoldRow>`
      select hold_id, service_id, resource_id, start_at, end_at, expires_at, fence, state
      from fuma_booking_holds_v1
      where organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId}
        and site_id=${scope.siteId} and hold_id=${holdId}`
    return result.rows[0] ? toHold(result.rows[0]) : null
  }

  async insertHold(scope: BookingScope, hold: BookingHold): Promise<void> {
    try {
      await this.#db.transaction(async (tx) => {
        // Self-heal before inserting. The live-hold index is partial on
        // state='held', so a hold whose TTL has passed but which was never
        // transitioned would keep the slot locked forever: availability filters
        // expired holds and reports the slot free, yet every insert would fail.
        // Expiring it here means correctness does not depend on a sweeper being
        // deployed. Genuinely live contention is still arbitrated by the index.
        //
        // The database clock is deliberate: it is immune to app-server skew,
        // which matters for the one primitive whose whole job is contention.
        await tx`
          update fuma_booking_holds_v1
          set state='expired', fence=fence+1
          where organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId}
            and site_id=${scope.siteId} and resource_id=${hold.resourceId}
            and start_at=${hold.startAt}::timestamptz
            and state='held' and expires_at <= now()`
        await tx`
          insert into fuma_booking_holds_v1 (
            organization_id, workspace_id, site_id, hold_id, service_id, resource_id,
            start_at, end_at, expires_at, fence, state, created_at
          ) values (
            ${scope.organizationId}, ${scope.workspaceId}, ${scope.siteId}, ${hold.holdId},
            ${hold.serviceId}, ${hold.resourceId}, ${hold.startAt}::timestamptz,
            ${hold.endAt}::timestamptz, ${hold.expiresAt}::timestamptz, ${hold.fence},
            ${hold.state}, now()
          )`
      })
    } catch (error) {
      // The partial unique index fired: another caller already holds this exact
      // slot. That is contention, not corruption, so surface the domain error
      // the boundary already knows how to answer with.
      if (violated(error, 'fuma_booking_hold_live_v1')) {
        throw new BookingServiceError('slot-unavailable', 'Booking slot was taken concurrently.')
      }
      throw error
    }
  }

  /**
   * Sweep holds whose TTL has passed so the event trail and operator views stay
   * truthful, independent of the self-heal on the insert path. Returns the ids
   * that moved so the caller can append the matching `hold-expired` events.
   */
  async expireElapsedHolds(
    scope: BookingScope,
    limit = 500,
  ): Promise<readonly Readonly<{ holdId: string }>[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5_000) {
      throw new RangeError('Booking hold sweep limit is out of range.')
    }
    const result = await this.#db<Readonly<{ hold_id: string }>>`
      update fuma_booking_holds_v1
      set state='expired', fence=fence+1
      where (organization_id, workspace_id, site_id, hold_id) in (
        select organization_id, workspace_id, site_id, hold_id
        from fuma_booking_holds_v1
        where organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId}
          and site_id=${scope.siteId} and state='held' and expires_at <= now()
        order by expires_at
        limit ${limit}
        for update skip locked
      )
      returning hold_id`
    return Object.freeze(result.rows.map((row) => Object.freeze({ holdId: row.hold_id })))
  }

  /**
   * Fenced compare-and-set in one statement. `rowCount` is the affected-row
   * count, so a stale fence or an already-moved hold yields 0 and the caller
   * learns it lost the race.
   */
  async transitionHold(
    scope: BookingScope,
    holdId: string,
    fence: number,
    next: BookingHold['state'],
  ): Promise<boolean> {
    const result = await this.#db`
      update fuma_booking_holds_v1
      set state=${next}, fence=fence+1
      where organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId}
        and site_id=${scope.siteId} and hold_id=${holdId}
        and fence=${fence} and state='held'`
    return result.rowCount === 1
  }

  async insertBooking(scope: BookingScope, booking: Booking): Promise<void> {
    try {
      await this.#db`
        insert into fuma_bookings_v1 (
          organization_id, workspace_id, site_id, booking_id, reference, service_id,
          resource_id, location_id, start_at, end_at, time_zone, status, customer_name,
          customer_email, customer_phone, customer_notes, intake_json, party_size,
          price_minor, currency, payment_reference, request_key, created_at, updated_at,
          cancelled_at
        ) values (
          ${scope.organizationId}, ${scope.workspaceId}, ${scope.siteId}, ${booking.bookingId},
          ${booking.reference}, ${booking.serviceId}, ${booking.resourceId}, ${booking.locationId},
          ${booking.startAt}::timestamptz, ${booking.endAt}::timestamptz, ${booking.timeZone},
          ${booking.status}, ${booking.customer.name}, ${booking.customer.email},
          ${booking.customer.phone}, ${booking.customer.notes},
          ${[...booking.intake]}, ${booking.partySize}, ${booking.priceMinor},
          ${booking.currency}, ${booking.paymentReference}, ${booking.requestKey},
          ${booking.createdAt}::timestamptz, ${booking.updatedAt}::timestamptz,
          ${booking.cancelledAt}::timestamptz
        )`
    } catch (error) {
      if (violated(error, 'request_key')) {
        throw new BookingServiceError(
          'invalid-transition',
          'A different booking already used this request key.',
        )
      }
      throw error
    }
  }

  async updateBooking(scope: BookingScope, booking: Booking): Promise<void> {
    await this.#db`
      update fuma_bookings_v1
      set reference=${booking.reference}, service_id=${booking.serviceId},
        resource_id=${booking.resourceId}, location_id=${booking.locationId},
        start_at=${booking.startAt}::timestamptz, end_at=${booking.endAt}::timestamptz,
        time_zone=${booking.timeZone}, status=${booking.status},
        customer_name=${booking.customer.name}, customer_email=${booking.customer.email},
        customer_phone=${booking.customer.phone}, customer_notes=${booking.customer.notes},
        intake_json=${[...booking.intake]}, party_size=${booking.partySize},
        price_minor=${booking.priceMinor}, currency=${booking.currency},
        payment_reference=${booking.paymentReference}, updated_at=${booking.updatedAt}::timestamptz,
        cancelled_at=${booking.cancelledAt}::timestamptz
      where organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId}
        and site_id=${scope.siteId} and booking_id=${booking.bookingId}`
  }

  /** Append-only: the table's trigger rejects any update or delete. */
  async appendEvent(scope: BookingScope, event: BookingEvent): Promise<void> {
    await this.#db`
      insert into fuma_booking_events_v1 (
        organization_id, workspace_id, site_id, event_id, booking_id, hold_id, kind,
        occurred_at, detail
      ) values (
        ${scope.organizationId}, ${scope.workspaceId}, ${scope.siteId}, ${event.eventId},
        ${event.bookingId}, ${event.holdId}, ${event.kind},
        ${event.occurredAt}::timestamptz, ${event.detail}
      )`
  }

  async scheduleReminder(scope: BookingScope, reminder: BookingReminder): Promise<void> {
    await this.#db`
      insert into fuma_booking_reminders_v1 (
        organization_id, workspace_id, site_id, reminder_id, booking_id, send_at, channel, state
      ) values (
        ${scope.organizationId}, ${scope.workspaceId}, ${scope.siteId}, ${reminder.reminderId},
        ${reminder.bookingId}, ${reminder.sendAt}::timestamptz, ${reminder.channel},
        ${reminder.state}
      )`
  }

  async cancelReminders(scope: BookingScope, bookingId: string): Promise<void> {
    await this.#db`
      update fuma_booking_reminders_v1
      set state='cancelled'
      where organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId}
        and site_id=${scope.siteId} and booking_id=${bookingId} and state='pending'`
  }

  /** Reader used by acceptance coverage and the operator surface. */
  async listReminders(
    scope: BookingScope,
    bookingId: string,
  ): Promise<readonly BookingReminder[]> {
    const result = await this.#db<Readonly<{
      reminder_id: string; booking_id: string; send_at: string; channel: string; state: string
    }>>`
      select reminder_id, booking_id, send_at, channel, state
      from fuma_booking_reminders_v1
      where organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId}
        and site_id=${scope.siteId} and booking_id=${bookingId}
      order by send_at, reminder_id`
    return Object.freeze(result.rows.map((row) => parseBooking(
      'bookings.reminder',
      BookingReminderSchema,
      {
        reminderId: row.reminder_id,
        bookingId: row.booking_id,
        sendAt: row.send_at,
        channel: row.channel,
        state: row.state,
      },
    ) as BookingReminder))
  }

  async listLocations(scope: BookingScope): Promise<readonly BookingLocation[]> {
    const result = await this.#db<LocationRow>`
      select location_id, name, time_zone, address_line, town, country, map_url, state
      from fuma_booking_locations_v1
      where organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId}
        and site_id=${scope.siteId}
      order by name, location_id`
    return Object.freeze(result.rows.map(toLocation))
  }

  async listAllResources(scope: BookingScope): Promise<readonly BookingResource[]> {
    const result = await this.#db<ResourceRow>`
      select r.resource_id, r.name, r.kind, r.location_id, r.concurrency, r.state,
        coalesce((
          select array_agg(l.service_id order by l.service_id)
          from fuma_booking_resource_services_v1 l
          where l.organization_id=r.organization_id and l.workspace_id=r.workspace_id
            and l.site_id=r.site_id and l.resource_id=r.resource_id
        ), '{}') as service_ids
      from fuma_booking_resources_v1 r
      where r.organization_id=${scope.organizationId} and r.workspace_id=${scope.workspaceId}
        and r.site_id=${scope.siteId}
      order by r.name, r.resource_id`
    return Object.freeze(result.rows.map(toResource))
  }

  async listAdminExceptions(
    scope: BookingScope,
    resourceIds: readonly string[],
    fromDate: string,
    toDate: string,
  ): Promise<readonly BookingAdminException[]> {
    if (resourceIds.length === 0) return Object.freeze([])
    const params: unknown[] = [
      scope.organizationId, scope.workspaceId, scope.siteId, fromDate, toDate, ...resourceIds,
    ]
    const result = await this.#db.unsafe<ExceptionRow & Readonly<{ exception_id: string }>>(
      `select exception_id, resource_id, to_char(exception_date, 'YYYY-MM-DD') as exception_date,
         kind, start_minute, end_minute, note
       from fuma_booking_exceptions_v1
       where organization_id=$1 and workspace_id=$2 and site_id=$3
         and exception_date >= $4::date and exception_date <= $5::date
         and resource_id in (${this.#inList(resourceIds, 5)})
       order by exception_date, resource_id, exception_id`,
      params,
    )
    return Object.freeze(result.rows.map((row) => Object.freeze({
      exceptionId: row.exception_id,
      ...toException(row),
    })))
  }

  async saveLocation(scope: BookingScope, location: BookingLocation): Promise<BookingLocation> {
    await this.#db.transaction(async (tx) => {
      await tx`
        insert into fuma_booking_locations_v1 (
          organization_id, workspace_id, site_id, location_id, name, time_zone,
          address_line, town, country, map_url, state, created_at, updated_at
        ) values (
          ${scope.organizationId}, ${scope.workspaceId}, ${scope.siteId}, ${location.locationId},
          ${location.name}, ${location.timeZone}, ${location.addressLine}, ${location.town},
          ${location.country}, ${location.mapUrl}, ${location.state}, now(), now()
        )
        on conflict (organization_id, workspace_id, site_id, location_id) do update set
          name=excluded.name, time_zone=excluded.time_zone,
          address_line=excluded.address_line, town=excluded.town,
          country=excluded.country, map_url=excluded.map_url,
          state=excluded.state, updated_at=now()`
    })
    return (await this.getLocation(scope, location.locationId))!
  }

  async saveService(scope: BookingScope, service: BookingService): Promise<BookingService> {
    await this.#db.transaction(async (tx) => {
      await tx`
        insert into fuma_booking_services_v1 (
          organization_id, workspace_id, site_id, service_id, slug, name, description,
          category, duration_minutes, buffer_after_minutes, capacity_per_slot,
          slot_interval_minutes, minimum_notice_minutes, maximum_advance_days,
          cancellation_window_minutes, price_minor, currency, requires_prepayment,
          state, created_at, updated_at
        ) values (
          ${scope.organizationId}, ${scope.workspaceId}, ${scope.siteId}, ${service.serviceId},
          ${service.slug}, ${service.name}, ${service.description}, ${service.category},
          ${service.durationMinutes}, ${service.bufferAfterMinutes}, ${service.capacityPerSlot},
          ${service.slotIntervalMinutes}, ${service.minimumNoticeMinutes},
          ${service.maximumAdvanceDays}, ${service.cancellationWindowMinutes},
          ${service.priceMinor}, ${service.currency}, ${service.requiresPrepayment},
          ${service.state}, now(), now()
        )
        on conflict (organization_id, workspace_id, site_id, service_id) do update set
          slug=excluded.slug, name=excluded.name, description=excluded.description,
          category=excluded.category, duration_minutes=excluded.duration_minutes,
          buffer_after_minutes=excluded.buffer_after_minutes,
          capacity_per_slot=excluded.capacity_per_slot,
          slot_interval_minutes=excluded.slot_interval_minutes,
          minimum_notice_minutes=excluded.minimum_notice_minutes,
          maximum_advance_days=excluded.maximum_advance_days,
          cancellation_window_minutes=excluded.cancellation_window_minutes,
          price_minor=excluded.price_minor, currency=excluded.currency,
          requires_prepayment=excluded.requires_prepayment, state=excluded.state,
          updated_at=now()`
    })
    return (await this.getService(scope, service.serviceId))!
  }

  async saveResource(scope: BookingScope, resource: BookingResource): Promise<BookingResource> {
    await this.#db.transaction(async (tx) => {
      await tx`
        insert into fuma_booking_resources_v1 (
          organization_id, workspace_id, site_id, resource_id, name, kind, location_id,
          concurrency, state, created_at, updated_at
        ) values (
          ${scope.organizationId}, ${scope.workspaceId}, ${scope.siteId}, ${resource.resourceId},
          ${resource.name}, ${resource.kind}, ${resource.locationId}, ${resource.concurrency},
          ${resource.state}, now(), now()
        )
        on conflict (organization_id, workspace_id, site_id, resource_id) do update set
          name=excluded.name, kind=excluded.kind, location_id=excluded.location_id,
          concurrency=excluded.concurrency, state=excluded.state, updated_at=now()`
      await tx`
        delete from fuma_booking_resource_services_v1
        where organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId}
          and site_id=${scope.siteId} and resource_id=${resource.resourceId}`
      for (const serviceId of resource.serviceIds) {
        await tx`
          insert into fuma_booking_resource_services_v1 (
            organization_id, workspace_id, site_id, resource_id, service_id
          ) values (
            ${scope.organizationId}, ${scope.workspaceId}, ${scope.siteId},
            ${resource.resourceId}, ${serviceId}
          )`
      }
    })
    return (await this.getResource(scope, resource.resourceId))!
  }

  async replaceWorkingHours(
    scope: BookingScope,
    resourceId: string,
    hours: readonly Omit<BookingWorkingHourRow, 'resourceId'>[],
  ): Promise<readonly BookingWorkingHourRow[]> {
    await this.#db.transaction(async (tx) => {
      const resource = await tx`
        select 1 from fuma_booking_resources_v1
        where organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId}
          and site_id=${scope.siteId} and resource_id=${resourceId}
        for update`
      if (resource.rowCount !== 1) {
        throw new BookingServiceError('unknown-resource', 'Booking resource is unavailable.')
      }
      await tx`
        delete from fuma_booking_working_hours_v1
        where organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId}
          and site_id=${scope.siteId} and resource_id=${resourceId}`
      for (const hour of hours) {
        await tx`
          insert into fuma_booking_working_hours_v1 (
            organization_id, workspace_id, site_id, resource_id, weekday,
            start_minute, end_minute
          ) values (
            ${scope.organizationId}, ${scope.workspaceId}, ${scope.siteId}, ${resourceId},
            ${hour.weekday}, ${hour.startMinute}, ${hour.endMinute}
          )`
      }
    })
    return await this.listWorkingHours(scope, [resourceId])
  }

  async saveException(
    scope: BookingScope,
    exception: BookingAdminException,
  ): Promise<BookingAdminException> {
    await this.#db.transaction(async (tx) => {
      await tx`
        insert into fuma_booking_exceptions_v1 (
          organization_id, workspace_id, site_id, resource_id, exception_id,
          exception_date, kind, start_minute, end_minute, note
        ) values (
          ${scope.organizationId}, ${scope.workspaceId}, ${scope.siteId},
          ${exception.resourceId}, ${exception.exceptionId}, ${exception.date}::date,
          ${exception.kind}, ${exception.startMinute}, ${exception.endMinute}, ${exception.note}
        )
        on conflict (organization_id, workspace_id, site_id, exception_id) do update set
          resource_id=excluded.resource_id, exception_date=excluded.exception_date,
          kind=excluded.kind, start_minute=excluded.start_minute,
          end_minute=excluded.end_minute, note=excluded.note`
    })
    return Object.freeze(structuredClone(exception))
  }

  async deleteException(scope: BookingScope, exceptionId: string): Promise<boolean> {
    return await this.#db.transaction(async (tx) => {
      const result = await tx`
        delete from fuma_booking_exceptions_v1
        where organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId}
          and site_id=${scope.siteId} and exception_id=${exceptionId}`
      return result.rowCount === 1
    })
  }
}

export type BookingAdminException = Readonly<BookingException & { exceptionId: string }>

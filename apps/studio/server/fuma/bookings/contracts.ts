/**
 * FUMA-093 — Bookings and Appointments contracts.
 *
 * Provider-neutral scheduling authority shared by Events (FUMA-091) and
 * Hospitality (FUMA-092). Every boundary is strict TypeBox with
 * `additionalProperties: false` so the reviewed capability registry accepts it.
 *
 * Scope guards encoded here:
 *  - Time is always an explicit IANA zone plus UTC instants. No implicit local time.
 *  - Holds are short-lived and fenced; a booking may only be created from a live hold.
 *  - Clinical/diagnostic scheduling is out of scope and rejected by `serviceCategory`.
 *  - No capability accepts SQL, table names, predicates, credentials, or caller scope.
 */
import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'

const Strict = { additionalProperties: false } as const

export const BookingIdSchema = Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
export const BookingSlugSchema = Type.String({ minLength: 1, maxLength: 96, pattern: '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$' })
export const BookingInstantSchema = Type.String({ format: 'date-time' })
/** Explicit IANA zone. Fuma never infers a tenant's zone from the server. */
export const BookingTimeZoneSchema = Type.String({ minLength: 3, maxLength: 64, pattern: '^[A-Za-z][A-Za-z0-9_+-]*(?:/[A-Za-z0-9_+-]+){1,2}$' })
export const BookingMinuteOfDaySchema = Type.Integer({ minimum: 0, maximum: 1_440 })
export const BookingWeekdaySchema = Type.Integer({ minimum: 0, maximum: 6 })
export const BookingDateSchema = Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' })
export const BookingMinorAmountSchema = Type.Integer({ minimum: 0, maximum: 99_999_999 })
export const BookingCurrencySchema = Type.Literal('KES')

/**
 * Non-clinical categories only. Medical records, diagnosis and treatment
 * scheduling are explicitly out of scope for FUMA-093.
 */
export const BookingServiceCategorySchema = Type.Union([
  Type.Literal('salon'),
  Type.Literal('consulting'),
  Type.Literal('training'),
  Type.Literal('photography'),
  Type.Literal('venue'),
  Type.Literal('tour'),
  Type.Literal('hospitality'),
  Type.Literal('event'),
  Type.Literal('other'),
])
export type BookingServiceCategory = Static<typeof BookingServiceCategorySchema>

export const BookingServiceSchema = Type.Object({
  serviceId: BookingIdSchema,
  slug: BookingSlugSchema,
  name: Type.String({ minLength: 1, maxLength: 160 }),
  description: Type.String({ maxLength: 2_000 }),
  category: BookingServiceCategorySchema,
  durationMinutes: Type.Integer({ minimum: 5, maximum: 1_440 }),
  /** Buffer applied after each booking so back-to-back slots stay realistic. */
  bufferAfterMinutes: Type.Integer({ minimum: 0, maximum: 480 }),
  /** Concurrent capacity per slot. 1 for one-to-one appointments. */
  capacityPerSlot: Type.Integer({ minimum: 1, maximum: 1_000 }),
  /** Slot start granularity in minutes. */
  slotIntervalMinutes: Type.Integer({ minimum: 5, maximum: 240 }),
  minimumNoticeMinutes: Type.Integer({ minimum: 0, maximum: 43_200 }),
  maximumAdvanceDays: Type.Integer({ minimum: 1, maximum: 730 }),
  cancellationWindowMinutes: Type.Integer({ minimum: 0, maximum: 43_200 }),
  priceMinor: BookingMinorAmountSchema,
  currency: BookingCurrencySchema,
  /** Presentation only. Taking payment stays with existing reviewed payment authority. */
  requiresPrepayment: Type.Boolean(),
  state: Type.Union([Type.Literal('active'), Type.Literal('paused'), Type.Literal('retired')]),
}, Strict)
export type BookingService = Readonly<Static<typeof BookingServiceSchema>>

export const BookingLocationSchema = Type.Object({
  locationId: BookingIdSchema,
  name: Type.String({ minLength: 1, maxLength: 160 }),
  timeZone: BookingTimeZoneSchema,
  addressLine: Type.String({ maxLength: 240 }),
  town: Type.String({ maxLength: 120 }),
  country: Type.String({ minLength: 2, maxLength: 2, pattern: '^[A-Z]{2}$' }),
  /** Optional map link presentation; never a credentialed endpoint. */
  mapUrl: Type.Union([Type.String({ maxLength: 512, pattern: '^https://' }), Type.Null()]),
  state: Type.Union([Type.Literal('active'), Type.Literal('retired')]),
}, Strict)
export type BookingLocation = Readonly<Static<typeof BookingLocationSchema>>

/** Staff or physical resource that can serve a booking. */
export const BookingResourceSchema = Type.Object({
  resourceId: BookingIdSchema,
  name: Type.String({ minLength: 1, maxLength: 160 }),
  kind: Type.Union([Type.Literal('staff'), Type.Literal('room'), Type.Literal('equipment'), Type.Literal('vehicle')]),
  locationId: BookingIdSchema,
  serviceIds: Type.Array(BookingIdSchema, { maxItems: 200, uniqueItems: true }),
  /** Concurrent bookings this single resource can hold. */
  concurrency: Type.Integer({ minimum: 1, maximum: 100 }),
  /** Revoked staff must immediately stop receiving assignments. */
  state: Type.Union([Type.Literal('active'), Type.Literal('suspended'), Type.Literal('retired')]),
}, Strict)
export type BookingResource = Readonly<Static<typeof BookingResourceSchema>>

export const BookingWorkingHourSchema = Type.Object({
  resourceId: BookingIdSchema,
  weekday: BookingWeekdaySchema,
  startMinute: BookingMinuteOfDaySchema,
  endMinute: BookingMinuteOfDaySchema,
}, Strict)
export type BookingWorkingHour = Readonly<Static<typeof BookingWorkingHourSchema>>

/** A dated override: either a full closure or a replacement window. */
export const BookingExceptionSchema = Type.Object({
  resourceId: BookingIdSchema,
  date: BookingDateSchema,
  kind: Type.Union([Type.Literal('closed'), Type.Literal('window')]),
  startMinute: Type.Union([BookingMinuteOfDaySchema, Type.Null()]),
  endMinute: Type.Union([BookingMinuteOfDaySchema, Type.Null()]),
  note: Type.String({ maxLength: 240 }),
}, Strict)
export type BookingException = Readonly<Static<typeof BookingExceptionSchema>>

export const BookingSlotSchema = Type.Object({
  startAt: BookingInstantSchema,
  endAt: BookingInstantSchema,
  timeZone: BookingTimeZoneSchema,
  /** Wall-clock label in the location zone, so DST shifts stay visible. */
  localStart: Type.String({ minLength: 5, maxLength: 5, pattern: '^[0-9]{2}:[0-9]{2}$' }),
  localDate: BookingDateSchema,
  resourceId: BookingIdSchema,
  remainingCapacity: Type.Integer({ minimum: 0, maximum: 1_000 }),
}, Strict)
export type BookingSlot = Readonly<Static<typeof BookingSlotSchema>>

export const BookingHoldSchema = Type.Object({
  holdId: BookingIdSchema,
  serviceId: BookingIdSchema,
  resourceId: BookingIdSchema,
  startAt: BookingInstantSchema,
  endAt: BookingInstantSchema,
  expiresAt: BookingInstantSchema,
  /** Monotonic fence so a stale hold can never be redeemed twice. */
  fence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  state: Type.Union([Type.Literal('held'), Type.Literal('redeemed'), Type.Literal('released'), Type.Literal('expired')]),
}, Strict)
export type BookingHold = Readonly<Static<typeof BookingHoldSchema>>

/** Minimised customer contact. Intake answers are bounded and never free-form blobs. */
export const BookingCustomerSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 160 }),
  email: Type.String({ minLength: 3, maxLength: 320, pattern: '^[^@\\s]+@[^@\\s.]+(?:\\.[^@\\s.]+)+$' }),
  phone: Type.Union([Type.String({ minLength: 7, maxLength: 24, pattern: '^\\+?[0-9][0-9 -]{5,22}$' }), Type.Null()]),
  notes: Type.String({ maxLength: 1_000 }),
}, Strict)
export type BookingCustomer = Readonly<Static<typeof BookingCustomerSchema>>

export const BookingIntakeAnswerSchema = Type.Object({
  fieldId: BookingSlugSchema,
  label: Type.String({ minLength: 1, maxLength: 120 }),
  value: Type.String({ maxLength: 500 }),
}, Strict)

export const BookingStatusSchema = Type.Union([
  Type.Literal('confirmed'),
  Type.Literal('rescheduled'),
  Type.Literal('cancelled'),
  Type.Literal('completed'),
  Type.Literal('no-show'),
])
export type BookingStatus = Static<typeof BookingStatusSchema>

export const BookingSchema = Type.Object({
  bookingId: BookingIdSchema,
  reference: Type.String({ minLength: 6, maxLength: 24, pattern: '^[A-Z0-9-]+$' }),
  serviceId: BookingIdSchema,
  resourceId: BookingIdSchema,
  locationId: BookingIdSchema,
  startAt: BookingInstantSchema,
  endAt: BookingInstantSchema,
  timeZone: BookingTimeZoneSchema,
  status: BookingStatusSchema,
  customer: BookingCustomerSchema,
  intake: Type.Array(BookingIntakeAnswerSchema, { maxItems: 40 }),
  partySize: Type.Integer({ minimum: 1, maximum: 1_000 }),
  priceMinor: BookingMinorAmountSchema,
  currency: BookingCurrencySchema,
  /** Set only by existing owner-confirmed payment authority; never by this pack. */
  paymentReference: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
  createdAt: BookingInstantSchema,
  updatedAt: BookingInstantSchema,
  cancelledAt: Type.Union([BookingInstantSchema, Type.Null()]),
  /** Idempotency key so duplicate submits return the same booking. */
  requestKey: Type.String({ minLength: 8, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' }),
}, Strict)
export type Booking = Readonly<Static<typeof BookingSchema>>

export const BookingEventKindSchema = Type.Union([
  Type.Literal('held'),
  Type.Literal('hold-released'),
  Type.Literal('hold-expired'),
  Type.Literal('booked'),
  Type.Literal('rescheduled'),
  Type.Literal('cancelled'),
  Type.Literal('completed'),
  Type.Literal('no-show'),
  Type.Literal('reminder-sent'),
])

export const BookingEventSchema = Type.Object({
  eventId: BookingIdSchema,
  bookingId: Type.Union([BookingIdSchema, Type.Null()]),
  holdId: Type.Union([BookingIdSchema, Type.Null()]),
  kind: BookingEventKindSchema,
  occurredAt: BookingInstantSchema,
  detail: Type.String({ maxLength: 500 }),
}, Strict)
export type BookingEvent = Readonly<Static<typeof BookingEventSchema>>

export const BookingReminderSchema = Type.Object({
  reminderId: BookingIdSchema,
  bookingId: BookingIdSchema,
  sendAt: BookingInstantSchema,
  channel: Type.Union([Type.Literal('email')]),
  state: Type.Union([Type.Literal('pending'), Type.Literal('sent'), Type.Literal('cancelled')]),
}, Strict)
export type BookingReminder = Readonly<Static<typeof BookingReminderSchema>>

export class BookingContractError extends Error {
  override readonly name = 'BookingContractError'
  readonly boundary: string
  constructor(boundary: string) {
    super(`${boundary} failed strict booking validation.`)
    this.boundary = boundary
  }
}

export function parseBooking<T extends TSchema>(boundary: string, schema: T, value: unknown): Static<T> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new BookingContractError(boundary)
  return structuredClone(parsed.value)
}

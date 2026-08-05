import { apiRequest, type FetchLike } from '@core/http'
import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'

const Strict = { additionalProperties: false } as const
const IdSchema = Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const DateSchema = Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' })
const InstantSchema = Type.String({ format: 'date-time' })
const TimeZoneSchema = Type.String({ minLength: 3, maxLength: 64 })
const TargetSchema = Type.Object({
  organizationId: Type.String({ minLength: 1, maxLength: 255 }),
  workspaceId: Type.String({ minLength: 1, maxLength: 255 }),
  siteId: Type.String({ minLength: 1, maxLength: 255 }),
}, Strict)
export type BookingClientTarget = Readonly<Static<typeof TargetSchema>>

export const BookingServiceWireSchema = Type.Object({
  serviceId: IdSchema,
  slug: Type.String({ minLength: 1, maxLength: 96 }),
  name: Type.String({ minLength: 1, maxLength: 160 }),
  description: Type.String({ maxLength: 2_000 }),
  category: Type.Union([
    Type.Literal('salon'), Type.Literal('consulting'), Type.Literal('training'),
    Type.Literal('photography'), Type.Literal('venue'), Type.Literal('tour'),
    Type.Literal('hospitality'), Type.Literal('event'), Type.Literal('other'),
  ]),
  durationMinutes: Type.Integer({ minimum: 5, maximum: 1_440 }),
  bufferAfterMinutes: Type.Integer({ minimum: 0, maximum: 480 }),
  capacityPerSlot: Type.Integer({ minimum: 1, maximum: 1_000 }),
  slotIntervalMinutes: Type.Integer({ minimum: 5, maximum: 240 }),
  minimumNoticeMinutes: Type.Integer({ minimum: 0, maximum: 43_200 }),
  maximumAdvanceDays: Type.Integer({ minimum: 1, maximum: 730 }),
  cancellationWindowMinutes: Type.Integer({ minimum: 0, maximum: 43_200 }),
  priceMinor: Type.Integer({ minimum: 0, maximum: 99_999_999 }),
  currency: Type.Literal('KES'),
  requiresPrepayment: Type.Boolean(),
  state: Type.Union([Type.Literal('active'), Type.Literal('paused'), Type.Literal('retired')]),
}, Strict)
export type BookingServiceWire = Readonly<Static<typeof BookingServiceWireSchema>>

export const BookingLocationWireSchema = Type.Object({
  locationId: IdSchema,
  name: Type.String({ minLength: 1, maxLength: 160 }),
  timeZone: TimeZoneSchema,
  addressLine: Type.String({ maxLength: 240 }),
  town: Type.String({ maxLength: 120 }),
  country: Type.String({ minLength: 2, maxLength: 2 }),
  mapUrl: Type.Union([Type.String(), Type.Null()]),
  state: Type.Union([Type.Literal('active'), Type.Literal('retired')]),
}, Strict)
export type BookingLocationWire = Readonly<Static<typeof BookingLocationWireSchema>>

export const BookingResourceWireSchema = Type.Object({
  resourceId: IdSchema,
  name: Type.String({ minLength: 1, maxLength: 160 }),
  kind: Type.Union([Type.Literal('staff'), Type.Literal('room'), Type.Literal('equipment'), Type.Literal('vehicle')]),
  locationId: IdSchema,
  serviceIds: Type.Array(IdSchema, { maxItems: 200, uniqueItems: true }),
  concurrency: Type.Integer({ minimum: 1, maximum: 100 }),
  state: Type.Union([Type.Literal('active'), Type.Literal('suspended'), Type.Literal('retired')]),
}, Strict)
export type BookingResourceWire = Readonly<Static<typeof BookingResourceWireSchema>>

export const BookingWorkingHourWireSchema = Type.Object({
  resourceId: IdSchema,
  weekday: Type.Integer({ minimum: 0, maximum: 6 }),
  startMinute: Type.Integer({ minimum: 0, maximum: 1_440 }),
  endMinute: Type.Integer({ minimum: 0, maximum: 1_440 }),
}, Strict)
export type BookingWorkingHourWire = Readonly<Static<typeof BookingWorkingHourWireSchema>>

export const BookingExceptionWireSchema = Type.Object({
  exceptionId: IdSchema,
  resourceId: IdSchema,
  date: DateSchema,
  kind: Type.Union([Type.Literal('closed'), Type.Literal('window')]),
  startMinute: Type.Union([Type.Integer({ minimum: 0, maximum: 1_440 }), Type.Null()]),
  endMinute: Type.Union([Type.Integer({ minimum: 0, maximum: 1_440 }), Type.Null()]),
  note: Type.String({ maxLength: 240 }),
}, Strict)
export type BookingExceptionWire = Readonly<Static<typeof BookingExceptionWireSchema>>

export const BookingCustomerWireSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 160 }),
  email: Type.String({ minLength: 3, maxLength: 320 }),
  phone: Type.Union([Type.String({ minLength: 7, maxLength: 24 }), Type.Null()]),
  notes: Type.String({ maxLength: 1_000 }),
}, Strict)
export type BookingCustomerWire = Readonly<Static<typeof BookingCustomerWireSchema>>
const BookingIntakeAnswerWireSchema = Type.Object({
  fieldId: Type.String({ minLength: 1, maxLength: 96 }),
  label: Type.String({ minLength: 1, maxLength: 120 }),
  value: Type.String({ maxLength: 500 }),
}, Strict)
export type BookingIntakeAnswerWire = Readonly<Static<typeof BookingIntakeAnswerWireSchema>>
const BookingHoldWireSchema = Type.Object({
  holdId: IdSchema,
  serviceId: IdSchema,
  resourceId: IdSchema,
  startAt: InstantSchema,
  endAt: InstantSchema,
  expiresAt: InstantSchema,
  fence: Type.Integer({ minimum: 1 }),
  state: Type.Union([Type.Literal('held'), Type.Literal('redeemed'), Type.Literal('released'), Type.Literal('expired')]),
}, Strict)
export type BookingHoldWire = Readonly<Static<typeof BookingHoldWireSchema>>
const BookingWireSchema = Type.Object({
  bookingId: IdSchema,
  reference: Type.String({ minLength: 6, maxLength: 24 }),
  serviceId: IdSchema,
  resourceId: IdSchema,
  locationId: IdSchema,
  startAt: InstantSchema,
  endAt: InstantSchema,
  timeZone: TimeZoneSchema,
  status: Type.Union([Type.Literal('confirmed'), Type.Literal('rescheduled'), Type.Literal('cancelled'), Type.Literal('completed'), Type.Literal('no-show')]),
  customer: BookingCustomerWireSchema,
  intake: Type.Array(BookingIntakeAnswerWireSchema, { maxItems: 40 }),
  partySize: Type.Integer({ minimum: 1, maximum: 1_000 }),
  priceMinor: Type.Integer({ minimum: 0, maximum: 99_999_999 }),
  currency: Type.Literal('KES'),
  paymentReference: Type.Union([Type.String(), Type.Null()]),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
  cancelledAt: Type.Union([InstantSchema, Type.Null()]),
  requestKey: Type.String({ minLength: 8, maxLength: 128 }),
}, Strict)
export type BookingWire = Readonly<Static<typeof BookingWireSchema>>

const BookingSlotWireSchema = Type.Object({
  startAt: InstantSchema,
  endAt: InstantSchema,
  timeZone: TimeZoneSchema,
  localStart: Type.String({ minLength: 5, maxLength: 5 }),
  localDate: DateSchema,
  resourceId: IdSchema,
  remainingCapacity: Type.Integer({ minimum: 0, maximum: 1_000 }),
}, Strict)
export type BookingSlotWire = Readonly<Static<typeof BookingSlotWireSchema>>

const CatalogSchema = Type.Object({
  services: Type.Array(BookingServiceWireSchema, { maxItems: 200 }),
  locations: Type.Array(BookingLocationWireSchema, { maxItems: 500 }),
  resources: Type.Array(BookingResourceWireSchema, { maxItems: 1_000 }),
  workingHours: Type.Array(BookingWorkingHourWireSchema, { maxItems: 10_000 }),
  exceptions: Type.Array(BookingExceptionWireSchema, { maxItems: 2_000 }),
}, Strict)
export type BookingCatalogWire = Readonly<Static<typeof CatalogSchema>>
const WorkingHoursSchema = Type.Object({ workingHours: Type.Array(BookingWorkingHourWireSchema) }, Strict)
const SlotsSchema = Type.Object({ slots: Type.Array(BookingSlotWireSchema, { maxItems: 500 }) }, Strict)
const BookingsSchema = Type.Object({ bookings: Type.Array(BookingWireSchema, { maxItems: 500 }) }, Strict)
const HoldResultSchema = Type.Object({ hold: BookingHoldWireSchema }, Strict)
const AcceptedSchema = Type.Object({ accepted: Type.Literal(true) }, Strict)

export class BookingsClientError extends Error {
  constructor(message: string) { super(message); this.name = 'BookingsClientError' }
}

function target(input: BookingClientTarget): BookingClientTarget {
  const parsed = safeParseValue(TargetSchema, input)
  if (!parsed.ok) throw new BookingsClientError('Booking client target is invalid.')
  return Object.freeze(structuredClone(parsed.value))
}

function basePath(value: BookingClientTarget): string {
  return `/api/fuma/organizations/${encodeURIComponent(value.organizationId)}/workspaces/${encodeURIComponent(value.workspaceId)}/sites/${encodeURIComponent(value.siteId)}/bookings`
}

export class BookingsHttpClient {
  readonly target: BookingClientTarget
  readonly #fetch: FetchLike
  readonly #base: string

  constructor(value: BookingClientTarget, fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)) {
    this.target = target(value)
    this.#fetch = fetchImpl
    this.#base = basePath(this.target)
  }

  #request<T extends TSchema>(method: string, suffix: string, schema: T, body?: unknown): Promise<Static<T>> {
    return apiRequest(`${this.#base}${suffix}`, {
      method,
      body,
      schema,
      fallbackMessage: 'Booking request failed',
      fetchImpl: this.#fetch,
    })
  }

  catalog(fromDate: string, toDate: string): Promise<BookingCatalogWire> {
    return this.#request('GET', `/catalog?fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`, CatalogSchema)
  }
  saveLocation(location: BookingLocationWire): Promise<BookingLocationWire> { return this.#request('POST', '/locations', BookingLocationWireSchema, location) }
  saveService(service: BookingServiceWire): Promise<BookingServiceWire> { return this.#request('POST', '/services', BookingServiceWireSchema, service) }
  saveResource(resource: BookingResourceWire): Promise<BookingResourceWire> { return this.#request('POST', '/resources', BookingResourceWireSchema, resource) }
  async replaceWorkingHours(resourceId: string, hours: readonly Omit<BookingWorkingHourWire, 'resourceId'>[]): Promise<readonly BookingWorkingHourWire[]> {
    return (await this.#request('PUT', `/resources/${encodeURIComponent(resourceId)}/hours`, WorkingHoursSchema, { hours })).workingHours
  }
  saveException(exception: BookingExceptionWire): Promise<BookingExceptionWire> { return this.#request('POST', '/exceptions', BookingExceptionWireSchema, exception) }
  deleteException(exceptionId: string): Promise<{ accepted: true }> { return this.#request('DELETE', `/exceptions/${encodeURIComponent(exceptionId)}`, AcceptedSchema) }
  async availability(input: Readonly<{ serviceId: string; fromDate: string; toDate: string; partySize: number; resourceId: string | null; maxSlots?: number }>): Promise<readonly BookingSlotWire[]> {
    const query = new URLSearchParams({ serviceId: input.serviceId, fromDate: input.fromDate, toDate: input.toDate, partySize: String(input.partySize), maxSlots: String(input.maxSlots ?? 200) })
    if (input.resourceId) query.set('resourceId', input.resourceId)
    return (await this.#request('GET', `/availability?${query}`, SlotsSchema)).slots
  }
  async day(serviceId: string, date: string): Promise<readonly BookingWire[]> { return (await this.#request('GET', `/day?serviceId=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(date)}`, BookingsSchema)).bookings }
  async hold(input: Readonly<{ serviceId: string; resourceId: string; startAt: string; partySize: number }>): Promise<BookingHoldWire> { return (await this.#request('POST', '/holds', HoldResultSchema, input)).hold }
  releaseHold(holdId: string, fence: number): Promise<{ accepted: true }> { return this.#request('POST', '/holds/release', AcceptedSchema, { holdId, fence }) }
  confirm(input: Readonly<{ holdId: string; fence: number; customer: BookingCustomerWire; intake: readonly BookingIntakeAnswerWire[]; requestKey: string }>): Promise<BookingWire> { return this.#request('POST', '/records', BookingWireSchema, input) }
  booking(bookingId: string): Promise<BookingWire> { return this.#request('GET', `/records/${encodeURIComponent(bookingId)}`, BookingWireSchema) }
  cancel(bookingId: string, reason: string): Promise<BookingWire> { return this.#request('POST', `/records/${encodeURIComponent(bookingId)}/cancel`, BookingWireSchema, { reason }) }
  reschedule(bookingId: string, startAt: string, resourceId: string | null): Promise<BookingWire> { return this.#request('POST', `/records/${encodeURIComponent(bookingId)}/reschedule`, BookingWireSchema, { startAt, resourceId }) }
  settle(bookingId: string, outcome: 'completed' | 'no-show'): Promise<BookingWire> { return this.#request('POST', `/records/${encodeURIComponent(bookingId)}/settle`, BookingWireSchema, { outcome }) }
}

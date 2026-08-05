import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import { readValidatedBody } from '../../http'
import type { FumaScopedRouteDeclaration, FumaScopedRouteHandlerInput } from '../context'
import {
  BookingExceptionSchema,
  BookingHoldSchema,
  BookingLocationSchema,
  BookingResourceSchema,
  BookingSchema,
  BookingServiceSchema,
  BookingSlotSchema,
  BookingWorkingHourSchema,
} from './contracts'
import {
  BookingAvailabilityInputSchema,
  BookingCancelInputSchema,
  BookingConfirmInputSchema,
  BookingDayScheduleInputSchema,
  BookingHoldInputSchema,
  BookingReleaseInputSchema,
  BookingRescheduleInputSchema,
  BookingSettleInputSchema,
} from './capabilities'
import type { BookingAdminException, PostgresBookingRepository } from './postgres'
import { BookingServiceError, type BookingLifecycleService, type BookingScope } from './service'

const Strict = { additionalProperties: false } as const
const ErrorSchema = Type.Object({ error: Type.String({ minLength: 1, maxLength: 500 }) }, Strict)
const AcceptedSchema = Type.Object({ accepted: Type.Literal(true) }, Strict)
const ServiceListSchema = Type.Object({ services: Type.Array(BookingServiceSchema, { maxItems: 200 }) }, Strict)
const LocationListSchema = Type.Object({ locations: Type.Array(BookingLocationSchema, { maxItems: 500 }) }, Strict)
const ResourceListSchema = Type.Object({ resources: Type.Array(BookingResourceSchema, { maxItems: 1_000 }) }, Strict)
const WorkingHourListSchema = Type.Object({ workingHours: Type.Array(BookingWorkingHourSchema, { maxItems: 10_000 }) }, Strict)
const BookingListSchema = Type.Object({ bookings: Type.Array(BookingSchema, { maxItems: 500 }) }, Strict)
const SlotListSchema = Type.Object({ slots: Type.Array(BookingSlotSchema, { maxItems: 500 }) }, Strict)
const BookingAdminExceptionSchema = Type.Object({
  exceptionId: Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' }),
  ...BookingExceptionSchema.properties,
}, Strict)
const ExceptionListSchema = Type.Object({ exceptions: Type.Array(BookingAdminExceptionSchema, { maxItems: 2_000 }) }, Strict)
const CatalogSchema = Type.Object({
  services: ServiceListSchema.properties.services,
  locations: LocationListSchema.properties.locations,
  resources: ResourceListSchema.properties.resources,
  workingHours: WorkingHourListSchema.properties.workingHours,
  exceptions: ExceptionListSchema.properties.exceptions,
}, Strict)
const HoursBodySchema = Type.Object({
  hours: Type.Array(Type.Omit(BookingWorkingHourSchema, ['resourceId']), { maxItems: 28 }),
}, Strict)
const CatalogQuerySchema = Type.Object({
  fromDate: Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }),
  toDate: Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }),
}, Strict)
const BookingPathSchema = Type.Object({ bookingId: Type.String({ minLength: 1, maxLength: 128 }) }, Strict)
const ExceptionPathSchema = Type.Object({ exceptionId: Type.String({ minLength: 1, maxLength: 128 }) }, Strict)
const ResourcePathSchema = Type.Object({ resourceId: Type.String({ minLength: 1, maxLength: 128 }) }, Strict)

export type BookingRoutePorts = Readonly<{
  lifecycle: BookingLifecycleService
  repository: PostgresBookingRepository
}>

function json<T extends TSchema>(schema: T, value: unknown, status = 200): Response {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new Error('Booking route response failed strict validation.')
  return new Response(JSON.stringify(parsed.value), {
    status,
    headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' },
  })
}

function failure(error: unknown): Response {
  if (error instanceof TypeError || error instanceof RangeError) {
    return json(ErrorSchema, { error: 'Request contract is invalid.' }, 400)
  }
  if (error instanceof BookingServiceError) {
    if (error.code.startsWith('unknown-')) return json(ErrorSchema, { error: 'Resource not found.' }, 404)
    if (['slot-unavailable', 'hold-consumed', 'fence-mismatch', 'invalid-transition', 'cancellation-window'].includes(error.code)) {
      return json(ErrorSchema, { error: error.message }, 409)
    }
    return json(ErrorSchema, { error: error.message }, 400)
  }
  const code = error && typeof error === 'object' && 'errno' in error ? String(error.errno) : ''
  if (code === '23503') return json(ErrorSchema, { error: 'A selected booking record is unavailable.' }, 409)
  if (code === '23505') return json(ErrorSchema, { error: 'A booking record with these values already exists.' }, 409)
  return json(ErrorSchema, { error: 'Booking request failed.' }, 500)
}

async function body<T extends TSchema>(input: FumaScopedRouteHandlerInput, schema: T): Promise<Static<T>> {
  const parsed = await readValidatedBody(input.request, schema)
  if (parsed === null) throw new TypeError('Invalid booking request body.')
  return parsed
}

function parsed<T extends TSchema>(schema: T, value: unknown, label: string): Static<T> {
  const result = safeParseValue(schema, value)
  if (!result.ok) throw new TypeError(`${label} is invalid.`)
  return result.value
}

function scope(input: FumaScopedRouteHandlerInput): BookingScope {
  const repository = input.repositoryScope
  if (
    repository.organizationId !== input.context.scope.organization.id
    || repository.workspaceId !== input.context.scope.workspace.id
    || repository.siteId !== input.context.scope.site.id
    || repository.state !== 'active'
    || repository.transferFence !== null
    || input.context.profile.id !== 'website'
  ) throw new BookingServiceError('unknown-booking', 'Booking authority is unavailable.')
  return Object.freeze({
    organizationId: repository.organizationId,
    workspaceId: repository.workspaceId,
    siteId: repository.siteId,
  })
}

function directStaff(input: FumaScopedRouteHandlerInput): void {
  if (input.context.actor.kind !== 'staff' || input.context.actor.impersonator !== null) {
    throw new BookingServiceError('unknown-booking', 'Direct staff booking authority is required.')
  }
}

function catalogRange(input: FumaScopedRouteHandlerInput): Static<typeof CatalogQuerySchema> {
  const query = new URL(input.request.url).searchParams
  const today = new Date().toISOString().slice(0, 10)
  const future = new Date(Date.now() + 730 * 86_400_000).toISOString().slice(0, 10)
  return parsed(CatalogQuerySchema, {
    fromDate: query.get('fromDate') ?? today,
    toDate: query.get('toDate') ?? future,
  }, 'Booking catalog range')
}

function availabilityQuery(input: FumaScopedRouteHandlerInput): Static<typeof BookingAvailabilityInputSchema> {
  const query = new URL(input.request.url).searchParams
  return parsed(BookingAvailabilityInputSchema, {
    serviceId: query.get('serviceId'),
    fromDate: query.get('fromDate'),
    toDate: query.get('toDate'),
    partySize: Number(query.get('partySize') ?? 1),
    resourceId: query.get('resourceId'),
    maxSlots: Number(query.get('maxSlots') ?? 200),
  }, 'Booking availability query')
}

function dayQuery(input: FumaScopedRouteHandlerInput): Static<typeof BookingDayScheduleInputSchema> {
  const query = new URL(input.request.url).searchParams
  return parsed(BookingDayScheduleInputSchema, {
    serviceId: query.get('serviceId'),
    date: query.get('date'),
  }, 'Booking day query')
}

type HourInput = Static<typeof HoursBodySchema>['hours'][number]

function assertHours(hours: readonly HourInput[]): void {
  const byDay = new Map<number, { startMinute: number; endMinute: number }[]>()
  for (const hour of hours) {
    if (hour.endMinute <= hour.startMinute) throw new TypeError('Working hour must end after it starts.')
    const day = byDay.get(hour.weekday) ?? []
    if (day.some((entry) => hour.startMinute < entry.endMinute && entry.startMinute < hour.endMinute)) {
      throw new TypeError('Working hours cannot overlap.')
    }
    day.push(hour)
    byDay.set(hour.weekday, day)
  }
}

export function createBookingScopedRouteDeclarations(ports: BookingRoutePorts): readonly FumaScopedRouteDeclaration[] {
  const route = (
    method: FumaScopedRouteDeclaration['method'],
    path: string,
    permission: string,
    handler: (input: FumaScopedRouteHandlerInput) => Promise<Response>,
  ): FumaScopedRouteDeclaration => Object.freeze({
    method,
    path,
    permission,
    handler: async (input: FumaScopedRouteHandlerInput) => {
      try { return await handler(input) } catch (error) { return failure(error) }
    },
  }) as FumaScopedRouteDeclaration

  return Object.freeze([
    route('GET', '/bookings/catalog', 'site.home.read', async (input) => {
      const trustedScope = scope(input)
      const range = catalogRange(input)
      const [services, locations, resources] = await Promise.all([
        ports.repository.listServices(trustedScope),
        ports.repository.listLocations(trustedScope),
        ports.repository.listAllResources(trustedScope),
      ])
      const boundedServices = services.slice(0, 200)
      const boundedLocations = locations.slice(0, 500)
      const boundedResources = resources.slice(0, 1_000)
      const resourceIds = boundedResources.map(({ resourceId }) => resourceId)
      const [workingHours, exceptions] = await Promise.all([
        ports.repository.listWorkingHours(trustedScope, resourceIds),
        ports.repository.listAdminExceptions(trustedScope, resourceIds, range.fromDate, range.toDate),
      ])
      return json(CatalogSchema, {
        services: boundedServices,
        locations: boundedLocations,
        resources: boundedResources,
        workingHours: workingHours.slice(0, 10_000),
        exceptions: exceptions.slice(0, 2_000),
      })
    }),
    route('POST', '/bookings/locations', 'site.settings.write', async (input) => {
      directStaff(input)
      return json(BookingLocationSchema, await ports.repository.saveLocation(scope(input), await body(input, BookingLocationSchema)))
    }),
    route('POST', '/bookings/services', 'site.settings.write', async (input) => {
      directStaff(input)
      return json(BookingServiceSchema, await ports.repository.saveService(scope(input), await body(input, BookingServiceSchema)))
    }),
    route('POST', '/bookings/resources', 'site.settings.write', async (input) => {
      directStaff(input)
      return json(BookingResourceSchema, await ports.repository.saveResource(scope(input), await body(input, BookingResourceSchema)))
    }),
    route('PUT', '/bookings/resources/:resourceId/hours', 'site.settings.write', async (input) => {
      directStaff(input)
      const path = parsed(ResourcePathSchema, input.params, 'Booking resource path')
      const command = await body(input, HoursBodySchema)
      assertHours(command.hours)
      const workingHours = await ports.repository.replaceWorkingHours(scope(input), path.resourceId, command.hours)
      return json(WorkingHourListSchema, { workingHours })
    }),
    route('POST', '/bookings/exceptions', 'site.settings.write', async (input) => {
      directStaff(input)
      const exception = await body(input, BookingAdminExceptionSchema) as BookingAdminException
      if (exception.kind === 'closed' && (exception.startMinute !== null || exception.endMinute !== null)) throw new TypeError('Closed-day exception cannot include a window.')
      if (exception.kind === 'window' && (exception.startMinute === null || exception.endMinute === null || exception.endMinute <= exception.startMinute)) throw new TypeError('Exception window is invalid.')
      return json(BookingAdminExceptionSchema, await ports.repository.saveException(scope(input), exception))
    }),
    route('DELETE', '/bookings/exceptions/:exceptionId', 'site.settings.write', async (input) => {
      directStaff(input)
      const path = parsed(ExceptionPathSchema, input.params, 'Booking exception path')
      const accepted = await ports.repository.deleteException(scope(input), path.exceptionId)
      if (!accepted) throw new BookingServiceError('unknown-booking', 'Booking exception is unavailable.')
      return json(AcceptedSchema, { accepted: true })
    }),
    route('GET', '/bookings/availability', 'site.home.read', async (input) => {
      const query = availabilityQuery(input)
      const slots = await ports.lifecycle.availability(scope(input), query)
      return json(SlotListSchema, { slots })
    }),
    route('POST', '/bookings/holds', 'site.settings.write', async (input) => {
      directStaff(input)
      return json(Type.Object({ hold: BookingHoldSchema }, Strict), { hold: await ports.lifecycle.hold(scope(input), await body(input, BookingHoldInputSchema)) }, 201)
    }),
    route('POST', '/bookings/holds/release', 'site.settings.write', async (input) => {
      directStaff(input)
      const command = await body(input, BookingReleaseInputSchema)
      await ports.lifecycle.releaseHold(scope(input), command.holdId, command.fence)
      return json(AcceptedSchema, { accepted: true })
    }),
    route('POST', '/bookings/records', 'site.settings.write', async (input) => {
      directStaff(input)
      return json(BookingSchema, await ports.lifecycle.book(scope(input), await body(input, BookingConfirmInputSchema)), 201)
    }),
    route('GET', '/bookings/records/:bookingId', 'site.home.read', async (input) => {
      const path = parsed(BookingPathSchema, input.params, 'Booking record path')
      const booking = await ports.repository.getBooking(scope(input), path.bookingId)
      if (!booking) throw new BookingServiceError('unknown-booking', 'Booking is unavailable.')
      return json(BookingSchema, booking)
    }),
    route('GET', '/bookings/day', 'site.home.read', async (input) => {
      const query = dayQuery(input)
      const bookings = await ports.lifecycle.schedule(scope(input), query)
      return json(BookingListSchema, { bookings })
    }),
    route('POST', '/bookings/records/:bookingId/cancel', 'site.settings.write', async (input) => {
      directStaff(input)
      const path = parsed(BookingPathSchema, input.params, 'Booking record path')
      const command = await body(input, Type.Omit(BookingCancelInputSchema, ['bookingId']))
      return json(BookingSchema, await ports.lifecycle.cancel(scope(input), path.bookingId, command.reason))
    }),
    route('POST', '/bookings/records/:bookingId/reschedule', 'site.settings.write', async (input) => {
      directStaff(input)
      const path = parsed(BookingPathSchema, input.params, 'Booking record path')
      const command = await body(input, Type.Omit(BookingRescheduleInputSchema, ['bookingId']))
      return json(BookingSchema, await ports.lifecycle.reschedule(scope(input), { bookingId: path.bookingId, ...command }))
    }),
    route('POST', '/bookings/records/:bookingId/settle', 'site.settings.write', async (input) => {
      directStaff(input)
      const path = parsed(BookingPathSchema, input.params, 'Booking record path')
      const command = await body(input, Type.Omit(BookingSettleInputSchema, ['bookingId']))
      return json(BookingSchema, await ports.lifecycle.settle(scope(input), path.bookingId, command.outcome))
    }),
  ])
}

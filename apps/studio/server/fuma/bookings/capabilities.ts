/**
 * FUMA-093 — reviewed booking capabilities.
 *
 * Registers the bookings pack through the existing FUMA-086 registry so Site AI,
 * MCP, imported runtimes and export adapters all invoke identical semantics.
 * Nothing here touches SQL, table names, predicates, credentials or caller
 * scope: every execution delegates to the injected lifecycle authority, which
 * derives tenancy from the trusted capability authority.
 */
import { Type, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import type { BackendCapabilityMetadata } from '../aiBackendCapabilities/contracts'
import {
  ReviewedBackendCapabilityRegistry,
  type ReviewedBackendCapability,
} from '../aiBackendCapabilities/registry'
import {
  BookingCustomerSchema,
  BookingDateSchema,
  BookingIdSchema,
  BookingInstantSchema,
  BookingIntakeAnswerSchema,
  BookingSchema,
  BookingServiceSchema,
  BookingSlotSchema,
  BookingStatusSchema,
} from './contracts'

const Strict = { additionalProperties: false } as const
const VERSION = '1.0.0'

export const BOOKING_CAPABILITY_IDS = Object.freeze({
  listServices: 'fuma.bookings.list-services',
  availability: 'fuma.bookings.availability',
  hold: 'fuma.bookings.hold',
  release: 'fuma.bookings.release-hold',
  book: 'fuma.bookings.confirm',
  reschedule: 'fuma.bookings.reschedule',
  cancel: 'fuma.bookings.cancel',
  settle: 'fuma.bookings.settle',
  schedule: 'fuma.bookings.day-schedule',
} as const)

export const ListBookingServicesInputSchema = Type.Object({
  limit: Type.Integer({ minimum: 1, maximum: 200 }),
}, Strict)
export const ListBookingServicesOutputSchema = Type.Object({
  services: Type.Array(BookingServiceSchema, { maxItems: 200 }),
}, Strict)

export const BookingAvailabilityInputSchema = Type.Object({
  serviceId: BookingIdSchema,
  fromDate: BookingDateSchema,
  toDate: BookingDateSchema,
  partySize: Type.Integer({ minimum: 1, maximum: 1_000 }),
  resourceId: Type.Union([BookingIdSchema, Type.Null()]),
  maxSlots: Type.Integer({ minimum: 1, maximum: 500 }),
}, Strict)
export const BookingAvailabilityOutputSchema = Type.Object({
  slots: Type.Array(BookingSlotSchema, { maxItems: 500 }),
}, Strict)

export const BookingHoldInputSchema = Type.Object({
  serviceId: BookingIdSchema,
  resourceId: BookingIdSchema,
  startAt: BookingInstantSchema,
  partySize: Type.Integer({ minimum: 1, maximum: 1_000 }),
}, Strict)
export const BookingHoldOutputSchema = Type.Object({
  holdId: BookingIdSchema,
  fence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  expiresAt: BookingInstantSchema,
}, Strict)

export const BookingReleaseInputSchema = Type.Object({
  holdId: BookingIdSchema,
  fence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
}, Strict)
export const BookingReleaseOutputSchema = Type.Object({
  released: Type.Literal(true),
}, Strict)

export const BookingConfirmInputSchema = Type.Object({
  holdId: BookingIdSchema,
  fence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  customer: BookingCustomerSchema,
  intake: Type.Array(BookingIntakeAnswerSchema, { maxItems: 40 }),
  requestKey: Type.String({ minLength: 8, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' }),
}, Strict)
export const BookingConfirmOutputSchema = Type.Object({
  booking: BookingSchema,
}, Strict)

export const BookingRescheduleInputSchema = Type.Object({
  bookingId: BookingIdSchema,
  startAt: BookingInstantSchema,
  resourceId: Type.Union([BookingIdSchema, Type.Null()]),
}, Strict)

export const BookingCancelInputSchema = Type.Object({
  bookingId: BookingIdSchema,
  reason: Type.String({ minLength: 1, maxLength: 240 }),
}, Strict)

export const BookingSettleInputSchema = Type.Object({
  bookingId: BookingIdSchema,
  outcome: Type.Union([Type.Literal('completed'), Type.Literal('no-show')]),
}, Strict)

export const BookingDayScheduleInputSchema = Type.Object({
  serviceId: BookingIdSchema,
  date: BookingDateSchema,
}, Strict)
export const BookingDayScheduleOutputSchema = Type.Object({
  date: BookingDateSchema,
  bookings: Type.Array(BookingSchema, { maxItems: 500 }),
}, Strict)

/** Operator-facing status projection used by the dashboard panel. */
export const BookingStatusCountSchema = Type.Object({
  status: BookingStatusSchema,
  count: Type.Integer({ minimum: 0, maximum: 1_000_000 }),
}, Strict)
export type BookingStatusCount = Readonly<Static<typeof BookingStatusCountSchema>>

/**
 * The capability-facing authority. Implementations receive the trusted
 * capability authority and derive tenant scope from it, never from input.
 */
export interface BookingCapabilityAuthority {
  listServices(input: Readonly<{ limit: number }>, context: BookingCapabilityContext): Promise<Static<typeof ListBookingServicesOutputSchema>>
  availability(input: Static<typeof BookingAvailabilityInputSchema>, context: BookingCapabilityContext): Promise<Static<typeof BookingAvailabilityOutputSchema>>
  hold(input: Static<typeof BookingHoldInputSchema>, context: BookingCapabilityContext): Promise<Static<typeof BookingHoldOutputSchema>>
  releaseHold(input: Static<typeof BookingReleaseInputSchema>, context: BookingCapabilityContext): Promise<Static<typeof BookingReleaseOutputSchema>>
  confirm(input: Static<typeof BookingConfirmInputSchema>, context: BookingCapabilityContext): Promise<Static<typeof BookingConfirmOutputSchema>>
  reschedule(input: Static<typeof BookingRescheduleInputSchema>, context: BookingCapabilityContext): Promise<Static<typeof BookingConfirmOutputSchema>>
  cancel(input: Static<typeof BookingCancelInputSchema>, context: BookingCapabilityContext): Promise<Static<typeof BookingConfirmOutputSchema>>
  settle(input: Static<typeof BookingSettleInputSchema>, context: BookingCapabilityContext): Promise<Static<typeof BookingConfirmOutputSchema>>
  daySchedule(input: Static<typeof BookingDayScheduleInputSchema>, context: BookingCapabilityContext): Promise<Static<typeof BookingDayScheduleOutputSchema>>
}

export type BookingCapabilityContext = Readonly<{
  scope: Readonly<{ organizationId: string; workspaceId: string; siteId: string }>
  signal: AbortSignal
}>

type CapabilityClass = BackendCapabilityMetadata['class']
type Profile = BackendCapabilityMetadata['profiles'][number]

type DefinitionInput = Readonly<{
  id: string
  title: string
  description: string
  class: CapabilityClass
  profiles?: readonly Profile[]
  permission: string
  classification?: BackendCapabilityMetadata['dataClassification']
  confirmation?: BackendCapabilityMetadata['confirmation']
  inputSchema: TSchema
  outputSchema: TSchema
  execute: ReviewedBackendCapability['execute']
}>

function metadata(input: DefinitionInput): BackendCapabilityMetadata {
  const write = input.class !== 'read'
  return {
    id: input.id,
    version: VERSION,
    title: input.title,
    description: input.description,
    class: input.class,
    // Booking packs extend the Website profile; they are not a new profile.
    profiles: [...(input.profiles ?? ['website'])],
    channels: ['site-ai', 'mcp', 'imported-runtime', 'export-adapter'],
    requiredPermission: input.permission,
    grants: {
      siteAi: write ? 'ai.tools.write' : 'ai.chat',
      mcp: write ? 'site.mutate' : 'site.read',
      importedRuntime: write ? 'runtime.backend.write' : 'runtime.backend.read',
      exportAdapter: write ? 'export.backend.write' : 'export.backend.read',
    },
    dataClassification: input.classification ?? 'customer',
    confirmation: input.confirmation ?? 'none',
    limits: {
      inputBytes: write ? 262_144 : 16_384,
      outputBytes: 524_288,
      resultItems: 500,
      requestsPerMinute: write ? 30 : 120,
      timeoutMs: 10_000,
    },
    metering: { kind: 'ai', logicalCredits: 1, providerCredits: 1 },
    exportAdapter: { id: `${input.id}.adapter`, version: VERSION },
    state: 'active',
  }
}

function definition(input: DefinitionInput): ReviewedBackendCapability {
  return Object.freeze({
    metadata: metadata(input),
    inputSchema: input.inputSchema,
    outputSchema: input.outputSchema,
    execute: input.execute,
  })
}

function context(authorityContext: Parameters<ReviewedBackendCapability['execute']>[1]): BookingCapabilityContext {
  return Object.freeze({
    scope: Object.freeze({
      organizationId: authorityContext.authority.scope.organizationId,
      workspaceId: authorityContext.authority.scope.workspaceId,
      siteId: authorityContext.authority.scope.siteId,
    }),
    signal: authorityContext.signal,
  })
}

export function createBookingCapabilities(
  authority: BookingCapabilityAuthority,
): readonly ReviewedBackendCapability[] {
  return Object.freeze([
    definition({
      id: BOOKING_CAPABILITY_IDS.listServices,
      title: 'List bookable services',
      description: 'Lists bounded bookable services with duration, capacity and KES price presentation.',
      class: 'read',
      permission: 'bookings.services.read',
      classification: 'public',
      inputSchema: ListBookingServicesInputSchema,
      outputSchema: ListBookingServicesOutputSchema,
      execute: (raw, ctx) => authority.listServices(raw as { limit: number }, context(ctx)),
    }),
    definition({
      id: BOOKING_CAPABILITY_IDS.availability,
      title: 'Read booking availability',
      description: 'Computes bookable slots for an explicit date range in the location time zone.',
      class: 'read',
      permission: 'bookings.availability.read',
      classification: 'public',
      inputSchema: BookingAvailabilityInputSchema,
      outputSchema: BookingAvailabilityOutputSchema,
      execute: (raw, ctx) => authority.availability(raw as Static<typeof BookingAvailabilityInputSchema>, context(ctx)),
    }),
    definition({
      id: BOOKING_CAPABILITY_IDS.hold,
      title: 'Hold a booking slot',
      description: 'Reserves a slot briefly with a fenced hold so details can be completed.',
      class: 'mutate',
      permission: 'bookings.holds.write',
      inputSchema: BookingHoldInputSchema,
      outputSchema: BookingHoldOutputSchema,
      execute: (raw, ctx) => authority.hold(raw as Static<typeof BookingHoldInputSchema>, context(ctx)),
    }),
    definition({
      id: BOOKING_CAPABILITY_IDS.release,
      title: 'Release a booking hold',
      description: 'Releases a fenced hold so the slot returns to availability.',
      class: 'mutate',
      permission: 'bookings.holds.write',
      inputSchema: BookingReleaseInputSchema,
      outputSchema: BookingReleaseOutputSchema,
      execute: (raw, ctx) => authority.releaseHold(raw as Static<typeof BookingReleaseInputSchema>, context(ctx)),
    }),
    definition({
      id: BOOKING_CAPABILITY_IDS.book,
      title: 'Confirm a booking',
      description: 'Redeems a live hold into a booking, idempotent on the request key.',
      class: 'mutate',
      permission: 'bookings.write',
      inputSchema: BookingConfirmInputSchema,
      outputSchema: BookingConfirmOutputSchema,
      execute: (raw, ctx) => authority.confirm(raw as Static<typeof BookingConfirmInputSchema>, context(ctx)),
    }),
    definition({
      id: BOOKING_CAPABILITY_IDS.reschedule,
      title: 'Reschedule a booking',
      description: 'Moves a live booking to another available slot.',
      class: 'mutate',
      permission: 'bookings.write',
      inputSchema: BookingRescheduleInputSchema,
      outputSchema: BookingConfirmOutputSchema,
      execute: (raw, ctx) => authority.reschedule(raw as Static<typeof BookingRescheduleInputSchema>, context(ctx)),
    }),
    definition({
      id: BOOKING_CAPABILITY_IDS.cancel,
      title: 'Cancel a booking',
      description: 'Cancels a booking when its cancellation window is still open.',
      class: 'mutate',
      permission: 'bookings.write',
      inputSchema: BookingCancelInputSchema,
      outputSchema: BookingConfirmOutputSchema,
      execute: (raw, ctx) => authority.cancel(raw as Static<typeof BookingCancelInputSchema>, context(ctx)),
    }),
    definition({
      id: BOOKING_CAPABILITY_IDS.settle,
      title: 'Settle a booking outcome',
      description: 'Records an owner-confirmed completed or no-show outcome.',
      class: 'confirm',
      permission: 'bookings.write',
      confirmation: 'owner',
      inputSchema: BookingSettleInputSchema,
      outputSchema: BookingConfirmOutputSchema,
      execute: (raw, ctx) => authority.settle(raw as Static<typeof BookingSettleInputSchema>, context(ctx)),
    }),
    definition({
      id: BOOKING_CAPABILITY_IDS.schedule,
      title: 'Read the operator day schedule',
      description: 'Lists one day of bookings for operators, ordered by start instant.',
      class: 'read',
      permission: 'bookings.read',
      inputSchema: BookingDayScheduleInputSchema,
      outputSchema: BookingDayScheduleOutputSchema,
      execute: (raw, ctx) => authority.daySchedule(raw as Static<typeof BookingDayScheduleInputSchema>, context(ctx)),
    }),
  ])
}

export function registerBookingCapabilities(
  registry: ReviewedBackendCapabilityRegistry,
  authority: BookingCapabilityAuthority,
): ReviewedBackendCapabilityRegistry {
  for (const capability of createBookingCapabilities(authority)) registry.register(capability)
  return registry
}

/** Requests the pack deliberately does not serve, with an explicit reason. */
export function bookingBlockingDiagnostic(functionName: string): string | null {
  const denied: Readonly<Record<string, string>> = Object.freeze({
    'bookings.sql': 'Direct SQL is never exposed; use reviewed booking capabilities.',
    'bookings.charge': 'Taking payment requires the existing owner-confirmed payment authority.',
    'bookings.clinical': 'Clinical and diagnostic scheduling is out of scope for FUMA-093.',
    'bookings.export-customers': 'Bulk customer export is not a booking capability.',
  })
  return denied[functionName] ?? null
}

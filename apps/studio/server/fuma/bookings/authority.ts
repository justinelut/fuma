/**
 * FUMA-093 — capability authority adapter.
 *
 * Translates reviewed capability calls into lifecycle operations. It exists so
 * the capability layer never reaches storage directly and so tenant scope always
 * comes from the trusted authority context rather than caller input.
 */
import type { Static } from '@core/utils/typeboxHelpers'
import type {
  BookingAvailabilityInputSchema,
  BookingAvailabilityOutputSchema,
  BookingCancelInputSchema,
  BookingCapabilityAuthority,
  BookingCapabilityContext,
  BookingConfirmInputSchema,
  BookingConfirmOutputSchema,
  BookingDayScheduleInputSchema,
  BookingDayScheduleOutputSchema,
  BookingHoldInputSchema,
  BookingHoldOutputSchema,
  BookingReleaseInputSchema,
  BookingReleaseOutputSchema,
  BookingRescheduleInputSchema,
  BookingSettleInputSchema,
  ListBookingServicesOutputSchema,
} from './capabilities'
import type { BookingLifecycleService, BookingScope } from './service'

function scopeOf(context: BookingCapabilityContext): BookingScope {
  return Object.freeze({
    organizationId: context.scope.organizationId,
    workspaceId: context.scope.workspaceId,
    siteId: context.scope.siteId,
  })
}

export class LifecycleBookingCapabilityAuthority implements BookingCapabilityAuthority {
  readonly #lifecycle: BookingLifecycleService

  constructor(lifecycle: BookingLifecycleService) {
    this.#lifecycle = lifecycle
  }

  async listServices(
    input: Readonly<{ limit: number }>,
    context: BookingCapabilityContext,
  ): Promise<Static<typeof ListBookingServicesOutputSchema>> {
    const services = await this.#lifecycle.listServices(scopeOf(context))
    return { services: [...services].slice(0, input.limit) }
  }

  async availability(
    input: Static<typeof BookingAvailabilityInputSchema>,
    context: BookingCapabilityContext,
  ): Promise<Static<typeof BookingAvailabilityOutputSchema>> {
    const slots = await this.#lifecycle.availability(scopeOf(context), {
      serviceId: input.serviceId,
      fromDate: input.fromDate,
      toDate: input.toDate,
      partySize: input.partySize,
      resourceId: input.resourceId,
      maxSlots: input.maxSlots,
    })
    return { slots: [...slots] }
  }

  async hold(
    input: Static<typeof BookingHoldInputSchema>,
    context: BookingCapabilityContext,
  ): Promise<Static<typeof BookingHoldOutputSchema>> {
    const hold = await this.#lifecycle.hold(scopeOf(context), {
      serviceId: input.serviceId,
      resourceId: input.resourceId,
      startAt: input.startAt,
      partySize: input.partySize,
    })
    return { holdId: hold.holdId, fence: hold.fence, expiresAt: hold.expiresAt }
  }

  async releaseHold(
    input: Static<typeof BookingReleaseInputSchema>,
    context: BookingCapabilityContext,
  ): Promise<Static<typeof BookingReleaseOutputSchema>> {
    await this.#lifecycle.releaseHold(scopeOf(context), input.holdId, input.fence)
    return { released: true }
  }

  async confirm(
    input: Static<typeof BookingConfirmInputSchema>,
    context: BookingCapabilityContext,
  ): Promise<Static<typeof BookingConfirmOutputSchema>> {
    const booking = await this.#lifecycle.book(scopeOf(context), {
      holdId: input.holdId,
      fence: input.fence,
      customer: input.customer,
      intake: input.intake,
      requestKey: input.requestKey,
    })
    return { booking }
  }

  async reschedule(
    input: Static<typeof BookingRescheduleInputSchema>,
    context: BookingCapabilityContext,
  ): Promise<Static<typeof BookingConfirmOutputSchema>> {
    const booking = await this.#lifecycle.reschedule(scopeOf(context), {
      bookingId: input.bookingId,
      startAt: input.startAt,
      resourceId: input.resourceId,
    })
    return { booking }
  }

  async cancel(
    input: Static<typeof BookingCancelInputSchema>,
    context: BookingCapabilityContext,
  ): Promise<Static<typeof BookingConfirmOutputSchema>> {
    const booking = await this.#lifecycle.cancel(scopeOf(context), input.bookingId, input.reason)
    return { booking }
  }

  async settle(
    input: Static<typeof BookingSettleInputSchema>,
    context: BookingCapabilityContext,
  ): Promise<Static<typeof BookingConfirmOutputSchema>> {
    const booking = await this.#lifecycle.settle(scopeOf(context), input.bookingId, input.outcome)
    return { booking }
  }

  async daySchedule(
    input: Static<typeof BookingDayScheduleInputSchema>,
    context: BookingCapabilityContext,
  ): Promise<Static<typeof BookingDayScheduleOutputSchema>> {
    const bookings = await this.#lifecycle.schedule(scopeOf(context), {
      serviceId: input.serviceId,
      date: input.date,
    })
    return { date: input.date, bookings: [...bookings] }
  }
}

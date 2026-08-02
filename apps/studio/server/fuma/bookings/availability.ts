/**
 * FUMA-093 — availability computation.
 *
 * Pure, deterministic and side-effect free so it can be proven without a
 * database or a clock. Events (FUMA-091) and Hospitality (FUMA-092) compose
 * this engine rather than implementing a second reservation model.
 *
 * Correctness rules:
 *  - Working hours are wall-clock minutes in the location's IANA zone.
 *  - Slots are produced per calendar day in that zone, then converted to exact
 *    UTC instants, so a DST transition shortens or lengthens the day naturally
 *    instead of silently shifting every slot.
 *  - A slot is offered only when the service fits before the window closes,
 *    honours notice/advance limits, and has capacity left after existing
 *    bookings and live holds.
 */
import type {
  Booking,
  BookingException,
  BookingHold,
  BookingResource,
  BookingService,
  BookingSlot,
  BookingWorkingHour,
} from './contracts'

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

export type AvailabilityRequest = Readonly<{
  service: BookingService
  resources: readonly BookingResource[]
  workingHours: readonly BookingWorkingHour[]
  exceptions: readonly BookingException[]
  bookings: readonly Booking[]
  holds: readonly BookingHold[]
  timeZone: string
  /** Inclusive calendar day range in the location zone. */
  fromDate: string
  toDate: string
  now: Date
  partySize: number
  maxSlots: number
  /** Optional exact resource filter. */
  resourceId?: string | null
}>

/**
 * Offset of `instant` in `timeZone`, in minutes east of UTC.
 * Uses Intl parts rather than a hardcoded table so DST rules stay correct.
 */
export function zoneOffsetMinutes(timeZone: string, instant: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = formatter.formatToParts(instant)
  const lookup = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type)
    return found ? Number(found.value) : 0
  }
  // `Date.UTC` of the wall-clock reading minus the true instant is the offset.
  const asUtc = Date.UTC(
    lookup('year'),
    lookup('month') - 1,
    lookup('day'),
    lookup('hour') % 24,
    lookup('minute'),
    lookup('second'),
  )
  return Math.round((asUtc - instant.getTime()) / MINUTE_MS)
}

/** Exact UTC instant for a wall-clock date and minute in `timeZone`. */
export function zonedInstant(timeZone: string, date: string, minuteOfDay: number): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0) + minuteOfDay * MINUTE_MS
  // Two passes converge for every real zone: the first uses the guessed offset,
  // the second corrects it when the guess landed on the other side of a shift.
  const first = naive - zoneOffsetMinutes(timeZone, new Date(naive)) * MINUTE_MS
  const second = naive - zoneOffsetMinutes(timeZone, new Date(first)) * MINUTE_MS
  return new Date(second)
}

/** Calendar date string in `timeZone` for an instant. */
export function zonedDate(timeZone: string, instant: Date): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(instant)
}

/** Weekday index (0 = Sunday) in `timeZone`. */
export function zonedWeekday(timeZone: string, date: string): number {
  const noon = zonedInstant(timeZone, date, 12 * 60)
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' })
  const label = formatter.format(noon)
  const order = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const index = order.indexOf(label)
  if (index < 0) throw new RangeError(`Unsupported weekday label for ${timeZone}`)
  return index
}

function localHourMinute(timeZone: string, instant: Date): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
  return formatter.format(instant)
}

export function enumerateDates(fromDate: string, toDate: string, maxDays: number): readonly string[] {
  const dates: string[] = []
  const [fy, fm, fd] = fromDate.split('-').map(Number) as [number, number, number]
  const [ty, tm, td] = toDate.split('-').map(Number) as [number, number, number]
  let cursor = Date.UTC(fy, fm - 1, fd)
  const end = Date.UTC(ty, tm - 1, td)
  while (cursor <= end && dates.length < maxDays) {
    dates.push(new Date(cursor).toISOString().slice(0, 10))
    cursor += DAY_MS
  }
  return Object.freeze(dates)
}

type Window = Readonly<{ startMinute: number; endMinute: number }>

/** Windows a resource is open on a date, after applying dated exceptions. */
export function resourceWindows(
  resourceId: string,
  timeZone: string,
  date: string,
  workingHours: readonly BookingWorkingHour[],
  exceptions: readonly BookingException[],
): readonly Window[] {
  const dated = exceptions.filter((entry) => entry.resourceId === resourceId && entry.date === date)
  if (dated.some((entry) => entry.kind === 'closed')) return Object.freeze([])
  const overrides = dated.filter((entry) => entry.kind === 'window'
    && entry.startMinute !== null
    && entry.endMinute !== null
    && entry.endMinute > entry.startMinute)
  if (overrides.length > 0) {
    return Object.freeze(overrides.map((entry) => Object.freeze({
      startMinute: entry.startMinute as number,
      endMinute: entry.endMinute as number,
    })))
  }
  const weekday = zonedWeekday(timeZone, date)
  return Object.freeze(workingHours
    .filter((hour) => hour.resourceId === resourceId
      && hour.weekday === weekday
      && hour.endMinute > hour.startMinute)
    .map((hour) => Object.freeze({ startMinute: hour.startMinute, endMinute: hour.endMinute })))
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

/** Capacity already consumed for a resource across a candidate span. */
function consumedCapacity(
  resourceId: string,
  spanStart: number,
  spanEnd: number,
  bookings: readonly Booking[],
  holds: readonly BookingHold[],
  now: Date,
): number {
  const nowMs = now.getTime()
  let used = 0
  for (const booking of bookings) {
    if (booking.resourceId !== resourceId) continue
    if (booking.status === 'cancelled') continue
    const start = Date.parse(booking.startAt)
    const end = Date.parse(booking.endAt)
    if (overlaps(spanStart, spanEnd, start, end)) used += booking.partySize
  }
  for (const hold of holds) {
    if (hold.resourceId !== resourceId) continue
    if (hold.state !== 'held') continue
    // An expired hold no longer consumes capacity even if never swept.
    if (Date.parse(hold.expiresAt) <= nowMs) continue
    const start = Date.parse(hold.startAt)
    const end = Date.parse(hold.endAt)
    if (overlaps(spanStart, spanEnd, start, end)) used += 1
  }
  return used
}

/**
 * Deterministic bookable slots. Ordered by start instant, then resource, so
 * two identical requests always produce byte-identical output.
 */
export function computeAvailability(request: AvailabilityRequest): readonly BookingSlot[] {
  const {
    service, workingHours, exceptions, bookings, holds,
    timeZone, fromDate, toDate, now, partySize, maxSlots,
  } = request
  if (service.state !== 'active') return Object.freeze([])
  if (partySize < 1) return Object.freeze([])

  const resources = request.resources.filter((resource) => resource.state === 'active'
    && resource.serviceIds.includes(service.serviceId)
    && (!request.resourceId || resource.resourceId === request.resourceId))
  if (resources.length === 0) return Object.freeze([])

  const nowMs = now.getTime()
  const earliest = nowMs + service.minimumNoticeMinutes * MINUTE_MS
  const latest = nowMs + service.maximumAdvanceDays * DAY_MS
  const span = service.durationMinutes + service.bufferAfterMinutes
  const dates = enumerateDates(fromDate, toDate, service.maximumAdvanceDays + 1)

  const slots: BookingSlot[] = []
  for (const date of dates) {
    for (const resource of resources) {
      const windows = resourceWindows(resource.resourceId, timeZone, date, workingHours, exceptions)
      for (const window of windows) {
        for (let minute = window.startMinute; minute + span <= window.endMinute; minute += service.slotIntervalMinutes) {
          const startAt = zonedInstant(timeZone, date, minute)
          const startMs = startAt.getTime()
          if (startMs < earliest || startMs > latest) continue
          const endMs = startMs + service.durationMinutes * MINUTE_MS
          const capacity = Math.min(service.capacityPerSlot, resource.concurrency)
          const used = consumedCapacity(
            resource.resourceId,
            startMs,
            startMs + span * MINUTE_MS,
            bookings,
            holds,
            now,
          )
          const remaining = capacity - used
          if (remaining < partySize) continue
          slots.push(Object.freeze({
            startAt: new Date(startMs).toISOString(),
            endAt: new Date(endMs).toISOString(),
            timeZone,
            localStart: localHourMinute(timeZone, startAt),
            localDate: zonedDate(timeZone, startAt),
            resourceId: resource.resourceId,
            remainingCapacity: remaining,
          }))
        }
      }
    }
  }

  slots.sort((left, right) => (
    left.startAt === right.startAt
      ? left.resourceId.localeCompare(right.resourceId)
      : left.startAt.localeCompare(right.startAt)
  ))
  return Object.freeze(slots.slice(0, Math.max(0, maxSlots)))
}

/** True when the span is still open for the requested party size. */
export function spanIsBookable(input: Readonly<{
  service: BookingService
  resource: BookingResource
  workingHours: readonly BookingWorkingHour[]
  exceptions: readonly BookingException[]
  bookings: readonly Booking[]
  holds: readonly BookingHold[]
  timeZone: string
  startAt: Date
  partySize: number
  now: Date
  ignoreBookingId?: string | null
  ignoreHoldId?: string | null
}>): boolean {
  const span = input.service.durationMinutes + input.service.bufferAfterMinutes
  const startMs = input.startAt.getTime()
  const date = zonedDate(input.timeZone, input.startAt)
  const windows = resourceWindows(
    input.resource.resourceId,
    input.timeZone,
    date,
    input.workingHours,
    input.exceptions,
  )
  const startMinute = Math.round(
    (startMs - zonedInstant(input.timeZone, date, 0).getTime()) / MINUTE_MS,
  )
  const insideWindow = windows.some((window) => startMinute >= window.startMinute
    && startMinute + span <= window.endMinute)
  if (!insideWindow) return false
  if (startMinute % input.service.slotIntervalMinutes !== 0) return false

  const nowMs = input.now.getTime()
  if (startMs < nowMs + input.service.minimumNoticeMinutes * MINUTE_MS) return false
  if (startMs > nowMs + input.service.maximumAdvanceDays * DAY_MS) return false

  const bookings = input.bookings.filter((booking) => booking.bookingId !== input.ignoreBookingId)
  const holds = input.holds.filter((hold) => hold.holdId !== input.ignoreHoldId)
  const capacity = Math.min(input.service.capacityPerSlot, input.resource.concurrency)
  const used = consumedCapacity(
    input.resource.resourceId,
    startMs,
    startMs + span * MINUTE_MS,
    bookings,
    holds,
    input.now,
  )
  return capacity - used >= input.partySize
}

/** Cancellation is allowed only outside the service's cancellation window. */
export function cancellationIsAllowed(
  service: BookingService,
  booking: Booking,
  now: Date,
): boolean {
  const start = Date.parse(booking.startAt)
  return start - now.getTime() >= service.cancellationWindowMinutes * MINUTE_MS
}

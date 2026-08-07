/**
 * The month a booking calendar shows.
 *
 * WHY THIS IS BUILT FROM WORKING HOURS AND EXCEPTIONS RATHER THAN FROM BOOKINGS.
 *
 * The dashboard could previously only answer "what is on today" — the snapshot fetched a single date.
 * The question a calendar exists to answer is "when am I open and when am I closed", and that is a
 * different question with different data behind it.
 *
 * Bookings are readable one day at a time (`client.day(serviceId, date)`), so a month of them would be
 * thirty requests — the N+1 that looks fine with a week of data and is unacceptable with a year of it.
 * The catalogue, by contrast, already returns working hours and exceptions FOR A RANGE in one request.
 * So the calendar is built from what one request can honestly provide, and today's bookings are shown
 * alongside because that one day is already fetched.
 *
 * A DAY WITH NO WORKING HOURS IS CLOSED, NOT UNKNOWN. Working hours are declared per weekday, so their
 * absence is a real answer rather than missing data — which is what lets this be drawn without
 * inventing anything.
 */

export type WorkingHour = Readonly<{ resourceId: string, weekday: number, startMinute: number, endMinute: number }>
export type Exception = Readonly<{
  resourceId: string
  date: string
  kind: 'closed' | 'window'
  startMinute: number | null
  endMinute: number | null
  note: string
}>

export type DayState = 'open' | 'closed' | 'adjusted' | 'outside-month'

export type CalendarDay = Readonly<{
  /** ISO date, or null for a leading/trailing cell that squares off the grid. */
  date: string | null
  dayOfMonth: number | null
  state: DayState
  /** Open minutes on this day, so a short day is distinguishable from a full one. */
  openMinutes: number
  /** Why the day differs from its weekday's usual hours, when it does. */
  note: string
}>

/** Days in a month, honouring leap years without a table. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function isoDay(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Weekday index for a date, Sunday = 0, matching the working-hour schema.
 *
 * Computed in UTC deliberately. Using the viewer's local zone would shift the weekday for anybody east
 * or west of the data's own reckoning, so a Monday's hours could be drawn against a Sunday cell — and
 * the calendar would be wrong for exactly the users furthest from the server.
 */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

/**
 * Build one month of cells.
 *
 * Leading and trailing cells are emitted so the grid is rectangular. They carry `outside-month` rather
 * than being drawn as closed days, because a blank square and a closed day mean different things and
 * showing the previous month's Tuesday as "closed" is simply false.
 */
export function buildMonth(
  input: Readonly<{
    year: number
    month: number
    workingHours: readonly WorkingHour[]
    exceptions: readonly Exception[]
  }>,
): readonly CalendarDay[] {
  const total = daysInMonth(input.year, input.month)
  const first = isoDay(input.year, input.month, 1)
  const leading = weekdayOf(first)

  // Open minutes per weekday, summed across resources but capped at a day: two resources open at the
  // same time is one open day, not two. Summing without a cap would report 48 hours and read as a
  // measurement error.
  const byWeekday = new Map<number, number>()
  for (const hour of input.workingHours) {
    const span = Math.max(0, hour.endMinute - hour.startMinute)
    byWeekday.set(hour.weekday, Math.min(1_440, (byWeekday.get(hour.weekday) ?? 0) + span))
  }

  const exceptionsByDate = new Map<string, Exception[]>()
  for (const exception of input.exceptions) {
    const existing = exceptionsByDate.get(exception.date)
    if (existing) existing.push(exception)
    else exceptionsByDate.set(exception.date, [exception])
  }

  const cells: CalendarDay[] = []
  for (let index = 0; index < leading; index += 1) {
    cells.push(Object.freeze({ date: null, dayOfMonth: null, state: 'outside-month' as const, openMinutes: 0, note: '' }))
  }

  for (let day = 1; day <= total; day += 1) {
    const date = isoDay(input.year, input.month, day)
    const usual = byWeekday.get(weekdayOf(date)) ?? 0
    const dayExceptions = exceptionsByDate.get(date) ?? []

    // A 'closed' exception wins over any window on the same day: if one resource is closed and another
    // opens a window, the safest reading for a summary cell is that the day is not normal - and the
    // note says which.
    const closed = dayExceptions.find((exception) => exception.kind === 'closed')
    if (closed) {
      cells.push(Object.freeze({
        date,
        dayOfMonth: day,
        state: 'closed' as const,
        openMinutes: 0,
        note: closed.note,
      }))
      continue
    }

    const windows = dayExceptions.filter((exception) => exception.kind === 'window')
    if (windows.length > 0) {
      const minutes = windows.reduce((total_, window) => (
        total_ + Math.max(0, (window.endMinute ?? 0) - (window.startMinute ?? 0))
      ), 0)
      cells.push(Object.freeze({
        date,
        dayOfMonth: day,
        state: 'adjusted' as const,
        openMinutes: Math.min(1_440, minutes),
        note: windows.find((window) => window.note.length > 0)?.note ?? '',
      }))
      continue
    }

    cells.push(Object.freeze({
      date,
      dayOfMonth: day,
      // No hours declared for this weekday is a real answer, not missing data.
      state: usual > 0 ? ('open' as const) : ('closed' as const),
      openMinutes: usual,
      note: '',
    }))
  }

  // Trailing cells complete the final week so the grid does not end ragged.
  while (cells.length % 7 !== 0) {
    cells.push(Object.freeze({ date: null, dayOfMonth: null, state: 'outside-month' as const, openMinutes: 0, note: '' }))
  }

  return Object.freeze(cells)
}

/** Range to request from the catalogue for a month, inclusive of both ends. */
export function monthRange(year: number, month: number): Readonly<{ fromDate: string, toDate: string }> {
  return Object.freeze({
    fromDate: isoDay(year, month, 1),
    toDate: isoDay(year, month, daysInMonth(year, month)),
  })
}

/**
 * How many bookings fall on a given day.
 *
 * THE DAY IS COMPUTED IN THE BOOKING'S OWN TIME ZONE, not the viewer's. A booking at 23:30 is a
 * different calendar day depending on where you stand, and the day the customer believes they booked is
 * the one in the booking's zone. Grouping by the viewer's local date would move late bookings onto the
 * following day for a viewer further east, so the same calendar would disagree with itself between two
 * staff members.
 *
 * CANCELLED BOOKINGS DO NOT COUNT. A cancelled slot is free, so counting it would show a day as busy
 * that is in fact open — and somebody would decline work they could have taken.
 */
export function bookingsOnDay(
  bookings: readonly Readonly<{ startAt: string, timeZone: string, status: string }>[],
  date: string,
): number {
  return bookings.filter((booking) => {
    if (booking.status === 'cancelled') return false
    return localDateOf(booking.startAt, booking.timeZone) === date
  }).length
}

/** The calendar date an instant falls on, in a named zone. */
export function localDateOf(instant: string, timeZone: string): string {
  const parsed = new Date(instant)
  if (Number.isNaN(parsed.getTime())) return ''
  try {
    // en-CA formats as YYYY-MM-DD, which is the shape the rest of the system uses.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(parsed)
  } catch {
    // An unknown zone must not take the calendar down. UTC is the honest fallback and the only one
    // that does not silently adopt the viewer's zone, which is the wrong answer this exists to avoid.
    return parsed.toISOString().slice(0, 10)
  }
}

/** Human month name for the heading. */
export function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)))
}

export const WEEKDAY_LABELS = Object.freeze(['S', 'M', 'T', 'W', 'T', 'F', 'S'])

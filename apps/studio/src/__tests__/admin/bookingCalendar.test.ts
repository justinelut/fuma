/**
 * The bookings calendar.
 *
 * The dashboard could only answer "what is on today" — the snapshot fetched a single date. A calendar
 * answers "when am I open", which needs a range, and the catalogue already accepts one.
 */
import { describe, expect, it } from 'bun:test'
import {
  bookingsOnDay,
  buildMonth,
  daysInMonth,
  localDateOf,
  monthLabel,
  monthRange,
  weekdayOf,
  type Exception,
  type WorkingHour,
} from '@admin/fuma/bookings/bookingCalendar'

const WEEKDAYS: readonly WorkingHour[] = Object.freeze([
  // Monday to Friday, 9 to 5.
  ...[1, 2, 3, 4, 5].map((weekday) => Object.freeze({
    resourceId: 'r1', weekday, startMinute: 540, endMinute: 1_020,
  })),
])

describe('daysInMonth', () => {
  it('knows month lengths without a table', () => {
    expect(daysInMonth(2026, 1)).toBe(31)
    expect(daysInMonth(2026, 4)).toBe(30)
    expect(daysInMonth(2026, 2)).toBe(28)
  })

  it('handles a leap year', () => {
    expect(daysInMonth(2028, 2)).toBe(29)
  })

  it('handles the century rule', () => {
    // 2100 is not a leap year despite being divisible by four.
    expect(daysInMonth(2100, 2)).toBe(28)
    expect(daysInMonth(2000, 2)).toBe(29)
  })
})

describe('weekdayOf', () => {
  it('is computed in UTC, not the viewer zone', () => {
    // Using the local zone would shift the weekday for viewers east or west of the data's reckoning, so
    // a Monday's hours could be drawn against a Sunday cell.
    expect(weekdayOf('2026-03-01')).toBe(0)
    expect(weekdayOf('2026-03-02')).toBe(1)
    expect(weekdayOf('2026-03-07')).toBe(6)
  })
})

describe('buildMonth', () => {
  it('produces a rectangular grid', () => {
    const cells = buildMonth({ year: 2026, month: 3, workingHours: WEEKDAYS, exceptions: [] })
    expect(cells.length % 7).toBe(0)
  })

  it('pads the start so the first day lands on its weekday', () => {
    // 1 March 2026 is a Sunday, so no leading pad; April starts Wednesday, so three.
    expect(buildMonth({ year: 2026, month: 3, workingHours: [], exceptions: [] })[0]?.dayOfMonth).toBe(1)
    const april = buildMonth({ year: 2026, month: 4, workingHours: [], exceptions: [] })
    expect(april.slice(0, 3).every((cell) => cell.date === null)).toBe(true)
    expect(april[3]?.dayOfMonth).toBe(1)
  })

  it('marks padding as outside-month rather than closed', () => {
    // A blank square and a closed day mean different things; showing the previous month's Tuesday as
    // closed is simply false.
    const april = buildMonth({ year: 2026, month: 4, workingHours: [], exceptions: [] })
    expect(april[0]?.state).toBe('outside-month')
  })

  it('contains every day of the month exactly once', () => {
    const cells = buildMonth({ year: 2026, month: 3, workingHours: WEEKDAYS, exceptions: [] })
    const days = cells.filter((cell) => cell.date !== null).map((cell) => cell.dayOfMonth)
    expect(days).toHaveLength(31)
    expect(new Set(days).size).toBe(31)
  })

  it('a weekday with declared hours is OPEN', () => {
    const cells = buildMonth({ year: 2026, month: 3, workingHours: WEEKDAYS, exceptions: [] })
    // 2 March 2026 is a Monday.
    const monday = cells.find((cell) => cell.date === '2026-03-02')
    expect(monday?.state).toBe('open')
    expect(monday?.openMinutes).toBe(480)
  })

  it('a weekday with NO declared hours is CLOSED, not unknown', () => {
    // Working hours are declared per weekday, so their absence is a real answer rather than missing
    // data - which is what lets this be drawn without inventing anything.
    const cells = buildMonth({ year: 2026, month: 3, workingHours: WEEKDAYS, exceptions: [] })
    const sunday = cells.find((cell) => cell.date === '2026-03-01')
    expect(sunday?.state).toBe('closed')
    expect(sunday?.openMinutes).toBe(0)
  })

  it('caps open minutes at a day when two resources overlap', () => {
    // Two resources open at the same time is ONE open day. Summing without a cap would report 48 hours
    // and read as a measurement error.
    const doubled: WorkingHour[] = [
      { resourceId: 'r1', weekday: 1, startMinute: 0, endMinute: 1_440 },
      { resourceId: 'r2', weekday: 1, startMinute: 0, endMinute: 1_440 },
    ]
    const cells = buildMonth({ year: 2026, month: 3, workingHours: doubled, exceptions: [] })
    expect(cells.find((cell) => cell.date === '2026-03-02')?.openMinutes).toBe(1_440)
  })

  it('a closed exception overrides the usual hours and carries its note', () => {
    const exceptions: Exception[] = [{
      resourceId: 'r1', date: '2026-03-02', kind: 'closed',
      startMinute: null, endMinute: null, note: 'Public holiday',
    }]
    const monday = buildMonth({ year: 2026, month: 3, workingHours: WEEKDAYS, exceptions })
      .find((cell) => cell.date === '2026-03-02')
    expect(monday?.state).toBe('closed')
    expect(monday?.openMinutes).toBe(0)
    expect(monday?.note).toBe('Public holiday')
  })

  it('a window exception reads as ADJUSTED, distinct from both open and closed', () => {
    const exceptions: Exception[] = [{
      resourceId: 'r1', date: '2026-03-02', kind: 'window',
      startMinute: 600, endMinute: 720, note: 'Short day',
    }]
    const monday = buildMonth({ year: 2026, month: 3, workingHours: WEEKDAYS, exceptions })
      .find((cell) => cell.date === '2026-03-02')
    expect(monday?.state).toBe('adjusted')
    expect(monday?.openMinutes).toBe(120)
  })

  it('a CLOSED exception beats a window on the same day', () => {
    // If one resource is closed and another opens a window, the safest reading for a summary cell is
    // that the day is not normal.
    const exceptions: Exception[] = [
      { resourceId: 'r2', date: '2026-03-02', kind: 'window', startMinute: 600, endMinute: 720, note: '' },
      { resourceId: 'r1', date: '2026-03-02', kind: 'closed', startMinute: null, endMinute: null, note: 'Closed' },
    ]
    const monday = buildMonth({ year: 2026, month: 3, workingHours: WEEKDAYS, exceptions })
      .find((cell) => cell.date === '2026-03-02')
    expect(monday?.state).toBe('closed')
  })

  it('an exception for another month does not leak in', () => {
    const exceptions: Exception[] = [{
      resourceId: 'r1', date: '2026-04-02', kind: 'closed',
      startMinute: null, endMinute: null, note: 'Next month',
    }]
    const cells = buildMonth({ year: 2026, month: 3, workingHours: WEEKDAYS, exceptions })
    expect(cells.every((cell) => cell.note !== 'Next month')).toBe(true)
  })

  it('everything is closed when no hours are declared at all', () => {
    const cells = buildMonth({ year: 2026, month: 3, workingHours: [], exceptions: [] })
    const real = cells.filter((cell) => cell.date !== null)
    expect(real.every((cell) => cell.state === 'closed')).toBe(true)
  })
})

describe('monthRange', () => {
  it('covers the whole month inclusively', () => {
    expect(monthRange(2026, 3)).toEqual({ fromDate: '2026-03-01', toDate: '2026-03-31' })
    expect(monthRange(2028, 2)).toEqual({ fromDate: '2028-02-01', toDate: '2028-02-29' })
  })
})

describe('localDateOf', () => {
  it('resolves the calendar day in the given zone', () => {
    // 22:30 UTC is already the next day in Nairobi (+03:00).
    expect(localDateOf('2026-03-02T22:30:00Z', 'Africa/Nairobi')).toBe('2026-03-03')
    expect(localDateOf('2026-03-02T22:30:00Z', 'UTC')).toBe('2026-03-02')
  })

  it('falls back to UTC for an unknown zone rather than throwing', () => {
    // An unknown zone must not take the calendar down, and UTC is the only fallback that does not
    // silently adopt the viewer's zone.
    expect(localDateOf('2026-03-02T10:00:00Z', 'Not/AZone')).toBe('2026-03-02')
  })

  it('returns empty for an unparseable instant', () => {
    expect(localDateOf('not-a-date', 'UTC')).toBe('')
  })
})

describe('bookingsOnDay', () => {
  const bookings = [
    { startAt: '2026-03-02T10:00:00Z', timeZone: 'UTC', status: 'confirmed' },
    { startAt: '2026-03-02T14:00:00Z', timeZone: 'UTC', status: 'completed' },
    { startAt: '2026-03-03T09:00:00Z', timeZone: 'UTC', status: 'confirmed' },
  ]

  it('counts only the requested day', () => {
    expect(bookingsOnDay(bookings, '2026-03-02')).toBe(2)
    expect(bookingsOnDay(bookings, '2026-03-03')).toBe(1)
    expect(bookingsOnDay(bookings, '2026-03-04')).toBe(0)
  })

  it('does NOT count a cancelled booking', () => {
    // A cancelled slot is free, so counting it would show a day as busy that is in fact open - and
    // somebody would decline work they could have taken.
    const withCancellation = [
      ...bookings,
      { startAt: '2026-03-02T16:00:00Z', timeZone: 'UTC', status: 'cancelled' },
    ]
    expect(bookingsOnDay(withCancellation, '2026-03-02')).toBe(2)
  })

  it('uses the BOOKING\'S zone, not the viewer\'s', () => {
    // 23:30 UTC is the 3rd in Nairobi, and that is the day the customer believes they booked. Grouping
    // by the viewer's date would move it and the calendar would disagree with itself between two staff.
    const late = [{ startAt: '2026-03-02T23:30:00Z', timeZone: 'Africa/Nairobi', status: 'confirmed' }]
    expect(bookingsOnDay(late, '2026-03-03')).toBe(1)
    expect(bookingsOnDay(late, '2026-03-02')).toBe(0)
  })

  it('counts nothing for an empty list', () => {
    expect(bookingsOnDay([], '2026-03-02')).toBe(0)
  })
})

describe('monthLabel', () => {
  it('names the month and year', () => {
    expect(monthLabel(2026, 3)).toBe('March 2026')
  })
})

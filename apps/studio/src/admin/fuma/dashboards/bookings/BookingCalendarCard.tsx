/**
 * The bookings calendar card.
 *
 * Answers "when am I open" rather than only "what is on today", which is all the dashboard could show
 * before. Built strictly from the month model, so what it draws is what the catalogue actually declares.
 */
import { Card, CardCaption, CardTitle } from '../../ui/primitives'
import { cn } from '../../ui/cn'
import { GROUP, RELATED_GAP, TIGHT } from '../../ui/rhythm'
import {
  WEEKDAY_LABELS,
  buildMonth,
  monthLabel,
  type Exception,
  type WorkingHour,
} from '../../bookings/bookingCalendar'

export interface BookingCalendarCardProps {
  year: number
  month: number
  workingHours: readonly WorkingHour[]
  exceptions: readonly Exception[]
  /** Today's ISO date, so the current day is marked without the component reading the clock. */
  today: string | null
  /** Bookings on today only, which is the one day already fetched. */
  todayBookings: number | null
}

function hoursLabel(minutes: number): string {
  if (minutes === 0) return 'Closed'
  const hours = minutes / 60
  return `${hours % 1 === 0 ? hours : hours.toFixed(1)}h open`
}

export function BookingCalendarCard({
  year,
  month,
  workingHours,
  exceptions,
  today,
  todayBookings,
}: BookingCalendarCardProps) {
  const cells = buildMonth({ year, month, workingHours, exceptions })
  const openDays = cells.filter((cell) => cell.state === 'open' || cell.state === 'adjusted').length

  return (
    <Card>
      <div className={cn('flex flex-wrap items-baseline justify-between', RELATED_GAP)}>
        <CardTitle>{monthLabel(year, month)}</CardTitle>
        <CardCaption>
          {/* Stated rather than left to be counted off the grid, which is what somebody would otherwise
              do to answer the only question this card is for. */}
          {openDays === 0 ? 'No open days this month' : `${openDays} open days`}
        </CardCaption>
      </div>

      <div className={cn('grid grid-cols-7 gap-1', GROUP)} role="grid" aria-label={`${monthLabel(year, month)} availability`}>
        {WEEKDAY_LABELS.map((label, index) => (
          <div
            key={`heading-${index}`}
            role="columnheader"
            className="pb-1 text-center text-[0.625rem] text-muted-foreground"
          >
            {label}
          </div>
        ))}

        {cells.map((cell, index) => {
          if (cell.date === null) {
            // A blank square, not a closed day: showing the previous month's Tuesday as closed is false.
            return <div key={`blank-${index}`} role="gridcell" aria-hidden="true" className="aspect-square" />
          }
          const isToday = today === cell.date
          return (
            <div
              key={cell.date}
              role="gridcell"
              aria-current={isToday ? 'date' : undefined}
              // The full state is in the accessible name, because colour alone is not a label and this
              // grid is otherwise a wall of numbers.
              aria-label={`${cell.date}: ${cell.state === 'closed' ? 'closed' : hoursLabel(cell.openMinutes)}${cell.note ? `. ${cell.note}` : ''}`}
              title={cell.note || undefined}
              className={cn(
                'grid aspect-square place-items-center rounded-md border text-[0.6875rem] transition-colors',
                cell.state === 'closed'
                  ? 'border-border/60 bg-muted/40 text-muted-foreground/60'
                  : cell.state === 'adjusted'
                    ? 'border-primary/40 bg-primary/10 text-foreground'
                    : 'border-border bg-card text-foreground',
                isToday ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : '',
              )}
            >
              <span className="tabular-nums">{cell.dayOfMonth}</span>
            </div>
          )
        })}
      </div>

      <dl className={cn('flex flex-wrap items-baseline', RELATED_GAP, GROUP)}>
        <div>
          <dt className="text-xs text-muted-foreground">Booked today</dt>
          <dd className={cn('text-sm font-medium text-foreground', TIGHT)}>
            {/* Null is not zero: zero claims we looked and found none. */}
            {todayBookings === null ? 'Not measured' : todayBookings}
          </dd>
        </div>
        <p className="text-[0.6875rem] leading-snug text-muted-foreground">
          Availability comes from working hours and exceptions. A day with no hours declared is closed.
        </p>
      </dl>
    </Card>
  )
}

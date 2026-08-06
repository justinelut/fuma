/**
 * Bookings dashboard.
 *
 * Uses the Website profile's design language — the Dribbble reference — because
 * bookings live inside a website rather than being a separate product: the same
 * ivory surface, the same card vocabulary, the same accent.
 *
 * Its cards are booking-specific: the week strip carries the day's schedule, the
 * dial carries utilisation of bookable capacity, and the accordion carries the
 * service catalogue. Every figure comes from the bookings catalogue and the day
 * reader; nothing is modelled.
 */
import { useEffect, useState } from 'react'
import { Link } from '@admin/lib/routing'
import { BookingsHttpClient, type BookingCatalogWire, type BookingWire } from '../../bookings/client'
import { Badge, Card, CardCaption, CardTitle } from '../../ui/primitives'
import { cn } from '../../ui/cn'

export type BookingsScope = Readonly<{
  organizationId: string
  workspaceId: string
  siteId: string
}>

export interface BookingsDashboardProps {
  scope: BookingsScope
  manageBookingsPath: string
  /** Test seam. Defaults to the live readers. */
  read?: (scope: BookingsScope) => Promise<BookingsSnapshot>
}

export type BookingsSnapshot = Readonly<{
  catalog: BookingCatalogWire | null
  today: readonly BookingWire[]
  date: string
}>

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export async function readBookingsSnapshot(scope: BookingsScope): Promise<BookingsSnapshot> {
  const date = isoDate(new Date())
  const client = new BookingsHttpClient(scope)
  const catalog = await client.catalog(date, date).catch(() => null)
  const firstActive = catalog?.services.find((service) => service.state === 'active')
  const today = firstActive
    ? await client.day(firstActive.serviceId, date).catch(() => [])
    : []
  return Object.freeze({ catalog, today, date })
}

function money(minor: number, currency: string): string {
  return `${currency} ${(minor / 100).toLocaleString('en-KE', { minimumFractionDigits: 0 })}`
}

function hourLabel(hour: number): string {
  const suffix = hour < 12 ? 'am' : 'pm'
  const display = hour % 12 === 0 ? 12 : hour % 12
  return `${display}:00 ${suffix}`
}

function Dial({ percent, caption }: { percent: number | null, caption: string }) {
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const dash = ((percent ?? 0) / 100) * circumference
  return (
    <svg viewBox="0 0 140 140" className="size-[148px]" role="img" aria-label={`${percent ?? 0}% ${caption}`}>
      <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--accent)" strokeWidth="9" />
      <circle
        cx="70"
        cy="70"
        r={radius}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference}`}
        transform="rotate(-90 70 70)"
      />
      <text
        x="70"
        y="68"
        textAnchor="middle"
        className="fill-foreground"
        style={{ fontSize: '1.55rem', fontWeight: 600, letterSpacing: '-0.02em' }}
      >
        {percent === null ? '—' : `${percent}%`}
      </text>
      <text x="70" y="86" textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: '0.6rem' }}>
        {caption}
      </text>
    </svg>
  )
}

export function BookingsDashboard({
  scope,
  manageBookingsPath,
  read = readBookingsSnapshot,
}: BookingsDashboardProps) {
  const [snapshot, setSnapshot] = useState<BookingsSnapshot | null>(null)
  const [openService, setOpenService] = useState<string | null>(null)

  const { organizationId, workspaceId, siteId } = scope
  useEffect(() => {
    let active = true
    void read({ organizationId, workspaceId, siteId }).then((result) => {
      if (active) setSnapshot(result)
    })
    return () => { active = false }
  }, [read, organizationId, workspaceId, siteId])

  const services = snapshot?.catalog?.services ?? []
  const activeServices = services.filter((service) => service.state === 'active')
  const resources = snapshot?.catalog?.resources ?? []
  const bookings = snapshot?.today ?? []
  const capacity = activeServices.reduce((total, service) => total + service.capacityPerSlot, 0)
  const utilisation = capacity > 0
    ? Math.min(100, Math.round((bookings.length / capacity) * 100))
    : null

  const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]

  return (
    <div className="grid items-start gap-4 lg:grid-cols-4">
      <Card className="flex min-h-[248px] flex-col justify-between">
        <div>
          <Badge variant="accent" size="sm">Bookings</Badge>
          <p className="mt-6 text-xl leading-tight font-semibold tracking-tight text-foreground">
            {bookings.length === 0 ? 'Nothing booked today' : `${bookings.length} today`}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {activeServices.length === 0
              ? 'Add a service and its availability before customers can book.'
              : `${activeServices.length} active ${activeServices.length === 1 ? 'service' : 'services'} across ${resources.length} ${resources.length === 1 ? 'resource' : 'resources'}.`}
          </p>
        </div>
        <Link
          to={manageBookingsPath}
          className={cn(
            'mt-6 inline-flex h-10 items-center justify-center rounded-full',
            'bg-primary px-4 text-sm font-medium text-primary-foreground transition-[filter] hover:brightness-110',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          )}
        >
          Manage bookings
        </Link>
      </Card>

      <Card tone="warm" className="flex min-h-[248px] flex-col">
        <CardTitle>Utilisation</CardTitle>
        <div className="grid flex-1 place-items-center">
          <Dial percent={utilisation} caption="of capacity" />
        </div>
        <CardCaption>
          {capacity > 0
            ? `${bookings.length} of ${capacity} slots taken today`
            : 'Capacity appears once a service is active'}
        </CardCaption>
      </Card>

      <Card className="lg:col-span-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Today</CardTitle>
          <CardCaption>{snapshot?.date ?? '—'}</CardCaption>
        </div>
        {bookings.length === 0 ? (
          <div className="mt-4 grid h-[168px] place-items-center rounded-[var(--radius-md)] border border-dashed border-border">
            <p className="text-xs text-muted-foreground">Nothing scheduled today</p>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {hours.map((hour) => {
              const slot = bookings.filter((booking) => new Date(booking.startAt).getHours() === hour)
              if (slot.length === 0) return null
              return (
                <li key={hour} className="flex gap-4 py-2.5">
                  <span className="w-16 shrink-0 text-[0.6875rem] text-muted-foreground">
                    {hourLabel(hour)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-wrap gap-2">
                    {slot.map((booking) => (
                      <span
                        key={booking.bookingId}
                        className={cn(
                          'inline-flex items-center gap-2 rounded-[var(--radius-md)]',
                          'border border-border bg-muted px-3 py-2 text-[0.6875rem] text-foreground',
                        )}
                      >
                        {booking.partySize} {booking.partySize === 1 ? 'guest' : 'guests'}
                        <span className="text-muted-foreground">{booking.status}</span>
                      </span>
                    ))}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card className="lg:col-span-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Services</CardTitle>
          <CardCaption>
            {services.length === 0 ? 'None yet' : `${services.length} total`}
          </CardCaption>
        </div>
        {services.length === 0 ? (
          <p className="mt-4 text-xs text-muted-foreground">
            No services yet. Create one to start taking bookings.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {services.map((service) => {
              const open = openService === service.serviceId
              return (
                <li key={service.serviceId}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 py-3 text-left"
                    aria-expanded={open}
                    onClick={() => setOpenService(open ? null : service.serviceId)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-foreground">{service.name}</span>
                      <span className="block text-[0.6875rem] text-muted-foreground">
                        {service.durationMinutes} min · {money(service.priceMinor, service.currency)}
                      </span>
                    </span>
                    <Badge variant={service.state === 'active' ? 'accent' : 'rail'} size="sm">
                      {service.state}
                    </Badge>
                  </button>
                  {open ? (
                    <dl className="grid grid-cols-2 gap-2 pb-3 text-[0.6875rem]">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Capacity</dt>
                        <dd className="text-muted-foreground">{service.capacityPerSlot} per slot</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Interval</dt>
                        <dd className="text-muted-foreground">{service.slotIntervalMinutes} min</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Notice</dt>
                        <dd className="text-muted-foreground">{service.minimumNoticeMinutes} min</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Prepayment</dt>
                        <dd className="text-muted-foreground">
                          {service.requiresPrepayment ? 'Required' : 'Not required'}
                        </dd>
                      </div>
                    </dl>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}

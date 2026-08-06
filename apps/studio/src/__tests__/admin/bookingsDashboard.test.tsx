import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from '@admin/lib/routing'
import {
  BookingsDashboard,
  type BookingsSnapshot,
} from '@admin/fuma/dashboards/bookings/BookingsDashboard'

const SCOPE = Object.freeze({
  organizationId: 'organization-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
})

function service(overrides: Record<string, unknown> = {}) {
  return {
    serviceId: 'service-cut',
    slug: 'haircut',
    name: 'Haircut',
    description: '',
    category: 'salon',
    durationMinutes: 45,
    bufferAfterMinutes: 10,
    capacityPerSlot: 4,
    slotIntervalMinutes: 30,
    minimumNoticeMinutes: 60,
    maximumAdvanceDays: 30,
    cancellationWindowMinutes: 120,
    priceMinor: 250000,
    currency: 'KES',
    requiresPrepayment: true,
    state: 'active',
    ...overrides,
  }
}

function snapshot(overrides: Partial<BookingsSnapshot> = {}): BookingsSnapshot {
  return Object.freeze({
    catalog: null,
    today: [],
    date: '2026-08-06',
    ...overrides,
  }) as BookingsSnapshot
}

function renderDashboard(result: BookingsSnapshot) {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <BookingsDashboard
        scope={SCOPE}
        manageBookingsPath="/admin/bookings/manage"
        read={() => Promise.resolve(result)}
      />
    </MemoryRouter>,
  )
}

describe('bookings dashboard', () => {
  afterEach(cleanup)

  it('asks for a service before claiming any capacity', async () => {
    renderDashboard(snapshot())
    await waitFor(() => {
      expect(screen.getByText('Nothing booked today')).toBeDefined()
    })
    expect(screen.getByText('Add a service and its availability before customers can book.')).toBeDefined()
    expect(screen.getByText('Capacity appears once a service is active')).toBeDefined()
    expect(screen.getByText('No services yet. Create one to start taking bookings.')).toBeDefined()
    expect(screen.getByText('Nothing scheduled today')).toBeDefined()
  })

  it('derives utilisation from real bookings against real capacity', async () => {
    renderDashboard(snapshot({
      catalog: {
        services: [service(), service({
          serviceId: 'service-colour',
          name: 'Colour',
          capacityPerSlot: 1,
          durationMinutes: 90,
          priceMinor: 600000,
        })],
        locations: [],
        resources: [{ resourceId: 'resource-1' }],
        workingHours: [],
        exceptions: [],
      } as unknown as BookingsSnapshot['catalog'],
      today: [
        {
          bookingId: 'booking-1',
          reference: 'BK-000001',
          serviceId: 'service-cut',
          resourceId: 'resource-1',
          locationId: 'location-1',
          startAt: '2026-08-06T09:30:00.000Z',
          endAt: '2026-08-06T10:15:00.000Z',
          timeZone: 'Africa/Nairobi',
          status: 'confirmed',
          customer: { name: 'A', email: 'a@example.com' },
          intake: [],
          partySize: 2,
        },
      ] as unknown as BookingsSnapshot['today'],
    }))

    await waitFor(() => {
      expect(screen.getByText('1 today')).toBeDefined()
    })
    // One booking against five bookable slots across two active services.
    expect(screen.getByText('20%')).toBeDefined()
    expect(screen.getByText('1 of 5 slots taken today')).toBeDefined()
    expect(screen.getByText('2 guests')).toBeDefined()
    expect(screen.getByText('Haircut')).toBeDefined()
    expect(screen.getByText('45 min · KES 2,500')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Manage bookings' }).getAttribute('href'))
      .toBe('/admin/bookings/manage')
  })
})

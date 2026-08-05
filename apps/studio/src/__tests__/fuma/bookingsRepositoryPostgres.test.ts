import { describe, expect, test } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import { bookingsAuthorityMigration } from '../../../server/fuma/db/migrations/000081_bookings_authority'
import { PostgresBookingRepository } from '../../../server/fuma/bookings/postgres'
import {
  BookingLifecycleService,
  BookingServiceError,
  type BookingScope,
} from '../../../server/fuma/bookings/service'
import type { BookingIdentityPort } from '../../../server/fuma/bookings/service'

/**
 * Proves `PostgresBookingRepository` against native PostgreSQL.
 *
 * The memory repository already has domain coverage, so what matters here is
 * everything memory cannot prove: real SQL, real constraints, real fencing, and
 * the driver quirks that only appear against a live server. The final test runs
 * the unmodified `BookingLifecycleService` on top of the PostgreSQL adapter, so
 * a passing suite means the composition works rather than only the SQL.
 */

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL

function quote(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe PostgreSQL schema identifier.')
  return `"${value}"`
}

function scoped(connection: string, schema: string): string {
  const url = new URL(connection)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}

const scope: BookingScope = Object.freeze({
  organizationId: 'org-1',
  workspaceId: 'ws-1',
  siteId: 'site-1',
})

/** A second tenant sharing every surrogate id, to prove scope isolation. */
const otherScope: BookingScope = Object.freeze({
  organizationId: 'org-2',
  workspaceId: 'ws-1',
  siteId: 'site-1',
})

class SequentialIdentity implements BookingIdentityPort {
  #n = 0
  bookingId(): string { this.#n += 1; return `bk-${this.#n}` }
  holdId(): string { this.#n += 1; return `hd-${this.#n}` }
  eventId(): string { this.#n += 1; return `ev-${this.#n}` }
  reminderId(): string { this.#n += 1; return `rm-${this.#n}` }
  reference(): string { this.#n += 1; return `REF-${String(this.#n).padStart(4, '0')}` }
}

async function seed(db: Awaited<ReturnType<typeof createPostgresClient>>): Promise<void> {
  await db.unsafe(bookingsAuthorityMigration.sql)
  for (const org of ['org-1', 'org-2']) {
    await db.unsafe(
      `insert into fuma_booking_locations_v1 values
        ($1,'ws-1','site-1','loc-1','Studio','Europe/London','12 High St','London','GB',null,'active',now(),now())`,
      [org],
    )
    await db.unsafe(
      `insert into fuma_booking_services_v1 values
        ($1,'ws-1','site-1','svc-1','haircut','Haircut','A cut','salon',
         60,0,1,60,0,30,120,250000,'KES',false,'active',now(),now())`,
      [org],
    )
    await db.unsafe(
      `insert into fuma_booking_resources_v1 values
        ($1,'ws-1','site-1','res-1','Asha','staff','loc-1',1,'active',now(),now())`,
      [org],
    )
    await db.unsafe(
      `insert into fuma_booking_resource_services_v1 values ($1,'ws-1','site-1','res-1','svc-1')`,
      [org],
    )
    // Open 09:00-17:00 every weekday.
    for (const weekday of [1, 2, 3, 4, 5]) {
      await db.unsafe(
        `insert into fuma_booking_working_hours_v1 values ($1,'ws-1','site-1','res-1',$2,540,1020)`,
        [org, weekday],
      )
    }
  }
}

async function withSchema(
  run: (db: Awaited<ReturnType<typeof createPostgresClient>>) => Promise<void>,
): Promise<void> {
  if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
  const admin = createPostgresClient(postgresUrl)
  const schema = `bk_repo_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
  await admin.unsafe(`create schema ${quote(schema)}`)
  const db = createPostgresClient(scoped(postgresUrl, schema))
  try {
    await seed(db)
    await run(db)
  } finally {
    await db.close?.()
    await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`).catch(() => {})
    await admin.close?.()
  }
}

describe('PostgresBookingRepository', () => {
  test.skipIf(!postgresUrl)('reads seeded services, locations and resources with aggregated service ids', async () => {
    await withSchema(async (db) => {
      const repository = new PostgresBookingRepository(db)

      const services = await repository.listServices(scope)
      expect(services).toHaveLength(1)
      expect(services[0]!.slug).toBe('haircut')
      expect(services[0]!.durationMinutes).toBe(60)
      expect(services[0]!.currency).toBe('KES')
      expect(services[0]!.requiresPrepayment).toBe(false)

      const service = await repository.getService(scope, 'svc-1')
      expect(service?.serviceId).toBe('svc-1')
      expect(await repository.getService(scope, 'absent')).toBeNull()

      const location = await repository.getLocation(scope, 'loc-1')
      expect(location?.timeZone).toBe('Europe/London')
      expect(location?.country).toBe('GB')
      expect(location?.mapUrl).toBeNull()

      // `serviceIds` must be aggregated from the join table, not left empty.
      const resources = await repository.listResources(scope, 'svc-1')
      expect(resources).toHaveLength(1)
      expect(resources[0]!.serviceIds).toEqual(['svc-1'])
      expect(resources[0]!.concurrency).toBe(1)

      const resource = await repository.getResource(scope, 'res-1')
      expect(resource?.serviceIds).toEqual(['svc-1'])

      // A service nothing serves must yield no resources rather than all of them.
      expect(await repository.listResources(scope, 'svc-absent')).toEqual([])
    })
  })

  test.skipIf(!postgresUrl)('binds id lists as parameters, including the empty case', async () => {
    await withSchema(async (db) => {
      const repository = new PostgresBookingRepository(db)

      const hours = await repository.listWorkingHours(scope, ['res-1'])
      expect(hours).toHaveLength(5)
      expect(hours[0]).toEqual({ resourceId: 'res-1', weekday: 1, startMinute: 540, endMinute: 1020 })

      // An empty list must short-circuit: `in ()` is a syntax error in PostgreSQL.
      expect(await repository.listWorkingHours(scope, [])).toEqual([])
      expect(await repository.listActiveHolds(scope, [])).toEqual([])
      expect(await repository.listExceptions(scope, [], '2026-03-01', '2026-03-31')).toEqual([])
      expect(await repository.listBookingsInRange(scope, [], '2026-03-01T00:00:00Z', '2026-03-31T00:00:00Z')).toEqual([])

      // A quote in an id must be bound, never interpolated.
      expect(await repository.listWorkingHours(scope, ["res-1'; drop table fuma_bookings_v1; --"]))
        .toEqual([])
      const stillThere = await db.unsafe(`select count(*)::int as n from fuma_bookings_v1`)
      expect((stillThere.rows[0] as { n: number }).n).toBe(0)
    })
  })

  test.skipIf(!postgresUrl)('returns dated exceptions as plain calendar dates', async () => {
    await withSchema(async (db) => {
      const repository = new PostgresBookingRepository(db)
      await db.unsafe(
        `insert into fuma_booking_exceptions_v1 values
          ('org-1','ws-1','site-1','res-1','exc-1','2026-03-04','closed',null,null,'Holiday')`,
      )
      await db.unsafe(
        `insert into fuma_booking_exceptions_v1 values
          ('org-1','ws-1','site-1','res-1','exc-2','2026-03-05','window',600,720,'Short day')`,
      )

      const found = await repository.listExceptions(scope, ['res-1'], '2026-03-01', '2026-03-31')
      expect(found).toHaveLength(2)
      // A DATE column must not leak a timestamp or a timezone-shifted day.
      expect(found[0]!.date).toBe('2026-03-04')
      expect(found[0]!.kind).toBe('closed')
      expect(found[0]!.startMinute).toBeNull()
      expect(found[1]!.date).toBe('2026-03-05')
      expect(found[1]!.startMinute).toBe(600)

      // Range filtering is inclusive on both ends and excludes outside dates.
      expect(await repository.listExceptions(scope, ['res-1'], '2026-03-05', '2026-03-05'))
        .toHaveLength(1)
      expect(await repository.listExceptions(scope, ['res-1'], '2026-04-01', '2026-04-30'))
        .toEqual([])
    })
  })

  test.skipIf(!postgresUrl)('translates the live-hold unique index into slot-unavailable', async () => {
    await withSchema(async (db) => {
      const repository = new PostgresBookingRepository(db)
      // The expiry must be genuinely in the future, otherwise this exercises the
      // self-heal path rather than live contention.
      const hold = {
        holdId: 'hd-1',
        serviceId: 'svc-1',
        resourceId: 'res-1',
        startAt: '2026-03-02T09:00:00.000Z',
        endAt: '2026-03-02T10:00:00.000Z',
        expiresAt: '2036-01-01T00:00:00.000Z',
        fence: 1,
        state: 'held' as const,
      }
      await repository.insertHold(scope, hold)

      // A second caller racing for the identical slot must get the domain error,
      // not a raw driver error.
      const clash = repository.insertHold(scope, { ...hold, holdId: 'hd-2' })
      await expect(clash).rejects.toBeInstanceOf(BookingServiceError)
      await clash.catch((error: unknown) => {
        expect((error as BookingServiceError).code).toBe('slot-unavailable')
      })

      // Releasing the first frees the slot for the second.
      expect(await repository.transitionHold(scope, 'hd-1', 1, 'released')).toBe(true)
      await repository.insertHold(scope, { ...hold, holdId: 'hd-2' })
      expect(await repository.listActiveHolds(scope, ['res-1'])).toHaveLength(1)

      // The same slot in another tenant is unaffected.
      await repository.insertHold(otherScope, hold)
      expect(await repository.listActiveHolds(otherScope, ['res-1'])).toHaveLength(1)
    })
  })

  test.skipIf(!postgresUrl)('fences hold transitions atomically', async () => {
    await withSchema(async (db) => {
      const repository = new PostgresBookingRepository(db)
      await repository.insertHold(scope, {
        holdId: 'hd-1',
        serviceId: 'svc-1',
        resourceId: 'res-1',
        startAt: '2026-03-02T09:00:00.000Z',
        endAt: '2026-03-02T10:00:00.000Z',
        expiresAt: '2026-03-02T08:10:00.000Z',
        fence: 1,
        state: 'held',
      })

      // Wrong fence loses.
      expect(await repository.transitionHold(scope, 'hd-1', 7, 'redeemed')).toBe(false)
      // Unknown hold loses.
      expect(await repository.transitionHold(scope, 'absent', 1, 'redeemed')).toBe(false)
      // Another tenant cannot move this hold.
      expect(await repository.transitionHold(otherScope, 'hd-1', 1, 'redeemed')).toBe(false)

      // Correct fence wins exactly once, and the fence advances.
      expect(await repository.transitionHold(scope, 'hd-1', 1, 'redeemed')).toBe(true)
      expect(await repository.transitionHold(scope, 'hd-1', 1, 'redeemed')).toBe(false)
      const after = await repository.getHold(scope, 'hd-1')
      expect(after?.state).toBe('redeemed')
      expect(after?.fence).toBe(2)

      // A redeemed hold is no longer active.
      expect(await repository.listActiveHolds(scope, ['res-1'])).toEqual([])
    })
  })

  test.skipIf(!postgresUrl)('keeps booking events append-only', async () => {
    await withSchema(async (db) => {
      const repository = new PostgresBookingRepository(db)
      await repository.appendEvent(scope, {
        eventId: 'ev-1',
        bookingId: null,
        holdId: 'hd-1',
        kind: 'held',
        occurredAt: '2026-03-02T08:00:00.000Z',
        detail: 'hold 10m',
      })
      await expect(db.unsafe(`update fuma_booking_events_v1 set detail='x'`)).rejects.toThrow()
      await expect(db.unsafe(`delete from fuma_booking_events_v1`)).rejects.toThrow()
      const rows = await db.unsafe(`select count(*)::int as n from fuma_booking_events_v1`)
      expect((rows.rows[0] as { n: number }).n).toBe(1)
    })
  })

  test.skipIf(!postgresUrl)('does not let an expired hold permanently lock a slot', async () => {
    await withSchema(async (db) => {
      const repository = new PostgresBookingRepository(db)
      // A hold whose TTL passed but which no sweeper ever transitioned. The
      // live-hold index is partial on state='held', so without self-healing this
      // slot would be advertised as free and refuse every booking forever.
      await db.unsafe(
        `insert into fuma_booking_holds_v1 values
          ('org-1','ws-1','site-1','stale','svc-1','res-1',
           '2026-03-09T09:00:00Z','2026-03-09T10:00:00Z','2020-01-01T00:00:00Z',1,'held',now())`,
      )

      await repository.insertHold(scope, {
        holdId: 'fresh',
        serviceId: 'svc-1',
        resourceId: 'res-1',
        startAt: '2026-03-09T09:00:00.000Z',
        endAt: '2026-03-09T10:00:00.000Z',
        expiresAt: '2036-01-01T00:00:00.000Z',
        fence: 1,
        state: 'held',
      })

      expect((await repository.getHold(scope, 'stale'))?.state).toBe('expired')
      expect((await repository.getHold(scope, 'fresh'))?.state).toBe('held')
      const live = await repository.listActiveHolds(scope, ['res-1'])
      expect(live.map((entry) => entry.holdId)).toEqual(['fresh'])

      // A still-live hold is never displaced by a newcomer.
      const clash = repository.insertHold(scope, {
        holdId: 'newcomer',
        serviceId: 'svc-1',
        resourceId: 'res-1',
        startAt: '2026-03-09T09:00:00.000Z',
        endAt: '2026-03-09T10:00:00.000Z',
        expiresAt: '2036-01-01T00:00:00.000Z',
        fence: 1,
        state: 'held',
      })
      await expect(clash).rejects.toBeInstanceOf(BookingServiceError)
    })
  })

  test.skipIf(!postgresUrl)('sweeps elapsed holds and reports which moved', async () => {
    await withSchema(async (db) => {
      const repository = new PostgresBookingRepository(db)
      for (const [id, expires, hour] of [
        ['past-1', '2020-01-01T00:00:00Z', '09'],
        ['past-2', '2020-01-02T00:00:00Z', '11'],
        ['future', '2036-01-01T00:00:00Z', '13'],
      ] as const) {
        await db.unsafe(
          `insert into fuma_booking_holds_v1 values
            ('org-1','ws-1','site-1',$1,'svc-1','res-1',
             $2::timestamptz, $3::timestamptz, $4::timestamptz, 1,'held', now())`,
          [id, `2026-03-09T${hour}:00:00Z`, `2026-03-09T${hour}:30:00Z`, expires],
        )
      }

      const swept = await repository.expireElapsedHolds(scope)
      expect(swept.map((entry) => entry.holdId).sort()).toEqual(['past-1', 'past-2'])
      // Idempotent: a second sweep finds nothing left to do.
      expect(await repository.expireElapsedHolds(scope)).toEqual([])
      expect((await repository.getHold(scope, 'future'))?.state).toBe('held')
      expect(await repository.expireElapsedHolds(otherScope)).toEqual([])
      await expect(repository.expireElapsedHolds(scope, 0)).rejects.toBeInstanceOf(RangeError)
    })
  })

  test.skipIf(!postgresUrl)('runs the real lifecycle service end to end on PostgreSQL', async () => {
    await withSchema(async (db) => {
      const repository = new PostgresBookingRepository(db)
      // A weekday inside the seeded working hours. The slot is a week out so the
      // 24-hour reminder lead still lands in the future — booking a slot only
      // hours away is correctly given no reminder at all.
      const now = new Date('2026-03-02T06:00:00.000Z')
      const bookingDate = '2026-03-09'
      const service = new BookingLifecycleService({
        repository,
        identity: new SequentialIdentity(),
        now: () => now,
      })

      const availability = await service.availability(scope, {
        serviceId: 'svc-1',
        fromDate: bookingDate,
        toDate: bookingDate,
        partySize: 1,
      })
      expect(availability.length).toBeGreaterThan(0)
      const slot = availability[0]!
      expect(slot.timeZone).toBe('Europe/London')
      expect(slot.localDate).toBe(bookingDate)

      const hold = await service.hold(scope, {
        serviceId: 'svc-1',
        resourceId: 'res-1',
        startAt: slot.startAt,
        partySize: 1,
      })
      expect(hold.state).toBe('held')

      // That slot must now be gone from availability.
      const afterHold = await service.availability(scope, {
        serviceId: 'svc-1',
        fromDate: bookingDate,
        toDate: bookingDate,
        partySize: 1,
      })
      expect(afterHold.some((entry) => entry.startAt === slot.startAt)).toBe(false)

      const booking = await service.book(scope, {
        holdId: hold.holdId,
        fence: hold.fence,
        customer: {
          name: 'Ada Nyong',
          email: 'ada@example.com',
          phone: null,
          notes: '',
        },
        requestKey: 'request-key-0001',
      })
      expect(booking.status).toBe('confirmed')
      expect(booking.startAt).toBe(slot.startAt)

      // It is durable.
      const stored = await repository.getBooking(scope, booking.bookingId)
      expect(stored?.reference).toBe(booking.reference)
      expect(stored?.customer.email).toBe('ada@example.com')
      expect(stored?.intake).toEqual([])

      // Confirmation is idempotent on the request key.
      const replay = await service.book(scope, {
        holdId: hold.holdId,
        fence: hold.fence,
        customer: {
          name: 'Ada Nyong',
          email: 'ada@example.com',
          phone: null,
          notes: '',
        },
        requestKey: 'request-key-0001',
      })
      expect(replay.bookingId).toBe(booking.bookingId)

      // A reminder was scheduled and the hold was consumed.
      expect(await repository.listReminders(scope, booking.bookingId)).toHaveLength(1)
      expect((await repository.getHold(scope, hold.holdId))?.state).toBe('redeemed')

      // Events accumulated rather than being overwritten.
      const events = await db.unsafe(`select count(*)::int as n from fuma_booking_events_v1`)
      expect((events.rows[0] as { n: number }).n).toBeGreaterThanOrEqual(2)

      // Cancelling sets the paired cancelled_at the schema check requires and
      // withdraws the pending reminder.
      const cancelled = await service.cancel(scope, booking.bookingId, 'customer request')
      expect(cancelled.status).toBe('cancelled')
      expect(cancelled.cancelledAt).not.toBeNull()
      const reminders = await repository.listReminders(scope, booking.bookingId)
      expect(reminders.every((reminder) => reminder.state === 'cancelled')).toBe(true)

      // The other tenant saw none of this.
      expect(await repository.listBookingsInRange(
        otherScope,
        ['res-1'],
        '2026-03-01T00:00:00Z',
        '2026-03-31T00:00:00Z',
      )).toEqual([])
    })
  })
})


describe('PostgresBookingRepository catalog administration', () => {
  test.skipIf(!postgresUrl)('upserts catalog records and replaces scoped hours and exceptions transactionally', async () => {
    await withSchema(async (db) => {
      const repository = new PostgresBookingRepository(db)
      const savedService = await repository.saveService(scope, {
        serviceId: 'svc-admin', slug: 'advisory', name: 'Advisory', description: 'One hour',
        category: 'consulting', durationMinutes: 60, bufferAfterMinutes: 15,
        capacityPerSlot: 1, slotIntervalMinutes: 30, minimumNoticeMinutes: 120,
        maximumAdvanceDays: 120, cancellationWindowMinutes: 180, priceMinor: 750000,
        currency: 'KES', requiresPrepayment: false, state: 'active',
      })
      expect(savedService.slug).toBe('advisory')
      expect(await repository.getService(otherScope, 'svc-admin')).toBeNull()

      const savedLocation = await repository.saveLocation(scope, {
        locationId: 'loc-admin', name: 'Westlands', timeZone: 'Africa/Nairobi',
        addressLine: 'Waiyaki Way', town: 'Nairobi', country: 'KE', mapUrl: null,
        state: 'active',
      })
      expect(savedLocation.timeZone).toBe('Africa/Nairobi')
      expect(await repository.getLocation(otherScope, 'loc-admin')).toBeNull()

      const savedResource = await repository.saveResource(scope, {
        resourceId: 'res-admin', name: 'Consulting room', kind: 'room', locationId: 'loc-admin',
        serviceIds: ['svc-admin'], concurrency: 2, state: 'active',
      })
      expect(savedResource.serviceIds).toEqual(['svc-admin'])
      expect(await repository.getResource(otherScope, 'res-admin')).toBeNull()

      const hours = await repository.replaceWorkingHours(scope, 'res-admin', [
        { weekday: 1, startMinute: 540, endMinute: 720 },
        { weekday: 1, startMinute: 780, endMinute: 1020 },
      ])
      expect(hours).toHaveLength(2)
      await expect(repository.replaceWorkingHours(otherScope, 'res-admin', [
        { weekday: 2, startMinute: 540, endMinute: 1020 },
      ])).rejects.toMatchObject({ code: 'unknown-resource' })

      await repository.saveException(scope, {
        exceptionId: 'exc-admin', resourceId: 'res-admin', date: '2026-12-25',
        kind: 'closed', startMinute: null, endMinute: null, note: 'Holiday',
      })
      expect(await repository.listAdminExceptions(scope, ['res-admin'], '2026-12-01', '2026-12-31'))
        .toEqual([{ exceptionId: 'exc-admin', resourceId: 'res-admin', date: '2026-12-25', kind: 'closed', startMinute: null, endMinute: null, note: 'Holiday' }])
      expect(await repository.listAdminExceptions(otherScope, ['res-admin'], '2026-12-01', '2026-12-31')).toEqual([])
      expect(await repository.deleteException(otherScope, 'exc-admin')).toBe(false)
      expect(await repository.deleteException(scope, 'exc-admin')).toBe(true)
    })
  })
})

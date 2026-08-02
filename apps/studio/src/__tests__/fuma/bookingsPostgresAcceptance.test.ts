import { describe, expect, test } from 'bun:test'

import { createPostgresClient } from '../../../server/db/postgres'
import { bookingsAuthorityMigration } from '../../../server/fuma/db/migrations/000081_bookings_authority'
import {
  HOSTED_MIGRATION_CHECKSUMS,
  hostedMigrations,
} from '../../../server/fuma/db/migrations'
import {
  assertHostedMigrationIsAdditive,
  hostedMigrationChecksum,
} from '../../../server/fuma/db/migrationPolicy'

/**
 * FUMA-093 storage authority.
 *
 * Like `000079` and `000080`, this migration is deliberately physical and
 * unindexed: protected candidate `000078` is still the sole checksum sentinel,
 * so registering `000081` would misrepresent it as accepted. The tests below
 * therefore prove the SQL directly against native PostgreSQL and assert that it
 * stays out of the runnable index until the sentinel is deliberately resolved.
 */

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const EXPECTED_CHECKSUM = '8072f216cf1214198c4e6ed9ee8e434f78bdbcee4079058d7bbe0a5291a2821d'

function quote(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe PostgreSQL schema identifier.')
  return `"${value}"`
}

function scoped(connection: string, schema: string): string {
  const url = new URL(connection)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}

describe('FUMA-093 bookings migration candidate', () => {
  test('is additive, PostgreSQL-only, and checksum stable', () => {
    expect(bookingsAuthorityMigration.id).toBe('000081_bookings_authority')
    expect(() => assertHostedMigrationIsAdditive(bookingsAuthorityMigration)).not.toThrow()
    expect(hostedMigrationChecksum(bookingsAuthorityMigration.sql)).toBe(EXPECTED_CHECKSUM)
    expect(bookingsAuthorityMigration.sql).not.toMatch(/sqlite|zod|create extension/i)
  })

  test('remains unindexed behind the protected sentinel', () => {
    expect(HOSTED_MIGRATION_CHECKSUMS['000081_bookings_authority']).toBeUndefined()
    expect(hostedMigrations.some((entry) => entry.id === '000081_bookings_authority')).toBe(false)
    // The sentinel itself must not be opened by this work.
    expect(HOSTED_MIGRATION_CHECKSUMS['000078_next_source_portability_authority'])
      .toBe('0000000000000000000000000000000000000000000000000000000000000000')
  })

  test('encodes tenant scope, capacity fencing and append-only evidence', () => {
    const sql = bookingsAuthorityMigration.sql
    for (const table of [
      'fuma_booking_locations_v1',
      'fuma_booking_services_v1',
      'fuma_booking_resources_v1',
      'fuma_booking_resource_services_v1',
      'fuma_booking_working_hours_v1',
      'fuma_booking_exceptions_v1',
      'fuma_booking_holds_v1',
      'fuma_bookings_v1',
      'fuma_booking_reminders_v1',
      'fuma_booking_events_v1',
    ]) expect(sql).toContain(table)
    // Every one of the ten tables is tenant-scoped.
    expect(sql.match(/organization_id text not null/g) ?? []).toHaveLength(10)
    // Capacity and idempotency guards.
    expect(sql).toContain('create unique index fuma_booking_hold_live_v1')
    expect(sql).toContain("where state='held'")
    expect(sql).toContain('unique (organization_id, workspace_id, site_id, request_key)')
    expect(sql).toContain('booking events are append-only')
    // Explicit IANA zone, never an implicit server local time.
    expect(sql).toContain('time_zone text not null check')
  })
})

describe('FUMA-093 optional native PostgreSQL acceptance', () => {
  test.skipIf(!postgresUrl)('enforces live-hold uniqueness, idempotent confirmation and immutable events', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_bookings_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quote(schema)}`)
    const db = createPostgresClient(scoped(postgresUrl, schema))
    try {
      await db.unsafe(bookingsAuthorityMigration.sql)

      await db.unsafe(`insert into fuma_booking_locations_v1 values
        ('o','w','s','loc','Studio','Africa/Nairobi','','Nairobi','KE',null,'active',now(),now())`)
      await db.unsafe(`insert into fuma_booking_services_v1 values
        ('o','w','s','svc','haircut','Haircut','','salon',60,0,1,60,0,30,120,250000,'KES',false,'active',now(),now())`)
      await db.unsafe(`insert into fuma_booking_resources_v1 values
        ('o','w','s','res','Asha','staff','loc',1,'active',now(),now())`)

      const insertHold = (id: string, state: string) => db.unsafe(`insert into fuma_booking_holds_v1 values
        ('o','w','s','${id}','svc','res','2026-03-02T07:00:00Z','2026-03-02T08:00:00Z','2026-03-02T06:10:00Z',1,'${state}',now())`)

      await insertHold('h1', 'held')
      // Two live holds cannot claim the same resource and start instant.
      let duplicateRejected = false
      try { await insertHold('h2', 'held') } catch { duplicateRejected = true }
      expect(duplicateRejected).toBe(true)
      // A released hold frees the slot again.
      await insertHold('h3', 'released')

      const insertBooking = (id: string, reference: string, requestKey: string) => db.unsafe(
        `insert into fuma_bookings_v1 values ('o','w','s','${id}','${reference}','svc','res','loc',
         '2026-03-02T07:00:00Z','2026-03-02T08:00:00Z','Africa/Nairobi','confirmed',
         'Wanjiku','wanjiku@example.test',null,'','[]'::jsonb,1,250000,'KES',null,'${requestKey}',now(),now(),null)`,
      )
      await insertBooking('b1', 'FUMA-0001', 'req-aaaaaaa1')
      let replayRejected = false
      try { await insertBooking('b2', 'FUMA-0002', 'req-aaaaaaa1') } catch { replayRejected = true }
      expect(replayRejected).toBe(true)

      // A cancelled booking must carry its cancellation instant.
      let cancelStateRejected = false
      try {
        await db.unsafe(`insert into fuma_bookings_v1 values ('o','w','s','b9','FUMA-0009','svc','res','loc',
          '2026-03-03T07:00:00Z','2026-03-03T08:00:00Z','Africa/Nairobi','cancelled',
          'X','x@example.test',null,'','[]'::jsonb,1,0,'KES',null,'req-bbbbbbb1',now(),now(),null)`)
      } catch { cancelStateRejected = true }
      expect(cancelStateRejected).toBe(true)

      await db.unsafe(`insert into fuma_booking_events_v1 values ('o','w','s','e1','b1','h1','booked',now(),'confirmed')`)
      let updateRejected = false
      try { await db.unsafe(`update fuma_booking_events_v1 set detail='tampered' where event_id='e1'`) }
      catch { updateRejected = true }
      expect(updateRejected).toBe(true)
      let deleteRejected = false
      try { await db.unsafe(`delete from fuma_booking_events_v1 where event_id='e1'`) }
      catch { deleteRejected = true }
      expect(deleteRejected).toBe(true)

      // Cross-tenant rows are independent: the same reference in another site is fine.
      await db.unsafe(`insert into fuma_booking_locations_v1 values
        ('o','w','s2','loc','Studio','Africa/Nairobi','','Nairobi','KE',null,'active',now(),now())`)
      await db.unsafe(`insert into fuma_booking_services_v1 values
        ('o','w','s2','svc','haircut','Haircut','','salon',60,0,1,60,0,30,120,250000,'KES',false,'active',now(),now())`)
      await db.unsafe(`insert into fuma_booking_resources_v1 values
        ('o','w','s2','res','Asha','staff','loc',1,'active',now(),now())`)
      await db.unsafe(`insert into fuma_bookings_v1 values ('o','w','s2','b1','FUMA-0001','svc','res','loc',
        '2026-03-02T07:00:00Z','2026-03-02T08:00:00Z','Africa/Nairobi','confirmed',
        'Other','other@example.test',null,'','[]'::jsonb,1,250000,'KES',null,'req-aaaaaaa1',now(),now(),null)`)

      const counts = await db.unsafe<Readonly<{ bookings: number; events: number }>>(`select
        (select count(*)::int from fuma_bookings_v1) as bookings,
        (select count(*)::int from fuma_booking_events_v1) as events`)
      expect(counts.rows[0]?.bookings).toBe(2)
      expect(counts.rows[0]?.events).toBe(1)
    } finally {
      await db.close().catch(() => {})
      await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`).catch(() => {})
      await admin.close().catch(() => {})
    }
  })
})

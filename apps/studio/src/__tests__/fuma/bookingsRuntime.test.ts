import { describe, expect, test } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import { bookingsAuthorityMigration } from '../../../server/fuma/db/migrations/000081_bookings_authority'
import {
  createHostedBookingRuntime,
  CryptoBookingIdentity,
} from '../../../server/fuma/bookings/runtime'
import { BOOKING_CAPABILITY_IDS } from '../../../server/fuma/bookings/capabilities'
import { ReviewedBackendCapabilityRegistry } from '../../../server/fuma/aiBackendCapabilities/registry'

/**
 * The bookings pack had domain logic, storage and reviewed capability
 * definitions but no production composition, so none of it was reachable. These
 * tests cover the seam itself: real storage selection, capability adoption into
 * a shared registry, and the identity properties the schema depends on.
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

describe('CryptoBookingIdentity', () => {
  const identity = new CryptoBookingIdentity()

  test('emits ids the booking contracts accept', () => {
    const pattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
    for (const value of [
      identity.bookingId(),
      identity.holdId(),
      identity.eventId(),
      identity.reminderId(),
    ]) {
      expect(value).toMatch(pattern)
      expect(value.length).toBeLessThanOrEqual(128)
    }
  })

  test('emits references the schema check constraint accepts', () => {
    // The column is `check(reference ~ '^[A-Z0-9-]{6,24}$')`.
    for (let index = 0; index < 200; index += 1) {
      expect(identity.reference()).toMatch(/^[A-Z0-9-]{6,24}$/)
    }
  })

  test('avoids characters that are ambiguous when read aloud', () => {
    // References get dictated over the phone, so I, L, O and U are excluded.
    let combined = ''
    for (let index = 0; index < 300; index += 1) combined += identity.reference()
    expect(combined).not.toMatch(/[ILOU]/)
  })

  test('does not repeat itself across many draws', () => {
    const seen = new Set<string>()
    for (let index = 0; index < 500; index += 1) seen.add(identity.reference())
    expect(seen.size).toBe(500)
    const ids = new Set<string>()
    for (let index = 0; index < 500; index += 1) ids.add(identity.bookingId())
    expect(ids.size).toBe(500)
  })
})

describe('createHostedBookingRuntime', () => {
  test('refuses a non-PostgreSQL client', () => {
    const fake = Object.assign(
      async () => ({ rows: [], rowCount: 0 }),
      { dialect: 'sqlite', unsafe: async () => ({ rows: [], rowCount: 0 }), transaction: async () => undefined },
    ) as unknown as Parameters<typeof createHostedBookingRuntime>[0]['db']
    expect(() => createHostedBookingRuntime({ db: fake })).toThrow(TypeError)
  })

  test.skipIf(!postgresUrl)('composes real storage and adopts its capabilities into a shared registry', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `bk_rt_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
    await admin.unsafe(`create schema ${quote(schema)}`)
    const db = createPostgresClient(scoped(postgresUrl, schema))
    try {
      await db.unsafe(bookingsAuthorityMigration.sql)
      const runtime = createHostedBookingRuntime({ db })

      // A shared registry starts empty and gains exactly the booking pack.
      const registry = new ReviewedBackendCapabilityRegistry(() => new Date())
      expect(runtime.register(registry)).toBe(registry)

      const expected = Object.values(BOOKING_CAPABILITY_IDS).sort()
      expect(expected.length).toBe(9)
      for (const id of expected) {
        const definition = registry.definition(id, '1.0.0')
        expect(definition).not.toBeNull()
        expect(definition?.metadata.state).toBe('active')
      }
      // A capability that was never registered must stay absent.
      expect(registry.definition('fuma.bookings.invented', '1.0.0')).toBeNull()

      // Registering the same pack twice must not silently duplicate.
      expect(() => runtime.register(registry)).toThrow()

      // The composed authority reads through real storage rather than a fake.
      await db.unsafe(
        `insert into fuma_booking_locations_v1 values
          ('o','w','s','loc-1','Studio','Africa/Nairobi','','Nairobi','KE',null,'active',now(),now())`,
      )
      await db.unsafe(
        `insert into fuma_booking_services_v1 values
          ('o','w','s','svc-1','braids','Braids','','salon',
           90,15,1,30,0,60,60,400000,'KES',false,'active',now(),now())`,
      )
      const listed = await runtime.authority.listServices(
        { limit: 10 },
        { scope: { organizationId: 'o', workspaceId: 'w', siteId: 's' }, signal: AbortSignal.timeout(5_000) },
      )
      expect(listed.services).toHaveLength(1)
      expect(listed.services[0]!.slug).toBe('braids')

      // The sweeper is reachable through the composed runtime.
      await db.unsafe(
        `insert into fuma_booking_resources_v1 values
          ('o','w','s','res-1','Asha','staff','loc-1',1,'active',now(),now())`,
      )
      await db.unsafe(
        `insert into fuma_booking_holds_v1 values
          ('o','w','s','stale','svc-1','res-1',
           '2026-03-09T09:00:00Z','2026-03-09T10:30:00Z','2020-01-01T00:00:00Z',1,'held',now())`,
      )
      const scope = { organizationId: 'o', workspaceId: 'w', siteId: 's' }
      expect(await runtime.sweepExpiredHolds(scope)).toBe(1)
      expect(await runtime.sweepExpiredHolds(scope)).toBe(0)
    } finally {
      await db.close?.()
      await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`).catch(() => {})
      await admin.close?.()
    }
  })
})

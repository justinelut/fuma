import { describe, expect, test } from 'bun:test'

import { createPostgresClient } from '../../../server/db/postgres'
import { publicTrustAuthorityMigration } from '../../../server/fuma/db/migrations/000080_public_trust_authority'
import {
  assertHostedMigrationIsAdditive,
  hostedMigrationChecksum,
} from '../../../server/fuma/db/migrationPolicy'
import {
  DurablePublicContactRoutingAuthority,
  PostgresPublicContactReceiptRepository,
} from '../../../server/fuma/publicProjections/contact'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const EXPECTED_CHECKSUM = '9d3fbbe099e0c43816b677e78cbea9ba41d393bdc574dcb4d66ec85fd0fbde74'
const submission = Object.freeze({
  kind: 'general' as const,
  name: 'Native PostgreSQL Reader',
  email: 'native-reader@example.test',
  message: 'A bounded native PostgreSQL contact routing request.',
  consentVersion: '2026-07-26' as const,
  replayToken: 'native_contact_replay_0001',
})

function quote(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe PostgreSQL schema identifier.')
  return `"${value}"`
}

function scoped(connection: string, schema: string): string {
  const url = new URL(connection)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}

describe('FUMA-WEB-014 public trust migration candidate', () => {
  test('is additive, PostgreSQL-only, metadata-only, and checksum stable', () => {
    expect(publicTrustAuthorityMigration.id).toBe('000080_public_trust_authority')
    expect(() => assertHostedMigrationIsAdditive(publicTrustAuthorityMigration)).not.toThrow()
    expect(hostedMigrationChecksum(publicTrustAuthorityMigration.sql)).toBe(EXPECTED_CHECKSUM)
    expect(publicTrustAuthorityMigration.sql).toContain('fuma_public_contact_routing_receipts_v2')
    expect(publicTrustAuthorityMigration.sql).toContain('public contact receipt cannot be deleted before retention expiry')
    expect(publicTrustAuthorityMigration.sql).not.toMatch(/\b(?:name|email|message|body|payload)_?(?:text|json)?\b/i)
    expect(publicTrustAuthorityMigration.sql).not.toMatch(/sqlite|zod|create extension/i)
  })
})

describe('FUMA-WEB-014 optional native PostgreSQL acceptance', () => {
  test.skipIf(!postgresUrl)('serializes cross-replica routing, exact replay, mutation conflict, immutability, and expiry deletion', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_public_trust_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quote(schema)}`)
    const dbA = createPostgresClient(scoped(postgresUrl, schema))
    const dbB = createPostgresClient(scoped(postgresUrl, schema))
    try {
      await dbA.unsafe(publicTrustAuthorityMigration.sql)
      let deliveries = 0
      let releaseSink!: () => void
      let sinkStarted!: () => void
      const sinkGate = new Promise<void>((resolve) => { releaseSink = resolve })
      const started = new Promise<void>((resolve) => { sinkStarted = resolve })
      const sink = {
        accept: async () => {
          deliveries += 1
          sinkStarted()
          await sinkGate
          return true
        },
      }
      const now = Date.parse('2026-07-31T08:55:00Z')
      const authorityA = new DurablePublicContactRoutingAuthority({
        repository: new PostgresPublicContactReceiptRepository(dbA),
        sink,
        retentionDays: 30,
        retentionPolicyVersion: 'privacy-2026-07',
        now: () => now,
      })
      const authorityB = new DurablePublicContactRoutingAuthority({
        repository: new PostgresPublicContactReceiptRepository(dbB),
        sink,
        retentionDays: 30,
        retentionPolicyVersion: 'privacy-2026-07',
        now: () => now,
      })

      const winner = authorityA.route(submission)
      await started
      const contenders = await Promise.all(Array.from({ length: 7 }, () => authorityB.route(submission)))
      expect(contenders).toEqual(Array.from({ length: 7 }, () => ({ outcome: 'busy', retryAfterSeconds: 30 })))
      releaseSink()
      expect(await winner).toMatchObject({
        outcome: 'accepted',
        receipt: {
          disposition: 'accepted',
          replayToken: submission.replayToken,
          routedAs: 'general',
          acceptedAt: '2026-07-31T08:55:00Z',
          deleteAfter: '2026-08-30T08:55:00Z',
          retentionPolicyVersion: 'privacy-2026-07',
          auditProjection: 'metadata-only',
        },
      })

      const replays = await Promise.all(Array.from({ length: 8 }, (_, index) => (
        (index % 2 === 0 ? authorityA : authorityB).route(submission)
      )))
      expect(replays.every((result) => result.outcome === 'accepted'
        && result.receipt.disposition === 'replayed')).toBe(true)
      expect(await authorityB.route({ ...submission, message: 'A conflicting replay body.' })).toEqual({ outcome: 'conflict' })
      expect(deliveries).toBe(1)

      const columns = await dbA<{ column_name: string }>`
        select column_name from information_schema.columns
        where table_schema=${schema} and table_name='fuma_public_contact_routing_receipts_v2'
        order by ordinal_position
      `
      expect(columns.rows.map(({ column_name }) => column_name)).not.toEqual(expect.arrayContaining(['name', 'email', 'message', 'body', 'payload']))
      const stored = await dbA<{ receipt: Record<string, unknown> }>`
        select to_jsonb(receipt) receipt from fuma_public_contact_routing_receipts_v2 receipt
        where replay_token=${submission.replayToken}
      `
      const storedText = JSON.stringify(stored.rows[0]?.receipt)
      expect(storedText).not.toContain(submission.name)
      expect(storedText).not.toContain(submission.email)
      expect(storedText).not.toContain(submission.message)
      await expect(dbA`
        update fuma_public_contact_routing_receipts_v2 set request_sha256=${'f'.repeat(64)}
        where replay_token=${submission.replayToken}
      `).rejects.toThrow('identity is immutable')
      await expect(dbA`
        delete from fuma_public_contact_routing_receipts_v2 where replay_token=${submission.replayToken}
      `).rejects.toThrow('before retention expiry')

      await dbA`
        insert into fuma_public_contact_routing_receipts_v2 (
          replay_token,request_sha256,routed_as,receipt_id,state,accepted_at,delete_after,
          retention_policy_version,lease_owner,lease_expires_at,created_at,updated_at
        ) values (
          ${'expired_contact_replay_001'},${'e'.repeat(64)},${'privacy'},${'contact:expired-receipt-001'},${'accepted'},
          ${'2025-01-01T00:00:00Z'},${'2025-01-31T00:00:00Z'},${'privacy-2025-01'},
          ${'00000000-0000-4000-8000-000000000000'},${'2025-01-01T00:00:30Z'},
          ${'2025-01-01T00:00:00Z'},${'2025-01-01T00:00:00Z'}
        )
      `
      const expired = await dbA.unsafe(`
        delete from fuma_public_contact_routing_receipts_v2
        where replay_token='expired_contact_replay_001' and delete_after<=statement_timestamp()
      `)
      expect(expired.rowCount).toBe(1)
      process.stdout.write('[FUMA-WEB-014 PostgreSQL] replicas=2 contention=8 delivery=1 replays=8 conflict=true metadataOnly=true immutable=true expiryDelete=1\n')
    } finally {
      await dbA.close?.()
      await dbB.close?.()
      await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`)
      const leftovers = await admin<{ count: string }>`select count(*)::text count from pg_namespace where nspname=${schema}`
      expect(leftovers.rows[0]?.count).toBe('0')
      await admin.close?.()
    }
  }, 120_000)
})

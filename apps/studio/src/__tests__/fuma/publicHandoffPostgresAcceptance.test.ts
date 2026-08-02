import { createPostgresClient } from '../../../server/db/postgres'
import { publicHandoffAuthorityMigration } from '../../../server/fuma/db/migrations/000077_public_handoff_authority'
import { HOSTED_MIGRATION_CHECKSUMS, hostedMigrations, runnableHostedMigrations } from '../../../server/fuma/db/migrations'
import {
  assertHostedMigrationIsAdditive,
  assertHostedMigrationManifest,
  hostedMigrationChecksum,
  nextHostedMigrationId,
} from '../../../server/fuma/db/migrationPolicy'
import { PostgresPublicHandoffRepository } from '../../../server/fuma/publicHandoff'

const CHECKSUM = 'fb257b84c2e44b65212ef5227845c50524887248fb10732a6ec46a4b7dd53015'
const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const NOW = '2026-08-02T10:00:00.000Z'
const INTENT_EXPIRES = '2026-08-02T10:10:00.000Z'
const CODE_EXPIRES = '2026-08-02T10:02:00.000Z'
const SESSION_EXPIRES = '2026-08-02T22:00:00.000Z'

function quote(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe schema.')
  return `"${value}"`
}

function scoped(connection: string, schema: string): string {
  const url = new URL(connection)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}

function fulfilled<T>(results: readonly PromiseSettledResult<T>[]): T[] {
  return results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
}

describe('FUMA-WEB-013 migration 000077', () => {
  test('is checksum-finalized, additive, runnable, and advances the next slot to 000078', () => {
    expect(hostedMigrations.at(-2)).toBe(publicHandoffAuthorityMigration)
    expect(runnableHostedMigrations.at(-1)).toBe(publicHandoffAuthorityMigration)
    expect(HOSTED_MIGRATION_CHECKSUMS[publicHandoffAuthorityMigration.id]).toBe(CHECKSUM)
    expect(hostedMigrationChecksum(publicHandoffAuthorityMigration.sql)).toBe(CHECKSUM)
    expect(nextHostedMigrationId(runnableHostedMigrations, 'release followup')).toBe('000078_release_followup')
    expect(() => assertHostedMigrationIsAdditive(publicHandoffAuthorityMigration)).not.toThrow()
    expect(() => assertHostedMigrationManifest(hostedMigrations, HOSTED_MIGRATION_CHECKSUMS)).not.toThrow()
  })
})

describe('FUMA-WEB-013 optional native PostgreSQL acceptance', () => {
  test.skipIf(!postgresUrl)('serializes intent, code, cancellation, and session use while retaining hash-only immutable evidence', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_handoff_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quote(schema)}`)
    const db = createPostgresClient(scoped(postgresUrl, schema))
    try {
      await db.unsafe(`
        create table auth_users(id text primary key,banned boolean default false,ban_expires timestamptz);
        create table auth_sessions(id text primary key,user_id text not null references auth_users(id),expires_at timestamptz not null);
        insert into auth_users(id,banned,ban_expires) values ('user-pg',false,null);
        insert into auth_sessions(id,user_id,expires_at) values ('identity-session-pg','user-pg','2026-08-03T10:00:00.000Z');
      `)
      await db.unsafe(publicHandoffAuthorityMigration.sql)
      const repository = new PostgresPublicHandoffRepository(db)
      const intentInput = {
        tokenHash: 'a'.repeat(64),
        token: 'intent_pg_abcdefghijklmnopqrstuvwxyz0123456789',
        correlation: 'correlation_pg_abcdefghijklmnopqrstuvwxyz012345',
        request: { kind: 'sign_in' as const, source: 'direct' as const },
        issuedAt: NOW,
        expiresAt: INTENT_EXPIRES,
      }
      const issued = await Promise.allSettled(Array.from({ length: 8 }, () => repository.issueIntent(intentInput)))
      expect(fulfilled(issued)).toHaveLength(1)
      await expect(repository.authorizeIntent({
        tokenHash: intentInput.tokenHash,
        correlation: 'wrong_correlation_abcdefghijklmnopqrstuvwxyz',
        codeHash: 'b'.repeat(64),
        code: 'wrong_code_abcdefghijklmnopqrstuvwxyz0123456789',
        state: 'wrong_state_abcdefghijklmnopqrstuvwxyz0123456789',
        now: '2026-08-02T10:00:30.000Z',
        expiresAt: CODE_EXPIRES,
        userId: 'user-pg',
        identitySessionId: 'identity-session-pg',
      })).rejects.toMatchObject({ code: 'invalid' })

      const authorizeInput = {
        tokenHash: intentInput.tokenHash,
        correlation: intentInput.correlation,
        codeHash: 'b'.repeat(64),
        code: 'code_pg_abcdefghijklmnopqrstuvwxyz0123456789',
        state: 'state_pg_abcdefghijklmnopqrstuvwxyz0123456789',
        now: '2026-08-02T10:00:30.000Z',
        expiresAt: CODE_EXPIRES,
        userId: 'user-pg',
        identitySessionId: 'identity-session-pg',
      }
      const authorized = await Promise.allSettled(Array.from({ length: 8 }, () => repository.authorizeIntent(authorizeInput)))
      expect(fulfilled(authorized)).toHaveLength(1)
      expect(await repository.inspectCode({ codeHash: authorizeInput.codeHash, state: authorizeInput.state, now: '2026-08-02T10:01:00.000Z' })).toMatchObject({ userId: 'user-pg' })

      const consumed = await Promise.allSettled(Array.from({ length: 8 }, () => repository.consumeCode({
        codeHash: authorizeInput.codeHash,
        state: authorizeInput.state,
        now: '2026-08-02T10:01:00.000Z',
      })))
      expect(fulfilled(consumed)).toHaveLength(1)

      const sessionInput = {
        tokenHash: 'c'.repeat(64),
        token: 'session_pg_abcdefghijklmnopqrstuvwxyz0123456789',
        userId: 'user-pg',
        identitySessionId: 'identity-session-pg',
        createdAt: '2026-08-02T10:01:00.000Z',
        expiresAt: SESSION_EXPIRES,
      }
      const sessions = await Promise.allSettled(Array.from({ length: 8 }, () => repository.createSession(sessionInput)))
      expect(fulfilled(sessions)).toHaveLength(1)
      expect(await repository.resolveSession({ tokenHash: sessionInput.tokenHash, now: '2026-08-02T10:02:00.000Z' })).toMatchObject({ userId: 'user-pg', identitySessionId: 'identity-session-pg', expiresAt: SESSION_EXPIRES })

      const cancelIntent = {
        ...intentInput,
        tokenHash: 'd'.repeat(64),
        token: 'cancel_pg_abcdefghijklmnopqrstuvwxyz0123456789',
        correlation: 'cancel_correlation_abcdefghijklmnopqrstuvwxyz0123',
      }
      await repository.issueIntent(cancelIntent)
      const cancelled = await Promise.allSettled(Array.from({ length: 8 }, () => repository.cancelIntent({
        tokenHash: cancelIntent.tokenHash,
        correlation: cancelIntent.correlation,
        now: '2026-08-02T10:01:30.000Z',
      })))
      expect(fulfilled(cancelled)).toHaveLength(1)

      const stored = await db<{ material: string }>`
        select concat_ws('|',
          (select string_agg(token_hash_sha256, ',') from fuma_public_handoff_intents_v1),
          (select string_agg(code_hash_sha256, ',') from fuma_app_handoff_codes_v1),
          (select string_agg(token_hash_sha256, ',') from fuma_app_handoff_sessions_v1)
        ) material
      `
      expect(stored.rows[0]?.material).not.toContain(intentInput.token)
      expect(stored.rows[0]?.material).not.toContain(authorizeInput.code)
      expect(stored.rows[0]?.material).not.toContain(sessionInput.token)
      await db.unsafe("update auth_users set banned=true,ban_expires=null where id='user-pg'")
      expect(await repository.resolveSession({ tokenHash: sessionInput.tokenHash, now: '2026-08-02T10:02:00.000Z' })).toBeNull()
      await db.unsafe("update auth_users set banned=false where id='user-pg'")
      expect(await repository.resolveSession({ tokenHash: sessionInput.tokenHash, now: '2026-08-02T10:02:00.000Z' })).not.toBeNull()
      await db.unsafe("delete from auth_sessions where id='identity-session-pg'")
      expect(await repository.resolveSession({ tokenHash: sessionInput.tokenHash, now: '2026-08-02T10:02:00.000Z' })).toBeNull()
      await expect(db.unsafe("update fuma_public_handoff_events_v1 set event_kind='rejected'")).rejects.toThrow('append-only')
      await expect(db.unsafe('delete from fuma_public_handoff_events_v1')).rejects.toThrow('append-only')
      const counts = await db<{ intents: string; codes: string; sessions: string; events: string }>`
        select
          (select count(*) from fuma_public_handoff_intents_v1)::text intents,
          (select count(*) from fuma_app_handoff_codes_v1)::text codes,
          (select count(*) from fuma_app_handoff_sessions_v1)::text sessions,
          (select count(*) from fuma_public_handoff_events_v1)::text events
      `
      expect(counts.rows[0]).toEqual({ intents: '2', codes: '0', sessions: '0', events: '5' })
      process.stdout.write('[FUMA-WEB-013 PostgreSQL] contention=8 intents=2 codes=1 sessions=1 events=5 immutable=2/2 hashOnly=true exactSessionRevocation=true\n')
    } finally {
      await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`)
      const leftovers = await admin<{ count: string }>`select count(*)::text count from pg_namespace where nspname=${schema}`
      expect(leftovers.rows[0]?.count).toBe('0')
    }
  }, 120_000)
})

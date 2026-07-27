import { describe, expect, it } from 'bun:test'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { getTableName } from 'drizzle-orm'
import type { DbClient, DbResult } from '../../../server/db/client'
import { hashPassword } from '../../../server/auth/tokens'
import {
  createHostedAuth,
  createPostgresHostedAuth,
} from '../../../server/auth/hosted/auth'
import { backfillLegacyStaffIdentities } from '../../../server/auth/hosted/legacyIdentity'
import * as authSchema from '../../../server/auth/hosted/schema'
import {
  AUTH_MODEL_NAMES,
  HOSTED_AUTH_SCHEMA_MANIFEST,
} from '../../../server/auth/hosted/schemaManifest'
import { withHashedSessionTokens } from '../../../server/auth/hosted/sessionTokenAdapter'
import { runHostedMigrations } from '../../../server/fuma/db/hostedMigrationRunner'
import { hostedMigrations, HOSTED_MIGRATION_CHECKSUMS } from '../../../server/fuma/db/migrations'
import {
  assertHostedMigrationIsAdditive,
  hostedMigrationChecksum,
  nextHostedMigrationId,
  type HostedMigrationHistoryRow,
} from '../../../server/fuma/db/migrationPolicy'
import { createLegacySqliteTransitionSource } from '../helpers/fuma/legacySqliteTransitionSource'

const BASE_URL = 'https://app.fuma.co.ke'
const SECRET = 'fuma-011-isolated-auth-boundary-secret-at-least-32-characters'

type MemoryRow = Record<string, unknown>
type MemoryDatabase = Record<string, MemoryRow[]>

function noRows<Row>(): DbResult<Row> {
  return { rows: [], rowCount: 0 }
}

function initializedMemoryDatabase(): MemoryDatabase {
  return Object.fromEntries(Object.values(AUTH_MODEL_NAMES).map((name) => [name, []]))
}

function authRequest(path: string, body: Record<string, unknown>): Request {
  return new Request(`${BASE_URL}/api/auth${path}`, {
    method: 'POST',
    headers: { origin: BASE_URL, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function createMemoryAuth(database: MemoryDatabase, createdProfileIds: string[] = []) {
  return createHostedAuth(
    withHashedSessionTokens(memoryAdapter(database)),
    { baseURL: BASE_URL, secret: SECRET, secureCookies: true },
    { create: async ({ id }) => { createdProfileIds.push(id) } },
  )
}

function rollbackEvidenceDb(initialHistory: readonly HostedMigrationHistoryRow[]): {
  db: DbClient
  history: () => readonly HostedMigrationHistoryRow[]
  authSchemaExists: () => boolean
} {
  let history = initialHistory.map((row) => ({ ...row }))
  let authSchemaExists = false

  const fn = (async <Row = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<DbResult<Row>> => {
    const sql = strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase()
    if (sql.includes('select id, checksum from fuma_hosted_schema_migrations')) {
      return { rows: history.map((row) => ({ ...row })) as Row[], rowCount: history.length }
    }
    if (sql.includes('insert into fuma_hosted_schema_migrations')) {
      history.push({ id: String(values[0]), checksum: String(values[1]) })
    }
    return noRows<Row>()
  }) as DbClient

  fn.unsafe = async <Row = Record<string, unknown>>(sql: string): Promise<DbResult<Row>> => {
    if (sql.includes('create table auth_users')) {
      authSchemaExists = true
      throw new Error('forced FUMA-011 migration failure')
    }
    return noRows<Row>()
  }
  fn.transaction = async <T>(callback: (tx: DbClient) => Promise<T>): Promise<T> => {
    const historyBefore = history.map((row) => ({ ...row }))
    const authSchemaBefore = authSchemaExists
    try {
      return await callback(fn)
    } catch (error) {
      history = historyBefore
      authSchemaExists = authSchemaBefore
      throw error
    }
  }
  Object.defineProperty(fn, 'dialect', { value: 'postgres' })
  return { db: fn, history: () => history, authSchemaExists: () => authSchemaExists }
}

describe('FUMA-011 staff identity migration manifest', () => {
  it('uses the FUMA-006 next ID and keeps schema, adapter, and migration names aligned', () => {
    const migrationIndex = hostedMigrations.findIndex(({ id }) => id === HOSTED_AUTH_SCHEMA_MANIFEST.migrationId)
    expect(migrationIndex).toBe(2)
    const migration = hostedMigrations[migrationIndex]!
    expect(nextHostedMigrationId(hostedMigrations.slice(0, migrationIndex), 'staff identity')).toBe('000003_staff_identity')
    expect(migration.id).toBe(HOSTED_AUTH_SCHEMA_MANIFEST.migrationId)
    expect(hostedMigrationChecksum(migration.sql)).toBe(HOSTED_MIGRATION_CHECKSUMS[migration.id])
    expect(() => assertHostedMigrationIsAdditive(migration)).not.toThrow()

    const drizzleTables = [
      authSchema.auth_users,
      authSchema.auth_sessions,
      authSchema.auth_accounts,
      authSchema.auth_verifications,
      authSchema.auth_organizations,
      authSchema.auth_members,
      authSchema.auth_invitations,
      authSchema.auth_two_factors,
      authSchema.auth_staff_profiles,
      authSchema.auth_legacy_identity_links,
    ].map(getTableName)
    expect(drizzleTables).toEqual([
      ...HOSTED_AUTH_SCHEMA_MANIFEST.betterAuthTables,
      HOSTED_AUTH_SCHEMA_MANIFEST.lifecycleTable,
      HOSTED_AUTH_SCHEMA_MANIFEST.legacyIdentityLinkTable,
    ])
    expect(migration.sql).toContain('create unique index auth_users_email_normalized_idx')
    expect(migration.sql).toContain('unique (provider_id, account_id)')
    expect(migration.sql).toContain('legacy_user_id text primary key references users(id) on delete restrict')
    expect(migration.sql).toContain('credentials.password is distinct from users.password_hash')
  })

  it('rolls back schema effects and history when migration 000003 fails', async () => {
    const applied = hostedMigrations.slice(0, 2).map((migration) => ({
      id: migration.id,
      checksum: hostedMigrationChecksum(migration.sql),
    }))
    const evidence = rollbackEvidenceDb(applied)

    await expect(runHostedMigrations(evidence.db)).rejects.toThrow('forced FUMA-011 migration failure')
    expect(evidence.history()).toEqual(applied)
    expect(evidence.authSchemaExists()).toBe(false)
  })
})

describe('FUMA-011 isolated Better Auth-compatible boundary', () => {
  it('logs in the seeded legacy staff user with the existing password without rewriting its Argon2id hash', async () => {
    const source = await createLegacySqliteTransitionSource('fuma-011-seeded-login')
    try {
      const legacy = await source.db<{
        id: string
        email: string
        display_name: string
        password_hash: string
        created_at: string
        updated_at: string
      }>`select id, email, display_name, password_hash, created_at, updated_at from users where id = ${source.stableIds.ownerUserId}`
      const user = legacy.rows[0]!
      const database = initializedMemoryDatabase()
      database[AUTH_MODEL_NAMES.user]!.push({
        id: user.id,
        name: user.display_name,
        email: user.email,
        emailVerified: true,
        createdAt: new Date(user.created_at),
        updatedAt: new Date(user.updated_at),
        role: 'owner',
        banned: false,
      })
      database[AUTH_MODEL_NAMES.account]!.push({
        id: `legacy-credential:${user.id}`,
        accountId: user.id,
        providerId: 'credential',
        userId: user.id,
        password: user.password_hash,
        createdAt: new Date(user.created_at),
        updatedAt: new Date(user.updated_at),
      })
      const originalHash = user.password_hash
      const response = await createMemoryAuth(database).handler(authRequest('/sign-in/email', {
        email: user.email,
        password: source.legacyPassword,
      }))

      expect(response.status).toBe(200)
      expect(originalHash).toStartWith('$argon2id$')
      expect(database[AUTH_MODEL_NAMES.account]?.[0]?.password).toBe(originalHash)
    } finally {
      await source.cleanup()
    }
  })

  it('creates exactly one lifecycle profile and rejects a duplicate normalized identity', async () => {
    const database = initializedMemoryDatabase()
    const profileIds: string[] = []
    const auth = createMemoryAuth(database, profileIds)
    const first = await auth.handler(authRequest('/sign-up/email', {
      email: 'new.staff@fixture.invalid',
      name: 'New Staff',
      password: 'Fuma-new-staff-password-123!',
    }))
    const duplicate = await auth.handler(authRequest('/sign-up/email', {
      email: 'NEW.STAFF@fixture.invalid',
      name: 'Duplicate Staff',
      password: 'Fuma-new-staff-password-456!',
    }))

    expect(first.status).toBe(200)
    expect(duplicate.status).not.toBe(200)
    expect(database[AUTH_MODEL_NAMES.user]).toHaveLength(1)
    expect(profileIds).toHaveLength(1)
    expect(profileIds[0]).toBe(database[AUTH_MODEL_NAMES.user]?.[0]?.id)
  })
})

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL

function flattenNestedTransactions(db: DbClient): DbClient {
  const fn = (async <Row = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<DbResult<Row>> => await db<Row>(strings, ...values)) as DbClient
  fn.unsafe = async <Row = Record<string, unknown>>(sql: string, params?: unknown[]) => (
    params === undefined ? await db.unsafe<Row>(sql) : await db.unsafe<Row>(sql, params)
  )
  fn.transaction = async <T>(callback: (tx: DbClient) => Promise<T>) => await callback(fn)
  Object.defineProperty(fn, 'dialect', { value: 'postgres' })
  return fn
}

it.skipIf(postgresUrl === undefined)(
  'FUMA-011 live PostgreSQL: fresh and upgrade paths preserve hashes, links, uniqueness, profiles, and login',
  async () => {
    if (postgresUrl === undefined) throw new Error('FUMA_TEST_POSTGRES_URL is required')
    const [{ createPostgresClient }, { pgMigrations }, { runMigrations }] = await Promise.all([
      import('../../../server/db/postgres'),
      import('../../../server/db/migrations-pg'),
      import('../../../server/db/runMigrations'),
    ])
    const admin = createPostgresClient(postgresUrl)
    const freshSchema = `fuma_staff_identity_fresh_${process.pid}_${Date.now()}`
    const schema = `fuma_staff_identity_upgrade_${process.pid}_${Date.now()}`
    const existingPassword = 'Fuma-existing-upgrade-password-123!'
    const existingHash = await hashPassword(existingPassword)
    const secondExistingHash = await hashPassword('Fuma-existing-admin-password-123!')
    const memberHash = await hashPassword('Fuma-existing-member-password-123!')
    const ownerId = 'fuma-011-legacy-owner'
    const adminId = 'fuma-011-legacy-admin'
    let hostedAuth: ReturnType<typeof createPostgresHostedAuth> | undefined

    try {
      await admin.transaction(async (transaction) => {
        await transaction.unsafe(`create schema "${freshSchema}"`)
        await transaction.unsafe(`set local search_path to "${freshSchema}"`)
        const db = flattenNestedTransactions(transaction)
        await runMigrations(db, pgMigrations)
        await runHostedMigrations(db)
        const fresh = await db<{ identities: string | number; links: string | number }>`
          select
            (select count(*) from auth_users) as identities,
            (select count(*) from auth_legacy_identity_links) as links
        `
        expect(Number(fresh.rows[0]?.identities)).toBe(0)
        expect(Number(fresh.rows[0]?.links)).toBe(0)
      })

      await admin.transaction(async (transaction) => {
        await transaction.unsafe(`create schema "${schema}"`)
        await transaction.unsafe(`set local search_path to "${schema}"`)
        const db = flattenNestedTransactions(transaction)
        await runMigrations(db, pgMigrations)
        await db`
          insert into users (id, email, email_normalized, display_name, password_hash, role_id)
          values
            (${ownerId}, ${'legacy.staff@fixture.invalid'}, ${'legacy.staff@fixture.invalid'},
              ${'Legacy Staff'}, ${existingHash}, ${'owner'}),
            (${adminId}, ${'legacy.admin@fixture.invalid'}, ${'legacy.admin@fixture.invalid'},
              ${'Legacy Admin'}, ${secondExistingHash}, ${'admin'}),
            (${'fuma-011-legacy-member'}, ${'legacy.member@fixture.invalid'}, ${'legacy.member@fixture.invalid'},
              ${'Legacy Member'}, ${memberHash}, ${'member'})
        `
        await runHostedMigrations(db)

        const links = await db<{ legacy_user_id: string; auth_user_id: string; password: string }>`
          select links.legacy_user_id, links.auth_user_id, accounts.password
          from auth_legacy_identity_links links
          join auth_accounts accounts on accounts.user_id = links.auth_user_id
          where accounts.provider_id = 'credential'
          order by links.legacy_user_id
        `
        expect(links.rows).toEqual([
          {
            legacy_user_id: adminId,
            auth_user_id: adminId,
            password: secondExistingHash,
          },
          {
            legacy_user_id: ownerId,
            auth_user_id: ownerId,
            password: existingHash,
          },
        ])
        const report = await backfillLegacyStaffIdentities(db)
        expect(report).toEqual({ eligibleLegacyStaff: 2, linkedLegacyStaff: 2 })
      })

      hostedAuth = createPostgresHostedAuth({
        baseURL: BASE_URL,
        secret: SECRET,
        secureCookies: true,
        databaseUrl: postgresUrl,
        searchPath: schema,
      })
      const login = await hostedAuth.auth.handler(authRequest('/sign-in/email', {
        email: 'legacy.staff@fixture.invalid',
        password: existingPassword,
      }))
      expect(login.status).toBe(200)

      const native = await hostedAuth.auth.handler(authRequest('/sign-up/email', {
        email: 'native.staff@fixture.invalid',
        name: 'Native Staff',
        password: 'Fuma-native-staff-password-123!',
      }))
      const duplicate = await hostedAuth.auth.handler(authRequest('/sign-up/email', {
        email: 'NATIVE.STAFF@fixture.invalid',
        name: 'Duplicate Native Staff',
        password: 'Fuma-native-staff-password-456!',
      }))
      expect(native.status).toBe(200)
      expect(duplicate.status).not.toBe(200)

      const profiles = await admin.unsafe<{ source: string; count: string | number }>(
        `select source, count(*) as count from "${schema}".auth_staff_profiles group by source order by source`,
      )
      expect(profiles.rows.map(({ source, count }) => ({ source, count: Number(count) }))).toEqual([
        { source: 'legacy', count: 2 },
        { source: 'native', count: 1 },
      ])
      const preserved = await admin.unsafe<{ password: string }>(
        `select password from "${schema}".auth_accounts where user_id = $1 and provider_id = 'credential'`,
        [ownerId],
      )
      expect(preserved.rows[0]?.password).toBe(existingHash)
    } finally {
      await hostedAuth?.close()
      await admin.unsafe(`drop schema if exists "${schema}" cascade`)
      await admin.unsafe(`drop schema if exists "${freshSchema}" cascade`)
    }
  },
  30_000,
)

import { describe, expect, it } from 'bun:test'
import type { DbClient, DbResult } from '../../../server/db/client'
import { createPostgresClient } from '../../../server/db/postgres'
import { createSqliteClient } from '../../../server/db/sqlite'
import {
  PostgresTenantFixtureRequiredError,
  SecretShapedFixtureDataError,
  createPostgresTenantFixtureHarness,
} from '../helpers/fuma/postgresTenantHarness'
import { createFumaTwoTenantMatrix } from '../helpers/fuma/fixtures'

function noRows<Row>(): DbResult<Row> {
  return { rows: [], rowCount: 0 }
}

function createCallCountingPostgresDb(): { db: DbClient; calls: () => number } {
  let callCount = 0
  const fn = (async <Row = Record<string, unknown>>(): Promise<DbResult<Row>> => {
    callCount += 1
    return noRows<Row>()
  }) as DbClient
  fn.unsafe = async <Row = Record<string, unknown>>(): Promise<DbResult<Row>> => {
    callCount += 1
    return noRows<Row>()
  }
  fn.transaction = async <T>(callback: (tx: DbClient) => Promise<T>): Promise<T> => {
    callCount += 1
    return await callback(fn)
  }
  Object.defineProperty(fn, 'dialect', { value: 'postgres' })
  return { db: fn, calls: () => callCount }
}

describe('FUMA-002 PostgreSQL tenant fixture harness unit boundary', () => {
  it('fails closed before issuing SQL for a non-PostgreSQL client', () => {
    const sqlite = createSqliteClient(':memory:')
    expect(() => createPostgresTenantFixtureHarness(sqlite, 'fail-closed'))
      .toThrow(PostgresTenantFixtureRequiredError)
  })

  it('rejects secret-shaped fixture keys and values before creating a schema', async () => {
    const secretKeys = [
      'password',
      'passwordHash',
      'PAYSTACK_SECRET_KEY',
      'cloudflareApiToken',
      'cloudflareAuthKey',
      'cloudflare_auth_key',
      'cloudflare-auth-key',
      'ociAccessKey',
      'oci_access_key',
      'oci-access-key',
      'authorization',
      'cookie',
      'privateKey',
      'credential',
    ]
    const secretValues = [
      'Bearer must-not-reach-persistence',
      'sk_live_must-not-reach-persistence',
      'pk_test_must-not-reach-persistence',
      '-----BEGIN PRIVATE KEY-----',
      'AKIA1234567890ABCDEF',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.signature',
    ]

    for (const key of secretKeys) {
      const { db, calls } = createCallCountingPostgresDb()
      const matrix = createFumaTwoTenantMatrix(`secret-key-${key}`)
      const tainted = {
        ...matrix,
        resources: matrix.resources.map((resource, index) => index === 0
          ? { ...resource, [key]: 'fixture-value' }
          : resource),
      }
      const harness = createPostgresTenantFixtureHarness(db, 'secret-key-preflight')

      await expect(harness.provision(tainted)).rejects.toBeInstanceOf(SecretShapedFixtureDataError)
      expect(calls()).toBe(0)
      await harness.cleanup()
      expect(calls()).toBe(0)
    }

    for (const value of secretValues) {
      const { db, calls } = createCallCountingPostgresDb()
      const matrix = createFumaTwoTenantMatrix('secret-value')
      const tainted = {
        ...matrix,
        resources: matrix.resources.map((resource, index) => index === 0
          ? { ...resource, value }
          : resource),
      }
      const harness = createPostgresTenantFixtureHarness(db, 'secret-value-preflight')

      await expect(harness.provision(tainted)).rejects.toBeInstanceOf(SecretShapedFixtureDataError)
      expect(calls()).toBe(0)
      await harness.cleanup()
      expect(calls()).toBe(0)
    }
  })

  it('makes cleanup terminal and rejects later provisioning before issuing SQL', async () => {
    const { db, calls } = createCallCountingPostgresDb()
    const harness = createPostgresTenantFixtureHarness(db, 'cleaned-before-provision')

    await harness.cleanup()
    await harness.cleanup()
    expect(calls()).toBe(0)

    await expect(harness.provision(createFumaTwoTenantMatrix('cleaned-before-provision')))
      .rejects.toThrow('PostgreSQL tenant fixture harness is already provisioned or cleaned')
    expect(calls()).toBe(0)
  })
})

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL

it.skipIf(postgresUrl === undefined)(
  'FUMA-002 live PostgreSQL: colliding tenant IDs stay isolated and all fixture schemas are removed',
  async () => {
    if (postgresUrl === undefined) throw new Error('FUMA_TEST_POSTGRES_URL is required for this test')
    const db = createPostgresClient(postgresUrl)
    const matrix = createFumaTwoTenantMatrix('live-postgres-isolation')
    const harness = createPostgresTenantFixtureHarness(db, 'live-postgres')

    try {
      const evidence = await harness.provision(matrix)
      expect(evidence.organizationIds).toEqual(matrix.organizations.map(({ id }) => id))
      expect(evidence.collidingWorkspaceId).toBe(matrix.workspaces[0].id)
      expect(evidence.collidingSiteIds).toEqual([...new Set(matrix.sites.map(({ id }) => id))].sort())
      expect(evidence.collidingResourceId).toBe(matrix.resources[0].id)
      expect(evidence.workspaceRows).toBe(2)
      expect(evidence.siteRows).toBe(4)
      expect(evidence.resourceRows).toBe(4)
    } finally {
      await harness.cleanup()
      await harness.cleanup()
    }

    expect(await harness.cleanupIsComplete()).toBe(true)
    const remaining = await db<{ nspname: string }>`
      select nspname from pg_namespace where nspname like ${'fuma_fixture_%'}
    `
    expect(remaining.rows).toEqual([])
  },
)


it.skipIf(postgresUrl === undefined)(
  'FUMA-002 live PostgreSQL: cleanup before provision is terminal and leaves no fixture schema',
  async () => {
    if (postgresUrl === undefined) throw new Error('FUMA_TEST_POSTGRES_URL is required for this test')
    const db = createPostgresClient(postgresUrl)
    const harness = createPostgresTenantFixtureHarness(db, 'cleaned-before-provision-live')

    await harness.cleanup()
    await harness.cleanup()
    await expect(harness.provision(createFumaTwoTenantMatrix('cleaned-before-provision-live')))
      .rejects.toThrow('PostgreSQL tenant fixture harness is already provisioned or cleaned')
    expect(await harness.cleanupIsComplete()).toBe(true)

    const remaining = await db<{ nspname: string }>`
      select nspname from pg_namespace where nspname like ${'fuma_fixture_%'}
    `
    expect(remaining.rows).toEqual([])
  },
)

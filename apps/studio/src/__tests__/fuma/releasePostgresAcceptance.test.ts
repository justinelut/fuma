import { describe, expect, it } from 'bun:test'
import type { DbClient, DbResult } from '../../../server/db/client'
import { createPostgresClient } from '../../../server/db/postgres'
import { releasesMigration } from '../../../server/fuma/db/migrations/000011_releases'
import {
  FakeObjectStorageTransport,
  FumaObjectStorage,
  type TenantObjectStorage,
} from '../../../server/fuma/objectStorage'
import {
  ReleaseRepositoryError,
  createPostgresReleaseComposition,
} from '../../../server/fuma/releases'
import type { FumaRepositoryScope } from '../../../server/fuma/tenancy'
import {
  RELEASE_FIXTURE_BYTES,
  RELEASE_FIXTURE_SCOPE_A,
  RELEASE_FIXTURE_SCOPE_B,
  RELEASE_FIXTURE_SOURCE_HASH,
  RELEASE_FIXTURE_TIME,
  createReleaseFixtureManifest,
} from '../helpers/fuma/releaseFixture'

const CLAIM = Object.freeze({ jobId: 'job-release-postgres-001', fence: '41' })
const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL

function quotedIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe PostgreSQL test schema identifier.')
  return `"${value}"`
}

function schemaClient(admin: DbClient, schema: string): DbClient {
  const searchPath = `set local search_path to ${quotedIdentifier(schema)}, public`
  const bind = (db: DbClient): DbClient => {
    const query = (async <Row = Record<string, unknown>>(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<DbResult<Row>> => await db<Row>(strings, ...values)) as DbClient
    query.unsafe = async <Row = Record<string, unknown>>(sql: string, params?: unknown[]) => (
      await db.unsafe<Row>(sql, params)
    )
    query.transaction = async <T>(work: (tx: DbClient) => Promise<T>): Promise<T> => (
      await db.transaction(async (tx) => {
        await tx.unsafe(searchPath)
        return await work(bind(tx))
      })
    )
    return Object.assign(query, { dialect: 'postgres' as const })
  }
  return bind(admin)
}

function releaseStorage(): TenantObjectStorage {
  return new FumaObjectStorage({
    transport: new FakeObjectStorageTransport(() => Date.parse(RELEASE_FIXTURE_TIME)),
    policy: {
      allowedMimeTypes: ['text/css', 'text/html'],
      maxObjectBytes: 1_000_000,
      maxTenantBytes: 10_000_000,
    },
    signingSecret: 'fuma-release-postgres-fixture-signing-key',
    accessUrlBase: 'https://objects.fuma.invalid/redeem',
    nowMs: () => Date.parse(RELEASE_FIXTURE_TIME),
  })
}

async function seedManifest(
  storage: TenantObjectStorage,
  scope: FumaRepositoryScope,
  releaseId: string,
): Promise<ReturnType<typeof createReleaseFixtureManifest>> {
  const manifest = createReleaseFixtureManifest(scope, releaseId)
  for (const artifact of manifest.artifacts) {
    const bytes = artifact.logicalPath === '/index.html'
      ? RELEASE_FIXTURE_BYTES.html
      : RELEASE_FIXTURE_BYTES.css
    await storage.put({
      scope,
      key: artifact.objectKey,
      bytes,
      mimeType: artifact.mimeType,
      checksumSha256: artifact.contentHashSha256,
    })
  }
  return manifest
}

async function insertOwner(tx: DbClient, scope: FumaRepositoryScope): Promise<void> {
  await tx`
    insert into fuma_tenant_owner_keys (
      platform_id, owner_key, organization_id, workspace_id, site_id,
      generation, state, transfer_id, transfer_lock_id, transfer_fence
    ) values (
      ${scope.platformId}, ${scope.ownerKey}, ${scope.organizationId},
      ${scope.workspaceId}, ${scope.siteId}, ${scope.generation},
      'active', null, null, null
    )
  `
}

describe('FUMA-048 live PostgreSQL release acceptance', () => {
  it.skipIf(postgresUrl === undefined)(
    'executes durable replay and rejects manifest mutation, stale authority, and foreign activation',
    async () => {
      if (postgresUrl === undefined) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
      const admin = createPostgresClient(postgresUrl)
      const schema = `fuma_release_${process.pid}_${Date.now()}`
      const quotedSchema = quotedIdentifier(schema)
      await admin.unsafe(`create schema ${quotedSchema}`)
      const db = schemaClient(admin, schema)

      try {
        await db.transaction(async (tx) => {
          await tx.unsafe(`
            create table fuma_tenant_owner_keys (
              platform_id text not null,
              owner_key text not null,
              organization_id text not null,
              workspace_id text not null,
              site_id text not null,
              generation bigint not null check (generation > 0),
              state text not null check (state in ('active', 'transferring')),
              transfer_id text null,
              transfer_lock_id text null,
              transfer_fence bigint null,
              primary key (platform_id, owner_key),
              unique (platform_id, owner_key, organization_id, workspace_id, site_id)
            )
          `)
          await insertOwner(tx, RELEASE_FIXTURE_SCOPE_A)
          await insertOwner(tx, RELEASE_FIXTURE_SCOPE_B)
          await tx.unsafe(releasesMigration.sql)
        })

        const storage = releaseStorage()
        const { repository, service } = createPostgresReleaseComposition({
          db,
          objectStorage: storage,
          now: () => new Date(RELEASE_FIXTURE_TIME),
        })
        expect(repository.constructor.name).toBe('PostgresReleaseRepository')

        const releaseId = 'release-postgres-001'
        const manifest = await seedManifest(storage, RELEASE_FIXTURE_SCOPE_A, releaseId)
        const queued = await service.queue(RELEASE_FIXTURE_SCOPE_A, {
          releaseId,
          sourceSnapshotHashSha256: RELEASE_FIXTURE_SOURCE_HASH,
        })
        expect(await service.queue(RELEASE_FIXTURE_SCOPE_A, {
          releaseId,
          sourceSnapshotHashSha256: RELEASE_FIXTURE_SOURCE_HASH,
        })).toEqual(queued)
        const building = await service.startBuilding(RELEASE_FIXTURE_SCOPE_A, {
          releaseId,
          buildClaim: CLAIM,
        })
        expect(await service.startBuilding(RELEASE_FIXTURE_SCOPE_A, {
          releaseId,
          buildClaim: CLAIM,
        })).toEqual(building)
        const ready = await service.finalize(RELEASE_FIXTURE_SCOPE_A, {
          releaseId,
          buildClaim: CLAIM,
          manifest,
        })
        expect(await service.finalize(RELEASE_FIXTURE_SCOPE_A, {
          releaseId,
          buildClaim: CLAIM,
          manifest,
        })).toEqual(ready)

        await expect(db.transaction(async (tx) => {
          await tx`
            update fuma_releases
            set manifest_json = jsonb_set(manifest_json, '{artifactCount}', '999'::jsonb),
              version = version + 1
            where platform_id = ${RELEASE_FIXTURE_SCOPE_A.platformId}
              and owner_key = ${RELEASE_FIXTURE_SCOPE_A.ownerKey}
              and release_id = ${releaseId}
          `
        })).rejects.toThrow('release manifest is immutable')

        await expect(service.verify({
          ...RELEASE_FIXTURE_SCOPE_A,
          generation: RELEASE_FIXTURE_SCOPE_A.generation + 1,
        }, { releaseId })).rejects.toBeInstanceOf(ReleaseRepositoryError)
        await expect(service.activate(RELEASE_FIXTURE_SCOPE_B, { releaseId }))
          .rejects.toMatchObject({ code: 'not-found' })

        const activated = await service.activate(RELEASE_FIXTURE_SCOPE_A, { releaseId })
        const replayed = await service.activate(RELEASE_FIXTURE_SCOPE_A, { releaseId })
        expect(replayed.pointer).toEqual(activated.pointer)
        const durable = await db.transaction(async (tx) => {
          const pointers = await tx<{ release_id: string; version: string | number | bigint }>`
            select release_id, version from fuma_release_active_pointers
          `
          const roots = await tx<{ release_id: string; root_id: string; kind: string }>`
            select release_id, root_id, kind from fuma_release_retention_roots
          `
          return { pointers: pointers.rows, roots: roots.rows }
        })
        expect(durable.pointers).toHaveLength(1)
        expect(durable.pointers[0]).toMatchObject({ release_id: releaseId })
        expect(String(durable.pointers[0]?.version)).toBe('1')
        expect(durable.roots).toEqual([{ release_id: releaseId, root_id: 'active', kind: 'active' }])
        process.stdout.write('[FUMA-048 PostgreSQL demo] replay stable; manifest mutation, stale authority, and foreign activation denied\n')
      } finally {
        await admin.unsafe(`drop schema if exists ${quotedSchema} cascade`)
      }
    },
    30_000,
  )
})

import { describe, expect, it } from 'bun:test'
import type { DbClient, DbResult } from '../../../server/db/client'
import { createPostgresClient } from '../../../server/db/postgres'
import { freeHostsMigration } from '../../../server/fuma/db/migrations/000022_free_hosts'
import { freeHostAuthorityMigration } from '../../../server/fuma/db/migrations/000043_free_host_authority'
import { sha256Hex } from '../../../server/fuma/objectStorage'
import { createReleaseManifest } from '../../../server/fuma/releases'
import { releasesMigration } from '../../../server/fuma/db/migrations/000011_releases'
import { FreeHostService, PostgresFreeHostRepository } from '../../../server/fuma/freeHosts'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const NOW = '2026-07-26T12:00:00.000Z'

function quotedIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe PostgreSQL schema identifier.')
  return `"${value}"`
}

function schemaClient(admin: DbClient, schema: string): DbClient {
  const searchPath = `set local search_path to ${quotedIdentifier(schema)}, public`
  const bind = (db: DbClient): DbClient => {
    const query = (async <Row = Record<string, unknown>>(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<DbResult<Row>> => await db<Row>(strings, ...values)) as DbClient
    query.unsafe = async <Row = Record<string, unknown>>(sql: string, params?: unknown[]) => await db.unsafe<Row>(sql, params)
    query.transaction = async <T>(work: (tx: DbClient) => Promise<T>) => await db.transaction(async (tx) => {
      await tx.unsafe(searchPath)
      return await work(bind(tx))
    })
    return Object.assign(query, { dialect: 'postgres' as const })
  }
  return bind(admin)
}

describe('FUMA-050 live PostgreSQL free-host acceptance', () => {
  it.skipIf(postgresUrl === undefined)(
    'resolves only current unfenced owner generation and active immutable pointer',
    async () => {
      if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
      const admin = createPostgresClient(postgresUrl)
      const schema = `fuma_free_host_${process.pid}_${Date.now()}`
      await admin.unsafe(`create schema ${quotedIdentifier(schema)}`)
      const db = schemaClient(admin, schema)
      try {
        await db.transaction(async (tx) => {
          await tx.unsafe(`
            create table fuma_tenant_owner_keys (
              platform_id text not null, owner_key text not null,
              organization_id text not null, workspace_id text not null, site_id text not null,
              state text not null, generation bigint not null, transfer_id text null,
              transfer_lock_id text null, transfer_fence bigint null,
              primary key (platform_id, owner_key),
              unique (platform_id, owner_key, organization_id, workspace_id, site_id),
              unique (platform_id, organization_id, workspace_id, site_id)
            )
          `)
          await tx`insert into fuma_tenant_owner_keys values (
            'platform-fuma', 'owner-a', 'organization-a', 'workspace-a', 'site-a',
            'active', 3, null, null, null
          )`
          await tx.unsafe(releasesMigration.sql)
          await tx.unsafe(freeHostsMigration.sql)
          await tx.unsafe(freeHostAuthorityMigration.sql)
        })
        const bytes = new TextEncoder().encode('<h1>durable</h1>')
        const manifest = createReleaseManifest({
          releaseId: 'release-a', ownerKey: 'owner-a', siteId: 'site-a',
          sourceSnapshotHashSha256: 'a'.repeat(64), createdAt: NOW,
          artifacts: [{
            logicalPath: '/index.html', kind: 'html', contentHashSha256: sha256Hex(bytes),
            sizeBytes: bytes.byteLength, mimeType: 'text/html', references: [],
          }],
        })
        await db.transaction(async (tx) => {
          await tx`
            insert into fuma_releases (
              platform_id, owner_key, organization_id, workspace_id, site_id,
              release_id, source_snapshot_hash, status, build_job_id, build_job_fence,
              manifest_json, manifest_hash, failure_json, version, queued_at, building_at,
              ready_at, activated_at, failed_at, updated_at
            ) values (
              'platform-fuma', 'owner-a', 'organization-a', 'workspace-a', 'site-a',
              'release-a', ${'a'.repeat(64)}, 'active', 'job-a', 1,
              ${JSON.stringify(manifest)}::text::jsonb, ${manifest.manifestHashSha256}, null,
              4, ${NOW}, ${NOW}, ${NOW}, ${NOW}, null, ${NOW}
            )
          `
          await tx`
            insert into fuma_release_active_pointers values (
              'platform-fuma', 'owner-a', 'organization-a', 'workspace-a', 'site-a',
              'release-a', 1, ${NOW}
            )
          `
        })
        const repository = new PostgresFreeHostRepository(db)
        const service = new FreeHostService(repository, repository, () => new Date(NOW))
        const authority = {
          platformId: 'platform-fuma', organizationId: 'organization-a',
          workspaceId: 'workspace-a', siteId: 'site-a', ownerKey: 'owner-a', ownerGeneration: 3,
        }
        const record = await service.allocate({ ...authority, label: 'durable-a' })
        await expect(service.resolve(record.host)).resolves.toMatchObject({ releaseId: 'release-a' })
        const suspended = await service.setState({
          host: record.host, state: 'suspended', authority, expectedVersion: 1,
        })
        expect(suspended.version).toBe(2)
        await expect(service.resolve(record.host)).rejects.toMatchObject({ code: 'suspended' })
        await service.setState({
          host: record.host, state: 'active', authority, expectedVersion: 2,
        })
        await db.transaction(async (tx) => {
          await tx`update fuma_tenant_owner_keys set state = 'transferring',
            transfer_id = 'transfer-a', transfer_lock_id = 'lock-a', transfer_fence = 9
            where platform_id = 'platform-fuma' and owner_key = 'owner-a'`
        })
        await expect(service.resolve(record.host)).rejects.toMatchObject({ code: 'unknown' })
        await db.transaction(async (tx) => {
          await tx`update fuma_tenant_owner_keys set state = 'active', generation = 4,
            transfer_id = null, transfer_lock_id = null, transfer_fence = null
            where platform_id = 'platform-fuma' and owner_key = 'owner-a'`
        })
        await expect(service.resolve(record.host)).rejects.toMatchObject({ code: 'unknown' })
        process.stdout.write('[FUMA-050 PostgreSQL demo] active=release-a suspended=denied fence=denied stale-generation=denied\n')
      } finally {
        await admin.unsafe(`drop schema if exists ${quotedIdentifier(schema)} cascade`)
      }
    },
    30_000,
  )
})

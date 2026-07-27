import { describe, expect, test } from 'bun:test'
import type { DbClient, DbResult } from '../../../server/db/client'
import { createPostgresClient } from '../../../server/db/postgres'
import { releasesMigration } from '../../../server/fuma/db/migrations/000011_releases'
import { FakeObjectStorageTransport, FumaObjectStorage, sha256Hex, type TenantObjectStorage } from '../../../server/fuma/objectStorage'
import { createPostgresReleaseComposition, createReleaseManifest } from '../../../server/fuma/releases'
import { PostgresEdgePointerAuthority, PostgresEdgeReleaseReader, encodeEdgeHole } from '../../../server/fuma/edgeDelivery/postgres'
import type { EdgeRequestContext } from '../../../server/fuma/edgeDelivery/service'
import type { FumaRepositoryScope } from '../../../server/fuma/tenancy'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const NOW = '2040-01-01T00:00:00.000Z'
const scope: FumaRepositoryScope = Object.freeze({ platformId: 'platform', organizationId: 'organization', workspaceId: 'workspace', siteId: 'site', ownerKey: 'owner', generation: 1, state: 'active', transferFence: null })

function quoted(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe schema.')
  return `"${value}"`
}
function schemaClient(admin: DbClient, schema: string): DbClient {
  const searchPath = `set local search_path to ${quoted(schema)}, public`
  const bind = (db: DbClient): DbClient => {
    const query = (async <Row = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<DbResult<Row>> => await db<Row>(strings, ...values)) as DbClient
    query.unsafe = async <Row = Record<string, unknown>>(sql: string, params?: unknown[]) => await db.unsafe<Row>(sql, params)
    query.transaction = async <T>(work: (tx: DbClient) => Promise<T>) => await db.transaction(async (tx) => { await tx.unsafe(searchPath); return await work(bind(tx)) })
    return Object.assign(query, { dialect: 'postgres' as const })
  }
  return bind(admin)
}
function storage(): TenantObjectStorage {
  return new FumaObjectStorage({
    transport: new FakeObjectStorageTransport(() => Date.parse(NOW)),
    policy: { allowedMimeTypes: ['text/html'], maxObjectBytes: 1_000_000, maxTenantBytes: 10_000_000 },
    signingSecret: 'fuma-edge-live-acceptance-signing-key',
    accessUrlBase: 'https://objects.fuma.invalid/redeem',
    nowMs: () => Date.parse(NOW),
  })
}
async function ready(service: ReturnType<typeof createPostgresReleaseComposition>['service'], objects: TenantObjectStorage, releaseId: string, body: string, fence: string) {
  const bytes = new TextEncoder().encode(body)
  const manifest = createReleaseManifest({ releaseId, ownerKey: scope.ownerKey, siteId: scope.siteId, sourceSnapshotHashSha256: 'a'.repeat(64), createdAt: NOW, artifacts: [{ logicalPath: '/index.html', kind: 'html', contentHashSha256: sha256Hex(bytes), sizeBytes: bytes.byteLength, mimeType: 'text/html', references: [] }] })
  await objects.put({ scope, key: manifest.artifacts[0]!.objectKey, bytes, mimeType: 'text/html', checksumSha256: manifest.artifacts[0]!.contentHashSha256 })
  await service.queue(scope, { releaseId, sourceSnapshotHashSha256: 'a'.repeat(64) })
  const claim = { jobId: `job-${releaseId}`, fence }
  await service.startBuilding(scope, { releaseId, buildClaim: claim })
  await service.finalize(scope, { releaseId, buildClaim: claim, manifest })
  return manifest
}
function edgeContext(releaseId: string): EdgeRequestContext {
  return Object.freeze({ platformId: scope.platformId, organizationId: scope.organizationId, workspaceId: scope.workspaceId, siteId: scope.siteId, ownerKey: scope.ownerKey, ownerGeneration: scope.generation, host: 'tenant.fuma.co.ke', releaseId, path: '/index.html', memberId: null, accessFingerprint: 'b'.repeat(64), requestClaims: Object.freeze({ audience: 'anonymous' }) })
}

describe('FUMA-051 live PostgreSQL edge acceptance', () => {
  test.skipIf(postgresUrl === undefined)('rolls back exact pointer once, replays idempotently, and reads verified immutable holes', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_edge_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quoted(schema)}`)
    const db = schemaClient(admin, schema)
    try {
      await db.transaction(async (tx) => {
        await tx.unsafe(`create table fuma_tenant_owner_keys (platform_id text not null, owner_key text not null, organization_id text not null, workspace_id text not null, site_id text not null, generation bigint not null, state text not null, transfer_id text null, transfer_lock_id text null, transfer_fence bigint null, primary key(platform_id,owner_key), unique(platform_id,owner_key,organization_id,workspace_id,site_id))`)
        await tx`insert into fuma_tenant_owner_keys values (${scope.platformId},${scope.ownerKey},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.generation},'active',null,null,null)`
        await tx.unsafe(releasesMigration.sql)
      })
      const objects = storage()
      const composition = createPostgresReleaseComposition({ db, objectStorage: objects, now: () => new Date(NOW) })
      const hole = encodeEdgeHole('member-card', { contentId: 'post-1' })
      await ready(composition.service, objects, 'release-1', `<!doctype html><html><body><main>one ${hole}</main></body></html>`, '1')
      await composition.service.activate(scope, { releaseId: 'release-1' })
      await ready(composition.service, objects, 'release-2', '<!doctype html><html><body><main>two</main></body></html>', '2')
      await composition.service.activate(scope, { releaseId: 'release-2' })
      const pointers = new PostgresEdgePointerAuthority(composition.repository, composition.service, () => new Date(NOW))
      await pointers.rollback(edgeContext('release-2'), 'release-1', 'release-2')
      await pointers.rollback(edgeContext('release-2'), 'release-1', 'release-2')
      const read = await new PostgresEdgeReleaseReader(composition.repository, objects).read(edgeContext('release-1'))
      expect(new TextDecoder().decode(read.bytes)).toContain('one')
      expect(read.holes).toEqual([{ marker: hole, resolverId: 'member-card', input: { contentId: 'post-1' } }])
      const durable = await db.transaction(async (tx) => await tx<{ release_id: string; version: number }>`select release_id,version from fuma_release_active_pointers`)
      expect(durable.rows).toHaveLength(1)
      expect(durable.rows[0]).toMatchObject({ release_id: 'release-1' })
      expect(String(durable.rows[0]?.version)).toBe('3')
    } finally {
      await admin.unsafe(`drop schema if exists ${quoted(schema)} cascade`)
    }
  }, 30_000)
})

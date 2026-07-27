import { describe, expect, it } from 'bun:test'
import type { DbClient, DbResult } from '../../../server/db/client'
import { createPostgresClient } from '../../../server/db/postgres'
import { durableJobsMigration } from '../../../server/fuma/db/migrations/000002_durable_jobs'
import { editorDraftSequencesMigration } from '../../../server/fuma/db/migrations/000012_editor_draft_sequences'
import { publishingMigration } from '../../../server/fuma/db/migrations/000021_publishing'
import type { EditorSiteDocument } from '../../../server/fuma/editor/contracts'
import {
  FakeObjectStorageTransport,
  FumaObjectStorage,
  sha256Hex,
  type TenantObjectStorage,
} from '../../../server/fuma/objectStorage'
import {
  PostgresPublishAttemptAuthority,
  PostgresPublishSnapshotAuthority,
  publishSnapshotHash,
} from '../../../server/fuma/publishing/postgresAdapters'
import { CoreSemanticReleaseRenderer } from '../../../server/fuma/publishing/semanticRenderer'
import {
  AtomicPublishWorker,
  type PublishExecutionContext,
} from '../../../server/fuma/publishing/workerPublisher'
import { releasesMigration } from '../../../server/fuma/db/migrations/000011_releases'
import {
  createPostgresReleaseComposition,
  createReleaseManifest,
  releaseObjectKey,
} from '../../../server/fuma/releases'
import type { FumaRepositoryScope } from '../../../server/fuma/tenancy'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const NOW = '2026-07-26T12:00:00.000Z'
const scope: FumaRepositoryScope = {
  platformId: 'platform-1',
  organizationId: 'organization-1',
  workspaceId: 'workspace-1',
  siteId: 'site-1',
  ownerKey: 'owner-1',
  generation: 1,
  state: 'active',
  transferFence: null,
}

function quotedIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe test schema identifier.')
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

function document(): EditorSiteDocument {
  const root = {
    id: 'root',
    moduleId: 'base.body',
    props: {},
    breakpointOverrides: {},
    children: [],
    parentId: null,
    classIds: [],
  }
  const structural = { expandedFolders: [], emptyFolders: [], rowOrder: [] }
  const decorative = { folders: [], items: [] }
  return {
    site: {
      id: scope.siteId,
      name: 'Atomic publish acceptance',
      breakpoints: [{ id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor' }],
      settings: { shortcuts: {} },
      styleRules: {},
      files: [],
      explorer: {
        pages: structuredClone(structural),
        styles: structuredClone(structural),
        scripts: structuredClone(structural),
        templates: structuredClone(decorative),
        components: structuredClone(decorative),
      },
      packageJson: { dependencies: {}, devDependencies: {} },
      runtime: {
        dependencyLock: { version: 1, packages: {}, updatedAt: 1 },
        scripts: {},
        styles: {},
      },
      createdAt: 1,
      updatedAt: 2,
    },
    pages: [{
      id: 'page-1',
      slug: 'index',
      title: 'New atomic content',
      rootNodeId: root.id,
      nodes: { [root.id]: root },
    }],
    visualComponents: [],
    layouts: [],
  }
}

function storage(): TenantObjectStorage {
  return new FumaObjectStorage({
    transport: new FakeObjectStorageTransport(() => Date.parse(NOW)),
    policy: {
      allowedMimeTypes: ['text/html', 'text/css'],
      maxObjectBytes: 5_000_000,
      maxTenantBytes: 50_000_000,
    },
    signingSecret: 'fuma-049-postgres-acceptance-signing-secret',
    accessUrlBase: 'https://objects.fuma.invalid/redeem',
    nowMs: () => Date.parse(NOW),
  })
}

function execution(
  durable: Map<string, unknown>,
  fault?: PublishExecutionContext['fault'],
  fence = '9',
): PublishExecutionContext {
  return {
    jobId: 'job-publish-1',
    fence,
    async cancellationRequested() { return false },
    async durableResult(key) { return durable.get(key) ?? null },
    async commitDurableResult(key, value) {
      const existing = durable.get(key)
      if (existing !== undefined) return existing
      durable.set(key, value)
      return value
    },
    fault,
  }
}

async function seedOldRelease(
  objectStorage: TenantObjectStorage,
  releases: ReturnType<typeof createPostgresReleaseComposition>['service'],
): Promise<void> {
  const bytes = new TextEncoder().encode('<!doctype html><html><body>old</body></html>')
  const hash = sha256Hex(bytes)
  const releaseId = 'release-old'
  await objectStorage.put({
    scope,
    key: releaseObjectKey(releaseId, hash),
    bytes,
    mimeType: 'text/html',
    checksumSha256: hash,
  })
  const manifest = createReleaseManifest({
    releaseId,
    ownerKey: scope.ownerKey,
    siteId: scope.siteId,
    sourceSnapshotHashSha256: 'b'.repeat(64),
    artifacts: [{
      logicalPath: '/index.html',
      kind: 'html',
      contentHashSha256: hash,
      sizeBytes: bytes.byteLength,
      mimeType: 'text/html',
      references: [],
    }],
    createdAt: NOW,
  })
  const claim = { jobId: 'job-old', fence: '1' }
  await releases.queue(scope, { releaseId, sourceSnapshotHashSha256: 'b'.repeat(64) })
  await releases.startBuilding(scope, { releaseId, buildClaim: claim })
  await releases.finalize(scope, { releaseId, buildClaim: claim, manifest })
  await releases.activate(scope, { releaseId })
}

async function activePointer(db: DbClient) {
  return await db.transaction(async (tx) => (
    await tx<{ release_id: string; version: string | number | bigint }>`
      select release_id, version from fuma_release_active_pointers
      where platform_id = ${scope.platformId} and owner_key = ${scope.ownerKey}
    `
  ).rows[0])
}

describe('FUMA-049 disposable PostgreSQL atomic publish acceptance', () => {
  it.skipIf(postgresUrl === undefined)(
    'fails, retains old pointer, retries exact artifacts, and switches once',
    async () => {
      if (postgresUrl === undefined) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
      const admin = createPostgresClient(postgresUrl)
      const schema = `fuma_publish_${process.pid}_${Date.now()}`
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
          await tx`
            insert into fuma_tenant_owner_keys values (
              ${scope.platformId}, ${scope.ownerKey}, ${scope.organizationId},
              ${scope.workspaceId}, ${scope.siteId}, ${scope.generation},
              'active', null, null, null
            )
          `
          await tx.unsafe(durableJobsMigration.sql)
          await tx.unsafe(releasesMigration.sql)
          await tx.unsafe(editorDraftSequencesMigration.sql)
          await tx.unsafe(publishingMigration.sql)
          await tx`
            insert into fuma_jobs (
              id, organization_id, site_id, kind, payload_json, status,
              priority, organization_weight, site_weight, max_attempts,
              attempt_count, run_at, claimed_by, claim_expires_at, fence,
              created_at, updated_at
            ) values (
              'job-publish-1', ${scope.organizationId}, ${scope.siteId},
              'fuma.publish-release', '{}'::jsonb, 'running', 0, 1, 1, 5, 1,
              ${NOW}, 'worker-1', '2099-01-01T00:00:00.000Z', 9, ${NOW}, ${NOW}
            )
          `
        })

        const source = document()
        const sourceHash = publishSnapshotHash(source)
        await db.transaction(async (tx) => {
          await tx`
            insert into fuma_editor_draft_heads (
              platform_id, owner_key, owner_generation, profile_id,
              resource_kind, logical_id, sequence
            ) values (
              ${scope.platformId}, ${scope.ownerKey}, ${scope.generation}, 'website',
              'site-document', ${scope.siteId}, 1
            )
          `
          await tx.unsafe(`
            insert into fuma_editor_draft_mutations (
              platform_id, owner_key, owner_generation, profile_id, resource_kind,
              logical_id, mutation_id, request_hash, expected_sequence,
              accepted_sequence, document_json
            ) values ($1, $2, $3, $4, 'site-document', $5, $6, $7, 0, 1, (($8::jsonb #>> '{}')::jsonb))
          `, [
            scope.platformId,
            scope.ownerKey,
            scope.generation,
            'website',
            scope.siteId,
            'snapshot-1',
            'c'.repeat(64),
            JSON.stringify(source),
          ])
        })

        const objectStorage = storage()
        const releases = createPostgresReleaseComposition({
          db,
          objectStorage,
          now: () => new Date(NOW),
        })
        await seedOldRelease(objectStorage, releases.service)
        const worker = new AtomicPublishWorker({
          snapshots: new PostgresPublishSnapshotAuthority(db),
          renderer: new CoreSemanticReleaseRenderer(),
          storage: objectStorage,
          releases: releases.service,
          attempts: new PostgresPublishAttemptAuthority(db, () => new Date(NOW)),
          now: () => new Date(NOW),
        })
        const publishJob = {
          releaseId: 'release-new',
          sourceSnapshotId: 'snapshot-1',
          sourceSnapshotHashSha256: sourceHash,
          auditCorrelationId: 'audit-publish-1',
        }
        const durable = new Map<string, unknown>()

        await expect(worker.execute(
          { scope, profileId: 'website' },
          publishJob,
          execution(durable, async (boundary) => {
            if (boundary === 'before-activation') throw new Error('deterministic activation fault')
          }),
        )).rejects.toThrow('deterministic activation fault')
        expect(await activePointer(db)).toMatchObject({ release_id: 'release-old' })
        await db.transaction(async (tx) => {
          await tx`
            update fuma_jobs set fence = 10, attempt_count = 2,
              claimed_by = 'worker-2', updated_at = ${NOW}
            where id = 'job-publish-1' and fence = 9
          `
        })

        const manifest = await worker.execute(
          { scope, profileId: 'website' },
          publishJob,
          execution(durable, undefined, '10'),
        )
        const switched = await activePointer(db)
        expect(switched).toMatchObject({ release_id: 'release-new' })
        expect(String(switched?.version)).toBe('2')

        await worker.execute(
          { scope, profileId: 'website' },
          publishJob,
          execution(durable, undefined, '10'),
        )
        const replayed = await activePointer(db)
        expect(replayed).toEqual(switched)
        const attempts = await db.transaction(async (tx) => await tx<{ count: string }>`
          select count(*)::text as count from fuma_publish_attempts
        `)
        expect(attempts.rows).toEqual([{ count: '1' }])
        const objects = await objectStorage.list(scope, 'publish/releases/release-new/objects')
        expect(objects.objects).toHaveLength(new Set(manifest.artifacts.map((item) => item.objectKey)).size)
        process.stdout.write('[FUMA-049 PostgreSQL demo] fault served release-old; retry switched once to release-new; replay pointer stable\n')
      } finally {
        await admin.unsafe(`drop schema if exists ${quotedSchema} cascade`)
      }
    },
    30_000,
  )
})

import { describe, expect, test } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import {
  PostgresNextSourceAdaptationAuthority,
  PostgresNextSourceDraftRepository,
} from '../../../server/fuma/nextSource'
import {
  ObjectStorageError,
  sha256Hex,
  type ObjectMetadata,
  type PutObjectInput,
  type TenantObjectStorage,
} from '../../../server/fuma/objectStorage'
import {
  NextSourceAdaptationService,
  ingestLocalNextSource,
  type FileMap,
} from '@core/siteImport'
import { editorDraftSequencesMigration } from '../../../server/fuma/db/migrations/000012_editor_draft_sequences'
import { editorResourcesMigration } from '../../../server/fuma/db/migrations/000010_editor_resources'
import { EditorScopedRepository, PostgresEditorScopedStorage } from '../../../server/fuma/editor'
import { NextSourceEditorCommitService } from '../../../server/fuma/nextSource/commit'
import { releasesMigration } from '../../../server/fuma/db/migrations/000011_releases'
import { publishingMigration } from '../../../server/fuma/db/migrations/000021_publishing'
import { createReleaseManifest, releaseObjectKey } from '../../../server/fuma/releases'
import { CoreSemanticReleaseRenderer } from '../../../server/fuma/publishing/semanticRenderer'
import { publishSnapshotHash } from '../../../server/fuma/publishing/postgresAdapters'
import { NextSourceReleaseExportService } from '../../../server/fuma/nextSource/export'
import { strFromU8, unzipSync } from 'fflate'
import { nextSourcePortabilityAuthorityMigration } from '../../../server/fuma/db/migrations/000078_next_source_portability_authority'
import {
  HOSTED_MIGRATION_CHECKSUMS,
  hostedMigrations,
  runnableHostedMigrations,
} from '../../../server/fuma/db/migrations'
import {
  HOSTED_MIGRATION_CHECKSUM_SENTINEL,
  assertHostedMigrationIsAdditive,
  assertHostedMigrationManifest,
  hostedMigrationChecksum,
  nextHostedMigrationId,
} from '../../../server/fuma/db/migrationPolicy'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const destination = Object.freeze({ organizationId: 'organization-pg', workspaceId: 'workspace-pg', siteId: 'site-pg' })

function quote(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe PostgreSQL identifier.')
  return `"${value}"`
}

function scoped(connection: string, schema: string, role: string): string {
  const url = new URL(connection)
  url.searchParams.set('options', `-c role=${role} -c search_path=${schema},public`)
  return url.toString()
}

function compact(value: string): string {
  return value.replaceAll(/\s+/g, ' ').trim().toLowerCase()
}

function memoryObjects(): Readonly<{ storage: TenantObjectStorage; keys(): readonly string[] }> {
  const values = new Map<string, Readonly<{ bytes: Uint8Array; metadata: ObjectMetadata }>>()
  const storedKey = (scope: Readonly<{ organizationId: string; workspaceId: string; siteId: string }>, key: string) => `${scope.organizationId}/${scope.workspaceId}/${scope.siteId}/${key}`
  const storage = {
    async put(input: PutObjectInput) {
      const key = storedKey(input.scope, input.key)
      if (values.has(key)) throw new ObjectStorageError('already_exists', 'Object already exists.')
      const metadata = Object.freeze({ key: input.key, sizeBytes: input.bytes.byteLength, mimeType: input.mimeType, checksumSha256: input.checksumSha256, createdAt: '2026-08-03T10:00:00.000Z' })
      values.set(key, { bytes: input.bytes.slice(), metadata })
      return metadata
    },
    async get(scope: Parameters<TenantObjectStorage['get']>[0], key: string) {
      const value = values.get(storedKey(scope, key))
      if (!value) throw new ObjectStorageError('not_found', 'Object is unavailable.')
      return value.bytes.slice()
    },
    async head(scope: Parameters<TenantObjectStorage['head']>[0], key: string) {
      const value = values.get(storedKey(scope, key))
      if (!value) throw new ObjectStorageError('not_found', 'Object is unavailable.')
      return value.metadata
    },
  } as TenantObjectStorage
  return Object.freeze({ storage, keys: () => Object.freeze([...values.keys()].sort()) })
}

describe('FUMA-077 candidate migration 000078', () => {
  test('occupies only the unaccepted sentinel slot after finalized 000077', () => {
    expect(hostedMigrations.at(-1)).toBe(nextSourcePortabilityAuthorityMigration)
    expect(runnableHostedMigrations.at(-1)?.id).toBe('000077_public_handoff_authority')
    expect(HOSTED_MIGRATION_CHECKSUMS[nextSourcePortabilityAuthorityMigration.id]).toBe(HOSTED_MIGRATION_CHECKSUM_SENTINEL)
    expect(hostedMigrationChecksum(nextSourcePortabilityAuthorityMigration.sql)).not.toBe(HOSTED_MIGRATION_CHECKSUM_SENTINEL)
    expect(nextHostedMigrationId(runnableHostedMigrations, 'release followup')).toBe('000078_release_followup')
    expect(() => assertHostedMigrationIsAdditive(nextSourcePortabilityAuthorityMigration)).not.toThrow()
    expect(() => assertHostedMigrationManifest(hostedMigrations, HOSTED_MIGRATION_CHECKSUMS)).not.toThrow()
  })

  test('stores source and patch bodies only in hash-bound tenant objects and fences every mutable transition', () => {
    const sql = compact(nextSourcePortabilityAuthorityMigration.sql)
    expect(sql).not.toContain('patches_json')
    expect(sql).toContain('patch_object_key text not null')
    expect(sql).toContain("^imports/next-source/revisions/[a-f0-9]{64}\\.zip$")
    expect(sql).toContain("^imports/next-source/fixes/[a-f0-9]{64}\\.zip$")
    expect(sql).toContain("^exports/next-source/[a-f0-9]{64}\\.zip$")
    expect(sql).toContain('references fuma_tenant_owner_keys(platform_id,owner_key,organization_id,workspace_id,site_id,generation)')
    expect(sql).toContain('references fuma_next_source_revisions_v1(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,revision_id)')
    expect(sql).toContain('next source immutable evidence is append-only')
    expect(sql).toContain('executable next source fixes require owner confirmation')
    expect(sql).toContain('invalid next source export transition')
    expect(sql).toContain('create table fuma_next_source_editor_commits_v1')
    expect(sql).toContain('references fuma_editor_draft_mutations(platform_id,owner_key,owner_generation,profile_id,resource_kind,logical_id,mutation_id)')
    expect(sql.match(/before update or delete/g)).toHaveLength(6)
  })
})

describe('FUMA-077 optional native PostgreSQL acceptance', () => {
  test.skipIf(!postgresUrl)('applies under a disposable role, rejects raw-source columns and illegal mutations, and removes role/schema', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const suffix = `${process.pid}_${Date.now()}`
    const role = `fuma_next_role_${suffix}`
    const schema = `fuma_next_schema_${suffix}`
    await admin.unsafe(`create role ${quote(role)} nologin`)
    await admin.unsafe(`create schema ${quote(schema)} authorization ${quote(role)}`)
    try {
      const db = createPostgresClient(scoped(postgresUrl, schema, role))
      await db.unsafe(`
          create table fuma_tenant_owner_keys(
            platform_id text not null,owner_key text not null,organization_id text not null,workspace_id text not null,site_id text not null,generation bigint not null,
            unique(platform_id,owner_key),
            unique(platform_id,owner_key,organization_id,workspace_id,site_id,generation)
          );
          create table fuma_releases(
            platform_id text not null,owner_key text not null,release_id text not null,
            primary key(platform_id,owner_key,release_id)
          );
          insert into fuma_tenant_owner_keys values ('platform-pg','owner-pg','organization-pg','workspace-pg','site-pg',3);
          insert into fuma_releases values ('platform-pg','owner-pg','release-pg');
        `)
        await db.unsafe(editorDraftSequencesMigration.sql)
        await db.unsafe(nextSourcePortabilityAuthorityMigration.sql)

        const revision = {
          revisionId: 'next-draft:revision-pg',
          destination,
          sourceHashSha256: 'a'.repeat(64),
          state: 'draft',
        }
        await db.unsafe(`insert into fuma_next_source_revisions_v1(
          revision_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,source_hash_sha256,object_key,object_hash_sha256,object_size_bytes,revision_json,state,parent_revision_id,created_at
        ) values($1,'platform-pg','organization-pg','workspace-pg','site-pg','owner-pg',3,'website',$2,$3,$4,100,$5::text::jsonb,'draft',null,'2026-08-03T10:00:00Z')`, [revision.revisionId, revision.sourceHashSha256, `imports/next-source/revisions/${'b'.repeat(64)}.zip`, 'b'.repeat(64), JSON.stringify(revision)])

        const ingest = { receiptId: 'next-ingest:receipt-pg', destination }
        await db.unsafe(`insert into fuma_next_source_ingest_receipts_v1(
          receipt_id,revision_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,receipt_json,created_at
        ) values($1,$2,'platform-pg','organization-pg','workspace-pg','site-pg','owner-pg',3,'website',$3::text::jsonb,'2026-08-03T10:00:00Z')`, [ingest.receiptId, revision.revisionId, JSON.stringify(ingest)])

        const proposed = {
          receiptId: 'next-fix:receipt-pg',
          authority: { operationId: 'operation-pg', sourceRevisionId: revision.revisionId, ownerGeneration: 3, destination },
          executableChange: true,
          state: 'proposed',
          confirmationActorId: null,
          confirmedAt: null,
        }
        await db.unsafe(`insert into fuma_next_source_fixes_v1(
          receipt_id,source_revision_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,operation_id,receipt_json,patch_object_key,patch_object_hash_sha256,patch_object_size_bytes,state,created_at,confirmed_at
        ) values($1,$2,'platform-pg','organization-pg','workspace-pg','site-pg','owner-pg',3,'website','operation-pg',$3::text::jsonb,$4,$5,120,'proposed','2026-08-03T10:00:00Z',null)`, [proposed.receiptId, revision.revisionId, JSON.stringify(proposed), `imports/next-source/fixes/${'c'.repeat(64)}.zip`, 'c'.repeat(64)])

        const illegalApplied = { ...proposed, state: 'applied' }
        await expect(db.unsafe(`update fuma_next_source_fixes_v1 set receipt_json=$1::text::jsonb,state='applied',version=version+1 where receipt_id=$2`, [JSON.stringify(illegalApplied), proposed.receiptId])).rejects.toThrow('owner confirmation')

        const confirmed = { ...proposed, state: 'owner-confirmed', confirmationActorId: 'owner-user-pg', confirmedAt: '2026-08-03T10:01:00.000Z' }
        await db.unsafe(`update fuma_next_source_fixes_v1 set receipt_json=$1::text::jsonb,state='owner-confirmed',confirmed_at=$2,version=version+1 where receipt_id=$3`, [JSON.stringify(confirmed), confirmed.confirmedAt, proposed.receiptId])
        const applied = { ...confirmed, state: 'applied' }
        await db.unsafe(`update fuma_next_source_fixes_v1 set receipt_json=$1::text::jsonb,state='applied',version=version+1 where receipt_id=$2`, [JSON.stringify(applied), proposed.receiptId])

        const manifest = {
          exportId: 'next-export:export-pg',
          releaseId: 'release-pg',
          releaseHashSha256: '1'.repeat(64),
          sourceSnapshotId: 'snapshot-pg',
          sourceSnapshotHashSha256: 'f'.repeat(64),
          documentHashSha256: 'e'.repeat(64),
          sourceRevisionId: revision.revisionId,
          destination,
        }
        await db.unsafe(`insert into fuma_next_source_exports_v1(
          export_id,revision_id,release_id,source_snapshot_id,source_snapshot_hash_sha256,document_hash_sha256,
          platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,
          object_key,object_hash_sha256,object_size_bytes,manifest_json,state,created_at
        ) values($1,$2,'release-pg',$3,$4,$5,'platform-pg','organization-pg','workspace-pg','site-pg','owner-pg',3,'website',$6,$7,200,$8::text::jsonb,'artifact-created','2026-08-03T10:02:00Z')`, [manifest.exportId, revision.revisionId, manifest.sourceSnapshotId, manifest.sourceSnapshotHashSha256, manifest.documentHashSha256, `exports/next-source/${'d'.repeat(64)}.zip`, 'd'.repeat(64), JSON.stringify(manifest)])
        await expect(db.unsafe(`update fuma_next_source_exports_v1 set state='github-exported',version=version+1 where export_id=$1`, [manifest.exportId])).rejects.toThrow('Invalid Next source export transition')
        const githubCommand = {
          installationId: '98765',
          request: {
            owner: 'owner', repository: 'repo', baseBranch: 'main', baseCommitSha: '2'.repeat(40),
            branch: 'fuma/export-pg', title: 'Export portable site', body: '',
          },
        }
        await db.unsafe(`update fuma_next_source_exports_v1 set state='github-pending',github_operation_id='github-operation-pg',github_request_json=$1::text::jsonb,version=version+1 where export_id=$2`, [JSON.stringify(githubCommand), manifest.exportId])
        await db.unsafe(`update fuma_next_source_exports_v1 set state='github-exported',github_receipt_json='{"pullRequestNumber":1}'::text::jsonb,exported_at='2026-08-03T10:03:00Z',version=version+1 where export_id=$1`, [manifest.exportId])

        await expect(db.unsafe(`update fuma_next_source_revisions_v1 set object_key=$1 where revision_id=$2`, [`imports/next-source/revisions/${'e'.repeat(64)}.zip`, revision.revisionId])).rejects.toThrow('append-only')
        await expect(db.unsafe(`delete from fuma_next_source_revisions_v1 where revision_id=$1`, [revision.revisionId])).rejects.toThrow('append-only')
        await expect(db.unsafe(`update fuma_next_source_ingest_receipts_v1 set receipt_json=receipt_json`)).rejects.toThrow('append-only')
        await expect(db.unsafe(`delete from fuma_next_source_ingest_receipts_v1`)).rejects.toThrow('append-only')
        await expect(db.unsafe(`delete from fuma_next_source_fixes_v1`)).rejects.toThrow('append-only')
        await expect(db.unsafe(`delete from fuma_next_source_exports_v1`)).rejects.toThrow('append-only')

        const columns = await db<{ column_name: string }>`select column_name from information_schema.columns where table_schema=current_schema() and table_name='fuma_next_source_fixes_v1' order by column_name`
        expect(columns.rows.map((row) => row.column_name)).not.toContain('patches_json')
        expect(columns.rows.map((row) => row.column_name)).toContain('patch_object_key')
        const material = await db<{ material: string }>`select concat_ws('|',(select string_agg(revision_json::text,'') from fuma_next_source_revisions_v1),(select string_agg(receipt_json::text,'') from fuma_next_source_fixes_v1),(select string_agg(manifest_json::text,'') from fuma_next_source_exports_v1)) material`
        expect(material.rows[0]?.material).not.toContain('const privateSource')
        const counts = await db<{ revisions: string; ingests: string; fixes: string; exports: string }>`select (select count(*) from fuma_next_source_revisions_v1)::text revisions,(select count(*) from fuma_next_source_ingest_receipts_v1)::text ingests,(select count(*) from fuma_next_source_fixes_v1)::text fixes,(select count(*) from fuma_next_source_exports_v1)::text exports`
        expect(counts.rows[0]).toEqual({ revisions: '1', ingests: '1', fixes: '1', exports: '1' })
    } finally {
      await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`)
      await admin.unsafe(`drop role if exists ${quote(role)}`)
    }
    const leftovers = await admin<{ roles: string; schemas: string }>`select (select count(*) from pg_roles where rolname=${role})::text roles,(select count(*) from pg_namespace where nspname=${schema})::text schemas`
    expect(leftovers.rows[0]).toEqual({ roles: '0', schemas: '0' })
    process.stdout.write('[FUMA-077 PostgreSQL] role=0 schemas=0 revisions=1 fixes=1 exports=1 immutable=6 rawSourceColumns=0\n')
  }, 120_000)

  test.skipIf(!postgresUrl)('round-trips analyzed revisions and confirmed fixes through PostgreSQL plus tenant object storage', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const suffix = `${process.pid}_${Date.now()}`
    const role = `fuma_next_repo_role_${suffix}`
    const schema = `fuma_next_repo_schema_${suffix}`
    await admin.unsafe(`create role ${quote(role)} nologin`)
    await admin.unsafe(`create schema ${quote(schema)} authorization ${quote(role)}`)
    try {
      const db = createPostgresClient(scoped(postgresUrl, schema, role))
      await db.unsafe(`
        create table fuma_tenant_owner_keys(
          platform_id text not null,owner_key text not null,organization_id text not null,workspace_id text not null,site_id text not null,generation bigint not null,
          unique(platform_id,owner_key),
          unique(platform_id,owner_key,organization_id,workspace_id,site_id,generation)
        );
        create table fuma_releases(
          platform_id text not null,owner_key text not null,release_id text not null,
          primary key(platform_id,owner_key,release_id)
        );
        insert into fuma_tenant_owner_keys values ('platform-pg','owner-pg','organization-pg','workspace-pg','site-pg',3);
      `)
      await db.unsafe(editorDraftSequencesMigration.sql)
        await db.unsafe(nextSourcePortabilityAuthorityMigration.sql)
      const objects = memoryObjects()
      const scope = Object.freeze({
        platformId: 'platform-pg', organizationId: destination.organizationId,
        workspaceId: destination.workspaceId, siteId: destination.siteId,
        ownerKey: 'owner-pg', ownerGeneration: 3, profileId: 'website',
      })
      const repository = new PostgresNextSourceDraftRepository({ db, storage: objects.storage, scope })
      const sourceText = "import axios from 'axios'\nexport default function Page(){return <main>Unsafe dependency</main>}\n"
      const sourceMap: FileMap = { files: {
        'package.json': { bytes: new TextEncoder().encode(JSON.stringify({ dependencies: { next: '16.2.9', react: '19.2.5', axios: '1.0.0' } })) },
        'app/page.tsx': { bytes: new TextEncoder().encode(sourceText) },
      } }
      const ingested = await ingestLocalNextSource({ kind: 'file-map', name: 'repository-acceptance', fileMap: sourceMap }, destination, new Date('2026-08-03T10:00:00.000Z'))
      const ids = ['root-revision', 'fix-receipt', 'child-revision']
      const service = new NextSourceAdaptationService({
        repository,
        authority: new PostgresNextSourceAdaptationAuthority({ db, scope }),
        ownerConfirmation: { async verifyOwner() { return { active: true, direct: true, impersonating: false, ownerGeneration: 3 } } },
        now: () => new Date('2026-08-03T10:01:00.000Z'),
        generateId: () => ids.shift() ?? 'unexpected-id',
      })
      const revision = await service.createDraft(ingested.fileMap, { destination, provenance: ingested.receipt.provenance })
      await repository.putIngestReceipt(revision.revisionId, ingested.receipt)
      const diagnostic = revision.analysis.diagnostics.find((item) => item.severity === 'blocking')
      expect(diagnostic).toBeDefined()
      const replacement = 'export default function Page(){return <main>Repository fixed output</main>}\n'
      const proposed = await service.proposeFix({
        authority: {
          kind: 'deterministic', actorId: 'fuma-next-source-policy', operationId: 'operation-repository-pg',
          sourceRevisionId: revision.revisionId, destination, ownerGeneration: 3,
          capability: 'source.mutate', meteringReservationId: null,
        },
        diagnosticIds: [diagnostic!.id],
        patches: [{ path: 'app/page.tsx', expectedSha256: sha256Hex(new TextEncoder().encode(sourceText)), replacement }],
      })
      expect(proposed.state).toBe('proposed')
      const confirmed = await service.confirmFix({ receiptId: proposed.receiptId, ownerActorId: 'owner-reviewer-pg' })
      expect(confirmed.state).toBe('owner-confirmed')
      const child = await service.applyFix(proposed.receiptId)
      expect(child.parentRevisionId).toBe(revision.revisionId)
      expect(child.sourceHashSha256).not.toBe(revision.sourceHashSha256)
      expect((await repository.getFix(proposed.receiptId))?.receipt.state).toBe('applied')
      expect(new TextDecoder().decode((await repository.getRevision(child.revisionId))!.files.files['app/page.tsx']!.bytes)).toBe(replacement)
      expect(objects.keys().filter((key) => key.includes('/imports/next-source/revisions/'))).toHaveLength(2)
      expect(objects.keys().filter((key) => key.includes('/imports/next-source/fixes/'))).toHaveLength(1)

      const columns = await db<{ column_name: string }>`select column_name from information_schema.columns where table_schema=current_schema() and table_name='fuma_next_source_fixes_v1' order by column_name`
      expect(columns.rows.map((row) => row.column_name)).not.toContain('patches_json')
      const material = await db<{ material: string }>`select concat_ws('|',(select string_agg(revision_json::text,'') from fuma_next_source_revisions_v1),(select string_agg(receipt_json::text,'') from fuma_next_source_fixes_v1)) material`
      expect(material.rows[0]?.material).not.toContain(replacement.trim())
      const otherScope = new PostgresNextSourceDraftRepository({ db, storage: objects.storage, scope: { ...scope, organizationId: 'organization-other' } })
      expect(await otherScope.getRevision(revision.revisionId)).toBeNull()
    } finally {
      await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`)
      await admin.unsafe(`drop role if exists ${quote(role)}`)
    }
    const leftovers = await admin<{ roles: string; schemas: string }>`select (select count(*) from pg_roles where rolname=${role})::text roles,(select count(*) from pg_namespace where nspname=${schema})::text schemas`
    expect(leftovers.rows[0]).toEqual({ roles: '0', schemas: '0' })
    process.stdout.write('[FUMA-077 repository PostgreSQL] role=0 schemas=0 revisions=2 fixes=1 patchObjects=1 rawSourceColumns=0\n')
  }, 120_000)

  test.skipIf(!postgresUrl)('commits one hash-bound static projection through the canonical sequenced editor mutation stream', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const suffix = `${process.pid}_${Date.now()}`
    const role = `fuma_next_commit_role_${suffix}`
    const schema = `fuma_next_commit_schema_${suffix}`
    await admin.unsafe(`create role ${quote(role)} nologin`)
    await admin.unsafe(`create schema ${quote(schema)} authorization ${quote(role)}`)
    try {
      const db = createPostgresClient(scoped(postgresUrl, schema, role))
      await db.unsafe(`
        create table fuma_tenant_owner_keys(
          platform_id text not null,owner_key text not null,organization_id text not null,
          workspace_id text not null,site_id text not null,generation bigint not null,
          state text not null,transfer_id text null,transfer_lock_id text null,transfer_fence bigint null,
          unique(platform_id,owner_key),
          unique(platform_id,owner_key,organization_id,workspace_id,site_id),
          unique(platform_id,owner_key,organization_id,workspace_id,site_id,generation)
        );
        insert into fuma_tenant_owner_keys(
          platform_id,owner_key,organization_id,workspace_id,site_id,generation,state
        ) values ('platform-pg','owner-pg','organization-pg','workspace-pg','site-pg',3,'active');
      `)
      await db.unsafe(editorResourcesMigration.sql)
      await db.unsafe(editorDraftSequencesMigration.sql)
      await db.unsafe(releasesMigration.sql)
      await db.unsafe(publishingMigration.sql)
      await db.unsafe(nextSourcePortabilityAuthorityMigration.sql)
      const objects = memoryObjects()
      const boundScope = Object.freeze({
        platformId: 'platform-pg', organizationId: destination.organizationId,
        workspaceId: destination.workspaceId, siteId: destination.siteId,
        ownerKey: 'owner-pg', ownerGeneration: 3, profileId: 'website',
      })
      const sourceRepository = new PostgresNextSourceDraftRepository({ db, storage: objects.storage, scope: boundScope })
      const sourceMap: FileMap = { files: {
        'app/page.tsx': { bytes: new TextEncoder().encode('export default function Page(){return <main><h1>Native import</h1><p>Exact source</p></main>}') },
        'app/global.css': { bytes: new TextEncoder().encode('main { max-width: 60rem; }') },
      } }
      const ingested = await ingestLocalNextSource({ kind: 'file-map', name: 'native-commit', fileMap: sourceMap }, destination, new Date('2026-08-03T10:00:00.000Z'))
      const adaptation = new NextSourceAdaptationService({
        repository: sourceRepository,
        authority: new PostgresNextSourceAdaptationAuthority({ db, scope: boundScope }),
        ownerConfirmation: { async verifyOwner() { return { active: false, direct: false, impersonating: false, ownerGeneration: 0 } } },
        now: () => new Date('2026-08-03T10:00:00.000Z'),
        generateId: () => 'native-commit-revision',
      })
      const revision = await adaptation.createDraft(ingested.fileMap, { destination, provenance: ingested.receipt.provenance })
      expect(revision.analysis.blocking).toBe(false)
      const editor = new EditorScopedRepository(new PostgresEditorScopedStorage(db)).forScope({
        platformId: boundScope.platformId,
        organizationId: boundScope.organizationId,
        workspaceId: boundScope.workspaceId,
        siteId: boundScope.siteId,
        ownerKey: boundScope.ownerKey,
        generation: boundScope.ownerGeneration,
        state: 'active',
        transferFence: null,
        profileId: boundScope.profileId,
        editorSessionId: 'a'.repeat(64),
      })
      const commits = new NextSourceEditorCommitService({
        db,
        scope: boundScope,
        sources: sourceRepository,
        editor,
        now: () => new Date('2026-08-03T10:05:00.000Z'),
      })
      const committed = await commits.commit({ revisionId: revision.revisionId, expectedSequence: 0, actorId: 'owner-user-pg' })
      expect(committed.outcome).toBe('committed')
      if (committed.outcome !== 'committed') throw new Error('Commit unexpectedly conflicted.')
      expect(committed.replayed).toBe(false)
      expect(committed.receipt.sourceHashSha256).toBe(revision.sourceHashSha256)
      expect(committed.receipt.acceptedSequence).toBe(1)
      const snapshot = await editor.loadDraft()
      expect(snapshot.sequence).toBe(1)
      expect(snapshot.document?.site.id).toBe(destination.siteId)
      expect(snapshot.document?.pages[0]?.title).toBe('Native import')
      const replay = await commits.commit({ revisionId: revision.revisionId, expectedSequence: 0, actorId: 'owner-user-pg' })
      expect(replay.outcome).toBe('committed')
      if (replay.outcome !== 'committed') throw new Error('Replay unexpectedly conflicted.')
      expect(replay.replayed).toBe(true)
      expect(replay.receipt).toEqual(committed.receipt)
      const counts = await db<{ mutations: string; commits: string }>`select
        (select count(*) from fuma_editor_draft_mutations)::text mutations,
        (select count(*) from fuma_next_source_editor_commits_v1)::text commits`
      expect(counts.rows[0]).toEqual({ mutations: '1', commits: '1' })
      await expect(db.unsafe(`update fuma_next_source_editor_commits_v1 set actor_id=actor_id`)).rejects.toThrow('append-only')

      if (!snapshot.document) throw new Error('Committed editor snapshot is unavailable.')
      const snapshotHash = publishSnapshotHash(snapshot.document)
      const releaseId = 'release-native-pg'
      const releaseObjects = memoryObjects()
      const rendered = []
      const releaseScope = {
        platformId: boundScope.platformId,
        organizationId: boundScope.organizationId,
        workspaceId: boundScope.workspaceId,
        siteId: boundScope.siteId,
        ownerKey: boundScope.ownerKey,
        generation: boundScope.ownerGeneration,
        state: 'active' as const,
        transferFence: null,
      }
      for await (const artifact of new CoreSemanticReleaseRenderer().render({ scope: releaseScope, profileId: 'website' }, {
        id: committed.receipt.mutationId,
        hashSha256: snapshotHash,
        immutableRevision: String(snapshot.sequence),
        document: snapshot.document,
      })) {
        rendered.push(artifact)
        const hash = sha256Hex(artifact.bytes)
        await releaseObjects.storage.put({
          scope: destination,
          key: releaseObjectKey(releaseId, hash),
          bytes: artifact.bytes,
          mimeType: artifact.mimeType,
          checksumSha256: hash,
        })
      }
      const releaseManifest = createReleaseManifest({
        releaseId,
        ownerKey: boundScope.ownerKey,
        siteId: boundScope.siteId,
        sourceSnapshotHashSha256: snapshotHash,
        artifacts: rendered.map((artifact) => ({
          logicalPath: artifact.logicalPath,
          kind: artifact.kind,
          contentHashSha256: sha256Hex(artifact.bytes),
          sizeBytes: artifact.bytes.byteLength,
          mimeType: artifact.mimeType,
          references: artifact.references,
        })),
        createdAt: '2026-08-03T10:06:00.000Z',
      })
      await db.unsafe(`insert into fuma_releases(
        platform_id,owner_key,organization_id,workspace_id,site_id,release_id,source_snapshot_hash,
        status,build_job_id,build_job_fence,manifest_json,manifest_hash,failure_json,version,
        queued_at,building_at,ready_at,activated_at,failed_at,updated_at
      ) values('platform-pg','owner-pg','organization-pg','workspace-pg','site-pg',$1,$2,
        'ready','publish-job-pg',1,$3::text::jsonb,$4,null,3,
        '2026-08-03T10:05:00Z','2026-08-03T10:05:30Z','2026-08-03T10:06:00Z',null,null,'2026-08-03T10:06:00Z')`, [
        releaseId, snapshotHash, JSON.stringify(releaseManifest), releaseManifest.manifestHashSha256,
      ])
      await db.unsafe(`insert into fuma_publish_attempts(
        attempt_id,platform_id,owner_key,organization_id,workspace_id,site_id,release_id,
        snapshot_id,snapshot_hash,job_id,fence,audit_correlation_id,stage,completed,total,created_at,updated_at
      ) values('attempt-native-pg','platform-pg','owner-pg','organization-pg','workspace-pg','site-pg',$1,
        $2,$3,'publish-job-pg',1,'audit-native-pg','finalized',$4,$4,'2026-08-03T10:05:30Z','2026-08-03T10:06:00Z')`, [
        releaseId, committed.receipt.mutationId, snapshotHash, rendered.length,
      ])
      const exportService = new NextSourceReleaseExportService({
        db,
        scope: boundScope,
        releaseStorage: releaseObjects.storage,
        exportStorage: objects.storage,
        now: () => new Date('2026-08-03T10:07:00.000Z'),
      })
      const exported = await exportService.create(releaseId)
      expect(exported.replayed).toBe(false)
      expect(exported.record.releaseId).toBe(releaseId)
      expect(exported.record.sourceRevisionId).toBe(revision.revisionId)
      expect(exported.record.sourceSnapshotId).toBe(committed.receipt.mutationId)
      expect(exported.record.sourceSnapshotHashSha256).toBe(snapshotHash)
      expect(exported.record.documentHashSha256).toBe(committed.receipt.documentHashSha256)
      expect(exported.record.objectHashSha256).toBe(sha256Hex(exported.artifact.archive))
      const archive = unzipSync(exported.artifact.archive)
      expect(strFromU8(archive['app/route.ts']!)).toContain('export function GET(): Response')
      expect(strFromU8(archive['app/route.ts']!)).toContain('Native import')
      expect(strFromU8(archive['content/snapshot.json']!)).toContain('Exact source')
      expect(Object.keys(archive).some((path) => path.startsWith('public/_instatic/css/'))).toBe(true)
      expect(strFromU8(archive['fuma-export.json']!)).toContain(committed.receipt.mutationId)
      const exportReplay = await new NextSourceReleaseExportService({
        db,
        scope: boundScope,
        releaseStorage: releaseObjects.storage,
        exportStorage: objects.storage,
      }).create(releaseId)
      expect(exportReplay.replayed).toBe(true)
      expect(exportReplay.record).toEqual(exported.record)
      expect(exportReplay.artifact.archive).toEqual(exported.artifact.archive)
      const downloaded = await exportService.readArtifact(releaseId)
      expect(downloaded.record).toEqual(exported.record)
      expect(downloaded.archive).toEqual(exported.artifact.archive)
      const exportCount = await db<{ count: string }>`select count(*)::text count from fuma_next_source_exports_v1`
      expect(exportCount.rows[0]?.count).toBe('1')
      await expect(db.unsafe(`update fuma_next_source_exports_v1 set object_hash_sha256=object_hash_sha256`)).rejects.toThrow('Invalid Next source export transition')
    } finally {
      await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`)
      await admin.unsafe(`drop role if exists ${quote(role)}`)
    }
    const leftovers = await admin<{ roles: string; schemas: string }>`select (select count(*) from pg_roles where rolname=${role})::text roles,(select count(*) from pg_namespace where nspname=${schema})::text schemas`
    expect(leftovers.rows[0]).toEqual({ roles: '0', schemas: '0' })
    process.stdout.write('[FUMA-077 editor/export PostgreSQL] role=0 schemas=0 mutations=1 commits=1 exports=1 sequence=1\n')
  }, 120_000)
})

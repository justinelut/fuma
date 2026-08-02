import { describe, expect, it } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import { artifactInstallationAuthorityMigration } from '../../../server/fuma/db/migrations/000070_artifact_installation_authority'
import { sha256Hex } from '../../../server/fuma/objectStorage'
import {
  ArtifactInstallationAuthority,
  PostgresArtifactAuthorityRepository,
  type ArtifactInstallation,
  type ArtifactRelease,
  type SharedArtifactObjectStore,
} from '../../../server/fuma/artifacts'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const NOW = '2026-07-29T12:00:00.000Z'
const quote = (value: string) => { if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe schema.'); return `"${value}"` }
const scoped = (connection: string, schema: string) => { const url = new URL(connection); url.searchParams.set('options', `-c search_path=${schema},public`); return url.toString() }

class MemoryObjects implements SharedArtifactObjectStore {
  readonly values = new Map<string, Uint8Array>()
  async putIfAbsent(artifact: ArtifactRelease, bytes: Uint8Array) {
    if (this.values.has(artifact.objectKey)) return 'exists' as const
    this.values.set(artifact.objectKey, bytes.slice())
    return 'inserted' as const
  }
  async get(artifact: ArtifactRelease) {
    const bytes = this.values.get(artifact.objectKey)
    if (!bytes) throw new Error('Missing artifact fixture bytes.')
    return bytes.slice()
  }
}

function release(input: Readonly<{ id: string; version: string; bytes: Uint8Array }>): ArtifactRelease {
  return {
    schemaVersion: 1,
    artifactId: input.id,
    kind: 'plugin',
    packageId: 'plugin-shared',
    exactVersion: input.version,
    executionPolicy: 'plugin-sandbox-worker',
    objectKey: `artifacts/plugin/plugin-shared/${input.version}.zip`,
    mimeType: 'application/zip',
    contentHashSha256: sha256Hex(input.bytes),
    sizeBytes: input.bytes.byteLength,
    permissions: ['storage.write'],
    provenance: { sourceHashSha256: 'a'.repeat(64), lockHashSha256: 'b'.repeat(64), builderId: 'native-pg' },
    createdAt: NOW,
  }
}

function installation(owner: 'alpha' | 'beta', artifact: ArtifactRelease): ArtifactInstallation {
  return {
    platformId: 'fuma',
    organizationId: `org-${owner}`,
    workspaceId: `workspace-${owner}`,
    siteId: `site-${owner}`,
    ownerKey: `owner-${owner}`,
    ownerGeneration: 1,
    installationId: 'installation-shared',
    artifactId: artifact.artifactId,
    artifactKind: artifact.kind,
    packageId: artifact.packageId,
    exactVersion: artifact.exactVersion,
    contentHashSha256: artifact.contentHashSha256,
    executionPolicy: artifact.executionPolicy,
    settingsObjectKey: `artifact-installations/${owner}/settings.json`,
    secret: { keyId: `key-${owner}`, ciphertextObjectKey: `secrets/artifact-installations/${owner}/secret`, fingerprintSha256: (owner === 'alpha' ? '1' : '2').repeat(64) },
    state: 'active',
    workerGeneration: 1,
    quota: { storageBytes: 1_000, scheduledJobs: 1, callsPerMinute: 2 },
    previousArtifactId: null,
    version: 1,
    installedAt: NOW,
    updatedAt: NOW,
  }
}

const exactScope = (value: ArtifactInstallation) => ({
  platformId: value.platformId,
  organizationId: value.organizationId,
  workspaceId: value.workspaceId,
  siteId: value.siteId,
  ownerKey: value.ownerKey,
  ownerGeneration: value.ownerGeneration,
  installationId: value.installationId,
})

async function seedScope(db: ReturnType<typeof createPostgresClient>, owner: 'alpha' | 'beta' | 'gamma', generation: number, siteId = `site-${owner}`) {
  await db`insert into auth_organizations(id,name,slug,created_at) values (${`org-${owner}`},${`Org ${owner}`},${`org-${owner}`},${NOW})`
  await db`insert into fuma_workspaces(id,organization_id,slug,name) values (${`workspace-${owner}`},${`org-${owner}`},${`workspace-${owner}`},${`Workspace ${owner}`})`
  await db`insert into fuma_sites(organization_id,workspace_id,id,slug,name,profile_id) values (${`org-${owner}`},${`workspace-${owner}`},${siteId},${`site-${owner}`},${`Site ${owner}`},'website')`
  await db`insert into fuma_tenant_owner_keys(platform_id,owner_key,organization_id,workspace_id,site_id,generation) values ('fuma',${`owner-${owner}`},${`org-${owner}`},${`workspace-${owner}`},${siteId},${generation})`
}

describe('FUMA-067 optional native PostgreSQL acceptance', () => {
  it.skipIf(!postgresUrl)('applies 000070 and preserves exact isolated state through crash, rollback, and transfer', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_artifacts_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quote(schema)}`)
    const db = createPostgresClient(scoped(postgresUrl, schema))
    try {
      await db.unsafe(`
        create table auth_organizations(id text primary key,name text not null,slug text not null unique,created_at timestamptz not null);
        create table fuma_workspaces(id text primary key,organization_id text not null references auth_organizations(id),slug text not null,name text not null,unique(organization_id,id));
        create table fuma_sites(organization_id text not null,workspace_id text not null,id text not null,slug text not null,name text not null,profile_id text not null,primary key(organization_id,workspace_id,id),foreign key(organization_id,workspace_id) references fuma_workspaces(organization_id,id));
        create table fuma_tenant_owner_keys(
          platform_id text not null,owner_key text not null,organization_id text not null,workspace_id text not null,site_id text not null,
          generation bigint not null check(generation>0),state text not null default 'active' check(state in ('active','transferring')),
          transfer_id text null,transfer_lock_id text null,transfer_fence bigint null,primary key(platform_id,owner_key),
          unique(platform_id,owner_key,organization_id,workspace_id,site_id),
          unique(platform_id,owner_key,organization_id,workspace_id,site_id,generation),
          foreign key(organization_id,workspace_id,site_id) references fuma_sites(organization_id,workspace_id,id)
        );
      `)
      await db.unsafe(artifactInstallationAuthorityMigration.sql)
      await seedScope(db, 'alpha', 1)
      await seedScope(db, 'beta', 1)
      await seedScope(db, 'gamma', 2, 'site-beta')

      const repository = new PostgresArtifactAuthorityRepository(db)
      const objects = new MemoryObjects()
      const dispatches: string[] = []
      const authority = new ArtifactInstallationAuthority({
        repository,
        objects,
        workers: { async dispatch({ installation: value }) { dispatches.push(value.ownerKey); return { ok: true } } },
        now: () => new Date(NOW),
      })
      const v1Bytes = new TextEncoder().encode('native-plugin-v1')
      const v2Bytes = new TextEncoder().encode('native-plugin-v2')
      const v1 = await authority.register(release({ id: 'artifact-v1', version: '1.0.0', bytes: v1Bytes }), v1Bytes)
      const v2 = await authority.register(release({ id: 'artifact-v2', version: '2.0.0', bytes: v2Bytes }), v2Bytes)
      const alpha = await authority.install(installation('alpha', v1))
      let beta = await authority.install(installation('beta', v1))

      await authority.schedule({ ...exactScope(alpha), scheduleId: 'alpha-daily', cronExpression: '0 0 * * *', handlerName: 'alpha.daily', enabled: true, nextRunAt: NOW })
      await authority.schedule({ ...exactScope(beta), scheduleId: 'beta-daily', cronExpression: '0 0 * * *', handlerName: 'beta.daily', enabled: true, nextRunAt: NOW })
      await expect(authority.schedule({ ...exactScope(beta), scheduleId: 'beta-over-quota', cronExpression: '0 1 * * *', handlerName: 'beta.extra', enabled: true, nextRunAt: NOW })).rejects.toThrow('quota')
      await authority.recordStorage({ ...exactScope(alpha), objectCount: 1, bytesUsed: 100, version: 1 })
      await authority.recordStorage({ ...exactScope(beta), objectCount: 1, bytesUsed: 200, version: 1 })
      await expect(authority.recordStorage({ ...exactScope(beta), objectCount: 2, bytesUsed: 1_001, version: 2 })).rejects.toThrow('quota')
      await authority.dispatch({ scope: beta, target: 'route', payload: {}, units: 2, windowStartedAt: NOW })
      await expect(authority.dispatch({ scope: beta, target: 'route', payload: {}, units: 1, windowStartedAt: NOW })).rejects.toThrow('quota')

      const upgraded = await authority.rollback({ installation: beta, targetArtifactId: v2.artifactId })
      expect(upgraded).toMatchObject({ artifactId: v2.artifactId, previousArtifactId: v1.artifactId, version: 2 })
      beta = await authority.rollback({ installation: upgraded, targetArtifactId: v1.artifactId })
      expect(beta).toMatchObject({ artifactId: v1.artifactId, previousArtifactId: v2.artifactId, version: 3 })

      const crashed = await authority.crash({ ...exactScope(alpha), crashId: 'crash-alpha', workerGeneration: 1, errorCode: 'worker-failed', evidenceHashSha256: 'e'.repeat(64), occurredAt: NOW })
      expect(crashed.state).toBe('crashed')
      expect((await repository.readInstallation(beta))?.state).toBe('active')

      const transferred = await authority.transfer({
        transferId: 'transfer-beta',
        installation: beta,
        destination: { organizationId: 'org-gamma', workspaceId: 'workspace-gamma', siteId: 'site-beta', ownerKey: 'owner-gamma', ownerGeneration: 2 },
        rekeyedSecret: { keyId: 'key-gamma', ciphertextObjectKey: 'secrets/artifact-installations/gamma/secret', fingerprintSha256: '3'.repeat(64) },
      })
      expect(transferred).toMatchObject({ ownerKey: 'owner-gamma', ownerGeneration: 2, workerGeneration: 4, version: 4 })
      expect(await repository.readInstallation(beta)).toBeNull()
      expect((await repository.readInstallation(transferred))?.secret?.fingerprintSha256).toBe('3'.repeat(64))

      const childScopes = await db<{ table_name: string; owner_key: string; owner_generation: string | number | bigint }>`
        select 'schedule' as table_name,owner_key,owner_generation from fuma_artifact_schedules_v2 where installation_id='installation-shared'
        union all select 'storage',owner_key,owner_generation from fuma_artifact_storage_usage_v2 where installation_id='installation-shared'
        union all select 'calls',owner_key,owner_generation from fuma_artifact_call_windows_v2 where installation_id='installation-shared'
        order by table_name,owner_key
      `
      expect(childScopes.rows.filter(({ owner_key }) => owner_key === 'owner-gamma')).toHaveLength(3)
      expect(childScopes.rows.filter(({ owner_key }) => owner_key === 'owner-beta')).toHaveLength(0)
      expect(childScopes.rows.filter(({ owner_key }) => owner_key === 'owner-alpha')).toHaveLength(2)
      expect(childScopes.rows.filter(({ owner_key }) => owner_key === 'owner-gamma').every(({ owner_generation }) => Number(owner_generation) === 2)).toBe(true)
      expect(dispatches).toEqual(['owner-beta'])
      expect(objects.values.size).toBe(2)

      const componentBytes = new TextEncoder().encode('{"components":[]}')
      const component = await authority.register({
        schemaVersion: 1,
        artifactId: 'component-v1',
        kind: 'component-pack',
        packageId: 'component-shared',
        exactVersion: '1.0.0',
        executionPolicy: 'component-declarative',
        objectKey: 'artifacts/component-pack/component-shared/1.0.0.json',
        mimeType: 'application/json',
        contentHashSha256: sha256Hex(componentBytes),
        sizeBytes: componentBytes.byteLength,
        permissions: ['content.public.read'],
        provenance: { sourceHashSha256: 'c'.repeat(64), lockHashSha256: 'd'.repeat(64), builderId: 'native-pg' },
        createdAt: NOW,
      }, componentBytes)
      const pack = await authority.install({
        ...transferred,
        installationId: 'component-installation', artifactId: component.artifactId, artifactKind: component.kind,
        packageId: component.packageId, exactVersion: component.exactVersion, contentHashSha256: component.contentHashSha256,
        executionPolicy: component.executionPolicy, settingsObjectKey: 'artifact-installations/gamma/component.json', secret: null,
        workerGeneration: null, previousArtifactId: null, version: 1,
      })
      await expect(authority.schedule({ ...exactScope(pack), scheduleId: 'forbidden', cronExpression: '0 0 * * *', handlerName: 'forbidden', enabled: true, nextRunAt: NOW })).rejects.toThrow('plugins')
      await expect(authority.dispatch({ scope: pack, target: 'schedule', payload: {}, units: 1, windowStartedAt: NOW })).rejects.toThrow('plugin')
      await expect(db.unsafe(`insert into fuma_artifact_schedules_v2(platform_id,owner_key,owner_generation,installation_id,artifact_kind,schedule_id,cron_expression,handler_name,enabled,schedule_json) values('fuma','owner-gamma',2,'component-installation','plugin','bad','0 0 * * *','bad',true,'{}'::jsonb)`)).rejects.toThrow()
      await expect(db.unsafe(`update fuma_artifact_releases_v2 set size_bytes=size_bytes+1 where artifact_id='artifact-v1'`)).rejects.toThrow('immutable')
      await expect(db.unsafe(`delete from fuma_artifact_crashes_v2 where crash_id='crash-alpha'`)).rejects.toThrow('immutable')

      const counts = await db<{ artifacts: string | number | bigint; installations: string | number | bigint; transfers: string | number | bigint }>`
        select (select count(*) from fuma_artifact_releases_v2) as artifacts,
          (select count(*) from fuma_artifact_installations_v2) as installations,
          (select count(*) from fuma_artifact_transfer_receipts_v2) as transfers
      `
      expect(counts.rows[0] && {
        artifacts: Number(counts.rows[0].artifacts),
        installations: Number(counts.rows[0].installations),
        transfers: Number(counts.rows[0].transfers),
      }).toEqual({ artifacts: 3, installations: 3, transfers: 1 })
    } finally {
      await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`)
      const leftover = await admin<{ count: string | number | bigint }>`select count(*) as count from pg_namespace where nspname=${schema}`
      expect(Number(leftover.rows[0]?.count ?? 0)).toBe(0)
    }
  }, 120_000)
})

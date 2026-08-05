import { createPostgresClient } from '../../../server/db/postgres'
import { publicationSchedulingAccessMigration } from '../../../server/fuma/db/migrations/000048_publication_scheduling_access'
import { emailSettingsVersionsMigration } from '../../../server/fuma/db/migrations/000049_email_settings_versions'
import { PostgresPublicationSchedulingRepository } from '../../../server/fuma/publication/schedulingAccessPostgres'
import { PostgresEmailSettingsVersionRepository } from '../../../server/fuma/publication/emailSettingsPostgres'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL

function quote(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe PostgreSQL schema identifier.')
  return `"${value}"`
}

function scopedUrl(connectionString: string, schema: string): string {
  const url = new URL(connectionString)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}

async function rejects(work: () => Promise<unknown>): Promise<void> {
  let failed = false
  try { await work() } catch { failed = true }
  expect(failed).toBe(true)
}

describe('FUMA-036/FUMA-043 live PostgreSQL acceptance', () => {
  it.skipIf(postgresUrl === undefined)('installs fenced scheduling and immutable hierarchical settings authority', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_schedule_email_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quote(schema)}`)
    const db = createPostgresClient(scopedUrl(postgresUrl, schema))
    try {
      await db.unsafe(`
        create table fuma_tenant_owner_keys (
          platform_id text not null, owner_key text not null,
          organization_id text not null, workspace_id text not null, site_id text not null,
          state text not null, generation bigint not null, transfer_id text,
          transfer_lock_id text, transfer_fence bigint,
          primary key (platform_id, owner_key),
          unique (platform_id, owner_key, organization_id, workspace_id, site_id)
        );
        create table fuma_publication_metadata_authority (
          platform_id text not null, organization_id text not null, workspace_id text not null,
          site_id text not null, owner_key text not null, owner_generation bigint not null,
          profile_id text not null, content_id text not null,
          primary key (platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, content_id)
        );
        create table fuma_sites (
          organization_id text not null, workspace_id text not null, id text not null,
          profile_id text not null,
          primary key (organization_id, workspace_id, id)
        );
      `)
      await db.transaction(async (tx) => {
        await tx.unsafe(publicationSchedulingAccessMigration.sql)
        await tx.unsafe(emailSettingsVersionsMigration.sql)
        await tx`insert into fuma_tenant_owner_keys values ('platform','owner','organization','workspace','site','active',1,null,null,null)`
        await tx`insert into fuma_sites values ('organization','workspace','site','publication')`
        await tx`insert into fuma_publication_metadata_authority values ('platform','organization','workspace','site','owner',1,'publication','content-1')`
      })

      await db`insert into fuma_publication_schedules_v2 (
        platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,
        schedule_id,content_id,action,expected_workflow_version,due_at,display_timezone,state,
        claim_fence,claimed_by,claim_expires_at,completed_at,created_at
      ) values (
        'platform','organization','workspace','site','owner',1,'publication',
        'schedule-1','content-1','publish',2,'2040-01-02T03:04:05Z','Africa/Nairobi','pending',
        0,null,null,null,'2040-01-01T03:04:05Z'
      )`
      await db`insert into fuma_publication_preview_tokens (
        platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,
        token_id,content_id,token_digest_sha256,expires_at,created_at,revoked_at,last_used_at,use_count
      ) values (
        'platform','organization','workspace','site','owner',1,'publication',
        'token-1','content-1',${'a'.repeat(64)},'2040-01-02T03:04:05Z','2040-01-01T03:04:05Z',null,null,0
      )`
      await rejects(async () => { await db`update fuma_publication_schedules_v2 set state='claimed' where schedule_id='schedule-1'` })
      await rejects(async () => { await db`insert into fuma_publication_preview_tokens (
        platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,
        token_id,content_id,token_digest_sha256,expires_at,created_at,use_count
      ) values ('platform','organization','workspace','site','owner',1,'publication','token-2','content-1','not-a-digest','2040-01-02T03:04:05Z','2040-01-01T03:04:05Z',0)` })

      await db`insert into fuma_email_settings_versions (
        platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,
        level_kind,level_id,version_id,ordinal,parent_version_id,overrides_json,mutation_json,actor_id,created_at
      ) values (
        'platform','organization','workspace','site','owner',1,'publication',
        'site','site','settings-1',1,null,${JSON.stringify([{ key: 'senderName', value: 'Fuma' }])}::text::jsonb,
        ${JSON.stringify({ kind: 'set' })}::text::jsonb,'actor-1','2040-01-01T03:04:05Z'
      )`
      await db`insert into fuma_email_settings_version_heads values (
        'platform','organization','workspace','site','owner',1,'publication','site','site','settings-1',1,'2040-01-01T03:04:05Z'
      )`
      await rejects(async () => { await db`update fuma_email_settings_versions set actor_id='other' where version_id='settings-1'` })

      const scope = Object.freeze({
        platformId: 'platform', organizationId: 'organization', workspaceId: 'workspace',
        siteId: 'site', ownerKey: 'owner', generation: 1, state: 'active' as const,
        transferFence: null, profileId: 'publication',
      })
      const schedules = new PostgresPublicationSchedulingRepository(db)
      expect((await schedules.listRecoveryScopes('2040-01-02T03:04:06Z', 10)).map((value) => value.siteId)).toEqual(['site'])
      const claim = await schedules.claimDue(scope, 'schedule-1', 'worker-1', '2040-01-02T03:04:06Z', '2040-01-02T03:05:06Z')
      expect(claim?.fence).toBe(1)
      expect(await schedules.finishClaim(scope, 'schedule-1', 'worker-1', 1, 'completed', '2040-01-02T03:04:07Z')).toBe(true)

      const email = new PostgresEmailSettingsVersionRepository(db)
      const organizationOverride = [{ key: 'senderName' as const, value: 'Organization sender' }]
      expect(await email.append(scope, {
        versionId: 'settings-2', level: 'organization', levelId: 'organization', ordinal: 1,
        parentVersionId: null, overrides: organizationOverride,
        mutation: { kind: 'set', overrides: organizationOverride }, actorId: 'actor-2',
        createdAt: '2040-01-01T03:05:05Z',
      }, null)).toBe(true)
      expect((await email.current(scope, { level: 'organization', levelId: 'organization' }))?.versionId).toBe('settings-2')

      const counts = await db.unsafe<{ schedules: number|string|bigint; versions: number|string|bigint }>(`
        select
          (select count(*) from fuma_publication_schedules_v2) as schedules,
          (select count(*) from fuma_email_settings_versions) as versions
      `)
      expect(Number(counts.rows[0]?.schedules)).toBe(1)
      expect(Number(counts.rows[0]?.versions)).toBe(2)
    } finally {
      await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`)
    }
  })
})

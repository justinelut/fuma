import { describe, expect, it } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import { publicationEditorialWorkflowMigration } from '../../../server/fuma/db/migrations/000046_editorial_workflow'
import { memberAccountsAccessMigration } from '../../../server/fuma/db/migrations/000047_member_accounts_access'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const NOW = '2040-01-02T03:04:05.000Z'

function quotedIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe PostgreSQL schema identifier.')
  return `"${value}"`
}

function scopedPostgresUrl(connectionString: string, schema: string): string {
  const url = new URL(connectionString)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}

describe('FUMA-035/FUMA-039 live PostgreSQL acceptance', () => {
  it.skipIf(postgresUrl === undefined)(
    'installs exact-scope workflow/member authority and enforces immutable provenance',
    async () => {
      if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
      const admin = createPostgresClient(postgresUrl)
      const schema = `fuma_workflow_member_${process.pid}_${Date.now()}`
      await admin.unsafe(`create schema ${quotedIdentifier(schema)}`)
      const db = createPostgresClient(scopedPostgresUrl(postgresUrl, schema))
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
          create table fuma_member_identities (
            platform_id text not null, organization_id text not null, workspace_id text not null,
            site_id text not null, owner_key text not null, owner_generation bigint not null,
            profile_id text not null, member_identity_id text not null,
            primary key (platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, member_identity_id)
          );
          create table fuma_publication_members (
            platform_id text not null, owner_key text not null, owner_generation bigint not null,
            profile_id text not null, member_id text not null,
            primary key (platform_id, owner_key, owner_generation, profile_id, member_id)
          );
        `)
        await db.transaction(async (tx) => {
          await tx.unsafe(publicationEditorialWorkflowMigration.sql)
          await tx.unsafe(memberAccountsAccessMigration.sql)
          await tx`insert into fuma_tenant_owner_keys values (
            'platform', 'owner', 'organization', 'workspace', 'site',
            'active', 1, null, null, null
          )`
          await tx`insert into fuma_member_identities values (
            'platform', 'organization', 'workspace', 'site', 'owner', 1,
            'publication', 'identity-1'
          )`
          await tx`insert into fuma_publication_members values (
            'platform', 'owner', 1, 'publication', 'member-1'
          )`
        })

        await db`insert into fuma_publication_editorial_roles values (
          'platform', 'organization', 'workspace', 'site', 'owner', 1, 'publication',
          'editor-1', 'editor', true, 1, 'manager-1', 'Assigned', ${NOW}
        )`
        await db`insert into fuma_publication_workflow_history values (
          'platform', 'organization', 'workspace', 'site', 'owner', 1, 'publication',
          'event-1', 'role-assigned', 'manager-1', null, null, 'editor-1', null, 'Assigned', ${NOW}
        )`
        await expect(db`update fuma_publication_workflow_history set note='changed' where event_id='event-1'`)
          .rejects.toThrow('publication workflow history is immutable')

        await db`insert into fuma_publication_member_accounts values (
          'platform', 'organization', 'workspace', 'site', 'owner', 1, 'publication',
          'account-1', 'identity-1', 'member-1', 'Amina', 'en-KE', 'Africa/Nairobi',
          'active', ${NOW}, ${NOW}, null
        )`
        await db`insert into fuma_publication_newsletter_consent_events values (
          'platform', 'organization', 'workspace', 'site', 'owner', 1, 'publication',
          'consent-1', 'account-1', 'member-1', null, 'subscribed', 'member-profile',
          'notice-1', null, ${NOW}
        )`
        await expect(db`delete from fuma_publication_newsletter_consent_events where event_id='consent-1'`)
          .rejects.toThrow('publication member consent provenance is append-only')
        await expect(db`insert into fuma_publication_member_accounts values (
          'platform', 'organization', 'workspace', 'site', 'owner', 1, 'publication',
          'account-foreign', 'identity-1', 'member-foreign', '', 'en-KE', 'Africa/Nairobi',
          'active', ${NOW}, ${NOW}, null
        )`).rejects.toThrow()

        const counts = await db.unsafe<{ roles: string | number; accounts: string | number; consents: string | number }>(`
          select
            (select count(*) from fuma_publication_editorial_roles) as roles,
            (select count(*) from fuma_publication_member_accounts) as accounts,
            (select count(*) from fuma_publication_newsletter_consent_events) as consents
        `)
        expect(counts.rows[0] && {
          roles: Number(counts.rows[0].roles),
          accounts: Number(counts.rows[0].accounts),
          consents: Number(counts.rows[0].consents),
        }).toEqual({ roles: 1, accounts: 1, consents: 1 })
        process.stdout.write('[FUMA-035/FUMA-039 PostgreSQL demo] workflow=immutable realm-pair=exact consent=append-only\n')
      } finally {
        await admin.unsafe(`drop schema if exists ${quotedIdentifier(schema)} cascade`)
      }
    },
    30_000,
  )
})

import { describe, expect, it } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import { emailSettingsVersionsMigration } from '../../../server/fuma/db/migrations/000049_email_settings_versions'
import { publicationNewsletterComposerMigration } from '../../../server/fuma/db/migrations/000052_publication_newsletter_composer'
import { PostgresEmailSettingsVersionRepository } from '../../../server/fuma/publication/emailSettingsPostgres'
import { PostgresNewsletterComposerRepository } from '../../../server/fuma/publication/newsletterComposerPostgres'
import type { PublicationRepositoryScope } from '../../../server/fuma/publication/scope'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const scope: PublicationRepositoryScope = Object.freeze({ platformId: 'platform', organizationId: 'organization', workspaceId: 'workspace', siteId: 'site', ownerKey: 'owner', generation: 1, state: 'active', transferFence: null, profileId: 'publication' })
const now = '2040-01-02T03:04:05.000Z'

function quote(value: string): string { if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe PostgreSQL schema identifier.'); return `"${value}"` }
function scopedUrl(connectionString: string, schema: string): string { const url = new URL(connectionString); url.searchParams.set('options', `-c search_path=${schema},public`); return url.toString() }

async function rejects(work: () => Promise<unknown>): Promise<void> { let failed = false; try { await work() } catch { failed = true } expect(failed).toBe(true) }

describe('FUMA-044 optional live PostgreSQL acceptance', () => {
  it.skipIf(postgresUrl === undefined)('installs exact newsletter authority and enforces CAS plus immutable receipts', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_newsletter_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quote(schema)}`)
    const db = createPostgresClient(scopedUrl(postgresUrl, schema))
    try {
      await db.unsafe(`
        create table fuma_tenant_owner_keys (
          platform_id text not null, owner_key text not null, organization_id text not null,
          workspace_id text not null, site_id text not null, state text not null, generation bigint not null,
          transfer_id text, transfer_lock_id text, transfer_fence bigint,
          primary key (platform_id,owner_key),
          unique (platform_id,owner_key,organization_id,workspace_id,site_id)
        );
        create table fuma_sites (
          organization_id text not null, workspace_id text not null, id text not null, profile_id text not null,
          primary key (organization_id,workspace_id,id)
        );
        create table fuma_publication_newsletters (
          platform_id text not null, organization_id text not null, workspace_id text not null, site_id text not null,
          owner_key text not null, owner_generation bigint not null, profile_id text not null,
          newsletter_id text not null, status text not null
        );
        create table fuma_publication_member_segments (
          platform_id text not null, organization_id text not null, workspace_id text not null, site_id text not null,
          owner_key text not null, owner_generation bigint not null, profile_id text not null, segment_id text not null,
          primary key (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,segment_id)
        );
      `)
      await db.transaction(async (tx) => {
        await tx.unsafe(emailSettingsVersionsMigration.sql)
        await tx.unsafe(publicationNewsletterComposerMigration.sql)
        await tx`insert into fuma_tenant_owner_keys values ('platform','owner','organization','workspace','site','active',1,null,null,null)`
        await tx`insert into fuma_sites values ('organization','workspace','site','publication')`
        await tx`insert into fuma_publication_member_segments values ('platform','organization','workspace','site','owner',1,'publication','segment-a')`
      })
      const repository = new PostgresNewsletterComposerRepository(db)
      expect(await repository.put(scope, { newsletterId: 'newsletter-a', name: 'Daily Brief', slug: 'daily-brief', description: '', status: 'active', defaultSegmentId: 'segment-a', webContentId: 'post-web', version: 1, createdBy: 'owner-1', createdAt: now, updatedBy: 'owner-1', updatedAt: now }, null)).toBe(true)
      const draft = { draftId: 'draft-a', newsletterId: 'newsletter-a', sequence: 1, subject: 'Launch', previewText: '', document: { version: 1 as const, children: [{ type: 'text' as const, text: 'Hello' }] }, audience: { segmentIds: ['segment-a'], match: 'all' as const, subscription: 'subscribed' as const, scanLimit: 500 }, updatedBy: 'editor-1', updatedAt: now }
      const emailSettings = new PostgresEmailSettingsVersionRepository(db)
      const newsletterSettings = {
        versionId: 'newsletter-settings-v1', level: 'newsletter' as const, levelId: 'newsletter-a', ordinal: 1,
        parentVersionId: null,
        overrides: [
          { key: 'senderName' as const, value: 'Daily Brief' },
          { key: 'senderEmail' as const, value: 'letters@example.test' },
          { key: 'replyToEmail' as const, value: 'reply@example.test' },
          { key: 'physicalAddress' as const, value: 'Nairobi' },
          { key: 'brandColor' as const, value: '#112233' },
          { key: 'footerText' as const, value: 'Footer' },
        ],
        mutation: { kind: 'set' as const, overrides: [{ key: 'senderName' as const, value: 'Daily Brief' }] },
        actorId: 'owner-1', createdAt: now,
      }
      expect(await emailSettings.append(scope, newsletterSettings, null)).toBe(true)
      expect((await emailSettings.current(scope, { level: 'newsletter', levelId: 'newsletter-a' }))?.versionId).toBe('newsletter-settings-v1')
      expect((await repository.saveDraft(scope, draft, 0, 'mutation-a', 'a'.repeat(64))).kind).toBe('saved')
      expect((await repository.saveDraft(scope, draft, 0, 'mutation-a', 'a'.repeat(64))).kind).toBe('replayed')
      expect((await repository.saveDraft(scope, { ...draft, subject: 'Stale' }, 0, 'mutation-b', 'b'.repeat(64))).kind).toBe('conflict')
      expect(await repository.recordSenderVerification(scope, { senderEmail: 'letters@example.test', state: 'verified', providerIdentityId: 'oci-sender', verifiedAt: now, checkedAt: now })).toBe(true)
      expect((await repository.getSenderVerification(scope, 'letters@example.test'))?.state).toBe('verified')
      await rejects(async () => { await db`update fuma_publication_newsletter_draft_mutations set accepted_sequence=2 where mutation_id='mutation-a'` })
      expect(Number((await db<{ count: string | number | bigint }>`select count(*) as count from fuma_publication_newsletter_composers`).rows[0]?.count)).toBe(1)
    } finally {
      await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`)
    }
  })
})

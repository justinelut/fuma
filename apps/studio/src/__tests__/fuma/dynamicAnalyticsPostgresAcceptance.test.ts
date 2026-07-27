import { describe, expect, it } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import { dynamicPublicationTemplatesMigration } from '../../../server/fuma/db/migrations/000050_dynamic_publication_templates'
import { publicationPrivacyAnalyticsMigration } from '../../../server/fuma/db/migrations/000051_publication_privacy_analytics'
import { PostgresDynamicPublicationRepository } from '../../../server/fuma/publication/dynamicPublicationRepository'
import { PostgresPublicationPrivacyAnalyticsRepository } from '../../../server/fuma/publication/privacyAnalyticsPostgres'
import type { PublicationRepositoryScope } from '../../../server/fuma/publication/scope'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const scope: PublicationRepositoryScope = Object.freeze({
  platformId: 'platform', organizationId: 'organization', workspaceId: 'workspace', siteId: 'site',
  ownerKey: 'owner', generation: 1, state: 'active', transferFence: null, profileId: 'publication',
})
const now = '2040-01-02T03:04:05.000Z'

function quote(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe PostgreSQL schema identifier.')
  return `"${value}"`
}
function scopedUrl(connectionString: string, schema: string): string {
  const url = new URL(connectionString)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}

const template = Object.freeze({
  templateId: 'shared-author', name: 'Shared author archive', target: { kind: 'author' as const, targetId: null },
  document: { version: 1 as const, blocks: [{ blockId: 'heading', scope: 'root' as const, element: 'h1' as const, value: { kind: 'binding' as const, binding: 'archive.title' as const }, href: null }] },
  emptyState: 'No posts yet.', version: 1, active: true, createdAt: now, updatedAt: now,
})

const event = Object.freeze({
  eventId: 'event-public-read', occurredAt: now, day: '2040-01-02', kind: 'post-read' as const,
  contentId: 'post-a', referrer: 'direct' as const, audience: 'public' as const,
  memberSource: 'none' as const, newsletterId: null, collectionBasis: 'explicit-consent' as const,
})

describe('FUMA-037/FUMA-040 live PostgreSQL acceptance', () => {
  it.skipIf(postgresUrl === undefined)('persists JSON templates and exact minimized aggregates through production repositories', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_dynamic_analytics_${process.pid}_${Date.now()}`
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
          organization_id text not null, workspace_id text not null, id text not null,
          profile_id text not null, status text not null default 'active',
          primary key (organization_id,workspace_id,id)
        );
      `)
      await db.transaction(async (tx) => {
        await tx.unsafe(dynamicPublicationTemplatesMigration.sql)
        await tx.unsafe(publicationPrivacyAnalyticsMigration.sql)
        await tx`insert into fuma_tenant_owner_keys values ('platform','owner','organization','workspace','site','active',1,null,null,null)`
        await tx`insert into fuma_sites (organization_id,workspace_id,id,profile_id) values ('organization','workspace','site','publication')`
      })

      const templates = new PostgresDynamicPublicationRepository(db)
      expect(await templates.saveTemplate(scope, template, null)).toBe(true)
      expect((await templates.listTemplates(scope))[0]?.document.blocks[0]?.blockId).toBe('heading')
      expect((await templates.resolveTemplate(scope, { kind: 'author', targetId: 'author-a' }))?.templateId).toBe('shared-author')
      expect(await templates.saveTemplate(scope, { ...template, templateId: 'duplicate-target' }, null)).toBe(false)

      const analytics = new PostgresPublicationPrivacyAnalyticsRepository(db)
      expect(await analytics.append(scope, event)).toBe(true)
      expect(await analytics.append(scope, event)).toBe(false)
      const report = await analytics.summarize(scope, { from: '2040-01-01', to: '2040-01-03' })
      expect(report.totals.postReads).toBe(1)
      expect(report.content).toEqual([{ contentId: 'post-a', publicReads: 1, memberReads: 0, totalReads: 1 }])
      expect(await analytics.purge(scope, '2041-01-01T00:00:00.000Z', '2041-01-01')).toEqual({ rawEventsDeleted: 1, aggregatesDeleted: 1 })
    } finally {
      await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`)
    }
  })
})

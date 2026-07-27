import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ResolvedEmailSettingsV2 } from '@core/fuma/publication/emailSettingsContracts'
import type { PublicationNewsletterProfile } from '@core/fuma/publication/newsletterComposerContracts'
import type { DbClient, DbResult } from '../../../server/db/client'
import { publicationNewsletterComposerMigration } from '../../../server/fuma/db/migrations/000052_publication_newsletter_composer'
import { hostedMigrations } from '../../../server/fuma/db/migrations'
import { assertHostedMigrationIsAdditive, hostedMigrationChecksum } from '../../../server/fuma/db/migrationPolicy'
import { PostgresNewsletterComposerRepository } from '../../../server/fuma/publication/newsletterComposerPostgres'
import { createNewsletterComposerScopedRouteDeclarations } from '../../../server/fuma/publication/newsletterComposerRoutes'
import type { PublicationRepositoryScope } from '../../../server/fuma/publication/scope'
import { NewsletterComposerSurface } from '../../admin/fuma/publication/NewsletterComposerSurface'

const PUBLICATION_TEST_SCOPE: PublicationRepositoryScope = Object.freeze({ platformId: 'platform', organizationId: 'organization', workspaceId: 'workspace', siteId: 'site', ownerKey: 'owner-key', generation: 1, state: 'active', transferFence: null, profileId: 'publication' })
const TEST_NOW = '2040-01-02T03:04:05.000Z'

function recordingDb() {
  const sql: string[] = []
  const callable = async <Row,>(strings: TemplateStringsArray): Promise<DbResult<Row>> => {
    const text = strings.join('?'); sql.push(text)
    if (text.includes('from fuma_tenant_owner_keys owner')) return { rows: [{ authorized: 1 } as Row], rowCount: 1 }
    return { rows: [], rowCount: text.startsWith('select') ? 0 : 1 }
  }
  const db = Object.assign(callable, { dialect: 'postgres' as const, unsafe: async <Row,>(): Promise<DbResult<Row>> => ({ rows: [], rowCount: 0 }), transaction: async <T,>(work: (tx: DbClient) => Promise<T>) => await work(db as DbClient) }) as DbClient
  return { db, sql }
}

const newsletter: PublicationNewsletterProfile = { newsletterId: 'newsletter-a', name: 'Daily Brief', slug: 'daily-brief', description: '', status: 'active', defaultSegmentId: 'segment-a', webContentId: 'post-web', version: 1, createdBy: 'owner-1', createdAt: TEST_NOW, updatedBy: 'owner-1', updatedAt: TEST_NOW }
const version = { versionId: 'settings-a', level: 'site' as const, levelId: PUBLICATION_TEST_SCOPE.siteId, ordinal: 1, parentVersionId: null, overrides: [{ key: 'senderName' as const, value: 'Fuma' }, { key: 'senderEmail' as const, value: 'letters@example.test' }, { key: 'replyToEmail' as const, value: 'reply@example.test' }, { key: 'physicalAddress' as const, value: 'Nairobi' }, { key: 'brandColor' as const, value: '#112233' }, { key: 'footerText' as const, value: 'Footer' }], mutation: { kind: 'set' as const, overrides: [{ key: 'senderName' as const, value: 'Fuma' }] }, actorId: 'owner-1', createdAt: TEST_NOW }
const source = { level: 'site' as const, levelId: PUBLICATION_TEST_SCOPE.siteId, versionId: version.versionId, ordinal: 1, inherited: true }
const settings: ResolvedEmailSettingsV2 = { values: { senderName: 'Fuma', senderEmail: 'letters@example.test', replyToEmail: 'reply@example.test', physicalAddress: 'Nairobi', brandColor: '#112233', footerText: 'Footer' }, provenance: { senderName: source, senderEmail: source, replyToEmail: source, physicalAddress: source, brandColor: source, footerText: source }, provider: 'oci-email-delivery', layerVersions: [version] }

describe('FUMA-044 migration and architecture gates', () => {
  test('registers additive 000052 for hosted execution', () => {
    expect(publicationNewsletterComposerMigration.id).toBe('000052_publication_newsletter_composer')
    expect(() => assertHostedMigrationIsAdditive(publicationNewsletterComposerMigration)).not.toThrow()
    expect(hostedMigrationChecksum(publicationNewsletterComposerMigration.sql)).toMatch(/^[a-f0-9]{64}$/)
    expect(hostedMigrations).toContain(publicationNewsletterComposerMigration)
    const sql = publicationNewsletterComposerMigration.sql
    for (const table of ['fuma_publication_newsletter_composers', 'fuma_publication_newsletter_drafts', 'fuma_publication_newsletter_draft_mutations', 'fuma_publication_newsletter_sender_verifications']) expect(sql).toContain(`create table ${table}`)
    for (const qualifier of ['platform_id', 'organization_id', 'workspace_id', 'site_id', 'owner_key', 'owner_generation', 'profile_id']) expect((sql.match(new RegExp(qualifier, 'g')) ?? []).length).toBeGreaterThanOrEqual(4)
    expect(sql).toContain('newsletter autosave receipts are immutable')
    expect(sql).toContain('before update or delete')
    expect(sql).toContain("state='verified' and verified_at is not null")
    expect(sql).toContain('default_segment_id')
    expect(sql).toContain('web_content_id')
  })

  test('repository reloads complete active authority and qualifies every profile, draft, mutation, and sender query', async () => {
    const recording = recordingDb(), repository = new PostgresNewsletterComposerRepository(recording.db)
    expect(await repository.put(PUBLICATION_TEST_SCOPE, newsletter, null)).toBe(true)
    await repository.list(PUBLICATION_TEST_SCOPE, 200)
    await repository.getDraft(PUBLICATION_TEST_SCOPE, newsletter.newsletterId)
    await repository.getSenderVerification(PUBLICATION_TEST_SCOPE, 'letters@example.test')
    await repository.recordSenderVerification(PUBLICATION_TEST_SCOPE, { senderEmail: 'letters@example.test', state: 'verified', providerIdentityId: 'oci-identity', verifiedAt: TEST_NOW, checkedAt: TEST_NOW })
    const sql = recording.sql.join('\n')
    expect(sql).toContain('site.profile_id=?')
    expect(sql).toContain("owner.state='active'")
    expect(sql).toContain('owner.transfer_id is null')
    expect(sql).toContain('owner.transfer_lock_id is null')
    expect(sql).toContain('owner.transfer_fence is null')
    expect(sql).toContain('limit ?')
    for (const qualifier of ['platform_id=', 'organization_id=', 'workspace_id=', 'site_id=', 'owner_key=', 'owner_generation=', 'profile_id=']) expect(sql).toContain(qualifier)
  })

  test('dedicated routes are bounded to exact newsletter permissions and expose no sender self-verification route', () => {
    const declarations = createNewsletterComposerScopedRouteDeclarations({} as never)
    expect(new Map(declarations.map((route) => [`${route.method} ${route.path}`, route.permission]))).toEqual(new Map([
      ['GET /publication/newsletter-composer', 'publication.newsletters.read'],
      ['GET /publication/newsletter-composer/:newsletterId', 'publication.newsletters.read'],
      ['POST /publication/newsletter-composer/profile', 'publication.newsletters.write'],
      ['POST /publication/newsletter-composer/autosave', 'publication.newsletters.write'],
      ['POST /publication/newsletter-composer/audience-estimate', 'publication.newsletters.read'],
      ['POST /publication/newsletter-composer/preview', 'publication.newsletters.read'],
      ['POST /publication/newsletter-composer/send-readiness', 'publication.newsletters.send'],
    ]))
    expect(declarations.some((route) => route.path.includes('sender-verification'))).toBe(false)
  })

  test('composition imports existing member/settings/content authorities and avoids forbidden central or app boundaries', async () => {
    const serverPaths = ['newsletterComposer.ts', 'newsletterAudience.ts', 'newsletterComposerPostgres.ts', 'newsletterComposerRoutes.ts', 'newsletterComposerComposition.ts']
    const sources = await Promise.all(serverPaths.map((path) => Bun.file(new URL(`../../../server/fuma/publication/${path}`, import.meta.url)).text()))
    const contracts = await Bun.file(new URL('../../core/fuma/publication/newsletterComposerContracts.ts', import.meta.url)).text()
    const surface = await Bun.file(new URL('../../admin/fuma/publication/NewsletterComposerSurface.tsx', import.meta.url)).text()
    const composition = sources.at(-1)!
    const central = await Bun.file(new URL('../../../server/fuma/publication/composition.ts', import.meta.url)).text()
    const workspace = await Bun.file(new URL('../../admin/fuma/publication/PublicationWorkspace.tsx', import.meta.url)).text()
    const all = [...sources, contracts, surface].join('\n')
    expect(composition).toContain("from './memberAccess'")
    expect(composition).toContain("from './emailSettings'")
    expect(composition).toContain("Pick<PublicationDomainStore, 'getContent'>")
    expect(central).toContain('createNewsletterComposerServiceGraph')
    expect(central).toContain('...newsletterComposer.scopedRoutes')
    expect(workspace).toContain('<NewsletterComposerWorkspace')
    expect(sources[0]).toContain('renderEmailDocument')
    expect(all).not.toMatch(/\bzod\b/i)
    expect(all).not.toMatch(/from ['"]@fuma\/(?:web|control)/)
    expect(all).not.toMatch(/shared\/ui|tailwind/i)
    expect(surface).toContain("from '@ui/components/Button'")
    expect(sources[2]).not.toMatch(/transaction[\s\S]{0,300}transaction/)
  })

  test('standalone Studio surface is labelled, permission-aware, responsive, and exposes autosave, inheritance, linkage, and query status', async () => {
    const html = renderToStaticMarkup(<NewsletterComposerSurface newsletters={[newsletter]} newsletter={newsletter} draft={null} segments={[{ segmentId: 'segment-a', name: 'Founders', kind: 'explicit', match: 'all', rules: [], explicitMemberIds: [], version: 1, recalculatedAt: null, createdAt: TEST_NOW, updatedAt: TEST_NOW }]} settings={settings} senderVerification={null} canRead canWrite canSend onSelect={() => {}} onSaveProfile={async () => newsletter} onAutosave={async () => { throw new Error('unused') }} onEstimate={async () => { throw new Error('unused') }} onReadiness={async () => { throw new Error('unused') }} onEditSettings={() => {}} />)
    for (const text of ['Newsletter composer', 'Identity and web linkage', 'Sender and reply-to', 'EmailDocument', 'Audience query', 'autosave as a data-only', 'Inherited from site', 'role="status"', 'aria-live="polite"']) expect(html).toContain(text)
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('aria-describedby="web-link-hint"')
    expect(html).not.toMatch(/private key|credential|secret/i)
    const denied = renderToStaticMarkup(<NewsletterComposerSurface {...({ newsletters: [], newsletter: null, draft: null, segments: [], settings: null, senderVerification: null, canRead: false, canWrite: false, canSend: false, onSelect() {}, async onSaveProfile() { throw new Error() }, async onAutosave() { throw new Error() }, async onEstimate() { throw new Error() }, async onReadiness() { throw new Error() }, onEditSettings() {} })} />)
    expect(denied).toContain('do not have permission')
    expect(denied).not.toContain('Audience query')
    const css = await Bun.file(new URL('../../admin/fuma/publication/NewsletterComposerSurface.module.css', import.meta.url)).text()
    expect(css).toContain(':focus-visible')
    expect(css).toContain('@media(max-width:900px)')
  })
})

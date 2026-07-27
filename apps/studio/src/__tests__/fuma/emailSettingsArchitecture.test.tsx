import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DbClient, DbResult } from '../../../server/db/client'
import { emailSettingsVersionsMigration } from '../../../server/fuma/db/migrations/000049_email_settings_versions'
import { hostedMigrations } from '../../../server/fuma/db/migrations'
import { assertHostedMigrationIsAdditive, hostedMigrationChecksum } from '../../../server/fuma/db/migrationPolicy'
import { PostgresEmailSettingsVersionRepository } from '../../../server/fuma/publication/emailSettingsPostgres'
import { createEmailSettingsScopedRouteDeclarations } from '../../../server/fuma/publication/emailSettingsRoutes'
import { EmailSettingsSurface } from '../../admin/fuma/publication/EmailSettingsSurface'
import { PUBLICATION_TEST_SCOPE, TEST_NOW } from '../helpers/fuma/publicationFixtures'

function recordingDb() {
  const sql: string[] = []
  const callable = async <Row,>(strings: TemplateStringsArray): Promise<DbResult<Row>> => {
    const text = strings.join('?')
    sql.push(text)
    if (text.includes('from fuma_tenant_owner_keys owner')) return { rows: [{ authorized: 1 } as Row], rowCount: 1 }
    return { rows: [], rowCount: text.startsWith('select') ? 0 : 1 }
  }
  const db = Object.assign(callable, {
    dialect: 'postgres' as const,
    unsafe: async <Row,>(): Promise<DbResult<Row>> => ({ rows: [], rowCount: 0 }),
    transaction: async <T,>(work: (transaction: DbClient) => Promise<T>) => await work(db as DbClient),
  }) as DbClient
  return { db, sql }
}

const platformVersion = {
  versionId: 'settings-v1', level: 'platform' as const, levelId: 'platform', ordinal: 1, parentVersionId: null,
  overrides: [{ key: 'senderName' as const, value: 'Fuma' }], mutation: { kind: 'set' as const, overrides: [{ key: 'senderName' as const, value: 'Fuma' }] },
  actorId: 'actor-1', createdAt: TEST_NOW,
}
const provenance = { level: 'platform' as const, levelId: 'platform', versionId: 'settings-v1', ordinal: 1, inherited: true }
const resolved = {
  values: { senderName: 'Fuma', senderEmail: 'sender@example.test', replyToEmail: 'reply@example.test', physicalAddress: 'Nairobi, Kenya', brandColor: '#112233', footerText: 'Footer' },
  provenance: { senderName: provenance, senderEmail: provenance, replyToEmail: provenance, physicalAddress: provenance, brandColor: provenance, footerText: provenance },
  provider: 'oci-email-delivery' as const,
  layerVersions: [{ ...platformVersion, overrides: [
    { key: 'senderName' as const, value: 'Fuma' }, { key: 'senderEmail' as const, value: 'sender@example.test' },
    { key: 'replyToEmail' as const, value: 'reply@example.test' }, { key: 'physicalAddress' as const, value: 'Nairobi, Kenya' },
    { key: 'brandColor' as const, value: '#112233' }, { key: 'footerText' as const, value: 'Footer' },
  ] }],
}

describe('FUMA-043 PostgreSQL and architecture gates', () => {
  test('registered 000049 is additive, append-only, and fully qualified', () => {
    expect(emailSettingsVersionsMigration.id).toBe('000049_email_settings_versions')
    expect(() => assertHostedMigrationIsAdditive(emailSettingsVersionsMigration)).not.toThrow()
    expect(hostedMigrationChecksum(emailSettingsVersionsMigration.sql)).toMatch(/^[a-f0-9]{64}$/)
    expect(hostedMigrations).toContain(emailSettingsVersionsMigration)
    const sql = emailSettingsVersionsMigration.sql
    for (const column of ['platform_id', 'organization_id', 'workspace_id', 'site_id', 'owner_key', 'owner_generation', 'profile_id']) expect(sql).toContain(column)
    expect(sql).toContain('email settings versions are immutable')
    expect(sql).toContain('before update or delete')
    expect(sql).toContain('parent_version_id')
    expect(sql).toContain('level_id, parent_version_id)')
    expect(sql).toContain('level_id, version_id)')
    expect(sql).toContain('fuma_email_settings_version_heads')
  })

  test('repository reloads active transfer-free owner and assigned profile, locks one head, and scopes every write', async () => {
    const recording = recordingDb()
    const repository = new PostgresEmailSettingsVersionRepository(recording.db)
    expect(await repository.append(PUBLICATION_TEST_SCOPE, platformVersion, null)).toBe(true)
    await repository.listCurrent(PUBLICATION_TEST_SCOPE, 'newsletter-1')
    const sql = recording.sql.join('\n')
    expect(sql).toContain('site.profile_id=?')
    expect(sql).toContain("owner.state='active'")
    expect(sql).toContain('owner.transfer_id is null')
    expect(sql).toContain('owner.transfer_lock_id is null')
    expect(sql).toContain('owner.transfer_fence is null')
    expect(sql).toContain('for update')
    expect(sql).toContain('limit 5')
    for (const qualifier of ['platform_id=', 'organization_id=', 'workspace_id=', 'site_id=', 'owner_key=', 'owner_generation=', 'profile_id=']) expect(sql).toContain(qualifier)
  })

  test('dedicated declarations are bounded to exact settings permissions and remain central-ready', async () => {
    const declarations = createEmailSettingsScopedRouteDeclarations({} as never)
    const routes = new Map(declarations.map((route) => [`${route.method} ${route.path}`, route.permission]))
    expect(routes).toEqual(new Map([
      ['POST /publication/email-settings/versions', 'site.settings.write'],
      ['GET /publication/email-settings/resolved/:newsletterId', 'site.settings.read'],
      ['GET /publication/email-settings/resolved', 'site.settings.read'],
      ['GET /publication/email-settings/variables/:mode', 'site.settings.read'],
    ]))
    const routeSource = await Bun.file(new URL('../../../server/fuma/publication/emailSettingsRoutes.ts', import.meta.url)).text()
    const composition = await Bun.file(new URL('../../../server/fuma/publication/emailSettingsComposition.ts', import.meta.url)).text()
    const centralComposition = await Bun.file(new URL('../../../server/fuma/publication/composition.ts', import.meta.url)).text()
    expect(routeSource).toContain('readValidatedBody')
    expect(routeSource).not.toMatch(/ownerKey|ownerGeneration|profileId|organizationId|workspaceId|siteId/)
    expect(composition).toContain('new PostgresEmailSettingsVersionRepository(input.db)')
    expect(composition).toContain('createEmailSettingsScopedRouteDeclarations')
    expect(centralComposition).toContain('createEmailSettingsServiceGraph')
    expect(centralComposition).toContain('...emailSettingsV2.scopedRoutes')
  })

  test('implementation uses TypeBox only, has no app-to-app imports, shared UI, nested locks, or provider secrets', async () => {
    const paths = ['emailSettings.ts', 'emailSettingsPostgres.ts', 'emailSettingsRoutes.ts', 'emailSettingsComposition.ts']
    const sources = await Promise.all(paths.map((path) => Bun.file(new URL(`../../../server/fuma/publication/${path}`, import.meta.url)).text()))
    const contracts = await Bun.file(new URL('../../core/fuma/publication/emailSettingsContracts.ts', import.meta.url)).text()
    const surface = await Bun.file(new URL('../../admin/fuma/publication/EmailSettingsSurface.tsx', import.meta.url)).text()
    const all = [...sources, contracts, surface].join('\n')
    expect(all).not.toContain('zod')
    expect(all).not.toMatch(/from ['"]@fuma\/(?:web|control)/)
    expect(surface).not.toMatch(/shared\/ui|@fuma\/(?:web|control).*ui/)
    expect(sources[1]).not.toMatch(/transaction[\s\S]{0,300}transaction/)
    expect(all).not.toMatch(/private[_-]?key\s*[:=]|OCI_PRIVATE|SMTP_PASSWORD/)
  })

  test('standalone Studio surface exposes labelled provenance, focusable forms, reset, status, and no secret fields', async () => {
    const html = renderToStaticMarkup(<EmailSettingsSurface resolved={resolved} targetIds={{ platform: 'platform', organization: 'organization', workspace: 'workspace', site: 'site', newsletter: 'newsletter-1' }} canWrite onChange={async () => {}} />)
    expect(html).toContain('aria-labelledby="email-settings-title"')
    expect(html).toContain('Resolved values and provenance')
    expect(html).toContain('Reset to inherited')
    expect(html).toContain('role="status"')
    expect(html).toContain('type="checkbox"')
    expect(html).not.toMatch(/secret|credential|private key/i)
    const css = await Bun.file(new URL('../../admin/fuma/publication/EmailSettingsSurface.module.css', import.meta.url)).text()
    expect(css).toContain(':focus-visible')
    expect(css).toContain('@media(max-width:900px)')
  })
})

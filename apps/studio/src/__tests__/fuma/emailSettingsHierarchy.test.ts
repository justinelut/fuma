import { describe, expect, test } from 'bun:test'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import {
  EmailSettingsChangeCommandSchema,
  type EmailSettingKey,
  type EmailSettingOverride,
  type EmailSettingsLevel,
  type EmailSettingsTarget,
  type EmailSettingsVersion,
} from '@core/fuma/publication/emailSettingsContracts'
import {
  EmailSettingsError,
  HierarchicalEmailSettingsService,
  emailVariableBinding,
  emailVariableCatalog,
  redactEmailVariableValues,
  resolveAuthorizedEmailVariables,
  type EmailSettingsVersionRepository,
} from '../../../server/fuma/publication/emailSettings'
import type { PublicationRepositoryScope } from '../../../server/fuma/publication/scope'
import { PUBLICATION_TEST_SCOPE, TEST_NOW } from '../helpers/fuma/publicationFixtures'

const LEVELS: readonly EmailSettingsLevel[] = ['platform', 'organization', 'workspace', 'site', 'newsletter']
const IDS: Readonly<Record<EmailSettingsLevel, string>> = { platform: 'platform', organization: 'organization', workspace: 'workspace', site: 'site', newsletter: 'newsletter-1' }
const BASE: readonly EmailSettingOverride[] = [
  { key: 'senderName', value: 'Platform sender' },
  { key: 'senderEmail', value: 'sender@example.test' },
  { key: 'replyToEmail', value: 'reply@example.test' },
  { key: 'physicalAddress', value: 'Nairobi, Kenya' },
  { key: 'brandColor', value: '#112233' },
  { key: 'footerText', value: 'Platform footer' },
]

class MemoryVersions implements EmailSettingsVersionRepository {
  readonly versions = new Map<string, EmailSettingsVersion>()
  readonly history: EmailSettingsVersion[] = []
  current(scope: PublicationRepositoryScope, target: EmailSettingsTarget) { return Promise.resolve(structuredClone(this.versions.get(key(scope, target.level, target.levelId)) ?? null)) }
  listCurrent(scope: PublicationRepositoryScope, newsletterId: string | null) {
    const allowed = new Set([scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId, newsletterId].filter(Boolean))
    const prefix = scopeKey(scope)
    return Promise.resolve([...this.versions].filter(([id, item]) => id.startsWith(prefix) && allowed.has(item.levelId)).map(([, item]) => structuredClone(item)))
  }
  append(scope: PublicationRepositoryScope, version: EmailSettingsVersion, expectedVersionId: string | null) {
    const id = key(scope, version.level, version.levelId)
    const current = this.versions.get(id)
    if ((current?.versionId ?? null) !== expectedVersionId || this.history.some((item) => item.versionId === version.versionId)) return Promise.resolve(false)
    this.versions.set(id, structuredClone(version)); this.history.push(structuredClone(version)); return Promise.resolve(true)
  }
}

function harness(scope: PublicationRepositoryScope = PUBLICATION_TEST_SCOPE) {
  const repository = new MemoryVersions()
  let next = 0
  const service = new HierarchicalEmailSettingsService(repository, { id: () => `settings-v${++next}` }, () => new Date(TEST_NOW))
  return { scope, repository, service }
}
async function change(h: ReturnType<typeof harness>, level: EmailSettingsLevel, mutation: EmailSettingsVersion['mutation']) {
  const current = await h.repository.current(h.scope, { level, levelId: IDS[level] })
  return h.service.change(h.scope, 'actor-1', { target: { level, levelId: IDS[level] }, expectedVersionId: current?.versionId ?? null, mutation })
}
function override(key: EmailSettingKey, level: EmailSettingsLevel): EmailSettingOverride {
  switch (key) {
    case 'senderName': return { key, value: `${level} sender` }
    case 'senderEmail': return { key, value: `${level}@example.test` }
    case 'replyToEmail': return { key, value: `${level}-reply@example.test` }
    case 'physicalAddress': return { key, value: `${level} physical address` }
    case 'brandColor': return { key, value: `#${String(LEVELS.indexOf(level) + 1).repeat(6)}` }
    case 'footerText': return { key, value: `${level} footer` }
  }
}

for (const level of LEVELS) for (const setting of BASE.map((item) => item.key)) {
  test(`inheritance matrix resolves ${setting} from ${level}`, async () => {
    const h = harness()
    await change(h, 'platform', { kind: 'set', overrides: BASE })
    if (level !== 'platform') await change(h, level, { kind: 'set', overrides: [override(setting, level)] })
    const resolved = await h.service.resolve(h.scope, IDS.newsletter)
    expect(resolved.provenance[setting].level).toBe(level)
    expect(resolved.provenance[setting].levelId).toBe(IDS[level])
    expect(resolved.provenance[setting].inherited).toBe(level !== 'newsletter')
  })
}

describe('FUMA-043 hierarchical email settings', () => {
  test('keeps every version immutable and reset creates a new version that restores inheritance', async () => {
    const h = harness()
    await change(h, 'platform', { kind: 'set', overrides: BASE })
    await change(h, 'site', { kind: 'set', overrides: [{ key: 'senderName', value: 'Site sender' }, { key: 'brandColor', value: '#445566' }] })
    const newsletter = await change(h, 'newsletter', { kind: 'set', overrides: [{ key: 'senderName', value: 'Newsletter sender' }, { key: 'brandColor', value: '#778899' }] })
    const reset = await change(h, 'newsletter', { kind: 'reset', keys: ['senderName', 'brandColor'] })
    expect(reset.parentVersionId).toBe(newsletter.versionId)
    expect(reset.ordinal).toBe(2)
    expect(reset.overrides).toEqual([])
    expect(h.repository.history.find((item) => item.versionId === newsletter.versionId)?.overrides).toEqual([{ key: 'senderName', value: 'Newsletter sender' }, { key: 'brandColor', value: '#778899' }])
    const resolved = await h.service.resolve(h.scope, IDS.newsletter)
    expect(resolved.values.senderName).toBe('Site sender')
    expect(resolved.provenance.senderName).toMatchObject({ level: 'site', inherited: true })
  })

  test('denies stale heads, duplicate overrides, incomplete baselines, and cross-level IDs', async () => {
    const h = harness()
    const platform = await change(h, 'platform', { kind: 'set', overrides: BASE })
    await expect(h.service.change(h.scope, 'actor-1', { target: { level: 'platform', levelId: IDS.platform }, expectedVersionId: null, mutation: { kind: 'reset', keys: ['senderName'] } })).rejects.toMatchObject({ code: 'conflict' })
    await expect(h.service.change(h.scope, 'actor-1', { target: { level: 'platform', levelId: IDS.platform }, expectedVersionId: platform.versionId, mutation: { kind: 'set', overrides: [{ key: 'senderName', value: 'A' }, { key: 'senderName', value: 'B' }] } })).rejects.toMatchObject({ code: 'invalid-hierarchy' })
    await expect(h.service.change(h.scope, 'actor-1', { target: { level: 'site', levelId: 'other-site' }, expectedVersionId: null, mutation: { kind: 'set', overrides: [{ key: 'senderName', value: 'Denied' }] } })).rejects.toMatchObject({ code: 'scope-denied' })
    const empty = harness()
    await change(empty, 'site', { kind: 'set', overrides: [{ key: 'senderName', value: 'Only' }] })
    await expect(empty.service.resolve(empty.scope, IDS.newsletter)).rejects.toMatchObject({ code: 'incomplete' })
  })

  test('isolates site, owner generation, and profile even when logical level IDs collide', async () => {
    const primary = harness()
    await change(primary, 'platform', { kind: 'set', overrides: BASE })
    const variants = [
      { ...PUBLICATION_TEST_SCOPE, siteId: 'other-site' },
      { ...PUBLICATION_TEST_SCOPE, ownerKey: 'other-owner' },
      { ...PUBLICATION_TEST_SCOPE, generation: 2 },
      { ...PUBLICATION_TEST_SCOPE, profileId: 'other-profile' },
    ] satisfies PublicationRepositoryScope[]
    for (const scope of variants) expect(await primary.repository.listCurrent(scope, IDS.newsletter)).toEqual([])
  })

  test('strict command contracts reject tenant, actor, profile, and unbounded caller authority', () => {
    const command = { target: { level: 'site', levelId: 'site' }, expectedVersionId: null, mutation: { kind: 'reset', keys: ['senderName'] }, ownerKey: 'forged', actorId: 'forged', profileId: 'forged' }
    expect(safeParseValue(EmailSettingsChangeCommandSchema, command).ok).toBe(false)
  })
})

describe('FUMA-043 typed authorized variables', () => {
  const binding = emailVariableBinding(PUBLICATION_TEST_SCOPE, IDS.newsletter)
  const value = (name: string, entry: string, source = binding) => ({ name, value: entry, binding: source })

  test('publishes a typed mode-specific catalog without any secret definition', () => {
    const preview = emailVariableCatalog('preview')
    expect(preview.variables.map((item) => item.name)).toContain('member.displayName')
    expect(preview.variables.map((item) => item.name)).not.toContain('member.email')
    expect(preview.variables.map((item) => item.name)).not.toContain('platform.ociPrivateKey')
    expect(preview.deniedSecretCount).toBe(1)
  })

  test('resolves typed authorized values and denies unknown, missing, secret, unauthorized, and wrong-type values', () => {
    expect(resolveAuthorizedEmailVariables({ scope: PUBLICATION_TEST_SCOPE, newsletterId: IDS.newsletter, mode: 'preview', names: ['site.url'], values: [value('site.url', 'https://site.example.test')] }).values).toEqual([{ name: 'site.url', value: 'https://site.example.test' }])
    expect(() => resolveAuthorizedEmailVariables({ scope: PUBLICATION_TEST_SCOPE, newsletterId: IDS.newsletter, mode: 'preview', names: ['unknown.value'], values: [] })).toThrow(EmailSettingsError)
    expect(() => resolveAuthorizedEmailVariables({ scope: PUBLICATION_TEST_SCOPE, newsletterId: IDS.newsletter, mode: 'preview', names: ['site.url'], values: [] })).toThrow('required email variable')
    expect(() => resolveAuthorizedEmailVariables({ scope: PUBLICATION_TEST_SCOPE, newsletterId: IDS.newsletter, mode: 'send', names: ['platform.ociPrivateKey'], values: [value('platform.ociPrivateKey', 'NEVER-LEAK')] })).toThrow('Secret email variables are unavailable')
    expect(() => resolveAuthorizedEmailVariables({ scope: PUBLICATION_TEST_SCOPE, newsletterId: IDS.newsletter, mode: 'preview', names: ['member.email'], values: [value('member.email', 'member@example.test')] })).toThrow('not authorized')
    expect(() => resolveAuthorizedEmailVariables({ scope: PUBLICATION_TEST_SCOPE, newsletterId: IDS.newsletter, mode: 'preview', names: ['site.url'], values: [value('site.url', 'javascript:alert(1)')] })).toThrow('invalid type')
  })

  test('denies cross-site, owner-generation, and profile variable contexts', () => {
    for (const foreign of [{ ...binding, siteId: 'other' }, { ...binding, ownerGeneration: 2 }, { ...binding, profileId: 'other' }]) {
      expect(() => resolveAuthorizedEmailVariables({ scope: PUBLICATION_TEST_SCOPE, newsletterId: IDS.newsletter, mode: 'preview', names: ['site.url'], values: [value('site.url', 'https://site.example.test', foreign)] })).toThrow('scope denied')
    }
  })

  test('redacts personal values and both secret names and values from diagnostics', () => {
    const redacted = redactEmailVariableValues([value('site.url', 'https://site.example.test'), value('member.email', 'member@example.test'), value('platform.ociPrivateKey', 'NEVER-LEAK')])
    expect(redacted).toEqual([{ name: 'site.url', value: 'https://site.example.test' }, { name: 'member.email', value: '[REDACTED]' }, { name: '[REDACTED]', value: '[REDACTED]' }])
    expect(JSON.stringify(redacted)).not.toContain('member@example.test')
    expect(JSON.stringify(redacted)).not.toContain('NEVER-LEAK')
    expect(JSON.stringify(redacted)).not.toContain('ociPrivateKey')
  })
})

function scopeKey(scope: PublicationRepositoryScope) {
  return [scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId, scope.ownerKey, scope.generation, scope.profileId, ''].join('\0')
}
function key(scope: PublicationRepositoryScope, level: EmailSettingsLevel, levelId: string) {
  return `${scopeKey(scope)}${level}\0${levelId}`
}

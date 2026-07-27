import { expect, test } from 'bun:test'
import type { EmailSettingsLevel, EmailSettingsVersion } from '@core/fuma/publication/emailSettingsContracts'
import { resolveEmailSettingsVersions } from '../../../server/fuma/publication/emailSettings'
import { PUBLICATION_TEST_SCOPE, TEST_NOW } from '../helpers/fuma/publicationFixtures'

const levels: readonly EmailSettingsLevel[] = ['platform', 'organization', 'workspace', 'site', 'newsletter']
const ids: Readonly<Record<EmailSettingsLevel, string>> = { platform: 'platform', organization: 'organization', workspace: 'workspace', site: 'site', newsletter: 'newsletter-1' }
const colors = ['#111111', '#222222', '#333333', '#444444', '#555555'] as const

function version(level: EmailSettingsLevel, index: number): EmailSettingsVersion {
  const overrides = index === 0 ? [
    { key: 'senderEmail' as const, value: 'sender@example.test' }, { key: 'replyToEmail' as const, value: 'reply@example.test' },
    { key: 'physicalAddress' as const, value: 'Nairobi, Kenya' }, { key: 'footerText' as const, value: 'Public footer' },
    { key: 'senderName' as const, value: `${level} sender` }, { key: 'brandColor' as const, value: colors[index] },
  ] : [{ key: 'senderName' as const, value: `${level} sender` }, { key: 'brandColor' as const, value: colors[index] }]
  return { versionId: `settings-${index + 1}`, level, levelId: ids[level], ordinal: 1, parentVersionId: null, overrides, mutation: { kind: 'set', overrides }, actorId: 'demo-actor', createdAt: TEST_NOW }
}

test('FUMA-043 demo: deterministic per-level sender and theme provenance contains no secrets', () => {
  const resolved = resolveEmailSettingsVersions(PUBLICATION_TEST_SCOPE, ids.newsletter, levels.map(version))
  const transcript = {
    levels: resolved.layerVersions.map((item) => ({ level: item.level, senderName: item.overrides.find((entry) => entry.key === 'senderName')?.value, brandColor: item.overrides.find((entry) => entry.key === 'brandColor')?.value, versionId: item.versionId })),
    final: { senderName: resolved.values.senderName, brandColor: resolved.values.brandColor, senderProvenance: resolved.provenance.senderName, themeProvenance: resolved.provenance.brandColor, provider: resolved.provider },
  }
  expect(transcript).toEqual({
    levels: [
      { level: 'platform', senderName: 'platform sender', brandColor: '#111111', versionId: 'settings-1' },
      { level: 'organization', senderName: 'organization sender', brandColor: '#222222', versionId: 'settings-2' },
      { level: 'workspace', senderName: 'workspace sender', brandColor: '#333333', versionId: 'settings-3' },
      { level: 'site', senderName: 'site sender', brandColor: '#444444', versionId: 'settings-4' },
      { level: 'newsletter', senderName: 'newsletter sender', brandColor: '#555555', versionId: 'settings-5' },
    ],
    final: {
      senderName: 'newsletter sender', brandColor: '#555555',
      senderProvenance: { level: 'newsletter', levelId: 'newsletter-1', versionId: 'settings-5', ordinal: 1, inherited: false },
      themeProvenance: { level: 'newsletter', levelId: 'newsletter-1', versionId: 'settings-5', ordinal: 1, inherited: false },
      provider: 'oci-email-delivery',
    },
  })
  const serialized = JSON.stringify(transcript)
  expect(serialized).not.toMatch(/secret|credential|privateKey|token/i)
  console.info(`FUMA-043_DEMO ${serialized}`)
})

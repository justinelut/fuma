import { PublicationEmailSettingsService, PublicationNewsletterService } from '../../../server/fuma/publication/services'
import { parsePublicationContract, NewsletterTestSendCommandSchema } from '../../core/fuma/publication'
import { publicationFixture, TEST_NOW } from '../helpers/fuma/publicationFixtures'

const document = (text: string) => ({
  version: 1 as const,
  lang: 'en' as const,
  direction: 'ltr' as const,
  children: [{ type: 'text' as const, text }],
})

async function setup(now: () => Date = () => new Date(TEST_NOW)) {
  const harness = publicationFixture()
  harness.store.layers.set('platform\0platform', {
    scope: 'platform', scopeId: 'platform',
    values: { senderName: 'Fuma', senderEmail: 'hello@example.com', replyToEmail: 'reply@example.com', physicalAddress: 'Nairobi', brandColor: '#112233', footerText: 'Footer' },
    version: 1, updatedAt: TEST_NOW,
  })
  const service = new PublicationNewsletterService(harness.store, new PublicationEmailSettingsService(harness.store), harness.oci, now)
  await service.save(harness.scope, { newsletterId: 'newsletter-1', name: 'Daily', slug: 'daily', description: '', defaultSegmentId: null, status: 'active', createdAt: TEST_NOW, updatedAt: TEST_NOW })
  await service.createVersion(harness.scope, { versionId: 'version-1', newsletterId: 'newsletter-1', ordinal: 1, subject: 'Hello {{member.displayName}}', previewText: 'First', document: document('Reader {{member.displayName}} / {{member.email}} / {{unsubscribe.url}}'), createdBy: 'actor', createdAt: TEST_NOW, lockedAt: null })
  return { ...harness, service }
}

describe('FUMA-045 newsletter preview, test send, and template versioning', () => {
  test('renders deterministic responsive HTML and plaintext for public, free, and paid fixtures without caller data', async () => {
    const harness = await setup()
    const publicPreview = await harness.service.preview(harness.scope, 'version-1', 'public')
    const freePreview = await harness.service.preview(harness.scope, 'version-1', 'free-member')
    const paidPreview = await harness.service.preview(harness.scope, 'version-1', 'paid-member')
    expect([publicPreview.fixtureLabel, freePreview.fixtureLabel, paidPreview.fixtureLabel]).toEqual(['Public visitor', 'Free member', 'Paid member'])
    expect(publicPreview.html).toContain('Public visitor')
    expect(freePreview.text).toContain('Amina Free')
    expect(paidPreview.html).toContain('Kamau Paid')
    expect(`${publicPreview.html}${freePreview.html}${paidPreview.html}`).not.toContain('{{member.')
    expect(`${publicPreview.html}${freePreview.html}${paidPreview.html}`).not.toContain('platform.ociPrivateKey')
    expect(await harness.service.preview(harness.scope, 'version-1', 'paid-member')).toEqual(paidPreview)
  })

  test('keeps referenced versions immutable, requires contiguous ordinals, and compares stable fields', async () => {
    const harness = await setup()
    await expect(harness.service.createVersion(harness.scope, { versionId: 'version-gap', newsletterId: 'newsletter-1', ordinal: 3, subject: 'Gap', previewText: '', document: document('Gap'), createdBy: 'actor', createdAt: TEST_NOW, lockedAt: null })).rejects.toThrow('next immutable version')
    await harness.service.createVersion(harness.scope, { versionId: 'version-2', newsletterId: 'newsletter-1', ordinal: 2, subject: 'Revised', previewText: 'Second', document: document('Revised body'), createdBy: 'actor', createdAt: TEST_NOW, lockedAt: null })
    await expect(harness.service.createVersion(harness.scope, { versionId: 'version-1', newsletterId: 'newsletter-1', ordinal: 3, subject: 'Overwrite', previewText: '', document: document('Overwrite'), createdBy: 'actor', createdAt: TEST_NOW, lockedAt: null })).rejects.toThrow()
    expect(await harness.service.compare(harness.scope, 'newsletter-1', 'version-1', 'version-2')).toEqual({ newsletterId: 'newsletter-1', fromVersionId: 'version-1', toVersionId: 'version-2', fromOrdinal: 1, toOrdinal: 2, changed: ['subject', 'previewText', 'document'] })
    await expect(harness.service.compare(harness.scope, 'foreign-newsletter', 'version-1', 'version-2')).rejects.toThrow('not found')
  })

  test('rejects caller fixture values and bounds idempotent test sends per scoped recipient', async () => {
    let time = Date.parse(TEST_NOW)
    const harness = await setup(() => new Date(time))
    expect(() => parsePublicationContract('test send', NewsletterTestSendCommandSchema, { versionId: 'version-1', fixture: 'paid-member', recipient: 'test@example.com', idempotencyKey: 'one', fixtureVariables: { 'member.email': 'victim@example.com' } })).toThrow()
    for (let index = 0; index < 5; index += 1) await harness.service.testSend(harness.scope, { versionId: 'version-1', fixture: 'free-member', recipient: 'test@example.com', idempotencyKey: `send-${index}` })
    await expect(harness.service.testSend(harness.scope, { versionId: 'version-1', fixture: 'free-member', recipient: 'test@example.com', idempotencyKey: 'send-5' })).rejects.toMatchObject({ code: 'rate-limited' })
    time += 600_000
    await expect(harness.service.testSend(harness.scope, { versionId: 'version-1', fixture: 'paid-member', recipient: 'test@example.com', idempotencyKey: 'send-5' })).resolves.toBe('oci-6')
    expect(harness.oci.submissions.every((submission) => submission.headers['X-Fuma-Test'] === 'true')).toBe(true)
  })

  test('keeps read, write, and send permissions explicit and the UI errors accessible', async () => {
    const routes = await Bun.file(new URL('../../../server/fuma/publication/routes.ts', import.meta.url)).text()
    const workspace = await Bun.file(new URL('../../admin/fuma/publication/PublicationWorkspace.tsx', import.meta.url)).text()
    expect(routes).toContain("'/publication/newsletter-preview/:versionId', 'publication.newsletters.read'")
    expect(routes).toContain("'/publication/newsletter-versions', 'publication.newsletters.write'")
    expect(routes).toContain("'/publication/newsletter-test', 'publication.newsletters.send'")
    expect(workspace).toContain('Newsletter plaintext preview')
    expect(workspace).toContain('Compare immutable versions')
    expect(workspace).toContain('role="status"')
  })

  test('demo: preview three contexts, test-send through fake OCI, and compare a new immutable version', async () => {
    const harness = await setup()
    const fixtures = await Promise.all((['public', 'free-member', 'paid-member'] as const).map((fixture) => harness.service.preview(harness.scope, 'version-1', fixture)))
    const providerMessageId = await harness.service.testSend(harness.scope, { versionId: 'version-1', fixture: 'paid-member', recipient: 'owner@example.com', idempotencyKey: 'demo-send' })
    await harness.service.createVersion(harness.scope, { versionId: 'version-2', newsletterId: 'newsletter-1', ordinal: 2, subject: 'New edition', previewText: 'New', document: document('New body'), createdBy: 'actor', createdAt: TEST_NOW, lockedAt: null })
    const comparison = await harness.service.compare(harness.scope, 'newsletter-1', 'version-1', 'version-2')
    console.info('[FUMA-045 demo]', JSON.stringify({ fixtures: fixtures.map((item) => item.fixtureLabel), providerMessageId, comparison }))
    expect(providerMessageId).toBe('oci-1')
    expect(comparison.changed).toEqual(['subject', 'previewText', 'document'])
  })
})

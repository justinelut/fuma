import { expect, test } from 'bun:test'
import type { PublicationContent } from '@core/fuma/publication'
import type { ResolvedEmailSettingsV2 } from '@core/fuma/publication/emailSettingsContracts'
import type { NewsletterComposerDraft, NewsletterSenderVerification, PublicationNewsletterProfile } from '@core/fuma/publication/newsletterComposerContracts'
import { NewsletterComposerService, type NewsletterComposerRepository, type NewsletterDraftSaveResult } from '../../../server/fuma/publication/newsletterComposer'
import type { PublicationRepositoryScope } from '../../../server/fuma/publication/scope'

const PUBLICATION_TEST_SCOPE: PublicationRepositoryScope = Object.freeze({ platformId: 'platform', organizationId: 'organization', workspaceId: 'workspace', siteId: 'site', ownerKey: 'owner-key', generation: 1, state: 'active', transferFence: null, profileId: 'publication' })
const TEST_NOW = '2040-01-02T03:04:05.000Z'

class DemoRepository implements NewsletterComposerRepository {
  profiles = new Map<string, PublicationNewsletterProfile>(); drafts = new Map<string, NewsletterComposerDraft>(); verifications = new Map<string, NewsletterSenderVerification>(); mutations = new Map<string, NewsletterComposerDraft>()
  list(_scope: PublicationRepositoryScope, limit: number) { return Promise.resolve([...this.profiles.values()].toSorted((a, b) => a.newsletterId.localeCompare(b.newsletterId)).slice(0, limit)) }
  get(_scope: PublicationRepositoryScope, id: string) { return Promise.resolve(this.profiles.get(id) ?? null) }
  put(_scope: PublicationRepositoryScope, value: PublicationNewsletterProfile, expected: number | null) { const current = this.profiles.get(value.newsletterId); if (expected === null ? !!current : current?.version !== expected) return Promise.resolve(false); this.profiles.set(value.newsletterId, value); return Promise.resolve(true) }
  getDraft(_scope: PublicationRepositoryScope, id: string) { return Promise.resolve(this.drafts.get(id) ?? null) }
  saveDraft(_scope: PublicationRepositoryScope, draft: NewsletterComposerDraft, expected: number, mutationId: string, _hash: string): Promise<NewsletterDraftSaveResult> { const replay = this.mutations.get(mutationId); if (replay) return Promise.resolve({ kind: 'replayed', draft: replay }); const current = this.drafts.get(draft.newsletterId); if ((current?.sequence ?? 0) !== expected) return Promise.resolve({ kind: 'conflict', draft: current ?? null }); this.drafts.set(draft.newsletterId, draft); this.mutations.set(mutationId, draft); return Promise.resolve({ kind: 'saved', draft }) }
  getSenderVerification(_scope: PublicationRepositoryScope, email: string) { return Promise.resolve(this.verifications.get(email) ?? null) }
  recordSenderVerification(_scope: PublicationRepositoryScope, value: NewsletterSenderVerification) { this.verifications.set(value.senderEmail, value); return Promise.resolve(true) }
}

function settings(newsletterId: string): ResolvedEmailSettingsV2 {
  const direct = newsletterId === 'newsletter-founders'
  const level = direct ? 'newsletter' as const : 'site' as const
  const levelId = direct ? newsletterId : PUBLICATION_TEST_SCOPE.siteId
  const senderName = direct ? 'Founder Dispatch' : 'Fuma Publication'
  const senderEmail = direct ? 'founders@example.test' : 'publication@example.test'
  const version = { versionId: `settings-${newsletterId}`, level, levelId, ordinal: 1, parentVersionId: null, overrides: [{ key: 'senderName' as const, value: senderName }, { key: 'senderEmail' as const, value: senderEmail }, { key: 'replyToEmail' as const, value: 'reply@example.test' }, { key: 'physicalAddress' as const, value: 'Nairobi' }, { key: 'brandColor' as const, value: '#112233' }, { key: 'footerText' as const, value: 'Footer' }], mutation: { kind: 'set' as const, overrides: [{ key: 'senderName' as const, value: senderName }] }, actorId: 'owner-1', createdAt: TEST_NOW }
  const provenance = { level, levelId, versionId: version.versionId, ordinal: 1, inherited: !direct }
  return { values: { senderName, senderEmail, replyToEmail: 'reply@example.test', physicalAddress: 'Nairobi', brandColor: '#112233', footerText: 'Footer' }, provenance: { senderName: provenance, senderEmail: provenance, replyToEmail: provenance, physicalAddress: provenance, brandColor: provenance, footerText: provenance }, provider: 'oci-email-delivery', layerVersions: [version] }
}

test('FUMA-044 demo: two newsletters inherit differently and target distinct subscribed segments', async () => {
  const repository = new DemoRepository(); let id = 0
  const service = new NewsletterComposerService({ repository, content: { getContent: async (_scope, id) => ({ contentId: id, status: 'published' } as PublicationContent) }, settings: { resolve: async (_scope, id) => settings(id!) }, audience: { segmentExists: async () => true, estimate: async (_scope, newsletterId, audience) => ({ newsletterId, audience, estimatedSubscribed: newsletterId === 'newsletter-founders' ? 2 : 3, evaluatedMembers: newsletterId === 'newsletter-founders' ? 2 : 3, candidateMembers: newsletterId === 'newsletter-founders' ? 2 : 3, countKind: 'exact', segmentVersions: [{ segmentId: audience.segmentIds[0]!, version: newsletterId === 'newsletter-founders' ? 4 : 7 }], estimatedAt: TEST_NOW }) }, ids: { id: (kind) => `${kind}-${++id}`, sha256: (value) => new Bun.CryptoHasher('sha256').update(value).digest('hex') }, now: () => new Date(TEST_NOW) })
  const profiles = [
    { newsletterId: 'newsletter-founders', name: 'Founder Dispatch', slug: 'founder-dispatch', defaultSegmentId: 'segment-founders', webContentId: 'post-founder' },
    { newsletterId: 'newsletter-weekend', name: 'Weekend Edition', slug: 'weekend-edition', defaultSegmentId: 'segment-weekend', webContentId: 'post-weekend' },
  ] as const
  for (const profile of profiles) {
    await service.saveProfile(PUBLICATION_TEST_SCOPE, 'owner-1', { ...profile, description: '', status: 'active', expectedVersion: null })
    await service.autosave(PUBLICATION_TEST_SCOPE, 'editor-1', { newsletterId: profile.newsletterId, draftId: null, mutationId: `mutation-${profile.newsletterId}`, expectedSequence: 0, subject: profile.name, previewText: '', document: { version: 1, lang: 'en', direction: 'ltr', children: [{ type: 'heading', level: 1, text: profile.name }] }, audience: { segmentIds: [profile.defaultSegmentId], match: 'all', subscription: 'subscribed', scanLimit: 500 } })
    const resolved = settings(profile.newsletterId)
    await repository.recordSenderVerification(PUBLICATION_TEST_SCOPE, { senderEmail: resolved.values.senderEmail, state: 'verified', providerIdentityId: `oci-${profile.newsletterId}`, verifiedAt: TEST_NOW, checkedAt: TEST_NOW })
  }
  const transcript = []
  for (const profile of profiles) {
    const readiness = await service.assertSendAllowed(PUBLICATION_TEST_SCOPE, profile.newsletterId)
    transcript.push({ newsletterId: profile.newsletterId, sender: readiness.settings.values.senderName, inheritedFrom: readiness.settings.provenance.senderName.level, inherited: readiness.settings.provenance.senderName.inherited, segmentId: readiness.draft.audience.segmentIds[0], subscribed: readiness.audienceEstimate.estimatedSubscribed, linkedWebContentId: readiness.newsletter.webContentId, sequence: readiness.draft.sequence, canSend: readiness.canSend })
  }
  expect(transcript).toEqual([
    { newsletterId: 'newsletter-founders', sender: 'Founder Dispatch', inheritedFrom: 'newsletter', inherited: false, segmentId: 'segment-founders', subscribed: 2, linkedWebContentId: 'post-founder', sequence: 1, canSend: true },
    { newsletterId: 'newsletter-weekend', sender: 'Fuma Publication', inheritedFrom: 'site', inherited: true, segmentId: 'segment-weekend', subscribed: 3, linkedWebContentId: 'post-weekend', sequence: 1, canSend: true },
  ])
  console.info(`FUMA-044_DEMO ${JSON.stringify(transcript)}`)
})

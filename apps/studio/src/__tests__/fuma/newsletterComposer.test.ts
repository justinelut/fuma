import { describe, expect, test } from 'bun:test'
import type { PublicationContent, PublicationMemberSegment, PublicationSegmentMembershipSnapshot } from '@core/fuma/publication'
import type { ResolvedEmailSettingsV2 } from '@core/fuma/publication/emailSettingsContracts'
import type {
  NewsletterAudienceEstimate,
  NewsletterComposerDraft,
  NewsletterSenderVerification,
  PublicationNewsletterProfile,
} from '@core/fuma/publication/newsletterComposerContracts'
import { NewsletterComposerError, NewsletterComposerService, type NewsletterComposerRepository, type NewsletterDraftSaveResult } from '../../../server/fuma/publication/newsletterComposer'
import { PublicationMemberAudienceAuthority } from '../../../server/fuma/publication/newsletterAudience'
import type { PublicationRepositoryScope } from '../../../server/fuma/publication/scope'

const PUBLICATION_TEST_SCOPE: PublicationRepositoryScope = Object.freeze({ platformId: 'platform', organizationId: 'organization', workspaceId: 'workspace', siteId: 'site', ownerKey: 'owner-key', generation: 1, state: 'active', transferFence: null, profileId: 'publication' })
const TEST_NOW = '2040-01-02T03:04:05.000Z'

const OTHER_SCOPE: PublicationRepositoryScope = Object.freeze({ ...PUBLICATION_TEST_SCOPE, siteId: 'other-site', ownerKey: 'other-owner' })
const DOCUMENT = Object.freeze({ version: 1 as const, lang: 'en' as const, direction: 'ltr' as const, children: [{ type: 'heading' as const, level: 1 as const, text: 'Launch' }, { type: 'text' as const, text: 'Hello members' }] })
const AUDIENCE = Object.freeze({ segmentIds: ['segment-a'], match: 'all' as const, subscription: 'subscribed' as const, scanLimit: 500 })

class MemoryNewsletterRepository implements NewsletterComposerRepository {
  readonly profiles = new Map<string, PublicationNewsletterProfile>()
  readonly drafts = new Map<string, NewsletterComposerDraft>()
  readonly verifications = new Map<string, NewsletterSenderVerification>()
  readonly mutations = new Map<string, { hash: string; draft: NewsletterComposerDraft }>()
  #tail: Promise<void> = Promise.resolve()
  key(scope: PublicationRepositoryScope, id: string) { return [scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId, scope.ownerKey, scope.generation, scope.profileId, id].join('\0') }
  list(scope: PublicationRepositoryScope, limit: number) { const prefix = this.key(scope, ''); return Promise.resolve([...this.profiles].filter(([key]) => key.startsWith(prefix)).map(([, value]) => structuredClone(value)).slice(0, limit)) }
  get(scope: PublicationRepositoryScope, id: string) { return Promise.resolve(structuredClone(this.profiles.get(this.key(scope, id)) ?? null)) }
  put(scope: PublicationRepositoryScope, value: PublicationNewsletterProfile, expected: number | null) {
    const key = this.key(scope, value.newsletterId), current = this.profiles.get(key), prefix = this.key(scope, '')
    if (expected === null ? !!current : current?.version !== expected) return Promise.resolve(false)
    if ([...this.profiles].some(([otherKey, item]) => otherKey.startsWith(prefix) && otherKey !== key && item.slug === value.slug)) return Promise.resolve(false)
    this.profiles.set(key, structuredClone(value)); return Promise.resolve(true)
  }
  getDraft(scope: PublicationRepositoryScope, id: string) { return Promise.resolve(structuredClone(this.drafts.get(this.key(scope, id)) ?? null)) }
  saveDraft(scope: PublicationRepositoryScope, draft: NewsletterComposerDraft, expected: number, mutationId: string, hash: string): Promise<NewsletterDraftSaveResult> {
    let resolve!: (value: NewsletterDraftSaveResult) => void
    const result = new Promise<NewsletterDraftSaveResult>((done) => { resolve = done })
    this.#tail = this.#tail.then(() => {
      const mutationKey = this.key(scope, `${draft.newsletterId}:${mutationId}`), prior = this.mutations.get(mutationKey)
      if (prior) { resolve(prior.hash === hash ? { kind: 'replayed', draft: structuredClone(prior.draft) } : { kind: 'conflict', draft: null }); return }
      const key = this.key(scope, draft.newsletterId), current = this.drafts.get(key)
      if ((current?.sequence ?? 0) !== expected || (current && current.draftId !== draft.draftId)) { resolve({ kind: 'conflict', draft: structuredClone(current ?? null) }); return }
      this.drafts.set(key, structuredClone(draft)); this.mutations.set(mutationKey, { hash, draft: structuredClone(draft) }); resolve({ kind: 'saved', draft: structuredClone(draft) })
    })
    return result
  }
  getSenderVerification(scope: PublicationRepositoryScope, email: string) { return Promise.resolve(structuredClone(this.verifications.get(this.key(scope, email.toLowerCase())) ?? null)) }
  recordSenderVerification(scope: PublicationRepositoryScope, value: NewsletterSenderVerification) { this.verifications.set(this.key(scope, value.senderEmail.toLowerCase()), structuredClone(value)); return Promise.resolve(true) }
}

function resolvedSettings(newsletterId: string, senderEmail = 'letters@example.test'): ResolvedEmailSettingsV2 {
  const version = { versionId: `settings-${newsletterId}`, level: 'site' as const, levelId: PUBLICATION_TEST_SCOPE.siteId, ordinal: 1, parentVersionId: null, overrides: [
    { key: 'senderName' as const, value: 'Fuma Letters' }, { key: 'senderEmail' as const, value: senderEmail }, { key: 'replyToEmail' as const, value: 'reply@example.test' }, { key: 'physicalAddress' as const, value: 'Nairobi, Kenya' }, { key: 'brandColor' as const, value: '#112233' }, { key: 'footerText' as const, value: 'You received this because you subscribed.' },
  ], mutation: { kind: 'set' as const, overrides: [{ key: 'senderName' as const, value: 'Fuma Letters' }] }, actorId: 'owner-1', createdAt: TEST_NOW }
  const provenance = { level: 'site' as const, levelId: PUBLICATION_TEST_SCOPE.siteId, versionId: version.versionId, ordinal: 1, inherited: true }
  return { values: { senderName: 'Fuma Letters', senderEmail, replyToEmail: 'reply@example.test', physicalAddress: 'Nairobi, Kenya', brandColor: '#112233', footerText: 'You received this because you subscribed.' }, provenance: { senderName: provenance, senderEmail: provenance, replyToEmail: provenance, physicalAddress: provenance, brandColor: provenance, footerText: provenance }, provider: 'oci-email-delivery', layerVersions: [version] }
}

function harness(contentStatus: PublicationContent['status'] = 'published') {
  const repository = new MemoryNewsletterRepository()
  let id = 0
  const audienceEstimate: NewsletterAudienceEstimate = { newsletterId: 'newsletter-a', audience: AUDIENCE, estimatedSubscribed: 2, evaluatedMembers: 2, candidateMembers: 2, countKind: 'exact', segmentVersions: [{ segmentId: 'segment-a', version: 1 }], estimatedAt: TEST_NOW }
  const audience = { segmentExists: async (_scope: PublicationRepositoryScope, segmentId: string) => segmentId === 'segment-a', estimate: async (_scope: PublicationRepositoryScope, newsletterId: string) => ({ ...audienceEstimate, newsletterId }) }
  const service = new NewsletterComposerService({ repository, content: { getContent: async (_scope, contentId) => contentId === 'post-web' ? ({ contentId, status: contentStatus } as PublicationContent) : null }, settings: { resolve: async (_scope, newsletterId) => resolvedSettings(newsletterId ?? 'site') }, audience, ids: { id: (kind) => `${kind}-${++id}`, sha256: (value) => new Bun.CryptoHasher('sha256').update(value).digest('hex') }, now: () => new Date(TEST_NOW) })
  return { repository, service }
}

async function createNewsletter(service: NewsletterComposerService, newsletterId = 'newsletter-a') {
  return await service.saveProfile(PUBLICATION_TEST_SCOPE, 'owner-1', { newsletterId, name: newsletterId === 'newsletter-a' ? 'Daily Brief' : 'Weekend Edit', slug: newsletterId, description: '', status: 'active', defaultSegmentId: 'segment-a', webContentId: 'post-web', expectedVersion: null })
}
async function saveDraft(service: NewsletterComposerService, mutationId = 'mutation-1') {
  return await service.autosave(PUBLICATION_TEST_SCOPE, 'editor-1', { newsletterId: 'newsletter-a', draftId: null, mutationId, expectedSequence: 0, subject: 'Launch', previewText: 'This week', document: DOCUMENT, audience: AUDIENCE })
}

describe('FUMA-044 newsletter composer behavior', () => {
  test('supports multiple stable newsletter identities and validates universal content and segment links', async () => {
    const { service } = harness()
    const first = await createNewsletter(service)
    const second = await createNewsletter(service, 'newsletter-b')
    expect((await service.list(PUBLICATION_TEST_SCOPE)).map((item) => item.newsletterId)).toEqual(['newsletter-a', 'newsletter-b'])
    const updated = await service.saveProfile(PUBLICATION_TEST_SCOPE, 'editor-2', { newsletterId: first.newsletterId, name: 'Daily Brief Updated', slug: first.slug, description: 'Updated', status: 'active', defaultSegmentId: 'segment-a', webContentId: 'post-web', expectedVersion: 1 })
    expect(updated).toMatchObject({ newsletterId: first.newsletterId, version: 2, createdBy: 'owner-1', createdAt: TEST_NOW, updatedBy: 'editor-2' })
    expect(second.newsletterId).not.toBe(updated.newsletterId)
    await expect(service.saveProfile(PUBLICATION_TEST_SCOPE, 'owner-1', { newsletterId: 'bad', name: 'Bad', slug: 'bad', description: '', status: 'active', defaultSegmentId: 'missing', webContentId: null, expectedVersion: null })).rejects.toMatchObject({ code: 'not-found' })
    await expect(service.saveProfile(PUBLICATION_TEST_SCOPE, 'owner-1', { newsletterId: 'bad', name: 'Bad', slug: 'bad', description: '', status: 'active', defaultSegmentId: null, webContentId: 'missing', expectedVersion: null })).rejects.toMatchObject({ code: 'invalid-link' })
  })

  test('autosave sequences with CAS, replays one mutation, and rejects stale concurrent edits', async () => {
    const { service } = harness(); await createNewsletter(service)
    const first = await saveDraft(service)
    expect(first).toMatchObject({ draftId: 'newsletter-draft-1', sequence: 1 })
    const replay = await saveDraft(service)
    expect(replay).toEqual(first)
    const next = await service.autosave(PUBLICATION_TEST_SCOPE, 'editor-1', { newsletterId: 'newsletter-a', draftId: first.draftId, mutationId: 'mutation-2', expectedSequence: 1, subject: 'Launch revised', previewText: '', document: DOCUMENT, audience: AUDIENCE })
    expect(next.sequence).toBe(2)
    await expect(service.autosave(PUBLICATION_TEST_SCOPE, 'editor-2', { newsletterId: 'newsletter-a', draftId: first.draftId, mutationId: 'mutation-stale', expectedSequence: 1, subject: 'Stale', previewText: '', document: DOCUMENT, audience: AUDIENCE })).rejects.toBeInstanceOf(NewsletterComposerError)
  })

  test('only one simultaneous first autosave wins the exact sequence', async () => {
    const { service } = harness(); await createNewsletter(service)
    const command = (mutationId: string) => service.autosave(PUBLICATION_TEST_SCOPE, 'editor-1', { newsletterId: 'newsletter-a', draftId: null, mutationId, expectedSequence: 0, subject: mutationId, previewText: '', document: DOCUMENT, audience: AUDIENCE })
    const results = await Promise.allSettled([command('mutation-a'), command('mutation-b')])
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((item) => item.status === 'rejected')).toHaveLength(1)
  })

  test('gates send readiness on exact verified sender, bounded exact audience, and published linkage', async () => {
    const { repository, service } = harness(); await createNewsletter(service); await saveDraft(service)
    const blocked = await service.sendReadiness(PUBLICATION_TEST_SCOPE, 'newsletter-a')
    expect(blocked).toMatchObject({ canSend: false, reasons: ['sender-not-verified'] })
    await repository.recordSenderVerification(PUBLICATION_TEST_SCOPE, { senderEmail: 'letters@example.test', state: 'verified', providerIdentityId: 'oci-sender-1', verifiedAt: TEST_NOW, checkedAt: TEST_NOW })
    const ready = await service.assertSendAllowed(PUBLICATION_TEST_SCOPE, 'newsletter-a')
    expect(ready.canSend).toBe(true)
    const unpublished = harness('draft'); await createNewsletter(unpublished.service); await saveDraft(unpublished.service); await unpublished.repository.recordSenderVerification(PUBLICATION_TEST_SCOPE, ready.senderVerification!)
    expect((await unpublished.service.sendReadiness(PUBLICATION_TEST_SCOPE, 'newsletter-a')).reasons).toContain('linked-web-content-unpublished')
  })

  test('keeps profiles, drafts, and sender ownership isolated by exact tenant scope', async () => {
    const { repository, service } = harness(); await createNewsletter(service); await saveDraft(service)
    await repository.recordSenderVerification(PUBLICATION_TEST_SCOPE, { senderEmail: 'letters@example.test', state: 'verified', providerIdentityId: 'oci-sender-1', verifiedAt: TEST_NOW, checkedAt: TEST_NOW })
    expect(await service.list(OTHER_SCOPE)).toEqual([])
    await expect(service.detail(OTHER_SCOPE, 'newsletter-a')).rejects.toMatchObject({ code: 'not-found' })
    expect(await repository.getSenderVerification(OTHER_SCOPE, 'letters@example.test')).toBeNull()
  })
})

describe('FUMA-044 FUMA-039 audience composition', () => {
  test('uses recalculated segment membership and newsletter-specific consent without leaking member IDs', async () => {
    const segments: PublicationMemberSegment[] = [
      { segmentId: 'segment-a', name: 'Founders', kind: 'explicit', match: 'all', rules: [], explicitMemberIds: ['member-a', 'member-b'], version: 3, recalculatedAt: null, createdAt: TEST_NOW, updatedAt: TEST_NOW },
      { segmentId: 'segment-b', name: 'Active readers', kind: 'dynamic', match: 'all', rules: [{ field: 'status', operator: 'in', values: ['active'] }], explicitMemberIds: [], version: 4, recalculatedAt: null, createdAt: TEST_NOW, updatedAt: TEST_NOW },
    ]
    const snapshots = new Map<string, PublicationSegmentMembershipSnapshot>([
      ['segment-a', { segmentId: 'segment-a', segmentVersion: 3, memberIds: ['member-a', 'member-b'], calculatedAt: TEST_NOW }],
      ['segment-b', { segmentId: 'segment-b', segmentVersion: 4, memberIds: ['member-b', 'member-c'], calculatedAt: TEST_NOW }],
    ])
    const authority = new PublicationMemberAudienceAuthority({
      listSegments: async () => segments,
      recalculateSegment: async (_scope, id) => snapshots.get(id)!,
      consentState: async (_scope, memberId, newsletterId) => ({ memberId, newsletterId, subscribed: newsletterId === 'newsletter-a' ? memberId !== 'member-b' : memberId === 'member-b', provenance: null }),
    }, () => new Date(TEST_NOW))
    const intersection = await authority.estimate(PUBLICATION_TEST_SCOPE, 'newsletter-a', { segmentIds: ['segment-a', 'segment-b'], match: 'all', subscription: 'subscribed', scanLimit: 500 })
    expect(intersection).toMatchObject({ candidateMembers: 1, estimatedSubscribed: 0, countKind: 'exact', segmentVersions: [{ segmentId: 'segment-a', version: 3 }, { segmentId: 'segment-b', version: 4 }] })
    const distinct = await authority.estimate(PUBLICATION_TEST_SCOPE, 'newsletter-b', { segmentIds: ['segment-a'], match: 'any', subscription: 'subscribed', scanLimit: 1 })
    expect(distinct).toMatchObject({ candidateMembers: 2, evaluatedMembers: 1, countKind: 'lower-bound' })
    expect(JSON.stringify(distinct)).not.toContain('member-a')
  })
})

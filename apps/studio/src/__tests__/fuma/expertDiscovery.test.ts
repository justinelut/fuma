import {
  ExpertDiscoveryError,
  ExpertDiscoveryService,
  MemoryExpertDiscoveryRepository,
  type ExpertCurrentAuthority,
  type TrustedExpertRequest,
} from '../../../server/fuma/expertDiscovery'
import type { FumaRequestContext } from '../../../server/fuma/context'
import type { FumaRepositoryScope } from '../../../server/fuma/tenancy/repositoryScope'

const NOW = new Date('2026-07-30T15:00:00.000Z')
const hash = 'a'.repeat(64)
const scope = Object.freeze({ platformId: 'platform', organizationId: 'org-a', workspaceId: 'workspace-a', siteId: 'site-a', ownerKey: 'owner-a', ownerGeneration: 2 })

function request(
  profile: 'website' | 'publication' = 'website',
  userId = 'reviewer-a',
  impersonatedBy: string | null = null,
): TrustedExpertRequest {
  const context = {
    requestId: 'request-a',
    source: { kind: 'staff-session', correlationId: 'request-a', userId, sessionId: `session-${userId}`, impersonatedBy },
    actor: { kind: 'staff', userId, sessionId: `session-${userId}`, impersonator: impersonatedBy },
    scope: {
      platform: { id: 'platform', status: 'active' },
      organization: { id: 'org-a', platformId: 'platform', status: 'active' },
      workspace: { id: 'workspace-a', platformId: 'platform', organizationId: 'org-a', status: 'active' },
      site: { id: 'site-a', platformId: 'platform', organizationId: 'org-a', workspaceId: 'workspace-a', profileId: profile, status: 'active' },
    },
    profile: { id: profile, status: 'active' },
    capabilities: [],
    permissions: { subjectId: userId, allow: ['site.read'], deny: [] },
  } as FumaRequestContext
  const repositoryScope = {
    platformId: 'platform', organizationId: 'org-a', workspaceId: 'workspace-a', siteId: 'site-a',
    ownerKey: 'owner-a', generation: 2, state: 'active', transferFence: null,
  } as FumaRepositoryScope
  return { context, scope: repositoryScope, requestHeaders: new Headers() }
}

function approval() {
  return {
    expertId: 'expert-a', releaseId: 'release-a', submitterId: 'owner-a',
    supportedProfiles: ['website', 'publication'],
    public: {
      id: 'expert_public_a', slug: 'a-kenyan-builder', publicName: 'A Kenyan Builder',
      summary: 'Accessible websites and publications for growing Kenyan teams.', expertType: 'developer',
      location: 'Nairobi', skills: ['accessibility', 'fuma'], services: ['design-systems'],
      showcaseIds: ['showcase-a'], mediatedInquiryAvailable: true, imageUrl: null,
    },
    availability: 'available', artifactObjectKey: 'experts/releases/release-a.json', artifactHashSha256: hash,
    expertConsent: { partyId: 'owner-a', version: 2, consentedAt: NOW.toISOString() },
    siteOwnerConsent: { partyId: 'site-owner-a', version: 3, consentedAt: NOW.toISOString() },
  }
}

function authority(actorId: string, input: Partial<ExpertCurrentAuthority> = {}): ExpertCurrentAuthority {
  return {
    actorId,
    sessionId: `session-${actorId}`,
    direct: true,
    stepUpAt: new Date(NOW.getTime() - 60_000).toISOString(),
    managedOrganizationIds: [],
    capabilities: [],
    ...input,
  }
}

describe('FUMA-073 opt-in expert discovery', () => {
  it('runs approval, two-profile inquiries, reviewed plugin linking, transfer, and immediate hide without public PII', async () => {
    const repository = new MemoryExpertDiscoveryRepository()
    const messages: string[] = []
    const removed: string[] = []
    const invalidations: string[] = []
    let moderated = false
    let current = authority('reviewer-a', { capabilities: ['internal.experts.approve'] })
    const service = new ExpertDiscoveryService({
      repository,
      now: () => NOW,
      authority: {
        async resolve() { return current },
        async verifyAttribution(input) {
          expect(input.sourceScope).toEqual(scope)
          expect(input.expertConsentPartyId).toBe('owner-a')
          expect(input.siteOwnerConsentPartyId).toBe('site-owner-a')
        },
      },
      moderation: { async suspended() { return moderated } },
      plugins: { async approved(pluginId) { return pluginId === 'plugin-a' ? { publisherOrganizationId: 'publisher-a', verificationHashSha256: hash } : null } },
      transfers: { async resolveDestination(input) { return input.transferId === 'transfer-a' ? { ...scope, organizationId: 'org-b', workspaceId: 'workspace-b', siteId: 'site-b', ownerKey: 'owner-b', ownerGeneration: 3 } : null } },
      inquiryAbuse: { async resolve() { return { senderFingerprintSha256: hash, blocked: false } } },
      vault: { async store(input) { messages.push(input.message); return { objectKey: `experts/inquiries/${input.inquiryId}.json`, messageBytes: new TextEncoder().encode(input.message).byteLength } }, async remove(input) { removed.push(input.objectKey) } },
      invalidation: { async publish(input) { invalidations.push(input.reason) } },
    })

    const approved = await service.approveRelease(request(), approval())
    expect(approved).toMatchObject({ optedIn: false, consentVersion: 2, publicRevision: 1 })
    current = authority('owner-a', { managedOrganizationIds: ['org-a'], capabilities: ['experts.manage'] })
    const visible = await service.setVisibility(request('website', 'owner-a'), { expertId: 'expert-a', optedIn: true, availability: 'available', expectedPublicRevision: 1 })
    expect(visible.publicRevision).toBe(2)

    const websiteSearch = await service.search({ profile: 'website', skill: 'fuma', location: 'nairobi', limit: 10 })
    expect(websiteSearch.items.map(({ id }) => id)).toEqual(['expert_public_a'])
    expect((await service.search({ profile: 'publication', limit: 10 })).items).toHaveLength(1)
    expect(JSON.stringify(websiteSearch.items)).not.toContain('org-a')
    expect(JSON.stringify(websiteSearch.items)).not.toContain('owner-a')

    const first = await service.submitInquiry(request('website', 'owner-a'), { inquiryId: 'inquiry-web', expertId: 'expert-a', message: 'Please help with an accessible website launch.' })
    const second = await service.submitInquiry(request('publication', 'owner-a'), { inquiryId: 'inquiry-publication', expertId: 'expert-a', message: 'Please help with an accessible publication launch.' })
    expect([first.sourceProfile, second.sourceProfile]).toEqual(['website', 'publication'])
    expect([first.consentVersion, second.consentVersion]).toEqual([2, 2])
    expect(messages).toHaveLength(2)
    expect(JSON.stringify(repository.inquiries)).not.toContain('accessible website')
    await expect(service.submitInquiry(request('website', 'owner-a'), { inquiryId: 'inquiry-web', expertId: 'expert-a', message: 'Please retry this duplicate accessible website launch inquiry.' })).rejects.toMatchObject({ code: 'conflict' })
    expect(removed).toEqual(['experts/inquiries/inquiry-web.json'])

    expect((await service.linkPlugin(request('website', 'owner-a'), { expertId: 'expert-a', pluginId: 'plugin-a', expectedPublicRevision: 2 })).publisherOrganizationId).toBe('publisher-a')
    moderated = true
    await service.moderationChanged('expert-a')
    expect((await service.search({ limit: 10 })).items).toEqual([])
    moderated = false

    const transferred = await service.transfer(request('website', 'owner-a'), {
      expertId: 'expert-a', transferId: 'transfer-a', expectedPublicRevision: 3,
    })
    expect(transferred).toMatchObject({ organizationId: 'org-b', optedIn: false, consentVersion: 2, publicRevision: 4 })
    expect((await service.search({ limit: 10 })).items).toEqual([])
    expect(invalidations).toEqual(['approved', 'visibility', 'plugin-link', 'moderation', 'transfer'])
  })

  it('fails closed for self-approval, stale revisions, malformed input, unreviewed plugins, and impersonated inquiries', async () => {
    const repository = new MemoryExpertDiscoveryRepository()
    let current = authority('owner-a', { managedOrganizationIds: ['org-a'], capabilities: ['internal.experts.approve', 'experts.manage'] })
    const service = new ExpertDiscoveryService({
      repository,
      authority: { async resolve() { return current }, async verifyAttribution() {} },
      moderation: { async suspended() { return false } },
      plugins: { async approved() { return null } },
      transfers: { async resolveDestination() { return null } },
      inquiryAbuse: { async resolve() { return { senderFingerprintSha256: hash, blocked: false } } },
      vault: { async store() { throw new Error('must not store') }, async remove() {} },
      invalidation: { async publish() {} },
      now: () => NOW,
    })

    await expect(service.approveRelease(request('website', 'owner-a'), approval())).rejects.toMatchObject({ name: 'ExpertDiscoveryError', code: 'authority-denied' })
    current = authority('reviewer-a', { capabilities: ['internal.experts.approve'] })
    await service.approveRelease(request(), approval())
    current = authority('owner-a', { managedOrganizationIds: ['org-a'], capabilities: ['experts.manage'] })
    await service.setVisibility(request('website', 'owner-a'), { expertId: 'expert-a', optedIn: true, availability: 'available', expectedPublicRevision: 1 })

    await expect(service.setVisibility(request('website', 'owner-a'), { expertId: 'expert-a', optedIn: false, availability: 'available', expectedPublicRevision: 1 })).rejects.toMatchObject({ code: 'conflict' })
    await expect(service.linkPlugin(request('website', 'owner-a'), { expertId: 'expert-a', pluginId: 'unreviewed', expectedPublicRevision: 2 })).rejects.toMatchObject({ code: 'hidden' })
    await expect(service.submitInquiry(request('website', 'owner-a'), { inquiryId: 'inquiry-extra', expertId: 'expert-a', message: 'This request carries a forbidden caller digest.', senderFingerprintSha256: hash })).rejects.toMatchObject({ code: 'invalid-contract' })

    current = authority('owner-a', { direct: false, managedOrganizationIds: ['org-a'], capabilities: ['experts.manage'] })
    await expect(service.submitInquiry(request('website', 'owner-a', 'support-a'), { inquiryId: 'inquiry-impersonated', expertId: 'expert-a', message: 'An impersonated session must never send this inquiry.' })).rejects.toMatchObject({ code: 'inquiry-denied' })
    await expect(service.search({ limit: 51 })).rejects.toMatchObject({ code: 'invalid-contract' })
    await expect(service.search({ limit: 10, recipientEmail: 'leak@example.test' })).rejects.toMatchObject({ code: 'invalid-contract' })
    expect(new ExpertDiscoveryError('hidden', 'hidden')).toMatchObject({ code: 'hidden' })
  })
})

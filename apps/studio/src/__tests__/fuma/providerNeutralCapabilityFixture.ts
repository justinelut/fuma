import type { PublicationContent } from '@core/fuma/publication'
import {
  CanonicalProviderNeutralPublicationAdapter,
  ReviewedBackendCapabilityRegistry,
  registerProviderNeutralPublicationCapabilities,
  type BackendCapabilityEvidencePort,
  type BackendCapabilityMetadata,
  type BackendCapabilityReceipt,
  type TrustedBackendCapabilityAuthority,
} from '../../../server/fuma/aiBackendCapabilities'

export const PROVIDER_NEUTRAL_NOW = '2026-07-31T10:00:00.000Z'
export const PROVIDER_NEUTRAL_CONTENT: PublicationContent = Object.freeze({
  contentId: 'post-088',
  kind: 'post',
  metadata: Object.freeze({
    title: 'Provider-neutral publishing',
    slug: 'provider-neutral-publishing',
    excerpt: 'A reviewed capability fixture.',
    canonicalUrl: 'https://site.example.test/provider-neutral-publishing',
    redirects: Object.freeze([]),
    openGraph: Object.freeze({ title: null, description: null, imageId: null, type: 'article' }),
    social: Object.freeze({ title: null, description: null, imageId: null, card: 'summary-large-image' }),
    visibility: Object.freeze({ kind: 'public' }),
    featureImageId: null,
    seoTitle: 'Provider-neutral publishing',
    seoDescription: 'Reviewed strict TypeBox capabilities.',
    tagIds: Object.freeze(['tag-088']),
    primaryTagId: 'tag-088',
    authorIds: Object.freeze(['author-088']),
  }),
  document: Object.freeze({ format: 'markdown', value: '# Provider neutral' }),
  status: 'draft',
  workflowVersion: 1,
  scheduledAt: null,
  publishedAt: null,
  createdAt: PROVIDER_NEUTRAL_NOW,
  updatedAt: PROVIDER_NEUTRAL_NOW,
})

export function providerNeutralAuthority(
  channel: 'site-ai' | 'mcp',
  metadata: BackendCapabilityMetadata,
  confirmed = false,
): TrustedBackendCapabilityAuthority {
  const operationId = `operation-${channel}`
  const ownerGeneration = 8
  const grant = channel === 'site-ai' ? metadata.grants.siteAi : metadata.grants.mcp
  return {
    channel,
    operationId,
    outerReceiptId: `outer-${channel}`,
    reservationId: `reservation-${channel}`,
    scope: {
      platformId: 'fuma', organizationId: 'organization-088', workspaceId: 'workspace-088',
      siteId: 'site-088', ownerKey: 'owner-088', ownerGeneration, profileId: 'publication',
    },
    actor: { kind: 'staff', actorId: 'actor-088', sessionId: `session-${channel}`, impersonatorId: null },
    permissions: [metadata.requiredPermission],
    grants: grant ? [grant] : [],
    authorityRevision: ownerGeneration,
    state: 'active',
    resolvedAt: PROVIDER_NEUTRAL_NOW,
    confirmation: confirmed ? {
      confirmationId: `confirmation-${channel}`,
      actorId: 'actor-088',
      operationId,
      capabilityId: metadata.id,
      capabilityVersion: metadata.version,
      ownerKey: 'owner-088',
      ownerGeneration,
      confirmedAt: PROVIDER_NEUTRAL_NOW,
    } : null,
  }
}

export function createProviderNeutralFixture() {
  const contents: PublicationContent[] = [structuredClone(PROVIDER_NEUTRAL_CONTENT)]
  const calls: string[] = []
  const inputs: unknown[] = []
  const store = {
    async listContent() { calls.push('store.listContent'); return structuredClone(contents) },
    async getContent(_scope: unknown, contentId: string) { calls.push('store.getContent'); return structuredClone(contents.find((item) => item.contentId === contentId) ?? null) },
    async listAuthors() { calls.push('store.listAuthors'); return [{ authorId: 'author-088', displayName: 'Fixture Author', email: 'private@example.test', image: null }] },
    async listTags() { calls.push('store.listTags'); return [{ tagId: 'tag-088', name: 'Reviewed', slug: 'reviewed', description: '' }] },
    async listNewsletters() { calls.push('store.listNewsletters'); return [{ newsletterId: 'newsletter-088', name: 'Updates', slug: 'updates', description: '', defaultSegmentId: null, status: 'active', createdAt: PROVIDER_NEUTRAL_NOW, updatedAt: PROVIDER_NEUTRAL_NOW }] },
  }
  const editorial = {
    async save(_scope: unknown, content: PublicationContent, expected: number | null) {
      calls.push('editorial.save')
      const saved = structuredClone({ ...content, workflowVersion: expected === null ? 1 : expected + 1 })
      const index = contents.findIndex((item) => item.contentId === saved.contentId)
      if (index < 0) contents.push(saved); else contents[index] = saved
      return saved
    },
    async transition(_scope: unknown, input: { contentId: string; to: 'published' | 'scheduled'; createdAt: string }) {
      calls.push('editorial.transition')
      const index = contents.findIndex((item) => item.contentId === input.contentId)
      if (index < 0) throw new Error('not found')
      const current = contents[index]!
      const saved: PublicationContent = {
        ...current,
        status: input.to,
        workflowVersion: current.workflowVersion + 1,
        scheduledAt: input.to === 'scheduled' ? input.createdAt : null,
        publishedAt: input.to === 'published' ? input.createdAt : current.publishedAt,
        updatedAt: input.createdAt,
      }
      contents[index] = saved
      return structuredClone(saved)
    },
  }
  const adapter = new CanonicalProviderNeutralPublicationAdapter({
    store: store as never,
    editorial: editorial as never,
    identity: { async get() { calls.push('identity.get'); return { publicationId: 'publication-088', name: 'Fixture Publication', description: 'Reviewed settings.', language: 'en-KE', timezone: 'Africa/Nairobi', version: 1, updatedAt: PROVIDER_NEUTRAL_NOW } } },
    memberAccess: { async evaluate(_scope: unknown, input: unknown) { calls.push('memberAccess.evaluate'); inputs.push(input); return { member: false, paid: false, accessState: 'anonymous', presentation: { delivery: 'render', statusCode: 200, reason: 'published' } } as never } },
    privacyAnalytics: { async report() { calls.push('privacyAnalytics.report'); return { totals: { siteReads: 4, postReads: 3, publicReads: 6, memberReads: 1, newsletterOpens: 2, newsletterClicks: 1, subscriptions: 1, unsubscriptions: 0 } } as never } },
    now: () => new Date(PROVIDER_NEUTRAL_NOW),
  })
  const registry = registerProviderNeutralPublicationCapabilities(new ReviewedBackendCapabilityRegistry(() => new Date(PROVIDER_NEUTRAL_NOW)), adapter)
  const evidenceEvents: unknown[] = []
  const evidence: BackendCapabilityEvidencePort = {
    async admit(value: Readonly<{ metadata: BackendCapabilityMetadata; authority: TrustedBackendCapabilityAuthority }>) { evidenceEvents.push({ kind: 'admit', value }) },
    async record(value: Readonly<{ metadata: BackendCapabilityMetadata; authority: TrustedBackendCapabilityAuthority; receipt: BackendCapabilityReceipt }>) { evidenceEvents.push({ kind: 'record', value }); return { metered: true, audited: true } },
  }
  return { adapter, calls, contents, evidence, evidenceEvents, inputs, registry }
}

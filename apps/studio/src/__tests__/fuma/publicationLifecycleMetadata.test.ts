import { safeParseValue } from '@core/utils/typeboxHelpers'
import {
  PublicationContentSchema,
  PublicationPresentationRequestSchema,
  type PublicationContent,
  type PublicationMetadata,
} from '@core/fuma/publication'
import { PublicationEditorialService } from '../../../server/fuma/publication/services'
import {
  PublicationMetadataConflictError,
  assertPublicationMetadataAuthority,
  decidePublicationPresentation,
} from '../../../server/fuma/publication/presentation'
import { publicationFixture, PUBLICATION_TEST_SCOPE, TEST_NOW } from '../helpers/fuma/publicationFixtures'

function metadata(overrides: Partial<PublicationMetadata> = {}): PublicationMetadata {
  return {
    title: 'Kenya launch <script>alert(1)</script>', slug: 'kenya-launch', excerpt: 'Independent <strong>reporting</strong>.',
    canonicalUrl: 'https://news.example.test/kenya-launch', redirects: [{ fromPath: '/old-launch', toPath: '/kenya-launch', statusCode: 308 }],
    openGraph: { title: 'Kenya launch', description: 'Open Graph description', imageId: 'media-og', type: 'article' },
    social: { title: 'Kenya launch social', description: 'Social description', imageId: 'media-social', card: 'summary-large-image' },
    visibility: { kind: 'public' }, featureImageId: null, seoTitle: 'Kenya launch SEO', seoDescription: 'Search description',
    tagIds: [], primaryTagId: null, authorIds: ['author-1'], ...overrides,
  }
}
function post(overrides: Partial<PublicationContent> = {}): PublicationContent {
  return { contentId: 'post-1', kind: 'post', metadata: metadata(), document: { rawHtml: '<script>unsafe document</script>' }, status: 'draft', workflowVersion: 1, scheduledAt: null, publishedAt: null, createdAt: TEST_NOW, updatedAt: TEST_NOW, ...overrides }
}

async function transition(service: PublicationEditorialService, current: PublicationContent, to: PublicationContent['status'], createdAt: string, scheduledAt: string | null = null) {
  return service.transition(PUBLICATION_TEST_SCOPE, { transitionId: `transition-${current.workflowVersion}-${to}`, contentId: current.contentId, from: current.status, to, expectedVersion: current.workflowVersion, scheduledAt, note: `Move to ${to}`, createdAt, actorId: 'editor-1' })
}

describe('FUMA-034 Publication lifecycle, metadata authority, and presentation decisions', () => {
  test('uses strict TypeBox contracts for SEO/social/redirect/access and rejects extra authority', () => {
    expect(safeParseValue(PublicationContentSchema, post()).ok).toBe(true)
    expect(safeParseValue(PublicationContentSchema, { ...post(), metadata: { ...metadata(), forgedOwnerKey: 'other-owner' } }).ok).toBe(false)
    expect(safeParseValue(PublicationPresentationRequestSchema, { mode: 'preview', origin: 'https://studio.example.test', requestedPath: '/kenya-launch', audience: { member: false, paid: false, segmentIds: [] }, profileId: 'forged' }).ok).toBe(false)
    expect(safeParseValue(PublicationContentSchema, { ...post(), metadata: { ...metadata(), redirects: [{ fromPath: '//evil.test', toPath: '/kenya-launch', statusCode: 302 }] } }).ok).toBe(false)
  })

  test('moves through scheduled/published/unpublished/archived revisions and rejects invalid or stale transitions', async () => {
    const h = publicationFixture(); const service = new PublicationEditorialService(h.store)
    let current = await service.save(h.scope, post(), null)
    current = await service.save(h.scope, { ...current, metadata: { ...current.metadata, seoDescription: 'Revision two' }, updatedAt: '2040-01-02T04:00:00.000Z' }, 1)
    expect(current.workflowVersion).toBe(2)
    await expect(transition(service, current, 'unpublished', '2040-01-02T05:00:00.000Z')).rejects.toMatchObject({ code: 'invalid-transition' })
    current = await transition(service, current, 'scheduled', '2040-01-02T05:00:00.000Z', '2040-01-03T05:00:00.000Z')
    current = await transition(service, current, 'published', '2040-01-03T05:00:00.000Z')
    expect(current).toMatchObject({ status: 'published', workflowVersion: 4, scheduledAt: null, publishedAt: '2040-01-03T05:00:00.000Z' })
    current = await transition(service, current, 'unpublished', '2040-01-04T05:00:00.000Z')
    current = await transition(service, current, 'archived', '2040-01-05T05:00:00.000Z')
    expect(current).toMatchObject({ status: 'archived', workflowVersion: 6 })
    await expect(service.transition(h.scope, { transitionId: 'stale', contentId: current.contentId, from: 'published', to: 'unpublished', actorId: 'editor-1', expectedVersion: 4, scheduledAt: null, note: '', createdAt: '2040-01-06T05:00:00.000Z' })).rejects.toMatchObject({ code: 'invalid-transition' })
    expect(h.store.transitions.map(item => `${item.from}->${item.to}`)).toEqual(['draft->scheduled', 'scheduled->published', 'published->unpublished', 'unpublished->archived'])
  })

  test('rejects canonical collisions, canonical/redirect conflicts, duplicate sources, and redirect chains', async () => {
    const h = publicationFixture(); const service = new PublicationEditorialService(h.store)
    await service.save(h.scope, post(), null)
    await expect(service.save(h.scope, post({ contentId: 'post-2', metadata: metadata({ slug: 'second', redirects: [], authorIds: ['author-2'] }) }), null)).rejects.toBeInstanceOf(PublicationMetadataConflictError)
    expect(() => assertPublicationMetadataAuthority([
      post(),
      post({ contentId: 'post-2', metadata: metadata({ slug: 'second', canonicalUrl: 'https://news.example.test/second', redirects: [{ fromPath: '/old-launch', toPath: '/second', statusCode: 301 }] }) }),
    ])).toThrow('Redirect source')
    expect(() => assertPublicationMetadataAuthority([post({ metadata: metadata({ redirects: [{ fromPath: '/older-launch', toPath: '/old-launch', statusCode: 308 }] }) })])).toThrow('point directly')
    expect(() => assertPublicationMetadataAuthority([post({ metadata: metadata({ canonicalUrl: 'https://news.example.test/old-launch' }) })])).toThrow('Canonical path')
  })

  test('renders only escaped semantic preview metadata and denies member/paid/segment audiences without content leakage', () => {
    const published = post({ status: 'published', workflowVersion: 2, publishedAt: '2040-01-03T05:00:00.000Z', metadata: metadata({ visibility: { kind: 'paid' } }) })
    const preview = decidePublicationPresentation(published, { mode: 'preview', origin: 'https://news.example.test', requestedPath: '/kenya-launch', audience: { member: false, paid: false, segmentIds: [] } })
    expect(preview).toMatchObject({ delivery: 'render', access: 'denied', robots: 'noindex,nofollow', reason: 'preview' })
    expect(preview.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(preview.html).not.toContain('unsafe document')
    expect(preview.html).not.toContain('<script>')
    const denied = decidePublicationPresentation(published, { mode: 'public', origin: 'https://news.example.test', requestedPath: '/kenya-launch', audience: { member: true, paid: false, segmentIds: [] } })
    expect(denied).toMatchObject({ delivery: 'deny', access: 'denied', statusCode: 403, title: 'Restricted content', description: '', openGraph: { title: null, description: null, imageId: null }, social: { title: null, description: null, imageId: null }, html: null, reason: 'audience-denied' })
    const allowed = decidePublicationPresentation(published, { mode: 'public', origin: 'https://news.example.test', requestedPath: '/kenya-launch', audience: { member: true, paid: true, segmentIds: [] } })
    expect(allowed).toMatchObject({ delivery: 'render', access: 'allowed', statusCode: 200, title: 'Kenya launch SEO', description: 'Search description', robots: 'index,follow' })
    const segmentContent = { ...published, metadata: metadata({ visibility: { kind: 'segment', segmentIds: ['legal', 'kenya'] } }) }
    expect(decidePublicationPresentation(segmentContent, { mode: 'public', origin: 'https://news.example.test', requestedPath: '/kenya-launch', audience: { member: true, paid: false, segmentIds: ['sports'] } }).delivery).toBe('deny')
    expect(decidePublicationPresentation(segmentContent, { mode: 'public', origin: 'https://news.example.test', requestedPath: '/kenya-launch', audience: { member: true, paid: false, segmentIds: ['kenya'] } }).delivery).toBe('render')
  })

  test('applies redirects only to published public decisions and hides non-published content', () => {
    const published = post({ status: 'published', workflowVersion: 2, publishedAt: '2040-01-03T05:00:00.000Z' })
    expect(decidePublicationPresentation(published, { mode: 'public', origin: 'https://news.example.test', requestedPath: '/old-launch', audience: { member: false, paid: false, segmentIds: [] } })).toMatchObject({ delivery: 'redirect', statusCode: 308, redirectLocation: '/kenya-launch' })
    expect(decidePublicationPresentation(post(), { mode: 'public', origin: 'https://news.example.test', requestedPath: '/old-launch', audience: { member: false, paid: false, segmentIds: [] } })).toMatchObject({ delivery: 'unavailable', statusCode: 404, html: null })
  })

  test('isolates identical content authority by exact owner generation and assigned profile', async () => {
    const h = publicationFixture(); const service = new PublicationEditorialService(h.store)
    const otherGeneration = { ...h.scope, generation: 2 }; const otherProfile = { ...h.scope, profileId: 'website' }
    await service.save(h.scope, post(), null)
    await service.save(otherGeneration, post({ metadata: metadata({ title: 'Generation two' }) }), null)
    await service.save(otherProfile, post({ metadata: metadata({ title: 'Other profile' }) }), null)
    expect((await h.store.getContent(h.scope, 'post-1'))?.metadata.title).toContain('Kenya launch')
    expect((await h.store.getContent(otherGeneration, 'post-1'))?.metadata.title).toBe('Generation two')
    expect((await h.store.getContent(otherProfile, 'post-1'))?.metadata.title).toBe('Other profile')
  })

  test('emits deterministic lifecycle → SEO/access decision demo', async () => {
    const h = publicationFixture(); const service = new PublicationEditorialService(h.store)
    let current = await service.save(h.scope, post({ metadata: metadata({ visibility: { kind: 'member' } }) }), null)
    current = await transition(service, current, 'scheduled', '2040-01-02T04:00:00.000Z', '2040-01-03T04:00:00.000Z')
    current = await transition(service, current, 'published', '2040-01-03T04:00:00.000Z')
    const anonymous = decidePublicationPresentation(current, { mode: 'public', origin: 'https://news.example.test', requestedPath: '/kenya-launch', audience: { member: false, paid: false, segmentIds: [] } })
    const member = decidePublicationPresentation(current, { mode: 'public', origin: 'https://news.example.test', requestedPath: '/kenya-launch', audience: { member: true, paid: false, segmentIds: [] } })
    const transcript = { lifecycle: h.store.transitions.map(item => item.to), revision: current.workflowVersion, seo: { canonical: member.canonicalUrl, title: member.title, openGraph: member.openGraph.title, social: member.social.title }, access: { anonymous: anonymous.delivery, member: member.delivery }, robots: member.robots }
    process.stdout.write(`[FUMA-034 demo] ${JSON.stringify(transcript)}\n`)
    expect(transcript).toEqual({ lifecycle: ['scheduled', 'published'], revision: 3, seo: { canonical: 'https://news.example.test/kenya-launch', title: 'Kenya launch SEO', openGraph: 'Kenya launch', social: 'Kenya launch social' }, access: { anonymous: 'deny', member: 'render' }, robots: 'index,follow' })
  })
})

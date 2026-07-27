import { expect, test } from 'bun:test'
import { PublicationMemberAccessService } from '../../../server/fuma/publication/memberAccess'
import { publicationFixture, TEST_NOW } from '../helpers/fuma/publicationFixtures'

const START = '2040-01-01T00:00:00.000Z'

test('FUMA-039 deterministic segment and member access demo', async () => {
  const h = publicationFixture()
  const service = new PublicationMemberAccessService({ repository: h.store, domain: h.store, ids: h.ids, now: h.now })
  await h.store.putMember(h.scope, { memberId: 'member-demo', email: 'reader@example.test', name: 'Reader', status: 'active', accountId: null, attributes: { edition: 'daily' }, createdAt: START, updatedAt: TEST_NOW })
  await service.saveAccount(h.scope, { accountId: 'account-demo', memberIdentityId: 'identity-demo', memberId: 'member-demo', displayName: 'Reader', locale: 'en-KE', timezone: 'Africa/Nairobi', state: 'active', createdAt: START, updatedAt: TEST_NOW, deletedAt: null }, null)
  await service.saveSegment(h.scope, { segmentId: 'daily', name: 'Daily readers', kind: 'dynamic', match: 'all', rules: [{ field: 'edition', operator: 'equals', value: 'daily' }], explicitMemberIds: [], version: 1, recalculatedAt: null, createdAt: START, updatedAt: TEST_NOW }, null)
  const snapshot = await service.recalculateSegment(h.scope, 'daily')
  await h.store.putContent(h.scope, { contentId: 'segment-post', kind: 'post', metadata: { title: 'Daily briefing', slug: 'daily', excerpt: '', canonicalUrl: null, redirects: [], openGraph: { title: null, description: null, imageId: null, type: 'article' }, social: { title: null, description: null, imageId: null, card: 'summary-large-image' }, visibility: { kind: 'segment', segmentIds: ['daily'] }, featureImageId: null, seoTitle: null, seoDescription: null, tagIds: [], primaryTagId: null, authorIds: ['author'] }, document: {}, status: 'published', workflowVersion: 1, scheduledAt: null, publishedAt: START, createdAt: START, updatedAt: TEST_NOW }, null)
  await h.store.putContent(h.scope, { contentId: 'premium-post', kind: 'post', metadata: { title: 'Premium briefing', slug: 'premium', excerpt: '', canonicalUrl: null, redirects: [], openGraph: { title: null, description: null, imageId: null, type: 'article' }, social: { title: null, description: null, imageId: null, card: 'summary-large-image' }, visibility: { kind: 'paid' }, featureImageId: null, seoTitle: null, seoDescription: null, tagIds: [], primaryTagId: null, authorIds: ['author'] }, document: {}, status: 'published', workflowVersion: 1, scheduledAt: null, publishedAt: START, createdAt: START, updatedAt: TEST_NOW }, null)
  const request = (contentId: string, memberIdentityId: string | null) => ({ memberIdentityId, contentId, mode: 'public' as const, origin: 'https://demo.example.test', requestedPath: contentId === 'segment-post' ? '/daily' : '/premium', evaluatedAt: TEST_NOW })
  const anonymous = await service.evaluate(h.scope, request('segment-post', null))
  const segmented = await service.evaluate(h.scope, request('segment-post', 'identity-demo'))
  const grant = await service.grantAccess(h.scope, { accessId: 'complimentary-demo', memberId: 'member-demo', source: 'complimentary', state: 'active', resourceKind: 'publication', resourceId: h.scope.siteId, access: 'premium', startsAt: START, expiresAt: '2040-02-01T00:00:00.000Z', graceEndsAt: '2040-02-08T00:00:00.000Z', paymentReferenceSha256: null, createdAt: START, updatedAt: START })
  const premium = await service.evaluate(h.scope, request('premium-post', 'identity-demo'))
  await service.transitionAccess(h.scope, grant.accessId, grant.memberId, 'revoked', TEST_NOW)
  const revoked = await service.evaluate(h.scope, request('premium-post', 'identity-demo'))
  const transcript = { realm: 'site-member', staffRoles: [], segment: { id: snapshot.segmentId, members: snapshot.memberIds }, presentation: { anonymous: anonymous.presentation.delivery, segmented: segmented.presentation.delivery, complimentary: premium.presentation.delivery, revoked: revoked.presentation.delivery }, accessStates: { complimentary: premium.accessState, revoked: revoked.accessState } }
  process.stdout.write(`[FUMA-039 demo] ${JSON.stringify(transcript)}\n`)
  expect(transcript).toEqual({ realm: 'site-member', staffRoles: [], segment: { id: 'daily', members: ['member-demo'] }, presentation: { anonymous: 'deny', segmented: 'render', complimentary: 'render', revoked: 'deny' }, accessStates: { complimentary: 'active', revoked: 'revoked' } })
})

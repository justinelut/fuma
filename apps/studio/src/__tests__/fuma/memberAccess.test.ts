import { describe, expect, test } from 'bun:test'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import {
  PublicationAccessEvaluationRequestSchema,
  PublicationMemberAccountSchema,
  PublicationNewsletterConsentEventSchema,
} from '@core/fuma/publication'
import {
  MemoryPublicationMemberOperationLimiter,
  PublicationMemberAccessError,
  PublicationMemberAccessService,
} from '../../../server/fuma/publication/memberAccess'
import { publicationFixture, TEST_NOW } from '../helpers/fuma/publicationFixtures'

const EARLIER = '2040-01-01T00:00:00.000Z'
const LATER = '2040-01-02T04:00:00.000Z'

function setup() {
  const h = publicationFixture()
  h.store.putMember(h.scope, { memberId: 'member-1', email: 'member@example.test', name: 'Member One', status: 'active', accountId: null, attributes: { edition: 'daily' }, createdAt: EARLIER, updatedAt: TEST_NOW })
  h.store.putMember(h.scope, { memberId: 'member-2', email: 'other@example.test', name: 'Other Member', status: 'active', accountId: null, attributes: { edition: 'weekly' }, createdAt: EARLIER, updatedAt: TEST_NOW })
  const service = new PublicationMemberAccessService({ repository: h.store, domain: h.store, ids: h.ids, now: h.now, limiter: new MemoryPublicationMemberOperationLimiter() })
  const account = { accountId: 'account-1', memberIdentityId: 'identity-1', memberId: 'member-1', displayName: 'Member One', locale: 'en-KE', timezone: 'Africa/Nairobi', state: 'active' as const, createdAt: EARLIER, updatedAt: TEST_NOW, deletedAt: null }
  return { ...h, service, account }
}

function paidContent() {
  return {
    contentId: 'paid-post', kind: 'post' as const,
    metadata: { title: 'Paid post', slug: 'paid-post', excerpt: 'Members only', canonicalUrl: null, redirects: [], openGraph: { title: null, description: null, imageId: null, type: 'article' as const }, social: { title: null, description: null, imageId: null, card: 'summary-large-image' as const }, visibility: { kind: 'paid' as const }, featureImageId: null, seoTitle: null, seoDescription: null, tagIds: ['tag-news'], primaryTagId: 'tag-news', authorIds: ['author-1'] },
    document: { type: 'doc', content: [] }, status: 'published' as const, workflowVersion: 1, scheduledAt: null, publishedAt: EARLIER, createdAt: EARLIER, updatedAt: TEST_NOW,
  }
}

describe('FUMA-039 member access contracts and service', () => {
  test('uses strict authority-free TypeBox inputs', () => {
    expect(safeParseValue(PublicationMemberAccountSchema, { accountId: 'a', memberIdentityId: 'i', memberId: 'm', displayName: '', locale: 'en-KE', timezone: 'Africa/Nairobi', state: 'active', createdAt: TEST_NOW, updatedAt: TEST_NOW, deletedAt: null, siteId: 'forged' }).ok).toBe(false)
    expect(safeParseValue(PublicationNewsletterConsentEventSchema, { eventId: 'e', accountId: 'a', memberId: 'm', newsletterId: null, action: 'subscribed', source: 'staff', noticeVersion: 'v1', sourceReceiptId: null, occurredAt: TEST_NOW, ownerKey: 'forged' }).ok).toBe(false)
    expect(safeParseValue(PublicationAccessEvaluationRequestSchema, { memberIdentityId: null, contentId: 'c', mode: 'public', origin: 'https://example.test', requestedPath: '/c', evaluatedAt: TEST_NOW, profileId: 'forged' }).ok).toBe(false)
  })

  test('derives current newsletter consent from append-only provenance', async () => {
    const h = setup()
    await h.service.saveAccount(h.scope, h.account, null)
    await h.service.recordConsent(h.scope, { eventId: 'consent-1', accountId: h.account.accountId, memberId: h.account.memberId, newsletterId: null, action: 'subscribed', source: 'staff', noticeVersion: 'v1', sourceReceiptId: null, occurredAt: EARLIER })
    await h.service.recordConsent(h.scope, { eventId: 'consent-2', accountId: h.account.accountId, memberId: h.account.memberId, newsletterId: 'daily', action: 'unsubscribed', source: 'one-click', noticeVersion: 'v2', sourceReceiptId: 'receipt-2', occurredAt: TEST_NOW })
    expect(await h.service.consentState(h.scope, 'member-1', 'daily')).toMatchObject({ subscribed: false, provenance: { eventId: 'consent-2', source: 'one-click', noticeVersion: 'v2' } })
    expect(await h.service.consentState(h.scope, 'member-1', 'weekly')).toMatchObject({ subscribed: true, provenance: { eventId: 'consent-1' } })
    await expect(h.service.recordConsent(h.scope, { eventId: 'bad', accountId: h.account.accountId, memberId: h.account.memberId, newsletterId: null, action: 'subscribed', source: 'staff-import', noticeVersion: 'v1', sourceReceiptId: null, occurredAt: TEST_NOW })).rejects.toMatchObject({ code: 'conflict' })
  })

  test('recalculates explicit and dynamic segments deterministically', async () => {
    const h = setup()
    const explicit = await h.service.saveSegment(h.scope, { segmentId: 'explicit', name: 'Chosen', kind: 'explicit', match: 'all', rules: [], explicitMemberIds: ['member-2', 'member-1'], version: 1, recalculatedAt: null, createdAt: EARLIER, updatedAt: TEST_NOW }, null)
    const dynamic = await h.service.saveSegment(h.scope, { segmentId: 'daily', name: 'Daily', kind: 'dynamic', match: 'all', rules: [{ field: 'edition', operator: 'equals', value: 'daily' }], explicitMemberIds: [], version: 1, recalculatedAt: null, createdAt: EARLIER, updatedAt: TEST_NOW }, null)
    expect(explicit.kind).toBe('explicit')
    expect(dynamic.kind).toBe('dynamic')
    expect((await h.service.recalculateSegment(h.scope, 'explicit')).memberIds).toEqual(['member-1', 'member-2'])
    expect((await h.service.recalculateSegment(h.scope, 'daily')).memberIds).toEqual(['member-1'])
  })

  test('evaluates paid content through active, grace, expired, and revoked access', async () => {
    const h = setup()
    await h.service.saveAccount(h.scope, h.account, null)
    await h.store.putContent(h.scope, paidContent(), null)
    await h.service.grantAccess(h.scope, { accessId: 'paid-1', memberId: 'member-1', source: 'paid', state: 'active', resourceKind: 'publication', resourceId: h.scope.siteId, access: 'premium', startsAt: EARLIER, expiresAt: '2040-01-02T02:00:00.000Z', graceEndsAt: '2040-01-02T05:00:00.000Z', paymentReferenceSha256: 'a'.repeat(64), createdAt: EARLIER, updatedAt: EARLIER })
    const request = { memberIdentityId: 'identity-1', contentId: 'paid-post', mode: 'public' as const, origin: 'https://publication.example.test', requestedPath: '/paid-post', evaluatedAt: TEST_NOW }
    expect(await h.service.evaluate(h.scope, request)).toMatchObject({ paid: true, accessState: 'grace', accessSources: ['paid'], presentation: { delivery: 'render', access: 'allowed' } })
    expect(await h.service.evaluate(h.scope, { ...request, evaluatedAt: '2040-01-02T06:00:00.000Z' })).toMatchObject({ paid: false, accessState: 'expired', presentation: { delivery: 'deny', access: 'denied' } })
    await h.service.transitionAccess(h.scope, 'paid-1', 'member-1', 'revoked', LATER)
    expect(await h.service.evaluate(h.scope, request)).toMatchObject({ paid: false, accessState: 'revoked', presentation: { delivery: 'deny' } })
  })

  test('exports only the subject and atomically erases account data after deletion', async () => {
    const h = setup()
    await h.service.saveAccount(h.scope, h.account, null)
    await h.service.saveSegment(h.scope, { segmentId: 'explicit', name: 'Chosen', kind: 'explicit', match: 'all', rules: [], explicitMemberIds: ['member-1', 'member-2'], version: 1, recalculatedAt: null, createdAt: EARLIER, updatedAt: TEST_NOW }, null)
    await h.service.recalculateSegment(h.scope, 'explicit')
    const exported = await h.service.export(h.scope, h.account.accountId, 'staff')
    expect(exported.account.accountId).toBe('account-1')
    expect(exported.segments[0]?.memberIds).toEqual(['member-1'])
    const pending = await h.service.requestDeletion(h.scope, h.account.accountId, 'staff', 'Verified request')
    const completed = { ...pending, state: 'completed' as const, completedAt: LATER }
    await h.service.completeDeletion(h.scope, completed)
    expect(await h.store.getAccount(h.scope, h.account.accountId)).toMatchObject({ displayName: '', locale: 'und', timezone: 'Etc/UTC', state: 'deleted', deletedAt: LATER })
    expect(await h.store.getMember(h.scope, 'member-1')).toMatchObject({ name: '', status: 'blocked', attributes: {} })
  })

  test('rate limits enumeration-sensitive exports per exact tenant and hides foreign accounts', async () => {
    const h = setup()
    await h.service.saveAccount(h.scope, h.account, null)
    await h.service.export(h.scope, h.account.accountId, 'staff')
    await h.service.export(h.scope, h.account.accountId, 'staff')
    await h.service.export(h.scope, h.account.accountId, 'staff')
    await expect(h.service.export(h.scope, h.account.accountId, 'staff')).rejects.toBeInstanceOf(PublicationMemberAccessError)
    const otherScope = { ...h.scope, siteId: 'other-site', ownerKey: 'other-owner' }
    expect(await h.service.listAccounts(otherScope)).toEqual([])
    await expect(h.service.export(otherScope, h.account.accountId, 'staff')).rejects.toMatchObject({ code: 'not-found', message: 'Member account unavailable.' })
  })
})

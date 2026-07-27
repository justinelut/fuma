import { describe, expect, it } from 'bun:test'
import {
  PlatformConsoleRegistry,
  acceptPilot,
  approveBreakGlass,
  approveExpertRelease,
  assertLawyerDesignConversion,
  authorizeConsoleQuery,
  authorizeExpertInquiry,
  authorizeSupportAction,
  authorizeTransferHandoff,
  beginSupportSession,
  compareGhostSourceParity,
  kenyaFormat,
  planGhostImport,
  publicExpert,
  publicExpertProjection,
  rankExperts,
  reconcileLawyer,
  redactConsoleRow,
  rollbackGhostImport,
  transferExecutionPlan,
} from '../../src'

const hash = 'a'.repeat(64)
const now = new Date('2026-07-26T08:00:00Z')
const internal = { actorId: 'staff-a', host: 'admin.fuma.co.ke', authorities: new Set(['internal.plugins.review', 'internal.support.impersonate', 'internal.break-glass.approve']), stepUpAt: '2026-07-26T07:59:00Z', protectedOwner: false }
const digest = async (_value: string | Uint8Array) => hash

describe('FUMA-071 platform console composition', () => {
  it('mounts bounded contributions only on admin with exact internal authority and no overlap', () => {
    const registry = new PlatformConsoleRegistry()
    registry.register({ contributionId: 'plugin-review', ownerTicket: 'FUMA-068', routes: ['/internal/plugins/review'], requiredAuthorities: ['internal.plugins.review'] })
    expect(registry.authorize('/internal/plugins/review', internal).ownerTicket).toBe('FUMA-068')
    const reader = { ...internal, authorities: new Set([...internal.authorities, 'internal.console.read']) }
    expect(authorizeConsoleQuery({ view: 'organizations', filter: 'Nairobi', limit: 25 }, reader).limit).toBe(25)
    expect(redactConsoleRow({ organizationId: 'org-a', name: 'Fixture', secretToken: 'forbidden' }, new Set(['organizationId', 'name', 'secretToken']))).toEqual({ organizationId: 'org-a', name: 'Fixture' })
    expect(() => authorizeConsoleQuery({ view: 'organizations', limit: 101 }, reader)).toThrow('console.query')
    expect(() => registry.authorize('/internal/plugins/review', { ...internal, host: 'app.fuma.co.ke' })).toThrow('admin-host')
    expect(() => registry.register({ contributionId: 'plugin-review-copy', ownerTicket: 'FUMA-068', routes: ['/internal/plugins/review'], requiredAuthorities: ['internal.plugins.review'] })).toThrow('overlaps')
  })
})

describe('FUMA-072 support and break glass', () => {
  it('requires recent step-up, bounded expiry, non-protected non-nested target, evidence, and two current approvers', () => {
    const session = { sessionId: 'support-a', staffActorId: 'staff-a', targetUserId: 'customer-a', reason: 'Investigating customer-reported publishing issue.', stepUpAt: '2026-07-26T07:59:00Z', startedAt: '2026-07-26T08:00:00Z', expiresAt: '2026-07-26T08:20:00Z', evidenceHashSha256: hash, targetProtected: false, nested: false }
    expect(beginSupportSession(session, internal, now).sessionId).toBe('support-a')
    expect(authorizeSupportAction(session, { now, actorId: 'staff-a', capability: 'content.read', targetCapabilities: new Set(['content.read']), targetProtected: false }).sessionId).toBe('support-a')
    expect(() => authorizeSupportAction(session, { now, actorId: 'staff-a', capability: 'owner.recover', targetCapabilities: new Set(['owner.recover']), targetProtected: false })).toThrow('cannot elevate')
    expect(() => beginSupportSession({ ...session, nested: true }, internal, now)).toThrow()
    const request = { requestId: 'break-a', targetOwnerId: 'owner-a', reason: 'Documented owner recovery after verified loss of all factors.', approverIds: ['staff-a', 'staff-b'], evidenceHashSha256: hash, expiresAt: '2026-07-26T08:10:00Z' }
    const approval = { authority: internal, now, isolatedChannel: true, approvedActorIds: new Set(['staff-a', 'staff-b']) }
    expect(approveBreakGlass(request, approval).approverIds).toEqual(['staff-a', 'staff-b'])
    expect(() => approveBreakGlass({ ...request, approverIds: ['staff-a', 'staff-a'] }, approval)).toThrow('dual-approver')
  })
})

describe('FUMA-073 expert discovery', () => {
  const expert = { expertId: 'expert-a', organizationId: 'org-a', kind: 'developer', name: 'A Kenyan Developer', skills: ['Fuma', 'accessibility'], county: 'Nairobi', availability: 'available', approvedReleaseId: 'release-a', optedIn: true, suspended: false, consentVersion: 2, publicRevision: 4 }
  it('publishes only approved, opted-in, unsuspended profiles and mediates current-consent inquiries', () => {
    expect(publicExpert(expert).expertId).toBe('expert-a')
    const release = { releaseId: 'release-a', expertId: 'expert-a', submittedByActorId: 'expert-owner', approvedByActorId: 'reviewer-a', artifactHashSha256: hash, expertConsentVersion: 2, siteOwnerConsentVersion: 3 }
    expect(approveExpertRelease(release).releaseId).toBe('release-a')
    expect(() => approveExpertRelease({ ...release, approvedByActorId: 'expert-owner' })).toThrow('independent approver')
    expect(publicExpertProjection(expert)).not.toHaveProperty('organizationId')
    expect(publicExpertProjection(expert)).not.toHaveProperty('consentVersion')
    expect(rankExperts([expert, { ...expert, expertId: 'expert-b', availability: 'limited' }], { county: 'Nairobi', skill: 'Fuma', limit: 10 }).map(({ expertId }) => expertId)).toEqual(['expert-a', 'expert-b'])
    expect(() => publicExpert({ ...expert, suspended: true })).toThrow('not publicly')
    const inquiry = { inquiryId: 'inquiry-a', expertId: 'expert-a', senderFingerprintSha256: hash, encryptedObjectKey: 'experts/inquiries/inquiry-a', consentVersion: 2, messageBytes: 500, state: 'queued', createdAt: '2026-07-26T08:00:00Z', expiresAt: '2026-07-27T08:00:00Z' }
    expect(authorizeExpertInquiry(inquiry, expert, { now, blockedSender: false }).inquiryId).toBe('inquiry-a')
    expect(() => authorizeExpertInquiry({ ...inquiry, consentVersion: 1 }, expert, { now, blockedSender: false })).toThrow('eligible')
  })
})

describe('FUMA-074 transfer and Kenya localization', () => {
  it('revalidates current paid contract, destination, quotas, legal state, command identity, and registered asset owners', () => {
    const handoff = { platformId: 'fuma', organizationId: 'org-source', workspaceId: 'ws-a', siteId: 'site-a', ownerKey: 'owner-a', transferId: 'transfer-a', commandIdempotencyKey: 'handoff-a', contractId: 'contract-a', offerVersion: 3, paymentState: 'paid-transfer-pending', destinationOrganizationId: 'org-destination', locale: 'en-KE', currency: 'KES', timezone: 'Africa/Nairobi', selectedAssets: ['domain', 'ai', 'mcp', 'plugins', 'payments', 'collaborators'] as const }
    const authority = { contractId: 'contract-a', offerVersion: 3, paymentState: 'paid-transfer-pending' as const, destinationOrganizationId: 'org-destination', destinationActive: true, quotaAccepted: true, legalAccepted: true, commandIdempotencyKey: 'handoff-a' }
    expect(authorizeTransferHandoff(handoff, authority).transferId).toBe('transfer-a')
    const plan = transferExecutionPlan(handoff, authority)
    expect(plan.internalGrantExcluded).toBe(true)
    expect(plan.steps.map(({ asset }) => asset)).toEqual([...handoff.selectedAssets])
    expect(new Set(plan.steps.map(({ idempotencyKey }) => idempotencyKey)).size).toBe(plan.steps.length)
    expect(() => authorizeTransferHandoff({ ...handoff, destinationOrganizationId: 'org-attacker' }, authority)).toThrow('required')
    expect(kenyaFormat.money(12345)).toContain('123.45')
    expect(kenyaFormat.dateTime('2026-07-26T08:00:00Z')).toBeTruthy()
  })
})

describe('FUMA-075 structured Ghost import', () => {
  it('produces deterministic provenance, rejects source secrets, and rolls back idempotently', async () => {
    const source = { meta: { version: '5.82.0' }, data: { posts: [{ id: 'post-a', title: 'A' }], users: [{ id: 'author-a' }], tags: [], posts_authors: [{ post_id: 'post-a', author_id: 'author-a' }], posts_tags: [], settings: [] } }
    expect((await planGhostImport(source, { importId: 'import-a', dryRun: true, digest })).manifest.counts.posts).toBe(1)
    expect((await compareGhostSourceParity(source, structuredClone(source), { digest })).countsMatch).toBe(true)
    await expect(planGhostImport({ ...source, data: { ...source.data, users: [{ id: 'author-a', password: 'forbidden' }] } }, { importId: 'import-b', dryRun: true, digest })).rejects.toThrow('Forbidden source field')
    const applied = { importId: 'import-a', manifestHashSha256: hash, insertedIds: ['post-a'], mediaObjectKeys: [], state: 'applied' as const }
    const rolledBack = rollbackGhostImport(applied, hash)
    expect(rollbackGhostImport(rolledBack, hash)).toBe(rolledBack)
  })
})

describe('FUMA-076/077 Lawyer reconciliation and reusable conversion', () => {
  const inventory = { routes: ['/', '/news/a', '/membership'], memberIds: ['member-a'], membershipRules: [{ memberId: 'member-a', tier: 'paid', sourcePaymentId: 'payment-a' }], storageBytes: 10, monthlyTraffic: 20, emailProvider: 'resend', supportCommitments: ['weekday support'], contentRows: [{ id: 'post-a', custom_excerpt: '{malformed' }, { id: 'post-b', custom_excerpt: '{"section":"analysis"}' }] }
  it('verifies provider payments, quarantines malformed excerpts, requires reauth/OCI mail, and forbids disconnected copies', async () => {
    const result = await reconcileLawyer({ inventory, verifiedProviderPayments: new Map([['payment-a', 'provider-reference-a']]), digest })
    expect(result.report).toMatchObject({ paymentRows: [{ state: 'provider-verified' }], emailMigration: 'oci-email-delivery', requiresMemberReauth: true })
    expect(result.quarantinedRows).toEqual([0])
    expect(result.mappedExcerpts).toEqual([{ rowIndex: 1, value: { section: 'analysis' } }])
    const manifest = { inventoryHashSha256: hash, routeBindings: inventory.routes.map((route, index) => ({ route, templateId: index === 2 ? 'membership-template' : 'editorial-template', loopIds: [index === 2 ? 'membership-loop' : 'article-loop'], accessBinding: index === 2 ? 'paid' : 'public' })), templateIds: ['editorial-template', 'membership-template'], tokenHashSha256: hash, assetHashSha256: hash, flattenedCopies: 0 }
    expect(assertLawyerDesignConversion(manifest, inventory).routeBindings).toHaveLength(3)
    expect(() => assertLawyerDesignConversion({ ...manifest, routeBindings: manifest.routeBindings.slice(1) }, inventory)).toThrow('Every Lawyer route')
  })
})

describe('FUMA-084 pilot policy', () => {
  it('requires signed migration, parity, provider reconciliation, and rollback evidence', () => {
    const evidence = { sqliteTransitionHashMatched: true, ghostManifestHashMatched: true, lawyerInventoryComplete: true, immutableGrandfatheredContract: true, ociEmailActive: true, routeMemberAccessParity: true, providerPaymentsReconciled: true, rollbackRestoredHash: true, severityOneOpen: 0, signedBy: ['migration-owner', 'pilot-owner'] }
    expect(acceptPilot(evidence).lawyerInventoryComplete).toBe(true)
    expect(() => acceptPilot({ ...evidence, providerPaymentsReconciled: false })).toThrow('incomplete')
  })
})

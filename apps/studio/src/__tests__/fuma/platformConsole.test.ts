import { describe, expect, it } from 'bun:test'
import { PlatformConsoleService, type InternalAuthority } from '../../../../../packages/fuma-governance-launch/src'
import { composePlatformConsole } from '../../../server/fuma/platformConsole/composition'
import { EntitlementService, MemoryEntitlementRepository, type OfferDestinationAuthority, type QuotaEnvelope, type WorkloadAssumptions } from '../../../server/fuma/entitlements'
import { METER_CLASSES, type MeterClass } from '../../../server/fuma/metering'

const NOW = new Date('2026-07-29T12:00:00.000Z')
const quotas = Object.freeze(Object.fromEntries([
  ['sites', 2], ['pages', 100], ['cmsItems', 1000], ['members', 100], ['storageBytes', 1000], ['bandwidthBytes', 1000],
  ['emailRecipientsDay', 100], ['emailRecipientsMonth', 3000], ['buildPublishMinutes', 100], ['pluginComputeMinutes', 100],
  ['aiCredits', 100], ['releaseRetentionBytes', 1000], ['collaborators', 3], ['customDomains', 2],
])) as QuotaEnvelope
const recurringWorkload = Object.freeze(Object.fromEntries(METER_CLASSES.map((meter) => [meter, 1]))) as WorkloadAssumptions
const setupWorkload = Object.freeze(Object.fromEntries(METER_CLASSES.map((meter) => [meter, 1]))) as WorkloadAssumptions

class Destinations implements OfferDestinationAuthority {
  calls = 0
  async assertProvisional(input: Readonly<{ organizationId: string; workspaceId: string; siteId: string }>) {
    this.calls += 1
    if (JSON.stringify(input) !== JSON.stringify({ organizationId: 'org-provisional', workspaceId: 'workspace-provisional', siteId: 'site-provisional' })) throw new Error('destination-substitution')
  }
}

function draft(setupFeeMinor = 100) {
  return {
    offerId: 'offer-console', version: 1, destinationOrganizationId: 'org-provisional', destinationWorkspaceId: 'workspace-provisional', siteId: 'site-provisional',
    currency: 'KES' as const, recurringAmountMinor: 1000, cadence: 'annual' as const, setupFeeMinor,
    quotas, workloadAssumptions: recurringWorkload, setupWorkloadAssumptions: setupWorkload,
    termsHash: 'a'.repeat(64), effectiveAt: '2026-07-29T11:00:00.000Z', expiresAt: '2026-08-05T11:00:00.000Z',
    renewalAt: '2027-07-29T11:00:00.000Z', renewalPolicy: 'same-terms' as const, discount: null, replaces: null,
  }
}

function harness() {
  const repository = new MemoryEntitlementRepository()
  const destinations = new Destinations()
  const entitlements = new EntitlementService({
    repository, destinations, now: () => NOW, costConversionVersion: 'console-test-v1', usdMicrosToKesMinor: Number,
    catalog: {
      assertComplete(required?: readonly MeterClass[]) { if (required?.length !== METER_CLASSES.length) throw new Error('incomplete-cost') },
      cost(meter: MeterClass, physicalUnits: number) { return { version: `cost-${meter}`, source: 'invoice' as const, variable: BigInt(physicalUnits), fixed: 0n, allocationWeight: 1n } },
    },
  })
  const reviewCalls: Array<Record<string, unknown>> = []
  const reviews = {
    async decide(input: unknown) { reviewCalls.push(input as Record<string, unknown>); return { decisionId: 'decision-console' } as never },
    async revoke(input: unknown) { reviewCalls.push(input as Record<string, unknown>); return { revocationId: 'revocation-console' } as never },
  }
  const registry = composePlatformConsole({ entitlements, reviews })
  const service = new PlatformConsoleService({ source: { async read() { return [] } }, registry, now: () => NOW })
  return { repository, destinations, reviewCalls, registry, service }
}

const authority: InternalAuthority = {
  actorId: 'staff-commercial', host: 'admin.trimly.co.ke',
  authorities: new Set(['internal.console.write', 'internal.commercial.offer.issue', 'internal.plugins.review']),
  stepUpAt: '2026-07-29T11:59:00.000Z', protectedOwner: false,
}

describe('FUMA-071 canonical domain-service integration', () => {
  it('issues one immutable offer through canonical quota, cost, margin, setup and destination gates', async () => {
    const { repository, destinations, service } = harness()
    expect(await service.execute({ actionId: 'commercial.offer.issue', requestId: 'request-offer', input: draft() }, authority)).toEqual({ actionId: 'commercial.offer.issue', requestId: 'request-offer', state: 'completed', resourceId: 'offer-console', resourceVersion: 1 })
    const stored = await repository.exactOffer('offer-console', 1)
    expect(stored).toMatchObject({ state: 'issued', setupFeeMinor: 100, recurringAmountMinor: 1000, cadence: 'annual' })
    expect(stored?.setupEconomics.expectedCostMinor).toBeGreaterThan(0)
    expect(stored?.recurringEconomics.marginBasisPoints).toBeGreaterThanOrEqual(7000)
    expect(destinations.calls).toBeGreaterThanOrEqual(2)
    process.stdout.write(`[FUMA-071 demo] offer=${stored?.state} setup=${stored?.setupFeeMinor} recurring=${stored?.recurringAmountMinor} margin=${stored?.recurringEconomics.marginBasisPoints} destination=provisional\n`)
    await expect(service.execute({ actionId: 'commercial.offer.issue', requestId: 'request-unsafe', input: { ...draft(), recurringEconomics: {} } }, authority)).rejects.toMatchObject({ code: 'invalid' })
    await expect(service.execute({ actionId: 'commercial.offer.issue', requestId: 'request-margin', input: { ...draft(1), offerId: 'offer-underpriced' } }, authority)).rejects.toMatchObject({ code: 'margin' })
  })

  it('mounts FUMA-068, FUMA-072 and FUMA-073 while binding review actors server-side', async () => {
    const { registry, reviewCalls, service } = harness()
    expect(registry.list()).toEqual([
      { contributionId: 'artifact-review', ownerTicket: 'FUMA-068', routes: ['/internal/artifacts/reviews'], requiredAuthorities: ['internal.plugins.review'] },
      { contributionId: 'support-moderation', ownerTicket: 'FUMA-072', routes: ['/internal/support', '/internal/support/moderation', '/internal/support/suspensions', '/internal/support/appeals', '/internal/support/owner-recovery'], requiredAuthorities: ['internal.support.read'] },
      { contributionId: 'expert-moderation', ownerTicket: 'FUMA-073', routes: ['/internal/experts', '/internal/experts/approvals', '/internal/experts/inquiries', '/internal/experts/transfers'], requiredAuthorities: ['internal.experts.read'] },
      { contributionId: 'ai-backend-capabilities', ownerTicket: 'FUMA-087', routes: ['/internal/ai-capabilities'], requiredAuthorities: ['internal.console.read'] },
      { contributionId: 'transfer-recovery', ownerTicket: 'FUMA-074', routes: ['/internal/transfers', '/internal/transfers/reconcile', '/internal/transfers/recover', '/internal/transfers/refund-escalations'], requiredAuthorities: ['internal.transfers.read'] },
    ])
    expect(registry.list().some(({ ownerTicket }) => ownerTicket === 'FUMA-074')).toBe(true)
    await service.execute({ actionId: 'artifact-review.decide', requestId: 'request-review', input: { decisionId: 'decision-console', submissionId: 'submission-console', reviewerId: 'attacker', decision: 'rejected', reason: 'Fixture rejection.', decidedAt: NOW.toISOString() } }, authority)
    expect(reviewCalls[0]?.reviewerId).toBe('staff-commercial')
  })
})

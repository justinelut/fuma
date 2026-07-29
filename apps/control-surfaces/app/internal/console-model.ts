import {
  CONSOLE_VIEWS,
  PlatformConsoleRegistry,
  PlatformConsoleService,
  type ConsolePage,
  type ConsoleQuery,
  type InternalAuthority,
  type PlatformConsoleReadSource,
} from '../../../../packages/fuma-governance-launch/src'

export const consoleViewLabels = Object.freeze({
  users: 'Users', organizations: 'Organizations', clients: 'Managed and provisional clients', workspaces: 'Workspaces',
  sites: 'Sites', plans: 'Plans', offers: 'Custom offers', contracts: 'Contracts', invoices: 'Invoices',
  economics: 'COGS and margin', usage: 'Usage and quota', domains: 'Domains', email: 'Email', jobs: 'Jobs',
  releases: 'Releases', ai: 'AI catalog', audit: 'Audit',
} satisfies Readonly<Record<ConsoleQuery['view'], string>>)

const at = '2026-07-29T10:00:00.000Z'
const rows = Object.freeze({
  users: [{ userId: 'user-client-owner', displayName: 'Managed client owner', emailHashSha256: '8b7d'.padEnd(64, '0'), status: 'active', createdAt: at, sessionToken: 'never-visible' }],
  organizations: [
    { organizationId: 'fuma-platform', slug: 'fuma-platform', name: 'Fuma Platform', kind: 'platform', status: 'active', createdAt: at },
    { organizationId: 'org-provisional-kijani', slug: 'kijani-law', name: 'Kijani Law', kind: 'customer', status: 'provisional', createdAt: at },
  ],
  clients: [
    { organizationId: 'fuma-platform', name: 'Fuma Platform', lifecycle: 'protected-internal-grant', intendedWorkspaceId: null, intendedSiteId: null, createdAt: at },
    { organizationId: 'org-provisional-kijani', name: 'Kijani Law', lifecycle: 'paid-transfer-pending', intendedWorkspaceId: 'workspace-kijani', intendedSiteId: 'site-kijani', createdAt: at },
  ],
  workspaces: [{ workspaceId: 'workspace-kijani', organizationId: 'org-provisional-kijani', slug: 'primary', name: 'Kijani workspace', status: 'provisional', createdAt: at }],
  sites: [{ siteId: 'site-kijani', workspaceId: 'workspace-kijani', organizationId: 'org-provisional-kijani', slug: 'kijani', name: 'Kijani Law', profileId: 'publication', status: 'provisional', createdAt: at }],
  plans: [{ planId: 'publication-pro', version: '2026-07', cadence: 'annual', amountMinor: 240000, currency: 'KES', state: 'published', effectiveAt: at }],
  offers: [{ offerId: 'offer-kijani-annual', version: 1, organizationId: 'org-provisional-kijani', workspaceId: 'workspace-kijani', siteId: 'site-kijani', cadence: 'annual', recurringAmountMinor: 240000, setupFeeMinor: 65000, currency: 'KES', quotaState: 'finite-accepted', costModelVersion: `cost-model:sha256:${'c'.repeat(64)}`, recurringExpectedCostMinor: 68000, setupExpectedCostMinor: 32000, marginBasisPoints: 7166, state: 'accepted', issuedAt: at, acceptedAt: '2026-07-29T10:10:00.000Z', expiresAt: '2026-08-05T10:00:00.000Z', privateJson: 'never-visible' }],
  contracts: [{ contractId: 'contract-kijani', offerId: 'offer-kijani-annual', offerVersion: 1, organizationId: 'org-provisional-kijani', workspaceId: 'workspace-kijani', siteId: 'site-kijani', state: 'paid-transfer-pending', setupPaymentState: 'paid', recurringPaymentState: 'paid', activatedAt: '2026-07-29T10:25:00.000Z', handoffState: 'pending' }],
  invoices: [
    { invoiceId: 'invoice-kijani-setup', contractId: 'contract-kijani', kind: 'setup', amountMinor: 65000, currency: 'KES', state: 'paid', issuedAt: at, paidAt: '2026-07-29T10:20:00.000Z' },
    { invoiceId: 'invoice-kijani-recurring', contractId: 'contract-kijani', kind: 'recurring', amountMinor: 240000, currency: 'KES', state: 'paid', issuedAt: at, paidAt: '2026-07-29T10:21:00.000Z' },
  ],
  economics: [
    { organizationId: 'fuma-platform', sourceId: 'platform-internal', revenueMinor: 0, costMinor: 19000, marginBasisPoints: 0, variableCogsBasisPoints: 0, costModelVersion: `cost-model:sha256:${'c'.repeat(64)}`, periodStart: at, periodEnd: '2026-07-31T23:59:59.000Z' },
    { organizationId: 'org-provisional-kijani', sourceId: 'offer-kijani-annual:1', revenueMinor: 240000, costMinor: 68000, marginBasisPoints: 7166, variableCogsBasisPoints: 2834, costModelVersion: `cost-model:sha256:${'c'.repeat(64)}`, periodStart: at, periodEnd: '2027-07-29T10:00:00.000Z' },
  ],
  usage: [{ organizationId: 'org-provisional-kijani', sourceId: 'contract-kijani', quotaClass: 'sites', used: 1, reserved: 0, limit: 3, remaining: 2, percent: 33, observedAt: at }],
  domains: [{ domainId: 'domain-kijani', organizationId: 'org-provisional-kijani', siteId: 'site-kijani', hostname: 'kijani.example', kind: 'customer-managed', desired: 'validating', observed: 'dns-pending', certificate: 'none', updatedAt: at, credentialCiphertext: 'never-visible' }],
  email: [{ organizationId: 'org-provisional-kijani', siteId: 'site-kijani', domain: 'mail.kijani.example', state: 'pending-verification', provider: 'oci-email', lastCheckedAt: at }],
  jobs: [{ jobId: 'job-handoff-kijani', kind: 'paid-handoff', organizationId: 'org-provisional-kijani', siteId: 'site-kijani', state: 'ready', attempt: 0, nextAttemptAt: at, updatedAt: at }],
  releases: [{ releaseId: 'release-kijani', organizationId: 'org-provisional-kijani', siteId: 'site-kijani', state: 'active', contentHashSha256: 'd'.repeat(64), createdAt: at, activatedAt: at }],
  ai: [{ providerId: 'provider-anthropic', modelId: 'claude-fixture', displayName: 'Fixture model', enabled: true, visibility: 'customer', costModelVersion: `cost-model:sha256:${'c'.repeat(64)}`, refreshedAt: at, credential: 'never-visible' }],
  audit: [{ eventId: 'audit-offer-kijani', actorId: 'staff-commercial', action: 'commercial.offer.issue', targetKind: 'custom-offer', targetId: 'offer-kijani-annual:1', requestId: 'request-kijani', occurredAt: at, rawBody: 'never-visible' }],
} satisfies Readonly<Record<ConsoleQuery['view'], readonly Readonly<Record<string, unknown>>[]>>)

class DemoConsoleReadSource implements PlatformConsoleReadSource {
  async read(view: ConsoleQuery['view']): Promise<readonly Readonly<Record<string, unknown>>[]> {
    return structuredClone(rows[view])
  }
}

export const consoleViews = CONSOLE_VIEWS

export async function queryConsoleDemo(query: unknown, authority: InternalAuthority): Promise<ConsolePage> {
  const service = new PlatformConsoleService({ source: new DemoConsoleReadSource(), registry: new PlatformConsoleRegistry() })
  return await service.query(query, authority)
}

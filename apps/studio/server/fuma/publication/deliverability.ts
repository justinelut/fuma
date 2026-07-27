import {
  PublicationEngagementConsentSchema,
  PublicationEngagementEventSchema,
  PublicationEngagementSummarySchema,
  ScopedEmailSuppressionSchema,
  SenderDomainHealthSchema,
  parsePublicationContract,
  type PublicationEngagementConsent,
  type PublicationEngagementEvent,
  type PublicationEngagementSummary,
  type ScopedEmailSuppression,
  type SenderDomainHealth,
} from '@core/fuma/publication'
import type { PublicationRepositoryScope } from './scope'
import type { PublicationIdAuthority } from './servicePorts'
import { PublicationDomainError } from './services'

export interface PublicationDeliverabilityControlStore {
  putScopedSuppression(scope: PublicationRepositoryScope, suppression: ScopedEmailSuppression): Promise<boolean>
  isEmailSuppressed(scope: PublicationRepositoryScope, emailHashSha256: string, newsletterId: string | null): Promise<boolean>
  putSenderDomainHealth(scope: PublicationRepositoryScope, health: SenderDomainHealth): Promise<void>
  getSenderDomainHealth(scope: PublicationRepositoryScope, domain: string): Promise<SenderDomainHealth | null>
  listSenderDomainHealth(scope: PublicationRepositoryScope): Promise<readonly SenderDomainHealth[]>
  putEngagementConsent(scope: PublicationRepositoryScope, consent: PublicationEngagementConsent, expectedVersion: number | null): Promise<boolean>
  getEngagementConsent(scope: PublicationRepositoryScope, memberId: string): Promise<PublicationEngagementConsent | null>
  appendEngagementEvent(scope: PublicationRepositoryScope, event: PublicationEngagementEvent): Promise<boolean>
  purgeExpiredEngagement(scope: PublicationRepositoryScope, before: string): Promise<number>
  engagementSummary(scope: PublicationRepositoryScope, from: string, to: string, expiredPurged: number): Promise<PublicationEngagementSummary>
}

function normalizedEmail(value: string): string { return value.trim().toLowerCase() }
function domainOf(email: string): string { return normalizedEmail(email).split('@')[1] ?? '' }

export class PublicationDeliverabilityControlService {
  readonly #store: PublicationDeliverabilityControlStore
  readonly #ids: PublicationIdAuthority
  readonly #now: () => Date

  constructor(store: PublicationDeliverabilityControlStore, ids: PublicationIdAuthority, now: () => Date = () => new Date()) {
    this.#store = store
    this.#ids = ids
    this.#now = now
  }

  async suppress(scope: PublicationRepositoryScope, input: ScopedEmailSuppression): Promise<ScopedEmailSuppression> {
    const suppression = parsePublicationContract('scoped email suppression', ScopedEmailSuppressionSchema, input)
    if ((suppression.level === 'newsletter') !== (suppression.newsletterId !== null)) throw new PublicationDomainError('invalid-transition', 'Newsletter suppression requires exactly one newsletter ID.')
    await this.#store.putScopedSuppression(scope, suppression)
    return suppression
  }

  isSuppressed(scope: PublicationRepositoryScope, email: string, newsletterId: string | null): Promise<boolean> {
    return this.#store.isEmailSuppressed(scope, this.#ids.sha256(normalizedEmail(email)), newsletterId)
  }

  async saveDomainHealth(scope: PublicationRepositoryScope, input: SenderDomainHealth): Promise<SenderDomainHealth> {
    const parsed = parsePublicationContract('sender domain health', SenderDomainHealthSchema, input)
    const domain = parsed.domain.toLowerCase()
    const senderEmails = parsed.approvedSenderEmails.map(normalizedEmail).toSorted()
    if (new Set(senderEmails).size !== senderEmails.length || senderEmails.some((email) => domainOf(email) !== domain)) throw new PublicationDomainError('invalid-transition', 'Approved sender addresses must be unique and belong to the verified domain.')
    const ready = senderEmails.length > 0 && parsed.spf === 'verified' && parsed.dkim === 'verified' && parsed.dmarc === 'verified'
    if (parsed.productionReady !== ready) throw new PublicationDomainError('invalid-transition', 'Production readiness must reflect approved sender, SPF, DKIM, and DMARC state.')
    const health = parsePublicationContract('normalized sender domain health', SenderDomainHealthSchema, { ...parsed, domain, approvedSenderEmails: senderEmails })
    await this.#store.putSenderDomainHealth(scope, health)
    return health
  }

  async assertProductionSender(scope: PublicationRepositoryScope, senderEmail: string): Promise<SenderDomainHealth> {
    const email = normalizedEmail(senderEmail)
    const health = await this.#store.getSenderDomainHealth(scope, domainOf(email))
    if (!health?.productionReady || !health.approvedSenderEmails.includes(email)) throw new PublicationDomainError('provider-rejected', 'Production sender or domain is not verified.')
    return health
  }

  domainHealth(scope: PublicationRepositoryScope): Promise<readonly SenderDomainHealth[]> { return this.#store.listSenderDomainHealth(scope) }

  async setEngagementConsent(scope: PublicationRepositoryScope, input: PublicationEngagementConsent, expectedVersion: number | null): Promise<PublicationEngagementConsent> {
    const consent = parsePublicationContract('engagement consent', PublicationEngagementConsentSchema, input)
    if ((expectedVersion === null && consent.consentVersion !== 1) || (expectedVersion !== null && consent.consentVersion !== expectedVersion + 1)) throw new PublicationDomainError('conflict', 'Engagement consent version is not contiguous.')
    if (!await this.#store.putEngagementConsent(scope, consent, expectedVersion)) throw new PublicationDomainError('conflict', 'Engagement consent changed concurrently.')
    return consent
  }

  async recordEngagement(scope: PublicationRepositoryScope, input: Omit<PublicationEngagementEvent, 'eventId' | 'expiresAt'>): Promise<PublicationEngagementEvent | null> {
    const consent = await this.#store.getEngagementConsent(scope, input.memberId)
    if (!consent || consent.state !== 'opted-in' || Date.parse(input.occurredAt) < Date.parse(consent.updatedAt)) return null
    if ((input.kind === 'open') !== (input.targetUrlHashSha256 === null)) throw new PublicationDomainError('invalid-transition', 'Open events omit target hashes and click events require them.')
    const expiresAt = new Date(Date.parse(input.occurredAt) + consent.retentionDays * 86_400_000).toISOString()
    const event = parsePublicationContract('first-party engagement event', PublicationEngagementEventSchema, { ...input, eventId: this.#ids.id('engagement'), expiresAt })
    return await this.#store.appendEngagementEvent(scope, event) ? event : null
  }

  async optOut(scope: PublicationRepositoryScope, memberId: string): Promise<PublicationEngagementConsent> {
    const current = await this.#store.getEngagementConsent(scope, memberId)
    const consent = parsePublicationContract('engagement opt-out', PublicationEngagementConsentSchema, { memberId, state: 'opted-out', consentVersion: (current?.consentVersion ?? 0) + 1, retentionDays: current?.retentionDays ?? 30, updatedAt: this.#now().toISOString() })
    if (!await this.#store.putEngagementConsent(scope, consent, current?.consentVersion ?? null)) throw new PublicationDomainError('conflict', 'Engagement consent changed concurrently.')
    return consent
  }

  purgeExpired(scope: PublicationRepositoryScope): Promise<number> { return this.#store.purgeExpiredEngagement(scope, this.#now().toISOString()) }

  async summary(scope: PublicationRepositoryScope, from: string, to: string): Promise<PublicationEngagementSummary> {
    if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(from) >= Date.parse(to)) throw new PublicationDomainError('invalid-transition', 'Engagement range is invalid.')
    const expiredPurged = await this.#store.purgeExpiredEngagement(scope, this.#now().toISOString())
    return parsePublicationContract('engagement summary', PublicationEngagementSummarySchema, await this.#store.engagementSummary(scope, from, to, expiredPurged))
  }
}

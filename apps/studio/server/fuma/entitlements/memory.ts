import { PLATFORM_ORGANIZATION_ID } from '../organizations/contracts'
import {
  type AllowanceAdjustment,
  type ContractCandidate,
  type CustomOffer,
  type EntitlementRepository,
  type EntitlementSnapshot,
  type GrandfatheredAssignment,
  type InternalGrant,
  type PriceBook,
} from './contracts'
import { evidenceSha256 } from './economics'
import { EntitlementError } from './errors'

function canonical(value: unknown): string { return JSON.stringify(value) }

export class MemoryEntitlementRepository implements EntitlementRepository {
  readonly grants = new Map<string, InternalGrant>()
  readonly priceBooks = new Map<string, PriceBook>()
  readonly adjustments = new Map<string, AllowanceAdjustment>()
  readonly offers = new Map<string, CustomOffer>()
  readonly candidates = new Map<string, ContractCandidate>()
  readonly grandfathered = new Map<string, GrandfatheredAssignment>()
  readonly snapshots = new Map<string, EntitlementSnapshot>()
  readonly #tails = new Map<string, Promise<void>>()

  async #serialized<T>(key: string, work: () => Promise<T>): Promise<T> {
    const prior = this.#tails.get(key) ?? Promise.resolve()
    let unlock!: () => void
    const next = new Promise<void>((resolve) => { unlock = resolve })
    const chained = prior.then(() => next)
    this.#tails.set(key, chained)
    await prior
    try { return await work() } finally { unlock(); if (this.#tails.get(key) === chained) this.#tails.delete(key) }
  }

  async createInternalGrant(grant: InternalGrant): Promise<InternalGrant> {
    return await this.#serialized('internal-grant', async () => {
      if (grant.organizationId !== PLATFORM_ORGANIZATION_ID || grant.grantId !== 'platform-internal'
        || !grant.nonTransferable || grant.providerCustomerId !== null || !grant.shadowCostRequired) {
        throw new EntitlementError('internal-only', 'Internal grant authority is invalid.')
      }
      const existing = this.grants.get(grant.grantId)
      if (existing && canonical(existing) !== canonical(grant)) throw new EntitlementError('immutable', 'The sole platform-internal grant is immutable.')
      if (existing) return structuredClone(existing)
      this.grants.set(grant.grantId, structuredClone(grant))
      return structuredClone(grant)
    })
  }

  async findInternalGrant(organizationId: string): Promise<InternalGrant | null> {
    const grant = this.grants.get('platform-internal')
    return grant?.organizationId === organizationId ? structuredClone(grant) : null
  }

  async publishPriceBook(book: PriceBook): Promise<PriceBook> {
    return await this.#serialized(`price:${book.version}`, async () => {
      const existing = this.priceBooks.get(book.version)
      if (existing && canonical(existing) !== canonical(book)) throw new EntitlementError('immutable', 'Published price-book versions are immutable.')
      if (!existing) this.priceBooks.set(book.version, structuredClone(book))
      return Object.freeze(structuredClone(existing ?? book))
    })
  }

  async exactPriceBook(version: string): Promise<PriceBook | null> { return structuredClone(this.priceBooks.get(version) ?? null) }

  async saveAdjustment(adjustment: AllowanceAdjustment): Promise<AllowanceAdjustment> {
    return await this.#serialized(`adjustment:${adjustment.adjustmentId}`, async () => {
      const existing = this.adjustments.get(adjustment.adjustmentId)
      const identity = (value: AllowanceAdjustment) => ({ ...value, state: undefined })
      if (existing && canonical(identity(existing)) !== canonical(identity(adjustment))) throw new EntitlementError('immutable', 'Allowance adjustment evidence is immutable.')
      if (existing && existing.state !== adjustment.state && existing.state !== 'active') {
        throw new EntitlementError('immutable', 'Terminal allowance adjustments cannot transition.')
      }
      this.adjustments.set(adjustment.adjustmentId, structuredClone(adjustment))
      return structuredClone(adjustment)
    })
  }

  async issueOffer(offer: CustomOffer): Promise<CustomOffer> {
    const key = `${offer.offerId}:${offer.version}`
    return await this.#serialized(`offer:${key}`, async () => {
      if (offer.state !== 'issued' || offer.issuedAt === null || offer.acceptedAt !== null) throw new EntitlementError('immutable', 'Only an exact issued snapshot can be persisted.')
      const existing = this.offers.get(key)
      if (existing && canonical(existing) !== canonical(offer)) throw new EntitlementError('immutable', 'Issued offer snapshots are immutable.')
      if (!existing) this.offers.set(key, structuredClone(offer))
      return structuredClone(existing ?? offer)
    })
  }

  async exactOffer(id: string, version: number): Promise<CustomOffer | null> { return structuredClone(this.offers.get(`${id}:${version}`) ?? null) }

  async transitionOffer(id: string, version: number, state: 'withdrawn' | 'expired', _at: string): Promise<CustomOffer> {
    const key = `${id}:${version}`
    return await this.#serialized(`offer:${key}`, async () => {
      const existing = this.offers.get(key)
      if (!existing) throw new EntitlementError('not-found', 'Offer does not exist.')
      if (existing.state === state) return structuredClone(existing)
      if (existing.state !== 'issued') throw new EntitlementError('immutable', 'Only an issued offer may be withdrawn or expired.')
      const next = Object.freeze({ ...existing, state })
      this.offers.set(key, next)
      return structuredClone(next)
    })
  }

  async acceptOffer(input: Readonly<{ offerId: string; version: number; organizationId: string; workspaceId: string; siteId: string; now: string }>) {
    const key = `${input.offerId}:${input.version}`
    return await this.#serialized(`offer:${key}`, async () => {
      const offer = this.offers.get(key)
      if (!offer || !['issued', 'accepted'].includes(offer.state)) throw new EntitlementError('expired', 'Exact issued offer is unavailable.')
      if (Date.parse(offer.expiresAt) <= Date.parse(input.now)) throw new EntitlementError('expired', 'Exact issued offer expired.')
      if (offer.destinationOrganizationId !== input.organizationId || offer.destinationWorkspaceId !== input.workspaceId || offer.siteId !== input.siteId) {
        throw new EntitlementError('destination', 'Offer destination substitution denied.')
      }
      const candidateId = `candidate:${offer.offerId}:${offer.version}`
      const existingCandidate = this.candidates.get(candidateId)
      if (existingCandidate) return Object.freeze({ offer: structuredClone(offer), candidate: structuredClone(existingCandidate) })
      const snapshotSha256 = evidenceSha256(offer)
      const candidate: ContractCandidate = Object.freeze({
        candidateId, offerId: offer.offerId, offerVersion: offer.version,
        destinationOrganizationId: offer.destinationOrganizationId, destinationWorkspaceId: offer.destinationWorkspaceId, siteId: offer.siteId,
        state: 'awaiting-payment', setupFeeSettled: false, recurringSettled: false, activatedAt: null,
        paidTransferPending: false, snapshotSha256, createdAt: input.now,
      })
      const accepted = Object.freeze({ ...offer, state: 'accepted' as const, acceptedAt: input.now })
      this.candidates.set(candidateId, candidate)
      this.offers.set(key, accepted)
      return Object.freeze({ offer: structuredClone(accepted), candidate: structuredClone(candidate) })
    })
  }

  async saveGrandfathered(assignment: GrandfatheredAssignment): Promise<GrandfatheredAssignment> {
    return await this.#serialized(`grandfathered:${assignment.assignmentId}`, async () => {
      const existing = this.grandfathered.get(assignment.assignmentId)
      if (existing && canonical(existing) !== canonical(assignment)) throw new EntitlementError('immutable', 'Grandfathered assignments are immutable.')
      if (!existing) {
        this.grandfathered.set(assignment.assignmentId, structuredClone(assignment))
        const snapshot: EntitlementSnapshot = Object.freeze({
          snapshotId: `snapshot:${assignment.assignmentId}`, organizationId: assignment.organizationId,
          source: 'grandfathered', sourceId: assignment.assignmentId, quotas: assignment.quotas,
          effectiveAt: assignment.effectiveAt, expiresAt: null, immutableSha256: evidenceSha256(assignment),
        })
        this.snapshots.set(snapshot.snapshotId, snapshot)
      }
      return structuredClone(existing ?? assignment)
    })
  }

  async currentSnapshot(organizationId: string, at: string): Promise<EntitlementSnapshot | null> {
    const instant = Date.parse(at)
    const matches = [...this.snapshots.values()].filter((value) => value.organizationId === organizationId
      && Date.parse(value.effectiveAt) <= instant && (value.expiresAt === null || Date.parse(value.expiresAt) > instant))
      .sort((left, right) => Date.parse(right.effectiveAt) - Date.parse(left.effectiveAt) || right.snapshotId.localeCompare(left.snapshotId))
    return structuredClone(matches[0] ?? null)
  }
}

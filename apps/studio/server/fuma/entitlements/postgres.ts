import { Value } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import { PLATFORM_ORGANIZATION_ID } from '../organizations/contracts'
import {
  AllowanceAdjustmentSchema,
  CustomOfferSchema,
  EntitlementSnapshotSchema,
  GrandfatheredAssignmentSchema,
  InternalGrantSchema,
  PriceBookSchema,
  type AllowanceAdjustment,
  type ContractCandidate,
  type CustomOffer,
  type EntitlementRepository,
  type EntitlementSnapshot,
  type GrandfatheredAssignment,
  type InternalGrant,
  type OfferDestinationAuthority,
  type PriceBook,
  type QuotaClass,
} from './contracts'
import { evidenceSha256 } from './economics'
import { EntitlementError } from './errors'

type Json = string | Record<string, unknown>
type GrantRow = { grant_id: string; organization_id: string; quota_json: Json; non_transferable: boolean; provider_customer_id: string | null; shadow_cost_required: boolean }
type PriceRow = { private_json: Json }
type AdjustmentRow = { adjustment_id: string; organization_id: string; quota_class: QuotaClass; units: string | number; kind: AllowanceAdjustment['kind']; effective_at: string | Date; expires_at: string | Date; approved_by: string; state: AllowanceAdjustment['state'] }
type OfferRow = { state: CustomOffer['state']; accepted_at: string | Date | null; private_json: Json }
type ReplacementOfferRow = OfferRow & { expires_at: string | Date }
type CandidateRow = { candidate_id: string; offer_id: string; offer_version: string | number; destination_organization_id: string; destination_workspace_id: string; site_id: string; state: 'awaiting-payment'; setup_fee_settled: boolean; recurring_settled: boolean; activated_at: null; paid_transfer_pending: false; snapshot_sha256: string; created_at: string | Date }
type SnapshotRow = { snapshot_id: string; organization_id: string; source: EntitlementSnapshot['source']; source_id: string; quota_json: Json; effective_at: string | Date; expires_at: string | Date | null; immutable_sha256: string }
type GrandfatheredRow = { private_json: Json }

function iso(value: string | Date): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString() }
function json<T>(value: Json): T { return (typeof value === 'string' ? JSON.parse(value) : value) as T }
function checked<T>(schema: Parameters<typeof Value.Check>[0], value: unknown, label: string): T {
  if (!Value.Check(schema, value)) throw new EntitlementError('invalid', `Stored ${label} failed strict validation.`)
  return Object.freeze(value) as T
}
function mapGrant(row: GrantRow): InternalGrant {
  return checked(InternalGrantSchema, { grantId: row.grant_id, organizationId: row.organization_id, quotas: json(row.quota_json), nonTransferable: row.non_transferable, providerCustomerId: row.provider_customer_id, shadowCostRequired: row.shadow_cost_required }, 'internal grant')
}
function mapPrice(row: PriceRow): PriceBook { return checked(PriceBookSchema, json(row.private_json), 'price book') }
function mapAdjustment(row: AdjustmentRow): AllowanceAdjustment {
  return checked(AllowanceAdjustmentSchema, { adjustmentId: row.adjustment_id, organizationId: row.organization_id, quotaClass: row.quota_class, units: Number(row.units), kind: row.kind, effectiveAt: iso(row.effective_at), expiresAt: iso(row.expires_at), approvedBy: row.approved_by, state: row.state }, 'allowance adjustment')
}
function mapOffer(row: OfferRow): CustomOffer {
  const snapshot = json<CustomOffer>(row.private_json)
  return checked(CustomOfferSchema, { ...snapshot, state: row.state, acceptedAt: row.accepted_at ? iso(row.accepted_at) : null }, 'custom offer')
}
function mapCandidate(row: CandidateRow): ContractCandidate {
  if (row.setup_fee_settled || row.recurring_settled || row.activated_at !== null || row.paid_transfer_pending) {
    throw new EntitlementError('invalid', 'Stored awaiting-payment candidate crossed the FUMA-054 activation boundary.')
  }
  return Object.freeze({ candidateId: row.candidate_id, offerId: row.offer_id, offerVersion: Number(row.offer_version), destinationOrganizationId: row.destination_organization_id, destinationWorkspaceId: row.destination_workspace_id, siteId: row.site_id, state: 'awaiting-payment' as const, setupFeeSettled: false as const, recurringSettled: false as const, activatedAt: null, paidTransferPending: false as const, snapshotSha256: row.snapshot_sha256, createdAt: iso(row.created_at) })
}
function mapSnapshot(row: SnapshotRow): EntitlementSnapshot {
  return checked(EntitlementSnapshotSchema, { snapshotId: row.snapshot_id, organizationId: row.organization_id, source: row.source, sourceId: row.source_id, quotas: json(row.quota_json), effectiveAt: iso(row.effective_at), expiresAt: row.expires_at ? iso(row.expires_at) : null, immutableSha256: row.immutable_sha256 }, 'entitlement snapshot')
}
function same(left: unknown, right: unknown): boolean { return evidenceSha256(left) === evidenceSha256(right) }

export class PostgresOfferDestinationAuthority implements OfferDestinationAuthority {
  readonly #db: DbClient
  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new Error('Fuma offer destinations require PostgreSQL authority.')
    this.#db = db
  }
  async assertProvisional(input: Readonly<{ organizationId: string; workspaceId: string; siteId: string }>): Promise<void> {
    const result = await this.#db<{ authorized: number }>`
      select 1 as authorized from auth_organizations o
      join fuma_workspaces w on w.organization_id=o.id and w.id=${input.workspaceId} and w.status='active'
      join fuma_sites s on s.organization_id=o.id and s.workspace_id=w.id and s.id=${input.siteId} and s.status='active'
      where o.id=${input.organizationId}
    `
    if (!result.rows[0]) throw new EntitlementError('destination', 'Offer destination is not a current provisional organization/workspace/site tuple.')
  }
}

export class PostgresEntitlementRepository implements EntitlementRepository {
  readonly #db: DbClient
  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new Error('Fuma entitlements require PostgreSQL authority.')
    this.#db = db
  }

  createInternalGrant(grant: InternalGrant): Promise<InternalGrant> {
    if (!Value.Check(InternalGrantSchema, grant) || grant.organizationId !== PLATFORM_ORGANIZATION_ID) {
      throw new EntitlementError('internal-only', 'Internal grant authority is invalid.')
    }
    return this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${'fuma:entitlement:internal'},0))`
      const existing = await tx<GrantRow>`select * from fuma_entitlement_grants where grant_id='platform-internal'`
      if (existing.rows[0]) {
        const prior = mapGrant(existing.rows[0])
        if (!same(prior, grant)) throw new EntitlementError('immutable', 'The sole platform-internal grant is immutable.')
        return prior
      }
      await tx`insert into fuma_entitlement_grants (grant_id,organization_id,kind,quota_json,non_transferable,shadow_cost_required,provider_customer_id,created_at) values (${grant.grantId},${grant.organizationId},'platform-internal',${JSON.stringify(grant.quotas)}::text::jsonb,${grant.nonTransferable},${grant.shadowCostRequired},null,current_timestamp)`
      return grant
    })
  }

  async findInternalGrant(organizationId: string): Promise<InternalGrant | null> {
    const result = await this.#db<GrantRow>`select * from fuma_entitlement_grants where grant_id='platform-internal' and organization_id=${organizationId}`
    return result.rows[0] ? mapGrant(result.rows[0]) : null
  }

  publishPriceBook(book: PriceBook): Promise<PriceBook> {
    return this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:price-book:${book.version}`},0))`
      const found = await tx<PriceRow>`select e.private_json from fuma_price_book_evidence e where e.version=${book.version}`
      if (found.rows[0]) {
        const prior = mapPrice(found.rows[0])
        if (!same(prior, book)) throw new EntitlementError('immutable', 'Published price-book versions are immutable.')
        return prior
      }
      await tx`insert into fuma_price_books (version,currency,public_json,effective_at,published_at) values (${book.version},${book.currency},${JSON.stringify(book.publicJson)}::text::jsonb,${book.effectiveAt},${book.publishedAt})`
      await tx`insert into fuma_price_book_evidence (version,cost_model_version,private_json,evidence_sha256,created_at) values (${book.version},${book.costModelVersion},${JSON.stringify(book)}::text::jsonb,${evidenceSha256(book)},${book.publishedAt})`
      return book
    })
  }

  async exactPriceBook(version: string): Promise<PriceBook | null> {
    const result = await this.#db<PriceRow>`select private_json from fuma_price_book_evidence where version=${version}`
    return result.rows[0] ? mapPrice(result.rows[0]) : null
  }

  saveAdjustment(adjustment: AllowanceAdjustment): Promise<AllowanceAdjustment> {
    return this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:adjustment:${adjustment.adjustmentId}`},0))`
      const found = await tx<AdjustmentRow>`select * from fuma_entitlement_adjustments where adjustment_id=${adjustment.adjustmentId} for update`
      if (!found.rows[0]) {
        await tx`insert into fuma_entitlement_adjustments (adjustment_id,organization_id,quota_class,units,kind,effective_at,expires_at,approved_by,state) values (${adjustment.adjustmentId},${adjustment.organizationId},${adjustment.quotaClass},${adjustment.units},${adjustment.kind},${adjustment.effectiveAt},${adjustment.expiresAt},${adjustment.approvedBy},${adjustment.state})`
        return adjustment
      }
      const prior = mapAdjustment(found.rows[0])
      if (!same({ ...prior, state: null }, { ...adjustment, state: null })) throw new EntitlementError('immutable', 'Allowance adjustment evidence is immutable.')
      if (prior.state === adjustment.state) return prior
      if (prior.state !== 'active') throw new EntitlementError('immutable', 'Terminal allowance adjustments cannot transition.')
      const updated = await tx<AdjustmentRow>`update fuma_entitlement_adjustments set state=${adjustment.state} where adjustment_id=${adjustment.adjustmentId} returning *`
      return mapAdjustment(updated.rows[0]!)
    })
  }

  issueOffer(offer: CustomOffer): Promise<CustomOffer> {
    return this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:offer:${offer.offerId}:${offer.version}`},0))`
      if (offer.replaces) {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:offer:${offer.replaces.offerId}:${offer.replaces.version}`},0))`
      }
      const found = await tx<OfferRow>`select o.state,e.accepted_at,e.private_json from fuma_custom_offers o join fuma_custom_offer_evidence e on e.offer_id=o.offer_id and e.offer_version=o.version where o.offer_id=${offer.offerId} and o.version=${offer.version}`
      if (found.rows[0]) {
        const prior = mapOffer(found.rows[0])
        if (!same(prior, offer)) throw new EntitlementError('immutable', 'Issued offer snapshots are immutable.')
        return prior
      }
      await tx`insert into fuma_custom_offers (offer_id,version,destination_organization_id,destination_workspace_id,site_id,currency,recurring_amount_minor,cadence,setup_fee_minor,assumptions_json,quota_json,terms_hash,cost_model_version,expected_cost_minor,margin_basis_points,state,effective_at,expires_at) values (${offer.offerId},${offer.version},${offer.destinationOrganizationId},${offer.destinationWorkspaceId},${offer.siteId},${offer.currency},${offer.recurringAmountMinor},${offer.cadence},${offer.setupFeeMinor},${JSON.stringify(offer.workloadAssumptions)}::text::jsonb,${JSON.stringify(offer.quotas)}::text::jsonb,${offer.termsHash},${offer.recurringEconomics.costModelVersion},${offer.recurringEconomics.expectedCostMinor},${offer.recurringEconomics.marginBasisPoints},'issued',${offer.effectiveAt},${offer.expiresAt})`
      await tx`insert into fuma_custom_offer_evidence (offer_id,offer_version,private_json,evidence_sha256,issued_at,accepted_at) values (${offer.offerId},${offer.version},${JSON.stringify(offer)}::text::jsonb,${evidenceSha256(offer)},${offer.issuedAt},null)`
      return offer
    })
  }

  async exactOffer(id: string, version: number): Promise<CustomOffer | null> {
    const result = await this.#db<OfferRow>`select o.state,e.accepted_at,e.private_json from fuma_custom_offers o join fuma_custom_offer_evidence e on e.offer_id=o.offer_id and e.offer_version=o.version where o.offer_id=${id} and o.version=${version}`
    return result.rows[0] ? mapOffer(result.rows[0]) : null
  }

  transitionOffer(id: string, version: number, state: 'withdrawn' | 'expired', _at: string): Promise<CustomOffer> {
    return this.#db.transaction(async (tx) => {
      const found = await tx<OfferRow>`select o.state,e.accepted_at,e.private_json from fuma_custom_offers o join fuma_custom_offer_evidence e on e.offer_id=o.offer_id and e.offer_version=o.version where o.offer_id=${id} and o.version=${version} for update of o`
      if (!found.rows[0]) throw new EntitlementError('not-found', 'Offer does not exist.')
      const prior = mapOffer(found.rows[0])
      if (prior.state === state) return prior
      if (prior.state !== 'issued') throw new EntitlementError('immutable', 'Only an issued offer may transition.')
      await tx`update fuma_custom_offers set state=${state} where offer_id=${id} and version=${version}`
      return Object.freeze({ ...prior, state })
    })
  }

  acceptOffer(input: Readonly<{ offerId: string; version: number; organizationId: string; workspaceId: string; siteId: string; now: string }>) {
    return this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:offer:${input.offerId}:${input.version}`},0))`
      const found = await tx<OfferRow>`select o.state,e.accepted_at,e.private_json from fuma_custom_offers o join fuma_custom_offer_evidence e on e.offer_id=o.offer_id and e.offer_version=o.version where o.offer_id=${input.offerId} and o.version=${input.version} for update of o`
      if (!found.rows[0]) throw new EntitlementError('not-found', 'Exact offer does not exist.')
      const replacements = await tx<ReplacementOfferRow>`
        select o.state,e.accepted_at,e.private_json,o.expires_at
        from fuma_custom_offer_evidence e
        join fuma_custom_offers o on o.offer_id=e.offer_id and o.version=e.offer_version
        where o.state in ('issued','accepted') and o.expires_at>${input.now}
      `
      const replaced = replacements.rows.some((candidate) => {
        const replacement = mapOffer(candidate)
        return replacement.replaces?.offerId === input.offerId
          && replacement.replaces.version === input.version
      })
      if (replaced) throw new EntitlementError('expired', 'Exact issued offer was replaced.')
      const offer = mapOffer(found.rows[0])
      const destination = await tx<{ authorized: number }>`
        select 1 as authorized from auth_organizations o
        join fuma_workspaces w on w.organization_id=o.id and w.id=${input.workspaceId} and w.status='active'
        join fuma_sites s on s.organization_id=o.id and s.workspace_id=w.id and s.id=${input.siteId} and s.status='active'
        where o.id=${input.organizationId}
        for share of w,s
      `
      if (!destination.rows[0]) throw new EntitlementError('destination', 'Offer destination is no longer provisionally valid.')
      if (!['issued','accepted'].includes(offer.state) || Date.parse(offer.expiresAt) <= Date.parse(input.now)) throw new EntitlementError('expired', 'Exact issued offer is unavailable.')
      if (offer.destinationOrganizationId !== input.organizationId || offer.destinationWorkspaceId !== input.workspaceId || offer.siteId !== input.siteId) throw new EntitlementError('destination', 'Offer destination substitution denied.')
      const existing = await tx<CandidateRow>`select * from fuma_contract_candidates where offer_id=${input.offerId} and offer_version=${input.version}`
      if (existing.rows[0]) {
        if (offer.state !== 'accepted') throw new EntitlementError('immutable', 'Candidate exists without an accepted offer snapshot.')
        return Object.freeze({ offer, candidate: mapCandidate(existing.rows[0]) })
      }
      const candidateId = `candidate:${offer.offerId}:${offer.version}`
      const snapshot = evidenceSha256(offer)
      const inserted = await tx<CandidateRow>`insert into fuma_contract_candidates (candidate_id,offer_id,offer_version,destination_organization_id,destination_workspace_id,site_id,state,setup_fee_settled,recurring_settled,activated_at,paid_transfer_pending,snapshot_sha256,created_at) values (${candidateId},${offer.offerId},${offer.version},${offer.destinationOrganizationId},${offer.destinationWorkspaceId},${offer.siteId},'awaiting-payment',false,false,null,false,${snapshot},${input.now}) returning *`
      await tx`update fuma_custom_offers set state='accepted' where offer_id=${offer.offerId} and version=${offer.version}`
      await tx`update fuma_custom_offer_evidence set accepted_at=${input.now} where offer_id=${offer.offerId} and offer_version=${offer.version}`
      return Object.freeze({ offer: Object.freeze({ ...offer, state: 'accepted' as const, acceptedAt: input.now }), candidate: mapCandidate(inserted.rows[0]!) })
    })
  }

  saveGrandfathered(assignment: GrandfatheredAssignment): Promise<GrandfatheredAssignment> {
    return this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:grandfathered:${assignment.assignmentId}`},0))`
      const found = await tx<GrandfatheredRow>`select private_json from fuma_grandfathered_assignments where assignment_id=${assignment.assignmentId}`
      if (found.rows[0]) {
        const prior = checked<GrandfatheredAssignment>(GrandfatheredAssignmentSchema, json(found.rows[0].private_json), 'grandfathered assignment')
        if (!same(prior, assignment)) throw new EntitlementError('immutable', 'Grandfathered assignments are immutable.')
        return prior
      }
      const hash = evidenceSha256(assignment)
      await tx`insert into fuma_entitlement_assignments (assignment_id,organization_id,source,source_id,state,effective_at,expires_at,created_at) values (${assignment.assignmentId},${assignment.organizationId},'grandfathered',${assignment.assignmentId},'active',${assignment.effectiveAt},null,current_timestamp)`
      await tx`insert into fuma_grandfathered_assignments (assignment_id,private_json,source,inventory_evidence_sha256,immutable_sha256,created_at) values (${assignment.assignmentId},${JSON.stringify(assignment)}::text::jsonb,${assignment.source},${assignment.lawyerInventory?.inventorySha256 ?? null},${hash},current_timestamp)`
      await tx`insert into fuma_entitlement_snapshots (snapshot_id,organization_id,source,source_id,quota_json,effective_at,expires_at,immutable_sha256,created_at) values (${`snapshot:${assignment.assignmentId}`},${assignment.organizationId},'grandfathered',${assignment.assignmentId},${JSON.stringify(assignment.quotas)}::text::jsonb,${assignment.effectiveAt},null,${hash},current_timestamp)`
      return assignment
    })
  }

  async currentSnapshot(organizationId: string, at: string): Promise<EntitlementSnapshot | null> {
    const result = await this.#db<SnapshotRow>`select * from fuma_entitlement_snapshots where organization_id=${organizationId} and effective_at<=${at} and (expires_at is null or expires_at>${at}) order by effective_at desc,snapshot_id desc limit 1`
    return result.rows[0] ? mapSnapshot(result.rows[0]) : null
  }
}

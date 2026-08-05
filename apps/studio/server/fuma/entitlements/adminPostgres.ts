import { Value } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import { PLATFORM_ORGANIZATION_ID } from '../organizations/contracts'
import {
  AllowanceAdjustmentSchema,
  CustomOfferSchema,
  InternalGrantSchema,
  PriceBookSchema,
  type AllowanceAdjustment,
  type CustomOffer,
  type InternalGrant,
  type PriceBook,
} from './contracts'
import {
  EntitlementAdminEventSchema,
  EntitlementAdminWorkspaceSchema,
  type EntitlementAdminAuthority,
  type EntitlementAdminEvent,
  type EntitlementAdminWorkspace,
} from './adminContracts'
import { EntitlementError } from './errors'

const PLATFORM_ID = 'fuma'
type Json = string | Record<string, unknown>
type PriceRow = { private_json: Json }
type OfferRow = { state: CustomOffer['state']; accepted_at: string | Date | null; private_json: Json }
type GrantRow = { grant_id: string; organization_id: string; quota_json: Json; non_transferable: boolean; provider_customer_id: string | null; shadow_cost_required: boolean }
type AdjustmentRow = { adjustment_id: string; organization_id: string; quota_class: AllowanceAdjustment['quotaClass']; units: string | number; kind: AllowanceAdjustment['kind']; effective_at: string | Date; expires_at: string | Date; approved_by: string; state: AllowanceAdjustment['state'] }
type EventRow = { id: string; action: EntitlementAdminEvent['action']; actor_user_id: string; request_id: string; metadata_json: Json; created_at: string | Date }

function iso(value: string | Date): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString() }
function json<T>(value: Json): T { return (typeof value === 'string' ? JSON.parse(value) : value) as T }
function checked<T>(schema: Parameters<typeof Value.Check>[0], value: unknown, label: string): T {
  if (!Value.Check(schema, value)) throw new EntitlementError('invalid', `Stored ${label} failed strict validation.`)
  return Object.freeze(structuredClone(value)) as T
}
function price(row: PriceRow): PriceBook { return checked(PriceBookSchema, json(row.private_json), 'price-book admin projection') }
function offer(row: OfferRow): CustomOffer {
  const snapshot = json<CustomOffer>(row.private_json)
  return checked(CustomOfferSchema, { ...snapshot, state: row.state, acceptedAt: row.accepted_at ? iso(row.accepted_at) : null }, 'offer admin projection')
}
function grant(row: GrantRow): InternalGrant {
  return checked(InternalGrantSchema, {
    grantId: row.grant_id, organizationId: row.organization_id, quotas: json(row.quota_json),
    nonTransferable: row.non_transferable, providerCustomerId: row.provider_customer_id,
    shadowCostRequired: row.shadow_cost_required,
  }, 'internal-grant admin projection')
}
function adjustment(row: AdjustmentRow): AllowanceAdjustment {
  return checked(AllowanceAdjustmentSchema, {
    adjustmentId: row.adjustment_id, organizationId: row.organization_id, quotaClass: row.quota_class,
    units: Number(row.units), kind: row.kind, effectiveAt: iso(row.effective_at), expiresAt: iso(row.expires_at),
    approvedBy: row.approved_by, state: row.state,
  }, 'adjustment admin projection')
}
function priceProjection(row: PriceRow) {
  const book = price(row)
  return Object.freeze({
    version: book.version,
    effectiveAt: book.effectiveAt,
    publishedAt: book.publishedAt,
    costModelVersion: book.costModelVersion,
    plans: book.plans.map((plan) => Object.freeze({
      planId: plan.planId,
      name: plan.name,
      profile: plan.profile,
      cadence: plan.cadence,
      amountMinor: plan.amountMinor,
      quotas: plan.quotas,
      expectedCostMinor: plan.economics.expectedCostMinor,
      marginBasisPoints: plan.economics.marginBasisPoints,
      variableCogsBasisPoints: plan.economics.variableCogsBasisPoints,
    })),
  })
}
function offerProjection(row: OfferRow) {
  const value = offer(row)
  if (value.state === 'draft' || value.issuedAt === null) throw new EntitlementError('invalid', 'Stored offer is not issued admin evidence.')
  return Object.freeze({
    offerId: value.offerId,
    version: value.version,
    destinationOrganizationId: value.destinationOrganizationId,
    destinationWorkspaceId: value.destinationWorkspaceId,
    siteId: value.siteId,
    cadence: value.cadence,
    recurringAmountMinor: value.recurringAmountMinor,
    setupFeeMinor: value.setupFeeMinor,
    quotas: value.quotas,
    recurringExpectedCostMinor: value.recurringEconomics.expectedCostMinor,
    setupExpectedCostMinor: value.setupEconomics.expectedCostMinor,
    marginBasisPoints: value.recurringEconomics.marginBasisPoints,
    state: value.state,
    issuedAt: value.issuedAt,
    acceptedAt: value.acceptedAt,
    expiresAt: value.expiresAt,
  })
}
function event(row: EventRow): EntitlementAdminEvent {
  const metadata = json<{ targetId?: unknown }>(row.metadata_json)
  return checked(EntitlementAdminEventSchema, {
    eventId: row.id, action: row.action, targetId: metadata.targetId,
    actorId: row.actor_user_id, requestId: row.request_id, occurredAt: iso(row.created_at),
  }, 'entitlement audit projection')
}

export class PostgresEntitlementAdminRepository {
  readonly #db: DbClient
  readonly #now: () => Date

  constructor(db: DbClient, now: () => Date = () => new Date()) {
    if (db.dialect !== 'postgres') throw new TypeError('Entitlement administration requires PostgreSQL authority.')
    this.#db = db
    this.#now = now
  }

  async workspace(): Promise<EntitlementAdminWorkspace> {
    const [prices, offers, grants, adjustments, events] = await Promise.all([
      this.#db<PriceRow>`select private_json from fuma_price_book_evidence order by created_at desc,version desc limit 50`,
      this.#db<OfferRow>`select offer.state,evidence.accepted_at,evidence.private_json from fuma_custom_offer_evidence evidence join fuma_custom_offers offer on offer.offer_id=evidence.offer_id and offer.version=evidence.offer_version order by evidence.issued_at desc,evidence.offer_id,evidence.offer_version desc limit 100`,
      this.#db<GrantRow>`select grant_id,organization_id,quota_json,non_transferable,provider_customer_id,shadow_cost_required from fuma_entitlement_grants where grant_id='platform-internal' and organization_id=${PLATFORM_ORGANIZATION_ID}`,
      this.#db<AdjustmentRow>`select adjustment_id,organization_id,quota_class,units,kind,effective_at,expires_at,approved_by,state from fuma_entitlement_adjustments order by effective_at desc,adjustment_id limit 100`,
      this.#db<EventRow>`select id,action,actor_user_id,request_id,metadata_json,created_at from fuma_audit_history where platform_id=${PLATFORM_ID} and scope_kind='platform' and action like 'entitlement.%' order by created_at desc,id limit 50`,
    ])
    const candidate = {
      generatedAt: this.#now().toISOString(),
      priceBooks: prices.rows.map(priceProjection),
      offers: offers.rows.map(offerProjection),
      internalGrant: grants.rows[0] ? grant(grants.rows[0]) : null,
      adjustments: adjustments.rows.map(adjustment),
      recentEvents: events.rows.map(event),
    }
    return checked(EntitlementAdminWorkspaceSchema, candidate, 'entitlement admin workspace')
  }

  async audit(input: Readonly<{
    authority: EntitlementAdminAuthority
    requestId: string
    action: EntitlementAdminEvent['action']
    targetId: string
  }>): Promise<void> {
    const eventId = `entitlement-admin:${input.requestId}`
    const createdAt = this.#now().toISOString()
    const inserted = await this.#db`
      insert into fuma_audit_history (
        platform_id,organization_id,workspace_id,site_id,id,scope_kind,actor_kind,
        actor_user_id,actor_session_id,impersonator_user_id,request_id,originating_request_id,
        job_id,run_id,action,outcome,metadata_json,created_at
      ) values (
        ${PLATFORM_ID},null,null,null,${eventId},'platform','staff',${input.authority.actorId},
        ${input.authority.sessionId},null,${input.requestId},null,null,null,${input.action},'success',
        ${JSON.stringify({ targetId: input.targetId })}::text::jsonb,${createdAt}
      ) on conflict (platform_id,id) do nothing
    `
    if (inserted.rowCount === 1) return
    const replay = await this.#db<EventRow>`select id,action,actor_user_id,request_id,metadata_json,created_at from fuma_audit_history where platform_id=${PLATFORM_ID} and id=${eventId}`
    const prior = replay.rows[0] ? event(replay.rows[0]) : null
    if (!prior || prior.action !== input.action || prior.actorId !== input.authority.actorId
      || prior.requestId !== input.requestId || prior.targetId !== input.targetId) {
      throw new EntitlementError('immutable', 'Entitlement administration request ID replay does not match its first mutation.')
    }
  }
}

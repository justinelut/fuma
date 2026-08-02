import { Type } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import {
  PAID_HANDOFF_ASSET_OWNERS,
  PaidHandoffReadinessSchema,
  parsePaidHandoff,
  type PaidHandoffReadiness,
} from './paidHandoffContracts'
import type { PaidHandoffOutboxAuthority, PaidHandoffReadinessAuthority } from './paidHandoff'

const TransitionSchema = Type.Object({
  commandId: Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' }),
  from: Type.Union([Type.Literal('pending'), Type.Literal('failed'), Type.Literal('delivered')]),
  to: Type.Union([Type.Literal('pending'), Type.Literal('failed'), Type.Literal('delivered')]),
  transferId: Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' }),
  occurredAt: Type.String({ format: 'date-time' }),
}, { additionalProperties: false })

export class PostgresPaidHandoffOutboxAuthority implements PaidHandoffOutboxAuthority {
  readonly #db: DbClient
  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new TypeError('Paid handoff outbox authority requires PostgreSQL.')
    this.#db = db
  }

  async transition(inputValue: Readonly<{
    commandId: string
    from: 'pending' | 'failed' | 'delivered'
    to: 'pending' | 'failed' | 'delivered'
    transferId: string
    occurredAt: string
  }>): Promise<void> {
    const input = parsePaidHandoff(TransitionSchema, inputValue, 'paid handoff outbox transition')
    if (input.from === input.to) throw new TypeError('Paid handoff transition must change state.')
    await this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${'fuma:paid-handoff:' + input.commandId},0))`
      const current = await tx<{ command_id: string; state: 'pending' | 'failed' | 'delivered'; delivered_at: Date | string | null; transfer_matches: boolean }>`
        select h.command_id,h.state,h.delivered_at,exists(
          select 1 from fuma_organization_contracts c
          join fuma_site_transfer_proposals p
            on p.id=${input.transferId}
           and p.source_site_id=c.site_id
           and p.destination_organization_id=c.organization_id
           and p.destination_workspace_id=c.workspace_id
           and p.destination_site_id=c.site_id
          where c.contract_id=h.contract_id
        ) transfer_matches
        from fuma_paid_handoff_outbox h
        where h.command_id=${input.commandId} for update
      `
      const row = current.rows[0]
      if (!row) throw new Error('Paid handoff outbox command does not exist.')
      if (!row.transfer_matches) throw new Error('Paid handoff outbox transfer identity differs from the current paid contract.')
      if (row.state === input.to) {
        if (input.to === 'delivered' && row.delivered_at === null) throw new Error('Delivered paid handoff is missing durable delivery time.')
        return
      }
      if (row.state !== input.from) throw new Error('Paid handoff outbox transition does not match current durable authority.')
      const result = await tx<{ command_id: string; state: string }>`
        update fuma_paid_handoff_outbox set
          state=${input.to},
          delivered_at=${input.to === 'delivered' ? input.occurredAt : null}
        where command_id=${input.commandId} and state=${input.from}
        returning command_id,state
      `
      if (result.rowCount !== 1 || result.rows[0]?.command_id !== input.commandId || result.rows[0]?.state !== input.to) {
        throw new Error('Paid handoff outbox transition did not converge.')
      }
    })
  }
}

type BillingRow = Readonly<{
  command_id: string
  outbox_state: 'pending' | 'failed' | 'delivered'
  contract_id: string
  payment_state: string
  activated_at: Date | string
  offer_id: string
  offer_version: number | string
  destination_organization_id: string
  destination_workspace_id: string
  site_id: string
  setup_fee_minor: number | string
  recurring_amount_minor: number | string
  currency: string
  cadence: string
  offer_state: string
  accepted_at: Date | string | null
}>

export interface PaidHandoffIdentityAuthority {
  /** Resolves exact current source/destination ownership; browser and billing rows are not ownership authority. */
  resolve(input: Readonly<{
    commandId: string
    contractId: string
    offerId: string
    offerVersion: number
    destinationOrganizationId: string
    destinationWorkspaceId: string
    siteId: string
  }>): Promise<unknown>
}
export interface PaidHandoffCurrentAcceptanceAuthority {
  /** Revalidates current destination, quota, legal/policy and metering authorities. */
  resolve(input: Readonly<{
    commandId: string
    contractId: string
    offerId: string
    offerVersion: number
    destinationOrganizationId: string
    destinationWorkspaceId: string
    siteId: string
  }>): Promise<unknown>
}

const IdentitySchema = Type.Object({
  transferId: Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' }),
  source: PaidHandoffReadinessSchema.properties.source,
  destination: PaidHandoffReadinessSchema.properties.destination,
}, { additionalProperties: false })
const CurrentSchema = Type.Object({
  destinationActive: Type.Boolean(), quotaAccepted: Type.Boolean(),
  policyAcceptanceCurrent: Type.Boolean(), meteringEvidenceCurrent: Type.Boolean(),
}, { additionalProperties: false })

/**
 * Reads immutable paid contract/offer facts in PostgreSQL, then asks the existing ownership,
 * quota, legal-policy and metering authorities for current decisions. No decision is cached.
 */
export class PostgresPaidHandoffReadinessAuthority implements PaidHandoffReadinessAuthority {
  readonly #db: DbClient
  readonly #identity: PaidHandoffIdentityAuthority
  readonly #current: PaidHandoffCurrentAcceptanceAuthority
  constructor(input: Readonly<{ db: DbClient; identity: PaidHandoffIdentityAuthority; current: PaidHandoffCurrentAcceptanceAuthority }>) {
    if (input.db.dialect !== 'postgres') throw new TypeError('Paid handoff readiness requires PostgreSQL.')
    this.#db = input.db; this.#identity = input.identity; this.#current = input.current
  }

  async resolve(commandId: string): Promise<PaidHandoffReadiness> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(commandId)) throw new TypeError('Paid handoff command ID is invalid.')
    const result = await this.#db.unsafe<BillingRow>(`
      select h.command_id,h.state outbox_state,c.contract_id,c.state payment_state,c.activated_at,
        o.offer_id,o.version offer_version,o.destination_organization_id,o.destination_workspace_id,
        o.site_id,o.setup_fee_minor,o.recurring_amount_minor,o.currency,o.cadence,o.state offer_state,
        e.accepted_at
      from fuma_paid_handoff_outbox h
      join fuma_organization_contracts c on c.contract_id=h.contract_id
      left join fuma_contract_candidates cc on cc.candidate_id=c.candidate_id
      join fuma_custom_offers o on
        (cc.offer_id=o.offer_id and cc.offer_version=o.version)
        or (c.source_kind='private-offer' and c.source_id=o.offer_id and c.source_version=o.version::text)
      join fuma_custom_offer_evidence e on e.offer_id=o.offer_id and e.offer_version=o.version
      where h.command_id=$1
    `, [commandId])
    if (result.rowCount !== 1 || !result.rows[0]) throw new Error('Paid handoff command does not resolve one current paid contract.')
    const row = result.rows[0]
    const offerVersion = Number(row.offer_version)
    const setupAmountMinor = Number(row.setup_fee_minor)
    const recurringAmountMinor = Number(row.recurring_amount_minor)
    if (![offerVersion, setupAmountMinor, recurringAmountMinor].every(Number.isSafeInteger)) throw new Error('Paid handoff monetary or offer evidence is not exact.')
    const selector = Object.freeze({ commandId, contractId: row.contract_id, offerId: row.offer_id, offerVersion, destinationOrganizationId: row.destination_organization_id, destinationWorkspaceId: row.destination_workspace_id, siteId: row.site_id })
    const identity = parsePaidHandoff(IdentitySchema, await this.#identity.resolve(selector), 'paid handoff ownership identity')
    const current = parsePaidHandoff(CurrentSchema, await this.#current.resolve(selector), 'paid handoff current acceptance')
    if (identity.destination.organizationId !== selector.destinationOrganizationId
      || identity.destination.workspaceId !== selector.destinationWorkspaceId || identity.destination.siteId !== selector.siteId) {
      throw new Error('Paid handoff destination differs from current paid contract authority.')
    }
    const activatedAt = row.activated_at instanceof Date ? row.activated_at.toISOString() : new Date(row.activated_at).toISOString()
    return parsePaidHandoff(PaidHandoffReadinessSchema, {
      commandId, transferId: identity.transferId, contractId: row.contract_id, offerId: row.offer_id, offerVersion,
      source: identity.source, destination: identity.destination, outboxState: row.outbox_state,
      paymentState: row.payment_state, destinationActive: current.destinationActive,
      quotaAccepted: current.quotaAccepted,
      policyAcceptanceCurrent: current.policyAcceptanceCurrent && row.offer_state === 'accepted' && row.accepted_at !== null,
      meteringEvidenceCurrent: current.meteringEvidenceCurrent,
      internalGrantExcluded: true, assetOwners: PAID_HANDOFF_ASSET_OWNERS,
      setupAmountMinor, recurringAmountMinor, currency: row.currency, cadence: row.cadence,
      locale: 'en-KE', timezone: 'Africa/Nairobi', activatedAt,
    }, 'paid handoff PostgreSQL readiness')
  }
}

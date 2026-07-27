import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import { PLATFORM_ORGANIZATION_ID } from '../organizations/contracts'
import {
  CustomOfferSchema,
  InternalGrantSchema,
  PriceBookSchema,
  QuotaEnvelopeSchema,
  evidenceSha256,
  type CustomOffer,
  type PriceBook,
  type QuotaEnvelope,
} from '../entitlements'
import { QuotaError } from './service'
import type { QuotaSource, VerifiedQuotaSource } from './contracts'

type Json = string | Record<string, unknown>
type InternalRow = Readonly<{
  grant_id: string
  organization_id: string
  quota_json: Json
  non_transferable: boolean
  provider_customer_id: string | null
  shadow_cost_required: boolean
  created_at: Date | string
}>
type ContractRow = Readonly<{
  contract_id: string
  organization_id: string
  state: 'active' | 'paid-transfer-pending'
  activated_at: Date | string
  source_kind: 'public-plan' | 'private-offer'
  source_id: string
  source_version: string
  cadence: 'monthly' | 'annual'
  evidence_sha256: string
}>
type EvidenceRow = Readonly<{
  private_json: Json
  state?: CustomOffer['state']
  accepted_at?: Date | string | null
}>
type SnapshotRow = Readonly<{
  snapshot_id: string
  organization_id: string
  source: 'grandfathered'
  source_id: string
  quota_json: Json
  effective_at: Date | string
  immutable_sha256: string
}>

function json(value: Json): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function quotas(value: unknown, label: string): QuotaEnvelope {
  const parsed = safeParseValue(QuotaEnvelopeSchema, value)
  if (!parsed.ok) throw new QuotaError('unverified-contract', `Verified ${label} quotas are invalid.`)
  return Object.freeze(parsed.value)
}

function parsePriceBook(row: EvidenceRow): PriceBook {
  const parsed = safeParseValue(PriceBookSchema, json(row.private_json))
  if (!parsed.ok) throw new QuotaError('unverified-contract', 'Verified public price-book evidence is invalid.')
  return Object.freeze(parsed.value)
}

function parseOffer(row: EvidenceRow): CustomOffer {
  const snapshot = json(row.private_json) as Record<string, unknown>
  const candidate = row.state === undefined ? snapshot : {
    ...snapshot,
    state: row.state,
    acceptedAt: row.accepted_at ? iso(row.accepted_at) : null,
  }
  const parsed = safeParseValue(CustomOfferSchema, candidate)
  if (!parsed.ok) throw new QuotaError('unverified-contract', 'Verified private offer evidence is invalid.')
  return Object.freeze(parsed.value)
}

async function internalSource(
  db: DbClient,
  organizationId: string,
  _at: string,
): Promise<VerifiedQuotaSource | null> {
  if (organizationId !== PLATFORM_ORGANIZATION_ID) return null
  const result = await db<InternalRow>`
    select grant_id,organization_id,quota_json,non_transferable,provider_customer_id,
      shadow_cost_required,created_at
    from fuma_entitlement_grants
    where grant_id='platform-internal' and organization_id=${organizationId}
  `
  const row = result.rows[0]
  if (!row) return null
  const parsed = safeParseValue(InternalGrantSchema, {
    grantId: row.grant_id,
    organizationId: row.organization_id,
    quotas: json(row.quota_json),
    nonTransferable: row.non_transferable,
    providerCustomerId: row.provider_customer_id,
    shadowCostRequired: row.shadow_cost_required,
  })
  if (!parsed.ok) throw new QuotaError('unverified-contract', 'Protected internal grant evidence is invalid.')
  const evidence = evidenceSha256(parsed.value)
  return Object.freeze({
    organizationId,
    source: 'platform-internal',
    sourceId: parsed.value.grantId,
    sourceVersion: `sha256:${evidence}`,
    entitlementSnapshotId: `quota:grant:${evidence.slice(0, 32)}`,
    evidenceSha256: evidence,
    quotas: parsed.value.quotas,
    activatedAt: iso(row.created_at),
    contractId: null,
  })
}

async function exactContractQuotas(
  db: DbClient,
  contract: ContractRow,
): Promise<QuotaEnvelope> {
  if (contract.source_kind === 'public-plan') {
    const result = await db<EvidenceRow>`
      select private_json from fuma_price_book_evidence where version=${contract.source_version}
    `
    const row = result.rows[0]
    if (!row) throw new QuotaError('unverified-contract', 'Verified contract price-book evidence is unavailable.')
    const book = parsePriceBook(row)
    const plan = book.plans.find((candidate) => (
      candidate.planId === contract.source_id && candidate.cadence === contract.cadence
    ))
    if (!plan) throw new QuotaError('unverified-contract', 'Verified contract plan snapshot is unavailable.')
    return quotas(plan.quotas, 'public contract')
  }
  const version = Number(contract.source_version)
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new QuotaError('unverified-contract', 'Verified private contract version is invalid.')
  }
  const result = await db<EvidenceRow>`
    select o.state,e.accepted_at,e.private_json from fuma_custom_offer_evidence e
    join fuma_custom_offers o on o.offer_id=e.offer_id and o.version=e.offer_version
    where e.offer_id=${contract.source_id} and e.offer_version=${version}
  `
  const row = result.rows[0]
  if (!row) throw new QuotaError('unverified-contract', 'Verified private offer evidence is unavailable.')
  const offer = parseOffer(row)
  if (offer.state !== 'accepted' || offer.acceptedAt === null
    || offer.offerId !== contract.source_id || offer.version !== version) {
    throw new QuotaError('unverified-contract', 'Private contract does not bind accepted immutable offer evidence.')
  }
  return quotas(offer.quotas, 'private contract')
}

async function contractSource(
  db: DbClient,
  organizationId: string,
): Promise<VerifiedQuotaSource | null> {
  const result = await db<ContractRow>`
    select contract_id,organization_id,state,activated_at,source_kind,source_id,
      source_version,cadence,evidence_sha256
    from fuma_organization_contracts
    where organization_id=${organizationId}
      and state in ('active','paid-transfer-pending')
      and checkout_id is not null
    order by activated_at desc,contract_id desc limit 1
  `
  const contract = result.rows[0]
  if (!contract) return null
  const resolvedQuotas = await exactContractQuotas(db, contract)
  const source: QuotaSource = contract.source_kind === 'public-plan'
    ? 'public-contract'
    : 'private-contract'
  const activatedAt = iso(contract.activated_at)
  const binding = Object.freeze({
    contractId: contract.contract_id,
    organizationId,
    source,
    sourceId: contract.source_id,
    sourceVersion: contract.source_version,
    cadence: contract.cadence,
    contractEvidenceSha256: contract.evidence_sha256,
    quotas: resolvedQuotas,
    activatedAt,
  })
  const immutableSha256 = evidenceSha256(binding)
  const entitlementSnapshotId = `snapshot:contract:${contract.contract_id}`
  await db`
    insert into fuma_entitlement_assignments (
      assignment_id,organization_id,source,source_id,state,effective_at,expires_at,created_at
    ) values (
      ${`assignment:contract:${contract.contract_id}`},${organizationId},${source},
      ${contract.contract_id},'active',${activatedAt},null,${activatedAt}
    ) on conflict (assignment_id) do nothing
  `
  await db`
    insert into fuma_entitlement_snapshots (
      snapshot_id,organization_id,source,source_id,quota_json,effective_at,expires_at,
      immutable_sha256,created_at
    ) values (
      ${entitlementSnapshotId},${organizationId},${source},${contract.contract_id},
      ${JSON.stringify(resolvedQuotas)}::text::jsonb,${activatedAt},null,${immutableSha256},${activatedAt}
    ) on conflict (snapshot_id) do nothing
  `
  const exact = await db<Readonly<{
    organization_id: string
    immutable_sha256: string
  }>>`
    select organization_id,immutable_sha256 from fuma_entitlement_snapshots
    where snapshot_id=${entitlementSnapshotId}
  `
  if (exact.rows[0]?.organization_id !== organizationId
    || exact.rows[0]?.immutable_sha256 !== immutableSha256) {
    throw new QuotaError('conflict', 'Verified contract entitlement snapshot identity changed.')
  }
  return Object.freeze({
    organizationId,
    source,
    sourceId: contract.contract_id,
    sourceVersion: contract.source_version,
    entitlementSnapshotId,
    evidenceSha256: immutableSha256,
    quotas: resolvedQuotas,
    activatedAt,
    contractId: contract.contract_id,
  })
}

async function grandfatheredSource(
  db: DbClient,
  organizationId: string,
  at: string,
): Promise<VerifiedQuotaSource | null> {
  const result = await db<SnapshotRow>`
    select s.snapshot_id,s.organization_id,s.source,s.source_id,s.quota_json,
      s.effective_at,s.immutable_sha256
    from fuma_entitlement_snapshots s
    join fuma_entitlement_assignments a
      on a.organization_id=s.organization_id and a.source=s.source and a.source_id=s.source_id
    where s.organization_id=${organizationId} and s.source='grandfathered'
      and a.state='active' and s.effective_at<=${at}
      and (s.expires_at is null or s.expires_at>${at})
    order by s.effective_at desc,s.snapshot_id desc limit 1
  `
  const row = result.rows[0]
  if (!row) return null
  return Object.freeze({
    organizationId,
    source: 'grandfathered',
    sourceId: row.source_id,
    sourceVersion: `sha256:${row.immutable_sha256}`,
    entitlementSnapshotId: row.snapshot_id,
    evidenceSha256: row.immutable_sha256,
    quotas: quotas(json(row.quota_json), 'grandfathered contract'),
    activatedAt: iso(row.effective_at),
    contractId: null,
  })
}

/** Resolves only protected grants, verified paid contracts, or active grandfathered snapshots. */
export async function resolveVerifiedQuotaSource(
  db: DbClient,
  organizationId: string,
  at: string,
): Promise<VerifiedQuotaSource> {
  const source = await internalSource(db, organizationId, at)
    ?? await contractSource(db, organizationId)
    ?? await grandfatheredSource(db, organizationId, at)
  if (!source) {
    throw new QuotaError(
      'unverified-contract',
      'Only verified contracts and protected grants activate quotas.',
    )
  }
  return source
}

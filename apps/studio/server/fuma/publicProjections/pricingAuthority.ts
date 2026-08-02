import {
  PublicPricingCatalogPageSchema,
  PublicPricingDisplayPlanSchema,
  type PublicPricingDisplayPlan,
} from '@fuma/public-contracts'
import { Value } from '@sinclair/typebox/value'
import type { DbClient } from '../../db/client'
import { PriceBookSchema, QUOTA_CLASSES, type PriceBook, type PricedPlan, type QuotaClass } from '../entitlements/contracts'
import { evidenceSha256 } from '../entitlements/economics'
import { METER_CLASSES } from '../metering/contracts'
import { PublicProjectionInvalidRequestError, PublicProjectionUnavailableError } from './authority'
import type { ApprovedPublicProjectionSource } from './adapters/validatedDomainAdapter'

const DEFAULT_PAGE_SIZE = 24
const MAX_PAGE_SIZE = 100
const PRICE_BOOK_MAX_AGE_MS = 35 * 24 * 60 * 60 * 1_000
const BYTE_QUOTAS = new Set<QuotaClass>(['storageBytes', 'bandwidthBytes', 'releaseRetentionBytes'])
const MINUTE_QUOTAS = new Set<QuotaClass>(['buildPublishMinutes', 'pluginComputeMinutes'])

interface PriceBookProjectionRow {
  version: string
  currency: string
  public_json: unknown
  effective_at: string | Date
  published_at: string | Date
  cost_model_version: string
  evidence_sha256: string
  private_json: unknown
}

function unavailable(detail: string): never {
  throw new PublicProjectionUnavailableError(`Pricing authority rejected ${detail}.`)
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) as unknown } catch { return null }
}

function iso(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) unavailable('a malformed timestamp')
  return date.toISOString()
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

async function datasetVersion(effectiveVersion: string | null, items: readonly PublicPricingDisplayPlan[]): Promise<string> {
  const source = new TextEncoder().encode(canonicalJson({ effectiveVersion, items }))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', source))
  return `pricing:sha256:${[...digest].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function quotaKey(value: QuotaClass): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

function quotaUnit(value: QuotaClass): PublicPricingDisplayPlan['quotas'][number]['unit'] {
  if (BYTE_QUOTAS.has(value)) return 'bytes'
  if (MINUTE_QUOTAS.has(value)) return 'minutes'
  if (value === 'aiCredits') return 'credits'
  return 'count'
}

function validInstant(value: string, label: string): number {
  const instant = Date.parse(value)
  if (!Number.isFinite(instant)) unavailable(`a malformed ${label}`)
  return instant
}

function samePairTerms(left: PricedPlan, right: PricedPlan): boolean {
  const comparable = (plan: PricedPlan) => ({
    planId: plan.planId,
    slug: plan.slug,
    name: plan.name,
    summary: plan.summary,
    profile: plan.profile,
    offeringClass: plan.offeringClass,
    quotas: plan.quotas,
    workloadAssumptions: plan.workloadAssumptions,
    featureKeys: plan.featureKeys,
    promotion: plan.promotion,
    checkoutAvailable: plan.checkoutAvailable,
    expiresAt: plan.expiresAt,
  })
  return canonicalJson(comparable(left)) === canonicalJson(comparable(right))
}

function assertApprovedBook(row: PriceBookProjectionRow, raw: unknown, nowMs: number): PriceBook {
  if (!Value.Check(PriceBookSchema, raw)) unavailable('malformed or incomplete-cost FUMA-054 evidence')
  const book = raw as PriceBook
  if (
    evidenceSha256(book) !== row.evidence_sha256
    || book.version !== row.version
    || book.currency !== row.currency
    || iso(book.effectiveAt) !== iso(row.effective_at)
    || iso(book.publishedAt) !== iso(row.published_at)
    || book.costModelVersion !== row.cost_model_version
    || canonicalJson(book.publicJson) !== canonicalJson(jsonValue(row.public_json))
  ) unavailable('inconsistent immutable publication evidence')

  const effectiveAt = validInstant(book.effectiveAt, 'price-book effective time')
  const publishedAt = validInstant(book.publishedAt, 'price-book publication time')
  if (effectiveAt > nowMs) unavailable('a not-yet-effective price book')
  if (publishedAt > nowMs) unavailable('a future publication timestamp')
  if (nowMs - publishedAt > PRICE_BOOK_MAX_AGE_MS) unavailable('stale publication evidence')

  const groups = new Map<string, PricedPlan[]>()
  for (const plan of book.plans) {
    const inputMeters = new Set(plan.economics.inputs.map(({ meter }) => meter))
    const expectedCostMinor = plan.economics.variableCostMinor + plan.economics.fixedSharedCostMinor
    const marginBasisPoints = Math.max(
      -1_000_000,
      Math.floor(((plan.amountMinor - expectedCostMinor) * 10_000) / plan.amountMinor),
    )
    const variableCogsBasisPoints = Math.ceil(
      (plan.economics.variableCostMinor * 10_000) / plan.amountMinor,
    )
    if (
      plan.economics.costModelVersion !== book.costModelVersion
      || plan.economics.inputs.length !== METER_CLASSES.length
      || inputMeters.size !== METER_CLASSES.length
      || METER_CLASSES.some((meter) => !inputMeters.has(meter))
    ) unavailable('incomplete-cost plan evidence')
    if (
      !Number.isSafeInteger(expectedCostMinor)
      || expectedCostMinor !== plan.economics.expectedCostMinor
      || marginBasisPoints !== plan.economics.marginBasisPoints
      || variableCogsBasisPoints !== plan.economics.variableCogsBasisPoints
    ) unavailable('inconsistent cost and margin evidence')
    if (marginBasisPoints < 7_000 || variableCogsBasisPoints > 3_000) {
      unavailable('margin-rejected plan evidence')
    }
    const plans = groups.get(plan.planId) ?? []
    plans.push(plan)
    groups.set(plan.planId, plans)
  }
  for (const plans of groups.values()) {
    const monthly = plans.filter((plan) => plan.cadence === 'monthly')
    const annual = plans.filter((plan) => plan.cadence === 'annual')
    if (monthly.length !== 1 || annual.length !== 1 || !samePairTerms(monthly[0]!, annual[0]!)) {
      unavailable('an incomplete monthly/annual cadence pair')
    }
  }
  return book
}

function displayPlans(book: PriceBook, nowMs: number): readonly PublicPricingDisplayPlan[] {
  if (book.publicJson.items.length !== book.plans.length) unavailable('an incomplete public plan document')
  const publicById = new Map(book.publicJson.items.map((item) => [item.id, item]))
  if (publicById.size !== book.publicJson.items.length) unavailable('duplicate public plan identities')

  const projected: PublicPricingDisplayPlan[] = []
  for (const plan of book.plans) {
    const item = publicById.get(`${plan.planId}_${plan.cadence}`)
    if (!item) unavailable('a missing public cadence plan')
    const exactPublicTerms = {
      id: `${plan.planId}_${plan.cadence}`,
      slug: plan.slug,
      name: plan.name,
      summary: plan.summary,
      profile: plan.profile,
      currency: book.currency,
      cadence: plan.cadence,
      amountMinor: plan.amountMinor,
      featureKeys: plan.featureKeys,
      promotion: plan.promotion,
      checkoutAvailable: plan.checkoutAvailable,
      effectiveAt: book.effectiveAt,
      expiresAt: plan.expiresAt,
    }
    for (const [key, value] of Object.entries(exactPublicTerms)) {
      if (canonicalJson(item[key as keyof typeof item]) !== canonicalJson(value)) unavailable(`mismatched public ${key}`)
    }
    if (item.quotas.length !== QUOTA_CLASSES.length) unavailable('an incomplete public quota set')
    for (const quotaClass of QUOTA_CLASSES) {
      const quota = item.quotas.find((candidate) => candidate.key === quotaKey(quotaClass))
      if (!quota || quota.limit !== plan.quotas[quotaClass] || quota.unit !== quotaUnit(quotaClass)) {
        unavailable(`mismatched public ${quotaClass} quota`)
      }
    }

    const expiresAt = plan.expiresAt === null ? Number.POSITIVE_INFINITY : validInstant(plan.expiresAt, 'plan expiry')
    if (expiresAt <= nowMs) continue
    let promotion = null
    if (plan.promotion) {
      const startsAt = validInstant(plan.promotion.startsAt, 'promotion start')
      const endsAt = validInstant(plan.promotion.endsAt, 'promotion expiry')
      if (startsAt >= endsAt) unavailable('an invalid promotion window')
      if (startsAt <= nowMs && endsAt > nowMs) promotion = plan.promotion
    }
    const candidate = Object.freeze({
      ...item,
      planId: plan.planId,
      promotion,
      checkoutAvailable: plan.offeringClass === 'paid' && plan.checkoutAvailable && plan.amountMinor > 0,
    })
    if (!Value.Check(PublicPricingDisplayPlanSchema, candidate)) unavailable('a malformed display projection')
    projected.push(candidate)
  }
  return Object.freeze(projected.toSorted((left, right) => left.id.localeCompare(right.id)))
}

function limitFor(query: Readonly<Record<string, string | number>>): number {
  const limit = query.limit ?? DEFAULT_PAGE_SIZE
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new PublicProjectionInvalidRequestError('Invalid pricing projection limit.')
  }
  return limit
}

function cursorOffset(query: Readonly<Record<string, string | number>>, version: string, itemCount: number): number {
  if (query.cursor === undefined) return 0
  if (typeof query.cursor !== 'string') throw new PublicProjectionInvalidRequestError('Invalid pricing cursor.')
  const match = /^p_([0-9]{1,3})_([a-f0-9]{16})$/.exec(query.cursor)
  const offset = match ? Number(match[1]) : Number.NaN
  if (!match || match[2] !== version.slice(-16) || !Number.isSafeInteger(offset) || offset < 1 || offset >= itemCount) {
    throw new PublicProjectionInvalidRequestError('Invalid or stale pricing cursor.')
  }
  return offset
}

/**
 * Ticket-owned public authority. It reads the newest current publication only and never falls
 * back to an older book when current immutable evidence is malformed or commercially rejected.
 */
export class ApprovedPricingProjectionSource implements ApprovedPublicProjectionSource {
  readonly #db: DbClient
  readonly #now: () => Date

  constructor(db: DbClient, now: () => Date = () => new Date()) {
    this.#db = db
    this.#now = now
  }

  async readApprovedDisplayPage(query: Readonly<Record<string, string | number>>) {
    const now = this.#now()
    if (!Number.isFinite(now.getTime())) unavailable('an invalid authority clock')
    const { rows } = await this.#db<PriceBookProjectionRow>`
      select p.version, p.currency, p.public_json, p.effective_at, p.published_at,
        e.cost_model_version, e.evidence_sha256, e.private_json
      from fuma_price_books p
      join fuma_price_book_evidence e on e.version = p.version
      where p.published_at is not null and p.effective_at <= ${now.toISOString()}
      order by p.effective_at desc, p.published_at desc, p.version desc
      limit 1
    `
    const row = rows[0]
    let effectiveVersion: string | null = null
    let allItems: readonly PublicPricingDisplayPlan[] = []
    if (row) {
      const book = assertApprovedBook(row, jsonValue(row.private_json), now.getTime())
      effectiveVersion = book.version
      allItems = displayPlans(book, now.getTime())
    }

    const filtered = allItems.filter((item) => (
      (query.profile === undefined || item.profile === query.profile)
      && (query.cadence === undefined || item.cadence === query.cadence)
    ))
    const version = await datasetVersion(effectiveVersion, allItems)
    const offset = cursorOffset(query, version, filtered.length)
    const items = filtered.slice(offset, offset + limitFor(query))
    const nextOffset = offset + items.length
    const page = nextOffset < filtered.length
      ? Object.freeze({ hasMore: true as const, nextCursor: `p_${nextOffset}_${version.slice(-16)}` })
      : Object.freeze({ hasMore: false as const, nextCursor: null })
    const data = Object.freeze({ effectiveVersion, items: Object.freeze(items), page })
    if (!Value.Check(PublicPricingCatalogPageSchema, data)) unavailable('an invalid pricing page')
    return Object.freeze({ datasetVersion: version, data })
  }
}

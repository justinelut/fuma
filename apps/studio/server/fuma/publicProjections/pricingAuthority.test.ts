import { describe, expect, test } from 'bun:test'
import { PublicPricingCatalogPageSchema } from '@fuma/public-contracts'
import { Value } from '@sinclair/typebox/value'
import type { DbClient, DbResult } from '../../db/client'
import { QUOTA_CLASSES, type PriceBook, type PricedPlan, type QuotaClass } from '../entitlements/contracts'
import { evidenceSha256 } from '../entitlements/economics'
import { METER_CLASSES } from '../metering/contracts'
import { PublicProjectionInvalidRequestError, PublicProjectionUnavailableError } from './authority'
import { ApprovedPricingProjectionSource } from './pricingAuthority'

const NOW = new Date('2026-07-27T12:00:00.000Z')
const COST_MODEL = `cost-model:sha256:${'a'.repeat(64)}`
const LABELS: Record<QuotaClass, string> = {
  sites: 'Sites', pages: 'Pages', cmsItems: 'CMS items', members: 'Members', storageBytes: 'Storage',
  bandwidthBytes: 'Bandwidth', emailRecipientsDay: 'Email recipients per day', emailRecipientsMonth: 'Email recipients per month',
  buildPublishMinutes: 'Build and publish minutes', pluginComputeMinutes: 'Plugin compute minutes', aiCredits: 'AI credits',
  releaseRetentionBytes: 'Release retention', collaborators: 'Collaborators', customDomains: 'Custom domains',
}

const quotas = Object.freeze(Object.fromEntries(QUOTA_CLASSES.map((key, index) => [key, index + 1]))) as PricedPlan['quotas']
const assumptions = Object.freeze(Object.fromEntries(METER_CLASSES.map((meter) => [meter, 1]))) as PricedPlan['workloadAssumptions']
const inputs = Object.freeze(METER_CLASSES.map((meter) => ({ meter, version: 'cost-v1', source: 'invoice' as const })))

function quotaKey(value: QuotaClass): string { return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`) }
function quotaUnit(value: QuotaClass) {
  if (['storageBytes', 'bandwidthBytes', 'releaseRetentionBytes'].includes(value)) return 'bytes' as const
  if (['buildPublishMinutes', 'pluginComputeMinutes'].includes(value)) return 'minutes' as const
  return value === 'aiCredits' ? 'credits' as const : 'count' as const
}

function economics(
  amountMinor: number,
  variableCostMinor = 10_000,
  fixedSharedCostMinor = 10_000,
): PricedPlan['economics'] {
  const expectedCostMinor = variableCostMinor + fixedSharedCostMinor
  return {
    costModelVersion: COST_MODEL,
    conversionVersion: 'fx-v1',
    variableCostMinor,
    fixedSharedCostMinor,
    expectedCostMinor,
    marginBasisPoints: Math.max(-1_000_000, Math.floor(((amountMinor - expectedCostMinor) * 10_000) / amountMinor)),
    variableCogsBasisPoints: Math.ceil((variableCostMinor * 10_000) / amountMinor),
    inputs,
  }
}

function plan(cadence: 'monthly' | 'annual', amountMinor: number, overrides: Partial<PricedPlan> = {}): PricedPlan {
  return {
    planId: 'launch', slug: 'launch', name: 'Launch', summary: 'A publish-approved launch plan.', profile: 'website',
    cadence, amountMinor, offeringClass: 'paid', quotas, workloadAssumptions: assumptions, featureKeys: ['custom-domain'],
    promotion: { label: 'Launch window', startsAt: '2026-07-01T00:00:00.000Z', endsAt: '2026-07-28T00:00:00.000Z' },
    checkoutAvailable: true, expiresAt: null,
    economics: economics(amountMinor),
    ...overrides,
  }
}

function publicItem(value: PricedPlan, effectiveAt: string) {
  return {
    id: `${value.planId}_${value.cadence}`, slug: value.slug, name: value.name, summary: value.summary,
    profile: value.profile, currency: 'KES' as const, cadence: value.cadence, amountMinor: value.amountMinor,
    featureKeys: value.featureKeys,
    quotas: QUOTA_CLASSES.map((key) => ({ key: quotaKey(key), label: LABELS[key], limit: value.quotas[key], unit: quotaUnit(key) })),
    promotion: value.promotion, checkoutAvailable: value.checkoutAvailable, effectiveAt, expiresAt: value.expiresAt,
  }
}

function book(version: string, monthlyMinor: number, overrides: Partial<PriceBook> = {}): PriceBook {
  const effectiveAt = '2026-07-01T00:00:00.000Z'
  const plans = [plan('monthly', monthlyMinor), plan('annual', monthlyMinor * 10)] as const
  return {
    version, currency: 'KES', effectiveAt, publishedAt: '2026-07-01T00:00:01.000Z', costModelVersion: COST_MODEL,
    plans, publicJson: { items: plans.map((value) => publicItem(value, effectiveAt)) }, ...overrides,
  }
}

function row(value: PriceBook, privateJson: unknown = value) {
  return {
    version: value.version, currency: value.currency, public_json: value.publicJson, effective_at: value.effectiveAt,
    published_at: value.publishedAt, cost_model_version: value.costModelVersion,
    evidence_sha256: evidenceSha256(privateJson), private_json: privateJson,
  }
}

function mutableDb(state: { rows: Record<string, unknown>[] }): DbClient {
  const query = (async <Row>(): Promise<DbResult<Row>> => ({
    rows: structuredClone(state.rows) as Row[], rowCount: state.rows.length,
  })) as DbClient
  query.unsafe = async () => ({ rows: [], rowCount: 0 })
  query.transaction = async (work) => work(query)
  return Object.assign(query, { dialect: 'postgres' as const })
}

describe('FUMA-WEB-009 approved pricing projection authority', () => {
  test('demo: publishes, switches, and withdraws fixture books without Web content edits', async () => {
    const first = book('ke-2026-07-v1', 250_000)
    const second = book('ke-2026-08-v2', 300_000)
    const state = { rows: [row(first)] }
    const authority = new ApprovedPricingProjectionSource(mutableDb(state), () => NOW)

    const published = await authority.readApprovedDisplayPage({ cadence: 'monthly' })
    expect(Value.Check(PublicPricingCatalogPageSchema, published.data)).toBe(true)
    expect(published.data.effectiveVersion).toBe(first.version)
    expect(published.data.items.map(({ amountMinor }) => amountMinor)).toEqual([250_000])

    state.rows = [row(second)]
    const switched = await authority.readApprovedDisplayPage({ cadence: 'monthly' })
    expect(switched.data.effectiveVersion).toBe(second.version)
    expect(switched.data.items.map(({ amountMinor }) => amountMinor)).toEqual([300_000])
    expect(switched.datasetVersion).not.toBe(published.datasetVersion)

    state.rows = []
    const withdrawn = await authority.readApprovedDisplayPage({})
    expect(withdrawn.data).toEqual({ effectiveVersion: null, items: [], page: { hasMore: false, nextCursor: null } })
    expect(withdrawn.datasetVersion).not.toBe(switched.datasetVersion)
    process.stdout.write('[FUMA-WEB-009 demo] published=250000 switched=300000 withdrawn=true webContentEdits=0\n')
  })

  test('publishes exact KES integer math, both cadences, quotas, features, and an active promotion', async () => {
    const authority = new ApprovedPricingProjectionSource(mutableDb({ rows: [row(book('book-v1', 250_000))] }), () => NOW)
    const result = await authority.readApprovedDisplayPage({})
    expect(result.data.items.map(({ cadence, amountMinor }) => [cadence, amountMinor])).toEqual([
      ['annual', 2_500_000], ['monthly', 250_000],
    ])
    expect(result.data.items.every(({ currency, planId, quotas: visible, featureKeys }) => (
      currency === 'KES' && planId === 'launch' && visible.length === 14 && featureKeys.includes('custom-domain')
    ))).toBe(true)
    expect(result.data.items.every(({ promotion }) => promotion?.label === 'Launch window')).toBe(true)
  })

  test('expires promotions and plans at the exact half-open boundary and suppresses non-paid checkout', async () => {
    const source = book('book-expiry', 250_000)
    const expiredPromotion = new ApprovedPricingProjectionSource(mutableDb({ rows: [row(source)] }), () => new Date('2026-07-28T00:00:00.000Z'))
    expect((await expiredPromotion.readApprovedDisplayPage({})).data.items.every(({ promotion }) => promotion === null)).toBe(true)

    const expiredPlans = source.plans.map((value) => ({ ...value, expiresAt: '2026-07-27T12:00:00.000Z' }))
    const expiredBook = book('book-plan-expiry', 250_000, {
      plans: expiredPlans,
      publicJson: { items: expiredPlans.map((value) => publicItem(value, source.effectiveAt)) },
    })
    expect((await new ApprovedPricingProjectionSource(mutableDb({ rows: [row(expiredBook)] }), () => NOW).readApprovedDisplayPage({})).data.items).toEqual([])

    const starterPlans = source.plans.map((value) => ({ ...value, offeringClass: 'fuma-funded-starter' as const }))
    const starter = book('book-starter', 250_000, {
      plans: starterPlans,
      publicJson: { items: starterPlans.map((value) => publicItem(value, source.effectiveAt)) },
    })
    const visible = await new ApprovedPricingProjectionSource(mutableDb({ rows: [row(starter)] }), () => NOW).readApprovedDisplayPage({})
    expect(visible.data.items.every(({ checkoutAvailable }) => checkoutAvailable === false)).toBe(true)
  })

  test('fails closed on malformed, incomplete-cost, margin-rejected, mismatched, and private-field evidence', async () => {
    const valid = book('book-hostile', 250_000)
    const badMarginPlans = valid.plans.map((value) => ({
      ...value,
      economics: economics(value.amountMinor, Math.floor(value.amountMinor * 0.2), Math.floor(value.amountMinor * 0.11)),
    }))
    const badMargin = book('book-margin', 250_000, {
      plans: badMarginPlans,
      publicJson: { items: badMarginPlans.map((value) => publicItem(value, valid.effectiveAt)) },
    })
    const duplicateInputs = inputs.map((input, index) => index === inputs.length - 1 ? inputs[0]! : input)
    const hostile = [
      row(valid, { ...valid, paystackPlanId: 'PLN_secret' }),
      row(valid, { ...valid, plans: valid.plans.map((value) => ({ ...value, economics: { ...value.economics, inputs: [] } })) }),
      row(valid, { ...valid, plans: valid.plans.map((value) => ({ ...value, economics: { ...value.economics, inputs: duplicateInputs } })) }),
      row(badMargin),
      { ...row(valid), public_json: { items: valid.publicJson.items.map((value) => ({ ...value, amountMinor: 1 })) } },
      { ...row(valid), cost_model_version: `cost-model:sha256:${'b'.repeat(64)}` },
      { ...row(valid), evidence_sha256: 'b'.repeat(64) },
      row(valid, {
        ...valid,
        plans: valid.plans.map((value) => ({
          ...value,
          economics: { ...value.economics, expectedCostMinor: 1, marginBasisPoints: 9_999 },
        })),
      }),
    ]
    for (const latest of hostile) {
      const authority = new ApprovedPricingProjectionSource(mutableDb({ rows: [latest, row(valid)] }), () => NOW)
      await expect(authority.readApprovedDisplayPage({})).rejects.toBeInstanceOf(PublicProjectionUnavailableError)
    }
  })

  test('fails closed when the newest publication evidence is stale and never falls back', async () => {
    const stale = book('book-stale', 250_000, {
      publishedAt: '2026-05-01T00:00:00.000Z',
    })
    const current = book('book-current', 250_000)
    const authority = new ApprovedPricingProjectionSource(mutableDb({ rows: [row(stale), row(current)] }), () => NOW)
    await expect(authority.readApprovedDisplayPage({})).rejects.toBeInstanceOf(PublicProjectionUnavailableError)
  })

  test('binds cursors to the current dataset and never accepts a stale version cursor', async () => {
    const first = book('cursor-v1', 250_000)
    const state = { rows: [row(first)] }
    const authority = new ApprovedPricingProjectionSource(mutableDb(state), () => NOW)
    const page = await authority.readApprovedDisplayPage({ limit: 1 })
    expect(page.data.page.hasMore).toBe(true)
    const cursor = page.data.page.nextCursor!
    expect((await authority.readApprovedDisplayPage({ limit: 1, cursor })).data.items).toHaveLength(1)

    state.rows = [row(book('cursor-v2', 300_000))]
    await expect(authority.readApprovedDisplayPage({ limit: 1, cursor })).rejects.toBeInstanceOf(PublicProjectionInvalidRequestError)
  })

  test('projects no private commercial or provider fields', async () => {
    const result = await new ApprovedPricingProjectionSource(mutableDb({ rows: [row(book('safe-v1', 250_000))] }), () => NOW).readApprovedDisplayPage({})
    const text = JSON.stringify(result)
    expect(text).not.toMatch(/paystack|private.?offer|setup|organization|grant|cogs|margin|payment|transfer|secret/i)
  })
})

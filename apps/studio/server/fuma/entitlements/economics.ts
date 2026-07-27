import { Value } from '@core/utils/typeboxHelpers'
import { PublicPricingPlanSchema, type PublicPricingPlan, type PublicPricingQuota } from '@fuma/public-contracts'
import { METER_CLASSES } from '../metering/contracts'
import {
  EconomicsEvidenceSchema,
  QUOTA_CLASSES,
  WorkloadAssumptionsSchema,
  type EconomicsEvidence,
  type EntitlementCostCatalog,
  type PlanDefinition,
  type QuotaClass,
  type QuotaEnvelope,
  type WorkloadAssumptions,
} from './contracts'

export class EntitlementEconomicsError extends Error {
  readonly code: 'invalid' | 'incomplete-cost' | 'margin'
  constructor(code: EntitlementEconomicsError['code'], message: string) {
    super(message)
    this.name = 'EntitlementEconomicsError'
    this.code = code
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

export function evidenceSha256(value: unknown): string {
  return new Bun.CryptoHasher('sha256').update(canonicalJson(value)).digest('hex')
}

function convertMicros(converter: (usdMicros: bigint) => number, value: bigint, label: string): number {
  const converted = converter(value)
  if (!Number.isSafeInteger(converted) || converted < 0 || converted > 1_000_000_000) {
    throw new EntitlementEconomicsError('incomplete-cost', `${label} FX conversion is unavailable or unsafe.`)
  }
  return converted
}

export async function calculateEconomics(
  catalog: EntitlementCostCatalog,
  converter: (usdMicros: bigint) => number,
  revenueMinor: number,
  rawAssumptions: unknown,
): Promise<EconomicsEvidence> {
  if (!Number.isSafeInteger(revenueMinor) || revenueMinor < 0 || revenueMinor > 1_000_000_000) {
    throw new EntitlementEconomicsError('invalid', 'Revenue must be a non-negative KES minor-unit integer.')
  }
  if (!Value.Check(WorkloadAssumptionsSchema, rawAssumptions)) {
    throw new EntitlementEconomicsError('incomplete-cost', 'Workload assumptions must contain exactly every physical meter.')
  }
  const assumptions = rawAssumptions as WorkloadAssumptions
  await catalog.assertComplete(METER_CLASSES)
  let variableMicros = 0n
  let fixedMicros = 0n
  const inputs: EconomicsEvidence['inputs'][number][] = []
  for (const meter of METER_CLASSES) {
    const quote = await catalog.cost(meter, assumptions[meter])
    if (!quote.version || !['invoice', 'quote', 'published-baseline'].includes(quote.source)) {
      throw new EntitlementEconomicsError('incomplete-cost', `Cost authority for ${meter} omitted immutable source evidence.`)
    }
    variableMicros += quote.variable
    fixedMicros += quote.fixed
    inputs.push(Object.freeze({ meter, version: quote.version, source: quote.source }))
  }
  const variableCostMinor = convertMicros(converter, variableMicros, 'Variable cost')
  const fixedSharedCostMinor = convertMicros(converter, fixedMicros, 'Fixed/shared cost')
  const expectedCostMinor = variableCostMinor + fixedSharedCostMinor
  if (!Number.isSafeInteger(expectedCostMinor) || expectedCostMinor > 1_000_000_000) {
    throw new EntitlementEconomicsError('incomplete-cost', 'Expected cost exceeds bounded KES minor-unit storage.')
  }
  const costModelVersion = `cost-model:sha256:${evidenceSha256(inputs)}`
  const marginBasisPoints = revenueMinor === 0
    ? (expectedCostMinor === 0 ? 10_000 : -1_000_000)
    : Math.max(-1_000_000, Math.floor(((revenueMinor - expectedCostMinor) * 10_000) / revenueMinor))
  const variableCogsBasisPoints = revenueMinor === 0
    ? (variableCostMinor === 0 ? 0 : 1_000_000)
    : Math.ceil((variableCostMinor * 10_000) / revenueMinor)
  const evidence = Object.freeze({
    costModelVersion,
    variableCostMinor,
    fixedSharedCostMinor,
    expectedCostMinor,
    marginBasisPoints,
    variableCogsBasisPoints,
    inputs: Object.freeze(inputs),
  })
  if (!Value.Check(EconomicsEvidenceSchema, evidence)) {
    throw new EntitlementEconomicsError('incomplete-cost', 'Calculated economics evidence failed its strict schema.')
  }
  return evidence
}

export function assertLaunchEconomics(evidence: EconomicsEvidence, label: string): void {
  if (evidence.variableCogsBasisPoints > 3_000) {
    throw new EntitlementEconomicsError('margin', `${label} expected variable COGS exceeds 30% of net revenue.`)
  }
  if (evidence.marginBasisPoints < 7_000) {
    throw new EntitlementEconomicsError('margin', `${label} expected gross margin is below 70%.`)
  }
}

export function assertFiniteQuotas(quotas: unknown, offeringClass?: PlanDefinition['offeringClass']): asserts quotas is QuotaEnvelope {
  if (typeof quotas !== 'object' || quotas === null) throw new EntitlementEconomicsError('invalid', 'Every quota class must be explicit and finite.')
  const keys = Object.keys(quotas).sort()
  if (keys.join('|') !== [...QUOTA_CLASSES].sort().join('|')) throw new EntitlementEconomicsError('invalid', 'Every quota class must be explicit and finite.')
  for (const quotaClass of QUOTA_CLASSES) {
    const value = (quotas as Record<string, unknown>)[quotaClass]
    if (!Number.isSafeInteger(value) || (value as number) < 1) throw new EntitlementEconomicsError('invalid', `Quota ${quotaClass} must be a finite positive integer.`)
  }
  const bounded = quotas as QuotaEnvelope
  if ((offeringClass === 'fuma-funded-starter' || offeringClass === 'fuma-funded-trial')
    && (bounded.emailRecipientsDay > 100 || bounded.emailRecipientsMonth > 3_000)) {
    throw new EntitlementEconomicsError('invalid', 'Fuma-funded starter/trial email caps are 100/day and 3,000/month.')
  }
}

const QUOTA_LABELS: Readonly<Record<QuotaClass, string>> = Object.freeze({
  sites: 'Sites', pages: 'Pages', cmsItems: 'CMS items', members: 'Members', storageBytes: 'Storage',
  bandwidthBytes: 'Bandwidth', emailRecipientsDay: 'Email recipients per day', emailRecipientsMonth: 'Email recipients per month',
  buildPublishMinutes: 'Build and publish minutes', pluginComputeMinutes: 'Plugin compute minutes', aiCredits: 'AI credits',
  releaseRetentionBytes: 'Release retention', collaborators: 'Collaborators', customDomains: 'Custom domains',
})
const BYTE_QUOTAS = new Set<QuotaClass>(['storageBytes', 'bandwidthBytes', 'releaseRetentionBytes'])
const MINUTE_QUOTAS = new Set<QuotaClass>(['buildPublishMinutes', 'pluginComputeMinutes'])

function quotaKey(value: QuotaClass): string { return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`) }
function quotaUnit(value: QuotaClass): PublicPricingQuota['unit'] {
  if (BYTE_QUOTAS.has(value)) return 'bytes'
  if (MINUTE_QUOTAS.has(value)) return 'minutes'
  if (value === 'aiCredits') return 'credits'
  return 'count'
}

export function toPublicPricingPlan(plan: PlanDefinition, effectiveAt: string): PublicPricingPlan {
  const quotas = QUOTA_CLASSES.map((quotaClass) => ({
    key: quotaKey(quotaClass), label: QUOTA_LABELS[quotaClass], limit: plan.quotas[quotaClass], unit: quotaUnit(quotaClass),
  }))
  const candidate = Object.freeze({
    id: `${plan.planId}_${plan.cadence}`,
    slug: plan.slug,
    name: plan.name,
    summary: plan.summary,
    profile: plan.profile,
    currency: 'KES' as const,
    cadence: plan.cadence,
    amountMinor: plan.amountMinor,
    featureKeys: plan.featureKeys,
    quotas,
    promotion: plan.promotion,
    checkoutAvailable: plan.checkoutAvailable,
    effectiveAt,
    expiresAt: plan.expiresAt,
  })
  if (!Value.Check(PublicPricingPlanSchema, candidate)) {
    throw new EntitlementEconomicsError('invalid', 'Public plan projection failed the strict shared contract.')
  }
  return candidate
}

export function samePlanPair(left: PlanDefinition, right: PlanDefinition): boolean {
  const normalize = (plan: PlanDefinition) => ({
    planId: plan.planId, slug: plan.slug, name: plan.name, summary: plan.summary, profile: plan.profile,
    offeringClass: plan.offeringClass, quotas: plan.quotas, workloadAssumptions: plan.workloadAssumptions,
    featureKeys: plan.featureKeys, promotion: plan.promotion, checkoutAvailable: plan.checkoutAvailable, expiresAt: plan.expiresAt,
  })
  return canonicalJson(normalize(left)) === canonicalJson(normalize(right))
}

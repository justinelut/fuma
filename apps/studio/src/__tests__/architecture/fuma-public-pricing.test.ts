import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

describe('FUMA-WEB-009 public pricing architecture', () => {
  test('keeps display projection in Studio and presentation in Web behind strict public contracts', () => {
    const authority = read('server/fuma/publicProjections/pricingAuthority.ts')
    const contracts = read('../../packages/public-contracts/src/projections.ts')
    const web = read('../web/components/pricing-catalog.tsx')
    expect(authority).toContain('class ApprovedPricingProjectionSource')
    expect(authority).toContain('PriceBookSchema')
    expect(contracts).toContain('PublicPricingCatalogPageSchema = Type.Union')
    expect(web).toContain("from '@fuma/public-contracts'")
    expect(web).not.toMatch(/apps\/studio|@studio|server\/fuma/)
  })

  test('validates immutable complete-cost economics and never falls back to an older publication', () => {
    const authority = read('server/fuma/publicProjections/pricingAuthority.ts')
    for (const evidence of [
      'evidenceSha256(book) !== row.evidence_sha256',
      'plan.economics.inputs.length !== METER_CLASSES.length',
      'expectedCostMinor !== plan.economics.expectedCostMinor',
      'marginBasisPoints < 7_000',
      'variableCogsBasisPoints > 3_000',
      'limit 1',
    ]) expect(authority).toContain(evidence)
    expect(authority).not.toMatch(/rows\.slice\(1\)|for \(const row of rows\)|fallback/i)
  })

  test('projects no private/provider/commercial state through the strict display contract', () => {
    const contracts = read('../../packages/public-contracts/src/projections.ts')
    const display = contracts.slice(
      contracts.indexOf('PublicPricingPlanSchema ='),
      contracts.indexOf('PublicTemplateImageSchema ='),
    )
    for (const field of [
      'providerPlanId', 'privateOffer', 'setupFee', 'organizationId', 'internalGrant',
      'costModelVersion', 'marginBasisPoints', 'paymentState', 'transferState',
    ]) expect(display).not.toContain(field)
  })

  test('passes only opaque plan coordinates and app checkout re-resolves current exact authority', () => {
    const handoff = read('../../packages/public-contracts/src/handoff.ts')
    const webIntent = read('../web/lib/public-data.ts')
    const checkout = read('server/fuma/checkout/postgres.ts')
    expect(handoff).toContain("kind: Type.Literal('choose_plan')")
    const planIntent = webIntent.slice(webIntent.indexOf('export function pricingPlanIntentHref'), webIntent.indexOf('export function isImmutableTemplatePreview'))
    for (const field of ['planId', 'priceBookVersion', 'cadence']) expect(planIntent).toContain(field)
    expect(planIntent).not.toMatch(/amountMinor|provider|margin|costModel|payment/)
    expect(checkout).toContain('current.rows[0]?.version !== source.priceBookVersion')
    expect(checkout).toContain('candidate.planId === source.planId && candidate.cadence === source.cadence')
    expect(checkout).toContain('!plan.checkoutAvailable')
    expect(checkout).toContain("plan.offeringClass !== 'paid'")
  })

  test('keeps pricing cache disabled so switch and withdrawal cannot serve retained amounts', () => {
    const studio = read('server/fuma/publicProjections/specs.ts')
    const web = read('../web/lib/public-projections.ts')
    expect(studio).toMatch(/pricing:[\s\S]*cacheTtlMs: 0,[\s\S]*cacheControl: IMMEDIATE_INVALIDATION/)
    expect(web).toContain("pricing: 'no-store'")
  })
})

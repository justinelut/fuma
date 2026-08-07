/**
 * Cost provenance — making a placeholder unusable for a margin claim.
 *
 * costBaseline's own comment says its UNIT_COSTS are "deliberately nonzero fail-closed launch
 * assumptions, not invoice claims", yet every entry it emits carries `source: 'published-baseline'`,
 * which reads as authoritative downstream. So a margin computed today is arithmetic on placeholders and
 * the number is indistinguishable from one backed by an invoice.
 *
 * Tasks 104/106 are blocked on measured OCI figures, which is a DATA problem. This is not: a refusal
 * that cannot be bypassed by failing to read a comment needs no new data.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  COST_PROVENANCE,
  marginClaimReadiness,
  implausibleUnitCosts,
} from '../../../server/fuma/metering/costProvenance'
import { METER_CLASSES } from '../../../server/fuma/metering/contracts'
import { HOSTED_COST_BASELINE_V1 } from '../../../server/fuma/metering/costBaseline'

const BASELINE_SOURCE = readFileSync(
  join(import.meta.dir, '..', '..', '..', 'server/fuma/metering/costBaseline.ts'), 'utf8')

/** The shipped unit costs, read from the baseline the platform actually uses. */
const SHIPPED_UNIT_COSTS = Object.fromEntries(
  HOSTED_COST_BASELINE_V1.map((entry) => [entry.meter, entry.unitCostMinorUsdMicros]),
) as Record<(typeof METER_CLASSES)[number], number>

describe('the risk this closes is real, evidenced from the shipped file', () => {
  it('the baseline calls its own figures assumptions', () => {
    expect(BASELINE_SOURCE).toContain('not invoice claims')
  })

  it('yet stamps every entry as a published baseline', () => {
    // This is the mismatch: the comment says assumption, the DATA says published, and only the data
    // travels to a consumer.
    expect(BASELINE_SOURCE).toContain("source: 'published-baseline'")
    expect(HOSTED_COST_BASELINE_V1.every((entry) => entry.source === 'published-baseline')).toBe(true)
  })
})

describe('provenance covers every meter', () => {
  it('classifies all of them, so none is silently unclassified', () => {
    // A meter absent from the map would read as undefined and pass a truthiness check somewhere.
    for (const meter of METER_CLASSES) {
      expect(COST_PROVENANCE[meter], meter).toBeDefined()
    }
  })

  it('reports every meter as ASSUMED, which is the honest state today', () => {
    // Nothing here has been reconciled against a provider invoice. Moving one to 'measured' is a
    // deliberate, reviewable edit.
    expect(Object.values(COST_PROVENANCE).every((value) => value === 'assumed')).toBe(true)
  })
})

describe('a margin claim is REFUSED while any cost is assumed', () => {
  it('refuses across the whole meter set', () => {
    const readiness = marginClaimReadiness()
    expect(readiness.ready).toBe(false)
    if (readiness.ready) return
    // The blocking meters are listed, so the work needed is a list rather than a mood.
    expect(readiness.assumedMeters.length).toBe(METER_CLASSES.length)
    expect(readiness.reason).toContain('placeholders')
  })

  it('refuses for a single assumed meter too, not only in bulk', () => {
    const readiness = marginClaimReadiness(['origin_bandwidth_bytes'])
    expect(readiness.ready).toBe(false)
  })

  it('does NOT report a margin with a caveat', () => {
    // A caveat travels separately from the number and is dropped the first time somebody copies the
    // figure into a slide. So the answer is a refusal, not a qualified value.
    const readiness = marginClaimReadiness()
    expect('margin' in readiness).toBe(false)
    expect('value' in readiness).toBe(false)
  })

  it('would report ready for an empty meter set, so the refusal is about the DATA not a blanket no', () => {
    // A function that always refuses is a slogan rather than a check.
    expect(marginClaimReadiness([]).ready).toBe(true)
  })
})

describe('the plausibility check catches the figure that motivated it', () => {
  it('flags the shipped bandwidth assumption', () => {
    const problems = implausibleUnitCosts(SHIPPED_UNIT_COSTS)
    const bandwidth = problems.find((problem) => problem.meter === 'origin_bandwidth_bytes')
    // 2 micro-cents per BYTE is USD 20.00/GB against roughly USD 0.0085/GB published for OCI egress.
    // Nothing reported this before; the comment was the only warning.
    expect(bandwidth).toBeDefined()
    expect(bandwidth!.factor).toBeGreaterThan(1000)
  })

  it('states the consequence rather than only the number', () => {
    const problems = implausibleUnitCosts(SHIPPED_UNIT_COSTS)
    // A reader needs to know why it matters: a plan priced from this either refuses a sound tier or
    // prices the product for a customer who does not exist.
    expect(problems[0]!.message).toContain('customer who does not exist')
    expect(problems[0]!.factor).toBeGreaterThan(0)
  })

  it('flags the storage assumptions too, which are wrong the same way', () => {
    const flagged = implausibleUnitCosts(SHIPPED_UNIT_COSTS).map((problem) => problem.meter)
    expect(flagged).toContain('storage_source_bytes')
  })

  it('accepts a figure AT its reference, so the check is not a blanket alarm', () => {
    // A check that flags everything gets switched off and is then not there when it matters.
    const plausible = { ...SHIPPED_UNIT_COSTS, origin_bandwidth_bytes: 0.00079 }
    const flagged = implausibleUnitCosts(plausible).map((problem) => problem.meter)
    expect(flagged).not.toContain('origin_bandwidth_bytes')
  })

  it('flags a figure that is implausibly LOW as well as high', () => {
    // Under-costing is the more dangerous direction: it produces a margin that looks healthy and a
    // plan that loses money on every unit.
    const tooLow = { ...SHIPPED_UNIT_COSTS, storage_source_bytes: 0.0000001 }
    const flagged = implausibleUnitCosts(tooLow).map((problem) => problem.meter)
    expect(flagged).toContain('storage_source_bytes')
  })

  it('says nothing about meters with no published reference', () => {
    // Inventing a reference for ai_credits or build milliseconds would report a difference against a
    // number nobody can stand behind - exactly the fault this module exists to prevent.
    const flagged = implausibleUnitCosts(SHIPPED_UNIT_COSTS).map((problem) => problem.meter)
    expect(flagged).not.toContain('ai_credits')
    expect(flagged).not.toContain('build_publish_milliseconds')
  })
})

describe('the refusal is CONSUMED, not merely available', () => {
  it('plan publishing derives its refusal from the provenance check', () => {
    const planSeed = readFileSync(
      join(import.meta.dir, '..', '..', '..', 'server/fuma/entitlements/planSeed.ts'), 'utf8')
    // Derived rather than restated, so the day a meter is genuinely reconciled this stops refusing on
    // its own instead of waiting for somebody to remember a hard-coded `false` exists.
    expect(planSeed).toContain('marginClaimReadiness()')
    expect(planSeed).toContain("from '../metering/costProvenance'")
  })

  it('and it still refuses today, for the stated reason', async () => {
    const { reviewPublishReadiness } = await import('../../../server/fuma/entitlements/planSeed')
    const readiness = reviewPublishReadiness()
    expect(readiness.ready).toBe(false)
    expect(readiness.reason.length).toBeGreaterThan(20)
  })
})

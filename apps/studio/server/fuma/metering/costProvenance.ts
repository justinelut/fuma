/**
 * Whether a cost figure is MEASURED or merely ASSUMED, and what may be claimed from it.
 *
 * THE RISK THIS CLOSES. costBaseline's own comment says its UNIT_COSTS are "deliberately nonzero
 * fail-closed launch assumptions, not invoice claims" — but every entry it emits carries
 * `source: 'published-baseline'`, which reads as authoritative to anything downstream. So a margin
 * computed today is arithmetic on placeholders, and the number it prints is indistinguishable from one
 * backed by an invoice. Somebody quotes it in a plan, a pitch or a price, and nothing in the code ever
 * said not to.
 *
 * Tasks 104 and 106 are blocked on measured OCI figures, which is a DATA problem. This is not: making
 * a placeholder unusable for a margin claim needs no new data, only a refusal that cannot be bypassed
 * by not reading a comment.
 */
import { METER_CLASSES, type MeterClass } from './contracts'

export type CostProvenance = 'assumed' | 'measured'

/**
 * Per-meter provenance.
 *
 * EVERY meter is 'assumed' today, and that is the honest state rather than a placeholder of its own:
 * nothing in this repository has been reconciled against a provider invoice. Moving one to 'measured'
 * is a deliberate, reviewable edit that names what it was measured against.
 */
export const COST_PROVENANCE: Readonly<Record<MeterClass, CostProvenance>> = Object.freeze(
  Object.fromEntries(METER_CLASSES.map((meter) => [meter, 'assumed' as const])),
) as Readonly<Record<MeterClass, CostProvenance>>

export type ClaimRefusal = Readonly<{
  ready: false
  /** Which meters block the claim, so the work needed is a list rather than a mood. */
  assumedMeters: readonly MeterClass[]
  reason: string
}>

export type ClaimReady = Readonly<{ ready: true }>

/**
 * Whether a margin claim may be made about these meters.
 *
 * REFUSES while ANY of them is assumed, rather than reporting a margin with a caveat. A caveat travels
 * separately from the number and is dropped the first time somebody copies the figure into a slide.
 */
export function marginClaimReadiness(
  meters: readonly MeterClass[] = METER_CLASSES,
): ClaimReady | ClaimRefusal {
  const assumed = meters.filter((meter) => COST_PROVENANCE[meter] === 'assumed')
  if (assumed.length === 0) return Object.freeze({ ready: true as const })
  return Object.freeze({
    ready: false as const,
    assumedMeters: Object.freeze([...assumed]),
    reason:
      `${assumed.length} of ${meters.length} meters carry ASSUMED unit costs, so any margin computed `
      + 'from them is arithmetic on placeholders. Reconcile them against a provider invoice before '
      + 'quoting a margin.',
  })
}

/**
 * A published reference cost per unit, in minor-USD micros, for the meters where one exists.
 *
 * Present so an absurd assumption is caught mechanically rather than by somebody noticing. The
 * bandwidth figure is the case that motivated this: the baseline assumes 2 micro-cents per BYTE, which
 * is USD 20.00 per GB against roughly USD 0.0085 per GB published for OCI egress — about 2,350x. A
 * plan priced from that either refuses a sound tier or prices the product for a customer who does not
 * exist, and nothing reported a problem.
 */
const REFERENCE_UNIT_COSTS: Partial<Readonly<Record<MeterClass, number>>> = Object.freeze({
  // 0.0085 USD/GB -> 850_000 micro-cents/GB / 1_073_741_824 bytes ≈ 0.00079 micro-cents per byte.
  origin_bandwidth_bytes: 0.00079,
  // Object storage around 0.0255 USD/GB-month ≈ 0.0024 micro-cents per byte-month.
  storage_source_bytes: 0.0024,
  storage_variant_bytes: 0.0024,
  storage_release_bytes: 0.0024,
  storage_offsite_bytes: 0.0024,
})

/** How far a figure may sit from its reference before it is reported. */
const IMPLAUSIBLE_FACTOR = 50

export type CostPlausibilityProblem = Readonly<{
  meter: MeterClass
  assumed: number
  reference: number
  factor: number
  message: string
}>

/**
 * Reports unit costs that are implausibly far from a published reference.
 *
 * Reports rather than refuses, because a reference is itself an approximation and a legitimate figure
 * can sit some way from it — but three orders of magnitude is not a pricing decision, it is a mistake.
 * The factor is included so a reader can judge rather than take the verdict on trust.
 */
export function implausibleUnitCosts(
  unitCosts: Readonly<Record<MeterClass, number>>,
): readonly CostPlausibilityProblem[] {
  const problems: CostPlausibilityProblem[] = []
  for (const meter of METER_CLASSES) {
    const reference = REFERENCE_UNIT_COSTS[meter]
    if (reference === undefined || reference <= 0) continue
    const assumed = unitCosts[meter]
    const factor = assumed / reference
    if (factor < IMPLAUSIBLE_FACTOR && factor > 1 / IMPLAUSIBLE_FACTOR) continue
    problems.push(Object.freeze({
      meter,
      assumed,
      reference,
      factor,
      message:
        `${meter} assumes ${assumed} micro-cents per unit against a published reference of about `
        + `${reference} — a factor of ${factor.toFixed(0)}. A plan priced from this either refuses a `
        + 'sound tier or prices the product for a customer who does not exist.',
    }))
  }
  return Object.freeze(problems)
}

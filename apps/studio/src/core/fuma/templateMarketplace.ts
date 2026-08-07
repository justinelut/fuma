/**
 * Template marketplace: listing, purchase, licensing and payouts.
 *
 * WHAT ALREADY EXISTS, so this does not duplicate it:
 * - `server/fuma/artifactReviews/` is a real submission → scan → sign → decide pipeline, and migration
 *   000071 constrains `artifact_kind` to ('plugin','component-pack'). A TEMPLATE IS NOT AN ACCEPTED
 *   KIND, so a template cannot be reviewed today. `REVIEW_PIPELINE_GAP` records that rather than
 *   quietly building a second review path beside a working one.
 * - That pipeline's `license` is an SPDX IDENTIFIER attached to review evidence. AN SPDX ID IS NOT A
 *   COMMERCIAL GRANT: it states the terms of the code, not that a named buyer paid for it. So a
 *   purchase has to produce its own record, which is what `TemplateLicence` is.
 * - `src/core/react-ir/templatePackaging.ts` already answers whether a template can be sold at all
 *   (`roundTripsCleanly`), which is the submission gate rather than something to re-derive.
 *
 * Money is integer minor units throughout, following `server/fuma/registrar/margin.ts`. No floats:
 * a fraction of a cent that rounds the wrong way is a discrepancy nobody can reconcile later.
 */
import { Type, type Static } from '@sinclair/typebox'

/** Minor units — cents. Integer to keep money exact. */
const MoneySchema = Type.Integer({ minimum: 0, maximum: 1_000_000_000 })
const CurrencySchema = Type.Literal('KES')
const Id = Type.String({ minLength: 1, maxLength: 200 })

export type Currency = Static<typeof CurrencySchema>

/**
 * A listing's state.
 *
 * `delisted` is kept rather than deleted, and that is the single most important decision in this
 * file. See `licenceSurvives` below.
 */
export const ListingStateSchema = Type.Union([
  Type.Literal('draft'),
  Type.Literal('in-review'),
  Type.Literal('listed'),
  Type.Literal('rejected'),
  Type.Literal('delisted'),
])
export type ListingState = Static<typeof ListingStateSchema>

export const TemplateListingSchema = Type.Object({
  listingId: Id,
  /** The seller's organization. Payouts go here, so it is required rather than inferred. */
  sellerOrganizationId: Id,
  templateName: Type.String({ minLength: 1, maxLength: 200 }),
  state: ListingStateSchema,
  currency: CurrencySchema,
  /** What the buyer pays. A free template is expressed by `priceMinor: 0`. */
  priceMinor: MoneySchema,
  /** Proven by templatePackaging.roundTripsCleanly before a listing may leave draft. */
  roundTripVerified: Type.Boolean(),
  createdAt: Type.String({ minLength: 1, maxLength: 40 }),
}, { additionalProperties: false })
export type TemplateListing = Readonly<Static<typeof TemplateListingSchema>>

export type ListingProblemCode =
  | 'not-round-trippable'
  | 'not-reviewed'
  | 'price-exceeds-ceiling'

export interface ListingProblem {
  readonly code: ListingProblemCode
  readonly message: string
}

/**
 * The highest price a template may be listed at.
 *
 * A ceiling exists for the same reason task 105 gave prices one: an unbounded price on a
 * marketplace we operate is our reputation, not only the seller's. Generous enough not to interfere
 * with real pricing.
 */
export const MAX_TEMPLATE_PRICE_MINOR = 5_000_000

/**
 * May this listing be published?
 *
 * `reviewed` is passed IN rather than read here, because the review pipeline lives server-side in
 * artifactReviews and this module must stay a pure decision layer.
 */
export function reviewListing(
  listing: TemplateListing,
  reviewed: boolean,
): readonly ListingProblem[] {
  const problems: ListingProblem[] = []
  if (!listing.roundTripVerified) {
    problems.push(Object.freeze({
      code: 'not-round-trippable' as const,
      // Task 85's rule: a buyer who installs a template the builder cannot open has bought nothing,
      // and finds out after paying.
      message: 'This template does not round-trip through the builder, so a buyer would install it '
        + 'and open an empty canvas. Fix the packaging problems before listing.',
    }))
  }
  if (!reviewed) {
    problems.push(Object.freeze({
      code: 'not-reviewed' as const,
      message: 'This template has not passed artifact review, so nothing has scanned it for secrets '
        + 'or private hosts. Listing it would ship the author\'s own credentials to every buyer.',
    }))
  }
  if (listing.priceMinor > MAX_TEMPLATE_PRICE_MINOR) {
    problems.push(Object.freeze({
      code: 'price-exceeds-ceiling' as const,
      message: `A listing may not exceed ${MAX_TEMPLATE_PRICE_MINOR} minor units.`,
    }))
  }
  return Object.freeze(problems)
}

/** True when the listing may be offered to buyers. */
export function isPurchasable(listing: TemplateListing, reviewed: boolean): boolean {
  return listing.state === 'listed' && reviewProblemsAreEmpty(listing, reviewed)
}

function reviewProblemsAreEmpty(listing: TemplateListing, reviewed: boolean): boolean {
  return reviewListing(listing, reviewed).length === 0
}

// ---------------------------------------------------------------------------
// Purchase and licence
// ---------------------------------------------------------------------------

export const TemplateLicenceSchema = Type.Object({
  licenceId: Id,
  listingId: Id,
  /** The organization that may install it. A licence belongs to a tenant, not to a person. */
  buyerOrganizationId: Id,
  currency: CurrencySchema,
  paidMinor: MoneySchema,
  purchasedAt: Type.String({ minLength: 1, maxLength: 40 }),
  /** Set when refunded. A refunded licence stops permitting installation. */
  refundedAt: Type.Union([Type.String({ minLength: 1, maxLength: 40 }), Type.Null()]),
}, { additionalProperties: false })
export type TemplateLicence = Readonly<Static<typeof TemplateLicenceSchema>>

export type PurchaseRefusal =
  | 'not-purchasable'
  | 'already-licensed'
  | 'price-changed'

export interface PurchaseResult {
  readonly ok: boolean
  readonly licence: TemplateLicence | null
  readonly refusal: PurchaseRefusal | null
  readonly message: string
}

/**
 * Buy a licence.
 *
 * `expectedPriceMinor` is REQUIRED, and it is the quote the buyer was shown. If the seller changed
 * the price between the page rendering and the button being pressed, the purchase is REFUSED rather
 * than completed at the new figure — charging more than the amount somebody agreed to is
 * indefensible however briefly the old price was displayed. The same discipline task 98 applied to
 * domain renewals, which refuse rather than fall back to a stale price.
 */
export function purchaseLicence(input: Readonly<{
  listing: TemplateListing
  reviewed: boolean
  buyerOrganizationId: string
  expectedPriceMinor: number
  existingLicences: readonly TemplateLicence[]
  licenceId: string
  now: string
}>): PurchaseResult {
  const { listing, reviewed, buyerOrganizationId, expectedPriceMinor, existingLicences } = input
  if (!isPurchasable(listing, reviewed)) {
    return refuse('not-purchasable', 'This template is not currently available to buy.')
  }
  // An organization holding a live licence must not be charged twice for the same template. A double
  // charge is the complaint a marketplace never recovers from.
  const held = existingLicences.find((licence) => (
    licence.listingId === listing.listingId
    && licence.buyerOrganizationId === buyerOrganizationId
    && licence.refundedAt === null
  ))
  if (held) {
    return refuse('already-licensed', 'Your organization already holds a licence for this template.')
  }
  if (expectedPriceMinor !== listing.priceMinor) {
    return refuse(
      'price-changed',
      'The price changed while you were on this page. Review the new price before buying.',
    )
  }
  return Object.freeze({
    ok: true,
    licence: Object.freeze({
      licenceId: input.licenceId,
      listingId: listing.listingId,
      buyerOrganizationId,
      currency: listing.currency,
      paidMinor: listing.priceMinor,
      purchasedAt: input.now,
      refundedAt: null,
    }),
    refusal: null,
    message: '',
  })
}

function refuse(refusal: PurchaseRefusal, message: string): PurchaseResult {
  return Object.freeze({ ok: false, licence: null, refusal, message })
}

/**
 * THE RULE THAT MATTERS MOST HERE: A LICENCE OUTLIVES ITS LISTING.
 *
 * A seller can delist a template — they are entitled to stop selling. But a buyer who paid has a
 * licence, and if delisting revoked it the seller could take back what somebody paid for, at will
 * and with no refund. That is not a marketplace anybody should list on or buy from, and the failure
 * is silent: the template simply stops installing and reads as a broken product rather than as a
 * revoked entitlement.
 *
 * So installation depends on the LICENCE, never on the listing's current state. A REFUND is the one
 * thing that ends it, because then the money went back too.
 */
export function licenceSurvives(licence: TemplateLicence): boolean {
  // Deliberately takes no listing state. The listing's state is not a parameter of this decision,
  // and accepting one would invite a future edit to consult it - which is precisely the revocation
  // this rule exists to prevent. A refund is the only thing that ends a licence.
  return licence.refundedAt === null
}

/** May this organization install the template? */
export function mayInstall(
  licences: readonly TemplateLicence[],
  listingId: string,
  organizationId: string,
): boolean {
  return licences.some((licence) => (
    licence.listingId === listingId
    && licence.buyerOrganizationId === organizationId
    && licence.refundedAt === null
  ))
}

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

/**
 * The platform's share, in basis points.
 *
 * Modest by direction — the marketplace should be worth listing on, and a high take rate on a small
 * market drives sellers away, which leaves nothing to take a share of.
 */
export const PLATFORM_FEE_BASIS_POINTS = 1_500

/**
 * Days a sale is held before it can be paid out.
 *
 * A payout before the refund window closes pays a seller money that may have to be returned, and
 * clawing it back afterwards is either impossible or a dispute. Holding is the cheap side of that
 * asymmetry.
 */
export const PAYOUT_HOLD_DAYS = 14

export interface PayoutLine {
  readonly licenceId: string
  readonly currency: Currency
  readonly grossMinor: number
  readonly platformFeeMinor: number
  readonly sellerMinor: number
}

/**
 * The platform fee, ROUNDED UP.
 *
 * Rounding up rather than to nearest, following margin.ts: rounding down means the platform can pay
 * out marginally more than it received on a large enough number of sales, and a fee that silently
 * loses money is worse than one cent of imprecision in our favour.
 */
export function platformFeeFor(grossMinor: number): number {
  if (grossMinor <= 0) return 0
  return Math.ceil((grossMinor * PLATFORM_FEE_BASIS_POINTS) / 10_000)
}

/** Split one sale. The seller's share is what remains, so the two can never fail to add up. */
export function splitSale(licence: TemplateLicence): PayoutLine {
  const platformFeeMinor = platformFeeFor(licence.paidMinor)
  return Object.freeze({
    licenceId: licence.licenceId,
    currency: licence.currency,
    grossMinor: licence.paidMinor,
    platformFeeMinor,
    sellerMinor: licence.paidMinor - platformFeeMinor,
  })
}

export type PayoutRefusal =
  | 'inside-hold-window'
  | 'refunded'
  | 'already-paid'
  | 'nothing-to-pay'

export interface PayoutDecision {
  readonly payable: boolean
  readonly refusal: PayoutRefusal | null
  readonly line: PayoutLine | null
  readonly message: string
}

/**
 * Decide whether one sale may be paid out.
 *
 * `alreadyPaidLicenceIds` is required rather than optional, so a caller cannot request a payout
 * without stating what has already been paid. Paying the same sale twice is the mistake that is
 * hardest to notice and hardest to reverse.
 */
export function decidePayout(input: Readonly<{
  licence: TemplateLicence
  now: string
  alreadyPaidLicenceIds: readonly string[]
}>): PayoutDecision {
  const { licence, now, alreadyPaidLicenceIds } = input
  if (licence.refundedAt !== null) {
    return noPayout('refunded', 'This sale was refunded, so there is nothing to pay out.')
  }
  if (alreadyPaidLicenceIds.includes(licence.licenceId)) {
    return noPayout('already-paid', 'This sale has already been paid out.')
  }
  if (licence.paidMinor === 0) {
    // A free template is a real listing; it simply produces no payout.
    return noPayout('nothing-to-pay', 'This template was free, so no payment was taken.')
  }
  const held = holdElapsedDays(licence.purchasedAt, now)
  if (held === null || held < PAYOUT_HOLD_DAYS) {
    return noPayout(
      'inside-hold-window',
      `This sale is still inside the ${PAYOUT_HOLD_DAYS}-day refund window and will become payable after it closes.`,
    )
  }
  return Object.freeze({ payable: true, refusal: null, line: splitSale(licence), message: '' })
}

function noPayout(refusal: PayoutRefusal, message: string): PayoutDecision {
  return Object.freeze({ payable: false, refusal, line: null, message })
}

/**
 * Whole days between two timestamps, or null when either cannot be read.
 *
 * An unreadable timestamp keeps the sale INSIDE the window (see decidePayout), because the safe
 * direction is to delay a payment rather than release one we cannot date.
 */
export function holdElapsedDays(from: string, to: string): number | null {
  const start = Date.parse(from)
  const end = Date.parse(to)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return Math.floor((end - start) / 86_400_000)
}

/**
 * Total a seller is owed.
 *
 * REFUSES to add across currencies rather than summing a meaningless number, the same rule
 * margin.ts applies. Returns null so a caller must handle it instead of displaying a total that
 * mixes denominations.
 */
export function payableTotal(lines: readonly PayoutLine[]): Readonly<{
  currency: Currency
  sellerMinor: number
}> | null {
  if (lines.length === 0) return null
  const currency = lines[0]!.currency
  if (lines.some((line) => line.currency !== currency)) return null
  return Object.freeze({
    currency,
    sellerMinor: lines.reduce((sum, line) => sum + line.sellerMinor, 0),
  })
}

/**
 * The gap in the review pipeline, recorded as data.
 *
 * Stated rather than worked around: migration 000071 constrains artifact_kind to
 * ('plugin','component-pack'), and `DESTRUCTIVE_SQL` in migrationPolicy.ts forbids altering a check
 * constraint in place — so accepting templates needs the `_v2` + backfill pattern migration 000085
 * already follows. Building a second, template-only review path instead would mean two things that
 * scan for secrets, and the weaker one would be the one nobody maintains.
 */
export const REVIEW_PIPELINE_GAP = Object.freeze({
  migration: '000071_artifact_review_marketplace',
  acceptedKinds: Object.freeze(['plugin', 'component-pack'] as const),
  missingKind: 'template',
  blocking: true,
  reason: 'A template cannot be submitted for artifact review, so no listing can satisfy the '
    + 'not-reviewed gate in reviewListing. Until the kind is accepted, reviewed is always false.',
  whatWouldCloseIt: 'A _v2 table plus backfill widening artifact_kind to include \'template\', '
    + 'following migration 000085, then routing template submissions through the existing scanners.',
})

/** The contract stated in one place, so a reader finds the reasoning rather than inferring it. */
export const MARKETPLACE_CONTRACT = Object.freeze({
  listingGate: 'A template may not be listed until it round-trips through the builder and has '
    + 'passed artifact review.',
  licenceOutlivesListing: 'Delisting stops new sales and never revokes a licence somebody paid for. '
    + 'Only a refund ends a licence.',
  payoutHold: `A sale is payable ${PAYOUT_HOLD_DAYS} days after purchase, so a refund cannot chase `
    + 'money that has already left.',
  feeBasisPoints: PLATFORM_FEE_BASIS_POINTS,
})

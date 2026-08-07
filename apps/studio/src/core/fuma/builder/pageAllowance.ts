/**
 * Whether another page may be created, decided in one place.
 *
 * WHY THIS IS A MODULE RATHER THAN A CHECK AT THE BUTTON: there are THREE paths that create a
 * page - the explorer's "add page", the explorer's "Post Template", and the AI executor's
 * site_add_page / site_duplicate_page. A limit enforced at one of them is not a limit; it is a
 * speed bump with three ways around it, and the way around it is the one the AI takes.
 *
 * The allowance is an INPUT, not something this module reads. The seeded quota lives server-side
 * (entitlements/planSeed.ts) and this code runs in the browser, so the number has to arrive with
 * the request. That also keeps the decision testable without a database.
 */

/** What the builder knows about its own pages when it asks. */
export type PageInventory = Readonly<{
  /** Pages a visitor can navigate to. This is what the `pages` quota counts. */
  addressablePages: number
  /**
   * Post templates. Counted separately and DELIBERATELY NOT charged against the page allowance.
   *
   * A post template is not a page anybody lands on - it is the layout a post type renders
   * through. Charging it would mean a free tier of one page becomes ZERO pages the moment
   * somebody uses a post type, which is not what "one page" promises and is a limit nobody
   * could predict from the number they were shown.
   */
  postTemplates: number
}>

export type PageAllowance = Readonly<{
  /** The seeded quota, or null when the plan could not be resolved. */
  limit: number | null
  /** The plan's name, for a message that says which plan the limit belongs to. */
  planName: string | null
}>

export type PageCreationVerdict = Readonly<{
  allowed: boolean
  reason: 'within-allowance' | 'no-limit-known' | 'at-limit'
  /** Null when there is nothing to say, so a caller never renders an empty notice. */
  message: string | null
  /** Present only when a limit is known, so a caller cannot render "1 of null". */
  usage: Readonly<{ used: number, limit: number }> | null
}>

/**
 * The asymmetry that matters, and it is deliberate.
 *
 * An UNKNOWN limit ALLOWS the page. That is the opposite of how the allowance is DISPLAYED (an
 * unknown limit is never shown as unlimited), and the two are right for different reasons:
 *  - Showing a limit we do not know as "unlimited" is a promise we would break at the moment
 *    somebody's upload is refused.
 *  - REFUSING a page because we could not read the plan breaks the product for everybody,
 *    including paying customers, during an entitlements outage - and it breaks it in the one
 *    place the product exists to be used.
 * Over-allowing is a billing discrepancy that can be reconciled afterwards. Blocking is not
 * recoverable: the work does not happen. So the failure mode is chosen rather than inherited.
 */
export function decidePageCreation(inventory: PageInventory, allowance: PageAllowance): PageCreationVerdict {
  if (allowance.limit === null) {
    return Object.freeze({
      allowed: true,
      reason: 'no-limit-known' as const,
      message: null,
      usage: null,
    })
  }
  const used = inventory.addressablePages
  if (used < allowance.limit) {
    return Object.freeze({
      allowed: true,
      reason: 'within-allowance' as const,
      message: null,
      usage: Object.freeze({ used, limit: allowance.limit }),
    })
  }
  return Object.freeze({
    allowed: false,
    reason: 'at-limit' as const,
    message: atLimitMessage(allowance),
    usage: Object.freeze({ used, limit: allowance.limit }),
  })
}

/**
 * The message names the plan and the way out.
 *
 * "Page limit reached" alone leaves somebody staring at a disabled button with no idea whether
 * they hit a bug, a bound, or a billing state - and the commonest next move is to try again.
 */
function atLimitMessage(allowance: PageAllowance): string {
  const limit = allowance.limit ?? 0
  const pages = limit === 1 ? '1 page' : `${limit} pages`
  // Singular wording matters here: "includes 1 pages" reads as a bug in the product, and this is
  // the exact sentence the free tier shows every time somebody tries to add their second page.
  const plan = allowance.planName === null ? 'Your plan' : `The ${allowance.planName} plan`
  return `${plan} includes ${pages}. Upgrade to add more, or edit the page you already have.`
}

/**
 * A count taken from the builder's own page list.
 *
 * Kept here rather than at each call site so the three creation paths cannot count differently -
 * a limit that counts templates in one place and not another is enforced at different totals
 * depending on which button somebody pressed.
 */
export function inventoryOf(pages: readonly { readonly template?: { readonly enabled?: boolean } }[]): PageInventory {
  let addressable = 0
  let templates = 0
  for (const page of pages) {
    // Matches how the loop source already decides (core/loops/sources/sitePages.ts), so the
    // builder and the publisher agree on what a template is rather than each having a rule.
    if (page.template?.enabled === true) templates += 1
    else addressable += 1
  }
  return Object.freeze({ addressablePages: addressable, postTemplates: templates })
}

/**
 * Whether the limit is worth mentioning before it bites.
 *
 * Told at the LAST page rather than partway through: a warning at half the allowance is noise on
 * a plan of one page, and on a larger plan it arrives long before there is a decision to make.
 */
export function shouldWarnBeforeLimit(inventory: PageInventory, allowance: PageAllowance): boolean {
  if (allowance.limit === null) return false
  return inventory.addressablePages === allowance.limit - 1
}

/**
 * The active allowance, carried at module level.
 *
 * Follows the same precedent as the builder scope carrier: NULL BY DEFAULT, so a self-hosted
 * install - which has no plan and no limit - behaves exactly as it did before this file existed.
 * A self-hosted owner running their own server is not somebody we get to ration.
 */
let activeAllowance: PageAllowance | null = null

export function setActivePageAllowance(allowance: PageAllowance | null): void {
  activeAllowance = allowance
}

export function activePageAllowance(): PageAllowance {
  // An absent carrier is reported as an unknown limit rather than as zero, because zero would
  // refuse every page on every self-hosted install.
  return activeAllowance ?? Object.freeze({ limit: null, planName: null })
}

/**
 * The one call every creation path makes.
 *
 * Returns the verdict so the caller can refuse BEFORE creating. Checking afterwards would mean
 * creating then deleting, which leaves the page in undo history for somebody to bring back and
 * makes the limit look like a bug that ate their work.
 */
export function reviewPageCreation(
  pages: readonly { readonly template?: { readonly enabled?: boolean } }[],
): PageCreationVerdict {
  return decidePageCreation(inventoryOf(pages), activePageAllowance())
}

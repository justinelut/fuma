/**
 * Cloudflare DNS for domains the customer already owns.
 *
 * POLICY: a connected (bring-your-own) domain must be on Cloudflare DNS. That is what turns the
 * connect path from "here are eleven records, please paste them" into the one-click experience
 * Vercel and Netlify offer — once DNS is somewhere we can write, every record we need (site
 * routing, TLS validation, MX, SPF, DKIM, DMARC) is an API call rather than an instruction.
 *
 * Two modes, because they fail differently and a customer will legitimately want either:
 *
 *   DELEGATED — the customer points their registrar's nameservers at our Cloudflare zone. We then
 *     hold the whole zone and can write anything. Simplest for them, most control for us.
 *   AUTHORISED — the domain stays in the customer's own Cloudflare account and they grant a token
 *     scoped to DNS edit on that one zone. Nothing about the rest of their DNS moves.
 *
 * THE HAZARD DELEGATION INTRODUCES, and the reason this module exists rather than a single API
 * call: **CHANGING NAMESERVERS MOVES ALL DNS, NOT JUST THE WEBSITE RECORD.** The instant the
 * registrar's NS point at a zone we just created, every record the domain already had stops
 * resolving — MX, so INBOUND MAIL BOUNCES; SPF and DKIM, so whatever still sends starts failing
 * authentication; and every subdomain, so anything else they run disappears.
 *
 * None of that is visible on the website we were asked to connect, which will look perfect. The
 * customer discovers it when someone tells them an email bounced, and they are right to blame us.
 * So delegation is REFUSED until the existing records have been imported. Cloudflare's own
 * onboarding scans a domain's current records for exactly this reason.
 */

/** How we came to be able to write this domain's DNS. */
export type CloudflareMode =
  /** Customer moved their nameservers to our zone. */
  | 'delegated'
  /** Customer's own Cloudflare zone plus a scoped token. */
  | 'authorised'

export type OnboardingState =
  /** Nothing set up. We cannot write anything. */
  | 'not-configured'
  /** Existing records read from the current provider, ready to recreate. */
  | 'records-imported'
  /** Nameserver change requested; not yet observed in the wild. */
  | 'delegation-pending'
  /** Nameservers verified. We can write. */
  | 'delegated'
  /** Token verified against the customer's own zone. We can write. */
  | 'authorised'
  /** Customer refused Cloudflare. Connect cannot proceed one-click. */
  | 'declined'

/** A DNS record observed at the customer's current provider. */
export type ObservedRecord = Readonly<{
  type: string
  name: string
  value: string
  priority?: number
}>

/**
 * Record types whose loss is not visible on the website.
 *
 * These are the ones that make delegation dangerous: the site looks right while mail and
 * subdomains are broken.
 */
const SILENTLY_CRITICAL = Object.freeze(['MX', 'TXT', 'SRV', 'CAA'])

export type OnboardingRefusal =
  | 'records-not-imported'
  | 'mail-would-break'
  | 'delegation-not-live'
  | 'customer-declined'
  | 'partial-delegation'

export type OnboardingDecision =
  | Readonly<{ ok: true, mode: CloudflareMode, canWriteRecords: true }>
  | Readonly<{ ok: false, reason: OnboardingRefusal, message: string }>

/**
 * Whether existing records that would be lost have been carried over.
 *
 * Reported as the specific record types at risk rather than a boolean, so the interface can tell
 * the customer what is about to stop working rather than only that something is.
 */
export function recordsAtRisk(
  existing: readonly ObservedRecord[],
  imported: readonly ObservedRecord[],
): readonly ObservedRecord[] {
  const importedKeys = new Set(
    imported.map((record) => `${record.type.toUpperCase()}\u0000${normaliseName(record.name)}\u0000${record.value}`),
  )
  return Object.freeze(existing.filter((record) => {
    if (!SILENTLY_CRITICAL.includes(record.type.toUpperCase())) return false
    const key = `${record.type.toUpperCase()}\u0000${normaliseName(record.name)}\u0000${record.value}`
    return !importedKeys.has(key)
  }))
}

/** Whether losing these records would stop inbound mail. */
export function wouldBreakMail(atRisk: readonly ObservedRecord[]): boolean {
  return atRisk.some((record) => record.type.toUpperCase() === 'MX')
}

/**
 * Compare observed nameservers against the ones delegation requires.
 *
 * Requires EVERY expected nameserver to be present. A partial delegation is not a partial success:
 * resolvers pick among the NS set, so some queries would go to the old provider and some to us, and
 * the domain would work intermittently in a way that is very hard to diagnose.
 */
export function delegationStatus(
  observed: readonly string[],
  required: readonly string[],
): 'live' | 'partial' | 'absent' {
  const seen = new Set(observed.map(normaliseName))
  const present = required.filter((expected) => seen.has(normaliseName(expected)))
  if (present.length === required.length && required.length > 0) return 'live'
  return present.length === 0 ? 'absent' : 'partial'
}

function normaliseName(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '')
}

export type OnboardingFacts = Readonly<{
  mode: CloudflareMode
  state: OnboardingState
  /** Records the domain has at its current provider. */
  existing: readonly ObservedRecord[]
  /** Records we have carried into the new zone. */
  imported: readonly ObservedRecord[]
  /** Nameservers actually observed for the domain. */
  observedNameservers: readonly string[]
  /** Nameservers our zone requires. */
  requiredNameservers: readonly string[]
}>

/**
 * Decide whether we may write this domain's DNS records ourselves.
 *
 * This is the question the one-click flow asks, and it deliberately supersedes asking the
 * acquisition path alone: on the connect path the answer is no longer a property of the path, it is
 * a property of whether DNS actually lives somewhere we can write.
 */
export function decideOnboarding(facts: OnboardingFacts): OnboardingDecision {
  if (facts.state === 'declined') {
    return Object.freeze({
      ok: false as const,
      reason: 'customer-declined' as const,
      message:
        'This domain is not on Cloudflare DNS, so records cannot be written for it. Either move the '
        + 'domain to Cloudflare, or add the records by hand.',
    })
  }

  if (facts.mode === 'authorised') {
    // Their zone, our scoped token. Nothing about the rest of their DNS moves, so there is nothing
    // to import and no delegation to wait for.
    if (facts.state !== 'authorised') {
      return Object.freeze({
        ok: false as const,
        reason: 'delegation-not-live' as const,
        message:
          'The Cloudflare token for this zone has not been verified yet, so writing records would '
          + 'fail at the API rather than at a point the customer can act on.',
      })
    }
    return Object.freeze({ ok: true as const, mode: 'authorised' as const, canWriteRecords: true as const })
  }

  // Delegated mode. Importing comes FIRST, because the nameserver change is what destroys the old
  // records and it cannot be undone quickly.
  const atRisk = recordsAtRisk(facts.existing, facts.imported)
  if (facts.state === 'not-configured' || (atRisk.length > 0 && facts.state !== 'delegated')) {
    if (wouldBreakMail(atRisk)) {
      return Object.freeze({
        ok: false as const,
        reason: 'mail-would-break' as const,
        message:
          `Pointing this domain's nameservers at us before importing its ${atRisk.length} existing `
          + 'record(s) would stop INBOUND MAIL, because MX records live in DNS and the new zone does '
          + 'not have them yet. The website would look perfect while email bounced, so the import '
          + 'has to happen first.',
      })
    }
    if (atRisk.length > 0) {
      return Object.freeze({
        ok: false as const,
        reason: 'records-not-imported' as const,
        message:
          `${atRisk.length} existing record(s) have not been imported. Delegating nameservers now `
          + 'would stop them resolving, and none of that is visible on the site we are connecting.',
      })
    }
    return Object.freeze({
      ok: false as const,
      reason: 'records-not-imported' as const,
      message:
        'The domain\'s existing records have not been read yet, so we cannot tell what delegation '
        + 'would break.',
    })
  }

  const status = delegationStatus(facts.observedNameservers, facts.requiredNameservers)
  if (status === 'partial') {
    return Object.freeze({
      ok: false as const,
      reason: 'partial-delegation' as const,
      message:
        'Only some of the required nameservers are live. Resolvers pick among the set, so the domain '
        + 'would resolve through us for some visitors and through the old provider for others — '
        + 'intermittent behaviour that is very hard to diagnose. Complete the change at the '
        + 'registrar.',
    })
  }
  if (status === 'absent') {
    return Object.freeze({
      ok: false as const,
      reason: 'delegation-not-live' as const,
      message:
        'The nameserver change has not taken effect yet. Records written now would land in a zone '
        + 'nobody is querying, so the flow would report success while nothing resolved.',
    })
  }

  return Object.freeze({ ok: true as const, mode: 'delegated' as const, canWriteRecords: true as const })
}

/** Whether the one-click flow may apply records. The single question callers ask. */
export function canAutoWriteRecords(facts: OnboardingFacts): boolean {
  return decideOnboarding(facts).ok
}

/**
 * What to tell the customer to do next.
 *
 * Derived from the same facts as the decision so the instruction and the gate cannot disagree —
 * telling somebody to wait when the real problem is a typo wastes their afternoon.
 */
export function nextStep(facts: OnboardingFacts): string {
  const decision = decideOnboarding(facts)
  if (decision.ok) return 'Nothing to do — we can write this domain\'s records.'
  switch (decision.reason) {
    case 'customer-declined':
      return 'Move the domain to Cloudflare DNS to enable one-click setup, or add records by hand.'
    case 'mail-would-break':
    case 'records-not-imported':
      return 'Import the domain\'s existing DNS records before changing its nameservers.'
    case 'partial-delegation':
      return 'Finish replacing every nameserver at the registrar; some still point at the old provider.'
    case 'delegation-not-live':
      return facts.mode === 'authorised'
        ? 'Grant and verify a Cloudflare API token scoped to this zone.'
        : 'Update the nameservers at the registrar, then wait for propagation.'
  }
}

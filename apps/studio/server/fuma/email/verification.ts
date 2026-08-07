/**
 * Verifying that an email connection actually delivers.
 *
 * A connection that looks configured but does not deliver is worse than one that
 * plainly failed, because nobody investigates it until mail has been silently going
 * missing for a while. So the records are read back from public DNS and compared
 * against what was planned.
 *
 * The distinction that makes this useful
 * --------------------------------------
 *
 * The existing domain observer represents an absent record by omission, deliberately,
 * so its diagnostics stay non-oracular. That is right for TLS provisioning and wrong
 * here, because two failures need opposite advice:
 *
 *   **absent** — nothing resolves at that name. Almost always propagation, so the
 *   advice is to wait. Telling someone to re-check their typing while DNS is still
 *   propagating wastes their afternoon.
 *
 *   **mismatched** — something resolves, but not what we asked for. Waiting will never
 *   fix it. Usually a typo, a stale record from a previous provider, or a registrar
 *   that rewrote the value.
 *
 * Conflating them produces advice that is wrong half the time, which trains people to
 * ignore it.
 *
 * Verification also does not stop at connection. A record deleted six months later
 * breaks mail exactly as thoroughly as one never added, so the same check is meant to
 * run on a schedule and report a regression rather than assuming a past success holds.
 */

import { Type, type Static } from '@core/utils/typeboxHelpers'
import type { EmailRecord, RecordPurpose } from './providerCatalogue'

/**
 * What verification needs to read.
 *
 * Separate from the existing `DnsResolverPort` because that one has no MX lookup, and
 * mail cannot be verified without one. Kept as a port so tests supply answers directly
 * rather than depending on the public DNS of a domain nobody controls.
 */
export interface MailDnsResolver {
  /** MX hosts with their preferences. */
  resolveMx(hostname: string): Promise<readonly Readonly<{ exchange: string, priority: number }>[]>
  /** TXT records, each already joined from its segments. */
  resolveTxt(hostname: string): Promise<readonly string[]>
  resolveCname(hostname: string): Promise<readonly string[]>
}

export const RecordStateSchema = Type.Union([
  /** Resolves with the expected value. */
  Type.Literal('present'),
  /** Nothing resolves at this name. Usually propagation. */
  Type.Literal('absent'),
  /** Something resolves, but not what was asked for. Waiting will not fix it. */
  Type.Literal('mismatched'),
  /** The lookup itself failed, so nothing is known either way. */
  Type.Literal('unknown'),
])
export type RecordState = Static<typeof RecordStateSchema>

export const RecordVerdictSchema = Type.Object({
  purpose: Type.String({ minLength: 1, maxLength: 64 }),
  host: Type.String({ minLength: 1, maxLength: 253 }),
  type: Type.String({ minLength: 1, maxLength: 16 }),
  state: RecordStateSchema,
  expected: Type.String({ minLength: 1, maxLength: 2048 }),
  /** What actually resolved, for a mismatch. Empty when nothing did. */
  observed: Type.Array(Type.String({ maxLength: 2048 }), { maxItems: 20 }),
  /** Whether the connection is broken without this record. */
  required: Type.Boolean(),
  advice: Type.String({ minLength: 1, maxLength: 400 }),
}, { additionalProperties: false })
export type RecordVerdict = Readonly<Static<typeof RecordVerdictSchema>>

export type VerificationResult = Readonly<{
  /** Every required record resolves correctly. */
  delivering: boolean
  verdicts: readonly RecordVerdict[]
  /** True when the only problems are absences, so waiting is the right advice. */
  likelyPropagating: boolean
  /** Records that resolve to something wrong. These will not fix themselves. */
  misconfigured: readonly RecordVerdict[]
}>

/** The fully qualified name a relative host resolves at. */
export function absoluteHost(host: string, domain: string): string {
  if (host === '@') return domain
  if (host.endsWith(`.${domain}`) || host === domain) return host
  return `${host}.${domain}`
}

/** Compare without being defeated by a trailing dot or casing. */
function sameHostname(left: string, right: string): boolean {
  return left.toLowerCase().replace(/\.$/, '') === right.toLowerCase().replace(/\.$/, '')
}

/**
 * Compare TXT values.
 *
 * SPF is compared by its includes rather than byte-for-byte, because a merge may have
 * legitimately reordered terms or added another sender's include. Demanding an exact
 * string would report a correctly-merged record as wrong.
 */
function txtMatches(expected: string, observed: string, purpose: RecordPurpose): boolean {
  if (purpose !== 'spf') return expected.trim() === observed.trim()

  const includesOf = (value: string): Set<string> => new Set(
    value.toLowerCase().split(/\s+/).filter((term) => term.startsWith('include:')),
  )
  const wanted = includesOf(expected)
  const present = includesOf(observed)
  // Every include we asked for must be there. Extra ones are fine: another sender may
  // have been added since, and that is not a fault in this connection.
  for (const include of wanted) {
    if (!present.has(include)) return false
  }
  return observed.toLowerCase().includes('v=spf1')
}

function adviceFor(state: RecordState, record: EmailRecord): string {
  switch (state) {
    case 'present':
      return 'Resolving correctly.'
    case 'absent':
      return record.perDomain === true
        ? `Nothing resolves at this name yet. If you have not added the value the provider `
          + 'issued you, add it now; otherwise DNS is still propagating.'
        : 'Nothing resolves at this name yet. DNS changes usually appear within an hour, '
          + 'occasionally longer. Waiting is the right thing to do.'
    case 'mismatched':
      return 'Something resolves here, but not what this connection needs. Waiting will not '
        + 'fix it — check for a typo or a leftover record from a previous provider.'
    default:
      return 'The lookup did not complete, so this record\'s state is unknown. It has not '
        + 'been confirmed either way.'
  }
}

/** Verify one record. */
async function verifyRecord(
  resolver: MailDnsResolver,
  record: EmailRecord,
  domain: string,
): Promise<RecordVerdict> {
  const name = absoluteHost(record.host, domain)

  const build = (state: RecordState, observed: readonly string[]): RecordVerdict =>
    Object.freeze({
      purpose: record.purpose,
      host: record.host,
      type: record.type,
      state,
      expected: record.value,
      observed: [...observed].slice(0, 20),
      required: record.required,
      advice: adviceFor(state, record),
    })

  try {
    if (record.type === 'MX') {
      const mx = await resolver.resolveMx(name)
      if (mx.length === 0) return build('absent', [])
      const observed = mx.map((entry) => `${entry.priority} ${entry.exchange}`)
      // Present if our host is among them. Another provider's extra MX is a conflict,
      // but that is detectConflict's job — here we only report whether ours resolves.
      const found = mx.some((entry) => sameHostname(entry.exchange, record.value))
      return build(found ? 'present' : 'mismatched', observed)
    }

    if (record.type === 'TXT') {
      const txt = await resolver.resolveTxt(name)
      if (txt.length === 0) return build('absent', [])
      const found = txt.some((value) => txtMatches(record.value, value, record.purpose))
      return build(found ? 'present' : 'mismatched', txt)
    }

    const cname = await resolver.resolveCname(name)
    if (cname.length === 0) return build('absent', [])
    const found = cname.some((value) => sameHostname(value, record.value))
    return build(found ? 'present' : 'mismatched', cname)
  } catch {
    // A failed lookup is not an absent record. Reporting it as absent would advise
    // waiting for something that may already be correct.
    return build('unknown', [])
  }
}

/**
 * Verify a planned record set against public DNS.
 *
 * `delivering` is true only when every *required* record resolves. Optional records
 * missing is a deliverability warning, not a failed connection.
 */
export async function verifyConnection(
  resolver: MailDnsResolver,
  records: readonly EmailRecord[],
  domain: string,
): Promise<VerificationResult> {
  const verdicts: RecordVerdict[] = []
  for (const record of records) {
    verdicts.push(await verifyRecord(resolver, record, domain))
  }

  const required = verdicts.filter((verdict) => verdict.required)
  const misconfigured = verdicts.filter((verdict) => verdict.state === 'mismatched')

  return Object.freeze({
    delivering: required.every((verdict) => verdict.state === 'present'),
    verdicts: Object.freeze(verdicts),
    // Only when nothing is actively wrong. A single mismatch means waiting is the wrong
    // advice regardless of how many other records are merely absent.
    likelyPropagating: misconfigured.length === 0
      && required.some((verdict) => verdict.state === 'absent'),
    misconfigured: Object.freeze(misconfigured),
  })
}

export const VerificationRecordSchema = Type.Object({
  domain: Type.String({ minLength: 1, maxLength: 253 }),
  providerId: Type.String({ minLength: 1, maxLength: 64 }),
  delivering: Type.Boolean(),
  checkedAt: Type.String({ format: 'date-time' }),
  /** Purposes that failed, so a regression names what broke. */
  failingPurposes: Type.Array(Type.String({ maxLength: 64 }), { maxItems: 16 }),
}, { additionalProperties: false })
export type VerificationRecord = Readonly<Static<typeof VerificationRecordSchema>>

/** Summarise a verification for storage, so successive checks can be compared. */
export function recordVerification(
  domain: string,
  providerId: string,
  result: VerificationResult,
  checkedAt: string,
): VerificationRecord {
  return Object.freeze({
    domain,
    providerId,
    delivering: result.delivering,
    checkedAt,
    failingPurposes: [...new Set(
      result.verdicts
        .filter((verdict) => verdict.required && verdict.state !== 'present')
        .map((verdict) => verdict.purpose),
    )],
  })
}

export type Regression = Readonly<{
  /** Purposes that were delivering and no longer are. */
  brokenPurposes: readonly string[]
  message: string
}>

/**
 * Detect a connection that has stopped working.
 *
 * This is the reason verification repeats. A record deleted long after setup breaks
 * mail exactly as thoroughly as one never added, and nothing else would notice.
 */
export function detectRegression(
  previous: VerificationRecord,
  current: VerificationRecord,
): Regression | null {
  if (!previous.delivering) return null
  if (current.delivering) return null

  return {
    brokenPurposes: Object.freeze([...current.failingPurposes]),
    message:
      `${current.domain} was delivering mail when last checked (${previous.checkedAt}) and `
      + `is not now. Failing: ${current.failingPurposes.join(', ')}. A record has probably `
      + 'been changed or removed since setup.',
  }
}

/**
 * When to check again.
 *
 * Frequent while a connection is still settling, sparse once it is stable. Polling a
 * working connection every minute for months costs more than it detects, but checking
 * a pending one hourly means somebody waits an hour to learn they made a typo.
 */
export function nextCheckDelaySeconds(result: VerificationResult, attempt: number): number {
  if (result.misconfigured.length > 0) {
    // Nothing will change until a human acts, so back off to a slow watch.
    return 86_400
  }
  if (result.delivering) return 86_400
  // Still propagating: check often at first, easing off as the likelihood drops.
  return Math.min(3_600, 30 * Math.max(1, attempt) ** 2)
}

/**
 * One-click email connection.
 *
 * Picking a provider should be the whole interaction. What happens next depends
 * entirely on whether we control the domain's DNS, and the two outcomes must be
 * described differently or the product lies about what it did.
 *
 *   **Register path** — the domain was bought through us, so we hold the zone. We write
 *   every record ourselves and report the mailbox live once they resolve.
 *
 *   **Connect path** — the customer owns the domain elsewhere. We cannot write anything.
 *   We show the exact records to paste and poll until they appear.
 *
 * The same provider catalogue drives both, so a provider is described once and works
 * on either path. The failure this prevents is telling somebody their mailbox is
 * configured when all that happened was a list being displayed.
 *
 * Applying is idempotent. `planRecords` computes the desired end state rather than a
 * diff, so reconnecting the same provider converges instead of stacking a second set
 * of MX records — which would break inbound mail rather than duplicate it harmlessly.
 */

import { Type, type Static } from '@core/utils/typeboxHelpers'
import {
  detectConflict,
  findProvider,
  planRecords,
  type EmailRecord,
  type MailConflict,
} from './providerCatalogue'
import { canWriteDnsRecords } from '../domains/acquisitionPath'
import type { DomainPath } from '../domains/acquisitionPath'
import { canAutoWriteRecords, type OnboardingFacts } from '../domains/cloudflareDns'
import { verifyConnection, type MailDnsResolver, type VerificationResult } from './verification'

/**
 * Where records go.
 *
 * A port rather than a direct dependency so the same flow serves the hosted zone
 * writer, a build sandbox and tests. It only exists for the register path; on connect
 * there is nothing to write to.
 */
export interface ZoneWriter {
  /**
   * Apply the given records, replacing any previous set for the same purposes.
   *
   * Replacement rather than insertion is the contract: appending MX records would
   * leave two providers competing for inbound mail.
   */
  applyRecords(domain: string, records: readonly EmailRecord[]): Promise<void>
}

export const ConnectionOutcomeSchema = Type.Union([
  /** We wrote the records. */
  Type.Literal('applied'),
  /** The customer must add them. */
  Type.Literal('instructions-issued'),
  /** Refused before anything changed. */
  Type.Literal('refused'),
])
export type ConnectionOutcome = Static<typeof ConnectionOutcomeSchema>

export type ConnectionResult = Readonly<{
  outcome: ConnectionOutcome
  /** The records involved, either written or to be pasted. */
  records: readonly EmailRecord[]
  /** Values only the provider can supply, which the customer must fetch. */
  awaitingProviderValues: readonly EmailRecord[]
  /** Why it was refused, when it was. */
  conflict?: MailConflict
  /** Honest sentence about what actually happened. */
  message: string
}>

export type ConnectionRequest = Readonly<{
  domain: string
  providerId: string
  /** How we came to serve this domain. Decides whether we can write. */
  path: DomainPath
  /** The domain's current SPF record, so includes merge instead of duplicating. */
  existingSpf: string | null
  /** Which provider currently receives mail here, if any. */
  currentInboundProviderId: string | null
  /**
   * Cloudflare DNS state for a CONNECTED domain.
   *
   * Present only on the connect path, and what makes one-click possible there: once the domain's
   * DNS is on Cloudflare and verified, we can write the mail records ourselves instead of listing
   * them. Absent means we have no write access and the flow issues instructions.
   */
  cloudflare?: OnboardingFacts
}>

/**
 * Connect a provider.
 *
 * Conflict detection runs first and refuses before anything is written, because a
 * half-applied mail configuration is worse than none: the old provider has been
 * displaced and the new one is not yet working.
 */
export async function connectProvider(
  request: ConnectionRequest,
  writer: ZoneWriter | null,
): Promise<ConnectionResult> {
  const provider = findProvider(request.providerId)
  if (!provider) {
    return Object.freeze({
      outcome: 'refused' as const,
      records: Object.freeze([]),
      awaitingProviderValues: Object.freeze([]),
      message: `"${request.providerId}" is not a provider we can configure.`,
    })
  }

  const conflict = detectConflict(provider, request.currentInboundProviderId)
  if (conflict) {
    return Object.freeze({
      outcome: 'refused' as const,
      records: Object.freeze([]),
      awaitingProviderValues: Object.freeze([]),
      conflict,
      message: conflict.message,
    })
  }

  const records = planRecords(provider, request.existingSpf)
  const awaiting = records.filter((record) => record.perDomain === true)

  // The gate. Two ways to earn the right to write:
  //   - the REGISTER path, where we hold the domain and its DNS outright; or
  //   - a CONNECTED domain whose DNS is on Cloudflare and verified, which is what makes
  //     one-click work for a customer's own domain instead of handing them a list to paste.
  // Cloudflare state is consulted rather than the path alone because on the connect path DNS
  // control is no longer a property of how the domain was acquired - it is a property of where
  // its DNS actually lives.
  const mayWrite = canWriteDnsRecords(request.path)
    || (request.cloudflare !== undefined && canAutoWriteRecords(request.cloudflare))
  if (!mayWrite || writer === null) {
    return Object.freeze({
      outcome: 'instructions-issued' as const,
      records,
      awaitingProviderValues: Object.freeze(awaiting),
      message:
        `${request.domain} is not managed by us, so we cannot add these records for you. `
        + `Add the ${records.length} record(s) below at your DNS provider and we will `
        + 'confirm as soon as they resolve.'
        + (awaiting.length > 0
          ? ` ${awaiting.length} of them need a value ${provider.label} issues to you.`
          : ''),
    })
  }

  // Provider-issued values cannot be written by us, so applying would produce records
  // containing placeholders that verify false. Better to stop and ask for them.
  if (awaiting.length > 0) {
    return Object.freeze({
      outcome: 'instructions-issued' as const,
      records,
      awaitingProviderValues: Object.freeze(awaiting),
      message:
        `${provider.label} issues ${awaiting.length} value(s) specific to your domain — `
        + 'a DKIM key or verification token. Supply those and we will write every record '
        + `for ${request.domain} in one step.`,
    })
  }

  await writer.applyRecords(request.domain, records)

  return Object.freeze({
    outcome: 'applied' as const,
    records,
    awaitingProviderValues: Object.freeze([]),
    message:
      `Wrote ${records.length} record(s) for ${request.domain}. Mail will start working `
      + 'once they propagate, usually within the hour.',
  })
}

export type ConnectionStatus = Readonly<{
  /** Whether mail is actually flowing, not whether we think it is configured. */
  delivering: boolean
  verification: VerificationResult
  /** What to show the customer now. */
  message: string
  /** Seconds until the next check. */
  recheckInSeconds: number
}>

/**
 * Report the live state of a connection.
 *
 * Reads DNS rather than trusting what was written. A record we applied can be
 * overwritten by the customer's registrar or by another tool, and a connection that
 * was working yesterday tells you nothing about today.
 */
export async function connectionStatus(
  resolver: MailDnsResolver,
  records: readonly EmailRecord[],
  domain: string,
  attempt = 1,
): Promise<ConnectionStatus> {
  const verification = await verifyConnection(resolver, records, domain)

  const message = verification.delivering
    ? `Mail is being delivered for ${domain}.`
    : verification.misconfigured.length > 0
      // Named specifically, because waiting is the wrong advice here and a generic
      // "not ready yet" would invite exactly that.
      ? `${verification.misconfigured.length} record(s) resolve to the wrong value and will `
        + 'not fix themselves: '
        + verification.misconfigured.map((verdict) => verdict.host).join(', ')
      : verification.likelyPropagating
        ? 'The records are not visible yet. DNS usually propagates within the hour.'
        : `Mail is not yet being delivered for ${domain}.`

  return Object.freeze({
    delivering: verification.delivering,
    verification,
    message,
    recheckInSeconds: nextDelay(verification, attempt),
  })
}

function nextDelay(verification: VerificationResult, attempt: number): number {
  if (verification.misconfigured.length > 0 || verification.delivering) return 86_400
  return Math.min(3_600, 30 * Math.max(1, attempt) ** 2)
}

/**
 * The records a customer must paste, formatted for display.
 *
 * Priority is shown only for MX, because a preference column on a TXT row invites
 * somebody to fill it in.
 */
export function instructionRows(
  records: readonly EmailRecord[],
): readonly Readonly<{
  type: string
  host: string
  value: string
  priority: string
  ttl: string
  note: string
}>[] {
  return Object.freeze(records.map((record) => Object.freeze({
    type: record.type,
    host: record.host,
    value: record.value,
    priority: record.type === 'MX' && record.priority !== undefined
      ? String(record.priority)
      : '',
    ttl: String(record.ttlSeconds ?? 3600),
    // Both facts matter and a record can carry both: a DKIM key is issued by the
    // provider AND optional. Reporting only the placeholder would hide that it can be
    // skipped; reporting only optionality would let somebody paste the placeholder.
    note: [
      record.required ? 'Required.' : 'Optional, but improves deliverability.',
      ...(record.perDomain === true
        ? ['Use the value your provider issued, not this placeholder.']
        : []),
    ].join(' '),
  })))
}

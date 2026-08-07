/**
 * Email providers as a record catalogue.
 *
 * Connecting a mailbox is, mechanically, writing a known set of DNS records. Every
 * provider needs a different set, but the *shape* is identical — some MX records, an
 * SPF include, DKIM keys, sometimes a verification token. So providers are declared
 * as data and one code path applies any of them. Adding a provider is a new entry
 * here, not a new integration.
 *
 * Two rules exist because breaking them breaks mail delivery silently, which is the
 * worst failure mode a hosting product has:
 *
 *   - **Only one MX set can win.** MX records are not additive across providers: a
 *     domain pointing at both Google and Zoho delivers unpredictably to one of them.
 *     Connecting a second provider must therefore *replace*, never append.
 *   - **A domain may have exactly one SPF record.** Two SPF TXT records make the
 *     domain's SPF invalid outright (RFC 7208 §3.2 — multiple records is a
 *     permerror), which typically means mail starts failing authentication rather
 *     than obviously erroring. So SPF includes must merge into a single record.
 *
 * Both are enforced here rather than left to the caller, because both look fine right
 * up until mail stops arriving.
 */

import { Type, type Static } from '@core/utils/typeboxHelpers'

/**
 * Record types email connection needs.
 *
 * MX is the notable addition: the existing hosted DNS instruction table permits only
 * CNAME, TXT and A, so persisting these needs that constraint widened.
 */
export const EmailRecordTypeSchema = Type.Union([
  Type.Literal('MX'),
  Type.Literal('TXT'),
  Type.Literal('CNAME'),
])
export type EmailRecordType = Static<typeof EmailRecordTypeSchema>

/** What a record is for, so a partial connection can be described precisely. */
export const RecordPurposeSchema = Type.Union([
  /** Inbound mail routing. Without it, mail does not arrive. */
  Type.Literal('mail-routing'),
  /** SPF: which servers may send as this domain. */
  Type.Literal('spf'),
  /** DKIM signing key. Absent, mail is far more likely to be filtered. */
  Type.Literal('dkim'),
  /** DMARC policy. */
  Type.Literal('dmarc'),
  /** Provider ownership verification. */
  Type.Literal('verification'),
  /** Client autodiscovery convenience. */
  Type.Literal('autodiscover'),
])
export type RecordPurpose = Static<typeof RecordPurposeSchema>

export const EmailRecordSchema = Type.Object({
  type: EmailRecordTypeSchema,
  /**
   * Host relative to the domain. `@` is the domain itself.
   * Kept relative so one catalogue entry serves every customer domain.
   */
  host: Type.String({ minLength: 1, maxLength: 253 }),
  value: Type.String({ minLength: 1, maxLength: 2048 }),
  /** MX preference. Lower wins. Meaningless on other types. */
  priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 65_535 })),
  ttlSeconds: Type.Optional(Type.Integer({ minimum: 60, maximum: 604_800 })),
  purpose: RecordPurposeSchema,
  /**
   * Whether the connection is broken without it.
   *
   * Distinguished so a connection missing only DKIM is reported as working-but-weak
   * rather than either "done" or "failed" — both of which would be wrong.
   */
  required: Type.Boolean(),
  /**
   * True when the value is per-customer and cannot come from the catalogue — a DKIM
   * key or a verification token the provider issues. The connection flow has to
   * fetch it rather than assume the catalogue value is usable.
   */
  perDomain: Type.Optional(Type.Boolean()),
}, { additionalProperties: false })
export type EmailRecord = Readonly<Static<typeof EmailRecordSchema>>

export const EmailProviderSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 64 }),
  label: Type.String({ minLength: 1, maxLength: 120 }),
  /**
   * Whether this provider handles inbound mail (a mailbox) or only sending.
   *
   * The distinction matters: a sending-only provider must not replace the MX records
   * of a domain whose mailboxes live elsewhere, which is a very easy way to take
   * somebody's email down while "just adding transactional sending".
   */
  handlesInbound: Type.Boolean(),
  /** The SPF include token, merged into the single SPF record. */
  spfInclude: Type.Optional(Type.String({ minLength: 1, maxLength: 253 })),
  records: Type.Array(EmailRecordSchema, { minItems: 1, maxItems: 32 }),
}, { additionalProperties: false })
export type EmailProvider = Readonly<Static<typeof EmailProviderSchema>>

const DAY = 3600

/**
 * Type each record as it is declared.
 *
 * Without this, `type: 'MX'` widens to `string` and the catalogue no longer satisfies
 * its own schema — the failure lands as an unreadable assignability error rather than
 * on the line that caused it.
 */
function record(value: EmailRecord): EmailRecord {
  return Object.freeze(value)
}

/**
 * The shipped catalogue.
 *
 * Values are the providers' published defaults. Anything the provider issues per
 * domain — DKIM selectors, verification tokens — is marked `perDomain` with a
 * placeholder, because inventing those would produce records that look right and
 * verify false.
 */
export const EMAIL_PROVIDERS: readonly EmailProvider[] = Object.freeze([
  Object.freeze({
    id: 'google-workspace',
    label: 'Google Workspace',
    handlesInbound: true,
    spfInclude: '_spf.google.com',
    records: [
      record({ type: 'MX', host: '@', value: 'smtp.google.com', priority: 1, ttlSeconds: DAY,
        purpose: 'mail-routing', required: true }),
      record({ type: 'TXT', host: '@', value: 'v=spf1 include:_spf.google.com ~all', ttlSeconds: DAY,
        purpose: 'spf', required: true }),
      record({ type: 'TXT', host: 'google._domainkey', value: 'PROVIDER_ISSUED_DKIM',
        ttlSeconds: DAY, purpose: 'dkim', required: false, perDomain: true }),
      record({ type: 'TXT', host: '@', value: 'PROVIDER_ISSUED_VERIFICATION', ttlSeconds: DAY,
        purpose: 'verification', required: true, perDomain: true }),
    ],
  }),

  Object.freeze({
    id: 'microsoft-365',
    label: 'Microsoft 365',
    handlesInbound: true,
    spfInclude: 'spf.protection.outlook.com',
    records: [
      // The MX host is tenant-specific, hence perDomain.
      record({ type: 'MX', host: '@', value: 'PROVIDER_ISSUED_MX', priority: 0, ttlSeconds: DAY,
        purpose: 'mail-routing', required: true, perDomain: true }),
      record({ type: 'TXT', host: '@', value: 'v=spf1 include:spf.protection.outlook.com -all',
        ttlSeconds: DAY, purpose: 'spf', required: true }),
      record({ type: 'CNAME', host: 'autodiscover', value: 'autodiscover.outlook.com',
        ttlSeconds: DAY, purpose: 'autodiscover', required: false }),
      record({ type: 'TXT', host: '@', value: 'PROVIDER_ISSUED_VERIFICATION', ttlSeconds: DAY,
        purpose: 'verification', required: true, perDomain: true }),
    ],
  }),

  Object.freeze({
    id: 'zoho-mail',
    label: 'Zoho Mail',
    handlesInbound: true,
    spfInclude: 'zoho.com',
    records: [
      record({ type: 'MX', host: '@', value: 'mx.zoho.com', priority: 10, ttlSeconds: DAY,
        purpose: 'mail-routing', required: true }),
      record({ type: 'MX', host: '@', value: 'mx2.zoho.com', priority: 20, ttlSeconds: DAY,
        purpose: 'mail-routing', required: true }),
      record({ type: 'MX', host: '@', value: 'mx3.zoho.com', priority: 50, ttlSeconds: DAY,
        purpose: 'mail-routing', required: true }),
      record({ type: 'TXT', host: '@', value: 'v=spf1 include:zoho.com ~all', ttlSeconds: DAY,
        purpose: 'spf', required: true }),
      record({ type: 'TXT', host: 'zoho._domainkey', value: 'PROVIDER_ISSUED_DKIM', ttlSeconds: DAY,
        purpose: 'dkim', required: false, perDomain: true }),
      record({ type: 'TXT', host: '@', value: 'PROVIDER_ISSUED_VERIFICATION', ttlSeconds: DAY,
        purpose: 'verification', required: true, perDomain: true }),
    ],
  }),

  Object.freeze({
    id: 'resend',
    label: 'Resend',
    // Sending only. It must never take over a domain's inbound mail.
    handlesInbound: false,
    spfInclude: 'amazonses.com',
    records: [
      record({ type: 'TXT', host: 'send', value: 'v=spf1 include:amazonses.com ~all', ttlSeconds: DAY,
        purpose: 'spf', required: true }),
      record({ type: 'TXT', host: 'resend._domainkey', value: 'PROVIDER_ISSUED_DKIM', ttlSeconds: DAY,
        purpose: 'dkim', required: true, perDomain: true }),
      record({ type: 'TXT', host: '_dmarc', value: 'v=DMARC1; p=none;', ttlSeconds: DAY,
        purpose: 'dmarc', required: false }),
    ],
  }),

  Object.freeze({
    id: 'sendgrid',
    label: 'SendGrid',
    handlesInbound: false,
    spfInclude: 'sendgrid.net',
    records: [
      record({ type: 'CNAME', host: 'PROVIDER_ISSUED_LINK', value: 'sendgrid.net', ttlSeconds: DAY,
        purpose: 'mail-routing', required: true, perDomain: true }),
      record({ type: 'CNAME', host: 's1._domainkey', value: 'PROVIDER_ISSUED_DKIM1', ttlSeconds: DAY,
        purpose: 'dkim', required: true, perDomain: true }),
      record({ type: 'CNAME', host: 's2._domainkey', value: 'PROVIDER_ISSUED_DKIM2', ttlSeconds: DAY,
        purpose: 'dkim', required: true, perDomain: true }),
    ],
  }),
])

export function findProvider(id: string): EmailProvider | null {
  return EMAIL_PROVIDERS.find((provider) => provider.id === id) ?? null
}

/** Records a provider needs that only the provider can supply. */
export function perDomainRecords(provider: EmailProvider): readonly EmailRecord[] {
  return Object.freeze(provider.records.filter((record) => record.perDomain === true))
}

/** Records required for the connection to work at all. */
export function requiredRecords(provider: EmailProvider): readonly EmailRecord[] {
  return Object.freeze(provider.records.filter((record) => record.required))
}

export type MailConflict = Readonly<{
  code: 'inbound-already-configured' | 'sending-provider-would-take-inbound'
  message: string
}>

/**
 * Whether connecting a provider conflicts with what is already configured.
 *
 * The check that prevents the two worst outcomes: silently splitting inbound mail
 * between two providers, and letting a sending-only integration hijack a domain whose
 * mailboxes live elsewhere.
 */
export function detectConflict(
  incoming: EmailProvider,
  currentInboundProviderId: string | null,
): MailConflict | null {
  if (!incoming.handlesInbound) {
    // Sending-only providers add no MX, so they never conflict over inbound.
    const wouldReplaceMx = incoming.records.some((record) => record.type === 'MX')
    if (wouldReplaceMx && currentInboundProviderId !== null) {
      return {
        code: 'sending-provider-would-take-inbound',
        message:
          `${incoming.label} sends mail but does not host mailboxes, yet it declares MX `
          + `records. Applying them would move inbound mail away from `
          + `${currentInboundProviderId}.`,
      }
    }
    return null
  }

  if (currentInboundProviderId !== null && currentInboundProviderId !== incoming.id) {
    return {
      code: 'inbound-already-configured',
      message:
        `${currentInboundProviderId} already receives mail for this domain. MX records are `
        + `not additive — adding ${incoming.label} alongside it would deliver mail `
        + 'unpredictably to one of them. Switch providers explicitly to replace it.',
    }
  }

  return null
}

/**
 * Merge SPF includes into one record.
 *
 * A domain may publish exactly one SPF record; two make SPF invalid for the whole
 * domain. So adding a sender means editing the existing record, never adding another.
 *
 * The qualifier is taken from the strictest existing policy: `-all` (hard fail) is
 * kept over `~all` (soft fail), because loosening somebody's SPF as a side effect of
 * adding a sender is a security regression they did not ask for.
 */
export function mergeSpf(
  existingRecord: string | null,
  includesToAdd: readonly string[],
): string {
  const existingIncludes: string[] = []
  let qualifier = '~all'

  if (existingRecord) {
    for (const term of existingRecord.trim().split(/\s+/)) {
      if (term.toLowerCase() === 'v=spf1') continue
      if (/^[~\-+?]all$/i.test(term)) {
        // Keep the strictest: hard fail wins over soft fail.
        qualifier = term.toLowerCase() === '-all' || qualifier === '-all' ? '-all' : term
        continue
      }
      if (term.length > 0) existingIncludes.push(term)
    }
  }

  const seen = new Set(existingIncludes.map((term) => term.toLowerCase()))
  for (const include of includesToAdd) {
    const term = include.startsWith('include:') ? include : `include:${include}`
    if (seen.has(term.toLowerCase())) continue
    seen.add(term.toLowerCase())
    existingIncludes.push(term)
  }

  return `v=spf1 ${existingIncludes.join(' ')} ${qualifier}`.replace(/\s+/g, ' ').trim()
}

/**
 * The record set to apply, with SPF already merged.
 *
 * Idempotent: applying the same provider twice converges on the same set rather than
 * duplicating MX rows, because the result is computed from the desired end state
 * rather than appended to what is there.
 */
export function planRecords(
  provider: EmailProvider,
  existingSpf: string | null,
): readonly EmailRecord[] {
  const planned: EmailRecord[] = []

  for (const record of provider.records) {
    if (record.purpose === 'spf') {
      // Replaced by the merged record below, never emitted as a second SPF entry.
      continue
    }
    planned.push(record)
  }

  if (provider.spfInclude) {
    const spfHost = provider.records.find((record) => record.purpose === 'spf')?.host ?? '@'
    planned.push(Object.freeze({
      type: 'TXT' as const,
      host: spfHost,
      value: mergeSpf(existingSpf, [provider.spfInclude]),
      ttlSeconds: DAY,
      purpose: 'spf' as const,
      required: true,
    }))
  }

  return Object.freeze(planned)
}

/** Whether every required record is present and resolved. */
export function connectionComplete(
  provider: EmailProvider,
  resolvedPurposes: readonly RecordPurpose[],
): { complete: true } | { complete: false, missing: readonly RecordPurpose[] } {
  const resolved = new Set(resolvedPurposes)
  const missing = [...new Set(
    requiredRecords(provider)
      .map((record) => record.purpose)
      .filter((purpose) => !resolved.has(purpose)),
  )]
  return missing.length === 0
    ? { complete: true }
    : { complete: false, missing: Object.freeze(missing) }
}

/**
 * Deliverability warnings for a connection that works but is weak.
 *
 * DKIM and DMARC are not required for mail to send, but without them it is far more
 * likely to be filtered — so a connection missing them is worth saying so about
 * rather than reporting as simply done.
 */
export function deliverabilityWarnings(
  resolvedPurposes: readonly RecordPurpose[],
): readonly string[] {
  const resolved = new Set(resolvedPurposes)
  const warnings: string[] = []
  if (!resolved.has('dkim')) {
    warnings.push('No DKIM record resolves. Mail will send but is much more likely to be '
      + 'treated as spam.')
  }
  if (!resolved.has('dmarc')) {
    warnings.push('No DMARC policy is published. Add one once DKIM and SPF both pass.')
  }
  return Object.freeze(warnings)
}

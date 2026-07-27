import type { DbClient } from '../../db/client'
import {
  CustomOfferSchema,
  PriceBookSchema,
  evidenceSha256,
  type CustomOffer,
  type PriceBook,
} from '../entitlements'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import {
  PlatformCheckoutError,
  type PlatformCheckoutChannel,
  type PlatformCheckoutClaimResult,
  type PlatformCheckoutDestination,
  type PlatformCheckoutInitializationClaim,
  type PlatformCheckoutMetadata,
  type PlatformCheckoutObligation,
  type PlatformCheckoutObligationKind,
  type PlatformCheckoutPrepareInput,
  type PlatformCheckoutRecord,
  type PlatformCheckoutRepository,
  type PlatformCheckoutSourceIntent,
} from './contracts'

type CandidateRow = Readonly<{
  checkout_id: string
  candidate_id: string
  entitlement_candidate_id: string | null
  source_kind: 'public-plan' | 'private-offer'
  source_id: string
  source_version: string
  organization_id: string
  workspace_id: string
  site_id: string
  profile_id: string
  customer_actor_id: string
  payer_email_sha256: string
  cadence: 'monthly' | 'annual'
  currency: 'KES'
  callback_url: string
  allowed_channels: string[] | string
  evidence_sha256: string
  state: 'awaiting-payment' | 'cancelled'
  created_at: Date | string
  cancelled_at: Date | string | null
}>
type ObligationRow = Readonly<{
  checkout_id: string
  kind: PlatformCheckoutObligationKind
  reference: string | null
  amount_minor: number | string
  currency: 'KES'
  state: PlatformCheckoutObligation['state']
  authorization_url: string | null
  callback_verified_at: Date | string | null
  claim_id?: string | null
  claim_expires_at?: Date | string | null
}>
type PriceRow = Readonly<{ private_json: string | Record<string, unknown> }>
type OfferRow = Readonly<{
  state: CustomOffer['state']
  accepted_at: Date | string | null
  private_json: string | Record<string, unknown>
  candidate_id: string | null
  candidate_state: string | null
  setup_fee_settled: boolean | null
  recurring_settled: boolean | null
  activated_at: Date | string | null
  paid_transfer_pending: boolean | null
  contract_id: string | null
}>
type ReplacementOfferRow = Readonly<{
  state: CustomOffer['state']
  accepted_at: Date | string | null
  expires_at: Date | string
  private_json: string | Record<string, unknown>
}>

type ResolvedCheckoutSource = Readonly<{
  source: PlatformCheckoutSourceIntent
  cadence: 'monthly' | 'annual'
  currency: 'KES'
  recurringAmountMinor: number
  setupFeeMinor: number
  entitlementCandidateId: string | null
}>

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
function json(value: string | Record<string, unknown>): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value
}
function amount(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 1_000_000_000) {
    throw new PlatformCheckoutError('verification', 'Stored checkout amount is invalid.')
  }
  return parsed
}
function channels(value: string[] | string): readonly PlatformCheckoutChannel[] {
  const parsed = typeof value === 'string'
    ? value.replace(/^\{|\}$/g, '').split(',').filter(Boolean)
    : value
  if (
    parsed.length < 1
    || parsed.length > 3
    || parsed.some((channel) => !['card', 'mobile_money', 'bank'].includes(channel))
  ) {
    throw new PlatformCheckoutError('verification', 'Stored checkout channels are invalid.')
  }
  return Object.freeze([...parsed]) as readonly PlatformCheckoutChannel[]
}
function sourceKey(source: PlatformCheckoutSourceIntent): string {
  return source.kind === 'public-plan'
    ? `public-plan:${source.planId}:${source.priceBookVersion}:${source.cadence}`
    : `private-offer:${source.offerId}:${source.offerVersion}`
}
function identityKey(input: PlatformCheckoutPrepareInput): string {
  return [
    sourceKey(input.source),
    input.destination.organizationId,
    input.destination.workspaceId,
    input.destination.siteId,
    input.destination.profileId,
  ].join(':')
}
function stableId(prefix: string, value: string): string {
  return `${prefix}:${new Bun.CryptoHasher('sha256').update(value).digest('hex').slice(0, 32)}`
}
function sameDestination(left: PlatformCheckoutDestination, right: PlatformCheckoutDestination): boolean {
  return left.organizationId === right.organizationId
    && left.workspaceId === right.workspaceId
    && left.siteId === right.siteId
    && left.profileId === right.profileId
}
function sourceFrom(row: CandidateRow): PlatformCheckoutSourceIntent {
  if (row.source_kind === 'public-plan') {
    return Object.freeze({
      kind: 'public-plan',
      planId: row.source_id,
      priceBookVersion: row.source_version,
      cadence: row.cadence,
    })
  }
  const offerVersion = Number(row.source_version)
  if (!Number.isSafeInteger(offerVersion) || offerVersion < 1) {
    throw new PlatformCheckoutError('verification', 'Stored private offer version is invalid.')
  }
  return Object.freeze({
    kind: 'private-offer',
    offerId: row.source_id,
    offerVersion,
  })
}
function mapObligation(row: ObligationRow): PlatformCheckoutObligation {
  const amountMinor = amount(row.amount_minor)
  if (amountMinor < 1) throw new PlatformCheckoutError('verification', 'Stored obligation is empty.')
  return Object.freeze({
    kind: row.kind,
    amountMinor,
    currency: row.currency,
    reference: row.reference,
    authorizationUrl: row.authorization_url,
    state: row.state,
    callbackVerifiedAt: row.callback_verified_at ? iso(row.callback_verified_at) : null,
  })
}
function metadata(record: PlatformCheckoutRecord, item: PlatformCheckoutObligation): PlatformCheckoutMetadata {
  return Object.freeze({
    checkoutId: record.checkoutId,
    candidateId: record.candidateId,
    sourceKind: record.source.kind,
    sourceId: record.source.kind === 'public-plan' ? record.source.planId : record.source.offerId,
    sourceVersion: record.source.kind === 'public-plan'
      ? record.source.priceBookVersion
      : String(record.source.offerVersion),
    organizationId: record.destination.organizationId,
    workspaceId: record.destination.workspaceId,
    siteId: record.destination.siteId,
    customerActorId: record.customerActorId,
    payerEmailSha256: record.payerEmailSha256,
    kind: item.kind,
    amountMinor: item.amountMinor,
    currency: item.currency,
    cadence: record.cadence,
    callbackUrl: record.callbackUrl,
    allowedChannels: [...record.allowedChannels],
    evidenceSha256: record.evidenceSha256,
  })
}

export class PostgresPlatformCheckoutRepository implements PlatformCheckoutRepository {
  readonly #db: DbClient
  readonly #now: () => Date
  readonly #claimFactory: () => string
  readonly #claimLeaseMs: number

  constructor(db: DbClient, options: Readonly<{
    now?: () => Date
    claimFactory?: () => string
    claimLeaseMs?: number
  }> = {}) {
    if (db.dialect !== 'postgres') {
      throw new Error('Platform checkout requires PostgreSQL authority.')
    }
    const claimLeaseMs = options.claimLeaseMs ?? 30_000
    if (!Number.isSafeInteger(claimLeaseMs) || claimLeaseMs < 1_000 || claimLeaseMs > 300_000) {
      throw new TypeError('Checkout claim lease must be between 1 and 300 seconds.')
    }
    this.#db = db
    this.#now = options.now ?? (() => new Date())
    this.#claimFactory = options.claimFactory ?? (() => crypto.randomUUID())
    this.#claimLeaseMs = claimLeaseMs
  }

  prepare(input: PlatformCheckoutPrepareInput): Promise<PlatformCheckoutRecord> {
    return this.#db.transaction(async (tx) => {
      const identity = identityKey(input)
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:checkout:${identity}`}, 0))`
      await this.#assertDestination(tx, input.destination)
      const internal = await tx<{ denied: number }>`
        select 1 as denied from fuma_entitlement_grants
        where organization_id=${input.destination.organizationId} and kind='platform-internal'
      `
      if (internal.rows[0]) {
        throw new PlatformCheckoutError('internal', 'Internal organizations cannot enter checkout.')
      }
      const resolved = await this.#resolveSource(tx, input.source, input.destination)
      const existing = await this.#findByIdentity(tx, resolved.source, input.destination)
      if (existing) {
        if (
          existing.customerActorId !== input.customerActorId
          || existing.payerEmailSha256 !== input.payerEmailSha256
        ) {
          throw new PlatformCheckoutError('conflict', 'Checkout customer identity changed.')
        }
        return existing
      }
      const checkoutId = stableId('checkout', identity)
      const candidateId = resolved.entitlementCandidateId
        ?? stableId('checkout-candidate', identity)
      const callbackUrl = input.callbackUrlFor(checkoutId)
      const immutable = Object.freeze({
        checkoutId,
        candidateId,
        source: resolved.source,
        destination: input.destination,
        customerActorId: input.customerActorId,
        payerEmailSha256: input.payerEmailSha256,
        cadence: resolved.cadence,
        currency: resolved.currency,
        recurringAmountMinor: resolved.recurringAmountMinor,
        setupFeeMinor: resolved.setupFeeMinor,
        callbackUrl,
        allowedChannels: [...input.allowedChannels],
      })
      const evidence = evidenceSha256(immutable)
      const now = this.#now().toISOString()
      const sourceId = resolved.source.kind === 'public-plan'
        ? resolved.source.planId
        : resolved.source.offerId
      const sourceVersion = resolved.source.kind === 'public-plan'
        ? resolved.source.priceBookVersion
        : String(resolved.source.offerVersion)
      await tx`
        insert into fuma_platform_checkout_candidates_v2 (
          checkout_id,candidate_id,entitlement_candidate_id,source_kind,source_id,source_version,
          organization_id,workspace_id,site_id,profile_id,customer_actor_id,payer_email_sha256,
          cadence,currency,recurring_amount_minor,setup_fee_minor,callback_url,allowed_channels,
          evidence_sha256,state,created_at,cancelled_at
        ) values (
          ${checkoutId},${candidateId},${resolved.entitlementCandidateId},${resolved.source.kind},
          ${sourceId},${sourceVersion},${input.destination.organizationId},
          ${input.destination.workspaceId},${input.destination.siteId},${input.destination.profileId},
          ${input.customerActorId},${input.payerEmailSha256},${resolved.cadence},${resolved.currency},
          ${resolved.recurringAmountMinor},${resolved.setupFeeMinor},${callbackUrl},
          ${`{${input.allowedChannels.join(',')}}`},${evidence},'awaiting-payment',${now},null
        )
      `
      if (resolved.setupFeeMinor > 0) {
        await this.#insertObligation(tx, checkoutId, 'setup', resolved.setupFeeMinor, now)
      }
      await this.#insertObligation(
        tx,
        checkoutId,
        'recurring',
        resolved.recurringAmountMinor,
        now,
      )
      return (await this.#load(tx, checkoutId))!
    })
  }

  async #assertDestination(db: DbClient, destination: PlatformCheckoutDestination): Promise<void> {
    const found = await db<{ authorized: number }>`
      select 1 as authorized from auth_organizations o
      join fuma_workspaces w on w.organization_id=o.id and w.id=${destination.workspaceId} and w.status='active'
      join fuma_sites s on s.organization_id=o.id and s.workspace_id=w.id
        and s.id=${destination.siteId} and s.status='active' and s.profile_id=${destination.profileId}
      where o.id=${destination.organizationId}
      for share of w,s
    `
    if (!found.rows[0]) {
      throw new PlatformCheckoutError('scope', 'Checkout destination is not current.')
    }
  }

  async #resolveSource(
    db: DbClient,
    source: PlatformCheckoutSourceIntent,
    destination: PlatformCheckoutDestination,
  ): Promise<ResolvedCheckoutSource> {
    const now = this.#now()
    if (source.kind === 'public-plan') {
      const current = await db<{ version: string }>`
        select version from fuma_price_books
        where published_at is not null and effective_at<=${now.toISOString()}
        order by effective_at desc,published_at desc,version desc limit 1
      `
      if (current.rows[0]?.version !== source.priceBookVersion) {
        throw new PlatformCheckoutError('stale', 'Public price-book version is not current.')
      }
      const result = await db<PriceRow>`
        select e.private_json from fuma_price_book_evidence e
        join fuma_price_books p on p.version=e.version
        where e.version=${source.priceBookVersion}
        for share of p,e
      `
      const parsed = safeParseValue(PriceBookSchema, result.rows[0]
        ? json(result.rows[0].private_json)
        : null)
      if (!parsed.ok) throw new PlatformCheckoutError('not-found', 'Exact public plan was not found.')
      const book: PriceBook = parsed.value
      const plan = book.plans.find((candidate) => (
        candidate.planId === source.planId && candidate.cadence === source.cadence
      ))
      if (!plan) throw new PlatformCheckoutError('not-found', 'Exact public plan was not found.')
      if (
        plan.profile !== destination.profileId
        || plan.offeringClass !== 'paid'
        || !plan.checkoutAvailable
        || Date.parse(book.effectiveAt) > now.getTime()
        || (plan.expiresAt !== null && Date.parse(plan.expiresAt) <= now.getTime())
      ) {
        throw new PlatformCheckoutError('stale', 'Public plan is not currently checkoutable.')
      }
      return Object.freeze({
        source,
        cadence: plan.cadence,
        currency: book.currency,
        recurringAmountMinor: plan.amountMinor,
        setupFeeMinor: 0,
        entitlementCandidateId: null,
      })
    }
    const result = await db<OfferRow>`
      select o.state,e.accepted_at,e.private_json,c.candidate_id,c.state candidate_state,
        c.setup_fee_settled,c.recurring_settled,c.activated_at,c.paid_transfer_pending,
        oc.contract_id
      from fuma_custom_offers o
      join fuma_custom_offer_evidence e on e.offer_id=o.offer_id and e.offer_version=o.version
      join fuma_contract_candidates c on c.offer_id=o.offer_id and c.offer_version=o.version
      left join fuma_organization_contracts oc on oc.candidate_id=c.candidate_id
      where o.offer_id=${source.offerId} and o.version=${source.offerVersion}
      for share of o,e,c
    `
    const row = result.rows[0]
    const parsed = safeParseValue(CustomOfferSchema, row ? {
      ...(json(row.private_json) as Record<string, unknown>),
      state: row.state,
      acceptedAt: row.accepted_at ? iso(row.accepted_at) : null,
    } : null)
    if (!parsed.ok || !row) {
      throw new PlatformCheckoutError('not-found', 'Exact private offer was not found.')
    }
    const offer = parsed.value
    const replacements = await db<ReplacementOfferRow>`
      select o.state,e.accepted_at,e.private_json,o.expires_at
      from fuma_custom_offer_evidence e
      join fuma_custom_offers o on o.offer_id=e.offer_id and o.version=e.offer_version
      where o.state in ('issued','accepted') and o.expires_at>${now.toISOString()}
    `
    const replaced = replacements.rows.some((candidate) => {
      const parsedCandidate = safeParseValue(CustomOfferSchema, {
        ...(json(candidate.private_json) as Record<string, unknown>),
        state: candidate.state,
        acceptedAt: candidate.accepted_at ? iso(candidate.accepted_at) : null,
      })
      if (!parsedCandidate.ok) {
        throw new PlatformCheckoutError('verification', 'Stored replacement offer is invalid.')
      }
      return parsedCandidate.value.replaces?.offerId === source.offerId
        && parsedCandidate.value.replaces.version === source.offerVersion
    })
    if (replaced) throw new PlatformCheckoutError('stale', 'Private offer was replaced.')
    if (
      row.contract_id
      || row.setup_fee_settled
      || row.recurring_settled
      || row.activated_at
      || row.paid_transfer_pending
    ) {
      throw new PlatformCheckoutError('already-settled', 'Private offer is already settled.')
    }
    if (
      offer.state !== 'accepted'
      || row.candidate_state !== 'awaiting-payment'
      || !row.candidate_id
      || offer.destinationOrganizationId !== destination.organizationId
      || offer.destinationWorkspaceId !== destination.workspaceId
      || offer.siteId !== destination.siteId
      || Date.parse(offer.effectiveAt) > now.getTime()
      || Date.parse(offer.expiresAt) <= now.getTime()
    ) {
      throw new PlatformCheckoutError('stale', 'Accepted private offer is unavailable.')
    }
    return Object.freeze({
      source,
      cadence: offer.cadence,
      currency: offer.currency,
      recurringAmountMinor: offer.recurringAmountMinor,
      setupFeeMinor: offer.setupFeeMinor,
      entitlementCandidateId: row.candidate_id,
    })
  }

  async #findByIdentity(
    db: DbClient,
    source: PlatformCheckoutSourceIntent,
    destination: PlatformCheckoutDestination,
  ): Promise<PlatformCheckoutRecord | null> {
    const sourceId = source.kind === 'public-plan' ? source.planId : source.offerId
    const sourceVersion = source.kind === 'public-plan'
      ? source.priceBookVersion
      : String(source.offerVersion)
    const result = await db<{ checkout_id: string }>`
      select checkout_id from fuma_platform_checkout_candidates_v2
      where source_kind=${source.kind} and source_id=${sourceId} and source_version=${sourceVersion}
        and cadence=${source.kind === 'public-plan' ? source.cadence : await this.#offerCadence(db, source)}
        and organization_id=${destination.organizationId} and workspace_id=${destination.workspaceId}
        and site_id=${destination.siteId} and profile_id=${destination.profileId}
      for update
    `
    return result.rows[0] ? await this.#load(db, result.rows[0].checkout_id) : null
  }

  async #offerCadence(
    db: DbClient,
    source: Extract<PlatformCheckoutSourceIntent, { kind: 'private-offer' }>,
  ): Promise<'monthly' | 'annual'> {
    const result = await db<{ cadence: 'monthly' | 'annual' }>`
      select cadence from fuma_custom_offers where offer_id=${source.offerId} and version=${source.offerVersion}
    `
    if (!result.rows[0]) throw new PlatformCheckoutError('not-found', 'Exact private offer was not found.')
    return result.rows[0].cadence
  }

  async #insertObligation(
    db: DbClient,
    checkoutId: string,
    kind: PlatformCheckoutObligationKind,
    amountMinor: number,
    now: string,
  ): Promise<void> {
    await db`
      insert into fuma_platform_checkout_obligations_v2 (
        checkout_id,kind,reference,amount_minor,currency,state,authorization_url,
        claim_id,claim_expires_at,callback_verified_at,attempt_count,created_at,updated_at
      ) values (${checkoutId},${kind},null,${amountMinor},'KES','pending',null,null,null,null,0,${now},${now})
    `
  }

  async #load(db: DbClient, checkoutId: string): Promise<PlatformCheckoutRecord | null> {
    const candidate = await db<CandidateRow>`
      select checkout_id,candidate_id,entitlement_candidate_id,source_kind,source_id,source_version,
        organization_id,workspace_id,site_id,profile_id,customer_actor_id,payer_email_sha256,
        cadence,currency,callback_url,allowed_channels,evidence_sha256,state,created_at,cancelled_at
      from fuma_platform_checkout_candidates_v2 where checkout_id=${checkoutId}
    `
    const row = candidate.rows[0]
    if (!row) return null
    const obligations = await db<ObligationRow>`
      select checkout_id,kind,reference,amount_minor,currency,state,authorization_url,callback_verified_at
      from fuma_platform_checkout_obligations_v2 where checkout_id=${checkoutId} order by kind
    `
    const setup = obligations.rows.find((item) => item.kind === 'setup')
    const recurring = obligations.rows.find((item) => item.kind === 'recurring')
    if (!recurring) throw new PlatformCheckoutError('verification', 'Recurring obligation is missing.')
    return Object.freeze({
      checkoutId: row.checkout_id,
      candidateId: row.candidate_id,
      entitlementCandidateId: row.entitlement_candidate_id,
      state: row.state,
      source: sourceFrom(row),
      destination: Object.freeze({
        organizationId: row.organization_id,
        workspaceId: row.workspace_id,
        siteId: row.site_id,
        profileId: row.profile_id,
      }),
      customerActorId: row.customer_actor_id,
      payerEmailSha256: row.payer_email_sha256,
      cadence: row.cadence,
      currency: row.currency,
      callbackUrl: row.callback_url,
      allowedChannels: channels(row.allowed_channels),
      evidenceSha256: row.evidence_sha256,
      setup: setup ? mapObligation(setup) : null,
      recurring: mapObligation(recurring),
      createdAt: iso(row.created_at),
      cancelledAt: row.cancelled_at ? iso(row.cancelled_at) : null,
    })
  }

  async find(destination: PlatformCheckoutDestination, checkoutId: string): Promise<PlatformCheckoutRecord | null> {
    const record = await this.#load(this.#db, checkoutId)
    return record && sameDestination(record.destination, destination) ? record : null
  }

  claimInitialization(
    checkoutId: string,
    kind: PlatformCheckoutObligationKind,
    proposedReference: string,
  ): Promise<PlatformCheckoutClaimResult> {
    return this.#db.transaction(async (tx) => {
      const parent = await tx<{ state: 'awaiting-payment' | 'cancelled' }>`
        select state from fuma_platform_checkout_candidates_v2 where checkout_id=${checkoutId} for update
      `
      if (!parent.rows[0]) throw new PlatformCheckoutError('not-found', 'Checkout was not found.')
      if (parent.rows[0].state === 'cancelled') throw new PlatformCheckoutError('cancelled', 'Checkout is cancelled.')
      const selected = await tx<ObligationRow>`
        select checkout_id,kind,reference,amount_minor,currency,state,authorization_url,
          callback_verified_at,claim_id,claim_expires_at
        from fuma_platform_checkout_obligations_v2
        where checkout_id=${checkoutId} and kind=${kind} for update
      `
      const item = selected.rows[0]
      if (!item) throw new PlatformCheckoutError('invalid', 'Checkout obligation does not exist.')
      if (['ready', 'callback-verified'].includes(item.state)) {
        return Object.freeze({ state: 'ready' as const, record: (await this.#load(tx, checkoutId))! })
      }
      const now = this.#now()
      if (
        item.state === 'initializing'
        && item.claim_expires_at
        && new Date(item.claim_expires_at).getTime() > now.getTime()
      ) return Object.freeze({ state: 'busy' as const })
      const claimId = this.#claimFactory()
      const reference = item.reference ?? proposedReference
      const expiresAt = new Date(now.getTime() + this.#claimLeaseMs).toISOString()
      await tx`
        update fuma_platform_checkout_obligations_v2 set
          reference=${reference},state='initializing',authorization_url=null,
          claim_id=${claimId},claim_expires_at=${expiresAt},callback_verified_at=null,
          attempt_count=attempt_count+1,updated_at=${now.toISOString()}
        where checkout_id=${checkoutId} and kind=${kind}
      `
      return Object.freeze({
        state: 'claimed' as const,
        claim: Object.freeze({ claimId, checkoutId, kind, reference }),
      })
    })
  }

  async completeInitialization(claim: PlatformCheckoutInitializationClaim, authorizationUrl: string): Promise<void> {
    const updated = await this.#db`
      update fuma_platform_checkout_obligations_v2 o set
        state='ready',authorization_url=${authorizationUrl},claim_id=null,claim_expires_at=null,
        updated_at=${this.#now().toISOString()}
      where o.checkout_id=${claim.checkoutId} and o.kind=${claim.kind}
        and o.reference=${claim.reference} and o.state='initializing' and o.claim_id=${claim.claimId}
        and exists (select 1 from fuma_platform_checkout_candidates_v2 c
          where c.checkout_id=o.checkout_id and c.state='awaiting-payment')
    `
    if (updated.rowCount !== 1) throw new PlatformCheckoutError('conflict', 'Checkout claim is stale.')
  }

  async releaseInitialization(claim: PlatformCheckoutInitializationClaim): Promise<void> {
    const updated = await this.#db`
      update fuma_platform_checkout_obligations_v2 set
        state='failed',authorization_url=null,claim_id=null,claim_expires_at=null,
        callback_verified_at=null,updated_at=${this.#now().toISOString()}
      where checkout_id=${claim.checkoutId} and kind=${claim.kind}
        and reference=${claim.reference} and state='initializing' and claim_id=${claim.claimId}
    `
    if (updated.rowCount !== 1) throw new PlatformCheckoutError('conflict', 'Checkout claim is stale.')
  }

  async assertPurpose(candidate: PlatformCheckoutMetadata): Promise<void> {
    const record = await this.#load(this.#db, candidate.checkoutId)
    const item = record && (candidate.kind === 'setup' ? record.setup : record.recurring)
    if (!record || record.state !== 'awaiting-payment' || !item) {
      throw new PlatformCheckoutError('cancelled', 'Checkout obligation is unavailable.')
    }
    if (evidenceSha256(metadata(record, item)) !== evidenceSha256(candidate)) {
      throw new PlatformCheckoutError('verification', 'Checkout obligation metadata changed.')
    }
    if (record.entitlementCandidateId) {
      const settled = await this.#db<{ denied: number }>`
        select 1 as denied from fuma_contract_candidates
        where candidate_id=${record.entitlementCandidateId}
          and (${candidate.kind}='setup' and setup_fee_settled
            or ${candidate.kind}='recurring' and recurring_settled
            or activated_at is not null or paid_transfer_pending)
      `
      if (settled.rows[0]) throw new PlatformCheckoutError('already-settled', 'Checkout obligation is already settled.')
    }
  }

  async markCallbackVerified(checkoutId: string, kind: PlatformCheckoutObligationKind, reference: string): Promise<void> {
    const now = this.#now().toISOString()
    const updated = await this.#db`
      update fuma_platform_checkout_obligations_v2 o set
        state='callback-verified',callback_verified_at=coalesce(callback_verified_at,${now}),
        updated_at=${now}
      where o.checkout_id=${checkoutId} and o.kind=${kind} and o.reference=${reference}
        and o.state in ('ready','callback-verified')
        and exists (select 1 from fuma_platform_checkout_candidates_v2 c
          where c.checkout_id=o.checkout_id and c.state='awaiting-payment')
    `
    if (updated.rowCount !== 1) throw new PlatformCheckoutError('verification', 'Callback obligation changed.')
  }

  cancel(destination: PlatformCheckoutDestination, checkoutId: string): Promise<void> {
    return this.#db.transaction(async (tx) => {
      const record = await this.#load(tx, checkoutId)
      if (!record || !sameDestination(record.destination, destination)) {
        throw new PlatformCheckoutError('not-found', 'Checkout was not found.')
      }
      if (record.state === 'cancelled') return
      if ([record.setup, record.recurring].some((item) => item?.state === 'callback-verified')) {
        throw new PlatformCheckoutError('conflict', 'Verified checkout cannot be cancelled.')
      }
      if (record.entitlementCandidateId) {
        const settled = await tx<{ denied: number }>`
          select 1 as denied from fuma_contract_candidates c
          left join fuma_organization_contracts oc on oc.candidate_id=c.candidate_id
          where c.candidate_id=${record.entitlementCandidateId}
            and (c.setup_fee_settled or c.recurring_settled or c.activated_at is not null
              or c.paid_transfer_pending or oc.contract_id is not null)
          for share of c
        `
        if (settled.rows[0]) throw new PlatformCheckoutError('already-settled', 'Settled checkout cannot be cancelled.')
      }
      await tx`
        update fuma_platform_checkout_candidates_v2 set state='cancelled',cancelled_at=${this.#now().toISOString()}
        where checkout_id=${checkoutId} and state='awaiting-payment'
      `
    })
  }
}

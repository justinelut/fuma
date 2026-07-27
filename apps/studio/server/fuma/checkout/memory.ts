import {
  PlatformCheckoutError,
  type PlatformCheckoutClaimResult,
  type PlatformCheckoutDestination,
  type PlatformCheckoutInitializationClaim,
  type PlatformCheckoutMetadata,
  type PlatformCheckoutObligation,
  type PlatformCheckoutObligationKind,
  type PlatformCheckoutOfferAcceptanceAuthority,
  type PlatformCheckoutPrepareInput,
  type PlatformCheckoutRecord,
  type PlatformCheckoutRepository,
} from './contracts'

export type MemoryCheckoutPlan = Readonly<{
  planId: string
  priceBookVersion: string
  profileId: string
  amountMinor: number
  currency: 'KES'
  cadence: 'monthly' | 'annual'
  offeringClass: 'fuma-funded-starter' | 'fuma-funded-trial' | 'paid'
  checkoutAvailable: boolean
  effectiveAt: string
  expiresAt: string | null
}>

export type MemoryCheckoutOffer = Readonly<{
  offerId: string
  offerVersion: number
  destination: PlatformCheckoutDestination
  recurringAmountMinor: number
  setupFeeMinor: number
  currency: 'KES'
  cadence: 'monthly' | 'annual'
  effectiveAt: string
  expiresAt: string
  state: 'issued' | 'accepted' | 'withdrawn' | 'expired'
  candidateId: string | null
  candidateSettled?: boolean
  replaces?: Readonly<{ offerId: string; offerVersion: number }> | null
}>

export type MemoryCheckoutRepositoryOptions = Readonly<{
  plans?: readonly MemoryCheckoutPlan[]
  offers?: readonly MemoryCheckoutOffer[]
  destinations?: readonly PlatformCheckoutDestination[]
  internalOrganizationIds?: readonly string[]
  activeSourceKeys?: readonly string[]
  now?: () => Date
  idFactory?: (sourceKey: string) => string
  claimFactory?: () => string
  claimLeaseMs?: number
}>

type MutableObligation = {
  kind: PlatformCheckoutObligationKind
  amountMinor: number
  currency: 'KES'
  reference: string | null
  authorizationUrl: string | null
  state: PlatformCheckoutObligation['state']
  callbackVerifiedAt: string | null
  claimId: string | null
  claimExpiresAt: number | null
}

type MutableRecord = {
  -readonly [Key in keyof Omit<PlatformCheckoutRecord, 'setup' | 'recurring'>]:
    Omit<PlatformCheckoutRecord, 'setup' | 'recurring'>[Key]
} & {
  setup: MutableObligation | null
  recurring: MutableObligation
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
    .join(',')}}`
}
function sha256(value: unknown): string {
  return new Bun.CryptoHasher('sha256').update(canonical(value)).digest('hex')
}
function destinationKey(value: PlatformCheckoutDestination): string {
  return `${value.organizationId}:${value.workspaceId}:${value.siteId}:${value.profileId}`
}
function sourceKey(source: PlatformCheckoutPrepareInput['source']): string {
  return source.kind === 'public-plan'
    ? `public-plan:${source.planId}:${source.priceBookVersion}:${source.cadence}`
    : `private-offer:${source.offerId}:${source.offerVersion}`
}
function exactSourceKey(record: PlatformCheckoutRecord): string {
  return sourceKey(record.source)
}
function identityKey(input: PlatformCheckoutPrepareInput): string {
  return `${sourceKey(input.source)}:${destinationKey(input.destination)}`
}
function cloneObligation(value: MutableObligation): PlatformCheckoutObligation {
  return Object.freeze({
    kind: value.kind,
    amountMinor: value.amountMinor,
    currency: value.currency,
    reference: value.reference,
    authorizationUrl: value.authorizationUrl,
    state: value.state,
    callbackVerifiedAt: value.callbackVerifiedAt,
  })
}
function cloneRecord(record: MutableRecord): PlatformCheckoutRecord {
  return Object.freeze({
    ...record,
    source: Object.freeze(structuredClone(record.source)),
    destination: Object.freeze({ ...record.destination }),
    allowedChannels: Object.freeze([...record.allowedChannels]),
    setup: record.setup ? cloneObligation(record.setup) : null,
    recurring: cloneObligation(record.recurring),
  })
}
function sameMetadata(left: PlatformCheckoutMetadata, right: PlatformCheckoutMetadata): boolean {
  return canonical(left) === canonical(right)
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

export class MemoryCheckoutRepository implements
PlatformCheckoutRepository, PlatformCheckoutOfferAcceptanceAuthority {
  readonly #plans: MemoryCheckoutPlan[]
  readonly #offers: MemoryCheckoutOffer[]
  readonly #destinations: Set<string>
  readonly #internalOrganizations: Set<string>
  readonly #activeSources: Set<string>
  readonly #records = new Map<string, MutableRecord>()
  readonly #identity = new Map<string, string>()
  readonly #now: () => Date
  readonly #idFactory: (sourceKey: string) => string
  readonly #claimFactory: () => string
  readonly #claimLeaseMs: number

  constructor(options: MemoryCheckoutRepositoryOptions = {}) {
    this.#plans = (options.plans ?? []).map((value) => structuredClone(value))
    this.#offers = (options.offers ?? []).map((value) => structuredClone(value))
    this.#destinations = new Set((options.destinations ?? []).map(destinationKey))
    this.#internalOrganizations = new Set(options.internalOrganizationIds ?? [])
    this.#activeSources = new Set(options.activeSourceKeys ?? [])
    this.#now = options.now ?? (() => new Date())
    this.#idFactory = options.idFactory ?? ((key) => `checkout:${sha256(key).slice(0, 32)}`)
    this.#claimFactory = options.claimFactory ?? (() => crypto.randomUUID())
    this.#claimLeaseMs = options.claimLeaseMs ?? 30_000
  }

  async acceptExactIssuedOffer(input: Readonly<{
    offerId: string
    offerVersion: number
    destination: PlatformCheckoutDestination
  }>): Promise<void> {
    const offer = this.#offers.find((candidate) => (
      candidate.offerId === input.offerId && candidate.offerVersion === input.offerVersion
    ))
    if (!offer) throw new PlatformCheckoutError('not-found', 'Exact private offer was not found.')
    if (destinationKey(offer.destination) !== destinationKey(input.destination)) {
      throw new PlatformCheckoutError('scope', 'Private offer destination substitution denied.')
    }
    const now = this.#now().getTime()
    const replaced = this.#offers.some((candidate) => (
      candidate.replaces?.offerId === offer.offerId
      && candidate.replaces.offerVersion === offer.offerVersion
      && ['issued', 'accepted'].includes(candidate.state)
      && Date.parse(candidate.expiresAt) > now
    ))
    if (replaced) throw new PlatformCheckoutError('stale', 'Private offer was replaced.')
    if (offer.candidateSettled) {
      throw new PlatformCheckoutError('already-settled', 'Private offer is already settled.')
    }
    if (offer.state === 'withdrawn' || offer.state === 'expired' || Date.parse(offer.expiresAt) <= now) {
      throw new PlatformCheckoutError('stale', 'Exact private offer is unavailable.')
    }
    if (!['issued', 'accepted'].includes(offer.state)) {
      throw new PlatformCheckoutError('stale', 'Exact private offer is unavailable.')
    }
    if (offer.state === 'issued') {
      const index = this.#offers.indexOf(offer)
      this.#offers[index] = {
        ...offer,
        state: 'accepted',
        candidateId: offer.candidateId ?? `candidate:${offer.offerId}:${offer.offerVersion}`,
      }
    }
  }

  async prepare(input: PlatformCheckoutPrepareInput): Promise<PlatformCheckoutRecord> {
    if (!this.#destinations.has(destinationKey(input.destination))) {
      throw new PlatformCheckoutError('scope', 'Checkout destination is not current.')
    }
    if (this.#internalOrganizations.has(input.destination.organizationId)) {
      throw new PlatformCheckoutError('internal', 'Internal organizations cannot enter checkout.')
    }
    const key = identityKey(input)
    const existingId = this.#identity.get(key)
    if (existingId) {
      const existing = this.#records.get(existingId)!
      if (
        existing.customerActorId !== input.customerActorId
        || existing.payerEmailSha256 !== input.payerEmailSha256
      ) {
        throw new PlatformCheckoutError('conflict', 'Checkout customer identity changed.')
      }
      return cloneRecord(existing)
    }
    if (this.#activeSources.has(sourceKey(input.source))) {
      throw new PlatformCheckoutError('already-settled', 'Checkout source is already active.')
    }
    const resolved = this.#resolve(input)
    const checkoutId = this.#idFactory(key)
    const callbackUrl = input.callbackUrlFor(checkoutId)
    const candidateId = resolved.entitlementCandidateId
      ?? `checkout-candidate:${sha256(key).slice(0, 32)}`
    const immutable = {
      checkoutId,
      candidateId,
      source: input.source,
      destination: input.destination,
      customerActorId: input.customerActorId,
      payerEmailSha256: input.payerEmailSha256,
      cadence: resolved.cadence,
      currency: resolved.currency,
      recurringAmountMinor: resolved.recurringAmountMinor,
      setupFeeMinor: resolved.setupFeeMinor,
      callbackUrl,
      allowedChannels: [...input.allowedChannels],
    }
    const createdAt = this.#now().toISOString()
    const record: MutableRecord = {
      checkoutId,
      candidateId,
      entitlementCandidateId: resolved.entitlementCandidateId,
      state: 'awaiting-payment',
      source: Object.freeze(structuredClone(input.source)),
      destination: Object.freeze({ ...input.destination }),
      customerActorId: input.customerActorId,
      payerEmailSha256: input.payerEmailSha256,
      cadence: resolved.cadence,
      currency: resolved.currency,
      callbackUrl,
      allowedChannels: Object.freeze([...input.allowedChannels]),
      evidenceSha256: sha256(immutable),
      setup: resolved.setupFeeMinor > 0
        ? this.#newObligation('setup', resolved.setupFeeMinor, createdAt)
        : null,
      recurring: this.#newObligation('recurring', resolved.recurringAmountMinor, createdAt),
      createdAt,
      cancelledAt: null,
    }
    this.#records.set(checkoutId, record)
    this.#identity.set(key, checkoutId)
    return cloneRecord(record)
  }

  #resolve(input: PlatformCheckoutPrepareInput): Readonly<{
    cadence: 'monthly' | 'annual'
    currency: 'KES'
    recurringAmountMinor: number
    setupFeeMinor: number
    entitlementCandidateId: string | null
  }> {
    const now = this.#now().getTime()
    const source = input.source
    if (source.kind === 'public-plan') {
      const currentVersion = this.#plans
        .filter((plan) => Date.parse(plan.effectiveAt) <= now)
        .toSorted((left, right) => Date.parse(right.effectiveAt) - Date.parse(left.effectiveAt))[0]
        ?.priceBookVersion
      const plan = this.#plans.find((candidate) => (
        candidate.planId === source.planId
        && candidate.priceBookVersion === source.priceBookVersion
        && candidate.cadence === source.cadence
      ))
      if (!plan) throw new PlatformCheckoutError('not-found', 'Exact public plan was not found.')
      if (
        plan.priceBookVersion !== currentVersion
        || plan.profileId !== input.destination.profileId
        || plan.offeringClass !== 'paid'
        || !plan.checkoutAvailable
        || Date.parse(plan.effectiveAt) > now
        || (plan.expiresAt !== null && Date.parse(plan.expiresAt) <= now)
      ) {
        throw new PlatformCheckoutError('stale', 'Public plan is not currently checkoutable.')
      }
      return {
        cadence: plan.cadence,
        currency: plan.currency,
        recurringAmountMinor: plan.amountMinor,
        setupFeeMinor: 0,
        entitlementCandidateId: null,
      }
    }
    const offer = this.#offers.find((candidate) => (
      candidate.offerId === source.offerId
      && candidate.offerVersion === source.offerVersion
    ))
    if (!offer) throw new PlatformCheckoutError('not-found', 'Exact private offer was not found.')
    if (
      offer.state !== 'accepted'
      || !offer.candidateId
      || offer.candidateSettled
      || destinationKey(offer.destination) !== destinationKey(input.destination)
      || Date.parse(offer.effectiveAt) > now
      || Date.parse(offer.expiresAt) <= now
    ) {
      throw new PlatformCheckoutError(
        offer.candidateSettled ? 'already-settled' : 'stale',
        'Accepted private offer is unavailable for checkout.',
      )
    }
    return {
      cadence: offer.cadence,
      currency: offer.currency,
      recurringAmountMinor: offer.recurringAmountMinor,
      setupFeeMinor: offer.setupFeeMinor,
      entitlementCandidateId: offer.candidateId,
    }
  }

  #newObligation(
    kind: PlatformCheckoutObligationKind,
    amountMinor: number,
    _createdAt: string,
  ): MutableObligation {
    return {
      kind,
      amountMinor,
      currency: 'KES',
      reference: null,
      authorizationUrl: null,
      state: 'pending',
      callbackVerifiedAt: null,
      claimId: null,
      claimExpiresAt: null,
    }
  }

  async find(
    destination: PlatformCheckoutDestination,
    checkoutId: string,
  ): Promise<PlatformCheckoutRecord | null> {
    const record = this.#records.get(checkoutId)
    return record && destinationKey(record.destination) === destinationKey(destination)
      ? cloneRecord(record)
      : null
  }

  async claimInitialization(
    checkoutId: string,
    kind: PlatformCheckoutObligationKind,
    proposedReference: string,
  ): Promise<PlatformCheckoutClaimResult> {
    const record = this.#records.get(checkoutId)
    if (!record) throw new PlatformCheckoutError('not-found', 'Checkout was not found.')
    if (record.state === 'cancelled') throw new PlatformCheckoutError('cancelled', 'Checkout is cancelled.')
    const item = kind === 'setup' ? record.setup : record.recurring
    if (!item) throw new PlatformCheckoutError('invalid', 'Checkout has no setup obligation.')
    if (['ready', 'callback-verified'].includes(item.state)) {
      return Object.freeze({ state: 'ready', record: cloneRecord(record) })
    }
    const now = this.#now().getTime()
    if (item.state === 'initializing' && item.claimExpiresAt !== null && item.claimExpiresAt > now) {
      return Object.freeze({ state: 'busy' })
    }
    item.reference ??= proposedReference
    item.claimId = this.#claimFactory()
    item.claimExpiresAt = now + this.#claimLeaseMs
    item.state = 'initializing'
    return Object.freeze({
      state: 'claimed',
      claim: Object.freeze({
        claimId: item.claimId,
        checkoutId,
        kind,
        reference: item.reference,
      }),
    })
  }

  async completeInitialization(
    claim: PlatformCheckoutInitializationClaim,
    authorizationUrl: string,
  ): Promise<void> {
    const item = this.#claimed(claim)
    item.authorizationUrl = authorizationUrl
    item.state = 'ready'
    item.claimId = null
    item.claimExpiresAt = null
  }

  async releaseInitialization(claim: PlatformCheckoutInitializationClaim): Promise<void> {
    const item = this.#claimed(claim)
    item.state = 'failed'
    item.claimId = null
    item.claimExpiresAt = null
  }

  #claimed(claim: PlatformCheckoutInitializationClaim): MutableObligation {
    const record = this.#records.get(claim.checkoutId)
    const item = record && (claim.kind === 'setup' ? record.setup : record.recurring)
    if (
      !item
      || item.state !== 'initializing'
      || item.claimId !== claim.claimId
      || item.reference !== claim.reference
    ) {
      throw new PlatformCheckoutError('conflict', 'Checkout initialization claim is stale.')
    }
    return item
  }

  async assertPurpose(candidate: PlatformCheckoutMetadata): Promise<void> {
    const record = this.#records.get(candidate.checkoutId)
    const item = record && (candidate.kind === 'setup' ? record.setup : record.recurring)
    if (!record || !item || record.state !== 'awaiting-payment') {
      throw new PlatformCheckoutError('cancelled', 'Checkout obligation is unavailable.')
    }
    if (!sameMetadata(metadata(cloneRecord(record), cloneObligation(item)), candidate)) {
      throw new PlatformCheckoutError('verification', 'Checkout obligation metadata changed.')
    }
  }

  async markCallbackVerified(
    checkoutId: string,
    kind: PlatformCheckoutObligationKind,
    reference: string,
  ): Promise<void> {
    const record = this.#records.get(checkoutId)
    const item = record && (kind === 'setup' ? record.setup : record.recurring)
    if (!record || record.state !== 'awaiting-payment' || !item || item.reference !== reference) {
      throw new PlatformCheckoutError('verification', 'Callback obligation changed.')
    }
    if (!['ready', 'callback-verified'].includes(item.state)) {
      throw new PlatformCheckoutError('verification', 'Callback obligation is not initialized.')
    }
    item.state = 'callback-verified'
    item.callbackVerifiedAt ??= this.#now().toISOString()
  }

  async cancel(destination: PlatformCheckoutDestination, checkoutId: string): Promise<void> {
    const record = this.#records.get(checkoutId)
    if (!record || destinationKey(record.destination) !== destinationKey(destination)) {
      throw new PlatformCheckoutError('not-found', 'Checkout was not found.')
    }
    if (record.state === 'cancelled') return
    if ([record.setup, record.recurring].some((item) => item?.state === 'callback-verified')) {
      throw new PlatformCheckoutError('conflict', 'Verified checkout cannot be cancelled.')
    }
    record.state = 'cancelled'
    record.cancelledAt = this.#now().toISOString()
  }

  records(): readonly PlatformCheckoutRecord[] {
    return Object.freeze([...this.#records.values()].map(cloneRecord))
  }

  markSourceActive(record: PlatformCheckoutRecord): void {
    this.#activeSources.add(exactSourceKey(record))
  }
}

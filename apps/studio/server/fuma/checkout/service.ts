import {
  safeParseValue,
} from '@core/utils/typeboxHelpers'
import {
  PaystackError,
  PaystackPurposeRegistry,
  ScopedPaystackTransport,
  newPaystackReference,
  type PaymentPurpose,
} from '../paystack/transport'
import {
  PlatformCheckoutInitializeSchema,
  PlatformCheckoutMetadataSchema,
  PlatformCheckoutViewSchema,
  PlatformCheckoutError,
  type PlatformCheckoutChannel,
  type PlatformCheckoutDestination,
  type PlatformCheckoutInitializationClaim,
  type PlatformCheckoutMetadata,
  type PlatformCheckoutObligation,
  type PlatformCheckoutObligationKind,
  type PlatformCheckoutOfferAcceptanceAuthority,
  type PlatformCheckoutRecord,
  type PlatformCheckoutRepository,
  type PlatformCheckoutSourceIntent,
  type PlatformCheckoutView,
} from './contracts'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const INITIALIZATION_WAIT_ATTEMPTS = 80
const INITIALIZATION_WAIT_MS = 10

export type PlatformCheckoutCustomerAuthority = Readonly<{
  destination: PlatformCheckoutDestination
  customerActorId: string
  payerEmail: string
}>

export type PlatformCheckoutServiceOptions = Readonly<{
  callbackOrigin: string
  allowedChannels: readonly PlatformCheckoutChannel[]
  allowedAuthorizationOrigins?: readonly string[]
  referenceFactory?: (kind: PlatformCheckoutObligationKind) => string
  sleep?: (milliseconds: number) => Promise<void>
}>

function sha256(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex')
}

function exactHttpsOrigin(value: string, label: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TypeError(`${label} must be an explicit HTTPS origin.`)
  }
  if (
    url.protocol !== 'https:'
    || url.username !== ''
    || url.password !== ''
    || url.search !== ''
    || url.hash !== ''
    || (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new TypeError(`${label} must be an explicit HTTPS origin.`)
  }
  return url.origin
}

function callbackUrl(
  origin: string,
  destination: PlatformCheckoutDestination,
  checkoutId: string,
): string {
  const encoded = [
    '/admin/organizations',
    encodeURIComponent(destination.organizationId),
    'workspaces',
    encodeURIComponent(destination.workspaceId),
    'sites',
    encodeURIComponent(destination.siteId),
    'settings/billing',
  ].join('/')
  const url = new URL(encoded, `${origin}/`)
  url.searchParams.set('checkout', checkoutId)
  return url.toString()
}

function purposeId(kind: PlatformCheckoutObligationKind): string {
  return kind === 'setup' ? 'platform-setup' : 'platform-recurring'
}

function obligation(record: PlatformCheckoutRecord, kind: PlatformCheckoutObligationKind) {
  return kind === 'setup' ? record.setup : record.recurring
}

function metadataFor(
  record: PlatformCheckoutRecord,
  item: PlatformCheckoutObligation,
): PlatformCheckoutMetadata {
  const sourceId = record.source.kind === 'public-plan'
    ? record.source.planId
    : record.source.offerId
  const sourceVersion = record.source.kind === 'public-plan'
    ? record.source.priceBookVersion
    : String(record.source.offerVersion)
  const parsed = safeParseValue(PlatformCheckoutMetadataSchema, {
    checkoutId: record.checkoutId,
    candidateId: record.candidateId,
    sourceKind: record.source.kind,
    sourceId,
    sourceVersion,
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
    allowedChannels: record.allowedChannels,
    evidenceSha256: record.evidenceSha256,
  })
  if (!parsed.ok) {
    throw new PlatformCheckoutError('verification', 'Stored checkout metadata is invalid.')
  }
  return Object.freeze(parsed.value)
}

function view(record: PlatformCheckoutRecord): PlatformCheckoutView {
  const parsed = safeParseValue(PlatformCheckoutViewSchema, {
    checkoutId: record.checkoutId,
    state: record.state,
    source: record.source,
    destination: record.destination,
    cadence: record.cadence,
    currency: record.currency,
    setup: record.setup,
    recurring: record.recurring,
    createdAt: record.createdAt,
    cancelledAt: record.cancelledAt,
  })
  if (!parsed.ok) {
    throw new PlatformCheckoutError('verification', 'Checkout response failed strict validation.')
  }
  return Object.freeze(parsed.value)
}

function sameDestination(
  left: PlatformCheckoutDestination,
  right: PlatformCheckoutDestination,
): boolean {
  return left.organizationId === right.organizationId
    && left.workspaceId === right.workspaceId
    && left.siteId === right.siteId
    && left.profileId === right.profileId
}

function isAllowedAuthorizationUrl(value: string, origins: ReadonlySet<string>): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.username === ''
      && url.password === ''
      && origins.has(url.origin)
  } catch {
    return false
  }
}

function checkoutPurpose(
  kind: PlatformCheckoutObligationKind,
  repository: PlatformCheckoutRepository,
): PaymentPurpose<PlatformCheckoutMetadata> {
  return Object.freeze({
    id: purposeId(kind),
    scope: 'platform_billing' as const,
    metadataSchema: PlatformCheckoutMetadataSchema,
    async authorize(metadata) {
      if (metadata.kind !== kind) {
        throw new PaystackError('invalid-purpose', 'Checkout obligation purpose was conflated.')
      }
      await repository.assertPurpose(metadata)
    },
    expected(metadata) {
      return Object.freeze({
        amountMinor: metadata.amountMinor,
        currency: metadata.currency,
      })
    },
    async settle() {
      // FUMA-056 owns signed-event reduction and exact obligation settlement.
      // Purpose settlement is intentionally inert at the checkout boundary.
    },
  })
}

export function registerPlatformCheckoutPurposes(
  registry: PaystackPurposeRegistry,
  repository: PlatformCheckoutRepository,
): void {
  registry.register(checkoutPurpose('setup', repository))
  registry.register(checkoutPurpose('recurring', repository))
}

export class PlatformCheckoutService {
  readonly #transport: ScopedPaystackTransport
  readonly #repository: PlatformCheckoutRepository
  readonly #offers: PlatformCheckoutOfferAcceptanceAuthority
  readonly #callbackOrigin: string
  readonly #allowedChannels: readonly PlatformCheckoutChannel[]
  readonly #authorizationOrigins: ReadonlySet<string>
  readonly #referenceFactory: (kind: PlatformCheckoutObligationKind) => string
  readonly #sleep: (milliseconds: number) => Promise<void>

  constructor(
    transport: ScopedPaystackTransport,
    repository: PlatformCheckoutRepository,
    offers: PlatformCheckoutOfferAcceptanceAuthority,
    options: PlatformCheckoutServiceOptions,
  ) {
    if (transport.scope !== 'platform_billing') {
      throw new PlatformCheckoutError(
        'scope',
        'Platform checkout cannot use customer merchant credentials.',
      )
    }
    const channels = [...new Set(options.allowedChannels)]
    if (
      channels.length < 1
      || channels.length > 3
      || channels.some((channel) => !['card', 'mobile_money', 'bank'].includes(channel))
    ) {
      throw new TypeError('Platform checkout channels are invalid.')
    }
    const authorizationOrigins = options.allowedAuthorizationOrigins
      ?? ['https://checkout.paystack.com']
    this.#transport = transport
    this.#repository = repository
    this.#offers = offers
    this.#callbackOrigin = exactHttpsOrigin(options.callbackOrigin, 'Checkout callback')
    this.#allowedChannels = Object.freeze(channels)
    this.#authorizationOrigins = new Set(authorizationOrigins.map((origin) => (
      exactHttpsOrigin(origin, 'Checkout authorization')
    )))
    this.#referenceFactory = options.referenceFactory
      ?? ((kind) => newPaystackReference('platform_billing', purposeId(kind)))
    this.#sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => {
      setTimeout(resolve, milliseconds)
    }))
  }

  async initialize(
    raw: unknown,
    customer: PlatformCheckoutCustomerAuthority,
  ): Promise<PlatformCheckoutView> {
    const parsed = safeParseValue(PlatformCheckoutInitializeSchema, raw)
    if (!parsed.ok || !EMAIL_PATTERN.test(customer.payerEmail)) {
      throw new PlatformCheckoutError('invalid', 'Checkout intent is invalid.')
    }
    const source: PlatformCheckoutSourceIntent = Object.freeze(parsed.value.source)
    const destination = Object.freeze({ ...customer.destination })
    if (source.kind === 'private-offer') {
      await this.#offers.acceptExactIssuedOffer({
        offerId: source.offerId,
        offerVersion: source.offerVersion,
        destination,
      })
    }
    let record = await this.#repository.prepare({
      source,
      destination,
      customerActorId: customer.customerActorId,
      payerEmailSha256: sha256(customer.payerEmail.trim().toLowerCase()),
      callbackUrlFor: (checkoutId) => callbackUrl(
        this.#callbackOrigin,
        destination,
        checkoutId,
      ),
      allowedChannels: this.#allowedChannels,
    })
    if (!sameDestination(record.destination, destination)) {
      throw new PlatformCheckoutError('scope', 'Checkout destination authority changed.')
    }
    if (record.state === 'cancelled') {
      throw new PlatformCheckoutError('cancelled', 'Checkout is cancelled.')
    }
    if (record.setup) record = await this.#initializeOne(record, 'setup', customer.payerEmail)
    record = await this.#initializeOne(record, 'recurring', customer.payerEmail)
    return view(record)
  }

  async #initializeOne(
    record: PlatformCheckoutRecord,
    kind: PlatformCheckoutObligationKind,
    payerEmail: string,
  ): Promise<PlatformCheckoutRecord> {
    const current = obligation(record, kind)
    if (!current) return record
    if (current.state === 'ready' || current.state === 'callback-verified') return record
    const result = await this.#repository.claimInitialization(
      record.checkoutId,
      kind,
      this.#referenceFactory(kind),
    )
    if (result.state === 'ready') return result.record
    if (result.state === 'busy') {
      return await this.#waitForInitialization(record.destination, record.checkoutId, kind)
    }
    const claimed = await this.#repository.find(record.destination, record.checkoutId)
    const claimedObligation = claimed ? obligation(claimed, kind) : null
    if (!claimed || !claimedObligation || claimedObligation.reference !== result.claim.reference) {
      await this.#release(result.claim)
      throw new PlatformCheckoutError('verification', 'Checkout initialization claim changed.')
    }
    try {
      const initialized = await this.#transport.initialize(
        purposeId(kind),
        metadataFor(claimed, claimedObligation),
        payerEmail,
        {
          callbackUrl: claimed.callbackUrl,
          channels: [...claimed.allowedChannels],
          reference: result.claim.reference,
        },
      )
      if (
        initialized.reference !== result.claim.reference
        || !isAllowedAuthorizationUrl(initialized.authorizationUrl, this.#authorizationOrigins)
      ) {
        throw new PlatformCheckoutError(
          'verification',
          'Provider authorization response is not trusted.',
        )
      }
      await this.#repository.completeInitialization(
        result.claim,
        initialized.authorizationUrl,
      )
    } catch (error) {
      await this.#release(result.claim)
      if (error instanceof PlatformCheckoutError) throw error
      throw new PlatformCheckoutError('provider', 'Checkout provider initialization failed.')
    }
    const completed = await this.#repository.find(record.destination, record.checkoutId)
    if (!completed) {
      throw new PlatformCheckoutError('verification', 'Initialized checkout disappeared.')
    }
    return completed
  }

  async #waitForInitialization(
    destination: PlatformCheckoutDestination,
    checkoutId: string,
    kind: PlatformCheckoutObligationKind,
  ): Promise<PlatformCheckoutRecord> {
    for (let attempt = 0; attempt < INITIALIZATION_WAIT_ATTEMPTS; attempt += 1) {
      await this.#sleep(INITIALIZATION_WAIT_MS)
      const found = await this.#repository.find(destination, checkoutId)
      const item = found ? obligation(found, kind) : null
      if (found && item && ['ready', 'callback-verified'].includes(item.state)) return found
      if (item?.state === 'failed') break
    }
    throw new PlatformCheckoutError('busy', 'Checkout initialization is still in progress.')
  }

  async #release(claim: PlatformCheckoutInitializationClaim): Promise<void> {
    try {
      await this.#repository.releaseInitialization(claim)
    } catch {
      // Preserve the original provider/verification failure without leaking claim details.
    }
  }

  async find(
    destination: PlatformCheckoutDestination,
    checkoutId: string,
  ): Promise<PlatformCheckoutView> {
    const record = await this.#repository.find(destination, checkoutId)
    if (!record) throw new PlatformCheckoutError('not-found', 'Checkout was not found.')
    return view(record)
  }

  async cancel(
    destination: PlatformCheckoutDestination,
    checkoutId: string,
  ): Promise<PlatformCheckoutView> {
    await this.#repository.cancel(destination, checkoutId)
    return await this.find(destination, checkoutId)
  }

  async verifyCallback(
    destination: PlatformCheckoutDestination,
    checkoutId: string,
    reference: string,
  ): Promise<PlatformCheckoutView> {
    const record = await this.#repository.find(destination, checkoutId)
    if (!record) throw new PlatformCheckoutError('not-found', 'Checkout was not found.')
    if (record.state === 'cancelled') {
      throw new PlatformCheckoutError('cancelled', 'Cancelled checkout cannot be verified.')
    }
    const item = [record.setup, record.recurring].find((candidate) => (
      candidate?.reference === reference
    ))
    if (!item || !item.reference || !['ready', 'callback-verified'].includes(item.state)) {
      throw new PlatformCheckoutError('verification', 'Callback reference is not an exact checkout obligation.')
    }
    try {
      const transaction = await this.#transport.verify(
        purposeId(item.kind),
        item.reference,
        metadataFor(record, item),
      )
      if (!record.allowedChannels.includes(transaction.channel as PlatformCheckoutChannel)) {
        throw new PlatformCheckoutError('verification', 'Verified payment channel is not allowed.')
      }
      await this.#repository.markCallbackVerified(
        checkoutId,
        item.kind,
        item.reference,
      )
    } catch (error) {
      if (error instanceof PlatformCheckoutError) throw error
      throw new PlatformCheckoutError('verification', 'Checkout callback verification failed.')
    }
    const verified = await this.#repository.find(destination, checkoutId)
    if (!verified) throw new PlatformCheckoutError('verification', 'Verified checkout disappeared.')
    return view(verified)
  }
}

// Compatibility names retained for the commercial-edge barrel while callers migrate.
export {
  PlatformCheckoutError as CheckoutError,
  PlatformCheckoutInitializeSchema as CheckoutRequestSchema,
  PlatformCheckoutMetadataSchema as CheckoutMetadataSchema,
}

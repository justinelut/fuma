import { Type, Value, type Static } from '@core/utils/typeboxHelpers'
import type { ScopedPaystackTransport } from '../paystack/transport'

const HttpsUrlSchema = Type.String({ minLength: 8, maxLength: 2048, pattern: '^https://[^\\s]+$' })
export const CheckoutRequestSchema = Type.Object({
  checkoutId: Type.String({ minLength: 1, maxLength: 255 }), organizationId: Type.String({ minLength: 1 }), workspaceId: Type.String({ minLength: 1 }), siteId: Type.String({ minLength: 1 }),
  kind: Type.Union([Type.Literal('public-plan'), Type.Literal('custom-offer')]),
  catalogId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]), catalogVersion: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  offerId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]), offerVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  email: Type.String({ format: 'email' }), currency: Type.Literal('KES'), recurringAmountMinor: Type.Integer({ minimum: 1 }), setupFeeMinor: Type.Integer({ minimum: 0 }),
  cadence: Type.Union([Type.Literal('monthly'), Type.Literal('annual')]),
  allowedChannels: Type.Array(Type.Union([Type.Literal('card'), Type.Literal('mobile_money'), Type.Literal('bank')]), { minItems: 1, maxItems: 3, uniqueItems: true }),
  callbackUrl: HttpsUrlSchema, internalGrant: Type.Boolean(),
}, { additionalProperties: false })
export type CheckoutRequest = Static<typeof CheckoutRequestSchema>
export type CheckoutRecord = Readonly<CheckoutRequest & {
  state: 'initialized' | 'cancelled'; recurringReference: string; recurringAuthorizationUrl: string; setupReference: string | null; setupAuthorizationUrl: string | null
}>
export interface CheckoutRepository { find(id: string): Promise<CheckoutRecord | null>; insert(record: CheckoutRecord): Promise<boolean>; cancel(id: string): Promise<void> }
export interface CheckoutAuthority { assertCurrent(input: CheckoutRequest): Promise<void> }
export class CheckoutError extends Error {
  readonly code: 'invalid' | 'internal-denied' | 'scope' | 'stale' | 'duplicate-mismatch';
  constructor(code: 'invalid' | 'internal-denied' | 'scope' | 'stale' | 'duplicate-mismatch', message: string) { super(message); this.code = code; this.name = 'CheckoutError' }
}
export const CheckoutMetadataSchema = Type.Object({
  checkoutId: Type.String({ minLength: 1 }), obligation: Type.Union([Type.Literal('recurring'), Type.Literal('setup')]),
  organizationId: Type.String({ minLength: 1 }), workspaceId: Type.String({ minLength: 1 }), siteId: Type.String({ minLength: 1 }),
  binding: Type.String({ minLength: 3 }), amountMinor: Type.Integer({ minimum: 1 }), currency: Type.Literal('KES'), cadence: Type.Union([Type.Literal('monthly'), Type.Literal('annual')]),
}, { additionalProperties: false })
export type CheckoutMetadata = Static<typeof CheckoutMetadataSchema>

function exactInput(record: CheckoutRecord, input: CheckoutRequest): boolean {
  const projected: CheckoutRequest = {
    checkoutId: record.checkoutId, organizationId: record.organizationId, workspaceId: record.workspaceId, siteId: record.siteId,
    kind: record.kind, catalogId: record.catalogId, catalogVersion: record.catalogVersion, offerId: record.offerId, offerVersion: record.offerVersion,
    email: record.email, currency: record.currency, recurringAmountMinor: record.recurringAmountMinor, setupFeeMinor: record.setupFeeMinor,
    cadence: record.cadence, allowedChannels: record.allowedChannels, callbackUrl: record.callbackUrl, internalGrant: record.internalGrant,
  }
  return JSON.stringify(projected) === JSON.stringify(input)
}
function binding(input: CheckoutRequest): string {
  if (input.kind === 'public-plan') return `catalog:${input.catalogId}:${input.catalogVersion}`
  return `offer:${input.offerId}:${input.offerVersion}`
}

export class PlatformCheckoutService {
  private readonly pending = new Map<string, Promise<CheckoutRecord>>()
  private readonly transport: ScopedPaystackTransport;
  private readonly repository: CheckoutRepository;
  private readonly authority: CheckoutAuthority;
  constructor(transport: ScopedPaystackTransport, repository: CheckoutRepository, authority: CheckoutAuthority) { this.transport = transport; this.repository = repository; this.authority = authority;
    if (transport.scope !== 'platform_billing') throw new CheckoutError('scope', 'Platform checkout requires platform_billing credentials.')
  }

  async initialize(raw: unknown): Promise<CheckoutRecord> {
    if (!Value.Check(CheckoutRequestSchema, raw)) throw new CheckoutError('invalid', 'Checkout contract is invalid.')
    const input = Object.freeze(structuredClone(raw)) as CheckoutRequest
    if (input.internalGrant) throw new CheckoutError('internal-denied', 'Internal organizations cannot create provider customers, checkout, invoices, or dunning.')
    const publicBinding = input.kind === 'public-plan' && input.catalogId !== null && input.catalogVersion !== null && input.offerId === null && input.offerVersion === null
    const offerBinding = input.kind === 'custom-offer' && input.offerId !== null && input.offerVersion !== null && input.catalogId === null && input.catalogVersion === null
    if (!publicBinding && !offerBinding) throw new CheckoutError('invalid', 'Checkout version binding is invalid.')
    await this.authority.assertCurrent(input)
    const prior = await this.repository.find(input.checkoutId)
    if (prior) {
      if (!exactInput(prior, input)) throw new CheckoutError('duplicate-mismatch', 'Checkout ID was reused with different destination, version, or obligations.')
      return prior
    }
    const inFlight = this.pending.get(input.checkoutId)
    if (inFlight) return await inFlight
    const operation = this.initializeExact(input).finally(() => { this.pending.delete(input.checkoutId) })
    this.pending.set(input.checkoutId, operation)
    return await operation
  }

  private async initializeExact(input: CheckoutRequest): Promise<CheckoutRecord> {
    const base = { checkoutId: input.checkoutId, organizationId: input.organizationId, workspaceId: input.workspaceId, siteId: input.siteId, binding: binding(input), currency: input.currency, cadence: input.cadence }
    const options = { callbackUrl: input.callbackUrl, channels: input.allowedChannels }
    const setup = input.setupFeeMinor > 0
      ? await this.transport.initialize('platform-setup', { ...base, obligation: 'setup' as const, amountMinor: input.setupFeeMinor }, input.email, options)
      : null
    const recurring = await this.transport.initialize('platform-recurring', { ...base, obligation: 'recurring' as const, amountMinor: input.recurringAmountMinor }, input.email, options)
    const record: CheckoutRecord = Object.freeze({
      ...structuredClone(input), state: 'initialized', recurringReference: recurring.reference, recurringAuthorizationUrl: recurring.authorizationUrl,
      setupReference: setup?.reference ?? null, setupAuthorizationUrl: setup?.authorizationUrl ?? null,
    })
    if (!await this.repository.insert(record)) {
      const winner = await this.repository.find(input.checkoutId)
      if (!winner || !exactInput(winner, input)) throw new CheckoutError('duplicate-mismatch', 'Concurrent checkout winner does not match this request.')
      return winner
    }
    return record
  }

  async cancel(id: string) { await this.repository.cancel(id) }
  callbackLabel(_query: URLSearchParams): never { throw new CheckoutError('invalid', 'Callback labels never settle or activate checkout; exact server verification is required.') }
}

export class MemoryCheckoutRepository implements CheckoutRepository {
  readonly rows = new Map<string, CheckoutRecord>()
  async find(id: string) { return structuredClone(this.rows.get(id) ?? null) }
  async insert(record: CheckoutRecord) { if (this.rows.has(record.checkoutId)) return false; this.rows.set(record.checkoutId, structuredClone(record)); return true }
  async cancel(id: string) { const record = this.rows.get(id); if (record) this.rows.set(id, Object.freeze({ ...record, state: 'cancelled' })) }
}

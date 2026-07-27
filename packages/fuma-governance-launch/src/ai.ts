import {
  AiCatalogSchema,
  AiCreditAccountSchema,
  AiReservationRequestSchema,
  AiReservationSchema,
  ByokCredentialSchema,
  McpConnectorSchema,
  SiteAiInvocationSchema,
  parseStrict,
  type AiCatalog,
  type AiCreditAccount,
  type AiReservation,
  type McpConnector,
  type SiteAiInvocation,
} from './contracts'

export class AiPolicyError extends Error {
  constructor(readonly code: 'catalog-disabled' | 'catalog-stale' | 'scope-denied' | 'budget-exhausted' | 'reservation-conflict' | 'connector-denied', message: string) {
    super(message)
    this.name = 'AiPolicyError'
  }
}

export class AiCatalogPolicy {
  readonly #catalog: AiCatalog
  constructor(input: unknown) {
    this.#catalog = parseStrict(AiCatalogSchema, input, 'ai.catalog')
    const providers = new Set<string>()
    for (const provider of this.#catalog.providers) {
      if (providers.has(provider.providerId)) throw new AiPolicyError('catalog-disabled', 'Duplicate provider identity.')
      providers.add(provider.providerId)
    }
    const models = new Set<string>()
    for (const model of this.#catalog.models) {
      if (models.has(model.modelId) || !providers.has(model.providerId)) throw new AiPolicyError('catalog-disabled', 'Model identity or provider is invalid.')
      models.add(model.modelId)
    }
  }

  visibleModels(now: Date, profile: 'website' | 'publication'): AiCatalog['models'] {
    const cutoff = now.getTime() - this.#catalog.staleAfterSeconds * 1_000
    const enabledProviders = this.#catalog.providers.filter(({ enabled }) => enabled)
    if (enabledProviders.length === 0) return []
    if (enabledProviders.some(({ refreshedAt }) => !Number.isFinite(Date.parse(refreshedAt)) || Date.parse(refreshedAt) < cutoff)) {
      throw new AiPolicyError('catalog-stale', 'At least one enabled AI provider catalog is stale; partial visibility is forbidden.')
    }
    const providerIds = new Set(enabledProviders.map(({ providerId }) => providerId))
    const visible = this.#catalog.models.filter((model) => model.enabled && providerIds.has(model.providerId) && (model.defaultFor.length === 0 || model.defaultFor.includes(profile)))
    if (visible.some(({ refreshedAt }) => !Number.isFinite(Date.parse(refreshedAt)) || Date.parse(refreshedAt) < cutoff)) {
      throw new AiPolicyError('catalog-stale', 'At least one visible AI model price is stale.')
    }
    return visible
  }

  quotedMicros(modelId: string, inputTokens: number, outputTokens: number): number {
    if (![inputTokens, outputTokens].every((value) => Number.isSafeInteger(value) && value >= 0)) throw new AiPolicyError('catalog-disabled', 'Token counts must be non-negative safe integers.')
    const model = this.#catalog.models.find((candidate) => candidate.modelId === modelId)
    const provider = this.#catalog.providers.find((candidate) => candidate.providerId === model?.providerId)
    if (!model?.enabled || !provider?.enabled) throw new AiPolicyError('catalog-disabled', 'AI model is disabled.')
    const weighted = inputTokens * model.inputMicrosPerMillion + outputTokens * model.outputMicrosPerMillion
    if (!Number.isSafeInteger(weighted)) throw new AiPolicyError('catalog-disabled', 'AI quote exceeds exact integer range.')
    const raw = Math.ceil(weighted / 1_000_000)
    const quoted = Math.ceil(raw * (10_000 + model.markupBasisPoints) / 10_000)
    if (!Number.isSafeInteger(quoted)) throw new AiPolicyError('catalog-disabled', 'AI quote exceeds exact integer range.')
    return quoted
  }

  publicView(): Omit<AiCatalog, 'providers'> & { providers: ReadonlyArray<Omit<AiCatalog['providers'][number], 'platformCredentialRef'>> } {
    return {
      ...structuredClone(this.#catalog),
      providers: this.#catalog.providers.map(({ platformCredentialRef: _secret, ...provider }) => provider),
    }
  }
}

export type AiLedgerCommit = 'committed' | 'account-conflict' | 'reservation-conflict'

export interface AiLedgerPort {
  read(accountId: string): Promise<AiCreditAccount | null>
  readReservation(reservationId: string): Promise<AiReservation | null>
  commitReservation(accountId: string, expectedAccountVersion: number, nextAccount: AiCreditAccount, reservation: AiReservation): Promise<AiLedgerCommit>
  resolveReservation(accountId: string, expectedAccountVersion: number, nextAccount: AiCreditAccount, expectedReservationState: AiReservation['state'], nextReservation: AiReservation): Promise<AiLedgerCommit>
}

export class AiCreditService {
  constructor(private readonly ledger: AiLedgerPort, private readonly now: () => Date = () => new Date()) {}

  async reserve(input: unknown): Promise<AiReservation> {
    const request = parseStrict(AiReservationRequestSchema, input, 'ai.reservation.request')
    const now = this.now().getTime()
    const expiresAt = Date.parse(request.expiresAt)
    if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt - now > 24 * 60 * 60_000) throw new AiPolicyError('reservation-conflict', 'Reservation expiry must be live and no more than 24 hours away.')
    const existing = await this.ledger.readReservation(request.reservationId)
    if (existing) {
      if (existing.accountId === request.accountId && existing.siteId === request.siteId && existing.modelId === request.modelId && existing.reservedMicros === request.micros && existing.expiresAt === request.expiresAt) return existing
      throw new AiPolicyError('reservation-conflict', 'Reservation idempotency identity changed.')
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await this.ledger.read(request.accountId)
      if (!current) throw new AiPolicyError('budget-exhausted', 'AI credit account is unavailable.')
      parseStrict(AiCreditAccountSchema, current, 'ai.account')
      if (current.accountId !== request.accountId || current.siteId !== request.siteId) throw new AiPolicyError('scope-denied', 'AI credit account does not belong to the requested site.')
      const spendable = Math.min(current.balanceMicros, current.budgetMicros) - current.reservedMicros
      if (spendable < request.micros) throw new AiPolicyError('budget-exhausted', 'AI budget is exhausted.')
      const next = parseStrict(AiCreditAccountSchema, { ...current, reservedMicros: current.reservedMicros + request.micros, version: current.version + 1 }, 'ai.account.next')
      const reservation = parseStrict(AiReservationSchema, { accountId: request.accountId, reservationId: request.reservationId, siteId: request.siteId, modelId: request.modelId, reservedMicros: request.micros, settledMicros: null, state: 'reserved', expiresAt: request.expiresAt }, 'ai.reservation')
      const result = await this.ledger.commitReservation(current.accountId, current.version, next, reservation)
      if (result === 'committed') return reservation
      if (result === 'account-conflict') continue
      const raced = await this.ledger.readReservation(request.reservationId)
      if (raced && raced.accountId === request.accountId && raced.siteId === request.siteId && raced.modelId === request.modelId && raced.reservedMicros === request.micros && raced.expiresAt === request.expiresAt) return raced
      throw new AiPolicyError('reservation-conflict', 'Reservation idempotency identity changed during contention.')
    }
    throw new AiPolicyError('reservation-conflict', 'AI reservation contention exceeded retry limit.')
  }

  async settle(reservationId: string, actualMicros: number): Promise<AiReservation> {
    if (!Number.isSafeInteger(actualMicros) || actualMicros < 0) throw new AiPolicyError('reservation-conflict', 'Actual usage must be an exact non-negative amount.')
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const reservation = await this.ledger.readReservation(reservationId)
      if (!reservation || reservation.state !== 'reserved' || actualMicros > reservation.reservedMicros) throw new AiPolicyError('reservation-conflict', 'Reservation is not settleable or actual usage exceeds it.')
      const account = await this.ledger.read(reservation.accountId)
      if (!account || account.reservedMicros < reservation.reservedMicros || account.balanceMicros < actualMicros) throw new AiPolicyError('reservation-conflict', 'AI reservation accounting is inconsistent.')
      const settled = parseStrict(AiReservationSchema, { ...reservation, settledMicros: actualMicros, state: 'settled' }, 'ai.settlement')
      const next = parseStrict(AiCreditAccountSchema, { ...account, balanceMicros: account.balanceMicros - actualMicros, reservedMicros: account.reservedMicros - reservation.reservedMicros, version: account.version + 1 }, 'ai.account.settlement')
      const result = await this.ledger.resolveReservation(account.accountId, account.version, next, 'reserved', settled)
      if (result === 'committed') return settled
      if (result === 'reservation-conflict') throw new AiPolicyError('reservation-conflict', 'Reservation was settled concurrently.')
    }
    throw new AiPolicyError('reservation-conflict', 'AI settlement contention exceeded retry limit.')
  }

  async refund(reservationId: string): Promise<AiReservation> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const reservation = await this.ledger.readReservation(reservationId)
      if (!reservation || reservation.state !== 'reserved') throw new AiPolicyError('reservation-conflict', 'Reservation is not refundable.')
      const account = await this.ledger.read(reservation.accountId)
      if (!account || account.reservedMicros < reservation.reservedMicros) throw new AiPolicyError('reservation-conflict', 'AI reservation accounting is inconsistent.')
      const refunded = parseStrict(AiReservationSchema, { ...reservation, settledMicros: 0, state: 'refunded' }, 'ai.refund')
      const next = parseStrict(AiCreditAccountSchema, { ...account, reservedMicros: account.reservedMicros - reservation.reservedMicros, version: account.version + 1 }, 'ai.account.refund')
      const result = await this.ledger.resolveReservation(account.accountId, account.version, next, 'reserved', refunded)
      if (result === 'committed') return refunded
      if (result === 'reservation-conflict') throw new AiPolicyError('reservation-conflict', 'Reservation was changed concurrently.')
    }
    throw new AiPolicyError('reservation-conflict', 'AI refund contention exceeded retry limit.')
  }

  async expire(reservationId: string): Promise<AiReservation | null> {
    const reservation = await this.ledger.readReservation(reservationId)
    if (!reservation || reservation.state !== 'reserved' || Date.parse(reservation.expiresAt) > this.now().getTime()) return null
    return this.refund(reservationId)
  }
}

export function safeByokMetadata(value: unknown): { credentialId: string; providerId: string; state: string; fingerprintSha256: string } {
  const credential = parseStrict(ByokCredentialSchema, value, 'ai.byok')
  return { credentialId: credential.credentialId, providerId: credential.providerId, state: credential.state, fingerprintSha256: credential.secret.fingerprintSha256 }
}

export type SiteAuthority = Readonly<{ platformId: string; organizationId: string; workspaceId: string; siteId: string; ownerKey: string; actorId: string; ownerGeneration: number; capabilities: ReadonlySet<string>; active: boolean }>

export function authorizeSiteAi(value: unknown, authority: SiteAuthority): SiteAiInvocation {
  const invocation = parseStrict(SiteAiInvocationSchema, value, 'site.ai.invocation')
  const exact = invocation.platformId === authority.platformId && invocation.organizationId === authority.organizationId && invocation.workspaceId === authority.workspaceId && invocation.siteId === authority.siteId && invocation.ownerKey === authority.ownerKey && invocation.actorId === authority.actorId && invocation.expectedOwnerGeneration === authority.ownerGeneration
  if (!authority.active || !exact || !authority.capabilities.has(invocation.capability)) throw new AiPolicyError('scope-denied', 'Exact live site AI authority is required.')
  return invocation
}

export function authorizeMcp(value: unknown, input: { tokenHashSha256: string; site: SiteAuthority; capability: 'read' | 'write' | 'publish'; now: Date; stepUp: boolean }): McpConnector {
  const connector = parseStrict(McpConnectorSchema, value, 'mcp.connector')
  const exact = connector.platformId === input.site.platformId && connector.organizationId === input.site.organizationId && connector.workspaceId === input.site.workspaceId && connector.siteId === input.site.siteId && connector.ownerKey === input.site.ownerKey
  if (!input.site.active || !exact || connector.tokenHashSha256 !== input.tokenHashSha256 || connector.revokedAt !== null || Date.parse(connector.expiresAt) <= input.now.getTime() || !connector.capabilities.includes(input.capability) || (input.capability === 'publish' && !input.stepUp)) {
    throw new AiPolicyError('connector-denied', 'MCP connector authority denied.')
  }
  return connector
}

export const MCP_USAGE_DIMENSIONS = Object.freeze(['connectorId', 'siteId', 'capability', 'requestUnits', 'creditMicros'] as const)

export async function issueMcpToken(randomBytes: (length: number) => Uint8Array = (length) => crypto.getRandomValues(new Uint8Array(length))): Promise<Readonly<{ plaintextOnce: string; tokenHashSha256: string }>> {
  const bytes = randomBytes(32)
  if (bytes.length !== 32) throw new AiPolicyError('connector-denied', 'MCP token entropy source returned the wrong length.')
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const plaintextOnce = `fuma_mcp_${btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`
  const tokenHashSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plaintextOnce)))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return Object.freeze({ plaintextOnce, tokenHashSha256 })
}

export function authorizeByokTransfer(value: unknown, input: { sourceOwnerKey: string; destinationOwnerKey: string; destinationGeneration: number; rekeyedSecret: unknown }) {
  const current = parseStrict(ByokCredentialSchema, value, 'ai.byok.transfer')
  const rekeyed = parseStrict(ByokCredentialSchema, { ...current, ownerKey: input.destinationOwnerKey, ownerGeneration: input.destinationGeneration, secret: input.rekeyedSecret, state: 'active' }, 'ai.byok.transfer.rekeyed')
  if (current.ownerKey !== input.sourceOwnerKey || input.sourceOwnerKey === input.destinationOwnerKey || !Number.isSafeInteger(input.destinationGeneration) || input.destinationGeneration <= current.ownerGeneration || current.secret.fingerprintSha256 === rekeyed.secret.fingerprintSha256 || current.secret.ciphertextObjectKey === rekeyed.secret.ciphertextObjectKey) {
    throw new AiPolicyError('scope-denied', 'BYOK transfer requires a new destination owner generation and newly encrypted secret material.')
  }
  return rekeyed
}

export type McpUsageWindow = Readonly<{ connectorId: string; siteId: string; capability: 'read' | 'write' | 'publish'; windowStartedAt: string; requestsUsed: number; requestUnits: number; creditMicros: number }>

export function authorizeMcpUsage(connector: McpConnector, prior: McpUsageWindow | null, input: { capability: 'read' | 'write' | 'publish'; now: Date; requestUnits: number; creditMicros: number }): McpUsageWindow {
  if (!Number.isSafeInteger(input.requestUnits) || input.requestUnits < 1 || !Number.isSafeInteger(input.creditMicros) || input.creditMicros < 0) throw new AiPolicyError('connector-denied', 'MCP usage must use exact non-negative integer units.')
  const minute = new Date(Math.floor(input.now.getTime() / 60_000) * 60_000).toISOString().replace('.000Z', 'Z')
  const sameWindow = prior?.connectorId === connector.connectorId && prior.siteId === connector.siteId && prior.capability === input.capability && prior.windowStartedAt === minute
  const requestsUsed = (sameWindow ? prior.requestsUsed : 0) + 1
  if (requestsUsed > connector.requestsPerMinute) throw new AiPolicyError('connector-denied', 'MCP connector request rate exceeded.')
  return Object.freeze({ connectorId: connector.connectorId, siteId: connector.siteId, capability: input.capability, windowStartedAt: minute, requestsUsed, requestUnits: (sameWindow ? prior.requestUnits : 0) + input.requestUnits, creditMicros: (sameWindow ? prior.creditMicros : 0) + input.creditMicros })
}

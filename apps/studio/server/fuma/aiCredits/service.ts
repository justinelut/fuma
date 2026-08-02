import type { AiCatalogService } from '../aiCatalog'
import type { AiByokMetadataCipher } from './credentialCipher'
import {
  AiByokAttachCommandSchema, AiCreditCommandSchema, AiCreditReserveCommandSchema,
  AiCreditResolutionCommandSchema, AiCreditSettlementCommandSchema,
  parseAiCreditContract, sameAiCreditScope,
  type AiByokCredential, type AiByokCredentialView, type AiCatalogQuoteEvidence,
  type AiCreditAccount, type AiCreditAccountView, type AiCreditAudience,
  type AiCreditReservation, type AiCreditSettlement,
} from './contracts'
import { AiCreditRepositoryError, type AiCreditRepository } from './repository'

export interface AiCreditQuotaPort { reserve(key: string, account: AiCreditAccount, units: number): Promise<void>; settle(key: string, units: number): Promise<void>; release(key: string): Promise<void> }
export interface AiCreditMeterPort { settle(input: Readonly<{ key: string; account: AiCreditAccount; logicalCredits: number; providerCostMicros: number }>): Promise<void> }
export interface AiCreditAuditPort { record(fact: Readonly<Record<string, unknown>>): Promise<void> }
export class AiCreditServiceError extends Error {
  override readonly name = 'AiCreditServiceError'
  readonly code: 'invalid' | 'scope' | 'conflict' | 'exhausted' | 'budget-exhausted' | 'catalog' | 'credential'
  constructor(code: AiCreditServiceError['code'], message: string) { super(message); this.code = code }
}
const MAX_RESERVATION_MS = 24 * 60 * 60_000
const canonical = (value: unknown): string => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
const digest = (value: unknown): string => new Bun.CryptoHasher('sha256').update(canonical(value)).digest('hex')
const timestamp = (value: string): number => { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new AiCreditServiceError('invalid', 'Timestamp is invalid.'); return parsed }
const sameAudience = (scope: AiCreditAccount['scope'], audience: AiCreditAudience): boolean => scope.platformId === audience.platformId && scope.organizationId === audience.organizationId && scope.workspaceId === audience.workspaceId && scope.siteId === audience.siteId

export class AiCreditService {
  readonly #repository: AiCreditRepository
  readonly #catalog: Pick<AiCatalogService, 'quote'>
  readonly #cipher: AiByokMetadataCipher
  readonly #quota?: AiCreditQuotaPort
  readonly #meter?: AiCreditMeterPort
  readonly #audit?: AiCreditAuditPort
  readonly #now: () => Date
  constructor(input: Readonly<{ repository: AiCreditRepository; catalog: Pick<AiCatalogService, 'quote'>; cipher: AiByokMetadataCipher; quota?: AiCreditQuotaPort; meter?: AiCreditMeterPort; audit?: AiCreditAuditPort; now?: () => Date }>) {
    this.#repository = input.repository; this.#catalog = input.catalog; this.#cipher = input.cipher; this.#quota = input.quota; this.#meter = input.meter; this.#audit = input.audit; this.#now = input.now ?? (() => new Date())
  }
  #instant(): string { return this.#now().toISOString() }

  grant(raw: unknown) { return this.#credit('grant', raw) }
  purchase(raw: unknown) { return this.#credit('purchase', raw) }
  async #credit(kind: 'grant' | 'purchase', raw: unknown): Promise<AiCreditAccount> {
    const command = parseAiCreditContract(AiCreditCommandSchema, raw, `aiCredits.${kind}`)
    const at = this.#instant(); if (command.expiresAt !== null && timestamp(command.expiresAt) <= timestamp(at)) throw new AiCreditServiceError('invalid', 'Credit expiry must be in the future.')
    const snapshot = await this.#repository.snapshot(command.accountId)
    if (snapshot && !sameAiCreditScope(snapshot.account.scope, command.scope)) throw new AiCreditServiceError('scope', 'Credit account scope changed.')
    const current = snapshot?.account
    const account: AiCreditAccount = Object.freeze({ accountId: command.accountId, scope: command.scope, balanceMicros: (current?.balanceMicros ?? 0) + command.amountMicros, reservedMicros: current?.reservedMicros ?? 0, spentMicros: current?.spentMicros ?? 0, budgetMicros: command.budgetMicros, version: (current?.version ?? 0) + 1, updatedAt: at })
    const result = await this.#repository.credit({ account, expectedVersion: current?.version ?? null, lot: { lotId: command.lotId, accountId: command.accountId, kind, amountMicros: command.amountMicros, remainingMicros: command.amountMicros, expiresAt: command.expiresAt, evidenceId: command.evidenceId, idempotencyKey: command.idempotencyKey, createdAt: at } }).catch((error) => { throw policyFailure(error) })
    return result.value
  }

  async reserve(raw: unknown): Promise<AiCreditReservation> {
    const command = parseAiCreditContract(AiCreditReserveCommandSchema, raw, 'aiCredits.reserve')
    const now = this.#instant(); const expiry = timestamp(command.expiresAt)
    if (expiry <= timestamp(now) || expiry - timestamp(now) > MAX_RESERVATION_MS) throw new AiCreditServiceError('invalid', 'Reservation must expire within 24 hours.')
    const prior = await this.#repository.reservation(command.reservationId)
    if (prior) {
      const unchanged = prior.state === 'reserved' && prior.idempotencyKey === command.idempotencyKey && prior.accountId === command.accountId
        && sameAiCreditScope(prior.scope, command.scope) && prior.mode === command.mode && prior.byokCredentialId === command.byokCredentialId
        && prior.quote.providerId === command.providerId && prior.quote.modelId === command.modelId
        && prior.quote.inputTokens === command.estimatedInputTokens && prior.quote.outputTokens === command.estimatedOutputTokens
        && prior.expiresAt === command.expiresAt
      if (!unchanged) throw new AiCreditServiceError('conflict', 'Reservation idempotency evidence changed.')
      return prior
    }
    const snapshot = await this.#repository.snapshot(command.accountId)
    if (!snapshot || !sameAiCreditScope(snapshot.account.scope, command.scope) || !sameAudience(command.scope, command.audience)) throw new AiCreditServiceError('scope', 'Exact account and catalog ancestry is required.')
    if (snapshot.account.version !== command.expectedAccountVersion) throw new AiCreditServiceError('conflict', 'Credit account version changed.')
    let byok: AiByokCredential | null = null
    if (command.mode === 'byok') {
      if (!command.byokCredentialId) throw new AiCreditServiceError('credential', 'BYOK mode requires an opaque credential reference.')
      byok = await this.#repository.credential(command.byokCredentialId)
      if (!byok || byok.state !== 'active' || byok.providerId !== command.providerId || !sameAiCreditScope(byok.scope, command.scope)) throw new AiCreditServiceError('credential', 'Active exact-scope BYOK metadata is required.')
    } else if (command.byokCredentialId !== null) throw new AiCreditServiceError('invalid', 'Platform turns cannot carry BYOK metadata.')
    let quoted
    try { quoted = await this.#catalog.quote(command.audience, { providerId: command.providerId, modelId: command.modelId, inputTokens: command.estimatedInputTokens, outputTokens: command.estimatedOutputTokens }) } catch { throw new AiCreditServiceError('catalog', 'Catalog quote is unavailable.') }
    const charge = command.mode === 'byok' ? 0 : quoted.chargeMicros
    const quote: AiCatalogQuoteEvidence = Object.freeze({ ...quoted, chargeMicros: charge, bindingSha256: digest({ ...quoted, chargeMicros: charge, mode: command.mode, credentialId: byok?.credentialId ?? null }) })
    const reservation: AiCreditReservation = Object.freeze({ reservationId: command.reservationId, idempotencyKey: command.idempotencyKey, accountId: command.accountId, scope: command.scope, mode: command.mode, byokCredentialId: command.byokCredentialId, quote, reservedMicros: charge, state: 'reserved', version: 1, expiresAt: command.expiresAt, createdAt: now, resolvedAt: null })
    try {
      if (charge > 0) await this.#quota?.reserve(`ai-credit:${command.reservationId}`, snapshot.account, charge)
      return (await this.#repository.reserve({ reservation, expectedAccountVersion: command.expectedAccountVersion })).value
    } catch (error) {
      if (charge > 0) await this.#quota?.release(`ai-credit:${command.reservationId}`).catch(() => {})
      throw policyFailure(error)
    }
  }

  async settle(raw: unknown): Promise<AiCreditSettlement> {
    const command = parseAiCreditContract(AiCreditSettlementCommandSchema, raw, 'aiCredits.settle')
    const reservation = await this.#repository.reservation(command.reservationId)
    if (reservation?.state === 'settled' && reservation.version === command.expectedReservationVersion + 1) {
      const snapshot = await this.#repository.snapshot(reservation.accountId)
      const replay = snapshot?.settlements.find((value) => value.reservationId === reservation.reservationId)
      if (replay?.idempotencyKey === command.idempotencyKey && replay.inputTokens === command.inputTokens && replay.outputTokens === command.outputTokens) return replay
      throw new AiCreditServiceError('conflict', 'Settlement idempotency evidence changed.')
    }
    if (!reservation || reservation.state !== 'reserved' || reservation.version !== command.expectedReservationVersion) throw new AiCreditServiceError('conflict', 'Reservation is not settleable.')
    const audience = { kind: 'customer' as const, platformId: reservation.scope.platformId, organizationId: reservation.scope.organizationId, workspaceId: reservation.scope.workspaceId, siteId: reservation.scope.siteId, profile: 'website' as const }
    let actual
    try { actual = await this.#catalog.quote(audience, { providerId: reservation.quote.providerId, modelId: reservation.quote.modelId, inputTokens: command.inputTokens, outputTokens: command.outputTokens }) } catch { throw new AiCreditServiceError('catalog', 'Actual catalog cost is unavailable.') }
    const chargedMicros = reservation.mode === 'byok' ? 0 : actual.chargeMicros
    if (chargedMicros > reservation.reservedMicros) throw new AiCreditServiceError('exhausted', 'Actual turn cost exceeds its catalog-bound reservation.')
    const settlement: AiCreditSettlement = Object.freeze({ settlementId: `settlement:${reservation.reservationId}`, reservationId: reservation.reservationId, idempotencyKey: command.idempotencyKey, inputTokens: command.inputTokens, outputTokens: command.outputTokens, providerCostMicros: actual.providerCostMicros, markupMicros: actual.markupMicros, chargedMicros, refundedMicros: 0, quoteBindingSha256: reservation.quote.bindingSha256, createdAt: this.#instant() })
    const result = await this.#repository.settle({ settlement, expectedReservationVersion: command.expectedReservationVersion }).catch((error) => { throw policyFailure(error) })
    if (result.duplicate) return result.value
    const snapshot = await this.#repository.snapshot(reservation.accountId)
    if (snapshot) {
      await this.#quota?.settle(`ai-credit:${reservation.reservationId}`, chargedMicros)
      await this.#meter?.settle({ key: `ai-credit:${reservation.reservationId}`, account: snapshot.account, logicalCredits: chargedMicros, providerCostMicros: actual.providerCostMicros })
    }
    await this.#audit?.record({ event: 'credit.settled', reservationId: reservation.reservationId, chargedMicros, providerCostMicros: actual.providerCostMicros })
    return result.value
  }

  async release(raw: unknown): Promise<AiCreditReservation> { return this.#resolve('released', raw) }
  async #resolve(state: 'released' | 'expired', raw: unknown): Promise<AiCreditReservation> {
    const command = parseAiCreditContract(AiCreditResolutionCommandSchema, raw, `aiCredits.${state}`)
    const result = await this.#repository.resolve({ ...command, state, resolvedAt: this.#instant() }).catch((error) => { throw policyFailure(error) })
    await this.#quota?.release(`ai-credit:${command.reservationId}`)
    return result.value
  }
  async refund(raw: unknown): Promise<AiCreditSettlement> {
    const command = parseAiCreditContract(AiCreditResolutionCommandSchema, raw, 'aiCredits.refund')
    return (await this.#repository.refund({ ...command, refundedAt: this.#instant() }).catch((error) => { throw policyFailure(error) })).value
  }
  expireDue(limit = 100): Promise<readonly AiCreditReservation[]> { return this.#repository.expireDue(this.#instant(), limit) }

  async attachByok(raw: unknown): Promise<AiByokCredentialView> {
    const command = parseAiCreditContract(AiByokAttachCommandSchema, raw, 'aiCredits.byok.attach'); const now = this.#instant()
    const envelope = await this.#cipher.encrypt({ providerId: command.providerId, existingCredentialId: command.existingCredentialId, displayLabel: command.displayLabel }, credentialAad(command.credentialId, command.scope.ownerGeneration))
    const credential: AiByokCredential = Object.freeze({ credentialId: command.credentialId, scope: command.scope, providerId: command.providerId, envelope, state: 'active', version: 1, createdAt: now, updatedAt: now })
    const stored = await this.#repository.putCredential({ credential, idempotencyKey: command.idempotencyKey, expectedVersion: null }).catch((error) => { throw policyFailure(error) })
    return this.#credentialView(stored.value)
  }
  async #credentialView(value: AiByokCredential): Promise<AiByokCredentialView> {
    const metadata = await this.#cipher.decrypt(value.envelope, credentialAad(value.credentialId, value.scope.ownerGeneration))
    return Object.freeze({ credentialId: value.credentialId, providerId: value.providerId, displayLabel: metadata.displayLabel, state: value.state, version: value.version, keyCurrent: value.envelope.keyId === this.#cipher.keyId, createdAt: value.createdAt, updatedAt: value.updatedAt })
  }
  async view(accountId: string): Promise<AiCreditAccountView> {
    const snapshot = await this.#repository.snapshot(accountId); if (!snapshot) throw new AiCreditServiceError('scope', 'Credit account unavailable.')
    const at = this.#now().getTime(); const unexpired = snapshot.lots.filter((v) => v.expiresAt === null || Date.parse(v.expiresAt) > at).reduce((sum, v) => sum + v.remainingMicros, 0)
    const availableMicros = Math.max(0, Math.min(unexpired - snapshot.account.reservedMicros, snapshot.account.budgetMicros - snapshot.account.spentMicros - snapshot.account.reservedMicros))
    const credentials: AiByokCredentialView[] = []
    for (const value of snapshot.credentials) credentials.push(await this.#credentialView(value))
    return Object.freeze({ accountId, balanceMicros: snapshot.account.balanceMicros, reservedMicros: snapshot.account.reservedMicros, spentMicros: snapshot.account.spentMicros, budgetMicros: snapshot.account.budgetMicros, availableMicros, version: snapshot.account.version, credentials: Object.freeze(credentials) })
  }
}
export const credentialAad = (credentialId: string, generation: number): string => `fuma-ai-byok:v1:${credentialId}:${generation}`
function policyFailure(error: unknown): AiCreditServiceError {
  if (error instanceof AiCreditServiceError) return error
  if (error instanceof AiCreditRepositoryError) return new AiCreditServiceError(error.code === 'budget-exhausted' ? 'budget-exhausted' : error.code === 'exhausted' ? 'exhausted' : 'conflict', error.message)
  return new AiCreditServiceError('conflict', 'AI credit authority failed safely.')
}

import type { AiCatalogQuote } from '../aiCatalog'
import { DeterministicAiByokMetadataCipher } from './credentialCipher'
import { MemoryAiCreditRepository } from './memory'
import { AiCreditService } from './service'
import { aiCreditToolContext, reservationAuditFact, settlementAuditFact } from './redaction'

const NOW = new Date('2026-07-28T12:00:00.000Z')
const scope = Object.freeze({ platformId: 'fuma', organizationId: 'organization-a', workspaceId: 'workspace-a', siteId: 'site-a', ownerKey: 'owner-a', ownerGeneration: 1 })
const audience = Object.freeze({ kind: 'customer' as const, platformId: 'fuma', organizationId: 'organization-a', workspaceId: 'workspace-a', siteId: 'site-a', profile: 'website' as const })
class FixtureCatalog {
  async quote(_audience: unknown, request: unknown): Promise<AiCatalogQuote> {
    const value = request as { providerId: string; modelId: string; inputTokens: number; outputTokens: number }
    const providerCostMicros = Math.ceil((value.inputTokens * 1_000_000 + value.outputTokens * 2_000_000) / 1_000_000)
    const included = value.modelId === 'included-model'
    return { ...value, providerCostMicros, markupMicros: Math.ceil(providerCostMicros * 2500 / 10_000), chargeMicros: included ? 0 : providerCostMicros + Math.ceil(providerCostMicros * 2500 / 10_000), included }
  }
}
export type AiCreditDemoEvidence = Readonly<{ includedChargeMicros: number; paidChargeMicros: number; exhaustedDenied: boolean; byokChargeMicros: number; providerCostMicros: number; refundedMicros: number; expiredReservations: number; secretFree: boolean }>
export async function runAiCreditDemo(): Promise<AiCreditDemoEvidence> {
  const repository = new MemoryAiCreditRepository(); const cipher = new DeterministicAiByokMetadataCipher(); const service = new AiCreditService({ repository, catalog: new FixtureCatalog(), cipher, now: () => NOW })
  await service.grant({ lotId: 'grant-a', accountId: 'account-a', scope, amountMicros: 5_000_000, budgetMicros: 5_000_000, expiresAt: '2026-07-29T12:00:00.000Z', evidenceId: 'grant-evidence-a', idempotencyKey: 'grant-key-a' })
  const account1 = (await repository.snapshot('account-a'))!.account
  const included = await service.reserve({ reservationId: 'included-turn', accountId: 'account-a', scope, audience, providerId: 'provider-a', modelId: 'included-model', estimatedInputTokens: 100, estimatedOutputTokens: 100, mode: 'platform', byokCredentialId: null, expiresAt: '2026-07-28T12:30:00.000Z', expectedAccountVersion: account1.version, idempotencyKey: 'included-turn' })
  const paid = await service.reserve({ reservationId: 'paid-turn', accountId: 'account-a', scope, audience, providerId: 'provider-a', modelId: 'paid-model', estimatedInputTokens: 1_000_000, estimatedOutputTokens: 1_000_000, mode: 'platform', byokCredentialId: null, expiresAt: '2026-07-28T12:30:00.000Z', expectedAccountVersion: (await repository.snapshot('account-a'))!.account.version, idempotencyKey: 'paid-turn' })
  const settled = await service.settle({ reservationId: paid.reservationId, inputTokens: 500_000, outputTokens: 500_000, idempotencyKey: 'settle-paid-turn', expectedReservationVersion: paid.version })
  let exhaustedDenied = false
  try { await service.reserve({ reservationId: 'exhausted-turn', accountId: 'account-a', scope, audience, providerId: 'provider-a', modelId: 'paid-model', estimatedInputTokens: 2_000_000, estimatedOutputTokens: 2_000_000, mode: 'platform', byokCredentialId: null, expiresAt: '2026-07-28T12:30:00.000Z', expectedAccountVersion: (await repository.snapshot('account-a'))!.account.version, idempotencyKey: 'exhausted-turn' }) } catch { exhaustedDenied = true }
  await service.attachByok({ credentialId: 'byok-a', scope, providerId: 'provider-a', existingCredentialId: 'native-credential-opaque-a', displayLabel: 'My provider', idempotencyKey: 'attach-byok-a' })
  const byok = await service.reserve({ reservationId: 'byok-turn', accountId: 'account-a', scope, audience, providerId: 'provider-a', modelId: 'paid-model', estimatedInputTokens: 1_000_000, estimatedOutputTokens: 1_000_000, mode: 'byok', byokCredentialId: 'byok-a', expiresAt: '2026-07-28T12:30:00.000Z', expectedAccountVersion: (await repository.snapshot('account-a'))!.account.version, idempotencyKey: 'byok-turn' })
  const byokSettlement = await service.settle({ reservationId: byok.reservationId, inputTokens: 100, outputTokens: 100, idempotencyKey: 'settle-byok-turn', expectedReservationVersion: byok.version })
  const refunded = await service.refund({ reservationId: paid.reservationId, idempotencyKey: 'refund-paid-turn', expectedReservationVersion: 2 })
  repository.reservations.set('expired-turn', { ...included, reservationId: 'expired-turn', reservedMicros: 0, expiresAt: '2026-07-28T11:00:00.000Z' }); const expired = await service.expireDue()
  const serialized = JSON.stringify({ view: await service.view('account-a'), included: reservationAuditFact(included), paid: settlementAuditFact(settled), byok: aiCreditToolContext(byok), byokSettlement: settlementAuditFact(byokSettlement) })
  return Object.freeze({ includedChargeMicros: included.reservedMicros, paidChargeMicros: settled.chargedMicros, exhaustedDenied, byokChargeMicros: byokSettlement.chargedMicros, providerCostMicros: byokSettlement.providerCostMicros, refundedMicros: refunded.refundedMicros, expiredReservations: expired.length, secretFree: !/native-credential|ciphertext|keyId|ownerKey/i.test(serialized) })
}

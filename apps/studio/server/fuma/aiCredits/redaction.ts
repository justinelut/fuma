import type { AiByokCredential, AiCreditReservation, AiCreditSettlement } from './contracts'

export type AiCreditAuditFact = Readonly<{
  event: 'credit.reserved' | 'credit.settled' | 'credit.released' | 'credit.refunded' | 'byok.attached' | 'byok.detached' | 'byok.rekey-required'
  accountId?: string
  reservationId?: string
  credentialId?: string
  providerId?: string
  modelId?: string
  chargedMicros?: number
  providerCostMicros?: number
}>
export function reservationAuditFact(value: AiCreditReservation): AiCreditAuditFact {
  return Object.freeze({ event: 'credit.reserved', accountId: value.accountId, reservationId: value.reservationId, providerId: value.quote.providerId, modelId: value.quote.modelId })
}
export function settlementAuditFact(value: AiCreditSettlement): AiCreditAuditFact {
  return Object.freeze({ event: 'credit.settled', reservationId: value.reservationId, chargedMicros: value.chargedMicros, providerCostMicros: value.providerCostMicros })
}
export function credentialAuditFact(value: AiByokCredential): AiCreditAuditFact {
  return Object.freeze({ event: value.state === 'detached' ? 'byok.detached' : value.state === 'rekey-required' ? 'byok.rekey-required' : 'byok.attached', credentialId: value.credentialId, providerId: value.providerId })
}
/** Intentionally excludes envelope, native credential reference, owner key, and key identifiers. */
export function aiCreditToolContext(value: AiCreditReservation): Readonly<{ reservationId: string; mode: 'platform' | 'byok'; providerId: string; modelId: string }> {
  return Object.freeze({ reservationId: value.reservationId, mode: value.mode, providerId: value.quote.providerId, modelId: value.quote.modelId })
}

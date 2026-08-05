import type { AiByokCredential, AiCreditAccount, AiCreditLot, AiCreditReservation, AiCreditScope, AiCreditSettlement } from './contracts'

export type AiCreditSnapshot = Readonly<{
  account: AiCreditAccount
  lots: readonly AiCreditLot[]
  reservations: readonly AiCreditReservation[]
  settlements: readonly AiCreditSettlement[]
  credentials: readonly AiByokCredential[]
}>
export type AiCreditWriteOutcome<T> = Readonly<{ duplicate: boolean; value: T }>

export interface AiCreditRepository {
  snapshot(accountId: string): Promise<AiCreditSnapshot | null>
  snapshotForScope(scope: AiCreditScope): Promise<AiCreditSnapshot | null>
  reservation(reservationId: string): Promise<AiCreditReservation | null>
  credential(credentialId: string): Promise<AiByokCredential | null>
  credit(input: Readonly<{ account: AiCreditAccount; lot: AiCreditLot; expectedVersion: number | null }>): Promise<AiCreditWriteOutcome<AiCreditAccount>>
  reserve(input: Readonly<{ reservation: AiCreditReservation; expectedAccountVersion: number }>): Promise<AiCreditWriteOutcome<AiCreditReservation>>
  settle(input: Readonly<{ settlement: AiCreditSettlement; expectedReservationVersion: number }>): Promise<AiCreditWriteOutcome<AiCreditSettlement>>
  resolve(input: Readonly<{ reservationId: string; idempotencyKey: string; state: 'released' | 'expired'; expectedReservationVersion: number; resolvedAt: string }>): Promise<AiCreditWriteOutcome<AiCreditReservation>>
  refund(input: Readonly<{ reservationId: string; idempotencyKey: string; expectedReservationVersion: number; refundedAt: string }>): Promise<AiCreditWriteOutcome<AiCreditSettlement>>
  putCredential(input: Readonly<{ credential: AiByokCredential; idempotencyKey: string; expectedVersion: number | null }>): Promise<AiCreditWriteOutcome<AiByokCredential>>
  expireDue(now: string, limit: number): Promise<readonly AiCreditReservation[]>
}

export class AiCreditRepositoryError extends Error {
  override readonly name = 'AiCreditRepositoryError'
  readonly code: 'not-found' | 'conflict' | 'exhausted' | 'budget-exhausted' | 'duplicate-mismatch'
  constructor(code: AiCreditRepositoryError['code'], message: string) { super(message); this.code = code }
}

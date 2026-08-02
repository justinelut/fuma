import { describe, expect, it } from 'bun:test'
import { runAiCreditDemo } from '../../../server/fuma/aiCredits'

describe('FUMA-064 deterministic AI credit and BYOK demo', () => {
  it('proves included, actual paid, exhausted, BYOK, refund, expiry, and secret-free turns', async () => {
    const evidence = await runAiCreditDemo()
    expect(evidence).toEqual({
      includedChargeMicros: 0,
      paidChargeMicros: 1_875_000,
      exhaustedDenied: true,
      byokChargeMicros: 0,
      providerCostMicros: 300,
      refundedMicros: 1_875_000,
      expiredReservations: 1,
      secretFree: true,
    })
    process.stdout.write(
      `[FUMA-064 demo] included=${evidence.includedChargeMicros} paid=${evidence.paidChargeMicros} exhausted=${evidence.exhaustedDenied} byok=${evidence.byokChargeMicros} providerCost=${evidence.providerCostMicros} refunded=${evidence.refundedMicros} expired=${evidence.expiredReservations} secretFree=${evidence.secretFree}\n`,
    )
  })
})

import { describe, expect, it } from 'bun:test'
import {
  aiCreditAudience,
  aiCreditScope,
  createAiCreditFixture,
  grantCommand,
  reserveCommand,
} from './aiCreditsTestFixture'

describe('FUMA-064 AI credit lifecycle unit', () => {
  it('records idempotent immutable grant and purchase lots across clock movement', async () => {
    const fixture = createAiCreditFixture()
    const granted = await fixture.service.grant(grantCommand({ amountMicros: 2_000_000, budgetMicros: 6_000_000 }))
    fixture.clock.now = new Date('2026-07-28T12:01:00.000Z')
    const replay = await fixture.service.grant(grantCommand({ amountMicros: 2_000_000, budgetMicros: 6_000_000 }))
    expect(replay).toEqual(granted)

    await fixture.service.purchase(grantCommand({
      lotId: 'purchase-a',
      amountMicros: 3_000_000,
      evidenceId: 'purchase-evidence-a',
      idempotencyKey: 'purchase-key-a',
      expiresAt: null,
      budgetMicros: 6_000_000,
    }))
    const snapshot = await fixture.repository.snapshot('account-a')
    expect(snapshot?.account).toMatchObject({ balanceMicros: 5_000_000, version: 2 })
    expect(snapshot?.lots.map(({ kind, amountMicros }) => ({ kind, amountMicros }))).toEqual([
      { kind: 'grant', amountMicros: 2_000_000 },
      { kind: 'purchase', amountMicros: 3_000_000 },
    ])
  })

  it('settles actual catalog tokens, consumes earliest-expiring credits, and refunds without overfilling lots', async () => {
    const fixture = createAiCreditFixture()
    await fixture.service.grant(grantCommand({ amountMicros: 2_000_000 }))
    await fixture.service.purchase(grantCommand({
      lotId: 'purchase-a',
      amountMicros: 3_000_000,
      evidenceId: 'purchase-a',
      idempotencyKey: 'purchase-a',
      expiresAt: null,
    }))
    const command = await reserveCommand(fixture)
    const reservation = await fixture.service.reserve(command)
    expect(reservation).toMatchObject({ reservedMicros: 3_750_000, state: 'reserved', version: 1 })

    const settlementCommand = {
      reservationId: reservation.reservationId,
      inputTokens: 500_000,
      outputTokens: 500_000,
      idempotencyKey: 'settlement-a',
      expectedReservationVersion: 1,
    }
    const settlement = await fixture.service.settle(settlementCommand)
    expect(settlement).toMatchObject({
      providerCostMicros: 1_500_000,
      markupMicros: 375_000,
      chargedMicros: 1_875_000,
      quoteBindingSha256: reservation.quote.bindingSha256,
    })
    expect(await fixture.service.settle(settlementCommand)).toEqual(settlement)
    let snapshot = (await fixture.repository.snapshot('account-a'))!
    expect(snapshot.account).toMatchObject({ balanceMicros: 3_125_000, reservedMicros: 0, spentMicros: 1_875_000 })
    expect(snapshot.lots.map(({ remainingMicros }) => remainingMicros)).toEqual([125_000, 3_000_000])
    expect(fixture.meterEvents).toHaveLength(1)

    const refunded = await fixture.service.refund({
      reservationId: reservation.reservationId,
      idempotencyKey: 'refund-a',
      expectedReservationVersion: 2,
    })
    expect(refunded.refundedMicros).toBe(1_875_000)
    snapshot = (await fixture.repository.snapshot('account-a'))!
    expect(snapshot.account).toMatchObject({ balanceMicros: 5_000_000, spentMicros: 0 })
    expect(snapshot.lots.map(({ remainingMicros }) => remainingMicros)).toEqual([2_000_000, 3_000_000])
  })

  it('fails budget admission separately from balance exhaustion', async () => {
    const fixture = createAiCreditFixture()
    await fixture.service.grant(grantCommand({ amountMicros: 10_000_000, budgetMicros: 2_000_000 }))
    await expect(fixture.service.reserve(await reserveCommand(fixture))).rejects.toMatchObject({
      code: 'budget-exhausted',
    })
    expect((await fixture.repository.snapshot('account-a'))?.account.reservedMicros).toBe(0)
  })

  it('does not collateralize a reservation with a lot that expires first and expires due lots/reservations', async () => {
    const fixture = createAiCreditFixture()
    await fixture.service.grant(grantCommand({ expiresAt: '2026-07-28T12:10:00.000Z' }))
    await expect(fixture.service.reserve(await reserveCommand(fixture, {
      expiresAt: '2026-07-28T12:30:00.000Z',
    }))).rejects.toMatchObject({ code: 'exhausted' })

    await fixture.service.purchase(grantCommand({
      lotId: 'purchase-a',
      evidenceId: 'purchase-a',
      idempotencyKey: 'purchase-a',
      expiresAt: null,
    }))
    const reservation = await fixture.service.reserve(await reserveCommand(fixture, {
      reservationId: 'expiring-reservation',
      idempotencyKey: 'expiring-reservation',
      expiresAt: '2026-07-28T12:05:00.000Z',
    }))
    fixture.clock.now = new Date('2026-07-28T12:15:00.000Z')
    expect(await fixture.service.expireDue()).toEqual([
      expect.objectContaining({ reservationId: reservation.reservationId, state: 'expired' }),
    ])
    const snapshot = (await fixture.repository.snapshot('account-a'))!
    expect(snapshot.lots[0]?.remainingMicros).toBe(0)
    expect(snapshot.account.reservedMicros).toBe(0)
  })

  it('charges included and active exact-scope BYOK turns zero while retaining provider-cost evidence', async () => {
    const fixture = createAiCreditFixture()
    await fixture.service.grant(grantCommand())
    const included = await fixture.service.reserve(await reserveCommand(fixture, {
      reservationId: 'included-a',
      idempotencyKey: 'included-a',
      modelId: 'included-model',
    }))
    const includedSettlement = await fixture.service.settle({
      reservationId: included.reservationId,
      inputTokens: 100,
      outputTokens: 100,
      idempotencyKey: 'settle-included-a',
      expectedReservationVersion: 1,
    })
    expect(includedSettlement).toMatchObject({ chargedMicros: 0, providerCostMicros: 300 })

    await fixture.service.attachByok({
      credentialId: 'byok-a',
      scope: aiCreditScope,
      providerId: 'provider-a',
      existingCredentialId: 'native-opaque-a',
      displayLabel: 'Customer provider',
      idempotencyKey: 'attach-byok-a',
    })
    const byok = await fixture.service.reserve(await reserveCommand(fixture, {
      reservationId: 'byok-a',
      idempotencyKey: 'byok-a',
      audience: aiCreditAudience,
      mode: 'byok',
      byokCredentialId: 'byok-a',
    }))
    const settled = await fixture.service.settle({
      reservationId: byok.reservationId,
      inputTokens: 1_000,
      outputTokens: 1_000,
      idempotencyKey: 'settle-byok-a',
      expectedReservationVersion: 1,
    })
    expect(settled).toMatchObject({ chargedMicros: 0, providerCostMicros: 3_000 })
    expect(fixture.quotaEvents.filter((value) => value.startsWith('reserve:'))).toHaveLength(0)
  })

  it('rejects a second account identity for an existing exact owner scope', async () => {
    const fixture = createAiCreditFixture()
    await fixture.service.grant(grantCommand())
    await expect(fixture.service.grant(grantCommand({
      accountId: 'account-b',
      lotId: 'grant-b',
      evidenceId: 'grant-b',
      idempotencyKey: 'grant-b',
    }))).rejects.toMatchObject({ code: 'conflict' })
    expect(await fixture.repository.snapshot('account-b')).toBeNull()
  })
})

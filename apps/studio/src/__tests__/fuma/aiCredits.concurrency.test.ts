import { describe, expect, it } from 'bun:test'
import { createAiCreditFixture, grantCommand, reserveCommand } from './aiCreditsTestFixture'

describe('FUMA-064 AI credit concurrency', () => {
  it('allows only one differently identified reservation at the same account fence', async () => {
    const fixture = createAiCreditFixture()
    await fixture.service.grant(grantCommand({ amountMicros: 4_000_000, budgetMicros: 4_000_000 }))
    const first = await reserveCommand(fixture, { reservationId: 'race-a', idempotencyKey: 'race-a' })
    const second = { ...first, reservationId: 'race-b', idempotencyKey: 'race-b' }
    const results = await Promise.allSettled([
      fixture.service.reserve(first),
      fixture.service.reserve(second),
    ])
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    expect((await fixture.repository.snapshot('account-a'))?.account).toMatchObject({
      reservedMicros: 3_750_000,
      version: 2,
    })
  })

  it('deduplicates the same concurrent reservation and settlement without double charging ports', async () => {
    const fixture = createAiCreditFixture()
    await fixture.service.grant(grantCommand())
    const command = await reserveCommand(fixture)
    const reservations = await Promise.all([
      fixture.service.reserve(command),
      fixture.service.reserve(command),
    ])
    expect(reservations[0]).toEqual(reservations[1])
    expect(fixture.repository.reservations).toHaveLength(1)

    const settlement = {
      reservationId: reservations[0]!.reservationId,
      inputTokens: 500_000,
      outputTokens: 500_000,
      idempotencyKey: 'settlement-race-a',
      expectedReservationVersion: 1,
    }
    const settled = await Promise.all([
      fixture.service.settle(settlement),
      fixture.service.settle(settlement),
    ])
    expect(settled[0]).toEqual(settled[1])
    expect(fixture.repository.settlements).toHaveLength(1)
    expect(fixture.meterEvents).toHaveLength(1)
    expect(fixture.auditEvents).toHaveLength(1)
  })
})

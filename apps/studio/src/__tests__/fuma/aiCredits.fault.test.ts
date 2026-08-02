import { describe, expect, it } from 'bun:test'
import { AiCreditService } from '../../../server/fuma/aiCredits'
import {
  createAiCreditFixture,
  grantCommand,
  reserveCommand,
} from './aiCreditsTestFixture'

describe('FUMA-064 AI credit fault handling', () => {
  it('leaves no partial grant or reservation and compensates quota on repository failure', async () => {
    const fixture = createAiCreditFixture()
    fixture.repository.failNext = 'credit'
    await expect(fixture.service.grant(grantCommand())).rejects.toMatchObject({ code: 'conflict' })
    expect(await fixture.repository.snapshot('account-a')).toBeNull()

    await fixture.service.grant(grantCommand())
    fixture.repository.failNext = 'reserve'
    await expect(fixture.service.reserve(await reserveCommand(fixture))).rejects.toMatchObject({ code: 'conflict' })
    expect((await fixture.repository.snapshot('account-a'))?.account.reservedMicros).toBe(0)
    expect(fixture.quotaEvents).toEqual([
      'reserve:ai-credit:reservation-a',
      'release:ai-credit:reservation-a',
    ])
  })

  it('leaves a reservation intact when settlement persistence fails', async () => {
    const fixture = createAiCreditFixture()
    await fixture.service.grant(grantCommand())
    const reservation = await fixture.service.reserve(await reserveCommand(fixture))
    fixture.repository.failNext = 'settle'
    await expect(fixture.service.settle({
      reservationId: reservation.reservationId,
      inputTokens: 100,
      outputTokens: 100,
      idempotencyKey: 'settlement-failure',
      expectedReservationVersion: 1,
    })).rejects.toMatchObject({ code: 'conflict' })
    expect(await fixture.repository.reservation(reservation.reservationId)).toMatchObject({
      state: 'reserved',
      version: 1,
    })
  })

  it('fails closed when actual catalog pricing exceeds the fenced reservation', async () => {
    const fixture = createAiCreditFixture()
    await fixture.service.grant(grantCommand())
    const reservation = await fixture.service.reserve(await reserveCommand(fixture, {
      estimatedInputTokens: 100,
      estimatedOutputTokens: 100,
    }))
    fixture.catalog.priceMultiplier = 100
    await expect(fixture.service.settle({
      reservationId: reservation.reservationId,
      inputTokens: 100,
      outputTokens: 100,
      idempotencyKey: 'settlement-overage',
      expectedReservationVersion: 1,
    })).rejects.toMatchObject({ code: 'exhausted' })
    expect(await fixture.repository.reservation(reservation.reservationId)).toMatchObject({ state: 'reserved' })
  })

  it('collapses provider failures to secret-free catalog errors', async () => {
    const fixture = createAiCreditFixture()
    await fixture.service.grant(grantCommand())
    fixture.catalog.fail = new Error('provider sk_live_never_return failed')
    await expect(fixture.service.reserve(await reserveCommand(fixture))).rejects.toMatchObject({
      code: 'catalog',
      message: 'Catalog quote is unavailable.',
    })
  })

  it('rejects changed idempotency evidence for grants, reservations, settlements, and BYOK metadata', async () => {
    const fixture = createAiCreditFixture()
    await fixture.service.grant(grantCommand())
    await expect(fixture.service.grant(grantCommand({ amountMicros: 4_999_999 }))).rejects.toMatchObject({ code: 'conflict' })

    const command = await reserveCommand(fixture)
    const reservation = await fixture.service.reserve(command)
    await expect(fixture.service.reserve({ ...command, modelId: 'changed-model' })).rejects.toMatchObject({ code: 'conflict' })
    const settlement = {
      reservationId: reservation.reservationId,
      inputTokens: 100,
      outputTokens: 100,
      idempotencyKey: 'settlement-a',
      expectedReservationVersion: 1,
    }
    await fixture.service.settle(settlement)
    await expect(fixture.service.settle({ ...settlement, outputTokens: 101 })).rejects.toMatchObject({ code: 'conflict' })

    await fixture.service.attachByok({
      credentialId: 'byok-a', scope: grantCommand().scope, providerId: 'provider-a',
      existingCredentialId: 'native-a', displayLabel: 'Primary', idempotencyKey: 'byok-key-a',
    })
    await expect(fixture.service.attachByok({
      credentialId: 'byok-a', scope: grantCommand().scope, providerId: 'provider-a',
      existingCredentialId: 'native-a', displayLabel: 'Changed', idempotencyKey: 'byok-key-a',
    })).rejects.toMatchObject({ code: 'conflict' })
  })

  it('maps unexpected repository exceptions to one safe policy failure', async () => {
    const fixture = createAiCreditFixture()
    await fixture.service.grant(grantCommand())
    fixture.repository.failNext = 'reserve'
    const isolated = new AiCreditService({
      repository: fixture.repository,
      catalog: fixture.catalog,
      cipher: fixture.cipher,
      now: () => fixture.clock.now,
    })
    await expect(isolated.reserve(await reserveCommand(fixture))).rejects.toEqual(
      expect.objectContaining({ code: 'conflict', message: 'AI credit authority failed safely.' }),
    )
  })
})

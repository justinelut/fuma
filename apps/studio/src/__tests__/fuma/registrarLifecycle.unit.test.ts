import { describe, expect, it } from 'bun:test'
import { MemoryRegistrarWorkflowRepository } from '../../../server/fuma/registrar/memory'
import {
  createRegistrarHarness,
  purchaseCommand,
  quoted,
  registrarScope,
  renewalCommand,
} from './registrarLifecycleTestFixture'

describe('FUMA-061 registrar lifecycle unit acceptance', () => {
  it('normalizes search identity and persists one exact KES minor-unit quote', async () => {
    const harness = createRegistrarHarness()
    const quote = await quoted(harness, 'Example.CO.KE.', 2)

    expect(quote).toMatchObject({
      hostname: 'example.co.ke',
      currency: 'KES',
      registrationAmountMinor: 240_000,
      renewalAmountMinor: 260_000,
      periodYears: 2,
    })
    expect(await harness.repository.quote(registrarScope, quote.quoteId)).toEqual(quote)
  })

  it('double confirmation returns the immutable receipt without a second purchase or handoff', async () => {
    const harness = createRegistrarHarness()
    const quote = await quoted(harness)
    const command = purchaseCommand(quote)

    const first = await harness.workflow.purchase(registrarScope, command)
    const duplicate = await harness.workflow.purchase(registrarScope, command)

    expect(duplicate).toEqual(first)
    expect(first).toMatchObject({
      amountMinor: 120_000,
      currency: 'KES',
      periodYears: 1,
      hostname: 'example.co.ke',
    })
    expect(harness.provider.purchases.size).toBe(1)
    expect(harness.stepUpPurposes).toHaveLength(1)
    expect(harness.onboarding.handoffs).toHaveLength(1)
    expect((harness.repository as MemoryRegistrarWorkflowRepository).purchases.size).toBe(1)
  })

  it('renews only the exact hostname, prior expiry, quote terms, period, currency, and minor units', async () => {
    const harness = createRegistrarHarness()
    const purchaseQuote = await quoted(harness)
    const purchase = await harness.workflow.purchase(registrarScope, purchaseCommand(purchaseQuote))
    const registration = await harness.repository.registration(registrarScope, purchase.registrationId)
    expect(registration).not.toBeNull()

    const renewalQuote = await quoted(harness)
    const receipt = await harness.workflow.renew(
      registrarScope,
      renewalCommand(renewalQuote, registration!),
    )
    const duplicate = await harness.workflow.renew(
      registrarScope,
      renewalCommand(renewalQuote, registration!),
    )

    expect(receipt).toMatchObject({
      registrationId: purchase.registrationId,
      quoteId: renewalQuote.quoteId,
      previousExpiresAt: registration!.expiresAt,
      amountMinor: 130_000,
      currency: 'KES',
      periodYears: 1,
    })
    expect(Date.parse(receipt.expiresAt)).toBeGreaterThan(Date.parse(receipt.previousExpiresAt))
    expect(duplicate).toEqual(receipt)
    expect(harness.provider.renewals.size).toBe(1)
    expect((harness.repository as MemoryRegistrarWorkflowRepository).renewals.size).toBe(1)
  })
})

import { describe, expect, it } from 'bun:test'
import { MemoryRegistrarWorkflowRepository } from '../../../server/fuma/registrar/memory'
import {
  createRegistrarHarness,
  purchaseCommand,
  quoted,
  registrarScope,
  renewalCommand,
} from './registrarLifecycleTestFixture'

describe('FUMA-061 registrar lifecycle fault acceptance', () => {
  it('fails closed on an expired quote before step-up or provider purchase', async () => {
    const harness = createRegistrarHarness()
    const quote = await quoted(harness)
    harness.clock.advance(15 * 60_000 + 1)

    await expect(harness.workflow.purchase(registrarScope, purchaseCommand(quote))).rejects.toMatchObject({
      code: 'stale-quote',
    })
    expect(harness.stepUpPurposes).toHaveLength(0)
    expect(harness.provider.purchases.size).toBe(0)
  })

  it('marks timeout-before-commit ambiguous and performs exact lookup without inventing success', async () => {
    const harness = createRegistrarHarness()
    harness.provider.purchaseFault = 'before-commit'
    const quote = await quoted(harness)

    await expect(harness.workflow.purchase(registrarScope, purchaseCommand(quote))).rejects.toMatchObject({
      code: 'ambiguous',
    })
    expect(harness.provider.purchases.size).toBe(0)
    expect(harness.provider.calls.some((call) => call.startsWith('lookup-purchase:'))).toBe(true)
    const operations = [...(harness.repository as MemoryRegistrarWorkflowRepository).operations.values()]
    expect(operations).toHaveLength(1)
    expect(operations[0]).toMatchObject({ state: 'ambiguous', attempts: 1 })
  })

  it('reconciles timeout-after-commit by exact idempotency lookup into one receipt', async () => {
    const harness = createRegistrarHarness()
    harness.provider.purchaseFault = 'after-commit'
    const quote = await quoted(harness)

    const receipt = await harness.workflow.purchase(registrarScope, purchaseCommand(quote))

    expect(receipt.providerReference).toStartWith('provider-registration:')
    expect(harness.provider.purchases.size).toBe(1)
    expect((harness.repository as MemoryRegistrarWorkflowRepository).purchases.size).toBe(1)
    expect(harness.provider.calls.filter((call) => call.startsWith('lookup-purchase:'))).toHaveLength(1)
  })

  it('rejects provider results with unknown properties instead of persisting a receipt', async () => {
    const harness = createRegistrarHarness()
    const quote = await quoted(harness)
    harness.provider.purchase = async () => ({
      providerReference: 'provider-registration:invalid',
      registeredAt: harness.clock.now().toISOString(),
      expiresAt: new Date(harness.clock.now().getTime() + 365 * 86_400_000).toISOString(),
      unexpected: true,
    })

    await expect(harness.workflow.purchase(registrarScope, purchaseCommand(quote))).rejects.toMatchObject({
      code: 'ambiguous',
    })
    expect((harness.repository as MemoryRegistrarWorkflowRepository).purchases.size).toBe(0)
  })

  it('persists receipt and pending DNS handoff before a failed onboarding, then resumes exactly once', async () => {
    const harness = createRegistrarHarness()
    harness.onboarding.fail = true
    const quote = await quoted(harness)
    const command = purchaseCommand(quote)

    await expect(harness.workflow.purchase(registrarScope, command)).rejects.toThrow('DNS onboarding interruption')
    const repository = harness.repository as MemoryRegistrarWorkflowRepository
    expect(repository.purchases.size).toBe(1)
    expect([...repository.handoffs.values()][0]?.state).toBe('pending')

    harness.onboarding.fail = false
    const receipt = await harness.workflow.purchase(registrarScope, command)
    expect(receipt.amountMinor).toBe(120_000)
    expect(harness.provider.purchases.size).toBe(1)
    expect(harness.onboarding.handoffs).toHaveLength(1)
    expect([...repository.handoffs.values()][0]?.state).toBe('completed')
  })

  it('reconciles a renewal timeout-after-commit and preserves exact prior-expiry receipt evidence', async () => {
    const harness = createRegistrarHarness()
    const purchaseQuote = await quoted(harness)
    const purchase = await harness.workflow.purchase(registrarScope, purchaseCommand(purchaseQuote))
    const registration = await harness.repository.registration(registrarScope, purchase.registrationId)
    const renewalQuote = await quoted(harness)
    harness.provider.renewalFault = 'after-commit'

    const receipt = await harness.workflow.renew(
      registrarScope,
      renewalCommand(renewalQuote, registration!),
    )

    expect(receipt.previousExpiresAt).toBe(registration!.expiresAt)
    expect(harness.provider.renewals.size).toBe(1)
    expect(harness.provider.calls.filter((call) => call.startsWith('lookup-renewal:'))).toHaveLength(1)
  })
})

import { describe, expect, it } from 'bun:test'
import { MemoryRegistrarWorkflowRepository } from '../../../server/fuma/registrar/memory'
import {
  createRegistrarHarness,
  purchaseCommand,
  quoted,
  registrarScope,
  renewalCommand,
} from './registrarLifecycleTestFixture'

describe('FUMA-061 registrar lifecycle concurrency acceptance', () => {
  it('returns one receipt for concurrent re-delivery of a completed exact confirmation', async () => {
    const harness = createRegistrarHarness()
    const quote = await quoted(harness)
    const command = purchaseCommand(quote)
    const first = await harness.workflow.purchase(registrarScope, command)

    const replayed = await Promise.all(Array.from(
      { length: 16 },
      async () => await harness.workflow.purchase(registrarScope, command),
    ))

    expect(new Set(replayed.map((receipt) => receipt.receiptId))).toEqual(new Set([first.receiptId]))
    expect(harness.provider.purchases.size).toBe(1)
    expect((harness.repository as MemoryRegistrarWorkflowRepository).purchases.size).toBe(1)
    expect(harness.onboarding.handoffs).toHaveLength(1)
  })

  it('serializes competing request IDs for the same purchase idempotency identity', async () => {
    const harness = createRegistrarHarness()
    const quote = await quoted(harness)

    const results = await Promise.allSettled([
      harness.workflow.purchase(registrarScope, purchaseCommand(quote, 'competing-purchase-a')),
      harness.workflow.purchase(registrarScope, purchaseCommand(quote, 'competing-purchase-b')),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({
      code: 'conflict',
    })
    expect(harness.provider.purchases.size).toBe(1)
    expect((harness.repository as MemoryRegistrarWorkflowRepository).purchases.size).toBe(1)
  })

  it('serializes competing renewals for one registration prior expiry into one receipt', async () => {
    const harness = createRegistrarHarness()
    const purchaseQuote = await quoted(harness)
    const purchase = await harness.workflow.purchase(registrarScope, purchaseCommand(purchaseQuote))
    const registration = await harness.repository.registration(registrarScope, purchase.registrationId)
    const renewalQuote = await quoted(harness)

    const results = await Promise.allSettled([
      harness.workflow.renew(registrarScope, renewalCommand(renewalQuote, registration!, 'competing-renewal-a')),
      harness.workflow.renew(registrarScope, renewalCommand(renewalQuote, registration!, 'competing-renewal-b')),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(harness.provider.renewals.size).toBe(1)
    expect((harness.repository as MemoryRegistrarWorkflowRepository).renewals.size).toBe(1)
  })
})

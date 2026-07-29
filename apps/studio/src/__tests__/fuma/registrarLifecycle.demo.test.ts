import { describe, expect, it } from 'bun:test'
import {
  createRegistrarHarness,
  purchaseCommand,
  quoted,
  registrarScope,
  renewalCommand,
} from './registrarLifecycleTestFixture'

describe('FUMA-061 deterministic registrar lifecycle demo', () => {
  it('prints exact quote, receipt, renewal, and managed-DNS handoff evidence', async () => {
    const harness = createRegistrarHarness()
    const quote = await quoted(harness)
    const purchase = await harness.workflow.purchase(registrarScope, purchaseCommand(quote))
    const registration = await harness.repository.registration(registrarScope, purchase.registrationId)
    const renewalQuote = await quoted(harness)
    const renewal = await harness.workflow.renew(
      registrarScope,
      renewalCommand(renewalQuote, registration!),
    )

    expect(harness.onboarding.handoffs[0]).toMatchObject({
      registrationId: purchase.registrationId,
      hostname: quote.hostname,
      credentialId: 'credential-registrar',
    })
    process.stdout.write(
      `[FUMA-061 demo] quote=${quote.quoteId} currency=${quote.currency} minor=${quote.registrationAmountMinor}`
      + ` purchaseReceipt=${purchase.receiptId} renewalReceipt=${renewal.receiptId}`
      + ` dnsHandoff=${harness.onboarding.handoffs[0]!.domainId}\n`,
    )
  })
})

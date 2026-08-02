import { describe, expect, it } from 'bun:test'
import { customerCredentialAuthority } from '../../../server/fuma/domains/contracts'
import { RegistrarWorkflow, RegistrarWorkflowError } from '../../../server/fuma/registrar/workflow'
import {
  createRegistrarHarness,
  purchaseCommand,
  quoted,
  registrarScope,
} from './registrarLifecycleTestFixture'

describe('FUMA-061 registrar lifecycle security acceptance', () => {
  it('denies missing entitlement before step-up or provider purchase', async () => {
    const harness = createRegistrarHarness({ entitled: false })
    const quote = await quoted(harness)

    await expect(harness.workflow.purchase(registrarScope, purchaseCommand(quote))).rejects.toMatchObject({
      code: 'entitlement',
    })
    expect(harness.stepUpPurposes).toHaveLength(0)
    expect(harness.provider.purchases.size).toBe(0)
  })

  it('rejects changed minor units, hostname, terms, and confirmation as changed quote evidence', async () => {
    const changes = [
      { expectedAmountMinor: 120_001 },
      { expectedHostname: 'other.co.ke' },
      { expectedTermsHash: '0'.repeat(64) },
      { confirmation: 'PURCHASE other.co.ke' },
    ] as const

    for (const [index, change] of changes.entries()) {
      const harness = createRegistrarHarness()
      const quote = await quoted(harness)
      await expect(harness.workflow.purchase(registrarScope, {
        ...purchaseCommand(quote, `changed-request-${index}`),
        ...change,
      })).rejects.toMatchObject({ code: 'changed-quote' })
      expect(harness.provider.purchases.size).toBe(0)
      expect(harness.stepUpPurposes).toHaveLength(0)
    }
  })

  it('accepts only KES and rejects unknown confirmation properties at the TypeBox boundary', async () => {
    const harness = createRegistrarHarness()
    const quote = await quoted(harness)

    await expect(harness.workflow.purchase(registrarScope, {
      ...purchaseCommand(quote),
      currency: 'USD',
    })).rejects.toBeInstanceOf(TypeError)
    await expect(harness.workflow.purchase(registrarScope, {
      ...purchaseCommand(quote),
      callerOrganizationId: registrarScope.organizationId,
    })).rejects.toBeInstanceOf(TypeError)
    expect(harness.provider.purchases.size).toBe(0)
  })

  it('does not expose quotes across exact owner scope and rejects customer credential authority', async () => {
    const harness = createRegistrarHarness()
    const quote = await quoted(harness)
    const foreignScope = Object.freeze({ ...registrarScope, organizationId: 'organization-b' })

    await expect(harness.workflow.purchase(foreignScope, purchaseCommand(quote))).rejects.toMatchObject({
      code: 'stale-quote',
    })
    expect(() => new RegistrarWorkflow({
      provider: harness.provider,
      repository: harness.repository,
      stepUp: { async consume() { return true } },
      entitled: async () => true,
      onboarding: harness.onboarding,
      authority: customerCredentialAuthority(registrarScope),
      credentialId: 'credential-registrar',
    })).toThrow(RegistrarWorkflowError)
  })

  it('rejects changed renewal hostname, prior expiry, minor units, period, terms, and confirmation', async () => {
    const harness = createRegistrarHarness()
    const purchaseQuote = await quoted(harness)
    const purchase = await harness.workflow.purchase(registrarScope, purchaseCommand(purchaseQuote))
    const registration = await harness.repository.registration(registrarScope, purchase.registrationId)
    const renewalQuote = await quoted(harness)
    const base = {
      requestId: 'changed-renewal-base',
      registrationId: registration!.registrationId,
      quoteId: renewalQuote.quoteId,
      expectedHostname: registration!.hostname,
      expectedPreviousExpiresAt: registration!.expiresAt,
      expectedAmountMinor: renewalQuote.renewalAmountMinor,
      currency: renewalQuote.currency,
      periodYears: renewalQuote.periodYears,
      expectedTermsHash: renewalQuote.termsHash,
      confirmation: `RENEW ${registration!.hostname}`,
      stepUpProof: 'fresh-step-up',
    } as const
    const changes = [
      { expectedHostname: 'other.co.ke' },
      { expectedPreviousExpiresAt: '2028-01-01T00:00:00.000Z' },
      { expectedAmountMinor: renewalQuote.renewalAmountMinor + 1 },
      { periodYears: 2 },
      { expectedTermsHash: '0'.repeat(64) },
      { confirmation: 'RENEW other.co.ke' },
    ] as const

    for (const [index, change] of changes.entries()) {
      await expect(harness.workflow.renew(registrarScope, {
        ...base,
        requestId: `changed-renewal-${index}`,
        ...change,
      })).rejects.toMatchObject({ code: 'changed-quote' })
    }
    expect(harness.provider.renewals.size).toBe(0)
  })
})

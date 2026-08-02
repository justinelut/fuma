import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { planLawyerImport } from '../../../../server/fuma/lawyerImport'
import { createFUMA076LawyerSnapshot } from './lawyerFixture'

const digest = async (value: string | Uint8Array): Promise<string> => createHash('sha256').update(value).digest('hex')

describe('FUMA-076 Paystack evidence reconciliation', () => {
  it('classifies every legacy label/note and never emits an access grant', async () => {
    const plan = await planLawyerImport(createFUMA076LawyerSnapshot(), { importId: 'payment-report', dryRun: true, digest })
    expect(plan.report.payments.map(({ claimId, classification, accessDecision }) => ({ claimId, classification, accessDecision }))).toEqual([
      { claimId: 'claim-a', classification: 'verified-for-fuma-reconciliation', accessDecision: 'eligible-for-fuma-payment-reconciliation' },
      { claimId: 'claim-b', classification: 'exception-missing-provider-evidence', accessDecision: 'do-not-grant' },
      { claimId: 'claim-c', classification: 'exception-label-mismatch', accessDecision: 'do-not-grant' },
      { claimId: 'claim-d', classification: 'no-paid-claim', accessDecision: 'do-not-grant' },
    ])
    expect(plan.report.orphanPaymentEvidence).toEqual([expect.objectContaining({
      evidenceId: 'orphan-d',
      classification: 'exception-orphan-provider-evidence',
      accessDecision: 'do-not-grant',
    })])
    expect(JSON.stringify(plan.report)).not.toContain('lawyer_ref_verified_0001')
    expect(JSON.stringify(plan.report)).not.toContain('provider-tx-a')
    expect('accessGrant' in plan.report).toBe(false)
  })

  it('fails duplicate provider identities and mismatched note references closed', async () => {
    const duplicate = createFUMA076LawyerSnapshot() as Record<string, unknown>
    const evidence = duplicate.verifiedPaymentEvidence as Record<string, unknown>[]
    evidence.push({ ...structuredClone(evidence[0]!), evidenceId: 'duplicate-a', memberSourceId: 'member-b' })
    const duplicatePlan = await planLawyerImport(duplicate, { importId: 'duplicate-provider', dryRun: true, digest })
    expect(duplicatePlan.report.payments.find(({ claimId }) => claimId === 'claim-a')?.classification).toBe('exception-duplicate-provider-identity')
    expect(duplicatePlan.report.payments.find(({ claimId }) => claimId === 'claim-b')?.classification).toBe('exception-duplicate-provider-identity')

    const wrongReference = createFUMA076LawyerSnapshot() as Record<string, unknown>
    const claims = wrongReference.paymentClaims as Record<string, unknown>[]
    claims[0] = { ...claims[0], note: 'Paystack KES monthly — ref another_reference_000001' }
    const referencePlan = await planLawyerImport(wrongReference, { importId: 'wrong-reference', dryRun: true, digest })
    expect(referencePlan.report.payments[0]?.classification).toBe('exception-reference-mismatch')
  })
})

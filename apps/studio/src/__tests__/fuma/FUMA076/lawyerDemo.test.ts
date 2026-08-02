import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { planLawyerImport } from '../../../../server/fuma/lawyerImport'
import { createFUMA076LawyerSnapshot } from './lawyerFixture'

const digest = async (value: string | Uint8Array): Promise<string> => createHash('sha256').update(value).digest('hex')

describe('FUMA-076 sanitized read-only demo', () => {
  it('prints deterministic inventory and exception evidence without PII or provider identifiers', async () => {
    const plan = await planLawyerImport(createFUMA076LawyerSnapshot(), {
      importId: 'fuma-076-read-only-demo',
      dryRun: true,
      digest,
    })
    const access = Object.fromEntries(['public', 'member', 'staff', 'service'].map((kind) => [
      kind,
      plan.report.routes.filter((route) => route.access === kind).length,
    ]))
    const paymentClassifications = Object.fromEntries(plan.report.payments.map((payment) => [
      payment.classification,
      plan.report.payments.filter((candidate) => candidate.classification === payment.classification).length,
    ]))
    const evidence = Object.freeze({
      mode: plan.genericPlan.manifest.dryRun ? 'read-only-proposal' : 'mutation',
      routes: plan.report.counts.routes,
      access,
      content: plan.report.counts.posts + plan.report.counts.pages,
      relations: plan.report.counts.relations,
      members: plan.report.counts.members,
      paymentClassifications,
      paymentExceptions: plan.report.payments.filter(({ accessDecision }) => accessDecision === 'do-not-grant').length
        + plan.report.orphanPaymentEvidence.length,
      quarantine: plan.report.quarantine.length,
      reauthentication: {
        staff: plan.report.reauthentication.staffSourceIds.length,
        members: plan.report.reauthentication.memberSourceIds.length,
      },
      mail: plan.report.mailMigration.destinationProvider,
      resumableCursor: plan.genericPlan.manifest.resumableCursor,
      reportSha256: plan.report.hashes.reportSha256,
    })

    expect(evidence).toMatchObject({
      mode: 'read-only-proposal',
      routes: 69,
      access: { public: 44, member: 6, staff: 3, service: 16 },
      content: 63,
      relations: 147,
      members: 4,
      paymentExceptions: 4,
      quarantine: 1,
      reauthentication: { staff: 4, members: 4 },
      mail: 'oci-email-delivery',
      resumableCursor: 'object:0',
    })
    expect(evidence.paymentClassifications).toEqual({
      'verified-for-fuma-reconciliation': 1,
      'exception-missing-provider-evidence': 1,
      'exception-label-mismatch': 1,
      'no-paid-claim': 1,
    })
    const serialized = JSON.stringify(evidence)
    expect(serialized).not.toContain('@')
    expect(serialized).not.toContain('lawyer_ref_')
    expect(serialized).not.toContain('provider-tx-')
    process.stdout.write(`[FUMA-076 demo] ${serialized}\n`)
  })
})

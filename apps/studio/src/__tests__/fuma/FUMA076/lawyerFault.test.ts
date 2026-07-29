import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { executeLawyerImport, planLawyerImport, rollbackLawyerImport } from '../../../../server/fuma/lawyerImport'
import { createFUMA076LawyerSnapshot, FUMA076_PROOF, FUMA076_SCOPE } from './lawyerFixture'
import { FUMA076MemoryImportPort } from './memoryPort'

const digest = async (value: string | Uint8Array): Promise<string> => createHash('sha256').update(value).digest('hex')
const now = () => new Date('2026-07-28T12:05:00Z')

describe('FUMA-076 generic importer fault, resume, and rollback integration', () => {
  it('requires fresh verified staff reauthentication and keeps dry-runs mutation-free', async () => {
    const plan = await planLawyerImport(createFUMA076LawyerSnapshot(), { importId: 'dry-run', dryRun: true, digest })
    const genericImport = new FUMA076MemoryImportPort()
    const verified = { verify: async () => true }
    await expect(executeLawyerImport(plan, FUMA076_SCOPE, FUMA076_PROOF, { genericImport, staffReauthentication: verified }, now)).rejects.toThrow('dry-run plan cannot mutate')
    expect(genericImport.objects.size).toBe(0)

    const staleProof = { ...FUMA076_PROOF, authenticatedAt: '2026-07-28T11:00:00Z', expiresAt: '2026-07-28T11:10:00Z' }
    await expect(executeLawyerImport(plan, FUMA076_SCOPE, staleProof, { genericImport, staffReauthentication: verified }, now)).rejects.toMatchObject({ code: 'reauthentication-required' })
    await expect(executeLawyerImport(plan, FUMA076_SCOPE, FUMA076_PROOF, { genericImport, staffReauthentication: { verify: async () => false } }, now)).rejects.toMatchObject({ code: 'reauthentication-required' })
    const wrongScope = { ...FUMA076_SCOPE, siteId: 'another-site' }
    await expect(executeLawyerImport(plan, wrongScope, FUMA076_PROOF, { genericImport, staffReauthentication: verified }, now)).rejects.toMatchObject({ code: 'scope-denied' })
  })

  it('resumes after a media fault, reuses an identical receipt, and rolls back idempotently', async () => {
    const plan = await planLawyerImport(createFUMA076LawyerSnapshot(), { importId: 'lawyer-execute', dryRun: false, digest })
    const samePlan = await planLawyerImport(createFUMA076LawyerSnapshot(), { importId: 'lawyer-execute', dryRun: false, digest })
    expect(samePlan.report.hashes.reportSha256).toBe(plan.report.hashes.reportSha256)
    expect(samePlan.genericPlan.manifestHashSha256).toBe(plan.genericPlan.manifestHashSha256)

    const genericImport = new FUMA076MemoryImportPort()
    genericImport.failMediaUrlOnce = 'https://media.example.test/lawyer-1.jpg'
    const ports = { genericImport, staffReauthentication: { verify: async () => true } }
    await expect(executeLawyerImport(plan, FUMA076_SCOPE, FUMA076_PROOF, ports, now)).rejects.toThrow('FUMA-076 injected media fault')
    expect(genericImport.objects.size).toBe(plan.genericPlan.objects.length)
    expect(genericImport.media.size).toBe(1)

    const receipt = await executeLawyerImport(plan, FUMA076_SCOPE, FUMA076_PROOF, ports, now)
    expect(receipt.state).toBe('applied')
    expect(genericImport.media.size).toBe(2)
    expect([...genericImport.objectApplyCount.values()].every((count) => count === 1)).toBe(true)
    expect([...genericImport.mediaApplyCount.values()].every((count) => count === 1)).toBe(true)
    expect(await executeLawyerImport(samePlan, FUMA076_SCOPE, FUMA076_PROOF, ports, now)).toBe(receipt)

    const rolledBack = await rollbackLawyerImport(plan, receipt, FUMA076_SCOPE, FUMA076_PROOF, ports, now)
    expect(rolledBack.state).toBe('rolled-back')
    expect(genericImport.objects.size).toBe(0)
    expect(genericImport.media.size).toBe(0)
    expect(await rollbackLawyerImport(plan, rolledBack, FUMA076_SCOPE, FUMA076_PROOF, ports, now)).toBe(rolledBack)
  })
})

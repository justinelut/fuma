import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { mutateLawyerPilotToken, planLawyerImport, projectLawyerCanonicalRoute, projectLawyerRuntimePilot } from '../../../../server/fuma/lawyerImport'
import { createFUMA076LawyerSnapshot } from '../FUMA076/lawyerFixture'

const digest = async (value: string | Uint8Array): Promise<string> => createHash('sha256').update(value).digest('hex')

describe('FUMA-SITE-006 deterministic sanitized demo', () => {
  test('imports, projects, mutates one shared token, and records non-mutating rollback', async () => {
    const plan = await planLawyerImport(createFUMA076LawyerSnapshot(), { importId: 'fuma-site-006-demo', dryRun: true, digest })
    const pilot = projectLawyerRuntimePilot(plan)
    const article = pilot.content.find(({ sourceId }) => sourceId === 'post-1')!
    const route = projectLawyerCanonicalRoute(pilot, { sourceRoute: '/article/[slug]', canonicalRoute: article.canonicalPath!, contentId: article.destinationId })
    const changed = mutateLawyerPilotToken(pilot)
    const evidence = {
      routeCount: pilot.parity.routeCount,
      contentCount: pilot.parity.contentCount,
      relationCount: pilot.parity.relationCount,
      access: { public: pilot.parity.publicContentCount, member: pilot.parity.memberContentCount, paid: pilot.parity.paidContentCount },
      componentCount: pilot.componentPack.components.length,
      templateCount: pilot.templates.length,
      sourceMode: pilot.componentPack.components[0]!.sourceMode,
      flattenedCopies: pilot.parity.flattenedCopies,
      payment: { verifiedEligible: pilot.reconciliation.verifiedEligible, deniedOrException: pilot.reconciliation.deniedOrException, directAccessGrants: pilot.reconciliation.directAccessGrants },
      mailProvider: pilot.reconciliation.mailProvider,
      canonicalRoute: route.canonicalRoute,
      exactComponents: route.exactComponentIds,
      beforeHash: pilot.manifestHashSha256,
      afterTokenHash: changed.manifestHashSha256,
      rollbackActions: pilot.rollback.length,
    }
    const serialized = JSON.stringify(evidence)
    expect(serialized).not.toMatch(/@example\.test|lawyer_ref_|provider-tx|password|session|paystack.*secret/i)
    expect(evidence).toMatchObject({ routeCount: 69, contentCount: 63, relationCount: 147, flattenedCopies: 0, sourceMode: 'owned-next-tailwind', mailProvider: 'oci-email-delivery', payment: { verifiedEligible: 1, directAccessGrants: 0 } })
    process.stdout.write(`[FUMA-SITE-006 demo] ${serialized}\n`)
  })
})

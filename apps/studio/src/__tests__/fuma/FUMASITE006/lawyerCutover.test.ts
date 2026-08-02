import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import {
  MemorySiteRuntimeMutationReceiptRepository,
  MemorySiteRuntimeRolloutRepository,
  SiteRuntimeApplicationAuthority,
  type SiteRuntimeExactBinding,
} from '../../../../server/fuma/siteRuntime'
import { planLawyerImport, projectLawyerRuntimePilot } from '../../../../server/fuma/lawyerImport'
import type { RuntimeRouteArtifact } from '../../../../server/fuma/publishing/runtimeTree/contracts'
import { createFUMA076LawyerSnapshot } from '../FUMA076/lawyerFixture'

const digest = async (value: string | Uint8Array): Promise<string> => createHash('sha256').update(value).digest('hex')
const legacyHtml = '<main><article><h1>Retained Lawyer article</h1></article></main>'
const semanticHash = createHash('sha256').update(legacyHtml).digest('hex')
const binding: SiteRuntimeExactBinding = Object.freeze({
  host: 'lawyer.trimly.co.ke', platformId: 'fuma-platform', organizationId: 'lawyer-org', workspaceId: 'lawyer-workspace', siteId: 'lawyer-site', ownerKey: 'lawyer-owner', ownerGeneration: 1, releaseId: 'lawyer-react-1', releaseHashSha256: 'a'.repeat(64),
})
function artifact(route: string, hash = semanticHash): RuntimeRouteArtifact {
  return { route: { route, semanticHtmlPath: '/article.html' }, artifactReferences: [{ role: 'semantic-html', logicalPath: '/article.html', contentHashSha256: hash }] } as RuntimeRouteArtifact
}

describe('FUMA-SITE-006 Lawyer cutover and rollback', () => {
  test('shadows, cuts over, falls back, and rolls back one exact concrete route without data mutation', async () => {
    const plan = await planLawyerImport(createFUMA076LawyerSnapshot(), { importId: 'fuma-site-006-cutover', dryRun: true, digest })
    const pilot = projectLawyerRuntimePilot(plan)
    const content = pilot.content.find(({ kind }) => kind === 'post')!
    const route = content.canonicalPath!
    expect(pilot.cutover.policies.some(({ sourceRoute }) => sourceRoute === '/article/[slug]')).toBe(true)

    const rollouts = new MemorySiteRuntimeRolloutRepository()
    const receipts = new MemorySiteRuntimeMutationReceiptRepository()
    const authority = new SiteRuntimeApplicationAuthority({
      rollouts,
      receipts,
      legacy: { async read(_binding, releaseId, requestedRoute) { return { releaseId, route: requestedRoute, html: legacyHtml, contentHashSha256: semanticHash, scripts: [], csp: "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'" } } },
    })
    await authority.setPolicy(binding, { route, target: 'react', shadow: 'compare', fallback: 'legacy', legacyReleaseId: 'lawyer-legacy-1', version: 1 }, null)
    expect(await authority.delivery(binding, artifact(route))).toMatchObject({ selected: 'react', reason: 'shadow-match', shadowParity: 'matched' })
    expect(await authority.delivery(binding, artifact(route, 'b'.repeat(64)))).toMatchObject({ selected: 'legacy', reason: 'shadow-mismatch-fallback', shadowParity: 'mismatched' })
    await authority.setPolicy(binding, { route, target: 'legacy', shadow: 'off', fallback: 'legacy', legacyReleaseId: 'lawyer-legacy-1', version: 2 }, 1)
    expect(await authority.delivery(binding, artifact(route))).toMatchObject({ selected: 'legacy', reason: 'policy' })
    expect(receipts.values.size).toBe(0)
    expect(plan.genericPlan.manifest.dryRun).toBe(true)
    expect(pilot.rollback.every(({ mutatesContent, mutatesMemberState, mutatesPaymentState }) => !mutatesContent && !mutatesMemberState && !mutatesPaymentState)).toBe(true)
  })
})

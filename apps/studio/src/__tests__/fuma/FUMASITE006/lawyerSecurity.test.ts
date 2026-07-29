import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import {
  LawyerRuntimePilotError,
  LawyerRuntimePilotManifestSchema,
  parseLawyerRuntimePilot,
  planLawyerImport,
  projectLawyerCanonicalRoute,
  projectLawyerRuntimePilot,
  validateLawyerRuntimePilotManifest,
} from '../../../../server/fuma/lawyerImport'
import { createFUMA076LawyerSnapshot } from '../FUMA076/lawyerFixture'

const digest = async (value: string | Uint8Array): Promise<string> => createHash('sha256').update(value).digest('hex')

async function fixture() {
  const plan = await planLawyerImport(createFUMA076LawyerSnapshot(), { importId: 'fuma-site-006-security', dryRun: true, digest })
  return { plan, pilot: projectLawyerRuntimePilot(plan) }
}

describe('FUMA-SITE-006 hostile and authority boundaries', () => {
  test('rejects unknown fields and modified deterministic bytes', async () => {
    const { pilot } = await fixture()
    expect(() => parseLawyerRuntimePilot(LawyerRuntimePilotManifestSchema, { ...pilot, zod: true }, 'hostile pilot')).toThrow(LawyerRuntimePilotError)
    expect(() => validateLawyerRuntimePilotManifest({ ...pilot, tokens: pilot.tokens.map((token, index) => index === 0 ? { ...token, value: '#000000' } : token) })).toThrow('hash changed')
  })

  test('rejects incomplete FUMA-076 counts before generating a pilot', async () => {
    const { plan } = await fixture()
    const incomplete = { ...plan, report: { ...plan.report, counts: { ...plan.report.counts, routes: 68 } } }
    expect(() => projectLawyerRuntimePilot(incomplete)).toThrow('complete accepted FUMA-076 Lawyer inventory')
  })

  test('rejects disconnected templates, broken links, and direct provider/access authority', async () => {
    const { pilot } = await fixture()
    const disconnected = { ...pilot, content: pilot.content.map((item, index) => index === 0 ? { ...item, templateId: 'copied-one-off-template' } : item) }
    expect(() => validateLawyerRuntimePilotManifest({ ...disconnected, manifestHashSha256: pilot.manifestHashSha256 })).toThrow()
    const broken = { ...pilot, routes: pilot.routes.map((route, index) => index === 0 ? { ...route, internalLinks: ['/not-in-estate'] } : route) }
    expect(() => validateLawyerRuntimePilotManifest({ ...broken, manifestHashSha256: pilot.manifestHashSha256 })).toThrow()
    const provider = { ...pilot, adapters: pilot.adapters.map((adapter, index) => index === 0 ? { ...adapter, directProviderAccess: true } : adapter) }
    expect(() => validateLawyerRuntimePilotManifest({ ...provider, manifestHashSha256: pilot.manifestHashSha256 })).toThrow()
  })

  test('requires imported Fuma data for content routes and rejects noncanonical concrete paths', async () => {
    const { pilot } = await fixture()
    expect(() => projectLawyerCanonicalRoute(pilot, { sourceRoute: '/article/[slug]', canonicalRoute: '/article/example' })).toThrow('require an imported Fuma data binding')
    const content = pilot.content.find(({ kind }) => kind === 'post')!
    expect(() => projectLawyerCanonicalRoute(pilot, { sourceRoute: '/article/[slug]', canonicalRoute: '/article/../foreign', contentId: content.destinationId })).toThrow('not canonical')
    expect(() => projectLawyerCanonicalRoute(pilot, { sourceRoute: '/api/paystack/webhook', canonicalRoute: '/api/paystack/webhook' })).toThrow('not a React cutover route')
  })
})

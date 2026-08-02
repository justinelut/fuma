import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import {
  mutateLawyerPilotToken,
  planLawyerImport,
  projectLawyerCanonicalRoute,
  projectLawyerRuntimePilot,
  validateLawyerRuntimePilotManifest,
} from '../../../../server/fuma/lawyerImport'
import { createFUMA076LawyerSnapshot, FUMA076_ROUTES } from '../FUMA076/lawyerFixture'

const digest = async (value: string | Uint8Array): Promise<string> => createHash('sha256').update(value).digest('hex')

async function fixture() {
  const plan = await planLawyerImport(createFUMA076LawyerSnapshot(), { importId: 'fuma-site-006', dryRun: true, digest })
  return { plan, pilot: projectLawyerRuntimePilot(plan) }
}

describe('FUMA-SITE-006 complete Lawyer source-component pilot', () => {
  test('accounts for the exact 69-route and 63-content FUMA-076 estate without flattened or disconnected copies', async () => {
    const { pilot } = await fixture()
    expect(validateLawyerRuntimePilotManifest(pilot)).toEqual(pilot)
    expect(pilot.routes.map(({ sourceRoute }) => sourceRoute)).toEqual([...FUMA076_ROUTES].map(({ route }) => route).sort())
    expect(pilot.routes.reduce<Record<string, number>>((counts, route) => ({ ...counts, [route.sourceKind]: (counts[route.sourceKind] ?? 0) + 1 }), {})).toEqual({ api: 18, system: 5, page: 40, feed: 6 })
    expect(pilot.content).toHaveLength(63)
    expect(pilot.content.filter(({ kind }) => kind === 'post')).toHaveLength(42)
    expect(pilot.content.filter(({ kind }) => kind === 'page')).toHaveLength(21)
    expect(pilot.content.reduce<Record<string, number>>((counts, item) => ({ ...counts, [item.accessBinding]: (counts[item.accessBinding] ?? 0) + 1 }), {})).toEqual({ public: 45, paid: 9, member: 9 })
    expect(pilot.content.every(({ connected, dataBinding }) => connected && dataBinding.startsWith('fuma.publication.content:'))).toBe(true)
    expect(pilot.parity).toMatchObject({ flattenedCopies: 0, disconnectedCopies: 0, relationCount: 147, authorCount: 4, memberCount: 4 })
  })

  test('uses owned exact-version source components, current runtime dependencies, and existing domain authorities only', async () => {
    const { pilot } = await fixture()
    expect(pilot.componentPack).toMatchObject({ namespace: 'fuma.official', exactVersion: '1.0.0', sourceOwned: true, registry: 'existing-site-runtime-registry' })
    expect(pilot.componentPack.components).toHaveLength(6)
    expect(new Set(pilot.componentPack.components.map(({ sourcePath }) => sourcePath))).toEqual(new Set(['apps/site-runtime/components/lawyer-components.tsx']))
    expect(pilot.componentPack.components.every(({ sourceMode, staticTailwind, flattenedHtml }) => sourceMode === 'owned-next-tailwind' && staticTailwind && !flattenedHtml)).toBe(true)
    expect(Object.fromEntries(pilot.dependencies.map((item) => [item.package, item.exactVersion]))).toEqual({
      '@sinclair/typebox': '0.34.49', next: '16.2.9', react: '19.2.5', 'react-dom': '19.2.5', tailwindcss: '4.3.3', shadcn: '4.14.1',
    })
    expect(pilot.dependencies.every(({ license, runtimeOwned }) => license === 'MIT' && runtimeOwned)).toBe(true)
    expect(pilot.adapters.map(({ adapterId }) => adapterId)).toEqual(['fuma.publication.content', 'fuma.publication.member-access', 'fuma.customer-payments', 'fuma.oci-email-delivery'])
    expect(pilot.adapters.every(({ directProviderAccess }) => !directProviderAccess)).toBe(true)
  })

  test('preserves page/link/canonical/template/loop/token/asset bindings and emits canonical runtime trees', async () => {
    const { pilot } = await fixture()
    const routeSet = new Set(pilot.routes.map(({ sourceRoute }) => sourceRoute))
    expect(pilot.routes.flatMap(({ internalLinks }) => internalLinks).every((link) => routeSet.has(link))).toBe(true)
    expect(new Set(pilot.templates.flatMap(({ loopIds }) => loopIds))).toEqual(new Set(['cover-story', 'featured', 'latest', 'section-content', 'related-content', 'podcast-episodes', 'related-podcasts', 'membership-plans', 'member-subscriptions', 'newsletter-archive']))
    expect(pilot.assets).toHaveLength(2)
    expect(pilot.assets.every(({ connectedContentIds }) => connectedContentIds.length === 42)).toBe(true)
    const content = pilot.content.find(({ sourceId }) => sourceId === 'post-1')!
    const route = projectLawyerCanonicalRoute(pilot, { sourceRoute: '/article/[slug]', canonicalRoute: content.canonicalPath!, contentId: content.destinationId })
    expect(route).toMatchObject({ templateId: 'lawyer-article', canonicalRoute: '/article/the-constitutional-pivot' })
    expect(route.exactComponentIds).toEqual(['base.container', 'base.loop', 'base.outlet', 'lawyer.access-gate', 'lawyer.editorial-header', 'lawyer.site-shell', 'lawyer.story-card'])
    expect(JSON.stringify(route)).not.toMatch(/jsx|tsx|componentSource|tailwindUtilities|<html/i)
    expect(route.publicDataKeys).toContain('lawyer.route.body')
  })

  test('updates one shared token across every mapped route without copying content or templates', async () => {
    const { pilot } = await fixture()
    const changed = mutateLawyerPilotToken(pilot)
    expect(changed.manifestHashSha256).not.toBe(pilot.manifestHashSha256)
    expect(changed.tokens.find(({ name }) => name === '--lawyer-accent')?.value).toBe('#1f5e46')
    expect(changed.routes).toEqual(pilot.routes)
    expect(changed.content).toEqual(pilot.content)
    expect(changed.templates).toEqual(pilot.templates)
    expect(changed.componentPack).toEqual(pilot.componentPack)
    expect(changed.parity).toEqual(pilot.parity)
  })
})

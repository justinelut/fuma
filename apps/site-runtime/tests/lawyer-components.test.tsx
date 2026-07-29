import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentRegistryEntry, RuntimeNode, RuntimeRouteArtifact, SiteApplicationAccess } from '../lib/contracts'
import { ApplicationStateProvider } from '../components/application-state'
import { RuntimeDocument } from '../components/runtime-document'
import { RuntimeTree } from '../components/runtime-tree'

const hash = (value: string) => value.repeat(64).slice(0, 64)
const versions: Readonly<Record<string, string>> = { 'base.container': '2.0.0', 'base.outlet': '1.0.0', 'base.loop': '1.0.0' }
const ref = (componentId: string) => ({ namespace: 'fuma.official', componentId, exactVersion: versions[componentId] ?? '1.0.0' })
function node(nodeId: string, componentId: string, input: Partial<RuntimeNode> = {}): RuntimeNode {
  return { nodeId, component: ref(componentId), props: input.props ?? {}, classes: input.classes ?? [], styles: input.styles ?? [], requiredCapabilities: input.requiredCapabilities ?? [], bindings: input.bindings ?? [], slots: input.slots ?? [] }
}
function official(componentId: string): ComponentRegistryEntry {
  return {
    reference: ref(componentId), source: { kind: 'official', publisher: 'fuma', ownerKey: null, siteId: null, origin: 'runtime-source' }, execution: 'official-server',
    trust: { tier: 'official', reviewState: 'compiled-into-runtime', ownerConfirmed: true, validation: { typecheck: true, build: true, staticUtilities: true, accessibility: true, security: true, csp: true, bundleBudget: true } },
    propsSchemaHashSha256: hash('a'), slotsSchemaHashSha256: hash('b'), sourceHashSha256: hash('c'), capabilities: [], artifactPaths: [], parameters: [], definition: null, dynamicTenantServerImport: false, persistedExecutableJsx: false,
  }
}
function route(root: RuntimeNode): RuntimeRouteArtifact {
  const ids = new Set<string>()
  const walk = (value: RuntimeNode) => { ids.add(value.component.componentId); value.slots.forEach((slot) => slot.children.forEach(walk)) }
  walk(root)
  return {
    schemaVersion: 1, contractVersion: '1.0.0', platformId: 'fuma-platform', organizationId: 'lawyer-org', workspaceId: 'lawyer-workspace', siteId: 'lawyer-site', ownerKey: 'lawyer-owner', ownerGeneration: 1,
    releaseId: 'lawyer-release', sourceSnapshotId: 'lawyer-snapshot', sourceSnapshotHashSha256: hash('d'), componentRegistryVersion: '1.0.0',
    route: { route: '/article/fixture', pageId: 'lawyer-page', artifactPath: '/runtime/routes/lawyer.json', semanticHtmlPath: '/article.html', layoutIds: [], styleArtifactPaths: [], publicDataKeys: [] },
    page: { pageId: 'lawyer-page', title: 'Fixture analysis', root }, layouts: [], components: [...ids].map(official),
    styles: { tokens: [
      { name: '--lawyer-paper', value: '#f7f3e8' }, { name: '--lawyer-panel', value: '#eee7d6' }, { name: '--lawyer-ink', value: '#171713' },
      { name: '--lawyer-muted', value: '#5c5b52' }, { name: '--lawyer-rule', value: '#cbc3ae' }, { name: '--lawyer-accent', value: '#9b2c20' },
    ], breakpoints: [{ id: 'mobile', minWidthPx: 0 }, { id: 'desktop', minWidthPx: 1024 }], rules: [], cssArtifactPaths: [] },
    stylesheets: [], publicData: [], artifactReferences: [{ logicalPath: '/article.html', role: 'semantic-html', mimeType: 'text/html', contentHashSha256: hash('e'), integritySha256: `sha256-${'A'.repeat(43)}=`, sizeBytes: 1, references: [], component: null, declaredCapabilities: [] }], routeHashSha256: hash('f'),
  }
}
const publicAccess: SiteApplicationAccess = { member: false, paid: false, memberSource: 'none', segmentIds: [] }
const memberAccess: SiteApplicationAccess = { member: true, paid: false, memberSource: 'registered', segmentIds: [] }
const paidAccess: SiteApplicationAccess = { member: true, paid: true, memberSource: 'paid', segmentIds: [] }
function render(root: RuntimeNode, access: SiteApplicationAccess = publicAccess) {
  return renderToStaticMarkup(<RuntimeTree route={route(root)} host="lawyer.fuma.co.ke" ownerKey="lawyer-owner" siteId="lawyer-site" applicationAccess={access} />)
}

describe('FUMA-SITE-006 owned Lawyer runtime components', () => {
  test('renders semantic source shell, internal links, canonical editorial metadata, and responsive landmarks', () => {
    const header = node('header', 'lawyer.editorial-header', { props: { title: 'Constitutional pivot', excerpt: 'Fixture deck', byline: 'Fixture Author', canonicalPath: '/article/fixture' } })
    const shell = node('shell', 'lawyer.site-shell', { props: { navigation: [{ label: 'Archive', href: '/archive' }, { label: 'Membership', href: '/membership' }] }, slots: [{ name: 'children', children: [header] }] })
    const html = render(shell)
    expect(html).toContain('Skip to content')
    expect(html).toContain('<nav aria-label="Primary navigation"')
    expect(html).toContain('<main id="lawyer-main"')
    expect(html).toContain('<h1')
    expect(html).toContain('href="/archive"')
    expect(html).toContain('data-fuma-canonical="/article/fixture"')
    expect(html).toContain('sm:text-6xl')
    expect(html).toContain('lg:grid-cols-2')
    expect(html).not.toContain('data-fuma-editor')
  })

  test('enforces public/member/paid states from authority projection and never trusts labels', () => {
    const body = node('body', 'base.container', { props: { tag: 'article' }, slots: [{ name: 'children', children: [node('text', 'lawyer.editorial-header', { props: { title: 'Protected analysis', canonicalPath: '/article/fixture' } })] }] })
    const paidGate = node('gate', 'lawyer.access-gate', { props: { requirement: 'paid', legacyLabel: 'paystack-active' }, slots: [{ name: 'children', children: [body] }] })
    expect(render(paidGate, publicAccess)).toContain('A verified subscription is required')
    expect(render(paidGate, memberAccess)).toContain('A verified subscription is required')
    expect(render(paidGate, memberAccess)).not.toContain('Protected analysis')
    expect(render(paidGate, paidAccess)).toContain('Protected analysis')
    expect(render(paidGate, paidAccess)).not.toContain('A verified subscription is required')
    const memberGate = node('member-gate', 'lawyer.access-gate', { props: { requirement: 'member' }, slots: [{ name: 'children', children: [body] }] })
    expect(render(memberGate, publicAccess)).toContain('Sign in to continue')
    expect(render(memberGate, memberAccess)).toContain('Protected analysis')
  })

  test('keeps unsafe links/media inert and output within deterministic server-render budget', () => {
    const card = node('card', 'lawyer.story-card', { props: { title: 'Safe card', href: 'javascript:alert(1)', image: 'http://unsafe.example/image.jpg', imageAlt: 'Unsafe' } })
    const html = render(card)
    expect(html).toContain('href="/archive"')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('<img')
    expect(Buffer.byteLength(html)).toBeLessThan(8 * 1024)
  })

  test('emits exact-host canonical metadata and hydration seed through the existing runtime document', () => {
    const root = node('header', 'lawyer.editorial-header', { props: { title: 'Fixture analysis', canonicalPath: '/article/fixture' } })
    const artifact = route(root)
    const response = {
      schemaVersion: 1 as const, contractVersion: '1.0.0' as const, sourceSnapshotHashSha256: hash('d'),
      cacheIdentity: { host: 'lawyer.fuma.co.ke', platformId: 'fuma-platform', organizationId: 'lawyer-org', workspaceId: 'lawyer-workspace', siteId: 'lawyer-site', ownerKey: 'lawyer-owner', ownerGeneration: 1, releaseId: 'lawyer-release', releaseHashSha256: hash('1'), route: '/article/fixture', canonicalQuery: '', audience: { kind: 'public' as const, memberId: null, accessFingerprintSha256: hash('0') }, runtimeDeploymentVersion: '1.0.0', componentRegistryVersion: '1.0.0', rolloutPolicyVersion: 1 },
      application: { schemaVersion: 1 as const, cacheIdentity: undefined as never, member: { authenticated: false as const, memberIdentityId: null, memberId: null, sessionId: null, displayName: null }, snapshot: { version: 0, cart: { items: [] }, booking: { selections: [] }, account: null }, access: publicAccess, cachePolicy: 'public' as const },
      delivery: { selected: 'react' as const, reason: 'policy' as const, policy: { route: '/article/fixture', target: 'react' as const, shadow: 'off' as const, fallback: 'deny' as const, legacyReleaseId: null, version: 1 }, shadowParity: 'not-run' as const, legacy: null }, routeArtifact: artifact,
    }
    response.application.cacheIdentity = response.cacheIdentity
    const html = renderToStaticMarkup(<ApplicationStateProvider><RuntimeDocument response={response} /></ApplicationStateProvider>)
    expect(html).toContain('<title>Fixture analysis</title>')
    expect(html).toContain('<link rel="canonical" href="https://lawyer.fuma.co.ke/article/fixture"')
    expect(html).toContain('data-fuma-application-site')
    expect(html).toContain('data-fuma-audience="public"')
  })
})

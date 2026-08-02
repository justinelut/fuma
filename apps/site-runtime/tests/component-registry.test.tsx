import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentReference, ComponentRegistryEntry, RuntimeNode, RuntimeRouteArtifact } from '../lib/contracts'
import { ExactRuntimeRegistry } from '../lib/component-registry'
import { RuntimeTree, runtimeStyleCss } from '../components/runtime-tree'

const hash = (value: string) => value.repeat(64).slice(0, 64)
const officialVersions: Readonly<Record<string, string>> = {
  'layout.section': '1.0.0', 'base.body': '2.0.0', 'base.container': '2.0.0', 'base.text': '2.0.0',
  'base.image': '4.0.0', 'base.link': '2.0.0', 'base.button': '2.0.0', 'base.list': '2.0.0',
  'base.svg': '1.0.0', 'base.video': '4.0.0', 'base.form': '1.0.0', 'base.label': '1.0.0',
  'base.input': '1.0.0', 'base.textarea': '1.0.0', 'base.select': '1.0.0', 'base.option': '1.0.0',
  'base.submit': '1.0.0', 'base.outlet': '1.0.0', 'base.loop': '1.0.0', 'base.slot-instance': '1.0.0',
  'base.slot-outlet': '1.0.0',
  'application.member-status': '1.0.0', 'application.cart-action': '1.0.0', 'application.booking-action': '1.0.0',
}

function ref(componentId: string, version = officialVersions[componentId] ?? '1.0.0', namespace = 'fuma.official'): ComponentReference {
  return { namespace, componentId, exactVersion: version }
}

function node(id: string, componentId: string, input: Partial<RuntimeNode> & { props?: RuntimeNode['props'] } = {}): RuntimeNode {
  const reference = componentId.startsWith('private.')
    ? ref(componentId, '1.0.0', 'owner-alpha.private')
    : componentId.startsWith('restricted.')
      ? ref(componentId, '1.0.0', 'owner-alpha.client')
      : ref(componentId)
  return {
    nodeId: id,
    component: reference,
    props: input.props ?? {},
    classes: input.classes ?? [],
    styles: input.styles ?? [],
    requiredCapabilities: input.requiredCapabilities ?? [],
    bindings: input.bindings ?? [],
    slots: input.slots ?? [],
  }
}

function official(componentId: string): ComponentRegistryEntry {
  const applicationClient = componentId.startsWith('application.')
  return {
    reference: ref(componentId),
    source: { kind: 'official', publisher: 'fuma', ownerKey: null, siteId: null, origin: 'runtime-source' },
    execution: applicationClient ? 'official-client' : 'official-server',
    trust: { tier: 'official', reviewState: 'compiled-into-runtime', ownerConfirmed: true, validation: { typecheck: true, build: true, staticUtilities: true, accessibility: true, security: true, csp: true, bundleBudget: true } },
    propsSchemaHashSha256: hash('a'), slotsSchemaHashSha256: hash('b'), sourceHashSha256: hash('c'),
    capabilities: applicationClient ? ['interaction.local-state'] : [], artifactPaths: [], parameters: [], definition: null,
    dynamicTenantServerImport: false, persistedExecutableJsx: false,
  }
}

function privateEntry(input: Readonly<{
  id: string
  origin?: 'site-created' | 'visual-designer' | 'ai-designer' | 'source-import' | 'team-pack' | 'reviewed-marketplace'
  definition: RuntimeNode
  parameters?: ComponentRegistryEntry['parameters']
}>): ComponentRegistryEntry {
  return {
    reference: ref(input.id, '1.0.0', 'owner-alpha.private'),
    source: { kind: 'owner-private', publisher: 'site-owner', ownerKey: 'owner-alpha', siteId: 'site-alpha', origin: input.origin ?? 'site-created' },
    execution: 'private-declarative',
    trust: { tier: 'owner-private-declarative', reviewState: 'owner-private', ownerConfirmed: true, validation: { schema: true, references: true, capabilities: true, noExecutableSource: true } },
    propsSchemaHashSha256: hash('d'), slotsSchemaHashSha256: hash('e'), sourceHashSha256: hash('f'),
    capabilities: [], artifactPaths: [], parameters: input.parameters ?? [], definition: input.definition,
    dynamicTenantServerImport: false, persistedExecutableJsx: false,
  }
}

function restrictedEntry(): ComponentRegistryEntry {
  return {
    reference: ref('restricted.reveal', '1.0.0', 'owner-alpha.client'),
    source: { kind: 'owner-private', publisher: 'site-owner', ownerKey: 'owner-alpha', siteId: 'site-alpha', origin: 'ai-designer' },
    execution: 'restricted-client',
    trust: { tier: 'owner-private-restricted-client', reviewState: 'validated-and-owner-confirmed', ownerConfirmed: true, validation: { typecheck: true, build: true, staticUtilities: true, accessibility: true, security: true, csp: true, bundleBudget: true, noServerCode: true, noSecrets: true, noNetwork: true, noPaymentAuthority: true } },
    propsSchemaHashSha256: hash('1'), slotsSchemaHashSha256: hash('2'), sourceHashSha256: hash('3'),
    capabilities: ['browser.events', 'interaction.local-state'],
    artifactPaths: [`/runtime/components/${hash('4')}.js`], parameters: [], definition: null,
    dynamicTenantServerImport: false, persistedExecutableJsx: false,
  }
}

function route(root: RuntimeNode, components: readonly ComponentRegistryEntry[], publicData: RuntimeRouteArtifact['publicData'] = []): RuntimeRouteArtifact {
  return {
    schemaVersion: 1, contractVersion: '1.0.0',
    platformId: 'fuma', organizationId: 'org-alpha', workspaceId: 'workspace-alpha', siteId: 'site-alpha', ownerKey: 'owner-alpha', ownerGeneration: 1,
    releaseId: 'release-alpha', sourceSnapshotId: 'snapshot-alpha', sourceSnapshotHashSha256: hash('5'), componentRegistryVersion: '1.0.0',
    route: { route: '/', pageId: 'page-home', artifactPath: '/runtime/routes/home.json', semanticHtmlPath: '/index.html', layoutIds: [], styleArtifactPaths: [], publicDataKeys: publicData.map(({ key }) => key) },
    page: { pageId: 'page-home', title: 'Home', root }, layouts: [], components: [...components],
    styles: { tokens: [{ name: '--color-brand', value: '#713f12' }], breakpoints: [{ id: 'mobile', minWidthPx: 0 }], rules: [{ ruleId: 'card', selector: '.card', declarations: [{ property: 'color', value: 'var(--color-brand)' }] }], cssArtifactPaths: [] },
    stylesheets: [], publicData: [...publicData],
    artifactReferences: [{ logicalPath: '/index.html', role: 'semantic-html', mimeType: 'text/html', contentHashSha256: hash('6'), integritySha256: `sha256-${'A'.repeat(43)}=`, sizeBytes: 1, references: [], component: null, declaredCapabilities: [] }],
    routeHashSha256: hash('7'),
  }
}

function render(value: RuntimeRouteArtifact): string {
  return renderToStaticMarkup(<RuntimeTree route={value} host="alpha.trimly.co.ke" ownerKey="owner-alpha" siteId="site-alpha" />)
}

describe('FUMA-SITE-004 exact React component registry', () => {
  test('accepts every open declarative source at an exact site-scoped version and rejects drift/substitution', () => {
    const origins = ['site-created', 'visual-designer', 'ai-designer', 'source-import', 'team-pack', 'reviewed-marketplace'] as const
    const entries = origins.map((origin, index) => privateEntry({ id: `private.source-${index}`, origin, definition: node(`definition-${index}`, 'base.container') }))
    const artifact = route(node('root', 'base.container'), [official('base.container'), ...entries])
    expect(() => new ExactRuntimeRegistry(artifact, { ownerKey: 'owner-alpha', siteId: 'site-alpha' })).not.toThrow()
    expect(() => new ExactRuntimeRegistry(artifact, { ownerKey: 'owner-alpha', siteId: 'site-beta' })).toThrow('another owner or site')
    expect(() => new ExactRuntimeRegistry(route(node('root', 'base.container'), [{ ...official('base.container'), reference: ref('base.container', '9.0.0') }]), { ownerKey: 'owner-alpha', siteId: 'site-alpha' })).toThrow('not compiled')
  })

  test('renders the first-party semantic corpus without the old generic section scaffold', () => {
    const children = [
      node('heading', 'base.text', { props: { tag: 'h1', text: 'Seasonal menu' } }),
      node('image', 'base.image', { props: { src: '/media/dish.webp', alt: 'Pilau', loading: 'lazy' } }),
      node('link', 'base.link', { props: { href: 'cms:page:/about', text: 'About', target: '_self' } }),
      node('button', 'base.button', { props: { label: 'Reserve', disabled: false } }),
      node('list', 'base.list', { props: { listType: 'unordered', items: 'Pilau\nTea' } }),
      node('svg', 'base.svg', { props: { title: 'Logo', svg: '<svg viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>' } }),
      node('video', 'base.video', { props: { videoUrl: '/media/intro.mp4', controls: true, playsinline: true } }),
      node('form', 'base.form', { props: { mode: 'custom', formId: 'contact', action: '/contact', method: 'post' }, slots: [{ name: 'children', children: [node('label', 'base.label', { props: { text: 'Email', targetMode: 'explicit', targetId: 'email' } }), node('input', 'base.input', { props: { inputType: 'email', fieldId: 'email', id: 'email', required: true } }), node('submit', 'base.submit', { props: { label: 'Send' } })] }] }),
    ]
    const root = node('body', 'base.body', { slots: [{ name: 'children', children: [node('container', 'base.container', { props: { tag: 'main', htmlAttributes: { 'aria-label': 'Menu' } }, classes: ['card'], styles: [{ property: 'padding', value: '1rem' }], slots: [{ name: 'children', children }] })] }] })
    const ids = ['base.body', 'base.container', 'base.text', 'base.image', 'base.link', 'base.button', 'base.list', 'base.svg', 'base.video', 'base.form', 'base.label', 'base.input', 'base.submit']
    const html = render(route(root, ids.map(official)))
    expect(html).toContain('<main')
    expect(html).toContain('<h1')
    expect(html).toContain('<img')
    expect(html).toContain('href="/about"')
    expect(html).toContain('<li>Pilau</li><li>Tea</li></ul>')
    expect(html).toContain('role="img" aria-label="Logo"')
    expect(html).toContain('<video')
    expect(html).toContain('<form')
    expect(html).not.toContain('<section')
    expect(html).not.toContain('javascript:')
  })

  test('binds SITE-005 application controls to exact official Client versions and local state only', () => {
    const ids = ['application.member-status', 'application.cart-action', 'application.booking-action']
    const artifact = route(node('root', 'base.container'), [official('base.container'), ...ids.map(official)])
    const registry = new ExactRuntimeRegistry(artifact, { ownerKey: 'owner-alpha', siteId: 'site-alpha' })
    for (const id of ids) {
      const entry = registry.resolve(ref(id), ['interaction.local-state'])
      expect(entry.execution).toBe('official-client')
      expect(entry.capabilities).toEqual(['interaction.local-state'])
    }
    expect(() => new ExactRuntimeRegistry(route(node('root', 'base.container'), [official('base.container'), { ...official('application.cart-action'), reference: ref('application.cart-action', '2.0.0') }]), { ownerKey: 'owner-alpha', siteId: 'site-alpha' })).toThrow('not compiled')
    expect(() => new ExactRuntimeRegistry(route(node('root', 'base.container'), [official('base.container'), { ...official('application.booking-action'), capabilities: ['interaction.local-state', 'browser.events'] }]), { ownerKey: 'owner-alpha', siteId: 'site-alpha' })).toThrow('capability boundary')
    expect(() => new ExactRuntimeRegistry(route(node('root', 'base.container'), [official('base.container'), { ...official('application.member-status'), execution: 'official-server' }]), { ownerKey: 'owner-alpha', siteId: 'site-alpha' })).toThrow('execution boundary')
  })

  test('expands nested private parameters, slots and loop variants without executable source', () => {
    const definition = node('card-root', 'base.container', { props: { tag: 'article' }, slots: [{ name: 'children', children: [
      node('card-title', 'base.text', { props: { tag: 'h2', text: 'Default', __fuma: { propBindings: { text: { paramId: 'title-param' } } } } }),
      node('card-slot', 'base.slot-outlet', { props: { slotName: 'children' } }),

    ] }] })
    const card = privateEntry({ id: 'private.card', origin: 'ai-designer', definition, parameters: [{ id: 'title-param', name: 'title', type: 'string', defaultValue: 'Default title', required: true }] })
    const loopVariant = node('dish-row', 'base.container', { props: { tag: 'custom', customTag: 'li' }, slots: [{ name: 'children', children: [node('dish', 'base.text', { props: { tag: 'none', text: '{{entry.name}}' } })] }] })
    const loop = node('dish-loop', 'base.loop', { props: { tag: 'ul', items: [{ name: 'Pilau' }, { name: 'Tea' }] }, slots: [{ name: 'children', children: [loopVariant] }] })
    const instance = node('card-instance', 'private.card', { props: { propOverrides: { 'title-param': 'Chef picks' } }, classes: ['card'], slots: [{ name: 'children', children: [node('slot', 'base.slot-instance', { props: { slotName: 'children' }, slots: [{ name: 'children', children: [loop] }] })] }] })
    const entries = [card, ...['base.container', 'base.text', 'base.slot-outlet', 'base.slot-instance', 'base.loop'].map(official)]
    const html = render(route(instance, entries))
    expect(html).toContain('<article')
    expect(html).toContain('Chef picks')
    expect(html).toContain('<ul')
    expect(html).toContain('<li')
    expect(html).toContain('Pilau')
    expect(html).toContain('Tea')
    expect(html).not.toContain('propOverrides')
  })

  test('keeps restricted clients inert behind one compiled boundary and rejects missing/escalated artifacts', () => {
    const restricted = restrictedEntry()
    const artifact = route(node('reveal', 'restricted.reveal', { props: { initialOpen: false }, requiredCapabilities: ['browser.events'], slots: [{ name: 'children', children: [node('text', 'base.text', { props: { tag: 'p', text: 'Details' } })] }] }), [restricted, official('base.text')])
    artifact.artifactReferences.push({ logicalPath: restricted.artifactPaths[0]!, role: 'client-bundle', mimeType: 'text/javascript', contentHashSha256: hash('4'), integritySha256: `sha256-${'B'.repeat(43)}=`, sizeBytes: 1, references: [], component: restricted.reference, declaredCapabilities: restricted.capabilities })
    const html = render(artifact)
    expect(html).toContain('data-fuma-client-mode="isolated-reveal"')
    expect(html).not.toContain('<script')
    const escalated = { ...artifact, page: { ...artifact.page, root: node('bad', 'restricted.reveal', { requiredCapabilities: ['browser.animation'] }) } }
    expect(() => render(escalated)).toThrow('undeclared')
    expect(() => render(route(node('bad', 'restricted.reveal'), [{ ...restricted, artifactPaths: [] }]))).toThrow('complete immutable client artifacts')
  })

  test('emits release tokens/rules and rejects hostile SVG, URLs, attributes, and hidden nodes', () => {
    const hidden = node('hidden', 'base.text', { props: { text: 'secret', tag: 'p', __fuma: { hidden: true } } })
    const hostile = node('hostile', 'base.svg', { props: { svg: '<svg onload="alert(1)"><script>alert(1)</script></svg>', title: 'bad' } })
    const badLink = node('bad-link', 'base.link', { props: { href: 'javascript:alert(1)', text: 'bad', htmlAttributes: { onclick: 'alert(1)' } } })
    const root = node('root', 'base.container', { slots: [{ name: 'children', children: [hidden, hostile, badLink] }] })
    const artifact = route(root, ['base.container', 'base.text', 'base.svg', 'base.link'].map(official))
    expect(runtimeStyleCss(artifact)).toContain(':root{--color-brand:#713f12}')
    expect(runtimeStyleCss(artifact)).toContain('.card{color:var(--color-brand)}')
    const html = render(artifact)
    expect(html).not.toContain('secret')
    expect(html).not.toContain('alert(1)')
    expect(html).not.toContain('onclick')
  })
})

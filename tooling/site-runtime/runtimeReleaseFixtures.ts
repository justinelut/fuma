import {
  componentKey,
  runtimeIdentity,
  sha256Hex,
  type RuntimeArtifactPayload,
  type RuntimeComponentReference,
  type RuntimeReleaseDraft,
} from '../../apps/studio/server/fuma/publishing/runtimeTree/contracts'
import type {
  RuntimeReleaseProjection,
  WorkerClaimedSnapshot,
  WorkerPublishAuthority,
  WorkerRenderedArtifact,
  WorkerSemanticRenderer,
} from '../../apps/studio/server/fuma/publishing/runtimeTree/renderer'

const encoder = new TextEncoder()

export const SITE_002_SCOPE = Object.freeze({
  platformId: 'platform_fuma',
  organizationId: 'organization_alpha',
  workspaceId: 'workspace_alpha',
  siteId: 'site_alpha',
  ownerKey: 'owner_alpha',
  generation: 7,
  state: 'active' as const,
  transferFence: null,
})

export const SITE_002_AUTHORITY: WorkerPublishAuthority = Object.freeze({
  scope: SITE_002_SCOPE,
  profileId: 'website',
})

const OFFICIAL_SECTION: RuntimeComponentReference = {
  namespace: 'fuma.official',
  componentId: 'layout.section',
  exactVersion: '1.0.0',
}

function identity(releaseId: string, sourceSnapshotId: string, sourceSnapshotHashSha256: string) {
  return {
    platformId: SITE_002_SCOPE.platformId,
    organizationId: SITE_002_SCOPE.organizationId,
    workspaceId: SITE_002_SCOPE.workspaceId,
    siteId: SITE_002_SCOPE.siteId,
    ownerKey: SITE_002_SCOPE.ownerKey,
    ownerGeneration: SITE_002_SCOPE.generation,
    releaseId,
    sourceSnapshotId,
    sourceSnapshotHashSha256,
  }
}

function contentAddressedPath(bytes: Uint8Array, extension: 'js' | 'css' | 'map'): string {
  return `/runtime/components/${sha256Hex(bytes)}.${extension}`
}

export type SeededRuntimeRelease = Readonly<{
  releaseId: string
  sourceSnapshot: WorkerClaimedSnapshot
  projection: RuntimeReleaseProjection
  privateDeclarativeKey: string
  restrictedClientKey: string
}>

export function seededRuntimeRelease(revision: 1 | 2): SeededRuntimeRelease {
  const releaseId = `release_site002_${revision}`
  const sourceSnapshotId = `snapshot_site002_${revision}`
  const sourceSnapshotHashSha256 = sha256Hex(`site002-source-${revision}`)
  const privateVersion = revision === 1 ? '1.0.0' : '1.1.0'
  const clientVersion = revision === 1 ? '1.0.0' : '1.1.0'
  const privateDeclarative: RuntimeComponentReference = {
    namespace: 'owner-alpha.ai',
    componentId: 'restaurant.feature-card',
    exactVersion: privateVersion,
  }
  const restrictedClient: RuntimeComponentReference = {
    namespace: 'owner-alpha.designer',
    componentId: 'menu.reveal',
    exactVersion: clientVersion,
  }
  const clientBytes = encoder.encode(`(()=>{const version=${JSON.stringify(clientVersion)};document.documentElement.dataset.menuReveal=version})()`)
  const clientCssBytes = encoder.encode(`.menuReveal{transition:opacity ${revision === 1 ? '180ms' : '220ms'} ease}.menuReveal[data-ready="false"]{opacity:0}`)
  const sourceMapBytes = encoder.encode(JSON.stringify({ version: 3, file: 'menu-reveal.js', sources: ['menu-reveal.client'], names: [], mappings: '' }))
  const clientPath = contentAddressedPath(clientBytes, 'js')
  const clientCssPath = contentAddressedPath(clientCssBytes, 'css')
  const sourceMapPath = contentAddressedPath(sourceMapBytes, 'map')
  const ids = identity(releaseId, sourceSnapshotId, sourceSnapshotHashSha256)

  const draft: RuntimeReleaseDraft = {
    schemaVersion: 1,
    contractVersion: '1.0.0',
    ...ids,
    componentRegistryVersion: '1.0.0',
    routes: [{
      route: '/menu',
      pageId: 'page_menu',
      artifactPath: '/runtime/routes/menu.json',
      semanticHtmlPath: '/menu/index.html',
      layoutIds: ['layout_public'],
      styleArtifactPaths: ['/assets/framework.css'],
      publicDataKeys: ['featured_dish'],
    }],
    pages: [{
      pageId: 'page_menu',
      title: revision === 1 ? 'Seasonal menu' : 'Summer menu',
      root: {
        nodeId: 'node_private_feature',
        component: privateDeclarative,
        props: { heading: revision === 1 ? 'Chef selection' : 'Chef summer selection' },
        classes: ['featureCard'],
        styles: [],
        requiredCapabilities: ['content.public.read'],
        bindings: [{ prop: 'dish', publicDataKey: 'featured_dish' }],
        slots: [{
          name: 'interaction',
          children: [{
            nodeId: 'node_reveal',
            component: restrictedClient,
            props: { initialOpen: false },
            classes: ['menuReveal'],
            styles: [],
            requiredCapabilities: ['interaction.local-state', 'browser.events', 'browser.animation'],
            bindings: [],
            slots: [],
          }],
        }],
      },
    }],
    layouts: [{
      layoutId: 'layout_public',
      exactVersion: '1.0.0',
      root: {
        nodeId: 'node_layout',
        component: OFFICIAL_SECTION,
        props: { element: 'main' },
        classes: ['siteMain'],
        styles: [],
        requiredCapabilities: [],
        bindings: [],
        slots: [],
      },
    }],
    visualComponents: [{
      visualComponentId: 'visual_feature_card',
      component: privateDeclarative,
      root: {
        nodeId: 'node_visual_definition',
        component: OFFICIAL_SECTION,
        props: { element: 'article' },
        classes: ['featureCard'],
        styles: [],
        requiredCapabilities: [],
        bindings: [],
        slots: [],
      },
    }],
    components: [
      {
        reference: restrictedClient,
        source: {
          kind: 'owner-private',
          publisher: 'site-owner',
          ownerKey: SITE_002_SCOPE.ownerKey,
          siteId: SITE_002_SCOPE.siteId,
          origin: 'visual-designer',
        },
        execution: 'restricted-client',
        trust: {
          tier: 'owner-private-restricted-client',
          reviewState: 'validated-and-owner-confirmed',
          ownerConfirmed: true,
          validation: {
            typecheck: true,
            build: true,
            staticUtilities: true,
            accessibility: true,
            security: true,
            csp: true,
            bundleBudget: true,
            noServerCode: true,
            noSecrets: true,
            noNetwork: true,
            noPaymentAuthority: true,
          },
        },
        propsSchemaHashSha256: sha256Hex('restricted-props-v1'),
        slotsSchemaHashSha256: sha256Hex('restricted-slots-v1'),
        sourceHashSha256: sha256Hex(`isolated-client-draft-${clientVersion}`),
        capabilities: ['browser.animation', 'browser.events', 'interaction.local-state'],
        artifactPaths: [sourceMapPath, clientCssPath, clientPath],
        parameters: [],
        definition: null,
        dynamicTenantServerImport: false,
        persistedExecutableJsx: false,
      },
      {
        reference: OFFICIAL_SECTION,
        source: { kind: 'official', publisher: 'fuma', ownerKey: null, siteId: null, origin: 'runtime-source' },
        execution: 'official-server',
        trust: {
          tier: 'official',
          reviewState: 'compiled-into-runtime',
          ownerConfirmed: true,
          validation: {
            typecheck: true,
            build: true,
            staticUtilities: true,
            accessibility: true,
            security: true,
            csp: true,
            bundleBudget: true,
          },
        },
        propsSchemaHashSha256: sha256Hex('official-section-props-v1'),
        slotsSchemaHashSha256: sha256Hex('official-section-slots-v1'),
        sourceHashSha256: sha256Hex('official-section-runtime-source-v1'),
        capabilities: [],
        artifactPaths: [],
        parameters: [],
        definition: null,
        dynamicTenantServerImport: false,
        persistedExecutableJsx: false,
      },
      {
        reference: privateDeclarative,
        source: {
          kind: 'owner-private',
          publisher: 'site-owner',
          ownerKey: SITE_002_SCOPE.ownerKey,
          siteId: SITE_002_SCOPE.siteId,
          origin: 'ai-designer',
        },
        execution: 'private-declarative',
        trust: {
          tier: 'owner-private-declarative',
          reviewState: 'owner-private',
          ownerConfirmed: true,
          validation: { schema: true, references: true, capabilities: true, noExecutableSource: true },
        },
        propsSchemaHashSha256: sha256Hex(`private-feature-props-${privateVersion}`),
        slotsSchemaHashSha256: sha256Hex(`private-feature-slots-${privateVersion}`),
        sourceHashSha256: sha256Hex(`private-declarative-tree-${privateVersion}`),
        capabilities: ['content.public.read'],
        artifactPaths: [],
        parameters: [],
        definition: {
          nodeId: 'private_definition_root',
          component: OFFICIAL_SECTION,
          props: { element: 'article', semanticRole: 'featured-dish' },
          classes: ['featureCard'],
          styles: [],
          requiredCapabilities: [],
          bindings: [],
          slots: [],
        },
        dynamicTenantServerImport: false,
        persistedExecutableJsx: false,
      },
    ],
    styles: {
      tokens: [
        { name: '--color-brand', value: revision === 1 ? '#713f12' : '#9a3412' },
        { name: '--space-card', value: revision === 1 ? '1.5rem' : '2rem' },
      ],
      breakpoints: [{ id: 'mobile', minWidthPx: 0 }, { id: 'desktop', minWidthPx: 1024 }],
      rules: [{
        ruleId: 'feature_card_rule',
        selector: '.featureCard',
        declarations: [{ property: 'color', value: 'var(--color-brand)' }, { property: 'padding', value: 'var(--space-card)' }],
      }],
      cssArtifactPaths: ['/assets/framework.css', clientCssPath],
    },
    media: [],
    publicData: [{ key: 'featured_dish', value: { name: revision === 1 ? 'Pilau' : 'Coconut pilau', priceMinor: 1800 } }],
    compatibility: {
      semanticHtmlCss: 'coexists',
      legacyReleaseReadable: true,
      runtimeQueriesDraftState: false,
      runtimeQueriesPlatformTables: false,
      tenantServerComponents: 'forbidden',
    },
  }

  const artifact = (input: Omit<RuntimeArtifactPayload, keyof ReturnType<typeof runtimeIdentity>>): RuntimeArtifactPayload => ({
    ...runtimeIdentity(draft as never),
    ...input,
  }) as RuntimeArtifactPayload
  const artifacts: RuntimeArtifactPayload[] = [
    artifact({
      logicalPath: clientPath,
      role: 'client-bundle',
      mimeType: 'text/javascript',
      bytes: clientBytes,
      references: [clientCssPath, sourceMapPath],
      component: restrictedClient,
      declaredCapabilities: ['browser.animation', 'browser.events', 'interaction.local-state'],
    }),
    artifact({
      logicalPath: clientCssPath,
      role: 'component-css',
      mimeType: 'text/css',
      bytes: clientCssBytes,
      references: [],
      component: restrictedClient,
      declaredCapabilities: [],
    }),
    artifact({
      logicalPath: sourceMapPath,
      role: 'source-map',
      mimeType: 'application/json',
      bytes: sourceMapBytes,
      references: [],
      component: restrictedClient,
      declaredCapabilities: [],
    }),
  ]

  return Object.freeze({
    releaseId,
    sourceSnapshot: Object.freeze({
      id: sourceSnapshotId,
      hashSha256: sourceSnapshotHashSha256,
      immutableRevision: `${revision}`,
      document: { draft, artifacts },
    }),
    projection: Object.freeze({ draft, artifacts }),
    privateDeclarativeKey: componentKey(privateDeclarative),
    restrictedClientKey: componentKey(restrictedClient),
  })
}

export class SeededLegacySemanticRenderer implements WorkerSemanticRenderer {
  async *render(_authority: WorkerPublishAuthority, snapshot: WorkerClaimedSnapshot): AsyncIterable<WorkerRenderedArtifact> {
    const revision = snapshot.id.endsWith('_1') ? 1 : 2
    const css = encoder.encode(`:root{--legacy-revision:${revision}}.featureCard{display:block}`)
    yield {
      logicalPath: '/assets/framework.css',
      kind: 'css',
      mimeType: 'text/css',
      bytes: css,
      references: [],
    }
    yield {
      logicalPath: '/menu/index.html',
      kind: 'html',
      mimeType: 'text/html',
      bytes: encoder.encode(`<!doctype html><html><head><link rel="stylesheet" href="/assets/framework.css"></head><body><main>Legacy menu ${revision}</main></body></html>`),
      references: ['/assets/framework.css'],
    }
  }
}

export function seededProjection(_authority: WorkerPublishAuthority, snapshot: WorkerClaimedSnapshot): RuntimeReleaseProjection {
  const document = snapshot.document as { draft?: unknown, artifacts?: unknown[] }
  return { draft: document.draft, artifacts: document.artifacts ?? [] }
}

import {
  RUNTIME_ROUTE_MIME,
  RUNTIME_SNAPSHOT_MIME,
  RUNTIME_SNAPSHOT_PATH,
  RuntimeArtifactPayloadSchema,
  RuntimeReleaseContractError,
  RuntimeReleaseDraftSchema,
  RuntimeReleaseSnapshotSchema,
  RuntimeRouteArtifactSchema,
  assertSafeRuntimeJson,
  componentKey,
  parseRuntimeContract,
  runtimeIdentity,
  sha256Hex,
  sha256Integrity,
  type RuntimeArtifactMime,
  type RuntimeArtifactPayload,
  type RuntimeArtifactReference,
  type RuntimeArtifactRole,
  type RuntimeCapability,
  type RuntimeComponentReference,
  type RuntimeComponentRegistryEntry,
  type RuntimeLayout,
  type RuntimeNode,
  type RuntimePage,
  type RuntimeReleaseDraft,
  type RuntimeReleaseSnapshot,
  type RuntimeRouteArtifact,
} from './contracts'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sortedUnique(values: readonly string[], label: string): string[] {
  const sorted = [...values].sort(compareText)
  if (new Set(sorted).size !== sorted.length) {
    throw new RuntimeReleaseContractError('duplicate-identity', `${label} contains duplicate values.`)
  }
  return sorted
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, nested]) => [key, canonicalValue(nested)]))
  }
  return value
}

export function canonicalRuntimeJson(value: unknown): string {
  assertSafeRuntimeJson(value)
  return JSON.stringify(canonicalValue(value))
}

export function serializeRuntimeContract(value: unknown): Uint8Array {
  return encoder.encode(canonicalRuntimeJson(value))
}

function normalizeNode(node: RuntimeNode): RuntimeNode {
  return {
    ...node,
    classes: sortedUnique(node.classes, `${node.nodeId}.classes`),
    requiredCapabilities: sortedUnique(node.requiredCapabilities, `${node.nodeId}.requiredCapabilities`) as RuntimeCapability[],
    bindings: [...node.bindings].sort((left, right) => compareText(left.prop, right.prop)),
    slots: [...node.slots]
      .map((slot) => ({ ...slot, children: slot.children.map(normalizeNode) }))
      .sort((left, right) => compareText(left.name, right.name)),
  }
}

function normalizeComponent(component: RuntimeComponentRegistryEntry): RuntimeComponentRegistryEntry {
  return {
    ...component,
    capabilities: sortedUnique(component.capabilities, `${componentKey(component.reference)}.capabilities`) as RuntimeCapability[],
    artifactPaths: sortedUnique(component.artifactPaths, `${componentKey(component.reference)}.artifactPaths`),
    definition: component.definition === null ? null : normalizeNode(component.definition),
  }
}

function normalizeDraft(draft: RuntimeReleaseDraft): RuntimeReleaseDraft {
  return {
    ...draft,
    routes: [...draft.routes]
      .map((route) => ({
        ...route,
        layoutIds: sortedUnique(route.layoutIds, `${route.route}.layoutIds`),
        styleArtifactPaths: sortedUnique(route.styleArtifactPaths, `${route.route}.styleArtifactPaths`),
        publicDataKeys: sortedUnique(route.publicDataKeys, `${route.route}.publicDataKeys`),
      }))
      .sort((left, right) => compareText(left.route, right.route)),
    pages: [...draft.pages].map((page) => ({ ...page, root: normalizeNode(page.root) }))
      .sort((left, right) => compareText(left.pageId, right.pageId)),
    layouts: [...draft.layouts].map((layout) => ({ ...layout, root: normalizeNode(layout.root) }))
      .sort((left, right) => compareText(left.layoutId, right.layoutId)),
    visualComponents: [...draft.visualComponents]
      .map((component) => ({ ...component, root: normalizeNode(component.root) }))
      .sort((left, right) => compareText(left.visualComponentId, right.visualComponentId)),
    components: [...draft.components].map(normalizeComponent)
      .sort((left, right) => compareText(componentKey(left.reference), componentKey(right.reference))),
    styles: {
      tokens: [...draft.styles.tokens].sort((left, right) => compareText(left.name, right.name)),
      breakpoints: [...draft.styles.breakpoints].sort((left, right) => left.minWidthPx - right.minWidthPx || compareText(left.id, right.id)),
      rules: [...draft.styles.rules].sort((left, right) => compareText(left.ruleId, right.ruleId)),
      cssArtifactPaths: sortedUnique(draft.styles.cssArtifactPaths, 'styles.cssArtifactPaths'),
    },
    media: [...draft.media].sort((left, right) => compareText(left.mediaId, right.mediaId)),
    publicData: [...draft.publicData].sort((left, right) => compareText(left.key, right.key)),
  }
}

function sameIdentity(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const keys = [
    'platformId', 'organizationId', 'workspaceId', 'siteId', 'ownerKey',
    'ownerGeneration', 'releaseId', 'sourceSnapshotId', 'sourceSnapshotHashSha256',
  ]
  return keys.every((key) => left[key] === right[key])
}

function assertUniqueBy<T>(items: readonly T[], key: (item: T) => string, label: string): void {
  const values = items.map(key)
  if (new Set(values).size !== values.length) {
    throw new RuntimeReleaseContractError('duplicate-identity', `${label} contains duplicate identities.`)
  }
}

function walkNode(node: RuntimeNode, visit: (node: RuntimeNode) => void): void {
  visit(node)
  for (const slot of node.slots) for (const child of slot.children) walkNode(child, visit)
}

function referenceEquals(left: RuntimeComponentReference, right: RuntimeComponentReference): boolean {
  return componentKey(left) === componentKey(right)
}

function assertTrust(component: RuntimeComponentRegistryEntry, identity: RuntimeReleaseDraft | RuntimeReleaseSnapshot): void {
  const source = component.source
  const tier = component.trust.tier
  if (source.kind === 'official') {
    if (tier !== 'official' || !component.execution.startsWith('official-') || component.definition !== null) {
      throw new RuntimeReleaseContractError('component-trust', `${componentKey(component.reference)} has invalid official trust metadata.`)
    }
  } else {
    if (source.ownerKey !== identity.ownerKey || source.siteId !== identity.siteId) {
      throw new RuntimeReleaseContractError('identity-mismatch', `${componentKey(component.reference)} belongs to another owner or site.`)
    }
    if (component.execution === 'private-declarative') {
      if (tier !== 'owner-private-declarative' || component.definition === null || component.artifactPaths.length !== 0) {
        throw new RuntimeReleaseContractError('component-trust', `${componentKey(component.reference)} is not a valid private declarative component.`)
      }
    } else if (component.execution === 'restricted-client') {
      if (tier !== 'owner-private-restricted-client' || component.definition !== null || component.artifactPaths.length === 0) {
        throw new RuntimeReleaseContractError('component-trust', `${componentKey(component.reference)} is not a validated restricted-client component.`)
      }
    } else {
      throw new RuntimeReleaseContractError('component-trust', 'Owner-private components cannot execute as tenant Server Components.')
    }
  }
  if (component.dynamicTenantServerImport || component.persistedExecutableJsx) {
    throw new RuntimeReleaseContractError('persisted-executable-source', `${componentKey(component.reference)} carries executable tenant source authority.`)
  }
}

function assertNode(
  root: RuntimeNode,
  components: ReadonlyMap<string, RuntimeComponentRegistryEntry>,
  publicData: ReadonlySet<string>,
  enclosingComponent?: RuntimeComponentReference,
): void {
  const nodeIds = new Set<string>()
  walkNode(root, (node) => {
    if (nodeIds.has(node.nodeId)) throw new RuntimeReleaseContractError('duplicate-identity', `Node ${node.nodeId} is duplicated in one tree.`)
    nodeIds.add(node.nodeId)
    const component = components.get(componentKey(node.component))
    if (!component) throw new RuntimeReleaseContractError('version-mismatch', `Node ${node.nodeId} references an absent exact component version.`)
    if (enclosingComponent && referenceEquals(node.component, enclosingComponent)) {
      throw new RuntimeReleaseContractError('component-trust', `${componentKey(enclosingComponent)} recursively references itself.`)
    }
    const capabilities = new Set(component.capabilities)
    if (node.requiredCapabilities.some((capability) => !capabilities.has(capability))) {
      throw new RuntimeReleaseContractError('capability-mismatch', `Node ${node.nodeId} requests an undeclared component capability.`)
    }
    for (const binding of node.bindings) {
      if (!publicData.has(binding.publicDataKey)) throw new RuntimeReleaseContractError('missing-reference', `Node ${node.nodeId} references missing public data ${binding.publicDataKey}.`)
    }
    assertSafeRuntimeJson(node.props, `node.${node.nodeId}.props`)
  })
}

const ROLE_MIMES: Readonly<Record<RuntimeArtifactRole, readonly RuntimeArtifactMime[]>> = {
  'semantic-html': ['text/html'],
  'semantic-css': ['text/css'],
  'runtime-route': [RUNTIME_ROUTE_MIME],
  'client-bundle': ['text/javascript', 'application/javascript'],
  'component-css': ['text/css'],
  'source-map': ['application/json'],
  media: ['image/avif', 'image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'font/woff2'],
  'public-data': ['application/json'],
}

function assertSourceMap(bytes: Uint8Array): void {
  let value: unknown
  try { value = JSON.parse(decoder.decode(bytes)) } catch {
    throw new RuntimeReleaseContractError('unsafe-artifact', 'Source-map artifact must be valid UTF-8 JSON.')
  }
  const map = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  if (!map || map.version !== 3 || !Array.isArray(map.sources) || 'sourcesContent' in map || 'sourceRoot' in map) {
    throw new RuntimeReleaseContractError('unsafe-artifact', 'Source maps must be version 3 references without embedded source or source roots.')
  }
  if (map.sources.some((source) => typeof source !== 'string' || source.includes('://') || source.startsWith('/') || source.includes('..'))) {
    throw new RuntimeReleaseContractError('unsafe-artifact', 'Source-map sources must be safe relative references.')
  }
}

function assertArtifactPolicy(reference: RuntimeArtifactReference, bytes?: Uint8Array): void {
  if (!ROLE_MIMES[reference.role].includes(reference.mimeType)) {
    throw new RuntimeReleaseContractError('unsafe-artifact', `${reference.role} cannot use MIME ${reference.mimeType}.`)
  }
  if (reference.integritySha256 !== sha256Integrity(reference.contentHashSha256)) {
    throw new RuntimeReleaseContractError('hash-mismatch', `${reference.logicalPath} has invalid SHA-256 integrity metadata.`)
  }
  if (bytes) {
    if (bytes.byteLength !== reference.sizeBytes || sha256Hex(bytes) !== reference.contentHashSha256) {
      throw new RuntimeReleaseContractError('hash-mismatch', `${reference.logicalPath} bytes do not match immutable metadata.`)
    }
    if (reference.role === 'source-map') assertSourceMap(bytes)
  }
  if (reference.role === 'client-bundle' || reference.role === 'component-css' || reference.role === 'source-map') {
    const extension = reference.role === 'client-bundle' ? 'js' : reference.role === 'component-css' ? 'css' : 'map'
    if (reference.logicalPath !== `/runtime/components/${reference.contentHashSha256}.${extension}`) {
      throw new RuntimeReleaseContractError('unsafe-artifact', `${reference.role} logical path must be content-addressed.`)
    }
  }
}

function snapshotWithoutHash(snapshot: RuntimeReleaseSnapshot): Omit<RuntimeReleaseSnapshot, 'runtimeTreeHashSha256'> {
  const { runtimeTreeHashSha256: _hash, ...body } = snapshot
  return body
}

function validateSnapshotSemantics(snapshot: RuntimeReleaseSnapshot): void {
  assertSafeRuntimeJson(snapshot)
  assertUniqueBy(snapshot.routes, (route) => route.route, 'routes')
  assertUniqueBy(snapshot.routes, (route) => route.artifactPath, 'route artifact paths')
  assertUniqueBy(snapshot.pages, (page) => page.pageId, 'pages')
  assertUniqueBy(snapshot.layouts, (layout) => layout.layoutId, 'layouts')
  assertUniqueBy(snapshot.visualComponents, (component) => component.visualComponentId, 'visual components')
  assertUniqueBy(snapshot.components, (component) => componentKey(component.reference), 'component registry')
  assertUniqueBy(snapshot.artifacts, (artifact) => artifact.logicalPath, 'artifacts')
  assertUniqueBy(snapshot.publicData, (item) => item.key, 'public data')

  const canonicalHash = sha256Hex(serializeRuntimeContract(snapshotWithoutHash(snapshot)))
  if (snapshot.runtimeTreeHashSha256 !== canonicalHash) {
    throw new RuntimeReleaseContractError('hash-mismatch', 'Runtime tree hash does not match deterministic snapshot bytes.')
  }

  const components = new Map(snapshot.components.map((component) => [componentKey(component.reference), component]))
  const publicData = new Set(snapshot.publicData.map(({ key }) => key))
  const pages = new Map(snapshot.pages.map((page) => [page.pageId, page]))
  const layouts = new Map(snapshot.layouts.map((layout) => [layout.layoutId, layout]))
  const artifacts = new Map(snapshot.artifacts.map((artifact) => [artifact.logicalPath, artifact]))

  for (const component of snapshot.components) {
    assertTrust(component, snapshot)
    if (component.definition) assertNode(component.definition, components, publicData, component.reference)
  }
  for (const page of snapshot.pages) assertNode(page.root, components, publicData)
  for (const layout of snapshot.layouts) assertNode(layout.root, components, publicData)
  for (const visual of snapshot.visualComponents) {
    if (!components.has(componentKey(visual.component))) throw new RuntimeReleaseContractError('version-mismatch', 'Visual Component exact registry version is absent.')
    assertNode(visual.root, components, publicData)
  }
  for (const route of snapshot.routes) {
    if (!pages.has(route.pageId)) throw new RuntimeReleaseContractError('missing-reference', `${route.route} references a missing page.`)
    if (!artifacts.has(route.artifactPath) || !artifacts.has(route.semanticHtmlPath)) throw new RuntimeReleaseContractError('missing-reference', `${route.route} has a missing route or semantic artifact.`)
    if (route.layoutIds.some((id) => !layouts.has(id))) throw new RuntimeReleaseContractError('missing-reference', `${route.route} references a missing layout.`)
    if (route.styleArtifactPaths.some((path) => !artifacts.has(path))) throw new RuntimeReleaseContractError('missing-reference', `${route.route} references missing CSS.`)
    if (route.publicDataKeys.some((key) => !publicData.has(key))) throw new RuntimeReleaseContractError('missing-reference', `${route.route} references missing public data.`)
  }
  for (const media of snapshot.media) if (!artifacts.has(media.artifactPath)) throw new RuntimeReleaseContractError('missing-reference', `Media ${media.mediaId} is missing its artifact.`)
  for (const path of snapshot.styles.cssArtifactPaths) if (!artifacts.has(path)) throw new RuntimeReleaseContractError('missing-reference', `Style artifact ${path} is absent.`)

  for (const artifact of snapshot.artifacts) {
    assertArtifactPolicy(artifact)
    if (artifact.references.some((path) => !artifacts.has(path))) throw new RuntimeReleaseContractError('missing-reference', `${artifact.logicalPath} references an absent artifact.`)
    if (artifact.component !== null) {
      const component = components.get(componentKey(artifact.component))
      if (!component || component.execution !== 'restricted-client' || !component.artifactPaths.includes(artifact.logicalPath)) {
        throw new RuntimeReleaseContractError('component-trust', `${artifact.logicalPath} is not bound to its exact restricted-client component.`)
      }
      if (artifact.role === 'client-bundle' && canonicalRuntimeJson(artifact.declaredCapabilities) !== canonicalRuntimeJson(component.capabilities)) {
        throw new RuntimeReleaseContractError('capability-mismatch', `${artifact.logicalPath} capability declaration drifted from the component.`)
      }
      if (artifact.role !== 'client-bundle' && artifact.declaredCapabilities.length !== 0) {
        throw new RuntimeReleaseContractError('capability-mismatch', `${artifact.logicalPath} declares capabilities outside its executable bundle.`)
      }
    } else if (artifact.role === 'client-bundle' || artifact.role === 'component-css' || artifact.role === 'source-map') {
      throw new RuntimeReleaseContractError('component-trust', `${artifact.logicalPath} lacks an exact component binding.`)
    }
  }
  for (const component of snapshot.components) {
    if (component.artifactPaths.some((path) => !artifacts.has(path))) throw new RuntimeReleaseContractError('missing-reference', `${componentKey(component.reference)} references a missing immutable artifact.`)
    if (component.execution === 'restricted-client' && !component.artifactPaths.some((path) => artifacts.get(path)?.role === 'client-bundle')) {
      throw new RuntimeReleaseContractError('missing-reference', `${componentKey(component.reference)} has no validated client bundle.`)
    }
  }
}

export function validateRuntimeReleaseSnapshot(value: unknown): Readonly<RuntimeReleaseSnapshot> {
  const snapshot = parseRuntimeContract(RuntimeReleaseSnapshotSchema, value, 'runtime release snapshot')
  validateSnapshotSemantics(snapshot)
  return deeplyFreeze(snapshot)
}

function deeplyFreeze<T>(value: T): Readonly<T> {
  if (value instanceof Uint8Array) return value
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deeplyFreeze(nested)
    Object.freeze(value)
  }
  return value
}

function referenceFromPayload(payload: RuntimeArtifactPayload): RuntimeArtifactReference {
  const hash = sha256Hex(payload.bytes)
  const reference: RuntimeArtifactReference = {
    logicalPath: payload.logicalPath,
    role: payload.role,
    mimeType: payload.mimeType,
    contentHashSha256: hash,
    integritySha256: sha256Integrity(hash),
    sizeBytes: payload.bytes.byteLength,
    references: sortedUnique(payload.references, `${payload.logicalPath}.references`),
    component: payload.component,
    declaredCapabilities: sortedUnique(payload.declaredCapabilities, `${payload.logicalPath}.capabilities`) as RuntimeCapability[],
  }
  assertArtifactPolicy(reference, payload.bytes)
  return reference
}

function collectReferences(root: RuntimeNode, output = new Map<string, RuntimeComponentReference>()): ReadonlyMap<string, RuntimeComponentReference> {
  walkNode(root, (node) => output.set(componentKey(node.component), node.component))
  return output
}

function routeComponents(
  draft: RuntimeReleaseDraft,
  page: RuntimePage,
  layouts: readonly RuntimeLayout[],
): RuntimeComponentRegistryEntry[] {
  const registry = new Map(draft.components.map((entry) => [componentKey(entry.reference), entry]))
  const selected = new Map<string, RuntimeComponentRegistryEntry>()
  const pending = new Map<string, RuntimeComponentReference>()
  collectReferences(page.root, pending)
  for (const layout of layouts) collectReferences(layout.root, pending)
  while (pending.size > 0) {
    const key = pending.keys().next().value as string
    pending.delete(key)
    if (selected.has(key)) continue
    const entry = registry.get(key)
    if (!entry) throw new RuntimeReleaseContractError('version-mismatch', `${key} is absent from the exact component registry.`)
    selected.set(key, entry)
    if (entry.definition) {
      const nested = new Map<string, RuntimeComponentReference>()
      collectReferences(entry.definition, nested)
      for (const [nestedKey, nestedReference] of nested) if (!selected.has(nestedKey)) pending.set(nestedKey, nestedReference)
    }
  }
  return [...selected.values()].sort((left, right) => compareText(componentKey(left.reference), componentKey(right.reference)))
}

function inlineStylesheets(
  payloads: readonly RuntimeArtifactPayload[],
  references: readonly RuntimeArtifactReference[],
) {
  const referenceByPath = new Map(references.map((reference) => [reference.logicalPath, reference]))
  return payloads
    .filter((payload) => payload.role === 'semantic-css' || payload.role === 'component-css')
    .map((payload) => {
      const reference = referenceByPath.get(payload.logicalPath)
      if (!reference) throw new RuntimeReleaseContractError('missing-reference', `${payload.logicalPath} is absent from route CSS references.`)
      let cssText: string
      try { cssText = decoder.decode(payload.bytes) } catch { throw new RuntimeReleaseContractError('unsafe-artifact', `${payload.logicalPath} is not valid UTF-8 CSS.`) }
      if (/<\/style/i.test(cssText)) throw new RuntimeReleaseContractError('unsafe-artifact', `${payload.logicalPath} can terminate an inline style element.`)
      return { logicalPath: payload.logicalPath, contentHashSha256: reference.contentHashSha256, cssText }
    })
    .sort((left, right) => compareText(left.logicalPath, right.logicalPath))
}

function routeArtifact(
  draft: RuntimeReleaseDraft,
  route: RuntimeReleaseDraft['routes'][number],
  page: RuntimePage,
  layouts: RuntimeLayout[],
  components: RuntimeComponentRegistryEntry[],
  references: RuntimeArtifactReference[],
  payloads: RuntimeArtifactPayload[],
): RuntimeRouteArtifact {
  const publicData = route.publicDataKeys.map((key) => {
    const value = draft.publicData.find((item) => item.key === key)
    if (!value) throw new RuntimeReleaseContractError('missing-reference', `${route.route} references absent public data ${key}.`)
    return value
  })
  const base = {
    schemaVersion: 1 as const,
    contractVersion: '1.0.0' as const,
    ...runtimeIdentity(draft as never),
    componentRegistryVersion: draft.componentRegistryVersion,
    route,
    page,
    layouts,
    components,
    styles: draft.styles,
    stylesheets: inlineStylesheets(payloads, references),
    publicData,
    artifactReferences: references.sort((left, right) => compareText(left.logicalPath, right.logicalPath)),
  }
  return {
    ...base,
    routeHashSha256: sha256Hex(serializeRuntimeContract(base)),
  }
}

export type RuntimeReleaseBuild = Readonly<{
  snapshot: Readonly<RuntimeReleaseSnapshot>
  snapshotBytes: Uint8Array
  routeArtifacts: readonly Readonly<{ contract: RuntimeRouteArtifact, bytes: Uint8Array }>[]
  payloads: readonly RuntimeArtifactPayload[]
}>

export function buildRuntimeRelease(input: Readonly<{
  draft: unknown
  payloads: readonly unknown[]
}>): RuntimeReleaseBuild {
  const parsedDraft = parseRuntimeContract(RuntimeReleaseDraftSchema, input.draft, 'runtime release draft')
  assertSafeRuntimeJson(parsedDraft)
  const draft = normalizeDraft(parsedDraft)
  const payloads = input.payloads.map((payload) => parseRuntimeContract(RuntimeArtifactPayloadSchema, payload, 'runtime artifact payload'))
  for (const payload of payloads) {
    if (!sameIdentity(runtimeIdentity(draft as never), runtimeIdentity(payload as never))) {
      throw new RuntimeReleaseContractError('identity-mismatch', `${payload.logicalPath} does not belong to the exact release.`)
    }
  }
  assertUniqueBy(payloads, (payload) => payload.logicalPath, 'artifact payloads')
  const externalReferences = payloads.map(referenceFromPayload)
  const externalByPath = new Map(externalReferences.map((reference) => [reference.logicalPath, reference]))
  for (const reference of externalReferences) {
    if (reference.references.some((path) => !externalByPath.has(path))) {
      throw new RuntimeReleaseContractError('missing-reference', `${reference.logicalPath} references an absent payload.`)
    }
  }

  const pages = new Map(draft.pages.map((page) => [page.pageId, page]))
  const layouts = new Map(draft.layouts.map((layout) => [layout.layoutId, layout]))
  const routeArtifacts: Array<{ contract: RuntimeRouteArtifact, bytes: Uint8Array }> = []
  const routeReferences: RuntimeArtifactReference[] = []
  for (const route of draft.routes) {
    const page = pages.get(route.pageId)
    if (!page) throw new RuntimeReleaseContractError('missing-reference', `${route.route} references an absent page.`)
    const selectedLayouts = route.layoutIds.map((id) => layouts.get(id)).filter((value): value is RuntimeLayout => value !== undefined)
    if (selectedLayouts.length !== route.layoutIds.length) throw new RuntimeReleaseContractError('missing-reference', `${route.route} references an absent layout.`)
    const selectedComponents = routeComponents(draft, page, selectedLayouts)
    const paths = sortedUnique([
      route.semanticHtmlPath,
      ...route.styleArtifactPaths,
      ...selectedComponents.flatMap((component) => component.artifactPaths),
    ], `${route.route}.artifactReferences`)
    const selectedReferences = paths.map((path) => externalByPath.get(path)).filter((value): value is RuntimeArtifactReference => value !== undefined)
    if (selectedReferences.length !== paths.length) throw new RuntimeReleaseContractError('missing-reference', `${route.route} references an absent immutable artifact.`)
    const selectedPayloads = paths.map((path) => payloads.find((payload) => payload.logicalPath === path)).filter((value): value is RuntimeArtifactPayload => value !== undefined)
    if (selectedPayloads.length !== paths.length) throw new RuntimeReleaseContractError('missing-reference', `${route.route} references absent immutable payload bytes.`)
    const contract = routeArtifact(draft, route, page, selectedLayouts, selectedComponents, selectedReferences, selectedPayloads)
    const bytes = serializeRuntimeContract(contract)
    const hash = sha256Hex(bytes)
    const descriptor: RuntimeArtifactReference = {
      logicalPath: route.artifactPath,
      role: 'runtime-route',
      mimeType: RUNTIME_ROUTE_MIME,
      contentHashSha256: hash,
      integritySha256: sha256Integrity(hash),
      sizeBytes: bytes.byteLength,
      references: selectedReferences.map(({ logicalPath }) => logicalPath).sort(compareText),
      component: null,
      declaredCapabilities: [],
    }
    routeArtifacts.push({ contract, bytes })
    routeReferences.push(descriptor)
  }

  const body = {
    ...draft,
    artifacts: [...externalReferences, ...routeReferences].sort((left, right) => compareText(left.logicalPath, right.logicalPath)),
  }
  const snapshot: RuntimeReleaseSnapshot = {
    ...body,
    runtimeTreeHashSha256: sha256Hex(serializeRuntimeContract(body)),
  }
  const validated = validateRuntimeReleaseSnapshot(snapshot)
  return deeplyFreeze({
    snapshot: validated,
    snapshotBytes: serializeRuntimeContract(validated),
    routeArtifacts,
    payloads,
  }) as RuntimeReleaseBuild
}

export type WorkerRenderedArtifact = {
  logicalPath: string
  kind: 'html' | 'css' | 'javascript' | 'asset'
  mimeType: string
  bytes: Uint8Array
  references: string[]
}

export type WorkerPublishAuthority = Readonly<{
  scope: Readonly<{
    platformId: string
    organizationId: string
    workspaceId: string
    siteId: string
    ownerKey: string
    generation: number
    state: 'active' | 'transferring'
    transferFence: number | null
  }>
  profileId: string
}>

export type WorkerClaimedSnapshot = Readonly<{
  id: string
  hashSha256: string
  immutableRevision: string
  document: unknown
}>

export type WorkerReleaseRenderContext = Readonly<{
  releaseId: string
}>

export interface WorkerSemanticRenderer {
  render(
    authority: WorkerPublishAuthority,
    snapshot: WorkerClaimedSnapshot,
    context?: WorkerReleaseRenderContext,
  ): AsyncIterable<WorkerRenderedArtifact>
}

export type RuntimeReleaseProjection = Readonly<{
  draft: unknown
  artifacts: readonly unknown[]
}>

function payloadRole(artifact: WorkerRenderedArtifact): RuntimeArtifactRole {
  if (artifact.kind === 'html' && artifact.mimeType === 'text/html') return 'semantic-html'
  if (artifact.kind === 'css' && artifact.mimeType === 'text/css') return 'semantic-css'
  if (artifact.kind === 'asset' && ROLE_MIMES.media.includes(artifact.mimeType as RuntimeArtifactMime)) return 'media'
  throw new RuntimeReleaseContractError('unsafe-artifact', `Legacy renderer emitted unsupported runtime-coexistence MIME ${artifact.mimeType}.`)
}

function workerKind(role: RuntimeArtifactRole): WorkerRenderedArtifact['kind'] {
  if (role === 'semantic-html') return 'html'
  if (role === 'semantic-css' || role === 'component-css') return 'css'
  if (role === 'client-bundle') return 'javascript'
  return 'asset'
}

/**
 * Structural adapter for AtomicPublishWorker.SemanticReleaseRenderer. It intentionally imports
 * no Studio or application module, so the future runtime can consume only these TypeBox bytes.
 */
export class RuntimeTreeRendererAdapter implements WorkerSemanticRenderer {
  private readonly dependencies: Readonly<{
    semanticRenderer: WorkerSemanticRenderer
    project(
      authority: WorkerPublishAuthority,
      snapshot: WorkerClaimedSnapshot,
      context?: WorkerReleaseRenderContext,
      legacyArtifacts?: readonly WorkerRenderedArtifact[],
    ): RuntimeReleaseProjection | Promise<RuntimeReleaseProjection>
  }>

  constructor(dependencies: Readonly<{
    semanticRenderer: WorkerSemanticRenderer
    project(
      authority: WorkerPublishAuthority,
      snapshot: WorkerClaimedSnapshot,
      context?: WorkerReleaseRenderContext,
      legacyArtifacts?: readonly WorkerRenderedArtifact[],
    ): RuntimeReleaseProjection | Promise<RuntimeReleaseProjection>
  }>) {
    this.dependencies = dependencies
  }

  async *render(
    authority: WorkerPublishAuthority,
    snapshot: WorkerClaimedSnapshot,
    context?: WorkerReleaseRenderContext,
  ): AsyncIterable<WorkerRenderedArtifact> {
    const legacy: WorkerRenderedArtifact[] = []
    for await (const artifact of this.dependencies.semanticRenderer.render(authority, snapshot, context)) {
      legacy.push(structuredClone(artifact))
    }
    const projection = await this.dependencies.project(authority, snapshot, context, legacy)
    const draft = parseRuntimeContract(RuntimeReleaseDraftSchema, projection.draft, 'runtime release projection')
    if ((context && draft.releaseId !== context.releaseId)
      || draft.sourceSnapshotId !== snapshot.id || draft.sourceSnapshotHashSha256 !== snapshot.hashSha256
      || draft.platformId !== authority.scope.platformId || draft.organizationId !== authority.scope.organizationId
      || draft.workspaceId !== authority.scope.workspaceId || draft.siteId !== authority.scope.siteId
      || draft.ownerKey !== authority.scope.ownerKey || draft.ownerGeneration !== authority.scope.generation) {
      throw new RuntimeReleaseContractError('identity-mismatch', 'Runtime projection does not match the exact claimed snapshot and publish authority.')
    }
    const identity = runtimeIdentity(draft as never)
    const legacyPayloads: RuntimeArtifactPayload[] = legacy.map((artifact) => ({
      ...identity,
      logicalPath: artifact.logicalPath,
      role: payloadRole(artifact),
      mimeType: artifact.mimeType as RuntimeArtifactMime,
      bytes: artifact.bytes,
      references: [...artifact.references],
      component: null,
      declaredCapabilities: [],
    }))
    const build = buildRuntimeRelease({ draft, payloads: [...legacyPayloads, ...projection.artifacts] })

    for (const payload of build.payloads) {
      yield {
        logicalPath: payload.logicalPath,
        kind: workerKind(payload.role),
        mimeType: payload.mimeType,
        bytes: payload.bytes,
        references: payload.references,
      }
    }
    for (const route of build.routeArtifacts) {
      yield {
        logicalPath: route.contract.route.artifactPath,
        kind: 'asset',
        mimeType: RUNTIME_ROUTE_MIME,
        bytes: route.bytes,
        references: route.contract.artifactReferences.map(({ logicalPath }) => logicalPath),
      }
    }
    yield {
      logicalPath: RUNTIME_SNAPSHOT_PATH,
      kind: 'asset',
      mimeType: RUNTIME_SNAPSHOT_MIME,
      bytes: build.snapshotBytes,
      references: build.snapshot.artifacts.map(({ logicalPath }) => logicalPath),
    }
  }
}

export function parseRuntimeSnapshotBytes(bytes: Uint8Array): Readonly<RuntimeReleaseSnapshot> {
  let value: unknown
  try { value = JSON.parse(decoder.decode(bytes)) } catch {
    throw new RuntimeReleaseContractError('invalid-contract', 'Runtime snapshot bytes are not valid UTF-8 JSON.')
  }
  return validateRuntimeReleaseSnapshot(value)
}

export function validateRuntimeRouteArtifact(value: unknown): Readonly<RuntimeRouteArtifact> {
  const artifact = parseRuntimeContract(RuntimeRouteArtifactSchema, value, 'runtime route artifact')
  const { routeHashSha256, ...body } = artifact
  if (routeHashSha256 !== sha256Hex(serializeRuntimeContract(body))) {
    throw new RuntimeReleaseContractError('hash-mismatch', 'Runtime route artifact hash does not match deterministic bytes.')
  }
  return deeplyFreeze(artifact)
}

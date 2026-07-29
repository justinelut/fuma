import '../../../../src/modules/base'
import '@core/loops/sources'
import { registry } from '@core/module-engine'
import type { BaseNode, SiteDocument } from '@core/page-tree'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import { EditorSiteDocumentSchema, type EditorSiteDocument } from '../../editor/contracts'
import {
  RuntimeReleaseContractError,
  componentKey,
  sha256Hex,
  type RuntimeComponentReference,
  type RuntimeComponentRegistryEntry,
  type RuntimeJsonValue,
  type RuntimeNode,
  type RuntimeReleaseDraft,
  type RuntimeStyleDeclaration,
} from './contracts'
import type {
  RuntimeReleaseProjection,
  WorkerClaimedSnapshot,
  WorkerPublishAuthority,
  WorkerReleaseRenderContext,
  WorkerRenderedArtifact,
} from './renderer'

type EditorNode = EditorSiteDocument['pages'][number]['nodes'][string]
type EditorTree = Readonly<{
  nodes: Readonly<Record<string, EditorNode | BaseNode>>
  rootNodeId: string
}>

const CLASS_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/
const CSS_PROPERTY = /^--?[A-Za-z_][A-Za-z0-9_-]*$|^[a-z][a-z0-9-]*$/

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function contentVersion(value: unknown): string {
  return `1.0.0-${sha256Hex(canonical(value)).slice(0, 16)}`
}

function runtimeJson(value: unknown, path: string): RuntimeJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RuntimeReleaseContractError('invalid-contract', `${path} contains a non-finite number.`)
    return value
  }
  if (Array.isArray(value)) return value.map((item, index) => runtimeJson(item, `${path}[${index}]`))
  if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    const output: Record<string, RuntimeJsonValue> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (nested !== undefined) output[key] = runtimeJson(nested, `${path}.${key}`)
    }
    return output
  }
  throw new RuntimeReleaseContractError('invalid-contract', `${path} is not immutable JSON data.`)
}

function runtimeObject(value: unknown, path: string): Record<string, RuntimeJsonValue> {
  const parsed = runtimeJson(value, path)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RuntimeReleaseContractError('invalid-contract', `${path} must be a JSON object.`)
  }
  return parsed as Record<string, RuntimeJsonValue>
}

function kebabProperty(value: string): string | null {
  const property = value.startsWith('--')
    ? value
    : value.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`).toLowerCase()
  return CSS_PROPERTY.test(property) ? property : null
}

function declarations(value: Readonly<Record<string, unknown>> | undefined): RuntimeStyleDeclaration[] {
  if (!value) return []
  return Object.entries(value).flatMap(([rawProperty, rawValue]) => {
    const property = kebabProperty(rawProperty)
    if (!property || (typeof rawValue !== 'string' && typeof rawValue !== 'number')) return []
    return [{ property, value: String(rawValue) }]
  }).sort((left, right) => compareText(left.property, right.property))
}

function safeComponentId(moduleId: string): string {
  const normalized = moduleId.toLowerCase()
  return /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(normalized)
    ? normalized
    : `module.${sha256Hex(moduleId).slice(0, 20)}`
}

function officialReference(moduleId: string): RuntimeComponentReference {
  const definition = registry.get(moduleId)
  if (!definition) {
    throw new RuntimeReleaseContractError('version-mismatch', `Module ${moduleId} is absent from the exact first-party registry.`)
  }
  return {
    namespace: 'fuma.official',
    componentId: safeComponentId(moduleId),
    exactVersion: definition.version,
  }
}

function privateReference(component: EditorSiteDocument['visualComponents'][number]): RuntimeComponentReference {
  return {
    namespace: 'fuma.private',
    componentId: `visual.${sha256Hex(component.id).slice(0, 20)}`,
    exactVersion: contentVersion(component),
  }
}

function publishedFilename(slug: string, title: string): string {
  const base = (slug || title || 'page')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return base === '' || base === 'index' ? 'index.html' : `${base}.html`
}

function publicRoute(slug: string, title: string): string {
  const filename = publishedFilename(slug, title)
  return filename === 'index.html' ? '/' : `/${filename.slice(0, -'.html'.length)}`
}

function runtimeClassName(
  classId: string,
  document: EditorSiteDocument,
): string | null {
  const rule = document.site.styleRules[classId]
  if (!rule || rule.kind !== 'class') return null
  return CLASS_NAME.test(rule.name) ? rule.name : `fuma-${sha256Hex(rule.name).slice(0, 16)}`
}

function convertTree(
  tree: EditorTree,
  document: EditorSiteDocument,
  privateReferences: ReadonlyMap<string, RuntimeComponentReference>,
  label: string,
): RuntimeNode {
  const visiting = new Set<string>()
  const emitted = new Set<string>()

  const convert = (nodeId: string): RuntimeNode => {
    if (visiting.has(nodeId)) throw new RuntimeReleaseContractError('component-trust', `${label} contains a node cycle at ${nodeId}.`)
    if (emitted.has(nodeId)) throw new RuntimeReleaseContractError('duplicate-identity', `${label} reuses node ${nodeId} in multiple positions.`)
    const node = tree.nodes[nodeId]
    if (!node) throw new RuntimeReleaseContractError('missing-reference', `${label} references missing node ${nodeId}.`)
    visiting.add(nodeId)
    emitted.add(nodeId)

    let component: RuntimeComponentReference
    if (node.moduleId === 'base.visual-component-ref') {
      const componentId = typeof node.props.componentId === 'string' ? node.props.componentId : null
      const reference = componentId ? privateReferences.get(componentId) : null
      if (!reference) throw new RuntimeReleaseContractError('missing-reference', `${label}.${nodeId} references a missing Visual Component.`)
      component = reference
    } else {
      component = officialReference(node.moduleId)
    }

    const metadata: Record<string, unknown> = {
      moduleId: node.moduleId,
      breakpointOverrides: node.breakpointOverrides,
      hidden: node.hidden ?? false,
      locked: node.locked ?? false,
    }
    if (node.label !== undefined) metadata.label = node.label
    if (node.propBindings !== undefined) metadata.propBindings = node.propBindings
    if ('dynamicBindings' in node && node.dynamicBindings !== undefined) metadata.dynamicBindings = node.dynamicBindings

    const classes = node.classIds
      .map((classId) => runtimeClassName(classId, document))
      .filter((value): value is string => value !== null)
    const children = node.children.map(convert)
    visiting.delete(nodeId)

    return {
      nodeId: node.id,
      component,
      props: {
        ...runtimeObject(node.props, `${label}.${nodeId}.props`),
        __fuma: runtimeJson(metadata, `${label}.${nodeId}.__fuma`),
      },
      classes: [...new Set(classes)],
      styles: declarations(node.inlineStyles),
      requiredCapabilities: [],
      bindings: [],
      slots: children.length === 0 ? [] : [{ name: 'children', children }],
    }
  }

  return convert(tree.rootNodeId)
}

function siteDocument(document: EditorSiteDocument): SiteDocument {
  return structuredClone({
    ...document.site,
    pages: document.pages,
    visualComponents: document.visualComponents,
    layouts: document.layouts,
  }) as unknown as SiteDocument
}

function registryEntry(
  moduleId: string,
): RuntimeComponentRegistryEntry {
  const definition = registry.getOrThrow(moduleId)
  const reference = officialReference(moduleId)
  const schemaHash = sha256Hex(canonical(definition.schema))
  return {
    reference,
    source: {
      kind: 'official', publisher: 'fuma', ownerKey: null, siteId: null, origin: 'runtime-source',
    },
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
    propsSchemaHashSha256: schemaHash,
    slotsSchemaHashSha256: sha256Hex(definition.canHaveChildren ? 'children:v1' : 'none:v1'),
    sourceHashSha256: sha256Hex(canonical({ moduleId, reference, schemaHash, publishBehavior: definition.publishBehavior ?? null })),
    capabilities: [],
    artifactPaths: [],
    parameters: [],
    definition: null,
    dynamicTenantServerImport: false,
    persistedExecutableJsx: false,
  }
}

/**
 * Convert the immutable editor snapshot into the app-local SITE-002 runtime tree.
 * Generated client artifacts are supplied by later validated component-authoring
 * authorities through this same projection seam; the current canonical editor
 * document contains only first-party modules and declarative Visual Components.
 */
export function projectEditorRuntimeRelease(
  authority: WorkerPublishAuthority,
  snapshot: WorkerClaimedSnapshot,
  context?: WorkerReleaseRenderContext,
  legacyArtifacts: readonly WorkerRenderedArtifact[] = [],
): RuntimeReleaseProjection {
  if (!context) throw new RuntimeReleaseContractError('identity-mismatch', 'Runtime release projection requires exact release context.')
  const parsed = safeParseValue(EditorSiteDocumentSchema, snapshot.document)
  if (!parsed.ok || parsed.value.site.id !== authority.scope.siteId) {
    throw new RuntimeReleaseContractError('invalid-contract', 'Runtime release source is not a valid exact-site editor document.')
  }
  const document = parsed.value
  const privateReferences = new Map(document.visualComponents.map((component) => [component.id, privateReference(component)]))
  const moduleIds = new Set<string>()
  const collect = (tree: EditorTree): void => {
    for (const node of Object.values(tree.nodes)) {
      if (node.moduleId !== 'base.visual-component-ref') moduleIds.add(node.moduleId)
    }
  }
  for (const page of document.pages) collect(page)
  for (const layout of document.layouts) collect(layout)
  for (const component of document.visualComponents) collect(component.tree)

  const officialComponents = [...moduleIds].sort(compareText).map(registryEntry)
  const privateComponents: RuntimeComponentRegistryEntry[] = document.visualComponents.map((component) => {
    const reference = privateReferences.get(component.id)!
    const definition = convertTree(component.tree, document, privateReferences, `visualComponent.${component.id}`)
    return {
      reference,
      source: {
        kind: 'owner-private',
        publisher: 'site-owner',
        ownerKey: authority.scope.ownerKey,
        siteId: authority.scope.siteId,
        origin: 'visual-designer',
      },
      execution: 'private-declarative',
      trust: {
        tier: 'owner-private-declarative',
        reviewState: 'owner-private',
        ownerConfirmed: true,
        validation: { schema: true, references: true, capabilities: true, noExecutableSource: true },
      },
      propsSchemaHashSha256: sha256Hex(canonical(component.params)),
      slotsSchemaHashSha256: sha256Hex(canonical(component.params.filter(({ type }) => type === 'slot'))),
      sourceHashSha256: sha256Hex(canonical(component)),
      capabilities: [],
      artifactPaths: [],
      parameters: component.params.map((parameter) => ({
        id: parameter.id,
        name: parameter.name,
        type: parameter.type,
        defaultValue: runtimeJson(parameter.defaultValue, `visualComponent.${component.id}.parameter.${parameter.id}`),
        required: parameter.required,
        ...(parameter.enumOptions === undefined ? {} : { enumOptions: parameter.enumOptions }),
      })),
      definition,
      dynamicTenantServerImport: false,
      persistedExecutableJsx: false,
    }
  })
  const components = [...officialComponents, ...privateComponents]
    .sort((left, right) => compareText(componentKey(left.reference), componentKey(right.reference)))
  const componentRegistryVersion = contentVersion(components.map(({ reference, sourceHashSha256 }) => ({ reference, sourceHashSha256 })))

  const legacyPaths = new Set(legacyArtifacts.map(({ logicalPath }) => logicalPath))
  const cssArtifactPaths = legacyArtifacts
    .filter(({ mimeType }) => mimeType === 'text/css')
    .map(({ logicalPath }) => logicalPath)
    .sort(compareText)
  const pages = document.pages.map((page) => ({
    pageId: page.id,
    title: page.title,
    root: convertTree(page, document, privateReferences, `page.${page.id}`),
  }))
  const routes = document.pages.map((page) => {
    const route = publicRoute(page.slug, page.title)
    const semanticHtmlPath = `/${publishedFilename(page.slug, page.title)}`
    if (!legacyPaths.has(semanticHtmlPath)) {
      throw new RuntimeReleaseContractError('missing-reference', `${route} is missing semantic HTML ${semanticHtmlPath}.`)
    }
    return {
      route,
      pageId: page.id,
      artifactPath: `/runtime/routes/${sha256Hex(route).slice(0, 24)}.json`,
      semanticHtmlPath,
      layoutIds: [],
      styleArtifactPaths: cssArtifactPaths,
      publicDataKeys: [],
    }
  })
  const styleRules = Object.values(document.site.styleRules).map((rule) => {
    const className = rule.kind === 'class'
      ? (CLASS_NAME.test(rule.name) ? rule.name : `fuma-${sha256Hex(rule.name).slice(0, 16)}`)
      : null
    return {
      ruleId: rule.id,
      selector: className ? `.${className}` : rule.selector,
      declarations: declarations(rule.styles),
    }
  })

  const draft: RuntimeReleaseDraft = {
    schemaVersion: 1,
    contractVersion: '1.0.0',
    platformId: authority.scope.platformId,
    organizationId: authority.scope.organizationId,
    workspaceId: authority.scope.workspaceId,
    siteId: authority.scope.siteId,
    ownerKey: authority.scope.ownerKey,
    ownerGeneration: authority.scope.generation,
    releaseId: context.releaseId,
    sourceSnapshotId: snapshot.id,
    sourceSnapshotHashSha256: snapshot.hashSha256,
    componentRegistryVersion,
    routes,
    pages,
    layouts: document.layouts.map((layout) => ({
      layoutId: layout.id,
      exactVersion: contentVersion(layout),
      root: convertTree(layout, document, privateReferences, `layout.${layout.id}`),
    })),
    visualComponents: document.visualComponents.map((component) => ({
      visualComponentId: component.id,
      component: privateReferences.get(component.id)!,
      root: convertTree(component.tree, document, privateReferences, `visualComponent.${component.id}`),
    })),
    components,
    styles: {
      tokens: [],
      breakpoints: document.site.breakpoints.map(({ id, width }) => ({ id, minWidthPx: Math.max(0, Math.round(width)) })),
      rules: styleRules,
      cssArtifactPaths,
    },
    media: [],
    publicData: [],
    compatibility: {
      semanticHtmlCss: 'coexists',
      legacyReleaseReadable: true,
      runtimeQueriesDraftState: false,
      runtimeQueriesPlatformTables: false,
      tenantServerComponents: 'forbidden',
    },
  }

  // Retain a compile-time check that this projector consumes the complete
  // canonical document rather than a separate page-only projection.
  void siteDocument(document)
  return { draft, artifacts: [] }
}

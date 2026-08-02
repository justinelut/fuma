import * as ts from 'typescript'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { FileMap } from '@core/siteImport/types'
import {
  isNextSourceInteractionAuthorityAvailable,
  type NextSourceDraftRevision,
} from '@core/siteImport'
import { EditorSiteDocumentSchema, type EditorSiteDocument } from '../editor/contracts'
import { validateAndSanitizeMediaBytes } from '../../handlers/cms/importMediaValidation'
import { detectAcceptedMime } from '../../handlers/cms/mediaUpload'
import { sha256Hex } from '../objectStorage'
import { convertJsx } from './projectionCompiler'
import { defaultPageExpression } from './projectionEvaluator'
import {
  NextSourceProjectionError,
  addNode,
  canonical,
  fail,
  hashText,
  sourceText,
  type ProjectionContext,
} from './projectionShared'

const UNSAFE_CSS = /@import\b|@tailwind\b|url\s*\(|expression\s*\(|-moz-binding|<\s*\/\s*style/i

export { NextSourceProjectionError } from './projectionShared'

export type NextSourceProjection = Readonly<{
  document: EditorSiteDocument
  documentHashSha256: string
  sourceRevisionId: string
  sourceHashSha256: string
}>

function projectedRouteSlug(route: string, sourcePath: string): string {
  if (route === '/') return 'index'
  if (!/^\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(route)) {
    throw new NextSourceProjectionError('Only root and nested static routes can be projected; dynamic and catch-all routes require reviewed data-template adaptation.', sourcePath)
  }
  const slug = route.slice(1)
  if (['admin', 'api', 'assets', 'health'].includes(slug.split('/')[0]!)) {
    throw new NextSourceProjectionError('Imported route uses a reserved Fuma public path.', sourcePath)
  }
  return slug
}

function pageForRoute(
  revision: NextSourceDraftRevision,
  files: FileMap,
  route: string,
  sourcePath: string,
  classes: Map<string, string>,
  assetUrls: ReadonlySet<string>,
): EditorSiteDocument['pages'][number] {
  const slug = projectedRouteSlug(route, sourcePath)
  const source = sourceText(files, sourcePath)
  const scriptKind = sourcePath.endsWith('.tsx') ? ts.ScriptKind.TSX : sourcePath.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.ESNext, true, scriptKind)
  const parseDiagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? []
  if (parseDiagnostics.length > 0) throw new NextSourceProjectionError('Route source contains TypeScript/JSX syntax errors.', sourcePath)
  const context: ProjectionContext = {
    sourcePath,
    sourceFile,
    route,
    sourceHashSha256: revision.sourceHashSha256,
    files,
    moduleByPath: new Map(revision.analysis.modules.map((module) => [module.path, module])),
    sourceFiles: new Map([[sourcePath, sourceFile]]),
    componentStack: new Set(),
    bindings: new Map(),
    assetUrls,
    nodes: {},
    usedIds: new Set(),
    classes,
  }
  const expression = defaultPageExpression(sourceFile, context)
  if (!ts.isJsxElement(expression) && !ts.isJsxSelfClosingElement(expression) && !ts.isJsxFragment(expression)) {
    fail('Default page component must return static JSX.', context)
  }
  const root = addNode(context, 'root', 'base.body', {}, null)
  const projected = convertJsx(expression, root.id, context, 'root.0')
  for (const node of projected) root.children.push(node.id)
  const titleNode = Object.values(context.nodes).find((node) => node.moduleId === 'base.text' && node.props.tag === 'h1')
  const fallbackSegment = slug === 'index' ? 'Home' : slug.split('/').at(-1)!
  const fallbackTitle = fallbackSegment.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
  return {
    id: `next-page-${hashText(`${revision.sourceHashSha256}:${route}`).slice(0, 24)}`,
    slug,
    title: typeof titleNode?.props.text === 'string' && titleNode.props.text.trim() ? titleNode.props.text.trim() : fallbackTitle,
    rootNodeId: root.id,
    nodes: context.nodes,
  }
}

function importedStyles(revision: NextSourceDraftRevision, files: FileMap): Readonly<{
  siteFiles: EditorSiteDocument['site']['files']
  runtimeStyles: EditorSiteDocument['site']['runtime']['styles']
}> {
  const siteFiles: EditorSiteDocument['site']['files'][number][] = []
  const runtimeStyles: Record<string, { enabled: boolean; scope: { type: 'all-pages' }; priority: number }> = {}
  const paths = Object.keys(files.files).filter((path) => path.endsWith('.css')).sort()
  for (const [index, path] of paths.entries()) {
    const content = sourceText(files, path)
    if (UNSAFE_CSS.test(content)) throw new NextSourceProjectionError('CSS contains imports, asset URLs, Tailwind directives, or executable legacy constructs outside the supported subset.', path)
    const id = `next-style-${hashText(`${revision.sourceHashSha256}:${path}`).slice(0, 24)}`
    siteFiles.push({ id, path: `styles/${id}.css`, type: 'style', content, createdAt: 1, updatedAt: 1 })
    runtimeStyles[id] = { enabled: true, scope: { type: 'all-pages' }, priority: index }
  }
  return { siteFiles, runtimeStyles }
}

const MAX_PROJECTED_ASSET_BYTES = 8 * 1024 * 1024
const MAX_PROJECTED_ASSET_TOTAL_BYTES = 32 * 1024 * 1024

function importedPublicAssets(revision: NextSourceDraftRevision, files: FileMap): Readonly<{
  siteFiles: EditorSiteDocument['site']['files']
  assetUrls: ReadonlySet<string>
}> {
  const siteFiles: EditorSiteDocument['site']['files'][number][] = []
  const assetUrls = new Set<string>()
  let totalBytes = 0
  for (const asset of revision.analysis.assets) {
    if (asset.kind !== 'image' || !asset.path.startsWith('public/')) continue
    const source = files.files[asset.path]
    if (!source) throw new NextSourceProjectionError('Analyzed public asset is absent from the exact source revision.', asset.path)
    if (source.bytes.byteLength !== asset.sizeBytes || sha256Hex(source.bytes) !== asset.sha256) {
      throw new NextSourceProjectionError('Public asset bytes conflict with hash-bound analysis evidence.', asset.path)
    }
    if (source.bytes.byteLength > MAX_PROJECTED_ASSET_BYTES) {
      throw new NextSourceProjectionError('Public asset exceeds the editor projection byte limit.', asset.path)
    }
    totalBytes += source.bytes.byteLength
    if (totalBytes > MAX_PROJECTED_ASSET_TOTAL_BYTES) {
      throw new NextSourceProjectionError('Public assets exceed the editor projection total byte limit.', asset.path)
    }
    const mimeType = detectAcceptedMime(source.bytes)
    if (!mimeType?.startsWith('image/')) {
      throw new NextSourceProjectionError('Public image content failed canonical MIME detection.', asset.path)
    }
    const validated = validateAndSanitizeMediaBytes(source.bytes, { storagePath: asset.path, mimeType })
    if (sha256Hex(validated) !== asset.sha256) {
      throw new NextSourceProjectionError('Public image requires sanitization and must be owner-reviewed as an adaptation.', asset.path)
    }
    const logicalPath = `/${asset.path.slice('public/'.length)}`
    if (logicalPath === '/' || assetUrls.has(logicalPath)) {
      throw new NextSourceProjectionError('Public asset URL is empty or duplicated.', asset.path)
    }
    assetUrls.add(logicalPath)
    siteFiles.push({
      id: `next-asset-${hashText(`${asset.path}:${asset.sha256}`).slice(0, 24)}`,
      path: asset.path,
      type: 'asset',
      blob: { mimeType, base64: Buffer.from(validated).toString('base64') },
      createdAt: 1,
      updatedAt: 1,
    })
  }
  return { siteFiles, assetUrls }
}

function assertReviewedInteractionProjection(
  revision: NextSourceDraftRevision,
  profileId: string,
): void {
  for (const interaction of revision.analysis.interactions) {
    if (interaction.boundAuthority === null) {
      throw new NextSourceProjectionError('Every source interaction must have one reviewed authority before editor commit.', interaction.path)
    }
    const binding = {
      interactionId: interaction.id,
      kind: interaction.kind,
      authority: interaction.boundAuthority,
    }
    if (!isNextSourceInteractionAuthorityAvailable(profileId, binding)) {
      throw new NextSourceProjectionError(
        `Reviewed interaction authority ${interaction.boundAuthority} is unavailable for ${profileId} sites.`,
        interaction.path,
      )
    }
  }
}

export function projectNextSourceRevision(input: Readonly<{
  revision: NextSourceDraftRevision
  files: FileMap
  profileId: string
  siteName?: string
}>): NextSourceProjection {
  const { revision, files } = input
  if (revision.analysis.sourceHashSha256 !== revision.sourceHashSha256) {
    throw new NextSourceProjectionError('Revision analysis is not bound to the exact source hash.')
  }
  if (revision.analysis.blocking || revision.analysis.diagnostics.some(({ severity }) => severity === 'blocking')) {
    throw new NextSourceProjectionError('Blocking source diagnostics must be adapted before editor commit.')
  }
  assertReviewedInteractionProjection(revision, input.profileId)
  if (revision.analysis.routes.some(({ kind }) => kind === 'route-handler')) {
    throw new NextSourceProjectionError('Next.js route handlers require native authority adapters before editor commit.')
  }
  const routeEvidence = revision.analysis.routes
    .filter(({ kind }) => kind === 'page')
    .sort((left, right) => left.route.localeCompare(right.route) || left.sourcePath.localeCompare(right.sourcePath))
  if (routeEvidence.length === 0) throw new NextSourceProjectionError('No static Next.js page routes are available to project.')
  if (new Set(routeEvidence.map(({ route }) => route)).size !== routeEvidence.length) {
    throw new NextSourceProjectionError('Route evidence contains a collision.')
  }
  const classes = new Map<string, string>()
  const assets = importedPublicAssets(revision, files)
  const pages = routeEvidence.map(({ route, sourcePath }) => pageForRoute(revision, files, route, sourcePath, classes, assets.assetUrls))
  const styles = importedStyles(revision, files)
  const styleRules = Object.fromEntries([...classes.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, id], order) => [id, {
      id,
      name,
      kind: 'class' as const,
      selector: `.${name}`,
      order,
      styles: {},
      contextStyles: {},
      createdAt: 1,
      updatedAt: 1,
    }]))
  const structural = {
    expandedFolders: [],
    emptyFolders: [],
    rowOrder: pages.map(({ id }, order) => ({ kind: 'item' as const, id, order })),
  }
  const decorative = { folders: [], items: [] }
  const candidate = {
    site: {
      id: revision.destination.siteId,
      name: input.siteName?.trim() || revision.analysis.packageEvidence.name || 'Imported Next.js site',
      breakpoints: [
        { id: 'mobile', label: 'Mobile', width: 390, icon: 'mobile' },
        { id: 'tablet', label: 'Tablet', width: 768, icon: 'tablet' },
        { id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor' },
      ],
      settings: { shortcuts: {} },
      styleRules,
      files: [...styles.siteFiles, ...assets.siteFiles],
      explorer: {
        pages: structural,
        styles: {
          expandedFolders: [],
          emptyFolders: [],
          rowOrder: styles.siteFiles.map(({ id }, order) => ({ kind: 'item' as const, id, order })),
        },
        scripts: { expandedFolders: [], emptyFolders: [], rowOrder: [] },
        templates: decorative,
        components: decorative,
      },
      packageJson: { dependencies: {}, devDependencies: {} },
      runtime: {
        dependencyLock: { version: 1, packages: {}, updatedAt: 1 },
        scripts: {},
        styles: styles.runtimeStyles,
      },
      createdAt: 1,
      updatedAt: 1,
    },
    pages,
    visualComponents: [],
    layouts: [],
  }
  const parsed = safeParseValue(EditorSiteDocumentSchema, candidate)
  if (!parsed.ok) {
    const detail = parsed.errors.slice(0, 5).map(({ path, message }) => `${path || '<root>'}: ${message}`).join('; ')
    throw new NextSourceProjectionError(`Static projection did not produce a valid editor document: ${detail}`)
  }
  const document = parsed.value
  return Object.freeze({
    document,
    documentHashSha256: hashText(canonical(document)),
    sourceRevisionId: revision.revisionId,
    sourceHashSha256: revision.sourceHashSha256,
  })
}

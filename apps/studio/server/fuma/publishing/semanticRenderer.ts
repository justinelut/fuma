import '../../../src/modules/base'
import '@core/loops/sources'
import type { EditorSiteDocument } from '../editor/contracts'
import { registry } from '@core/module-engine'
import type { SiteDocument } from '@core/page-tree'
import { publishPage } from '@core/publisher'
import {
  composeTemplateChain,
  resolveTemplateChain,
} from '@core/templates'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import { EditorSiteDocumentSchema } from '../editor/contracts'
import { buildSiteCssBundle } from '../../publish/siteCssBundle'
import { isSafePath, normalizePath } from '@core/files/pathValidation'
import { validateAndSanitizeMediaBytes } from '../../handlers/cms/importMediaValidation'
import {
  PublishWorkerError,
  type ClaimedSnapshot,
  type PublishAuthority,
  type RenderedArtifact,
  type SemanticReleaseRenderer,
} from './workerPublisher'

const CSS_BASE = '/_instatic/css/'

function siteDocument(document: EditorSiteDocument): SiteDocument {
  return structuredClone({
    ...document.site,
    pages: document.pages,
    visualComponents: document.visualComponents,
    layouts: document.layouts,
  }) as unknown as SiteDocument
}

function htmlPath(filename: string): string {
  return filename === 'index.html' ? '/index.html' : `/${filename}`
}

function renderedAssets(document: EditorSiteDocument): RenderedArtifact[] {
  const artifacts: RenderedArtifact[] = []
  const logicalPaths = new Set<string>()
  const files = document.site.files
    .filter((file) => file.type === 'asset')
    .sort((left, right) => left.path.localeCompare(right.path) || left.id.localeCompare(right.id))
  for (const file of files) {
    const normalized = normalizePath(file.path)
    if (!isSafePath(normalized) || !normalized.startsWith('public/') || !file.blob) {
      throw new PublishWorkerError('render-invalid', `Asset ${file.id} is not one validated public site file.`)
    }
    const base64 = file.blob.base64
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
      throw new PublishWorkerError('render-invalid', `Asset ${file.id} has invalid base64 bytes.`)
    }
    const bytes = new Uint8Array(Buffer.from(base64, 'base64'))
    if (Buffer.from(bytes).toString('base64') !== base64) {
      throw new PublishWorkerError('render-invalid', `Asset ${file.id} has non-canonical base64 bytes.`)
    }
    let validated: Uint8Array
    try {
      validated = validateAndSanitizeMediaBytes(bytes, { storagePath: normalized, mimeType: file.blob.mimeType })
    } catch {
      throw new PublishWorkerError('render-invalid', `Asset ${file.id} failed canonical media validation.`)
    }
    if (!Buffer.from(validated).equals(Buffer.from(bytes))) {
      throw new PublishWorkerError('render-invalid', `Asset ${file.id} requires sanitization before immutable publication.`)
    }
    const logicalPath = `/${normalized.slice('public/'.length)}`
    if (logicalPath === '/' || logicalPaths.has(logicalPath)) {
      throw new PublishWorkerError('render-invalid', `Asset ${file.id} has an empty or duplicate public path.`)
    }
    logicalPaths.add(logicalPath)
    artifacts.push({
      logicalPath,
      kind: 'asset',
      mimeType: file.blob.mimeType,
      bytes,
      references: [],
    })
  }
  return artifacts
}

/** Production adapter over Instatic's semantic module/template publisher. */
export class CoreSemanticReleaseRenderer implements SemanticReleaseRenderer {
  async *render(
    authority: PublishAuthority,
    snapshot: ClaimedSnapshot,
  ): AsyncIterable<RenderedArtifact> {
    const parsed = safeParseValue(EditorSiteDocumentSchema, snapshot.document)
    if (!parsed.ok || parsed.value.site.id !== authority.scope.siteId) {
      throw new PublishWorkerError('render-invalid', 'Immutable source is not a valid bound site document.')
    }
    const site = siteDocument(parsed.value)
    const assets = renderedAssets(parsed.value)
    const assetPaths = assets.map(({ logicalPath }) => logicalPath)
    for (const asset of assets) yield asset
    const emittedCss = new Set<string>()
    const pages = [...site.pages].sort((left, right) => (
      left.slug.localeCompare(right.slug) || left.id.localeCompare(right.id)
    ))

    for (const page of pages) {
      const chain = resolveTemplateChain(site, { kind: 'page' })
      const merged = composeTemplateChain(chain, { kind: 'page', page })
      const cssBundle = buildSiteCssBundle(site, registry, merged)
      const cssPaths: string[] = []
      for (const css of [
        cssBundle.reset,
        cssBundle.framework,
        cssBundle.style,
        cssBundle.userStyles,
      ]) {
        if (css.content.length === 0) continue
        const logicalPath = `${CSS_BASE}${css.filename}`
        cssPaths.push(logicalPath)
        if (emittedCss.has(logicalPath)) continue
        emittedCss.add(logicalPath)
        yield {
          logicalPath,
          kind: 'css',
          mimeType: 'text/css',
          bytes: new TextEncoder().encode(css.content),
          references: [],
        }
      }

      const published = publishPage(merged, site, registry, {
        cssEmission: 'external',
        cssBundle,
        cssAssetBaseUrl: CSS_BASE,
      })
      yield {
        logicalPath: htmlPath(published.filename),
        kind: 'html',
        mimeType: 'text/html',
        bytes: new TextEncoder().encode(published.html),
        references: [...new Set([...cssPaths, ...assetPaths])].sort(),
      }
    }
  }
}

import type { PublicTemplateCatalogService } from './service'
import type { TemplatePreviewArtifact } from './postgres'
import type { TemplateReleaseAuthority as TemplateReleaseCoordinates } from './contracts'

export interface TemplatePreviewReader {
  readExact(authority: TemplateReleaseCoordinates, path: string): Promise<TemplatePreviewArtifact | null>
}

export type TemplatePreviewBoundary = Readonly<{
  handles(request: Request): boolean
  handle(request: Request): Promise<Response | null>
}>

const SAFE_PATH = /^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]*$/
const RELEASE_PATH = /^\/releases\/([a-z0-9](?:[a-z0-9._-]{0,94}[a-z0-9])?)(\/.*)?$/
const ISOLATION_HEADERS = Object.freeze({
  'cache-control': 'private, no-store',
  'content-security-policy': "default-src 'none'; base-uri 'none'; connect-src 'none'; font-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self' data:; media-src 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
  'cross-origin-embedder-policy': 'require-corp',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
} as const)

function response(status: number, method: string, artifact?: TemplatePreviewArtifact): Response {
  const headers = new Headers(ISOLATION_HEADERS)
  if (!artifact) return new Response(method === 'HEAD' ? null : 'Preview unavailable.', { status, headers })
  headers.set('content-type', artifact.mimeType)
  headers.set('etag', `"${artifact.hashSha256}"`)
  return new Response(method === 'HEAD' ? null : artifact.bytes.slice().buffer as ArrayBuffer, { status, headers })
}

export function createTemplatePreviewBoundary(input: Readonly<{
  host: string
  catalog: Pick<PublicTemplateCatalogService, 'authorizePreview'>
  reader: TemplatePreviewReader
}>): TemplatePreviewBoundary {
  const expectedHost = input.host.toLowerCase()

  function handles(request: Request): boolean {
    const url = new URL(request.url)
    const host = (request.headers.get('host') ?? url.host).toLowerCase()
    return host === expectedHost && url.pathname.startsWith('/releases/')
  }

  async function handle(request: Request): Promise<Response | null> {
    if (!handles(request)) return null
    const url = new URL(request.url)
    if ((request.method !== 'GET' && request.method !== 'HEAD')
      || url.search !== ''
      || request.headers.has('authorization')
      || request.headers.has('cookie')) {
      return response(404, request.method)
    }
    const match = RELEASE_PATH.exec(url.pathname)
    const artifactPath = match?.[2] || '/'
    if (!match || !SAFE_PATH.test(artifactPath) || artifactPath.includes('//') || artifactPath.includes('/../') || artifactPath.includes('/./')) {
      return response(404, request.method)
    }
    try {
      const approval = await input.catalog.authorizePreview(match[1]!)
      const artifact = await input.reader.readExact(approval.releaseAuthority, artifactPath)
      return artifact ? response(200, request.method, artifact) : response(404, request.method)
    } catch {
      return response(404, request.method)
    }
  }

  return Object.freeze({ handles, handle })
}

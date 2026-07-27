import type { TenantObjectStorage } from '../objectStorage'
import { sha256Hex } from '../objectStorage'
import type { ReleaseArtifact, ReleaseManifest } from '../releases'
import {
  FreeHostError,
  FreeHostService,
  normalizePublicHost,
} from './service'

export interface FreeHostPublicBoundary {
  route(request: Request): Promise<Response | null>
}

export interface FreeHostRouteExtension {
  handles(request: Request): boolean
  handle(request: Request): Promise<Response | null>
}

export interface FreeHostResolvedEdgeBoundary {
  serve(request: Request, resolution: Extract<import('./service').FreeHostResolution, { kind: 'release' }>): Promise<Response>
}

export class FreeHostPublicRouter implements FreeHostPublicBoundary {
  readonly #service: FreeHostService
  readonly #storage: TenantObjectStorage
  readonly #controlHosts: ReadonlySet<string>
  readonly #extensions: readonly FreeHostRouteExtension[]
  readonly #edge: FreeHostResolvedEdgeBoundary | null

  constructor(input: Readonly<{
    service: FreeHostService
    storage: TenantObjectStorage
    controlHosts: readonly string[]
    extensions?: readonly FreeHostRouteExtension[]
    edge?: FreeHostResolvedEdgeBoundary
  }>) {
    this.#service = input.service
    this.#storage = input.storage
    this.#controlHosts = new Set(input.controlHosts.map(normalizePublicHost))
    this.#extensions = Object.freeze([...(input.extensions ?? [])])
    this.#edge = input.edge ?? null
  }

  async route(request: Request): Promise<Response | null> {
    const rawHost = request.headers.get('host')
    if (rawHost === null) return closed('Malformed Host.', 421)
    let normalizedHost: string
    try {
      normalizedHost = normalizePublicHost(rawHost)
    } catch {
      return closed('Malformed Host.', 421)
    }
    if (this.#controlHosts.has(normalizedHost)) return null

    let resolution
    try {
      resolution = await this.#service.resolve(rawHost)
    } catch (error) {
      if (!(error instanceof FreeHostError)) return closed('Host unavailable.', 503)
      return closed('Host not found.', error.code === 'malformed' ? 421 : 404)
    }

    const url = new URL(request.url)
    if (resolution.kind === 'redirect') {
      return redirect(resolution.locationHost, url)
    }
    if (rawHost !== normalizedHost) return redirect(normalizedHost, url)
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const extension = this.#extensions.find((candidate) => candidate.handles(request))
      if (!extension) {
        return new Response('Method not allowed.', {
          status: 405,
          headers: { 'allow': 'GET, HEAD', 'cache-control': 'no-store' },
        })
      }
    }
    for (const extension of this.#extensions) {
      if (!extension.handles(request)) continue
      try {
        const response = await extension.handle(request)
        if (response) return response
      } catch {
        return closed('Route unavailable.', 503)
      }
    }
    if (this.#edge) {
      try { return await this.#edge.serve(request, resolution) }
      catch { return closed('Route unavailable.', 503) }
    }
    if (!resolution.manifest) return closed('Host not found.', 404)
    const artifact = resolveArtifact(resolution.manifest, url.pathname)
    if (!artifact) return closed('Not found.', 404)

    let bytes: Uint8Array
    try {
      bytes = await this.#storage.get({
        organizationId: resolution.host.organizationId,
        workspaceId: resolution.host.workspaceId,
        siteId: resolution.host.siteId,
      }, artifact.objectKey)
    } catch {
      return closed('Not found.', 404)
    }
    if (bytes.byteLength !== artifact.sizeBytes || sha256Hex(bytes) !== artifact.contentHashSha256) {
      return closed('Not found.', 404)
    }
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    return new Response(request.method === 'HEAD' ? null : body, {
      status: 200,
      headers: {
        'content-type': artifact.mimeType,
        'content-length': String(bytes.byteLength),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'x-fuma-release-id': resolution.releaseId,
      },
    })
  }
}

function redirect(host: string, url: URL): Response {
  return new Response(null, {
    status: 308,
    headers: {
      'location': `https://${host}${url.pathname}${url.search}`,
      'cache-control': 'no-store',
    },
  })
}

function closed(message: string, status: number): Response {
  return new Response(message, { status, headers: { 'cache-control': 'no-store' } })
}

function resolveArtifact(manifest: ReleaseManifest, pathname: string): ReleaseArtifact | null {
  let decoded: string
  try { decoded = decodeURIComponent(pathname) } catch { return null }
  if (!/^\/[A-Za-z0-9._/-]*$/.test(decoded)
    || decoded.includes('//') || decoded.includes('/./') || decoded.includes('/../')) return null
  const candidates = decoded === '/'
    ? ['/index.html']
    : decoded.endsWith('/')
      ? [`${decoded}index.html`]
      : decoded.includes('.')
        ? [decoded]
        : [decoded, `${decoded}.html`]
  return manifest.artifacts.find((artifact) => candidates.includes(artifact.logicalPath)) ?? null
}

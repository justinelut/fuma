import type { FreeHostResolution } from '../freeHosts/service'
import type { EdgeDeliveryService, EdgeRequestContext } from './service'

export type EdgeVisitorClaims = Readonly<{
  memberId: string | null
  claims: Readonly<Record<string, string>>
}>
export interface EdgeVisitorAuthority {
  resolve(request: Request, resolution: Extract<FreeHostResolution, { kind: 'release' }>): Promise<EdgeVisitorClaims>
}

function canonicalClaims(claims: Readonly<Record<string, string>>): string {
  return JSON.stringify(Object.entries(claims).toSorted(([left], [right]) => left.localeCompare(right)))
}
function digest(value: string): string { return new Bun.CryptoHasher('sha256').update(value).digest('hex') }

/** Trusted adapter invoked only after FreeHostService resolves the exact active host/release. */
export class FreeHostEdgeBoundary {
  readonly #edge: EdgeDeliveryService
  readonly #visitors: EdgeVisitorAuthority

  constructor(edge: EdgeDeliveryService, visitors: EdgeVisitorAuthority) {
    this.#edge = edge
    this.#visitors = visitors
  }

  async serve(request: Request, resolution: Extract<FreeHostResolution, { kind: 'release' }>): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed.', { status: 405, headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' } })
    }
    const visitor = await this.#visitors.resolve(request, resolution)
    const context: EdgeRequestContext = Object.freeze({
      platformId: resolution.host.platformId,
      organizationId: resolution.host.organizationId,
      workspaceId: resolution.host.workspaceId,
      siteId: resolution.host.siteId,
      ownerKey: resolution.host.ownerKey,
      ownerGeneration: resolution.host.ownerGeneration,
      host: resolution.host.host,
      releaseId: resolution.releaseId,
      path: new URL(request.url).pathname,
      memberId: visitor.memberId,
      accessFingerprint: digest(canonicalClaims(visitor.claims)),
      requestClaims: Object.freeze(structuredClone(visitor.claims)),
    })
    const result = await this.#edge.serve(context, request.headers.get('if-none-match') ?? undefined)
    const headers = new Headers({
      'cache-control': result.cacheControl,
      'content-type': result.contentType,
      'etag': result.etag,
      'x-content-type-options': 'nosniff',
      'x-fuma-release-id': result.releaseId,
    })
    if (result.vary) headers.set('vary', result.vary)
    if (result.status === 200) headers.set('content-length', String(result.body.byteLength))
    const body = request.method === 'HEAD' || result.status === 304
      ? null
      : result.body.buffer.slice(result.body.byteOffset, result.body.byteOffset + result.body.byteLength) as ArrayBuffer
    return new Response(body, { status: result.status, headers })
  }
}

export class AnonymousEdgeVisitorAuthority implements EdgeVisitorAuthority {
  async resolve(): Promise<EdgeVisitorClaims> {
    return Object.freeze({ memberId: null, claims: Object.freeze({ audience: 'anonymous' }) })
  }
}

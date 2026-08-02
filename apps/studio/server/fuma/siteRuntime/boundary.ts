import { SiteApplicationError, type SiteApplicationMutationResponse } from './applicationContracts'
import { SiteRuntimeContractError, type SiteRuntimeResolveResponse } from './contracts'

export const SITE_RUNTIME_PRIVATE_PATH = '/_fuma/private/site-runtime/v1/resolve' as const
export const SITE_RUNTIME_PRIVATE_MUTATION_PATH = '/_fuma/private/site-runtime/v1/mutate' as const
const MAX_REQUEST_BYTES = 128 * 1024

export interface SiteRuntimeAuthorityPort {
  resolve(value: unknown): Promise<SiteRuntimeResolveResponse>
  mutate(value: unknown): Promise<SiteApplicationMutationResponse>
}

export interface SiteRuntimePrivateBoundary {
  handles(request: Request): boolean
  handle(request: Request): Promise<Response | null>
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < length; index += 1) difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  return difference === 0
}

function authorized(request: Request, serviceToken: string): boolean {
  const authorization = request.headers.get('authorization')
  const requestId = request.headers.get('x-fuma-request-id')
  if (!authorization?.startsWith('Bearer ') || request.headers.get('x-fuma-audience') !== 'fuma-site-runtime') return false
  if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return false
  if (request.headers.get('cookie') !== null || request.headers.get('x-forwarded-authorization') !== null) return false
  return constantTimeEqual(authorization.slice(7), serviceToken)
}

function json(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' },
  })
}

async function body(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') throw new TypeError('invalid body')
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) throw new TypeError('invalid body')
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) throw new TypeError('invalid body')
  return JSON.parse(text) as unknown
}

export function createSiteRuntimePrivateBoundary(input: Readonly<{
  host: string
  serviceToken: string
  authority: SiteRuntimeAuthorityPort
}>): SiteRuntimePrivateBoundary {
  const expectedHost = input.host.toLowerCase()
  function handles(request: Request): boolean {
    const path = new URL(request.url).pathname
    return path === SITE_RUNTIME_PRIVATE_PATH || path === SITE_RUNTIME_PRIVATE_MUTATION_PATH
  }
  async function handle(request: Request): Promise<Response | null> {
    if (!handles(request)) return null
    const host = (request.headers.get('host') ?? new URL(request.url).host).toLowerCase()
    if (host !== expectedHost || !authorized(request, input.serviceToken)) return json({ error: 'not_found' }, 404)
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
    let value: unknown
    try { value = await body(request) } catch { return json({ error: 'invalid_request' }, 400) }
    try {
      const path = new URL(request.url).pathname
      return json(path === SITE_RUNTIME_PRIVATE_MUTATION_PATH ? await input.authority.mutate(value) : await input.authority.resolve(value), 200)
    }
    catch (error) {
      if (error instanceof SiteApplicationError) {
        if (error.code === 'invalid') return json({ error: 'invalid_request' }, 400)
        if (error.code === 'unauthenticated') return json({ error: 'authentication_required' }, 401)
        if (error.code === 'stale' || error.code === 'replay') return json({ error: 'mutation_conflict' }, 409)
        if (error.code === 'scope') return json({ error: 'not_found' }, 404)
        if (error.code === 'unsupported') return json({ error: 'unsupported' }, 422)
      }
      if (error instanceof SiteRuntimeContractError) {
        if (error.code === 'invalid-request') return json({ error: 'invalid_request' }, 400)
        if (error.code === 'unknown-host' || error.code === 'route-not-found') return json({ error: 'not_found' }, 404)
        if (error.code === 'stale-release' || error.code === 'incompatible-deployment') return json({ error: 'runtime_conflict' }, 409)
      }
      return json({ error: 'temporarily_unavailable' }, 503)
    }
  }
  return Object.freeze({ handles, handle })
}

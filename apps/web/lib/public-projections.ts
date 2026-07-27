import {
  PublicExpertsEnvelopeSchema,
  PublicExpertsQuerySchema,
  PublicPluginsEnvelopeSchema,
  PublicPluginsQuerySchema,
  PublicPricingCatalogEnvelopeSchema,
  PublicPricingQuerySchema,
  PublicProductFactsEnvelopeSchema,
  PublicProductFactsQuerySchema,
  PublicProjectionResourceSchema,
  PublicShowcasesEnvelopeSchema,
  PublicShowcasesQuerySchema,
  PublicTemplatesEnvelopeSchema,
  PublicTemplatesQuerySchema,
  SafeErrorEnvelopeSchema,
  type PublicProductFactsEnvelope,
  type PublicProjectionResource,
} from '@fuma/public-contracts'
import type { TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { effectivePublicHost } from './public-host'
import { recordProjectionResult } from './metrics'

const PRIVATE_PATH_PREFIX = '/_fuma/private/public/v1'
const PUBLIC_BFF_PATH_PREFIX = '/api/public/v1'
const DEFAULT_TIMEOUT_MS = 3_000
const MAX_RESPONSE_BYTES = 524_288
const DEFAULT_PUBLIC_HOSTS = ['fuma.co.ke', 'www.fuma.co.ke', '3002.blyss.co.ke'] as const
const CACHE_CONTROL: Readonly<Record<PublicProjectionResource, string>> = Object.freeze({
  'product-facts': 'public, max-age=0, s-maxage=30, must-revalidate',
  pricing: 'public, max-age=0, s-maxage=30, must-revalidate',
  templates: 'public, max-age=0, s-maxage=60, must-revalidate',
  showcases: 'no-store',
  experts: 'no-store',
  plugins: 'no-store',
})

const SPECS: Readonly<Record<PublicProjectionResource, Readonly<{
  query: TSchema
  envelope: TSchema
}>>> = Object.freeze({
  'product-facts': { query: PublicProductFactsQuerySchema, envelope: PublicProductFactsEnvelopeSchema },
  pricing: { query: PublicPricingQuerySchema, envelope: PublicPricingCatalogEnvelopeSchema },
  templates: { query: PublicTemplatesQuerySchema, envelope: PublicTemplatesEnvelopeSchema },
  showcases: { query: PublicShowcasesQuerySchema, envelope: PublicShowcasesEnvelopeSchema },
  experts: { query: PublicExpertsQuerySchema, envelope: PublicExpertsEnvelopeSchema },
  plugins: { query: PublicPluginsQuerySchema, envelope: PublicPluginsEnvelopeSchema },
})

export type PublicProjectionClientConfig = Readonly<{
  internalOrigin: string
  serviceToken: string
  publicHosts: readonly string[]
  timeoutMs: number
}>

export type PublicProjectionFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type PublicProjectionClientOptions = Readonly<{
  config?: PublicProjectionClientConfig
  fetchImpl?: PublicProjectionFetch
}>

function safeError(status: number, code: 'invalid_request' | 'not_found' | 'rate_limited' | 'temporarily_unavailable', message: string, retryAfterSeconds?: number): Response {
  const body = {
    error: {
      code,
      message,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    },
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      ...(retryAfterSeconds === undefined ? {} : { 'retry-after': String(retryAfterSeconds) }),
    },
  })
}

function normalizedHost(rawHost: string): string {
  return rawHost.trim().toLowerCase().replace(/\.$/, '').split(':')[0] ?? ''
}

export function readPublicProjectionClientConfig(env: Readonly<Record<string, string | undefined>> = process.env): PublicProjectionClientConfig {
  const rawOrigin = env.FUMA_PUBLIC_PROJECTION_INTERNAL_ORIGIN?.trim()
  const serviceToken = env.FUMA_PUBLIC_PROJECTION_SERVICE_TOKEN?.trim()
  if (!rawOrigin || !serviceToken || serviceToken.length < 32 || serviceToken.length > 256) {
    throw new Error('Private public-projection configuration is unavailable.')
  }

  let origin: URL
  try {
    origin = new URL(rawOrigin)
  } catch {
    throw new Error('Private public-projection configuration is invalid.')
  }
  if (
    !['http:', 'https:'].includes(origin.protocol)
    || origin.username !== ''
    || origin.password !== ''
    || origin.pathname !== '/'
    || origin.search !== ''
    || origin.hash !== ''
  ) {
    throw new Error('Private public-projection configuration is invalid.')
  }

  const configuredHosts = env.FUMA_PUBLIC_WEB_HOSTS?.split(',').map(normalizedHost).filter(Boolean)
  const publicHosts = [...new Set(configuredHosts?.length ? configuredHosts : DEFAULT_PUBLIC_HOSTS)]
  const allowedPublicHosts = new Set<string>(DEFAULT_PUBLIC_HOSTS)
  if (publicHosts.some((host) => !allowedPublicHosts.has(host))) {
    throw new Error('Public Web host configuration is invalid.')
  }
  const internalHost = normalizedHost(origin.hostname)
  if (publicHosts.includes(internalHost) || internalHost.endsWith('.fuma.co.ke')) {
    throw new Error('Public projection origin must be private-cluster only.')
  }

  const rawTimeout = env.FUMA_PUBLIC_PROJECTION_TIMEOUT_MS
  const timeoutMs = rawTimeout === undefined ? DEFAULT_TIMEOUT_MS : Number(rawTimeout)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) {
    throw new Error('Private public-projection timeout is invalid.')
  }

  return Object.freeze({
    internalOrigin: origin.origin,
    serviceToken,
    publicHosts: Object.freeze(publicHosts),
    timeoutMs,
  })
}

function parseQuery(resource: PublicProjectionResource, searchParams: URLSearchParams): URLSearchParams | null {
  const candidate: Record<string, string | number> = {}
  const normalized = new URLSearchParams()
  const seen = new Set<string>()
  for (const [key, value] of searchParams) {
    if (seen.has(key)) return null
    seen.add(key)
    if (key === 'limit') {
      if (!/^[1-9][0-9]{0,2}$/.test(value)) return null
      candidate[key] = Number(value)
    } else {
      candidate[key] = value
    }
  }
  if (!Value.Check(SPECS[resource].query, candidate)) return null
  for (const key of [...seen].sort()) normalized.set(key, String(candidate[key]))
  return normalized
}

function parseResource(pathname: string): PublicProjectionResource | null {
  if (!pathname.startsWith(`${PUBLIC_BFF_PATH_PREFIX}/`)) return null
  const resource = pathname.slice(PUBLIC_BFF_PATH_PREFIX.length + 1)
  return Value.Check(PublicProjectionResourceSchema, resource) ? resource : null
}

async function boundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new Error('Oversized public projection.')
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new Error('Oversized public projection.')
  return JSON.parse(text) as unknown
}

function safeRetryAfter(value: string | null): number | undefined {
  if (value === null || !/^[1-9][0-9]{0,3}$/.test(value)) return undefined
  const seconds = Number(value)
  return seconds <= 3_600 ? seconds : undefined
}

function responseHeaders(
  resource: PublicProjectionResource,
  upstream: Response,
  envelope?: Readonly<{ meta: Readonly<{ etag: string; datasetVersion: string }> }>,
  conditionalEtag?: string,
): Headers {
  const headers = new Headers({
    'cache-control': envelope || conditionalEtag ? CACHE_CONTROL[resource] : 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  const etag = envelope?.meta.etag ?? conditionalEtag
  if (etag) headers.set('etag', etag)
  if (envelope) headers.set('x-fuma-dataset-version', envelope.meta.datasetVersion)
  const retryAfter = safeRetryAfter(upstream.headers.get('retry-after'))
  if (retryAfter !== undefined) headers.set('retry-after', String(retryAfter))
  return headers
}

async function fetchPublicProjectionUninstrumented(
  resource: PublicProjectionResource,
  query: URLSearchParams = new URLSearchParams(),
  ifNoneMatch: string | null = null,
  options: PublicProjectionClientOptions = {},
): Promise<Response> {
  if (ifNoneMatch !== null && !/^(?:W\/)?"[^"\r\n]{1,156}"$/.test(ifNoneMatch)) {
    return safeError(400, 'invalid_request', 'Invalid conditional request metadata.')
  }
  const config = options.config ?? readPublicProjectionClientConfig()
  const normalizedQuery = parseQuery(resource, query)
  if (!normalizedQuery) return safeError(400, 'invalid_request', 'Invalid public projection filters.')

  const target = new URL(`${PRIVATE_PATH_PREFIX}/${resource}`, config.internalOrigin)
  target.search = normalizedQuery.toString()
  const headers = new Headers({
    accept: 'application/json',
    authorization: `Bearer ${config.serviceToken}`,
    'x-fuma-audience': 'fuma-public-web',
    'x-fuma-request-id': crypto.randomUUID(),
  })
  if (ifNoneMatch) headers.set('if-none-match', ifNoneMatch)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  let upstream: Response
  try {
    upstream = await (options.fetchImpl ?? fetch)(target, {
      method: 'GET',
      headers,
      redirect: 'error',
      signal: controller.signal,
    })
  } catch {
    return safeError(503, 'temporarily_unavailable', 'Public data is temporarily unavailable.', 30)
  } finally {
    clearTimeout(timer)
  }

  if (upstream.status === 304) {
    const etag = upstream.headers.get('etag')
    if (!etag || etag !== ifNoneMatch) return safeError(503, 'temporarily_unavailable', 'Public data is temporarily unavailable.')
    return new Response(null, { status: 304, headers: responseHeaders(resource, upstream, undefined, etag) })
  }

  if (upstream.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return safeError(503, 'temporarily_unavailable', 'Public data is temporarily unavailable.')
  }

  let body: unknown
  try {
    body = await boundedJson(upstream)
  } catch {
    return safeError(503, 'temporarily_unavailable', 'Public data is temporarily unavailable.')
  }

  if (upstream.status === 200) {
    const schema = SPECS[resource].envelope
    if (!Value.Check(schema, body)) return safeError(503, 'temporarily_unavailable', 'Public data is temporarily unavailable.')
    const envelope = body as Readonly<{ meta: Readonly<{ etag: string; datasetVersion: string }> }>
    if (upstream.headers.get('etag') !== envelope.meta.etag) {
      return safeError(503, 'temporarily_unavailable', 'Public data is temporarily unavailable.')
    }
    return new Response(JSON.stringify(body), { status: 200, headers: responseHeaders(resource, upstream, envelope) })
  }

  if (![400, 404, 429, 503].includes(upstream.status) || !Value.Check(SafeErrorEnvelopeSchema, body)) {
    return safeError(503, 'temporarily_unavailable', 'Public data is temporarily unavailable.')
  }
  const error = body as { error: { code: string; message: string; retryAfterSeconds?: number } }
  if (
    (upstream.status === 400 && error.error.code !== 'invalid_request')
    || (upstream.status === 404 && error.error.code !== 'not_found')
    || (upstream.status === 429 && error.error.code !== 'rate_limited')
    || (upstream.status === 503 && error.error.code !== 'temporarily_unavailable')
  ) {
    return safeError(503, 'temporarily_unavailable', 'Public data is temporarily unavailable.')
  }
  return new Response(JSON.stringify(body), { status: upstream.status, headers: responseHeaders(resource, upstream) })
}

export async function fetchPublicProjection(
  resource: PublicProjectionResource,
  query: URLSearchParams = new URLSearchParams(),
  ifNoneMatch: string | null = null,
  options: PublicProjectionClientOptions = {},
): Promise<Response> {
  let response: Response
  try {
    response = await fetchPublicProjectionUninstrumented(resource, query, ifNoneMatch, options)
  } catch {
    response = safeError(503, 'temporarily_unavailable', 'Public data is temporarily unavailable.', 30)
  }
  recordProjectionResult(resource, response.status)
  return response
}

export async function handlePublicProjectionBff(request: Request, options: PublicProjectionClientOptions = {}): Promise<Response> {
  let config: PublicProjectionClientConfig
  try {
    config = options.config ?? readPublicProjectionClientConfig()
  } catch {
    return safeError(503, 'temporarily_unavailable', 'Public data is temporarily unavailable.')
  }
  const url = new URL(request.url)
  const host = effectivePublicHost(request.headers, url.host)
  if (!config.publicHosts.includes(host)) return safeError(404, 'not_found', 'Resource not found.')
  if (request.method !== 'GET') return safeError(404, 'not_found', 'Resource not found.')
  const resource = parseResource(url.pathname)
  if (!resource) return safeError(404, 'not_found', 'Resource not found.')
  return fetchPublicProjection(resource, url.searchParams, request.headers.get('if-none-match'), {
    ...options,
    config,
  })
}

export async function readProductFactsForPresentation(
  query: URLSearchParams = new URLSearchParams(),
  options: PublicProjectionClientOptions = {},
): Promise<PublicProductFactsEnvelope | null> {
  let response: Response
  try { response = await fetchPublicProjection('product-facts', query, null, options) } catch { return null }
  if (!response.ok) return null
  const value = await boundedJson(response)
  return Value.Check(PublicProductFactsEnvelopeSchema, value) ? value : null
}

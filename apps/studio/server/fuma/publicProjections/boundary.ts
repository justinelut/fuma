import {
  ContactRequestSchema,
  PublicDatasetVersionSchema,
  PublicProjectionResourceSchema,
  SafeErrorEnvelopeSchema,
  type ContactRequest,
  type PublicProjectionResource,
} from '@fuma/public-contracts'
import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { safeParseJson } from '@core/utils/jsonValidate'
import type { FumaLimitDecision, FumaLimitRequest } from '../redis'
import type { PublicContactSink } from './contact'
import type { PublicProjectionAuthority } from './authority'
import { PublicProjectionInvalidRequestError } from './authority'
import {
  PUBLIC_PROJECTION_PATH_PREFIX,
  PUBLIC_PROJECTION_RATE_LIMIT,
  PUBLIC_PROJECTION_SPECS,
} from './specs'

export interface PublicProjectionCoordination {
  consumeLimit(key: string, request: FumaLimitRequest): Promise<FumaLimitDecision>
  cacheGet(key: string): Promise<string | null>
  cacheSet(key: string, value: string, ttlMs: number): Promise<boolean>
}

export type PublicProjectionBoundaryInput = Readonly<{
  host: string
  serviceToken: string
  authority: PublicProjectionAuthority
  coordination: PublicProjectionCoordination
  contact?: PublicContactSink
  nowMs?: () => number
}>

export interface PublicProjectionBoundary {
  handles(request: Request): boolean
  handle(request: Request): Promise<Response | null>
}

const SOURCE_RESULT_SCHEMAS: Readonly<Record<PublicProjectionResource, ReturnType<typeof Type.Object>>> = Object.freeze({
  'product-facts': Type.Object({ datasetVersion: PublicDatasetVersionSchema, data: PUBLIC_PROJECTION_SPECS['product-facts'].pageSchema }, { additionalProperties: false }),
  pricing: Type.Object({ datasetVersion: PublicDatasetVersionSchema, data: PUBLIC_PROJECTION_SPECS.pricing.pageSchema }, { additionalProperties: false }),
  templates: Type.Object({ datasetVersion: PublicDatasetVersionSchema, data: PUBLIC_PROJECTION_SPECS.templates.pageSchema }, { additionalProperties: false }),
  showcases: Type.Object({ datasetVersion: PublicDatasetVersionSchema, data: PUBLIC_PROJECTION_SPECS.showcases.pageSchema }, { additionalProperties: false }),
  experts: Type.Object({ datasetVersion: PublicDatasetVersionSchema, data: PUBLIC_PROJECTION_SPECS.experts.pageSchema }, { additionalProperties: false }),
  plugins: Type.Object({ datasetVersion: PublicDatasetVersionSchema, data: PUBLIC_PROJECTION_SPECS.plugins.pageSchema }, { additionalProperties: false }),
  components: Type.Object({ datasetVersion: PublicDatasetVersionSchema, data: PUBLIC_PROJECTION_SPECS.components.pageSchema }, { additionalProperties: false }),
})

const PUBLIC_CONTACT_PATH = `${PUBLIC_PROJECTION_PATH_PREFIX}/contact`
const PUBLIC_CONTACT_BODY_BYTES = 8_192
const PUBLIC_CONTACT_RATE_LIMIT = Object.freeze({ limit: 120, windowMs: 60_000 })

function safeError(
  status: number,
  code: 'invalid_request' | 'not_found' | 'rate_limited' | 'temporarily_unavailable',
  message: string,
  retryAfterSeconds?: number,
): Response {
  const candidate = {
    error: {
      code,
      message,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    },
  }
  if (!Value.Check(SafeErrorEnvelopeSchema, candidate)) {
    throw new Error('Public projection produced an invalid safe error.')
  }
  const headers = new Headers({
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  if (retryAfterSeconds !== undefined) headers.set('retry-after', String(retryAfterSeconds))
  return new Response(JSON.stringify(candidate), { status, headers })
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return difference === 0
}

function authorized(request: Request, serviceToken: string): boolean {
  const authorization = request.headers.get('authorization')
  const requestId = request.headers.get('x-fuma-request-id')
  if (!authorization?.startsWith('Bearer ')) return false
  if (request.headers.get('x-fuma-audience') !== 'fuma-public-web') return false
  if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return false
  if (request.headers.has('cookie') || request.headers.has('x-forwarded-authorization')) return false
  return constantTimeEqual(authorization.slice('Bearer '.length), serviceToken)
}

async function contactValue(request: Request): Promise<ContactRequest | null> {
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') return null
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > PUBLIC_CONTACT_BODY_BYTES) return null
  let text: string
  try { text = await request.text() } catch { return null }
  if (new TextEncoder().encode(text).byteLength > PUBLIC_CONTACT_BODY_BYTES) return null
  let value: unknown
  try { value = JSON.parse(text) as unknown } catch { return null }
  return Value.Check(ContactRequestSchema, value) ? value : null
}

function contactAccepted(): Response {
  return new Response(null, { status: 202, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
}

function parseResource(pathname: string): PublicProjectionResource | null {
  const suffix = pathname.slice(PUBLIC_PROJECTION_PATH_PREFIX.length)
  if (!/^\/[a-z-]+$/.test(suffix)) return null
  const resource = suffix.slice(1)
  return Value.Check(PublicProjectionResourceSchema, resource) ? resource : null
}

function parseQuery(resource: PublicProjectionResource, searchParams: URLSearchParams): Readonly<Record<string, string | number>> | null {
  const candidate: Record<string, string | number> = {}
  const seen = new Set<string>()
  for (const [key, rawValue] of searchParams) {
    if (seen.has(key)) return null
    seen.add(key)
    if (key === 'limit') {
      if (!/^[1-9][0-9]{0,2}$/.test(rawValue)) return null
      candidate[key] = Number(rawValue)
    } else {
      candidate[key] = rawValue
    }
  }
  if (!Value.Check(PUBLIC_PROJECTION_SPECS[resource].querySchema, candidate)) return null
  return Object.freeze(candidate)
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

async function etagFor(data: unknown, datasetVersion: string): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson({ schemaVersion: 1, datasetVersion, data }))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return `"${[...digest].map((value) => value.toString(16).padStart(2, '0')).join('')}"`
}

function canonicalQuery(query: Readonly<Record<string, string | number>>): string {
  return Object.keys(query).sort().map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(query[key]))}`).join('&')
}

function hasUniquePublicIds(data: unknown): boolean {
  if (typeof data !== 'object' || data === null || !('items' in data)) return false
  const items = (data as { items: unknown }).items
  if (!Array.isArray(items)) return false
  const ids = new Set<string>()
  for (const item of items) {
    if (typeof item !== 'object' || item === null || !('id' in item) || typeof (item as { id: unknown }).id !== 'string') return false
    const id = (item as { id: string }).id
    if (ids.has(id)) return false
    ids.add(id)
  }
  return true
}

function responseForEnvelope(
  envelope: unknown,
  cacheControl: string,
  ifNoneMatch: string | null,
): Response {
  const validatedEnvelope = envelope as Readonly<{ meta: Readonly<{ etag: string }> }>
  const headers = new Headers({
    'cache-control': cacheControl,
    'content-type': 'application/json; charset=utf-8',
    etag: validatedEnvelope.meta.etag,
  })
  if (ifNoneMatch === validatedEnvelope.meta.etag) return new Response(null, { status: 304, headers })
  return new Response(JSON.stringify(envelope), { status: 200, headers })
}

/** Private-cluster, anonymous-data boundary. It never derives visitor or staff authority. */
export function createPublicProjectionBoundary(input: PublicProjectionBoundaryInput): PublicProjectionBoundary {
  const expectedHost = input.host.toLowerCase()

  function handles(request: Request): boolean {
    const pathname = new URL(request.url).pathname
    return pathname === PUBLIC_PROJECTION_PATH_PREFIX || pathname.startsWith(`${PUBLIC_PROJECTION_PATH_PREFIX}/`)
  }

  async function handle(request: Request): Promise<Response | null> {
    if (!handles(request)) return null
    const url = new URL(request.url)
    const host = (request.headers.get('host') ?? url.host).toLowerCase()
    if (host !== expectedHost || !authorized(request, input.serviceToken)) {
      return safeError(404, 'not_found', 'Resource not found.')
    }
    if (url.pathname === PUBLIC_CONTACT_PATH) {
      if (request.method !== 'POST') {
        const response = safeError(405, 'invalid_request', 'Method not allowed.')
        response.headers.set('allow', 'POST')
        return response
      }
      if (url.search !== '') return safeError(400, 'invalid_request', 'Invalid contact request.')
      const value = await contactValue(request)
      if (!value) return safeError(400, 'invalid_request', 'Invalid contact request.')
      let decision: FumaLimitDecision
      try { decision = await input.coordination.consumeLimit('public-contact', PUBLIC_CONTACT_RATE_LIMIT) }
      catch { return safeError(503, 'temporarily_unavailable', 'Contact routing is temporarily unavailable.', 30) }
      if (!decision.allowed) return safeError(429, 'rate_limited', 'Try again shortly.', Math.max(1, Math.min(3_600, Math.ceil(decision.retryAfterMs / 1_000))))
      if (!input.contact || !await input.contact.accept(value)) return safeError(503, 'temporarily_unavailable', 'Contact routing is temporarily unavailable.', 30)
      return contactAccepted()
    }
    if (request.method !== 'GET') {
      const response = safeError(405, 'invalid_request', 'Method not allowed.')
      response.headers.set('allow', 'GET')
      return response
    }

    const resource = parseResource(url.pathname)
    if (!resource) return safeError(404, 'not_found', 'Resource not found.')
    const query = parseQuery(resource, url.searchParams)
    if (!query) return safeError(400, 'invalid_request', 'Invalid public projection filters.')

    let limitDecision: FumaLimitDecision
    try {
      limitDecision = await input.coordination.consumeLimit(
        `public-projection:${resource}`,
        PUBLIC_PROJECTION_RATE_LIMIT,
      )
    } catch {
      return safeError(503, 'temporarily_unavailable', 'Public data is temporarily unavailable.', 30)
    }
    if (!limitDecision.allowed) {
      const retryAfter = Math.max(1, Math.min(3_600, Math.ceil(limitDecision.retryAfterMs / 1_000)))
      return safeError(429, 'rate_limited', 'Try again shortly.', retryAfter)
    }

    const spec = PUBLIC_PROJECTION_SPECS[resource]
    const queryKey = canonicalQuery(query)
    const cacheKey = `public-projection:${resource}:${queryKey || '-'}`
    if (spec.cacheTtlMs > 0) {
      try {
        const cached = await input.coordination.cacheGet(cacheKey)
        if (cached !== null) {
          const parsed = safeParseJson(cached, spec.envelopeSchema)
          if (parsed.ok) {
            return responseForEnvelope(parsed.value, spec.cacheControl, request.headers.get('if-none-match'))
          }
        }
      } catch {
        // Public projection cache is optional. Authority remains the fallback.
      }
    }

    let sourceValue: unknown
    try {
      sourceValue = await input.authority.read({ resource, query })
    } catch (error) {
      if (error instanceof PublicProjectionInvalidRequestError) {
        return safeError(400, 'invalid_request', 'Invalid public projection filters.')
      }
      return safeError(503, 'temporarily_unavailable', 'Public data is temporarily unavailable.', 30)
    }
    const sourceSchema = SOURCE_RESULT_SCHEMAS[resource]
    if (!Value.Check(sourceSchema, sourceValue)) {
      return safeError(503, 'temporarily_unavailable', 'Public data is temporarily unavailable.')
    }
    const source = sourceValue as { datasetVersion: string; data: unknown }
    if (!hasUniquePublicIds(source.data)) {
      return safeError(503, 'temporarily_unavailable', 'Public data is temporarily unavailable.')
    }
    const envelope = {
      data: source.data,
      meta: {
        schemaVersion: 1 as const,
        datasetVersion: source.datasetVersion,
        etag: await etagFor(source.data, source.datasetVersion),
      },
    }
    if (!Value.Check(spec.envelopeSchema, envelope)) {
      return safeError(503, 'temporarily_unavailable', 'Public data is temporarily unavailable.')
    }

    if (spec.cacheTtlMs > 0) {
      try {
        await input.coordination.cacheSet(cacheKey, JSON.stringify(envelope), spec.cacheTtlMs)
      } catch {
        // Cache write failure must not replace validated authority data.
      }
    }
    return responseForEnvelope(envelope, spec.cacheControl, request.headers.get('if-none-match'))
  }

  return Object.freeze({ handles, handle })
}

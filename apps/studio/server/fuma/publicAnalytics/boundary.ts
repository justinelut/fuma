import { PublicAcquisitionEventSchema } from '@fuma/public-contracts'
import { Value } from '@sinclair/typebox/value'
import {
  PublicMarketingCollectionContextSchema,
  PublicMarketingCollectionResultSchema,
} from '@core/fuma/publicAnalytics/contracts'
import type { PublicMarketingAnalyticsService } from './service'

export const PUBLIC_MARKETING_COLLECTOR_PATH = '/_fuma/private/public/v1/acquisition-events' as const
const MAX_BODY_BYTES = 4_096

export interface PublicMarketingAnalyticsBoundary {
  handles(request: Request): boolean
  handle(request: Request): Promise<Response | null>
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return difference === 0
}

function response(value: unknown, status: number): Response {
  return new Response(value === null ? null : JSON.stringify(value), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  })
}

function authorized(request: Request, token: string): boolean {
  const authorization = request.headers.get('authorization')
  const requestId = request.headers.get('x-fuma-request-id')
  return authorization?.startsWith('Bearer ') === true
    && constantTimeEqual(authorization.slice('Bearer '.length), token)
    && request.headers.get('x-fuma-audience') === 'fuma-public-web'
    && requestId !== null
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
    && !request.headers.has('cookie')
    && !request.headers.has('x-forwarded-authorization')
}

async function boundedJson(request: Request): Promise<unknown | null> {
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') return null
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null
  let text: string
  try { text = await request.text() } catch { return null }
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null
  try { return JSON.parse(text) as unknown } catch { return null }
}

/** This boundary reuses the existing private Web service credential; it creates no visitor/session authority. */
export function createPublicMarketingAnalyticsBoundary(input: Readonly<{
  host: string
  serviceToken: string
  service: Pick<PublicMarketingAnalyticsService, 'collectPublic'>
  now?: () => Date
}>): PublicMarketingAnalyticsBoundary {
  const expectedHost = input.host.toLowerCase()
  const now = input.now ?? (() => new Date())

  function handles(request: Request): boolean {
    return new URL(request.url).pathname === PUBLIC_MARKETING_COLLECTOR_PATH
  }

  async function handle(request: Request): Promise<Response | null> {
    if (!handles(request)) return null
    const url = new URL(request.url)
    const hostHeader = request.headers.get('host')
    if (url.host.toLowerCase() !== expectedHost
      || (hostHeader !== null && hostHeader.toLowerCase() !== expectedHost)
      || !authorized(request, input.serviceToken)) return response(null, 404)
    if (request.method !== 'POST') return response({ error: 'method_not_allowed' }, 405)
    if (url.search !== '') return response({ error: 'invalid_request' }, 400)
    const value = await boundedJson(request)
    if (!Value.Check(PublicAcquisitionEventSchema, value)) return response({ error: 'invalid_request' }, 400)
    const receivedAt = now()
    const context = {
      receivedAt: Number.isFinite(receivedAt.getTime()) ? receivedAt.toISOString() : '',
      globalPrivacyControl: request.headers.get('x-fuma-gpc') === '1',
      doNotTrack: request.headers.get('x-fuma-dnt') === '1',
      traffic: request.headers.get('x-fuma-traffic'),
    }
    if (!Value.Check(PublicMarketingCollectionContextSchema, context)) return response({ error: 'invalid_request' }, 400)
    try {
      const result = await input.service.collectPublic(value, context)
      if (!Value.Check(PublicMarketingCollectionResultSchema, result)) throw new Error('Invalid analytics collection result.')
      return response(result, 202)
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      if (code === 'invalid-event' || code === 'invalid-context') return response({ error: 'invalid_request' }, 400)
      return response({ error: 'temporarily_unavailable' }, 503)
    }
  }

  return Object.freeze({ handles, handle })
}

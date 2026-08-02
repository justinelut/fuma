import {
  PublicAcquisitionEventSchema,
  PublicHandoffEnvelopeSchema,
  PublicHandoffRequestSchema,
  type PublicHandoffRequest,
} from '@fuma/public-contracts'
import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { ContactRequestSchema, type ContactRequest } from './public-web-contracts'
import { FUMA_WEB_DEPLOYMENT } from './deployment-profile'
import {
  ContactRoutingReceiptSchema,
  type ContactRoutingResult,
} from './contact-boundary'
import {
  readPublicProjectionClientConfig,
  type PublicProjectionClientConfig,
  type PublicProjectionFetch,
} from './public-projections'

const MAX_BYTES = 16_384
const APP_ORIGIN = FUMA_WEB_DEPLOYMENT.origins.product
const ContactRoutingBridgeResponseSchema = Type.Object({
  outcome: Type.Literal('accepted'),
  receipt: ContactRoutingReceiptSchema,
}, { additionalProperties: false })

export type PrivateBridgeOptions = Readonly<{
  config?: PublicProjectionClientConfig
  fetchImpl?: PublicProjectionFetch
}>

function config(options: PrivateBridgeOptions = {}) {
  return options.config ?? readPublicProjectionClientConfig()
}

async function requestPrivate(
  path: string,
  body: unknown,
  options: PrivateBridgeOptions = {},
  internalHeaders: Readonly<Record<string, string>> = {},
): Promise<Response> {
  const value = config(options)
  return (options.fetchImpl ?? fetch)(new URL(path, value.internalOrigin), {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${value.serviceToken}`,
      'x-fuma-audience': 'fuma-public-web',
      'x-fuma-request-id': crypto.randomUUID(),
      ...internalHeaders,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(value.timeoutMs),
  })
}

async function json(response: Response): Promise<unknown> {
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error('oversize')
  return JSON.parse(text) as unknown
}

export async function issueHandoff(value: unknown, options: PrivateBridgeOptions = {}): Promise<{ redirectUrl: string } | null> {
  if (!Value.Check(PublicHandoffRequestSchema, value)) return null
  try {
    const response = await requestPrivate('/_fuma/private/public/v1/handoff', value as PublicHandoffRequest, options)
    const body = await json(response)
    if (!response.ok || !Value.Check(PublicHandoffEnvelopeSchema, body)) return null
    const envelope = body as { data: { intent: string; correlation: string; expiresAt: string } }
    if (Date.parse(envelope.data.expiresAt) <= Date.now()) return null
    const target = new URL('/resume', APP_ORIGIN)
    target.searchParams.set('intent', envelope.data.intent)
    target.searchParams.set('correlation', envelope.data.correlation)
    return { redirectUrl: target.toString() }
  } catch {
    return null
  }
}

export async function forwardContact(
  value: unknown,
  requestSha256: string,
  options: PrivateBridgeOptions = {},
): Promise<ContactRoutingResult> {
  if (!Value.Check(ContactRequestSchema, value) || !/^[a-f0-9]{64}$/.test(requestSha256)) {
    return { outcome: 'unavailable' }
  }
  try {
    const response = await requestPrivate('/_fuma/private/public/v1/contact', value as ContactRequest, options, {
      'x-fuma-request-sha256': requestSha256,
    })
    if (response.status === 202) {
      const body = await json(response)
      return Value.Check(ContactRoutingBridgeResponseSchema, body)
        ? body as ContactRoutingResult
        : { outcome: 'unavailable' }
    }
    if (response.status === 409) return { outcome: 'conflict' }
    if (response.status === 429) {
      const raw = response.headers.get('retry-after')
      const retryAfterSeconds = raw && /^[1-9][0-9]{0,3}$/.test(raw) ? Number(raw) : 30
      return { outcome: 'rate_limited', retryAfterSeconds: Math.min(3_600, retryAfterSeconds) }
    }
    return { outcome: 'unavailable' }
  } catch {
    return { outcome: 'unavailable' }
  }
}

export async function requestPrivateStatus(options: PrivateBridgeOptions = {}): Promise<Response | null> {
  try {
    const value = config(options)
    return await (options.fetchImpl ?? fetch)(new URL('/_fuma/private/public/v1/status', value.internalOrigin), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${value.serviceToken}`,
        'x-fuma-audience': 'fuma-public-web',
        'x-fuma-request-id': crypto.randomUUID(),
      },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(value.timeoutMs),
    })
  } catch {
    return null
  }
}

export type PublicAcquisitionPrivacy = Readonly<{
  globalPrivacyControl: boolean
  doNotTrack: boolean
  traffic: 'human' | 'known-bot' | 'internal'
}>

export async function collectAcquisition(
  value: unknown,
  privacy: PublicAcquisitionPrivacy,
  options: PrivateBridgeOptions = {},
): Promise<boolean> {
  if (!Value.Check(PublicAcquisitionEventSchema, value)) return false
  try {
    const response = await requestPrivate('/_fuma/private/public/v1/acquisition-events', value, options, {
      'x-fuma-gpc': privacy.globalPrivacyControl ? '1' : '0',
      'x-fuma-dnt': privacy.doNotTrack ? '1' : '0',
      'x-fuma-traffic': privacy.traffic,
    })
    return response.status === 202
  } catch {
    return false
  }
}

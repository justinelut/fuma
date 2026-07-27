import {
  PublicAcquisitionEventSchema,
  PublicHandoffEnvelopeSchema,
  PublicHandoffRequestSchema,
  type PublicHandoffRequest,
} from '@fuma/public-contracts'
import { Value } from '@sinclair/typebox/value'
import {
  ContactRequestSchema,
  PublicStatusSchema,
  type ContactRequest,
  type PublicStatus,
} from './public-web-contracts'
import {
  readPublicProjectionClientConfig,
  type PublicProjectionClientConfig,
  type PublicProjectionFetch,
} from './public-projections'

const MAX_BYTES = 16_384
const APP_ORIGIN = 'https://app.fuma.co.ke' as const
const STATUS_ORIGIN = 'https://status.fuma.co.ke' as const

type PrivateBridgeOptions = Readonly<{
  config?: PublicProjectionClientConfig
  fetchImpl?: PublicProjectionFetch
}>

function config(options: PrivateBridgeOptions = {}) {
  return options.config ?? readPublicProjectionClientConfig()
}

async function requestPrivate(path: string, body: unknown, options: PrivateBridgeOptions = {}): Promise<Response> {
  const value = config(options)
  return (options.fetchImpl ?? fetch)(new URL(path, value.internalOrigin), {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${value.serviceToken}`,
      'x-fuma-audience': 'fuma-public-web',
      'x-fuma-request-id': crypto.randomUUID(),
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

export async function forwardContact(value: unknown): Promise<boolean> {
  if (!Value.Check(ContactRequestSchema, value)) return false
  try {
    const response = await requestPrivate('/_fuma/private/public/v1/contact', value as ContactRequest)
    return response.status === 202
  } catch {
    return false
  }
}

export async function collectAcquisition(value: unknown): Promise<boolean> {
  if (!Value.Check(PublicAcquisitionEventSchema, value)) return false
  try {
    const response = await requestPrivate('/_fuma/private/public/v1/acquisition-events', value)
    return response.status === 202
  } catch {
    return false
  }
}

export async function readPublicStatus(): Promise<PublicStatus> {
  try {
    const response = await fetch(STATUS_ORIGIN + '/api/summary', {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(2_000),
    })
    const value = await json(response)
    if (response.ok && Value.Check(PublicStatusSchema, value)) return value as PublicStatus
  } catch {
    // The public status surface degrades to an explicit unknown state.
  }
  return {
    status: 'unknown',
    message: 'Live status is temporarily unavailable. Check the independent status page for updates.',
    checkedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  }
}

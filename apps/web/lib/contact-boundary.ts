import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

import type { ContactRequest } from './public-web-contracts'
import { isSameOriginPublicRequest, readBoundedJson } from './public-request'

const CONTACT_BODY_LIMIT = 8_192
const CONTACT_WINDOW_MS = 10 * 60 * 1_000
const CONTACT_REPLAY_MS = 24 * 60 * 60 * 1_000
const MINIMUM_FORM_AGE_MS = 1_000
const MAXIMUM_FORM_AGE_MS = 2 * 60 * 60 * 1_000
const CONTACT_LIMIT = 5
const MAXIMUM_RETENTION_MS = 400 * 24 * 60 * 60 * 1_000

export const CONTACT_NOTICE_VERSION = '2026-07-26' as const

const Timestamp = Type.String({
  minLength: 20,
  maxLength: 20,
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$',
})

const ContactFormBase = {
  name: Type.String({
    minLength: 1,
    maxLength: 100,
    pattern: '^[^<>\\u0000-\\u001F\\u007F]+$',
  }),
  email: Type.String({
    minLength: 3,
    maxLength: 254,
    pattern: '^[^\\s@<>\\u0000-\\u001F\\u007F]+@[^\\s@<>\\u0000-\\u001F\\u007F]+\\.[^\\s@<>\\u0000-\\u001F\\u007F]+$',
  }),
  message: Type.String({
    minLength: 10,
    maxLength: 4_000,
    pattern: '^[^\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]+$',
  }),
  consentVersion: Type.Literal(CONTACT_NOTICE_VERSION),
  replayToken: Type.String({ minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' }),
  startedAt: Timestamp,
  website: Type.Literal(''),
} as const

export const ContactFormRequestSchema = Type.Union([
  Type.Object({
    kind: Type.Union([
      Type.Literal('general'),
      Type.Literal('security'),
      Type.Literal('privacy'),
      Type.Literal('abuse'),
    ]),
    ...ContactFormBase,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('expert_inquiry'),
    ...ContactFormBase,
    expertId: Type.String({
      minLength: 1,
      maxLength: 96,
      pattern: '^[a-z0-9](?:[a-z0-9._-]{0,94}[a-z0-9])?$',
    }),
  }, { additionalProperties: false }),
])

export type ContactFormRequest = Static<typeof ContactFormRequestSchema>

export const ContactRoutingReceiptSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  disposition: Type.Union([Type.Literal('accepted'), Type.Literal('replayed')]),
  receiptId: Type.String({ minLength: 16, maxLength: 160, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]+$' }),
  replayToken: Type.String({ minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' }),
  requestSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  routedAs: Type.Union([
    Type.Literal('general'),
    Type.Literal('security'),
    Type.Literal('privacy'),
    Type.Literal('abuse'),
    Type.Literal('expert_inquiry'),
  ]),
  acceptedAt: Timestamp,
  deleteAfter: Timestamp,
  retentionPolicyVersion: Type.String({ minLength: 1, maxLength: 80, pattern: '^[0-9A-Za-z._-]+$' }),
  auditProjection: Type.Literal('metadata-only'),
}, { additionalProperties: false })

export type ContactRoutingReceipt = Readonly<Static<typeof ContactRoutingReceiptSchema>>
export type ContactRoutingResult =
  | Readonly<{ outcome: 'accepted'; receipt: ContactRoutingReceipt }>
  | Readonly<{ outcome: 'conflict' }>
  | Readonly<{ outcome: 'rate_limited'; retryAfterSeconds: number }>
  | Readonly<{ outcome: 'unavailable' }>

type ContactForwarder = (submission: ContactRequest, requestSha256: string) => Promise<ContactRoutingResult | boolean>
type ContactClock = () => number

type ReplayEntry = Readonly<{ fingerprint: string; expiresAt: number }>
type BoundaryState = {
  rates: Map<string, number[]>
  replay: Map<string, ReplayEntry>
}

type ContactBoundaryOptions = Readonly<{
  forward: ContactForwarder
  now?: ContactClock
  limit?: number
  windowMs?: number
  replayMs?: number
}>

const RESPONSE_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
})

function response(status: number, error?: string, retryAfter?: number): Response {
  const headers: Record<string, string> = { ...RESPONSE_HEADERS }
  if (retryAfter !== undefined) headers['retry-after'] = String(retryAfter)
  return error === undefined
    ? new Response(null, { status, headers })
    : Response.json({ error }, { status, headers })
}

function canonicalTimestamp(epoch: number): string {
  return new Date(epoch).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function toForwardedRequest(value: ContactFormRequest): ContactRequest {
  const base = {
    name: value.name.trim(),
    email: value.email.trim().toLowerCase(),
    message: value.message.trim(),
    consentVersion: value.consentVersion,
    replayToken: value.replayToken,
  }
  return value.kind === 'expert_inquiry'
    ? { kind: value.kind, ...base, expertId: value.expertId }
    : { kind: value.kind, ...base }
}

export async function contactRequestSha256(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function edgeAddress(request: Request): string {
  const cloudflare = request.headers.get('cf-connecting-ip')?.trim()
  if (cloudflare) return cloudflare.slice(0, 128)
  return request.headers.get('x-forwarded-for')?.split(',', 1)[0]?.trim().slice(0, 128) || 'unattributed'
}

function cleanState(state: BoundaryState, now: number, windowMs: number): void {
  for (const [key, attempts] of state.rates) {
    const current = attempts.filter((attempt) => attempt > now - windowMs)
    if (current.length === 0) state.rates.delete(key)
    else state.rates.set(key, current)
  }
  for (const [token, entry] of state.replay) {
    if (entry.expiresAt <= now) state.replay.delete(token)
  }
}

export function validContactRoutingReceipt(
  receipt: unknown,
  submission: ContactRequest,
  requestSha256: string,
  now: number,
): receipt is ContactRoutingReceipt {
  if (!Value.Check(ContactRoutingReceiptSchema, receipt)) return false
  const value = receipt as ContactRoutingReceipt
  const acceptedAt = Date.parse(value.acceptedAt)
  const deleteAfter = Date.parse(value.deleteAfter)
  return canonicalTimestamp(acceptedAt) === value.acceptedAt
    && canonicalTimestamp(deleteAfter) === value.deleteAfter
    && value.replayToken === submission.replayToken
    && value.requestSha256 === requestSha256
    && value.routedAs === submission.kind
    && acceptedAt <= now + 60_000
    && deleteAfter > acceptedAt
    && deleteAfter - acceptedAt <= MAXIMUM_RETENTION_MS
}

export function createContactPost(options: ContactBoundaryOptions) {
  const now = options.now ?? Date.now
  const limit = options.limit ?? CONTACT_LIMIT
  const windowMs = options.windowMs ?? CONTACT_WINDOW_MS
  const replayMs = options.replayMs ?? CONTACT_REPLAY_MS
  const state: BoundaryState = { rates: new Map(), replay: new Map() }
  const processSalt = crypto.randomUUID()

  return async function post(request: Request): Promise<Response> {
    if (!isSameOriginPublicRequest(request)) return response(404, 'not_found')

    const parsed = await readBoundedJson(request, CONTACT_BODY_LIMIT)
    if (!parsed.ok) return response(parsed.status, 'invalid_request')
    if (!Value.Check(ContactFormRequestSchema, parsed.value)) return response(400, 'invalid_request')

    const value = parsed.value as ContactFormRequest
    const current = now()
    const started = Date.parse(value.startedAt)
    if (!Number.isFinite(started)
      || canonicalTimestamp(started) !== value.startedAt
      || current - started < MINIMUM_FORM_AGE_MS
      || current - started > MAXIMUM_FORM_AGE_MS) {
      return response(400, 'invalid_request')
    }

    cleanState(state, current, windowMs)
    const forwarded = toForwardedRequest(value)
    const fingerprint = await contactRequestSha256(forwarded)
    const replay = state.replay.get(value.replayToken)
    if (replay) return replay.fingerprint === fingerprint
      ? response(202)
      : response(409, 'invalid_request')

    const rateKey = await contactRequestSha256({ processSalt, edgeAddress: edgeAddress(request) })
    const attempts = state.rates.get(rateKey) ?? []
    if (attempts.length >= limit) return response(429, 'rate_limited', Math.ceil(windowMs / 1_000))
    attempts.push(current)
    state.rates.set(rateKey, attempts)

    const result = await options.forward(forwarded, fingerprint)
    if (result === false) return response(503, 'temporarily_unavailable', 30)
    if (result !== true) {
      if (result.outcome === 'conflict') return response(409, 'invalid_request')
      if (result.outcome === 'rate_limited') {
        return response(429, 'rate_limited', Math.max(1, Math.min(3_600, result.retryAfterSeconds)))
      }
      if (result.outcome !== 'accepted'
        || !validContactRoutingReceipt(result.receipt, forwarded, fingerprint, current)) {
        return response(503, 'temporarily_unavailable', 30)
      }
    }

    state.replay.set(value.replayToken, { fingerprint, expiresAt: current + replayMs })
    return response(202)
  }
}

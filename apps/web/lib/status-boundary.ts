import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

const MAXIMUM_STATUS_BYTES = 8_192
const MAXIMUM_STATUS_AGE_MS = 5 * 60 * 1_000
const MAXIMUM_FUTURE_SKEW_MS = 60 * 1_000

const Timestamp = Type.String({
  minLength: 20,
  maxLength: 20,
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$',
})

const IncidentProjectionSchema = Type.Object({
  incidentId: Type.String({ minLength: 8, maxLength: 96, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]+$' }),
  state: Type.Union([
    Type.Literal('investigating'),
    Type.Literal('identified'),
    Type.Literal('monitoring'),
  ]),
  summary: Type.String({ minLength: 1, maxLength: 200, pattern: '^[^\\u0000-\\u001F\\u007F]+$' }),
  startedAt: Timestamp,
  updatedAt: Timestamp,
}, { additionalProperties: false })

export const StatusAuthoritySchema = Type.Object({
  schemaVersion: Type.Literal(1),
  scope: Type.Literal('public-web'),
  status: Type.Union([
    Type.Literal('operational'),
    Type.Literal('degraded'),
    Type.Literal('outage'),
  ]),
  message: Type.String({
    minLength: 1,
    maxLength: 200,
    pattern: '^[^\\u0000-\\u001F\\u007F]+$',
  }),
  checkedAt: Timestamp,
  incident: Type.Union([IncidentProjectionSchema, Type.Null()]),
  onCall: Type.Object({
    coverage: Type.Union([Type.Literal('confirmed'), Type.Literal('unconfirmed')]),
    checkedAt: Timestamp,
  }, { additionalProperties: false }),
}, { additionalProperties: false })

type StatusAuthority = Static<typeof StatusAuthoritySchema>
export type PublicStatusView =
  | Readonly<{
      availability: 'current'
      status: StatusAuthority['status']
      message: string
      checkedAt: string
      incident: StatusAuthority['incident']
      onCallCoverage: StatusAuthority['onCall']
      statusPageUrl: string | null
    }>
  | Readonly<{
      availability: 'unavailable'
      message: string
      attemptedAt: string
      statusPageUrl: string | null
    }>

type StatusFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
type StatusEnvironment = Readonly<Record<string, string | undefined>>

type StatusBoundaryOptions = Readonly<{
  env?: StatusEnvironment
  fetchImpl?: StatusFetch
  now?: () => number
  timeoutMs?: number
}>

type StatusAuthorityConfig = Readonly<{ url: string; token: string }>

function safeHttpsUrl(raw: string | undefined): string | null {
  if (!raw || raw.length > 2_048) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null
    return url.toString()
  } catch {
    return null
  }
}

function statusAuthorityConfig(env: StatusEnvironment): StatusAuthorityConfig | null {
  const url = safeHttpsUrl(env.FUMA_STATUS_SUMMARY_URL)
  const token = env.FUMA_STATUS_SUMMARY_TOKEN?.trim()
  if (!url || !token || token.length < 32 || token.length > 512) return null
  return Object.freeze({ url, token })
}

async function boundedJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > MAXIMUM_STATUS_BYTES) throw new Error('oversize')
  return JSON.parse(text) as unknown
}

function timestamp(epoch: number): string {
  return new Date(epoch).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function fresh(value: string, current: number): boolean {
  const epoch = Date.parse(value)
  return Number.isFinite(epoch)
    && timestamp(epoch) === value
    && current - epoch <= MAXIMUM_STATUS_AGE_MS
    && epoch - current <= MAXIMUM_FUTURE_SKEW_MS
}

function coherent(value: StatusAuthority, current: number): boolean {
  if (!fresh(value.checkedAt, current) || !fresh(value.onCall.checkedAt, current)) return false
  if (value.status === 'operational' && value.incident !== null) return false
  if (value.status !== 'operational' && value.incident === null) return false
  if (value.incident) {
    const started = Date.parse(value.incident.startedAt)
    const updated = Date.parse(value.incident.updatedAt)
    if (!Number.isFinite(started) || !Number.isFinite(updated)
      || timestamp(started) !== value.incident.startedAt
      || timestamp(updated) !== value.incident.updatedAt
      || started > updated || updated > Date.parse(value.checkedAt) + MAXIMUM_FUTURE_SKEW_MS) return false
  }
  return true
}

export async function readPublicStatus(options: StatusBoundaryOptions = {}): Promise<PublicStatusView> {
  const env = options.env ?? process.env
  const now = options.now ?? Date.now
  const current = now()
  const statusPageUrl = safeHttpsUrl(env.FUMA_PUBLIC_STATUS_PAGE_URL)
  const authority = statusAuthorityConfig(env)

  const unavailable = (): PublicStatusView => ({
    availability: 'unavailable',
    message: 'Current service status is unavailable. No operational, uptime, incident, monitoring, or on-call claim is being made.',
    attemptedAt: timestamp(current),
    statusPageUrl,
  })

  if (!authority) return unavailable()

  try {
    const response = await (options.fetchImpl ?? fetch)(authority.url, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${authority.token}`,
      },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? 2_000),
    })
    if (!response.ok) return unavailable()
    const candidate = await boundedJson(response)
    if (!Value.Check(StatusAuthoritySchema, candidate)) return unavailable()
    const value = candidate as StatusAuthority
    if (!coherent(value, current)) return unavailable()
    return {
      availability: 'current',
      status: value.status,
      message: value.message,
      checkedAt: value.checkedAt,
      incident: value.incident,
      onCallCoverage: value.onCall,
      statusPageUrl,
    }
  } catch {
    return unavailable()
  }
}

export const __statusBoundaryTest = Object.freeze({ safeHttpsUrl, statusAuthorityConfig, coherent })

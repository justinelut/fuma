import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

const MAXIMUM_STATUS_BYTES = 8_192
const MAXIMUM_STATUS_AGE_MS = 5 * 60 * 1_000
const MAXIMUM_FUTURE_SKEW_MS = 60 * 1_000

const StatusAuthoritySchema = Type.Object({
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
  checkedAt: Type.String({
    minLength: 20,
    maxLength: 20,
    pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$',
  }),
}, { additionalProperties: false })

type StatusAuthority = Static<typeof StatusAuthoritySchema>

export type PublicStatusView =
  | Readonly<{
      availability: 'current'
      status: StatusAuthority['status']
      message: string
      checkedAt: string
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

async function boundedJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > MAXIMUM_STATUS_BYTES) throw new Error('oversize')
  return JSON.parse(text) as unknown
}

function timestamp(epoch: number): string {
  return new Date(epoch).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export async function readPublicStatus(options: StatusBoundaryOptions = {}): Promise<PublicStatusView> {
  const env = options.env ?? process.env
  const now = options.now ?? Date.now
  const current = now()
  const statusPageUrl = safeHttpsUrl(env.FUMA_PUBLIC_STATUS_PAGE_URL)
  const summaryUrl = safeHttpsUrl(env.FUMA_STATUS_SUMMARY_URL)

  const unavailable = (): PublicStatusView => ({
    availability: 'unavailable',
    message: 'Current service status is unavailable. No operational, uptime, or incident claim is being made.',
    attemptedAt: timestamp(current),
    statusPageUrl,
  })

  if (!summaryUrl) return unavailable()

  try {
    const response = await (options.fetchImpl ?? fetch)(summaryUrl, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? 2_000),
    })
    if (!response.ok) return unavailable()
    const candidate = await boundedJson(response)
    if (!Value.Check(StatusAuthoritySchema, candidate)) return unavailable()
    const value = candidate as StatusAuthority
    const checked = Date.parse(value.checkedAt)
    if (!Number.isFinite(checked)
      || timestamp(checked) !== value.checkedAt
      || current - checked > MAXIMUM_STATUS_AGE_MS
      || checked - current > MAXIMUM_FUTURE_SKEW_MS) return unavailable()
    return { availability: 'current', ...value, statusPageUrl }
  } catch {
    return unavailable()
  }
}

export const __statusBoundaryTest = Object.freeze({ safeHttpsUrl })

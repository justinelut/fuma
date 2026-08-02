import { Type, safeParseValue, type Static } from '@core/utils/typeboxHelpers'

const MAXIMUM_STATUS_BYTES = 8_192
const MAXIMUM_STATUS_AGE_MS = 5 * 60 * 1_000
const MAXIMUM_FUTURE_SKEW_MS = 60 * 1_000

const TimestampSchema = Type.String({
  minLength: 20,
  maxLength: 20,
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$',
})

export const PublicIncidentProjectionSchema = Type.Object({
  incidentId: Type.String({ minLength: 8, maxLength: 96, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]+$' }),
  state: Type.Union([
    Type.Literal('investigating'),
    Type.Literal('identified'),
    Type.Literal('monitoring'),
  ]),
  summary: Type.String({ minLength: 1, maxLength: 200, pattern: '^[^\\u0000-\\u001F\\u007F]+$' }),
  startedAt: TimestampSchema,
  updatedAt: TimestampSchema,
}, { additionalProperties: false })

export const PublicStatusProjectionSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  scope: Type.Literal('public-web'),
  status: Type.Union([
    Type.Literal('operational'),
    Type.Literal('degraded'),
    Type.Literal('outage'),
  ]),
  message: Type.String({ minLength: 1, maxLength: 200, pattern: '^[^\\u0000-\\u001F\\u007F]+$' }),
  checkedAt: TimestampSchema,
  incident: Type.Union([PublicIncidentProjectionSchema, Type.Null()]),
  onCall: Type.Object({
    coverage: Type.Union([Type.Literal('confirmed'), Type.Literal('unconfirmed')]),
    checkedAt: TimestampSchema,
  }, { additionalProperties: false }),
}, { additionalProperties: false })

export type PublicStatusProjection = Readonly<Static<typeof PublicStatusProjectionSchema>>

export interface PublicStatusProjectionAuthority {
  readCurrent(): Promise<unknown | null>
}

export type PublicStatusAuthorityConfig = Readonly<{
  url: string
  token: string
  timeoutMs: number
}>

function optional(env: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = env[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`Invalid ${key}.`)
  return value.trim()
}

export function readPublicStatusAuthorityConfig(
  env: Readonly<Record<string, unknown>> = process.env,
): PublicStatusAuthorityConfig | null {
  const rawUrl = optional(env, 'FUMA_PUBLIC_STATUS_AUTHORITY_URL')
  const token = optional(env, 'FUMA_PUBLIC_STATUS_AUTHORITY_TOKEN')
  if (rawUrl === undefined && token === undefined) return null
  if (rawUrl === undefined || token === undefined || token.length < 32 || token.length > 512) {
    throw new TypeError('Public status authority configuration is incomplete.')
  }
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname === '/') {
    throw new TypeError('Public status authority URL must be a dedicated HTTPS endpoint.')
  }
  const rawTimeout = optional(env, 'FUMA_PUBLIC_STATUS_AUTHORITY_TIMEOUT_MS')
  const timeoutMs = rawTimeout === undefined ? 2_000 : Number(rawTimeout)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) {
    throw new TypeError('Public status authority timeout is invalid.')
  }
  return Object.freeze({ url: url.toString(), token, timeoutMs })
}

function canonicalTimestamp(epoch: number): string {
  return new Date(epoch).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function fresh(value: string, current: number): boolean {
  const epoch = Date.parse(value)
  return Number.isFinite(epoch)
    && canonicalTimestamp(epoch) === value
    && current - epoch <= MAXIMUM_STATUS_AGE_MS
    && epoch - current <= MAXIMUM_FUTURE_SKEW_MS
}

export function validCurrentStatusProjection(value: unknown, current: number): value is PublicStatusProjection {
  const parsed = safeParseValue(PublicStatusProjectionSchema, value)
  if (!parsed.ok) return false
  const status = parsed.value
  if (!fresh(status.checkedAt, current) || !fresh(status.onCall.checkedAt, current)) return false
  if (status.status === 'operational' && status.incident !== null) return false
  if (status.status !== 'operational' && status.incident === null) return false
  if (status.incident) {
    const startedAt = Date.parse(status.incident.startedAt)
    const updatedAt = Date.parse(status.incident.updatedAt)
    if (!Number.isFinite(startedAt) || !Number.isFinite(updatedAt)
      || canonicalTimestamp(startedAt) !== status.incident.startedAt
      || canonicalTimestamp(updatedAt) !== status.incident.updatedAt
      || startedAt > updatedAt
      || updatedAt > Date.parse(status.checkedAt) + MAXIMUM_FUTURE_SKEW_MS) return false
  }
  return true
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAXIMUM_STATUS_BYTES) throw new Error('Status authority response is oversized.')
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > MAXIMUM_STATUS_BYTES) throw new Error('Status authority response is oversized.')
  return JSON.parse(text) as unknown
}

/** Authenticated provider-neutral source. Missing or invalid authority always yields no public status facts. */
export class ConfiguredPublicStatusProjectionAuthority implements PublicStatusProjectionAuthority {
  readonly #config: PublicStatusAuthorityConfig
  readonly #fetch: typeof fetch
  readonly #now: () => number

  constructor(config: PublicStatusAuthorityConfig, fetchImpl: typeof fetch = fetch, now: () => number = Date.now) {
    this.#config = config
    this.#fetch = fetchImpl
    this.#now = now
  }

  async readCurrent(): Promise<PublicStatusProjection | null> {
    try {
      const response = await this.#fetch(this.#config.url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.#config.token}`,
          'x-fuma-request-id': crypto.randomUUID(),
        },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(this.#config.timeoutMs),
      })
      if (!response.ok) return null
      const candidate = await boundedJson(response)
      return validCurrentStatusProjection(candidate, this.#now())
        ? Object.freeze(structuredClone(candidate))
        : null
    } catch {
      return null
    }
  }
}

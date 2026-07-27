import { ContactRequestSchema, type ContactRequest } from '@fuma/public-contracts'
import { Value } from '@sinclair/typebox/value'

export interface PublicContactSink {
  accept(value: ContactRequest): Promise<boolean>
}

export type PublicContactSinkConfig = Readonly<{
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

export function readPublicContactSinkConfig(env: Readonly<Record<string, unknown>> = process.env): PublicContactSinkConfig | null {
  const rawUrl = optional(env, 'FUMA_PUBLIC_CONTACT_ROUTING_URL')
  const token = optional(env, 'FUMA_PUBLIC_CONTACT_ROUTING_TOKEN')
  if (rawUrl === undefined && token === undefined) return null
  if (rawUrl === undefined || token === undefined || token.length < 32 || token.length > 512) throw new TypeError('Public contact routing configuration is incomplete.')
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname === '/') {
    throw new TypeError('Public contact routing URL must be a dedicated HTTPS endpoint.')
  }
  const rawTimeout = optional(env, 'FUMA_PUBLIC_CONTACT_ROUTING_TIMEOUT_MS')
  const timeoutMs = rawTimeout === undefined ? 3_000 : Number(rawTimeout)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) throw new TypeError('Public contact routing timeout is invalid.')
  return Object.freeze({ url: url.toString(), token, timeoutMs })
}

export class ConfiguredPublicContactSink implements PublicContactSink {
  readonly #config: PublicContactSinkConfig
  readonly #fetch: typeof fetch
  constructor(config: PublicContactSinkConfig, fetchImpl: typeof fetch = fetch) { this.#config = config; this.#fetch = fetchImpl }

  async accept(value: ContactRequest): Promise<boolean> {
    if (!Value.Check(ContactRequestSchema, value)) return false
    try {
      const response = await this.#fetch(this.#config.url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.#config.token}`,
          'content-type': 'application/json; charset=utf-8',
          'x-fuma-request-id': crypto.randomUUID(),
        },
        body: JSON.stringify(value),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(this.#config.timeoutMs),
      })
      return response.status === 202
    } catch {
      return false
    }
  }
}

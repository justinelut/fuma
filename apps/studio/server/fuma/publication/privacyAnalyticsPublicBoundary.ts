import type { PublicationAnalyticsCollectionContext } from '@core/fuma/publication/analyticsContracts'
import type { PublicationPrivacyAnalyticsPublicAdapter } from './privacyAnalyticsAdapters'
import type { PublicationRepositoryScope } from './scope'

const ANALYTICS_PATH = '/_fuma/publication/analytics'
const CONSENT_COOKIE = '__Host-fuma_analytics_consent'

export interface PublicationAnalyticsHostAuthority {
  scopeForHost(host: string): Promise<PublicationRepositoryScope | null>
}

export class PublicationPrivacyAnalyticsPublicBoundary {
  readonly #adapter: PublicationPrivacyAnalyticsPublicAdapter
  readonly #hosts: PublicationAnalyticsHostAuthority
  readonly #now: () => Date

  constructor(input: Readonly<{
    adapter: PublicationPrivacyAnalyticsPublicAdapter
    hosts: PublicationAnalyticsHostAuthority
    now?: () => Date
  }>) {
    this.#adapter = input.adapter
    this.#hosts = input.hosts
    this.#now = input.now ?? (() => new Date())
  }

  handles(request: Request): boolean {
    return new URL(request.url).pathname === ANALYTICS_PATH
  }

  async handle(request: Request): Promise<Response | null> {
    if (!this.handles(request)) return null
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ accepted: false }), {
        status: 405,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })
    }
    const scope = await this.#hosts.scopeForHost(new URL(request.url).host.toLowerCase())
    if (!scope) return new Response('Not found.', { status: 404, headers: { 'cache-control': 'no-store' } })
    return await this.#adapter.collect(scope, collectionContext(request, this.#now()), request)
  }
}

function collectionContext(request: Request, now: Date): PublicationAnalyticsCollectionContext {
  const consent = cookie(request, CONSENT_COOKIE)
  const userAgent = request.headers.get('user-agent')?.toLowerCase() ?? ''
  const knownBot = /(?:bot|crawler|spider|slurp|preview|headless|lighthouse)/.test(userAgent)
  return Object.freeze({
    occurredAt: now.toISOString(),
    consent: consent === 'granted' ? 'granted' : consent === 'denied' ? 'denied' : 'unknown',
    globalPrivacyControl: request.headers.get('sec-gpc') === '1',
    doNotTrack: request.headers.get('dnt') === '1',
    bot: knownBot ? 'known-bot' : userAgent.length === 0 ? 'suspected-bot' : 'human',
  })
}

function cookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    try { return decodeURIComponent(part.slice(separator + 1).trim()) } catch { return null }
  }
  return null
}

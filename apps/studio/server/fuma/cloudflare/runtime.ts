import type { DbClient } from '../../db/client'
import type { FumaConfig } from '../config'
import type { DomainService } from '../domains/service'
import type { PostgresDomainRepository } from '../domains/postgres'
import {
  CloudflareForSaasApiAdapter,
  CloudflareTransportError,
  type CloudflareHttpClient,
  type CloudflareHttpRequest,
  type CloudflareHttpResponse,
} from './adapter'
import { cloudflareJobRegistration } from './jobHandlers'
import { CloudflareSaasReconciler, DomainServiceCloudflareTransitionPort } from './reconciler'
import { PostgresCloudflareStateRepository } from './repository'
import { createCloudflareRouteDeclarations } from './routes'

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 20_000

/** Bounded provider HTTP transport. It receives only Cloudflare-owned URLs from the adapter. */
export class FetchCloudflareHttpClient implements CloudflareHttpClient {
  readonly #fetch: typeof fetch

  constructor(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.#fetch = fetchImpl
  }

  async request(input: CloudflareHttpRequest): Promise<CloudflareHttpResponse> {
    const target = new URL(input.url)
    if (target.protocol !== 'https:' || target.hostname !== 'api.cloudflare.com'
      || target.username || target.password || target.hash) {
      throw new CloudflareTransportError('configuration', 'Cloudflare request target is unavailable.')
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await this.#fetch(target, {
        method: input.method,
        headers: input.headers,
        body: input.body === null ? undefined : JSON.stringify(input.body),
        redirect: 'error',
        signal: controller.signal,
      })
      const length = Number(response.headers.get('content-length') ?? '0')
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_RESPONSE_BYTES) {
        throw new CloudflareTransportError('contract', 'Cloudflare response exceeded its size limit.')
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength > MAX_RESPONSE_BYTES) {
        throw new CloudflareTransportError('contract', 'Cloudflare response exceeded its size limit.')
      }
      let body: unknown = null
      if (bytes.byteLength > 0) {
        try {
          body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
        } catch {
          throw new CloudflareTransportError('contract', 'Cloudflare response was not valid JSON.')
        }
      }
      return Object.freeze({ status: response.status, body })
    } catch (error) {
      if (error instanceof CloudflareTransportError) throw error
      throw new CloudflareTransportError('provider', 'Cloudflare request failed.')
    } finally {
      clearTimeout(timer)
    }
  }
}

export type HostedCloudflareRuntimeInput = Readonly<{
  db: DbClient
  config: Pick<FumaConfig, 'cloudflare' | 'hosts'>
  domains: Readonly<{
    repository: Pick<PostgresDomainRepository, 'exact'>
    service: Pick<DomainService, 'create' | 'list' | 'transition'>
  }>
  http?: CloudflareHttpClient
  now?: () => Date
}>

/** One production Cloudflare authority; customers never provide a Cloudflare account or token. */
export function createHostedCloudflareRuntime(input: HostedCloudflareRuntimeInput) {
  if (input.db.dialect !== 'postgres') throw new TypeError('Hosted Cloudflare authority requires PostgreSQL.')
  const token = new TextEncoder().encode(input.config.cloudflare.apiToken)
  let adapter: CloudflareForSaasApiAdapter
  try {
    adapter = new CloudflareForSaasApiAdapter({
      apiOrigin: 'https://api.cloudflare.com',
      zoneId: input.config.cloudflare.zoneId,
      apiToken: token,
      http: input.http ?? new FetchCloudflareHttpClient(),
    })
  } finally {
    token.fill(0)
  }
  const repository = new PostgresCloudflareStateRepository(input.db)
  const reconciler = new CloudflareSaasReconciler(
    adapter,
    new DomainServiceCloudflareTransitionPort(input.domains.service),
    repository,
    input.now,
    input.config.hosts.customerRouting,
  )
  const authority = Object.freeze({
    exact: (scope: Parameters<PostgresDomainRepository['exact']>[0], domainId: string) => (
      input.domains.repository.exact(scope, domainId)
    ),
  })
  const catalog = Object.freeze({
    list: (scope: Parameters<DomainService['list']>[0]) => input.domains.service.list(scope),
    create: (scope: Parameters<DomainService['create']>[0], command: unknown) => input.domains.service.create(scope, command),
  })
  const routeInput = Object.freeze({
    reconciler,
    domains: authority,
    catalog,
    ...(input.now ? { now: input.now } : {}),
  })
  return Object.freeze({
    adapter,
    repository,
    reconciler,
    scopedRoutes: createCloudflareRouteDeclarations(routeInput),
    scopedRoutesWithOnboarding(onboard: NonNullable<Parameters<typeof createCloudflareRouteDeclarations>[0]['onboard']>) {
      return createCloudflareRouteDeclarations({ ...routeInput, onboard })
    },
    jobs: cloudflareJobRegistration({ reconciler, domains: authority }),
    close: () => adapter.close(),
  })
}

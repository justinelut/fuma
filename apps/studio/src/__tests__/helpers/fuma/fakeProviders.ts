import { FumaFakeClock } from './fakeClock'

export const FUMA_FAKE_PROVIDER_IDS = [
  'oci-email',
  'platform-paystack',
  'customer-paystack',
  'cloudflare',
] as const

export type FumaFakeProviderId = (typeof FUMA_FAKE_PROVIDER_IDS)[number]

export type FakeProviderRoute = Readonly<{
  method: string
  path: string
  status: number
  responseBody?: string
  responseHeaders?: Readonly<Record<string, string>>
  timingMs?: number
}>

export type FakeProviderCapture = Readonly<{
  providerId: FumaFakeProviderId
  method: string
  path: string
  status: number
  startedAtMs: number
  completedAtMs: number
  durationMs: number
  bodyLength: number
  bodySha256: string
  headers: Readonly<Record<string, string>>
}>

const REDACTED = '[REDACTED]'
const SECRET_HEADER_NAME = /(?:authorization|cookie|(?:api|auth|access)[-_]?key|token|secret|signature|credential)/i
const DEFAULT_INITIAL_TIME = '2040-01-01T00:00:00.000Z'
const NativeResponse = ((globalThis as Record<PropertyKey, unknown>)[
  Symbol.for('instatic.test.nativeResponse')
] as typeof Response | undefined) ?? globalThis.Response

function routeKey(method: string, path: string): string {
  return `${method.trim().toUpperCase()} ${path}`
}

function validateRoute(route: FakeProviderRoute): void {
  if (!route.path.startsWith('/')) throw new Error('Fake provider route path must start with /')
  if (!Number.isInteger(route.status) || route.status < 100 || route.status > 599) {
    throw new Error('Fake provider route status must be an HTTP status')
  }
  if (route.timingMs !== undefined && (!Number.isFinite(route.timingMs) || route.timingMs < 0)) {
    throw new Error('Fake provider route timing must be a finite non-negative number')
  }
}

function validatedRouteMap(
  routes: readonly FakeProviderRoute[],
): ReadonlyMap<string, FakeProviderRoute> {
  const routeMap = new Map<string, FakeProviderRoute>()
  for (const route of routes) {
    validateRoute(route)
    const key = routeKey(route.method, route.path)
    if (routeMap.has(key)) throw new Error(`Duplicate fake provider route: ${key}`)
    routeMap.set(key, route)
  }
  return routeMap
}

function capturedHeaders(headers: Headers): Readonly<Record<string, string>> {
  const entries = [...headers.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => [name, SECRET_HEADER_NAME.test(name) ? REDACTED : value] as const)
  return Object.fromEntries(entries)
}

function sha256(bytes: Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
}

function defaultRoutes(providerId: FumaFakeProviderId): readonly FakeProviderRoute[] {
  return [{
    method: 'POST',
    path: '/fixture',
    status: 202,
    responseBody: JSON.stringify({ provider: providerId, accepted: true }),
    responseHeaders: { 'content-type': 'application/json' },
    timingMs: 5,
  }]
}

export class FumaFakeProviderServer {
  readonly providerId: FumaFakeProviderId
  readonly origin: string
  readonly #routes: ReadonlyMap<string, FakeProviderRoute>
  readonly #clock: FumaFakeClock
  readonly #server: ReturnType<typeof Bun.serve>
  readonly #captures: FakeProviderCapture[] = []
  #closed = false

  constructor(
    providerId: FumaFakeProviderId,
    routes: readonly FakeProviderRoute[] = defaultRoutes(providerId),
    clock = new FumaFakeClock(DEFAULT_INITIAL_TIME),
  ) {
    this.providerId = providerId
    this.#clock = clock
    this.#routes = validatedRouteMap(routes)

    this.#server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: async (request) => this.#handle(request),
    })
    this.origin = this.#server.url.origin
  }

  captures(): readonly FakeProviderCapture[] {
    return this.#captures.map((capture) => ({
      ...capture,
      headers: { ...capture.headers },
    }))
  }

  reset(): void {
    this.#captures.length = 0
    this.#clock.reset()
  }

  async close(): Promise<void> {
    if (this.#closed) return
    await this.#server.stop(true)
    this.#closed = true
  }

  async #handle(request: Request): Promise<Response> {
    const startedAtMs = this.#clock.nowMs()
    const url = new URL(request.url)
    const path = `${url.pathname}${url.search}`
    const route = this.#routes.get(routeKey(request.method, path))
    const status = route?.status ?? 404
    const bytes = new Uint8Array(await request.arrayBuffer())
    this.#clock.advance(route?.timingMs ?? 0)
    const completedAtMs = this.#clock.nowMs()

    this.#captures.push({
      providerId: this.providerId,
      method: request.method.toUpperCase(),
      path,
      status,
      startedAtMs,
      completedAtMs,
      durationMs: completedAtMs - startedAtMs,
      bodyLength: bytes.byteLength,
      bodySha256: sha256(bytes),
      headers: capturedHeaders(request.headers),
    })

    if (!NativeResponse) throw new Error('Native Bun Response constructor is unavailable')
    return new NativeResponse(route?.responseBody ?? '', {
      status,
      headers: route?.responseHeaders,
    })
  }
}

export type FumaFakeProviderSuite = Readonly<{
  ociEmail: FumaFakeProviderServer
  platformPaystack: FumaFakeProviderServer
  customerPaystack: FumaFakeProviderServer
  cloudflare: FumaFakeProviderServer
  reset: () => void
  close: () => Promise<void>
}>

export function startFumaFakeProviderSuite(
  routes: Partial<Record<FumaFakeProviderId, readonly FakeProviderRoute[]>> = {},
): FumaFakeProviderSuite {
  const routeSets = FUMA_FAKE_PROVIDER_IDS.map(
    (providerId) => routes[providerId] ?? defaultRoutes(providerId),
  )
  for (const routeSet of routeSets) validatedRouteMap(routeSet)

  const servers = FUMA_FAKE_PROVIDER_IDS.map((providerId, index) => new FumaFakeProviderServer(
    providerId,
    routeSets[index],
  ))
  const [ociEmail, platformPaystack, customerPaystack, cloudflare] = servers

  return {
    ociEmail,
    platformPaystack,
    customerPaystack,
    cloudflare,
    reset: () => {
      for (const server of servers) server.reset()
    },
    close: async () => {
      await Promise.all(servers.map((server) => server.close()))
    },
  }
}

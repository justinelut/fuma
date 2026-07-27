import {
  parsePlatformCheckoutWire,
  type PlatformCheckoutSource,
  type PlatformCheckoutWire,
} from './contracts'

export class PlatformCheckoutClientError extends Error {
  override readonly name = 'PlatformCheckoutClientError'
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export class PlatformCheckoutHttpClient {
  readonly #basePath: string
  readonly #fetch: typeof fetch

  constructor(input: Readonly<{
    organizationId: string
    workspaceId: string
    siteId: string
    fetch?: typeof fetch
  }>) {
    this.#basePath = [
      '/api/fuma/organizations',
      encodeURIComponent(input.organizationId),
      'workspaces',
      encodeURIComponent(input.workspaceId),
      'sites',
      encodeURIComponent(input.siteId),
      'billing/checkouts',
    ].join('/')
    this.#fetch = input.fetch ?? globalThis.fetch
  }

  initialize(source: PlatformCheckoutSource): Promise<PlatformCheckoutWire> {
    return this.#request(this.#basePath, {
      method: 'POST',
      body: JSON.stringify({ source }),
    })
  }

  find(checkoutId: string): Promise<PlatformCheckoutWire> {
    return this.#request(`${this.#basePath}/${encodeURIComponent(checkoutId)}`)
  }

  cancel(checkoutId: string): Promise<PlatformCheckoutWire> {
    return this.#request(`${this.#basePath}/${encodeURIComponent(checkoutId)}/cancel`, {
      method: 'POST',
      body: '{}',
    })
  }

  verifyCallback(checkoutId: string, reference: string): Promise<PlatformCheckoutWire> {
    return this.#request(`${this.#basePath}/${encodeURIComponent(checkoutId)}/callback`, {
      method: 'POST',
      body: JSON.stringify({ reference }),
    })
  }

  async #request(path: string, init: RequestInit = {}): Promise<PlatformCheckoutWire> {
    const response = await this.#fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
    })
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new PlatformCheckoutClientError(response.status, 'Checkout service returned an invalid response.')
    }
    if (!response.ok) {
      const message = body && typeof body === 'object' && 'error' in body
        && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : 'Checkout request failed.'
      throw new PlatformCheckoutClientError(response.status, message)
    }
    return parsePlatformCheckoutWire(body)
  }
}

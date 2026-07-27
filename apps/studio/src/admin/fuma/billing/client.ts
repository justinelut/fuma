import { apiRequest, type FetchLike } from '@core/http'
import {
  PlatformCheckoutWireSchema,
  type PlatformCheckoutSource,
  type PlatformCheckoutWire,
} from './contracts'

export class PlatformCheckoutHttpClient {
  readonly #basePath: string
  readonly #fetch: FetchLike

  constructor(input: Readonly<{
    organizationId: string
    workspaceId: string
    siteId: string
    fetch?: FetchLike
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
    this.#fetch = input.fetch ?? globalThis.fetch.bind(globalThis)
  }

  initialize(source: PlatformCheckoutSource): Promise<PlatformCheckoutWire> {
    return this.#request(this.#basePath, 'POST', { source })
  }

  find(checkoutId: string): Promise<PlatformCheckoutWire> {
    return this.#request(`${this.#basePath}/${encodeURIComponent(checkoutId)}`)
  }

  cancel(checkoutId: string): Promise<PlatformCheckoutWire> {
    return this.#request(
      `${this.#basePath}/${encodeURIComponent(checkoutId)}/cancel`,
      'POST',
      {},
    )
  }

  verifyCallback(checkoutId: string, reference: string): Promise<PlatformCheckoutWire> {
    return this.#request(
      `${this.#basePath}/${encodeURIComponent(checkoutId)}/callback`,
      'POST',
      { reference },
    )
  }

  #request(path: string, method = 'GET', body?: unknown): Promise<PlatformCheckoutWire> {
    return apiRequest(path, {
      method,
      ...(body === undefined ? {} : { body }),
      schema: PlatformCheckoutWireSchema,
      credentials: 'same-origin',
      fallbackMessage: 'Checkout request failed.',
      fetchImpl: this.#fetch,
    })
  }
}

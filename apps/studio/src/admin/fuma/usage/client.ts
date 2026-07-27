import { apiRequest, type FetchLike } from '@core/http'
import {
  CancellationResponseWireSchema,
  QuotaSelfServiceWireSchema,
  TopUpResponseWireSchema,
  type QuotaSelfServiceWire,
  type TopUpRequestWire,
} from './contracts'

export class QuotaSelfServiceHttpClient {
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
    ].join('/')
    this.#fetch = input.fetch ?? globalThis.fetch.bind(globalThis)
  }

  view(): Promise<QuotaSelfServiceWire> {
    return apiRequest(`${this.#basePath}/quotas/self-service`, {
      schema: QuotaSelfServiceWireSchema,
      credentials: 'same-origin',
      fallbackMessage: 'Usage and billing details could not be loaded.',
      fetchImpl: this.#fetch,
    })
  }

  exportUrl(): string {
    return `${this.#basePath}/quotas/self-service/export`
  }

  requestTopUp(body: TopUpRequestWire): Promise<Readonly<{ requestId: string; state: 'requested' }>> {
    return apiRequest(`${this.#basePath}/quotas/top-up-requests`, {
      method: 'POST',
      body,
      schema: TopUpResponseWireSchema,
      credentials: 'same-origin',
      fallbackMessage: 'Top-up request could not be submitted.',
      fetchImpl: this.#fetch,
    })
  }

  requestCancellation(): Promise<Readonly<{ requested: true }>> {
    return apiRequest(`${this.#basePath}/billing/cancellation`, {
      method: 'POST',
      body: {},
      schema: CancellationResponseWireSchema,
      credentials: 'same-origin',
      fallbackMessage: 'Cancellation request could not be submitted.',
      fetchImpl: this.#fetch,
    })
  }
}

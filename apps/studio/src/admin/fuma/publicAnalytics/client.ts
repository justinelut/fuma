import {
  PublicMarketingRangeSchema,
  PublicMarketingReportSchema,
  type PublicMarketingRange,
  type PublicMarketingReport,
} from '@core/fuma/publicAnalytics/contracts'
import { Value } from '@sinclair/typebox/value'

export class PublicMarketingAnalyticsClientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PublicMarketingAnalyticsClientError'
  }
}

export class PublicMarketingAnalyticsHttpClient {
  readonly #basePath: string
  readonly #fetch: typeof fetch

  constructor(input: Readonly<{ basePath: string; fetchImpl?: typeof fetch }>) {
    if (
      !input.basePath.startsWith('/')
      || input.basePath.startsWith('//')
      || input.basePath.includes('\\')
      || input.basePath.includes('?')
      || input.basePath.includes('#')
    ) {
      throw new TypeError('Marketing analytics client requires a same-origin path.')
    }
    this.#basePath = input.basePath.replace(/\/$/, '')
    this.#fetch = input.fetchImpl ?? fetch
  }

  async report(range: PublicMarketingRange): Promise<PublicMarketingReport> {
    if (!Value.Check(PublicMarketingRangeSchema, range)) {
      throw new PublicMarketingAnalyticsClientError('Marketing analytics range is invalid.')
    }
    const query = new URLSearchParams({ from: range.from, to: range.to })
    const response = await this.#fetch(`${this.#basePath}?${query}`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
    let value: unknown
    try { value = await response.json() } catch { throw new PublicMarketingAnalyticsClientError('Marketing analytics returned an invalid response.') }
    if (!response.ok || !Value.Check(PublicMarketingReportSchema, value)) {
      throw new PublicMarketingAnalyticsClientError('Marketing analytics are temporarily unavailable.')
    }
    return Object.freeze(structuredClone(value)) as PublicMarketingReport
  }
}

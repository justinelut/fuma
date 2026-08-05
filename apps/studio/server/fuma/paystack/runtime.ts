import type { DbClient } from '../../db/client'
import type { FumaConfig } from '../config'
import { PaystackWebhookBoundary } from './boundary'
import { PostgresPaystackLedger } from './repository'
import {
  PaystackError,
  PaystackPurposeRegistry,
  ScopedPaystackTransport,
  type PaystackHttp,
} from './transport'

const MAX_PROVIDER_RESPONSE_BYTES = 1_048_576

export class PaystackFetchHttp implements PaystackHttp {
  async request(input: Readonly<{
    url: string
    method: 'GET' | 'POST'
    headers: Readonly<Record<string, string>>
    body?: string
  }>): Promise<Readonly<{ status: number; body: unknown }>> {
    const response = await fetch(input.url, {
      method: input.method,
      headers: input.headers,
      ...(input.body === undefined ? {} : { body: input.body }),
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
    const declaredLength = Number(response.headers.get('content-length') ?? '0')
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_RESPONSE_BYTES) {
      throw new PaystackError('provider', 'Paystack provider response exceeded the bounded size.')
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
      throw new PaystackError('provider', 'Paystack provider response exceeded the bounded size.')
    }
    let body: unknown
    try {
      body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch {
      throw new PaystackError('provider', 'Paystack provider response was not valid JSON.')
    }
    return Object.freeze({ status: response.status, body })
  }
}

export type HostedPaystackRuntimeInput = Readonly<{
  db: DbClient
  config: FumaConfig
  registry?: PaystackPurposeRegistry
  http?: PaystackHttp
}>

export function createHostedPaystackRuntime(input: HostedPaystackRuntimeInput): Readonly<{
  registry: PaystackPurposeRegistry
  ledger: PostgresPaystackLedger
  platformBilling: ScopedPaystackTransport
  customerMerchant: ScopedPaystackTransport | null
  webhooks: PaystackWebhookBoundary
}> {
  const registry = input.registry ?? new PaystackPurposeRegistry()
  const ledger = new PostgresPaystackLedger(input.db)
  const http = input.http ?? new PaystackFetchHttp()
  const providerBaseUrl = input.config.paystack.providerBaseUrl
  const platformBilling = new ScopedPaystackTransport(
    input.config.paystack.platformBilling,
    http,
    ledger,
    registry,
    { providerBaseUrl },
  )
  const customerMerchant = input.config.paystack.customerMerchant === null
    ? null
    : new ScopedPaystackTransport(
      input.config.paystack.customerMerchant,
      http,
      ledger,
      registry,
      { providerBaseUrl },
    )
  return Object.freeze({
    registry,
    ledger,
    platformBilling,
    customerMerchant,
    webhooks: new PaystackWebhookBoundary({ platformBilling, customerMerchant }),
  })
}

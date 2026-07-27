import type { PaystackScope, ScopedPaystackTransport } from './transport'

export const PAYSTACK_WEBHOOK_PATHS = Object.freeze({
  platform_billing: '/_fuma/paystack/webhooks/platform-billing',
  customer_merchant: '/_fuma/paystack/webhooks/customer-merchant',
} satisfies Readonly<Record<PaystackScope, string>>)

const PAYSTACK_WEBHOOK_PREFIX = '/_fuma/paystack/webhooks/'
const MAX_WEBHOOK_BYTES = 1_048_576

function accepted(): Response {
  return new Response(JSON.stringify({ accepted: true }), {
    status: 202,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function notFound(): Response {
  return new Response(JSON.stringify({ error: 'Resource not found.' }), {
    status: 404,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

async function boundedRawBody(request: Request): Promise<Uint8Array> {
  const declaredLength = request.headers.get('content-length')
  if (declaredLength !== null) {
    const length = Number(declaredLength)
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_WEBHOOK_BYTES) {
      throw new TypeError('Paystack webhook body is outside the bounded size.')
    }
  }
  const raw = new Uint8Array(await request.arrayBuffer())
  if (raw.byteLength > MAX_WEBHOOK_BYTES) {
    throw new TypeError('Paystack webhook body is outside the bounded size.')
  }
  return raw
}

export type PaystackWebhookBoundaryInput = Readonly<{
  platformBilling: ScopedPaystackTransport
  customerMerchant: ScopedPaystackTransport
}>

/**
 * One bounded dispatcher owns the Paystack public namespace, while each exact
 * route remains permanently bound to one credential-scoped transport and
 * ledger. Every matched delivery receives the same non-oracular response.
 */
export class PaystackWebhookBoundary {
  readonly #routes: ReadonlyMap<string, ScopedPaystackTransport>

  constructor(input: PaystackWebhookBoundaryInput) {
    if (input.platformBilling.scope !== 'platform_billing') {
      throw new TypeError('Platform Paystack webhook route requires platform_billing credentials.')
    }
    if (input.customerMerchant.scope !== 'customer_merchant') {
      throw new TypeError('Customer Paystack webhook route requires customer_merchant credentials.')
    }
    if (input.platformBilling === input.customerMerchant) {
      throw new TypeError('Paystack credential scopes require separate transport instances.')
    }
    this.#routes = new Map([
      [PAYSTACK_WEBHOOK_PATHS.platform_billing, input.platformBilling],
      [PAYSTACK_WEBHOOK_PATHS.customer_merchant, input.customerMerchant],
    ])
  }

  handles(request: Request): boolean {
    return new URL(request.url).pathname.startsWith(PAYSTACK_WEBHOOK_PREFIX)
  }

  async handle(request: Request): Promise<Response | null> {
    const pathname = new URL(request.url).pathname
    if (!pathname.startsWith(PAYSTACK_WEBHOOK_PREFIX)) return null
    const transport = this.#routes.get(pathname)
    if (!transport || request.method !== 'POST') return notFound()
    try {
      const signature = request.headers.get('x-paystack-signature') ?? ''
      const raw = await boundedRawBody(request)
      await transport.ingestWebhook(raw, signature)
    } catch {
      // Deliberately indistinguishable from accepted and duplicate deliveries.
    }
    return accepted()
  }

  redactedSummary(): Readonly<{
    routes: readonly string[]
    scopes: readonly PaystackScope[]
    credentials: '[REDACTED]'
  }> {
    return Object.freeze({
      routes: Object.freeze([...this.#routes.keys()].sort()),
      scopes: Object.freeze([...this.#routes.values()].map((transport) => transport.scope).sort()),
      credentials: '[REDACTED]',
    })
  }
}

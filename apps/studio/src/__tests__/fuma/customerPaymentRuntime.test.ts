import { describe, expect, it } from 'bun:test'
import type { DbClient, DbResult } from '../../../server/db/client'
import { DeterministicCustomerPaymentCipher } from '../../../server/fuma/customerPayments/fakes'
import { createHostedCustomerPaymentRuntime } from '../../../server/fuma/customerPayments/runtime'
import { PaystackPurposeRegistry } from '../../../server/fuma/paystack/transport'

function db(): DbClient {
  const query = (async <Row>(): Promise<DbResult<Row>> => ({ rows: [], rowCount: 0 })) as DbClient
  query.unsafe = async () => ({ rows: [], rowCount: 0 })
  query.transaction = async (work) => work(query)
  return Object.assign(query, { dialect: 'postgres' as const })
}

describe('FUMA-058 hosted customer-payment composition', () => {
  it('registers the membership and reviewed plugin purposes and returns every route/job/transfer integration seam', () => {
    const registry = new PaystackPurposeRegistry()
    const runtime = createHostedCustomerPaymentRuntime({
      db: db(),
      registry,
      cipher: new DeterministicCustomerPaymentCipher(),
      transports: { forCredential: () => { throw new Error('provider access is not used during composition') } },
      cardTransports: { forCredential: () => { throw new Error('provider access is not used during composition') } },
      catalog: { exact: async () => null },
      recurrence: { supports: async () => false },
      access: { sync: async () => {} },
      reminders: { deliver: async () => {} },
      payerAuthority: { resolve: async () => null },
      transferOwner: { assertCurrent: async () => {} },
      now: () => new Date('2026-07-28T00:00:00.000Z'),
    })

    expect(registry.registered('customer_merchant')).toEqual([
      'fuma-plugin-checkout',
      'fuma-plugin-deposit',
      'fuma-plugin-donation',
      'publication-membership',
    ])
    expect(runtime.pluginPayments).toBeDefined()
    expect(runtime.pluginRepository).toBeDefined()
    expect(runtime.scopedRoutes.map(({ path }) => path)).toEqual(['/publication/payments/merchant-credentials'])
    expect(runtime.memberPayments.handles(new Request('https://site.example/__fuma/publication/payments/initialize'))).toBe(true)
    expect(runtime.webhooks.handles(new Request('https://app.example/_fuma/paystack/webhooks/customer-merchant/credential-1'))).toBe(true)
    expect(runtime.transferStep).toMatchObject({ id: 'customer-merchant-credentials', order: 610 })
    expect(runtime.cardRenewal).toBeDefined()
    expect(runtime.lifecycle).toBeDefined()
  })
})

import { describe, expect, it } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import { paystackPrimitivesMigration } from '../../../server/fuma/db/migrations/000025_paystack_primitives'
import { paystackReconciliationMigration } from '../../../server/fuma/db/migrations/000045_paystack_reconciliation'
import { PostgresPaystackLedger } from '../../../server/fuma/paystack/repository'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const NOW = '2026-07-26T16:00:00.000Z'

function quotedIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe PostgreSQL schema identifier.')
  return `"${value}"`
}

function scopedPostgresUrl(connectionString: string, schema: string): string {
  const url = new URL(connectionString)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}

describe('FUMA-053 live PostgreSQL Paystack ledger acceptance', () => {
  it.skipIf(postgresUrl === undefined)(
    'persists scope-isolated initialization, webhook dedupe, and settlement reconciliation',
    async () => {
      if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
      const admin = createPostgresClient(postgresUrl)
      const schema = `fuma_paystack_${process.pid}_${Date.now()}`
      await admin.unsafe(`create schema ${quotedIdentifier(schema)}`)
      const db = createPostgresClient(scopedPostgresUrl(postgresUrl, schema))
      try {
        await db.transaction(async (tx) => {
          await tx.unsafe(paystackPrimitivesMigration.sql)
          await tx.unsafe(paystackReconciliationMigration.sql)
        })
        let claimId = 0
        const repository = new PostgresPaystackLedger(db, {
          now: () => new Date(NOW),
          claimFactory: () => `claim-${++claimId}`,
          claimLeaseMs: 30_000,
        })
        const platform = repository.forScope('platform_billing')
        const customer = repository.forScope('customer_merchant')
        const platformInitialization = {
          reference: 'pb_platform-recurring_postgres-0001',
          purpose: 'platform-recurring',
          money: { amountMinor: 10_001, currency: 'KES' },
          metadataHash: 'a'.repeat(64),
        } as const
        const customerInitialization = {
          reference: 'cm_publication-membership_postgres-01',
          purpose: 'publication-membership',
          money: { amountMinor: 25_002, currency: 'KES' },
          metadataHash: 'b'.repeat(64),
        } as const
        expect(await platform.recordInitialization(platformInitialization)).toBe(true)
        expect(await platform.recordInitialization(platformInitialization)).toBe(false)
        expect(await customer.recordInitialization(customerInitialization)).toBe(true)
        expect(await platform.exactInitialization(platformInitialization)).toBe(true)
        expect(await customer.exactInitialization(platformInitialization)).toBe(false)
        await expect(platform.recordInitialization({
          ...platformInitialization,
          money: { amountMinor: 10_002, currency: 'KES' },
        })).rejects.toMatchObject({ code: 'duplicate' })

        expect(await platform.ingestEvent('charge.success:postgres-1', 'c'.repeat(64))).toBe(true)
        expect(await platform.ingestEvent('charge.success:postgres-1', 'c'.repeat(64))).toBe(false)
        expect(await customer.ingestEvent('charge.success:postgres-1', 'd'.repeat(64))).toBe(true)
        await expect(platform.ingestEvent(
          'charge.success:postgres-1',
          'e'.repeat(64),
        )).rejects.toMatchObject({ code: 'duplicate' })

        const platformIdentity = {
          ...platformInitialization,
          providerTransactionId: 'provider-transaction-shared-id',
        } as const
        const customerIdentity = {
          ...customerInitialization,
          providerTransactionId: 'provider-transaction-shared-id',
        } as const
        const first = await platform.claimSettlement(platformIdentity)
        expect(first.state).toBe('claimed')
        expect((await platform.claimSettlement(platformIdentity)).state).toBe('busy')
        if (first.state !== 'claimed') throw new Error('Expected a settlement claim.')
        await platform.completeSettlement(first.claim)
        expect((await platform.claimSettlement(platformIdentity)).state).toBe('settled')

        const customerClaim = await customer.claimSettlement(customerIdentity)
        expect(customerClaim.state).toBe('claimed')
        if (customerClaim.state !== 'claimed') throw new Error('Expected a customer settlement claim.')
        await customer.releaseSettlement(customerClaim.claim)
        const retry = await customer.claimSettlement(customerIdentity)
        expect(retry.state).toBe('claimed')
        if (retry.state !== 'claimed') throw new Error('Expected a retried customer claim.')
        await customer.completeSettlement(retry.claim)

        const counts = await db.unsafe<{ scope: string; count: number | string }>(`
          select scope, count(*) as count
          from fuma_paystack_settlements
          group by scope order by scope
        `)
        expect(counts.rows.map((row) => [row.scope, Number(row.count)])).toEqual([
          ['customer_merchant', 1],
          ['platform_billing', 1],
        ])
        process.stdout.write(
          '[FUMA-053 PostgreSQL demo] platform=settled customer=release+retry+settled scopes=isolated events=deduplicated\n',
        )
      } finally {
        await admin.unsafe(`drop schema if exists ${quotedIdentifier(schema)} cascade`)
      }
    },
    30_000,
  )
})

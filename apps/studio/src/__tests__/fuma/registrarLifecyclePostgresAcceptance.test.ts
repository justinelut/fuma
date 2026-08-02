import { describe, expect, it } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import { registrarLifecycleAuthorityMigration } from '../../../server/fuma/db/migrations/000065_registrar_lifecycle_authority'
import { PostgresRegistrarWorkflowRepository } from '../../../server/fuma/registrar/postgres'
import {
  createRegistrarHarness,
  purchaseCommand,
  quoted,
  registrarScope,
  renewalCommand,
} from './registrarLifecycleTestFixture'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL

function quotedIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe PostgreSQL schema identifier.')
  return `"${value}"`
}

function scopedPostgresUrl(connectionString: string, schema: string): string {
  const url = new URL(connectionString)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}

describe('FUMA-061 optional live PostgreSQL registrar acceptance', () => {
  it.skipIf(postgresUrl === undefined)(
    'persists one exact purchase/renewal receipt and completed DNS handoff under full owner authority',
    async () => {
      if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
      const admin = createPostgresClient(postgresUrl)
      const schema = `fuma_registrar_${process.pid}_${Date.now()}`
      await admin.unsafe(`create schema ${quotedIdentifier(schema)}`)
      const db = createPostgresClient(scopedPostgresUrl(postgresUrl, schema))
      try {
        await db.unsafe(registrarLifecycleAuthorityMigration.sql)
        const repository = new PostgresRegistrarWorkflowRepository(db)
        const harness = createRegistrarHarness({ repository })
        const quote = await quoted(harness)
        const command = purchaseCommand(quote)
        const purchase = await harness.workflow.purchase(registrarScope, command)

        const duplicates = await Promise.all(Array.from(
          { length: 8 },
          async () => await harness.workflow.purchase(registrarScope, command),
        ))
        expect(new Set(duplicates.map((receipt) => receipt.receiptId))).toEqual(new Set([purchase.receiptId]))
        expect(harness.provider.purchases.size).toBe(1)
        expect(harness.onboarding.handoffs).toHaveLength(1)
        expect(await repository.quote({ ...registrarScope, state: 'transferring', transferFence: 9 }, quote.quoteId)).toBeNull()

        const registration = await repository.registration(registrarScope, purchase.registrationId)
        const renewalQuote = await quoted(harness)
        const renewal = await harness.workflow.renew(
          registrarScope,
          renewalCommand(renewalQuote, registration!),
        )
        expect(renewal).toMatchObject({
          previousExpiresAt: registration!.expiresAt,
          amountMinor: 130_000,
          currency: 'KES',
        })
        expect(await repository.registrations(registrarScope)).toHaveLength(1)

        const purchaseRows = await db.unsafe<{ count: number | string }>('select count(*)::int as count from fuma_registrar_purchase_receipts_v2')
        const renewalRows = await db.unsafe<{ count: number | string }>('select count(*)::int as count from fuma_registrar_renewal_receipts_v2')
        const handoffRows = await db.unsafe<{ state: string }>('select state from fuma_registrar_dns_handoffs_v2')
        expect(Number(purchaseRows.rows[0]?.count)).toBe(1)
        expect(Number(renewalRows.rows[0]?.count)).toBe(1)
        expect(handoffRows.rows).toEqual([{ state: 'completed' }])
        await expect(db.unsafe(
          "update fuma_registrar_purchase_receipts_v2 set receipt_json='{}'::jsonb",
        )).rejects.toThrow('registrar receipt evidence is immutable')
      } finally {
        await admin.unsafe(`drop schema if exists ${quotedIdentifier(schema)} cascade`)
      }
    },
    30_000,
  )
})

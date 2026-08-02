import { describe, expect, it } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import { customerMerchantPaymentsV2Migration } from '../../../server/fuma/db/migrations/000061_customer_merchant_payments_v2'
import { PostgresCustomerPaymentRepository } from '../../../server/fuma/customerPayments/repository'
import { PostgresCustomerCredentialTransferRepository } from '../../../server/fuma/customerPayments/transferStep'
import type { PublicationMembershipMetadata, PublicationMerchantScope } from '../../../server/fuma/customerPayments/contracts'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const scope: PublicationMerchantScope = Object.freeze({
  platformId: 'platform-live', organizationId: 'organization-live', workspaceId: 'workspace-live',
  siteId: 'site-live', ownerKey: 'owner-live', ownerGeneration: 2,
})
const NOW = '2026-07-28T10:00:00.000Z'

function quoted(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe schema identifier.')
  return `"${value}"`
}
function scopedUrl(connection: string, schema: string): string {
  const url = new URL(connection)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}
function metadata(overrides: Partial<PublicationMembershipMetadata> = {}): PublicationMembershipMetadata {
  return Object.freeze({
    purchaseId: 'purchase:live0000000000000000000000000000000000',
    ...scope,
    memberId: 'member-live', tierId: 'tier-live', credentialId: 'credential-live', credentialVersion: 1,
    amountMinor: 5_000, currency: 'KES', periodDays: 30, graceDays: 5, channel: 'card',
    mobileProvider: null, renewalOfMembershipId: null, renewalConfirmationId: null,
    ...overrides,
  })
}

describe('FUMA-058 optional live PostgreSQL acceptance', () => {
  it.skipIf(postgresUrl === undefined)('converges payment state and recovers credential transfer', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_customer_payments_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quoted(schema)}`)
    const db = createPostgresClient(scopedUrl(postgresUrl, schema))
    try {
      await db.unsafe(customerMerchantPaymentsV2Migration.sql)
      const repository = new PostgresCustomerPaymentRepository(db)
      await repository.saveCredential({
        credentialId: 'credential-live', scope: 'customer_merchant', merchantScope: scope, version: 1,
        envelope: { ciphertext: 'fixture-ciphertext', keyId: 'fixture-key' }, state: 'active',
        createdAt: NOW, updatedAt: NOW,
      })
      const obligation = metadata()
      const prepared = await Promise.all(Array.from({ length: 8 }, () => repository.preparePurchase(obligation, NOW)))
      expect(new Set(prepared.map(({ metadata: value }) => value.purchaseId)).size).toBe(1)
      const reference = 'cm_publication-membership_live0000000000001'
      await repository.recordInitialization(obligation, reference, 'https://checkout.example.test/live')
      const transaction = Object.freeze({
        scope: 'customer_merchant' as const, reference, status: 'success' as const,
        money: Object.freeze({ amountMinor: 5_000, currency: 'KES' }),
        channel: 'card', channelDetail: 'visa', customerCode: 'CUS_live',
        authorizationCode: 'AUTH_live', reusableAuthorization: true,
        providerTransactionId: 'transaction-live',
      })
      const activated = await Promise.all(Array.from({ length: 8 }, () => repository.activate({
        metadata: obligation,
        transaction,
        recurringAuthorization: { ciphertext: 'fixture-authorization', keyId: 'fixture-key' },
        recurringCustomerCode: 'CUS_live',
        activatedAt: NOW,
      })))
      expect(new Set(activated.map(({ membershipId }) => membershipId)).size).toBe(1)
      expect((await repository.cardRenewalAuthority(scope, 'member-live', activated[0]!.membershipId))?.customerCode)
        .toBe('CUS_live')

      const firstMobile = metadata({
        purchaseId: 'purchase:mobile000000000000000000000000000000000',
        tierId: 'mobile-live', channel: 'mobile_money', mobileProvider: 'airtel',
        renewalConfirmationId: 'confirmation-live',
      })
      await repository.preparePurchase(firstMobile, NOW)
      const secondMobile = metadata({
        purchaseId: 'purchase:mobile111111111111111111111111111111111',
        tierId: 'mobile-live', channel: 'mobile_money', mobileProvider: 'airtel',
        renewalConfirmationId: 'confirmation-live',
      })
      await expect(repository.preparePurchase(secondMobile, NOW)).rejects.toMatchObject({ code: 'conflict' })

      const lifecycle = await repository.processLifecycle('2026-09-05T10:00:00.000Z', 100, null)
      expect(lifecycle.memberships[0]?.state).toBe('expired')
      expect(lifecycle.reminders[0]?.kind).toBe('expired')

      const transfer = new PostgresCustomerCredentialTransferRepository(db)
      const destination = { ...scope, organizationId: 'organization-new', workspaceId: 'workspace-new', ownerKey: 'owner-new', ownerGeneration: 1 }
      await transfer.recordChoice({ transferId: 'transfer-live', source: scope, destination, choice: 'rekey', recordedAt: NOW })
      const saga = { transferId: 'transfer-live', lockId: 'lock-live', fence: 5 }
      expect((await transfer.apply('transfer-live', saga)).credentialState).toBe('rekey-required')
      expect((await transfer.compensate('transfer-live', saga)).credentialState).toBe('active')

      const counts = await db.unsafe<{ credentials: string; purchases: string; memberships: string; transactions: string }>(`
        select
          (select count(*) from fuma_customer_merchant_credentials_v2)::text credentials,
          (select count(*) from fuma_customer_membership_purchases_v2)::text purchases,
          (select count(*) from fuma_publication_memberships_v2)::text memberships,
          (select count(*) from fuma_customer_payment_transactions_v2)::text transactions
      `)
      expect(counts.rows[0]).toEqual({ credentials: '1', purchases: '2', memberships: '1', transactions: '1' })
      process.stdout.write('[FUMA-058 PostgreSQL demo] concurrent=8 membership=1 cardAuthority=1 mobileConfirmation=unique lifecycle=expired transfer=rekey+compensated\n')
    } finally {
      await admin.unsafe(`drop schema if exists ${quoted(schema)} cascade`)
    }
  }, 30_000)
})

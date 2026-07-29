import { describe, expect, test } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import { customerMerchantPaymentsV2Migration } from '../../../server/fuma/db/migrations/000061_customer_merchant_payments_v2'
import { artifactInstallationAuthorityMigration } from '../../../server/fuma/db/migrations/000070_artifact_installation_authority'
import { customerPaymentPluginMigration } from '../../../server/fuma/db/migrations/000073_customer_payment_plugin'
import { PostgresCustomerPaymentRepository } from '../../../server/fuma/customerPayments/repository'
import { PostgresCustomerPluginPaymentRepository } from '../../../server/fuma/customerPayments/pluginRepository'
import type { CustomerPluginPaymentMetadata, ReviewedCustomerPaymentPluginAuthority } from '../../../server/fuma/customerPayments/pluginContracts'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const NOW = '2026-07-31T08:00:00.000Z'
const scope = Object.freeze({ platformId: 'platform-pg', organizationId: 'organization-pg', workspaceId: 'workspace-pg', siteId: 'site-pg', ownerKey: 'owner-pg', ownerGeneration: 3 })
const HASH = 'a'.repeat(64)

function quote(value: string): string { if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe schema.'); return `"${value}"` }
function scoped(connection: string, schema: string): string { const url = new URL(connection); url.searchParams.set('options', `-c search_path=${schema},public`); return url.toString() }

async function allFulfilled<T>(promises: readonly Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(promises)
  const rejected = results.filter((result) => result.status === 'rejected')
  if (rejected.length > 0) throw (rejected[0] as PromiseRejectedResult).reason
  return results.map((result) => (result as PromiseFulfilledResult<T>).value)
}

async function prerequisites(db: ReturnType<typeof createPostgresClient>) {
  await db.unsafe(`
    create table fuma_tenant_owner_keys (
      platform_id text not null, owner_key text not null, organization_id text not null,
      workspace_id text not null, site_id text not null, state text not null,
      generation bigint not null, transfer_id text null, transfer_lock_id text null,
      transfer_fence bigint null, created_at timestamptz not null, updated_at timestamptz not null,
      primary key(platform_id,owner_key),
      unique(platform_id,owner_key,organization_id,workspace_id,site_id,generation)
    );
  `)
  await db`insert into fuma_tenant_owner_keys (
    platform_id,owner_key,organization_id,workspace_id,site_id,state,generation,created_at,updated_at
  ) values (${scope.platformId},${scope.ownerKey},${scope.organizationId},${scope.workspaceId},${scope.siteId},'active',${scope.ownerGeneration},${NOW},${NOW})`
  await db.unsafe(customerMerchantPaymentsV2Migration.sql)
  await db.unsafe(artifactInstallationAuthorityMigration.sql)
  await db.unsafe(customerPaymentPluginMigration.sql)
  const release = { schemaVersion: 1, artifactId: 'artifact-pg-payment', kind: 'plugin', packageId: 'fuma.customer-payments', exactVersion: '1.0.0', executionPolicy: 'plugin-sandbox-worker', objectKey: 'artifacts/plugin/fuma.customer-payments/1.0.0.zip', mimeType: 'application/zip', contentHashSha256: HASH, sizeBytes: 100, permissions: ['cms.routes','modules.register','payments.customer.create','payments.customer.refund'], provenance: { sourceHashSha256: 'b'.repeat(64), lockHashSha256: 'c'.repeat(64), builderId: 'builder-pg' }, createdAt: NOW }
  await db`insert into fuma_artifact_releases_v2 (
    artifact_id,artifact_kind,package_id,exact_version,execution_policy,object_key,mime_type,
    content_hash_sha256,size_bytes,permissions_json,provenance_json,artifact_json,created_at
  ) values (
    ${release.artifactId},${release.kind},${release.packageId},${release.exactVersion},${release.executionPolicy},
    ${release.objectKey},${release.mimeType},${release.contentHashSha256},${release.sizeBytes},
    ${JSON.stringify(release.permissions)}::text::jsonb,${JSON.stringify(release.provenance)}::text::jsonb,
    ${JSON.stringify(release)}::text::jsonb,${NOW}
  )`
  const installation = { ...scope, installationId: 'installation-pg-payment', artifactId: release.artifactId, artifactKind: 'plugin', packageId: release.packageId, exactVersion: release.exactVersion, contentHashSha256: HASH, executionPolicy: 'plugin-sandbox-worker', settingsObjectKey: null, secret: null, state: 'active', workerGeneration: 1, quota: { storageBytes: 1024, scheduledJobs: 0, callsPerMinute: 100 }, previousArtifactId: null, version: 1, installedAt: NOW, updatedAt: NOW }
  await db`insert into fuma_artifact_installations_v2 (
    platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,installation_id,
    artifact_id,artifact_kind,package_id,exact_version,content_hash_sha256,execution_policy,
    settings_object_key,secret_json,state,worker_generation,storage_quota_bytes,schedule_quota,
    calls_per_minute,previous_artifact_id,version,installation_json,installed_at,updated_at
  ) values (
    ${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},
    ${scope.ownerGeneration},${installation.installationId},${release.artifactId},'plugin',${release.packageId},
    ${release.exactVersion},${HASH},'plugin-sandbox-worker',null,null,'active',1,1024,0,100,null,1,
    ${JSON.stringify(installation)}::text::jsonb,${NOW},${NOW}
  )`
  const credentials = new PostgresCustomerPaymentRepository(db)
  await credentials.saveCredential({ credentialId: 'credential-pg-payment', scope: 'customer_merchant', merchantScope: scope, version: 1, envelope: { ciphertext: 'fixture-ciphertext', keyId: 'fixture-key' }, state: 'active', createdAt: NOW, updatedAt: NOW })
}

function authority(): ReviewedCustomerPaymentPluginAuthority {
  return { merchantScope: scope, installationId: 'installation-pg-payment', artifactId: 'artifact-pg-payment', packageId: 'fuma.customer-payments', exactVersion: '1.0.0', contentHashSha256: HASH, reviewSubmissionId: 'submission-pg-payment', reviewDecisionId: 'decision-pg-payment', reviewSignatureKeyId: 'review-key-pg', siteOrigin: 'https://site.example.test' }
}
function metadata(): CustomerPluginPaymentMetadata {
  return { paymentId: 'plugin-payment:pg00000000000000000000000000000000000000', requestId: 'request-pg-payment', purpose: 'checkout', amountMinor: 25_000, currency: 'KES', returnPath: '/complete', ...scope, installationId: 'installation-pg-payment', artifactId: 'artifact-pg-payment', contentHashSha256: HASH, exactVersion: '1.0.0', reviewSubmissionId: 'submission-pg-payment', reviewDecisionId: 'decision-pg-payment', reviewSignatureKeyId: 'review-key-pg', credentialId: 'credential-pg-payment', credentialVersion: 1 }
}

describe('FUMA-069 optional native PostgreSQL acceptance', () => {
  test.skipIf(!postgresUrl)('persists one exact receipt and one replay-safe refund under concurrency', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_payment_plugin_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quote(schema)}`)
    const db = createPostgresClient(scoped(postgresUrl, schema))
    try {
      await prerequisites(db)
      const repository = new PostgresCustomerPluginPaymentRepository(db)
      const obligation = metadata()
      const prepared = await allFulfilled(Array.from({ length: 8 }, () => repository.preparePayment(obligation, 'd'.repeat(64), NOW)))
      expect(new Set(prepared.map(({ metadata: value }) => value.paymentId)).size).toBe(1)
      const reference = 'cm_fuma-plugin-checkout_pg00000000000000000000000000000000000000'
      await repository.recordInitialization(obligation, reference, 'https://checkout.example.test/pg')
      const transaction = { scope: 'customer_merchant' as const, reference, status: 'success' as const, money: { amountMinor: 25_000, currency: 'KES' }, channel: 'card', channelDetail: 'visa', customerCode: null, authorizationCode: null, reusableAuthorization: false, providerTransactionId: 'provider-transaction-pg' }
      const receipts = await allFulfilled(Array.from({ length: 8 }, () => repository.settle(obligation, transaction, NOW)))
      expect(new Set(receipts.map(({ receiptId }) => receiptId)).size).toBe(1)
      const receipt = receipts[0]!
      const payment = await repository.payment(authority(), obligation.paymentId)
      if (!payment) throw new Error('payment missing')
      const refundRecords = await allFulfilled(Array.from({ length: 8 }, () => repository.prepareRefund(payment, receipt, 'refund-request-pg', 'e'.repeat(64), NOW)))
      expect(new Set(refundRecords.map(({ refundId }) => refundId)).size).toBe(1)
      const refunds = await allFulfilled(Array.from({ length: 8 }, () => repository.completeRefund(refundRecords[0]!, 'f'.repeat(64), NOW)))
      expect(new Set(refunds.map(({ refundId }) => refundId)).size).toBe(1)
      expect((await repository.refund(authority(), receipt.receiptId))?.state).toBe('refunded')
      expect(await repository.payment({ ...authority(), merchantScope: { ...scope, siteId: 'foreign-site' } }, obligation.paymentId)).toBeNull()
      await expect(db`update fuma_customer_plugin_receipts_v1 set settled_at=now() where receipt_id=${receipt.receiptId}`).rejects.toThrow('append-only')
      const counts = await db<{ payments: string; receipts: string; refunds: string }>`select (select count(*) from fuma_customer_plugin_payments_v1)::text payments,(select count(*) from fuma_customer_plugin_receipts_v1)::text receipts,(select count(*) from fuma_customer_plugin_refunds_v1)::text refunds`
      expect(counts.rows[0]).toEqual({ payments: '1', receipts: '1', refunds: '1' })
      process.stdout.write('[FUMA-069 PostgreSQL demo] concurrent=8 payment=1 receipt=1 refund=1 immutable=true foreignScope=denied\n')
    } finally {
      await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`)
      const leftover = await admin<{ count: string | number | bigint }>`select count(*) count from pg_namespace where nspname=${schema}`
      expect(Number(leftover.rows[0]?.count ?? 0)).toBe(0)
    }
  }, 120_000)
})

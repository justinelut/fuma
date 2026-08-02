import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../..')
const BILLING = join(ROOT, 'server/fuma/billing')

function source(file: string): string {
  return readFileSync(join(BILLING, file), 'utf8')
}

describe('FUMA-056 platform billing reconciliation architecture', () => {
  it('keeps the billing authority TypeBox-only, server-local, and credential scoped', () => {
    const files = readdirSync(BILLING).filter((file) => file.endsWith('.ts'))
    const combined = files.map(source).join('\n')
    expect(combined).toContain("transport.scope !== 'platform_billing'")
    expect(combined).toContain('PlatformBillingJobPayloadSchema')
    expect(combined).not.toMatch(/(?:from|import\()\s*['"]zod['"]|\bz\.(?:object|string|number)\s*\(/)
    expect(combined).not.toMatch(/from\s+['"][^'"]*apps\//)
  })

  it('verifies raw signatures before local parsing and stores no raw webhook body', () => {
    const reconciler = source('reconciler.ts')
    expect(reconciler.indexOf('this.#transport.ingestWebhook(raw, signature)'))
      .toBeLessThan(reconciler.indexOf('JSON.parse'))
    expect(reconciler).toContain('rawSha256: sha256(raw)')
    expect(reconciler).not.toMatch(/raw(?:Body|Json|Payload)\s*:/)
  })

  it('ships ordered leased PostgreSQL reduction and exact provider verification', () => {
    const postgres = source('postgres.ts')
    const reconciler = source('reconciler.ts')
    expect(postgres).toContain("hashtextextended(${'fuma:platform-billing-reduction'},0)")
    expect(postgres).toContain("where state='stored'")
    expect(postgres).toContain('order by provider_sequence,event_id limit 1 for update')
    expect(reconciler).toContain('this.#transport.verify(')
    expect(postgres).toContain('provider_transaction_id=coalesce')
    expect(postgres).toContain('Provider transaction was reused across obligations.')
  })

  it('activates only complete exact obligations and emits one private handoff without ownership mutation', () => {
    const postgres = source('postgres.ts')
    expect(postgres).toContain('const complete = Number(value.total) === Number(value.settled)')
    expect(postgres).toContain("'paid-transfer-pending'")
    expect(postgres).toContain('insert into fuma_paid_handoff_outbox')
    expect(postgres).toContain('on conflict (contract_id) do nothing')
    expect(postgres).not.toMatch(/update\s+fuma_tenant_owner_keys|update\s+fuma_sites\s+set\s+organization_id/i)
  })

  it('registers a trusted durable retry job and startup recovery triggers', () => {
    const runtime = source('runtime.ts')
    expect(runtime).toContain("PLATFORM_BILLING_RECONCILE_JOB = 'fuma.billing-reconcile'")
    expect(runtime).toContain("context.jobContext.kind !== 'organization'")
    expect(runtime).toContain('context.jobContext.scope.organization.id !== protectedOrganizationId')
    expect(runtime).toContain('pendingEventIds(1_000)')
    expect(runtime).toContain('idempotencyKey: `platform-billing-event:${eventId}`')
  })

  it('finalizes additive migration 000059 without modifying historical billing/checkout migrations', () => {
    const migration = readFileSync(
      join(ROOT, 'server/fuma/db/migrations/000059_platform_billing_reconciliation.ts'),
      'utf8',
    )
    const migrationExport = source('migration.ts')
    const manifest = readFileSync(join(ROOT, 'server/fuma/db/migrations/index.ts'), 'utf8')
    const releaseMigrationTest = readFileSync(
      join(ROOT, 'src/__tests__/fuma/releaseMigration.test.ts'),
      'utf8',
    )
    const historicalBilling = readFileSync(
      join(ROOT, 'server/fuma/db/migrations/000028_billing_reconciliation.ts'),
      'utf8',
    )
    const historicalCheckout = readFileSync(
      join(ROOT, 'server/fuma/db/migrations/000027_checkout.ts'),
      'utf8',
    )
    expect(migration).not.toMatch(/\b(?:drop table|drop constraint|truncate)\b|^\s*delete\s+from/im)
    expect(migration).toContain("id: '000059_platform_billing_reconciliation'")
    expect(migration).toContain('fuma_platform_subscription_reductions_v2')
    expect(migration).toContain('fuma_platform_obligation_settlement_guard_v2')
    expect(migration).toContain('fuma_settled_checkout_cancel_guard_v2')
    expect(migration).toContain('fuma_organization_contract_identity_guard_v2')
    expect(migrationExport).toContain("../db/migrations/000059_platform_billing_reconciliation")
    expect(manifest).toContain("'000059_platform_billing_reconciliation': '2e66877da6c258cb060cd0d525c70274509d8134248d7bb6c686fbb505e3d4a3'")
    expect(releaseMigrationTest).toContain(".toBe('000078_release_followup')")
    expect(historicalBilling).toContain("id:'000028_billing_reconciliation'")
    expect(historicalCheckout).toContain("id:'000027_checkout'")
  })

  it('composes hosted webhooks, shutdown, and durable worker registration centrally', () => {
    const server = readFileSync(join(ROOT, 'server/index.ts'), 'utf8')
    const worker = readFileSync(
      join(ROOT, 'server/fuma/publication/workerComposition.ts'),
      'utf8',
    )
    expect(server).toContain('await createHostedPlatformBillingRuntime({')
    expect(server).toContain('platformCheckoutRuntime && paystackRuntime && hostedFumaConfig')
    expect(server).toContain('platformBillingRuntime?.webhooks ?? paystackRuntime?.webhooks')
    expect(server).toContain('platformBillingRuntime?.close()')
    expect(worker).toContain('createHostedPaystackRuntime({ db, config })')
    expect(worker.indexOf('registerPlatformCheckoutPurposes(paystack.registry, checkoutRepository)'))
      .toBeLessThan(worker.indexOf('createPlatformBillingRuntime({'))
    expect(worker).toContain('...billing.jobs')
    expect(source('runtime.ts')).toContain("PLATFORM_BILLING_RECONCILE_JOB = 'fuma.billing-reconcile'")
  })

  it('keeps all new billing modules below the repository source ceiling', () => {
    for (const file of readdirSync(BILLING).filter((candidate) => candidate.endsWith('.ts'))) {
      expect(source(file).split('\n').length, file).toBeLessThanOrEqual(700)
    }
  })
})

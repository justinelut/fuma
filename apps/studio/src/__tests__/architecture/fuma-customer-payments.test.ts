import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertHostedMigrationIsAdditive } from '../../../server/fuma/db/migrationPolicy'
import { customerMerchantPaymentsV2Migration } from '../../../server/fuma/db/migrations/000061_customer_merchant_payments_v2'

const ROOT = join(import.meta.dir, '../../..')
const DIRECTORY = join(ROOT, 'server/fuma/customerPayments')
function source(file: string): string { return readFileSync(join(DIRECTORY, file), 'utf8') }

describe('FUMA-058 customer payments architecture', () => {
  it('keeps every customer payment boundary server-local, TypeBox-only, and app/UI independent', () => {
    const combined = readdirSync(DIRECTORY)
      .filter((file) => file.endsWith('.ts'))
      .map(source)
      .join('\n')
    expect(combined).toContain("from '@core/utils/typeboxHelpers'")
    expect(combined).not.toMatch(/(?:from|import\()\s*['"]zod['"]|\bz\.(?:object|string|number)\s*\(/)
    expect(combined).not.toMatch(/from\s+['"][^'"]*apps\//)
    expect(combined).not.toMatch(/from\s+['"][^'"]*(?:src\/admin|src\/ui|shared-ui)/)
  })

  it('owns separate merchant/member routes and reuses only exact customer webhook scope', () => {
    const routes = source('routes.ts')
    const service = source('service.ts')
    const webhook = readFileSync(join(ROOT, 'server/fuma/paystack/boundary.ts'), 'utf8')
    expect(routes).toContain("'/publication/payments/merchant-credentials'")
    expect(routes).toContain("'/__fuma/publication/payments/'")
    expect(routes).toContain("capabilities.includes('publication.members')")
    expect(service).toContain("transport.scope !== 'customer_merchant'")
    expect(webhook).toContain("customer_merchant: '/_fuma/paystack/webhooks/customer-merchant'")
    expect(webhook).toContain('separate transport instances')
  })

  it('enforces Kenya KES, explicit mobile confirmation, supported cards, verified labels, and no Daraja adapter', () => {
    const contracts = source('contracts.ts')
    const service = source('service.ts')
    expect(contracts).toContain("Type.Literal('KES')")
    expect(contracts).toContain("Type.Literal('safaricom')")
    expect(contracts).toContain("Type.Literal('airtel')")
    expect(service).toContain("country: 'KE'")
    expect(service).toContain('renewalConfirmationId === null')
    expect(service).toContain('reusableAuthorization')
    expect(service).toContain('Verified transaction does not match the exact membership obligation.')
    expect(service).toContain('Daraja is not implemented.')
    expect(source('fakes.ts')).not.toMatch(/fetch\s*\(|https:\/\/api\.|sandbox\.paystack/)
  })

  it('ships durable recurrence, lifecycle/reminder, transaction, and transfer recovery authority', () => {
    const repository = source('repository.ts')
    const transfer = source('transferStep.ts')
    expect(repository).toContain('fuma_customer_card_authorizations_v2')
    expect(repository).toContain('source_metadata_json')
    expect(repository).toContain('fuma_customer_membership_reminders_v2')
    expect(repository).toContain('Verified provider transaction was already used for another obligation.')
    expect(transfer).toContain("choice === 'rekey' ? 'rekey-required' : 'detached'")
    expect(transfer).toContain('compensation_receipt_json')
    expect(transfer).toContain('assertCurrent')
    expect(transfer).toContain('credential_id=c.credential_id')
  })

  it('keeps the conductor-finalized additive migration centrally registered', () => {
    const migration = readFileSync(join(ROOT, 'server/fuma/db/migrations/000061_customer_merchant_payments_v2.ts'), 'utf8')
    const index = readFileSync(join(ROOT, 'server/fuma/db/migrations/index.ts'), 'utf8')
    expect(customerMerchantPaymentsV2Migration.id).toBe('000061_customer_merchant_payments_v2')
    expect(() => assertHostedMigrationIsAdditive(customerMerchantPaymentsV2Migration)).not.toThrow()
    expect(migration).toContain('fuma_customer_mobile_confirmation_v2')
    expect(migration).toContain('source_metadata_json')
    expect(migration).toContain('credential_version integer null')
    expect(index).toContain('customerMerchantPaymentsV2Migration')
    expect(index).toContain('000061_customer_merchant_payments_v2')
  })

  it('keeps all ticket-owned modules under the 700-line source ceiling', () => {
    for (const file of readdirSync(DIRECTORY).filter((candidate) => candidate.endsWith('.ts'))) {
      expect(source(file).split('\n').length, file).toBeLessThanOrEqual(700)
    }
  })
})

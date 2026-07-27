import { describe, expect, it } from 'bun:test'
import { meteringReconciliationControlMigration } from '../../../server/fuma/db/migrations/000055_metering_reconciliation_control'
import { assertHostedMigrationIsAdditive, hostedMigrationChecksum } from '../../../server/fuma/db/migrationPolicy'

export const FUMA_052_MIGRATION_CHECKSUM = hostedMigrationChecksum(meteringReconciliationControlMigration.sql)

describe('FUMA-052 hosted migration 000055', () => {
  it('is additive, forward-only, and ready for conductor checksum finalization', () => {
    expect(meteringReconciliationControlMigration.id).toBe('000055_metering_reconciliation_control')
    expect(() => assertHostedMigrationIsAdditive(meteringReconciliationControlMigration)).not.toThrow()
    expect(FUMA_052_MIGRATION_CHECKSUM).toMatch(/^[a-f0-9]{64}$/)
  })

  it('adds explicit provider ownership, unique snapshots, internal shadow evidence, and immutable triggers', () => {
    const sql = meteringReconciliationControlMigration.sql.replaceAll(/\s+/g, ' ').toLowerCase()
    expect(sql).toContain('provider text generated always as')
    expect(sql).toContain('fuma_provider_cost_nonzero')
    expect(sql).toContain('unique (provider, period_start, period_end, meter)')
    expect(sql).toContain('internal_shadow_cost_usd_micros')
    expect(sql).toContain('fuma_provider_usage_immutable')
    expect(sql).toContain('fuma_meter_reconciliation_immutable')
  })
})

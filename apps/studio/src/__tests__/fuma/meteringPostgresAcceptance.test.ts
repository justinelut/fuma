import { describe, expect, it } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import { meteringMigration } from '../../../server/fuma/db/migrations/000024_metering'
import { meteringReconciliationControlMigration } from '../../../server/fuma/db/migrations/000055_metering_reconciliation_control'
import {
  HOSTED_COST_BASELINE_V1,
  METER_CLASSES,
  PostgresProviderCostCatalog,
  PostgresProviderUsageAuthority,
  PostgresUsageLedger,
  MeteringService,
  type MeterClass,
} from '../../../server/fuma/metering'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const NOW = new Date('2026-07-27T10:00:00.000Z')
const PERIOD = { periodStart: '2026-07-01T00:00:00.000Z', periodEnd: '2026-08-01T00:00:00.000Z' }

function quotedIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe PostgreSQL schema identifier.')
  return `"${value}"`
}

function scopedPostgresUrl(connectionString: string, schema: string): string {
  const url = new URL(connectionString)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}

describe('FUMA-052 optional live PostgreSQL acceptance', () => {
  it.skipIf(postgresUrl === undefined)(
    'serializes concurrent reservation consumption and durably reconciles complete provider snapshots',
    async () => {
      if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
      const admin = createPostgresClient(postgresUrl)
      const schema = `fuma_metering_${process.pid}_${Date.now()}`
      await admin.unsafe(`create schema ${quotedIdentifier(schema)}`)
      const db = createPostgresClient(scopedPostgresUrl(postgresUrl, schema))
      try {
        await db.transaction(async (tx) => {
          await tx.unsafe(meteringMigration.sql)
          await tx.unsafe(meteringReconciliationControlMigration.sql)
        })
        const costs = new PostgresProviderCostCatalog(db, () => NOW)
        for (const input of HOSTED_COST_BASELINE_V1) expect(await costs.append(input)).toBe(true)
        expect(await costs.append(HOSTED_COST_BASELINE_V1[0])).toBe(false)
        await expect(costs.append({ ...HOSTED_COST_BASELINE_V1[0], unitCostMinorUsdMicros: 999 }))
          .rejects.toMatchObject({ code: 'duplicate-mismatch' })
        await expect(costs.assertComplete()).resolves.toBeUndefined()

        const ledger = new PostgresUsageLedger(db)
        const service = new MeteringService(ledger, costs)
        const common = {
          organizationId: 'organization-a', workspaceId: 'workspace-a', siteId: 'site-a',
          meter: 'storage_source_bytes', occurredAt: '2026-07-20T00:00:00.000Z', internalWorkload: false,
        } as const
        const reservation = await service.reserve({ ...common, idempotencyKey: 'reserve', logicalUnits: 10, physicalUnits: 100 })
        const duplicateSettles = await Promise.all(Array.from({ length: 8 }, () => service.settle(reservation.entryId, {
          ...common, idempotencyKey: 'same-settlement', logicalUnits: 6, physicalUnits: 60,
        })))
        expect(new Set(duplicateSettles.map(({ entryId }) => entryId)).size).toBe(1)
        const competitors = await Promise.allSettled([
          service.settle(reservation.entryId, { ...common, idempotencyKey: 'compete-a', logicalUnits: 4, physicalUnits: 40 }),
          service.settle(reservation.entryId, { ...common, idempotencyKey: 'compete-b', logicalUnits: 4, physicalUnits: 40 }),
        ])
        expect(competitors.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
        expect(competitors.filter(({ status }) => status === 'rejected')).toHaveLength(1)
        expect(await ledger.remainingReservation(reservation.entryId)).toEqual({ logical: 0n, physical: 0n })

        const usage = new PostgresProviderUsageAuthority(db, () => NOW)
        const totals = {} as Record<MeterClass, bigint>
        for (const meter of METER_CLASSES) {
          const quote = await costs.cost(meter, 0)
          const variable = meter === 'storage_source_bytes' ? 200n : 0n
          totals[meter] = quote.fixed + variable
          expect(await usage.appendSnapshot({
            snapshotId: `snapshot-${meter}`, provider: quote.provider, ...PERIOD, meter,
            costMinorUsdMicros: Number(totals[meter]), sourceReferenceSha256: new Bun.CryptoHasher('sha256').update(meter).digest('hex'),
            observedAt: '2026-08-01T00:00:01.000Z',
          })).toBe(true)
        }
        expect(await usage.totalsForPeriod(PERIOD.periodStart, PERIOD.periodEnd)).toEqual(totals)
        const reconciliation = await service.reconcile({ ...PERIOD, idempotencyKey: 'postgres-period-v1', providerTotals: totals })
        expect(reconciliation.balanced).toBe(true)
        expect(await usage.recordReconciliation(reconciliation)).toBe(true)
        expect(await usage.recordReconciliation(reconciliation)).toBe(false)
        const counts = await db.unsafe<{ reconciliations: string | number; snapshots: string | number }>(`
          select (select count(*) from fuma_meter_reconciliations) as reconciliations,
                 (select count(*) from fuma_provider_usage_snapshots) as snapshots
        `)
        expect(Number(counts.rows[0]!.reconciliations)).toBe(1)
        expect(Number(counts.rows[0]!.snapshots)).toBe(METER_CLASSES.length)
        process.stdout.write('[FUMA-052 PostgreSQL demo] concurrentReplay=8 oversubscription=blocked snapshots=18 reconciliation=balanced immutable=recorded\n')
      } finally {
        await admin.unsafe(`drop schema if exists ${quotedIdentifier(schema)} cascade`)
      }
    },
    30_000,
  )
})

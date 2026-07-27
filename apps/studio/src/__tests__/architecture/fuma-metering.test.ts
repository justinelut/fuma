import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../..')
const DIRECTORY = join(ROOT, 'server/fuma/metering')
const source = (file: string) => readFileSync(join(DIRECTORY, file), 'utf8')
const all = () => readdirSync(DIRECTORY).filter((file) => file.endsWith('.ts')).map(source).join('\n')

describe('FUMA-052 metering architecture', () => {
  it('keeps strict TypeBox server contracts with no Zod or app-to-app imports', () => {
    const text = all()
    expect(text).toContain('UsageCommandSchema = Type.Object')
    expect(text).toContain('ProviderUsageSnapshotSchema = Type.Object')
    expect(text).toContain('MeterReconciliationJsonSchema = Type.Object')
    expect(text).toContain('{ additionalProperties: false }')
    expect(text).not.toMatch(/\b(?:zod|z\.object)\b/i)
    expect(text).not.toMatch(/from ['"](?:\.\.\/)+\.\.\/apps\//)
  })

  it('binds all provider inputs and snapshots to explicit meter ownership', () => {
    const contracts = source('contracts.ts')
    const service = source('service.ts')
    const postgres = source('postgres.ts')
    for (const provider of ['oracle', 'oci-email', 'cloudflare', 'internal']) expect(contracts).toContain(provider)
    expect(service).toContain('value.provider !== METER_PROVIDERS[value.meter]')
    expect(service).toContain('unitCostMinorUsdMicros === 0 && value.fixedCostMinorUsdMicros === 0')
    expect(postgres).toContain('value.provider !== METER_PROVIDERS[value.meter]')
    expect(postgres).toContain('Provider snapshot authority is ambiguous.')
  })

  it('serializes reservation consumption and rechecks replay after the parent row lock', () => {
    const postgres = source('postgres.ts')
    const lock = postgres.indexOf('for update')
    const duplicateAfterLock = postgres.indexOf('idempotency_key = ${entry.idempotencyKey}', lock)
    const consumedAfterLock = postgres.indexOf('coalesce(sum(logical_units)', lock)
    expect(lock).toBeGreaterThan(0)
    expect(duplicateAfterLock).toBeGreaterThan(lock)
    expect(consumedAfterLock).toBeGreaterThan(duplicateAfterLock)
    expect(source('memory.ts')).toContain('#tail: Promise<void>')
  })

  it('keeps durable reconciliation payload period-only and authority server-owned', () => {
    const contracts = source('contracts.ts')
    const payload = contracts.slice(contracts.indexOf('MeterReconcilePayloadSchema'), contracts.indexOf('export type MeterReconcilePayload'))
    for (const forbidden of ['organizationId', 'workspaceId', 'siteId', 'providerTotals']) expect(payload).not.toContain(forbidden)
    const jobs = source('jobHandlers.ts')
    expect(jobs).toContain("context.job.kind !== METER_RECONCILE_JOB_KIND")
    expect(jobs).toContain("context.jobContext.kind !== 'organization'")
    expect(jobs).toContain('readDurableResult')
    expect(jobs).toContain('commitDurableResult')
  })

  it('keeps every shipped metering module bounded below the repository ceiling', () => {
    for (const file of readdirSync(DIRECTORY).filter((value) => value.endsWith('.ts'))) {
      const lines = source(file).split('\n').length - 1
      expect(lines, file).toBeLessThanOrEqual(700)
    }
  })
})

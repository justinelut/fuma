import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { HOSTED_MIGRATION_CHECKSUMS, hostedMigrations } from '../../../server/fuma/db/migrations'
import { registrarLifecycleAuthorityMigration } from '../../../server/fuma/db/migrations/000065_registrar_lifecycle_authority'
import { assertHostedMigrationIsAdditive, hostedMigrationChecksum } from '../../../server/fuma/db/migrationPolicy'

const ROOT = join(import.meta.dir, '../../..')
const DIRECTORY = join(ROOT, 'server/fuma/registrar')
const source = (file: string) => readFileSync(join(DIRECTORY, file), 'utf8')
const files = readdirSync(DIRECTORY).filter((file) => file.endsWith('.ts'))
const all = files.map(source).join('\n')

describe('FUMA-061 registrar lifecycle architecture', () => {
  it('uses strict TypeBox contracts without Zod, network transports, environment access, or shared UI imports', () => {
    expect(source('contracts.ts')).toContain("from '@core/utils/typeboxHelpers'")
    expect(source('contracts.ts').match(/additionalProperties: false/g)?.length ?? 0).toBeGreaterThanOrEqual(15)
    expect(all).not.toMatch(/\b(?:zod|z\.object)\b/i)
    expect(all).not.toMatch(/\bfetch\s*\(|process\.env|Bun\.env|@ui\//)
    expect(all).not.toMatch(/godaddy|namecheap|enom|cloudflare.*registrar/i)
  })

  it('binds confirmation, currency, minor units, terms, previous expiry, and idempotency to receipts', () => {
    const workflow = source('workflow.ts')
    for (const marker of [
      'expectedAmountMinor',
      "currency !== quote.currency",
      'expectedTermsHash',
      'expectedPreviousExpiresAt',
      "confirmation !== `PURCHASE ${quote.hostname}`",
      "confirmation !== `RENEW ${registration.hostname}`",
      "key('purchase'",
      "key('renew'",
      'lookupPurchase',
      'lookupRenewal',
    ]) expect(workflow).toContain(marker)
    expect(workflow).toContain('RegistrarPurchaseProviderResultSchema')
    expect(workflow).toContain('RegistrarRenewalProviderResultSchema')
  })

  it('repeats complete owner authority in PostgreSQL and serializes receipt completion', () => {
    const postgres = source('postgres.ts')
    expect(postgres).toContain('owner_state=$7')
    expect(postgres).toContain('transfer_fence is not distinct from $8')
    expect(postgres).toContain('profile_id=$9')
    expect(postgres).toContain('pg_advisory_xact_lock')
    expect(registrarLifecycleAuthorityMigration.sql).toContain('idempotency_key text not null unique')
    expect(registrarLifecycleAuthorityMigration.sql).toContain('unique (registration_id, previous_expires_at)')
    expect(postgres).not.toMatch(/where\s+registration_id=\$\{/)
  })

  it('registers the forward-only migration while leaving runtime mounting conductor-owned', () => {
    expect(() => assertHostedMigrationIsAdditive(registrarLifecycleAuthorityMigration)).not.toThrow()
    expect(registrarLifecycleAuthorityMigration.id).toBe('000065_registrar_lifecycle_authority')
    expect(registrarLifecycleAuthorityMigration.sql).toContain('fuma_registrar_receipt_immutable_v2')
    expect(registrarLifecycleAuthorityMigration.sql).toContain("check ((owner_state='active') = (transfer_fence is null))")
    const migrationIndex = readFileSync(join(ROOT, 'server/fuma/db/migrations/index.ts'), 'utf8')
    const router = readFileSync(join(ROOT, 'server/router.ts'), 'utf8')
    expect(migrationIndex).toContain('registrarLifecycleAuthorityMigration')
    expect(hostedMigrations).toContain(registrarLifecycleAuthorityMigration)
    expect(hostedMigrationChecksum(registrarLifecycleAuthorityMigration.sql)).toBe(HOSTED_MIGRATION_CHECKSUMS[registrarLifecycleAuthorityMigration.id])
    expect(router).not.toContain('createHostedRegistrarRuntime')
  })

  it('ships local route, job, PostgreSQL, deterministic fake, UI declaration, and managed-DNS seams', () => {
    for (const file of ['routes.ts', 'jobs.ts', 'postgres.ts', 'fakes.ts', 'runtime.ts', 'onboarding.ts']) {
      expect(files).toContain(file)
    }
    expect(source('routes.ts')).toContain('Direct staff authority is required')
    expect(source('jobs.ts')).toContain('commitDurableResult')
    expect(source('onboarding.ts')).toContain("kind: 'fuma-registered'")
    expect(readFileSync(join(ROOT, 'src/admin/fuma/registrar/RegistrarSurface.tsx'), 'utf8')).toContain('Confirm exact purchase')
  })

  it('keeps every registrar production source under the repository ceiling', () => {
    for (const file of files) expect(source(file).split('\n').length - 1, file).toBeLessThanOrEqual(700)
  })
})

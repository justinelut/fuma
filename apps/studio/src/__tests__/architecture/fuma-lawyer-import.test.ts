import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { assertHostedMigrationIsAdditive } from '../../../server/fuma/db/migrationPolicy'
import { structuredImportsMigration } from '../../../server/fuma/db/migrations/000038_structured_imports'

const ROOT = join(import.meta.dir, '../../..')
const DIRECTORY = join(ROOT, 'server/fuma/lawyerImport')
const source = (file: string): string => readFileSync(join(DIRECTORY, file), 'utf8')
const files = readdirSync(DIRECTORY).filter((file) => file.endsWith('.ts'))
const combined = files.map(source).join('\n')

describe('FUMA-076 Lawyer import architecture', () => {
  it('keeps the snapshot boundary strict, TypeBox-only, bounded, and server-local', () => {
    const contracts = source('contracts.ts')
    expect(contracts).toContain("from '@core/utils/typeboxHelpers'")
    expect(contracts).toContain('safeParseValue(schema, value)')
    expect(contracts.match(/additionalProperties: false/g)?.length ?? 0).toBeGreaterThanOrEqual(13)
    expect(combined).not.toMatch(/(?:from|import\()\s*['"]zod['"]|\bz\.(?:object|string|number)\s*\(/)
    expect(combined).not.toMatch(/from\s+['"][^'"]*(?:apps\/|src\/admin|src\/ui|shared-ui)/)
  })

  it('keeps planning read-only and free of provider, global, environment, and persistence authority', () => {
    const adapter = source('adapter.ts')
    const proposal = adapter.slice(adapter.indexOf('export async function planLawyerImport'), adapter.indexOf('function assertFreshProof'))
    expect(proposal).toContain('planStructuredGhostImport(')
    expect(proposal).not.toContain('executeStructuredGhostImport(')
    expect(proposal).not.toContain('rollbackStructuredGhostImport(')
    expect(combined).not.toMatch(/\bfetch\s*\(|\bglobalThis\b|\bprocess\.env\b|\bBun\.serve\b/)
    expect(combined).not.toMatch(/class\s+(?:Paystack|Oci|Smtp|Resend)[A-Za-z]*Adapter/)
  })

  it('reuses verified payment, publication scope, member reauth, and the generic resumable importer instead of duplicating authority', () => {
    const contracts = source('contracts.ts')
    const adapter = source('adapter.ts')
    expect(contracts).toContain("import type { VerifiedPaystackTransaction } from '../paystack/transport'")
    expect(adapter).toContain("from '../../../../../packages/fuma-governance-launch/src/ghostImport'")
    expect(adapter).toContain("from '../memberIdentity/importService'")
    expect(adapter).toContain("from '../publication/scope'")
    expect(adapter).toContain('samePublicationScope(scope, proof.scope)')
    expect(adapter).toContain('ports.staffReauthentication.verify(proof)')
    expect(adapter).toContain('executeStructuredGhostImport(plan.genericPlan, ports.genericImport)')
    expect(adapter).toContain('rollbackStructuredGhostImport(plan.genericPlan, receipt, ports.genericImport)')
  })

  it('keeps reports sanitized and cannot turn legacy labels or notes into access grants', () => {
    const adapter = source('adapter.ts')
    const reportShape = adapter.slice(adapter.indexOf('export type LawyerImportReport'), adapter.indexOf('export type LawyerImportPlan'))
    expect(reportShape).not.toMatch(/\b(?:email|name|note|authorizationCode|customerCode)\s*:/)
    expect(adapter).toContain("accessDecision: classification === 'verified-for-fuma-reconciliation' ? 'eligible-for-fuma-payment-reconciliation' : 'do-not-grant'")
    expect(adapter).not.toMatch(/\b(?:grantAccess|activateMembership|createSubscription)\s*\(/)
    expect(adapter).toContain("providerCredentialsImported: false")
  })

  it('uses the additive hosted structured-import schema for scoped state, quarantine, reauth, OCI, resume, and rollback evidence', () => {
    expect(() => assertHostedMigrationIsAdditive(structuredImportsMigration)).not.toThrow()
    expect(structuredImportsMigration.id).toBe('000038_structured_imports')
    for (const required of [
      'fuma_structured_imports', 'resumable_cursor', 'fuma_import_objects', "'quarantined'",
      'fuma_lawyer_reconciliations', "email_migration = 'oci-email-delivery'", 'fuma_import_reauthentication',
      "subject_kind in ('staff','member')", 'fuma_import_rollback_receipts', "state in ('applied','rolled-back')",
    ]) expect(structuredImportsMigration.sql).toContain(required)
  })

  it('keeps every ticket-owned production source within the repository ceiling', () => {
    for (const file of files) expect(source(file).split('\n').length, file).toBeLessThanOrEqual(700)
  })
})

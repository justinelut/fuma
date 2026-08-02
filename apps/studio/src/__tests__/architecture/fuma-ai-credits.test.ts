import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { HOSTED_MIGRATION_CHECKSUMS, hostedMigrations } from '../../../server/fuma/db/migrations'
import { aiCreditsAuthorityMigration } from '../../../server/fuma/db/migrations/000066_ai_credits_authority'
import { assertHostedMigrationIsAdditive, hostedMigrationChecksum } from '../../../server/fuma/db/migrationPolicy'

const ROOT = join(import.meta.dir, '../../..')
const DIRECTORY = join(ROOT, 'server/fuma/aiCredits')
const source = (file: string) => readFileSync(join(DIRECTORY, file), 'utf8')
const files = readdirSync(DIRECTORY).filter((file) => file.endsWith('.ts'))
const all = files.map(source).join('\n')

describe('FUMA-064 AI credits and BYOK architecture', () => {
  it('uses strict TypeBox contracts without Zod, UI imports, provider SDKs, network calls, or another AI runtime', () => {
    const contracts = source('contracts.ts')
    expect(contracts).toMatch(/from ['"]@core\/utils\/typeboxHelpers['"]/)
    expect(contracts.match(/additionalProperties: false/g)?.length ?? 0).toBeGreaterThanOrEqual(12)
    expect(all).not.toMatch(/\b(?:zod|z\.object)\b/i)
    expect(all).not.toMatch(/@ui\/|shared-ui|components\/ui/)
    expect(all).not.toMatch(/\bfetch\s*\(|@anthropic|openrouter\.ai|ollama/i)
    expect(all).not.toMatch(/class\s+AiRunner|interface\s+AiProvider\s*\{|conversation store|chat completion/i)
  })

  it('has explicit memory/PostgreSQL authority, expiry job, scoped routes, transfer step, and deterministic demo seams', () => {
    expect(source('repository.ts')).toContain('export interface AiCreditRepository')
    expect(source('memory.ts')).toContain('class MemoryAiCreditRepository')
    expect(source('postgres.ts')).toContain('class PostgresAiCreditRepository')
    expect(source('service.ts')).toContain('class AiCreditService')
    expect(source('jobs.ts')).toContain("'fuma.ai-credit-expiry'")
    expect(source('routes.ts')).toContain("'/ai/credits/:accountId/reservations'")
    expect(source('transferStep.ts')).toContain("'ai-credit-byok-rekey-detach'")
    expect(source('demo.ts')).toContain('runAiCreditDemo')
    expect(source('runtime.ts')).toContain('createHostedAiCreditRuntime')
  })

  it('registers the additive migration with its finalized checksum', () => {
    expect(() => assertHostedMigrationIsAdditive(aiCreditsAuthorityMigration)).not.toThrow()
    expect(aiCreditsAuthorityMigration.sql).toContain('fuma_ai_credit_accounts_v2')
    expect(aiCreditsAuthorityMigration.sql).toContain('fuma_ai_credit_reservations_v2')
    expect(aiCreditsAuthorityMigration.sql).toContain('fuma_ai_byok_transfer_choices_v2')
    expect(aiCreditsAuthorityMigration.sql).not.toMatch(/drop\s+(?:table|column)|truncate/i)
    expect(hostedMigrations).toContain(aiCreditsAuthorityMigration)
    expect(hostedMigrationChecksum(aiCreditsAuthorityMigration.sql)).toBe(HOSTED_MIGRATION_CHECKSUMS[aiCreditsAuthorityMigration.id])
  })

  it('keeps plaintext/native references out of public views, audit facts, and tool contexts', () => {
    const contracts = source('contracts.ts')
    const views = contracts.slice(
      contracts.indexOf('AiByokCredentialViewSchema'),
      contracts.indexOf('export type AiByokCredentialView'),
    )
    expect(views).not.toMatch(/existingCredentialId|ciphertext|keyId|ownerKey|envelope/)
    const redaction = source('redaction.ts')
    expect(redaction).not.toMatch(/\.envelope|\.ownerKey|\.keyId|existingCredentialId/)
    expect(all).not.toMatch(/console\.(?:log|error|warn)\([^)]*(?:credential|secret|envelope)/i)
  })

  it('keeps every production source under the repository ceiling', () => {
    for (const file of files) {
      expect(source(file).split('\n').length - 1, file).toBeLessThanOrEqual(700)
    }
  })
})

import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  HOSTED_MIGRATION_CHECKSUMS,
} from '../../../server/fuma/db/migrations'
import { domainOperationsAuthorityMigration } from '../../../server/fuma/db/migrations/000067_domain_operations_authority'
import {
  assertHostedMigrationIsAdditive,
  hostedMigrationChecksum,
} from '../../../server/fuma/db/migrationPolicy'

const root = join(import.meta.dir, '../../..')
const directory = join(root, 'server/fuma/domainOperations')
const files = readdirSync(directory).filter((file) => file.endsWith('.ts'))
const source = (file: string) => readFileSync(join(directory, file), 'utf8')
const all = files.map(source).join('\n')

describe('FUMA-062 domain operations architecture', () => {
  it('uses strict TypeBox only and no direct network, environment, app, or shared UI dependency', () => {
    expect(source('contracts.ts')).toContain("from '@core/utils/typeboxHelpers'")
    expect(source('contracts.ts').match(/additionalProperties: false/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(15)
    expect(all).not.toMatch(/\b(?:zod|z\.object)\b/i)
    expect(all).not.toMatch(/\bfetch\s*\(|process\.env|Bun\.env|apps\/|@ui\//)
  })

  it('registers the canonical additive encrypted exact-scope migration', () => {
    expect(() => assertHostedMigrationIsAdditive(domainOperationsAuthorityMigration)).not.toThrow()
    expect(domainOperationsAuthorityMigration.id).toBe('000067_domain_operations_authority')
    expect(domainOperationsAuthorityMigration.sql).toContain('owner_generation')
    expect(domainOperationsAuthorityMigration.sql).toContain('transfer_fence')
    expect(domainOperationsAuthorityMigration.sql).toContain('transfer_json jsonb')
    expect(domainOperationsAuthorityMigration.sql).not.toMatch(/auth_code_plain|plaintext|secret text/i)
    expect(hostedMigrationChecksum(domainOperationsAuthorityMigration.sql)).toBe(
      '6cfe60d80f884bcb6c9887c118296894c6ea514a29acac4c0c022dc456f1556f',
    )
    expect(HOSTED_MIGRATION_CHECKSUMS[domainOperationsAuthorityMigration.id]).toBe(
      hostedMigrationChecksum(domainOperationsAuthorityMigration.sql),
    )
  })

  it('ships unmounted routes, durable job, PostgreSQL, deterministic fakes, and mandatory order-620 transfer step', () => {
    for (const file of ['routes.ts', 'jobs.ts', 'postgres.ts', 'fakes.ts', 'runtime.ts', 'transferStep.ts']) {
      expect(files).toContain(file)
    }
    expect(source('jobs.ts')).toContain('commitDurableResult')
    expect(source('runtime.ts')).toContain('The conductor owns global router, worker, transfer registry')
    expect(source('transferStep.ts')).toContain("DOMAIN_OUTCOME_TRANSFER_STEP_ID = 'domain-outcome'")
    expect(source('transferStep.ts')).toContain('DOMAIN_OUTCOME_TRANSFER_STEP_ORDER = 620')
    expect(source('transferStep.ts')).toContain('mandatory:true')
  })

  it('keeps the Studio surface local, Tailwind-free, and free of customer Cloudflare credential input', () => {
    const ui = readFileSync(join(root, 'src/admin/fuma/domainOperations/DomainOperationsSurface.tsx'), 'utf8')
    const css = readFileSync(join(root, 'src/admin/fuma/domainOperations/DomainOperationsSurface.module.css'), 'utf8')
    expect(ui).not.toMatch(/className="(?:flex|grid|p-|m-|text-)/)
    expect(ui).toContain("import { Button } from '@ui/components/Button'")
    expect(ui).not.toMatch(/@ui\/(?!components\/Button)/)
    expect(ui).not.toMatch(/Cloudflare (?:API )?(?:token|credential)/i)
    expect(css).not.toContain('@tailwind')
  })

  it('keeps every ticket production module under the repository ceiling', () => {
    for (const file of files) {
      expect(source(file).split('\n').length - 1, file).toBeLessThanOrEqual(700)
    }
  })
})

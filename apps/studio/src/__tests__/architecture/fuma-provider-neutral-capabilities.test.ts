import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hostedMigrations, runnableHostedMigrations } from '../../../server/fuma/db/migrations'

const root = join(import.meta.dir, '../../..')
const source = (path: string) => readFileSync(join(root, path), 'utf8')

describe('FUMA-088 provider-neutral capability architecture', () => {
  test('uses strict reviewed contracts and canonical Publication ports without a repository/backend', () => {
    const contracts = source('server/fuma/aiBackendCapabilities/providerNeutralContracts.ts')
    const adapters = source('server/fuma/aiBackendCapabilities/providerNeutralAdapters.ts')
    const catalog = source('server/fuma/aiBackendCapabilities/providerNeutralCatalog.ts')
    expect(contracts).toContain('additionalProperties: false')
    expect(catalog).toContain("channels: ['site-ai', 'mcp', 'imported-runtime', 'export-adapter']")
    expect(adapters).toContain('PublicationDomainStore')
    expect(adapters).toContain('PublicationEditorialService')
    expect(adapters).toContain('PublicationMemberAccessService')
    expect(adapters).toContain('PublicationPrivacyAnalyticsService')
    expect(adapters).toContain('ProviderNeutralPublicationExportAdapter')
    expect(adapters).not.toMatch(/class\s+.*Repository|create table|insert into|select\s+.*from/i)
    expect(catalog).not.toMatch(/class\s+.*Repository|create table|insert into|select\s+.*from/i)
    expect(`${contracts}\n${adapters}\n${catalog}`).not.toMatch(/from\s+['"][^'"]*(?:drizzle|prisma|typeorm|sequelize|knex|zod)[^'"]*['"]/)
  })

  test('keeps forbidden authority and deferred commerce out while retaining explicit blocking diagnostics', () => {
    const files = [
      'server/fuma/aiBackendCapabilities/providerNeutralContracts.ts',
      'server/fuma/aiBackendCapabilities/providerNeutralAdapters.ts',
      'server/fuma/aiBackendCapabilities/providerNeutralCatalog.ts',
    ].map(source).join('\n')
    for (const forbidden of ['process.env', 'fetch(', 'PAYSTACK_SECRET', 'DATABASE_URL', 'callerScope', 'arbitraryPredicate', 'provider SDK']) {
      expect(files).not.toContain(forbidden)
    }
    for (const diagnostic of [
      'CAPABILITY_AUTHORITY_UNSCOPED', 'CAPABILITY_CHANNEL_FORBIDDEN',
      'CAPABILITY_AUTHORITY_MISSING', 'CAPABILITY_BROWSER_CHALLENGE_REQUIRED',
      'CAPABILITY_DEFERRED_ECOMMERCE',
    ]) expect(files).toContain(diagnostic)
    expect(files).toContain('Paystack and commerce scope are unchanged.')
  })

  test('preserves 77/78/79 serialization and adds no capability migration', () => {
    expect(runnableHostedMigrations).toHaveLength(77)
    expect(runnableHostedMigrations.at(-1)?.id).toBe('000077_public_handoff_authority')
    expect(hostedMigrations).toHaveLength(78)
    expect(hostedMigrations.at(-1)?.id).toBe('000078_next_source_portability_authority')
    const index = source('server/fuma/db/migrations/index.ts')
    expect(index).not.toContain('000079_public_marketing_analytics')
    expect(index).not.toContain('provider_neutral_capability')
  })

  test('exports explicit adapter methods rather than a generic RPC/query tunnel', () => {
    const adapters = source('server/fuma/aiBackendCapabilities/providerNeutralAdapters.ts')
    for (const method of ['listContent(', 'getContent(', 'saveDraft(', 'requestPublication(', 'listTaxonomy(', 'getSettings(', 'listNewsletters(', 'evaluateAccess(', 'analyticsReport(']) {
      expect(adapters).toContain(method)
    }
    expect(adapters).not.toMatch(/\binvoke\s*\(|\bquery\s*\(|\bexecute\s*\(operation/)
    expect(adapters).not.toMatch(/apps\/(?:web|site-runtime|control)|shared\/ui|tailwind/)
  })
})

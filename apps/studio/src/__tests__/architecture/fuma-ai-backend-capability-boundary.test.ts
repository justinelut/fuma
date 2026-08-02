import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  HOSTED_MIGRATION_CHECKSUMS,
  hostedMigrations,
  runnableHostedMigrations,
} from '../../../server/fuma/db/migrations'

const root = join(import.meta.dir, '../../..')
const source = (path: string) => readFileSync(join(root, path), 'utf8')

describe('FUMA-086 no-direct-database AI capability architecture', () => {
  it('mounts one strict reviewed component capability through the existing Site AI/MCP tool registry', () => {
    const tools = source('server/ai/tools/site/componentCatalogTools.ts')
    const port = source('server/ai/tools/site/componentCatalogPort.ts')
    const registry = source('server/fuma/aiBackendCapabilities/registry.ts')
    const runtime = source('server/fuma/aiBackendCapabilities/postgresRuntime.ts')

    expect(tools).toContain('InsertDataBackedSectionInputSchema')
    expect(tools).toContain("mcpCapability: 'component.mutate'")
    expect(port).toContain('PostgresAiBackendCapabilityRuntime')
    expect(port).toContain('insertDataBackedSection')
    expect(registry).toContain('assertStrictCapabilitySchema')
    expect(registry).toContain('resolveAuthority()')
    expect(runtime).toContain('fuma_site_ai_tool_receipts')
    expect(runtime).toContain('fuma_mcp_tool_receipts_v2')
    expect(runtime).toContain('fuma_component_catalog_audit_v1')
    expect(runtime).toContain('MeteringCollector')
    expect(runtime).not.toContain('process.env')
    expect(runtime).not.toContain('fetch(')
    expect(registry).not.toContain('zod')
  })

  it('keeps database, SQL, credentials, generated server code, and unrestricted network out of frontend authority', () => {
    const policy = source('server/fuma/aiBackendCapabilities/sourcePolicy.ts')
    for (const denial of [
      'database-import',
      'sql-surface',
      'connection-string',
      'environment-secret',
      'filesystem-process',
      'provider-sdk',
      'generated-server-code',
      'unrestricted-network',
    ]) expect(policy).toContain(`'${denial}'`)
    expect(policy).toContain('assertFrontendCapabilitySource')
    expect(policy).not.toContain('from \'zod\'')
    expect(policy).not.toContain('from "zod"')
  })

  it('preserves the protected migration order exactly without claiming a FUMA-086 migration', () => {
    expect(runnableHostedMigrations).toHaveLength(77)
    expect(runnableHostedMigrations.at(-1)?.id).toBe('000077_public_handoff_authority')
    expect(hostedMigrations).toHaveLength(78)
    expect(hostedMigrations.at(-1)?.id).toBe('000078_next_source_portability_authority')
    expect(HOSTED_MIGRATION_CHECKSUMS['000078_next_source_portability_authority'])
      .toBe('0'.repeat(64))
    const migrationIndex = source('server/fuma/db/migrations/index.ts')
    expect(migrationIndex).not.toContain('000079_public_marketing_analytics')
    expect(migrationIndex).not.toContain('ai_backend_capability')
  })

  it('does not create an app import, shared UI package, Studio Tailwind, or parallel AI/MCP runtime', () => {
    const files = [
      'server/fuma/aiBackendCapabilities/contracts.ts',
      'server/fuma/aiBackendCapabilities/registry.ts',
      'server/fuma/aiBackendCapabilities/componentInsertion.ts',
      'server/fuma/aiBackendCapabilities/postgresRuntime.ts',
      'server/fuma/aiBackendCapabilities/sourcePolicy.ts',
    ].map(source).join('\n')
    expect(files).not.toMatch(/apps\/(?:web|site-runtime|control)/)
    expect(files).not.toMatch(/@fuma\/ui|shared\/ui|tailwind|McpServer|AiRunner/)
    expect(files).not.toMatch(/from\s+['"][^'"]*(?:drizzle|prisma|typeorm|sequelize|knex)[^'"]*['"]/)
  })
})

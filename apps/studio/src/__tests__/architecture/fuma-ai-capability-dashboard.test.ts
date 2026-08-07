import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../../../..')
const source = (path: string) => readFileSync(resolve(root, path), 'utf8')
const ticketFiles = [
  ...readdirSync(resolve(root, 'apps/studio/server/fuma/aiCapabilityDashboard')).map((name) => `apps/studio/server/fuma/aiCapabilityDashboard/${name}`),
  ...readdirSync(resolve(root, 'apps/studio/src/admin/fuma/aiCapabilities')).map((name) => `apps/studio/src/admin/fuma/aiCapabilities/${name}`),
].filter((path) => /\.(?:ts|tsx)$/.test(path))

describe('FUMA-087 protected capability dashboard architecture', () => {
  it('mounts one read projection in the existing scoped API and organization/workspace/site shell', () => {
    const server = source('apps/studio/server/index.ts')
    const hosted = source('apps/studio/server/auth/hosted/runtime.ts')
    const shell = source('apps/studio/src/admin/preauth/HostedStaffShell.tsx')
    expect(server).toContain('createHostedCapabilityDashboardRuntime')
    expect(server).toContain('capabilityDashboardRoutes: hostedCapabilityDashboardRuntime.scopedRoutes')
    expect(server.match(/createHostedFumaScopedApi\(/g)).toHaveLength(1)
    expect(hosted).toContain('capabilityDashboardRoutes?: readonly FumaScopedRouteDeclaration[]')
    expect(hosted).toContain('...(input.capabilityDashboardRoutes ?? [])')
    expect(shell).toContain('<CustomerCapabilityDashboardRouteContent shell={shell} />')
    expect(shell).toContain('<PlatformCapabilityInventoryRouteContent')
    expect(shell).toContain("impersonatedBy={currentSession.session.impersonatedBy ?? null}")
  })

  it('composes only bounded metadata into FUMA-071 and leaves all mutation authorities in canonical services', () => {
    const composition = source('apps/studio/server/fuma/platformConsole/composition.ts')
    const contribution = source('apps/studio/server/fuma/aiCapabilityDashboard/consoleContribution.ts')
    const service = source('apps/studio/server/fuma/aiCapabilityDashboard/service.ts')
    expect(composition).toContain('registry.register(aiCapabilityDashboardConsoleContribution)')
    expect(contribution).toContain("ownerTicket: 'FUMA-087'")
    expect(contribution).toContain("'/internal/ai-capabilities'")
    expect(contribution).toContain('mounted: false')
    expect(service).toContain('await this.#mcp.revoke')
    expect(service).not.toMatch(/insert\s+into|update\s+fuma_mcp|delete\s+from/i)
    expect(service).not.toMatch(/(?:async\s+)?grantCapability\s*\(|async\s+grant\s*\(/i)
  })

  it('uses strict TypeBox, CSS modules, PostgreSQL reads, bounded windows, and minimized known-source projections', () => {
    const readModel = source('apps/studio/server/fuma/aiCapabilityDashboard/postgresReadModel.ts')
    const routes = source('apps/studio/server/fuma/aiCapabilityDashboard/routes.ts')
    const styles = source('apps/studio/src/admin/fuma/aiCapabilities/CapabilityDashboardRouteContent.tsx')
    expect(readModel).toContain("if (db.dialect !== 'postgres')")
    expect(readModel).toContain("where receipt.tool_name='site_insert_component'")
    expect(readModel).toContain('limit $8 offset $9')
    expect(readModel).toContain('limit $1 offset $2')
    expect(readModel).not.toMatch(/select\s+\*\s+from\s+\$|tableName|columnName|callerSql/i)
    expect(routes).toContain("'cache-control': 'private, no-store'")
    // Everything outside the visual builder is Tailwind now, so the dashboard has no stylesheet.
    expect(styles).not.toContain('module.css')
    for (const path of ticketFiles) {
      const text = source(path)
      expect(text, path).not.toMatch(/from ['"]zod['"]|require\(['"]zod['"]\)/)
      // The raw-utility ban is superseded for hosted surfaces; a stylesheet of their own is not.
      expect(text, path).not.toContain('module.css')
      expect(text, path).not.toMatch(/DATABASE_URL|connectionString|providerSecret|privateKey|bearerToken/i)
    }
  })

  it('adds no database console, credentials, second runtime, app import, shared UI, or migration', () => {
    const runtime = source('apps/studio/server/fuma/aiCapabilityDashboard/runtime.ts')
    const docs = source('docs/reference/fuma-ai-backend-capability-dashboard.md')
    const migrationIndex = source('apps/studio/server/fuma/db/migrations/index.ts')
    expect(runtime).toContain('createInsertDataBackedSectionCapability')
    expect(runtime).toContain('new PostgresCapabilityDashboardReadModel')
    expect(runtime).not.toMatch(/new ReviewedBackendCapabilityRegistry|createHostedMcp|create.*AiRuntime|execute\s*:/)
    expect(docs).toContain('adds no capability execution path')
    expect(migrationIndex).not.toMatch(/000087|aiCapabilityDashboard|capability_dashboard/i)
    expect(migrationIndex).toContain('nextSourcePortabilityAuthorityMigration')
    expect(migrationIndex).not.toContain('publicMarketingAnalyticsMigration')
    expect(ticketFiles.some((path) => path.startsWith('apps/studio/src/ui/'))).toBe(false)
  })
})

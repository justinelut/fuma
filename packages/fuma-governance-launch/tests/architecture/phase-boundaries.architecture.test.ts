import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../..')
const PACKAGE = join(ROOT, 'packages/fuma-governance-launch')
const APP = join(ROOT, 'apps/control-surfaces')

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

describe('FUMA-063..085 and TRACKER-086 architecture boundary', () => {
  it('uses strict TypeBox contracts and no Zod', () => {
    const source = files(join(PACKAGE, 'src')).map((path) => readFileSync(path, 'utf8')).join('\n')
    expect(source).toContain("from '@sinclair/typebox'")
    expect(source).toContain('additionalProperties: false')
    expect(source).not.toMatch(/\b(?:zod|z\.object|z\.string)\b/i)
  })

  it('keeps all new migrations additive and phase-local for central checksum registration', () => {
    const migrationFiles = files(join(PACKAGE, 'migrations')).filter((path) => path.endsWith('.sql')).sort()
    expect(migrationFiles.map((path) => path.split('/').pop())).toEqual(['000013_ai_governance.sql', '000014_plugins_marketplace.sql', '000015_operations_experts_transfer.sql', '000016_structured_imports.sql', '000017_launch_evidence_privacy.sql'])
    for (const path of migrationFiles) {
      const sql = readFileSync(path, 'utf8')
      expect(sql).not.toMatch(/\b(?:drop|truncate|delete\s+from|alter\s+table[\s\S]{0,80}\bdrop)\b/i)
      expect(sql).toContain('create table')
    }
    const migrationManifest = readFileSync(join(PACKAGE, 'migrations/manifest.json'), 'utf8')
    expect(migrationManifest).toContain('centralRegistrationRequired')
    for (const id of ['000035_ai_governance', '000036_plugins_marketplace', '000037_operations_experts_transfer', '000038_structured_imports', '000039_launch_evidence_privacy']) expect(migrationManifest).toContain(id)
  })

  it('keeps FUMA-075 strict, resumable, secret-free, and bound to finalized import evidence', () => {
    const ghost = readFileSync(join(PACKAGE, 'src/ghostImport.ts'), 'utf8')
    const migration = readFileSync(join(ROOT, 'apps/studio/server/fuma/db/migrations/000038_structured_imports.ts'), 'utf8')
    for (const contract of ['GhostExportSchema', 'GhostAdminApiSnapshotSchema', 'additionalProperties: false', 'parseGhostMemberCsv', 'findReceipt', 'objectState', 'mediaState', 'saveCursor', 'rollbackStructuredGhostImport']) expect(ghost).toContain(contract)
    expect(ghost).toContain("excludedKinds: ['passwords', 'sessions', 'provider-secrets']")
    expect(ghost).not.toMatch(/from ['"](?:apps\/|@fuma\/studio)/)
    for (const table of ['fuma_structured_imports', 'fuma_import_objects', 'fuma_import_rollback_receipts', 'fuma_import_reauthentication']) expect(migration).toContain(table)
    expect(migration).toContain("state in ('dry-run','running','applied','rolled-back','failed')")
    expect(migration).toContain('unique(platform_id, site_id, source_hash_sha256, manifest_hash_sha256)')
  })

  it('keeps Tailwind/shadcn exact-pinned and app-local without modifying Studio styling', () => {
    const manifest = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> }
    expect(manifest.devDependencies).toMatchObject({ tailwindcss: '4.3.3', shadcn: '4.14.1', '@tailwindcss/postcss': '4.3.3' })
    for (const version of Object.values(manifest.devDependencies)) expect(version).not.toMatch(/^[~^]/)
    expect(readFileSync(join(APP, 'components.json'), 'utf8')).toContain('"ui": "@/components/ui"')
    expect(files(join(ROOT, 'packages')).some((path) => path.includes('/ui/') || path.endsWith('/ui.ts'))).toBe(false)
  })

  it('keeps browser acceptance on Blyss HTTPS only', () => {
    const browserSources = [...files(join(APP, 'e2e')), join(APP, 'playwright.config.ts')].map((path) => readFileSync(path, 'utf8')).join('\n')
    expect(browserSources).toContain('https://5174.blyss.co.ke')
    expect(browserSources).not.toMatch(/https?:\/\/(?:localhost|127\.0\.0\.1)/)
  })

  it('requires digest images, exact host routes, no default ingress, and no plaintext Secret manifest', () => {
    const infra = files(join(ROOT, 'infra/fuma-phase-13-18')).map((path) => readFileSync(path, 'utf8')).join('\n')
    expect(infra).toContain('@sha256:REQUIRED_DIGEST')
    for (const host of ['fuma.co.ke', 'auth.fuma.co.ke', 'app.fuma.co.ke', 'admin.fuma.co.ke']) expect(infra).toContain(host)
    expect(infra).toContain('No default route exists')
    expect(infra).toContain('single-node-no-host-ha')
    expect(infra).toContain('cloudflare-approved-ranges-only')
    expect(infra).not.toMatch(/kind:\s*Secret[\s\S]{0,500}\b(?:data|stringData):/)
  })

  it('binds task 86 private calls to the public-web audience without visitor credentials', () => {
    const webBridge = [join(ROOT, 'apps/web/lib/public-projections.ts'), join(ROOT, 'apps/web/lib/private-bridge.ts')].map((path) => readFileSync(path, 'utf8')).join('\n')
    expect(webBridge).toContain("'x-fuma-audience': 'fuma-public-web'")
    expect(webBridge).toContain("'x-fuma-request-id'")
    expect(webBridge).not.toMatch(/headers:\s*\{[^}]*cookie/i)
    const seam = readFileSync(join(PACKAGE, 'handoff/public-web-deployment-seam.json'), 'utf8')
    expect(seam).toContain('http://runtime-web.fuma.svc.cluster.local')
  })

  it('keeps payment-provider webhooks and secrets in the shared merchant host service', () => {
    const plugin = readFileSync(join(PACKAGE, 'plugins/customer-payments/server/index.js'), 'utf8')
    const manifest = readFileSync(join(PACKAGE, 'plugins/customer-payments/plugin.json'), 'utf8')
    expect(plugin).not.toContain("routes.public.post('/webhook'")
    expect(manifest).toContain('"networkAllowedHosts": []')
    expect(manifest).not.toMatch(/content\.(?:read|write)/)
  })

  it('enumerates every capacity workload and material cost input', () => {
    const capacity = readFileSync(join(PACKAGE, 'config/capacity-budgets.json'), 'utf8')
    for (const workload of ['app-read', 'editor-save', 'collaboration', 'publish', 'public-web', 'email', 'payment', 'ai', 'plugin', 'domain']) expect(capacity).toContain(workload)
    for (const cost of ['oracle-quote', 'oci-email-quote', 'cloudflare-quote-or-invoice', 'storage-amplification', 'origin-bandwidth']) expect(capacity).toContain(cost)
    expect(capacity).toContain('"internalRevenueAlwaysMinor": 0')
  })
})

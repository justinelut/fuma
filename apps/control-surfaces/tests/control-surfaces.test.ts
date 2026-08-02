import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const APP = join(import.meta.dir, '..')
const ROOT = join(APP, '../..')

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

describe('governance control-surface boundaries', () => {
  test('keeps Tailwind and shadcn exact-pinned and app-local', () => {
    const manifest = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> }
    expect(manifest.devDependencies).toMatchObject({
      '@tailwindcss/postcss': '4.3.3',
      shadcn: '4.14.1',
      tailwindcss: '4.3.3',
    })
    expect(readFileSync(join(APP, 'components.json'), 'utf8')).toContain('"ui": "@/components/ui"')
    expect(files(join(ROOT, 'packages')).some((path) => path.includes('/ui/') || path.endsWith('/ui.ts'))).toBe(false)
  })

  test('uses strict TypeBox validation without Zod', () => {
    const source = files(join(APP, 'app')).filter((path) => /\.[cm]?[jt]sx?$/.test(path)).map((path) => readFileSync(path, 'utf8')).join('\n')
    expect(source).toContain("from '@sinclair/typebox'")
    expect(source).toContain("from '@sinclair/typebox/value'")
    expect(source).toContain('additionalProperties: false')
    expect(source).not.toMatch(/\b(?:zod|z\.object|z\.string)\b/i)
  })

  test('keeps browser acceptance on the exact Blyss HTTPS host', () => {
    const browserSource = [...files(join(APP, 'e2e')), join(APP, 'playwright.config.ts')].map((path) => readFileSync(path, 'utf8')).join('\n')
    expect(browserSource).toContain('https://5174.blyss.co.ke')
    expect(browserSource).not.toMatch(/https?:\/\/(?:localhost|127\.0\.0\.1)/)
  })

  test('keeps secure payment confirmation and credential entry scoped, one-time, and outside AI', () => {
    const retired = readFileSync(join(APP, 'app/api/secure-payment-settings/route.ts'), 'utf8')
    const bff = readFileSync(join(APP, 'app/api/fuma/[...path]/route.ts'), 'utf8')
    const page = readFileSync(join(APP, 'app/secure-payment/page.tsx'), 'utf8')
    const client = readFileSync(join(APP, 'app/secure-payment/payment-setup.tsx'), 'utf8')
    expect(retired).toContain("error: 'route-retired'")
    expect(retired).not.toContain('/internal/v1/payment-settings')
    expect(bff).toContain("path[7] !== 'payment-setup'")
    expect(bff).toContain("path[10] === 'confirm'")
    expect(bff).toContain("kind === 'payment-confirm' && response.ok")
    expect(bff).toContain("'set-cookie', handoff")
    expect(client).toContain("crypto.getRandomValues(new Uint8Array(32))")
    expect(client).toContain('Confirm exact reviewed setup')
    expect(client).toContain('Enter Paystack credentials directly')
    expect(client).toContain('They are never returned to AI')
    expect(client).toContain('type="password"')
    expect(client).toContain('previewAmountMinor: Type.Literal(100)')
    expect(page).toContain('organizationId, workspaceId, siteId, and proposalId')
    expect(`${retired}\n${bff}\n${page}\n${client}`).not.toMatch(/from ['"][^'"]*apps\/studio/)
  })

  test('lists only current signed marketplace releases and proxies scoped installs fail closed', () => {
    const page = readFileSync(join(APP, 'app/marketplace/page.tsx'), 'utf8')
    const catalog = readFileSync(join(APP, 'app/marketplace/catalog.tsx'), 'utf8')
    const route = readFileSync(join(APP, 'app/api/fuma/[...path]/route.ts'), 'utf8')
    expect(page).toContain('Hash-bound, artifact-specific scanned, Ed25519-signed and unrevoked releases only')
    expect(catalog).toContain("reviewState: Type.Literal('signed-current')")
    expect(catalog).toContain('Explicit permission grant')
    expect(catalog).toContain('Review or signature authority is unavailable. Installation is disabled.')
    expect(route).toContain("runtime !== RuntimeOrigin")
    expect(route).toContain('host: FUMA_CONTROL_DEPLOYMENT.hosts.product')
    expect(route).toContain("path[0] !== 'organizations'")
    expect(route).toContain("path[6] === 'marketplace'")
    expect(route).toContain("path[9] === 'install'")
    expect(`${page}\n${catalog}\n${route}`).not.toMatch(/from ['"][^'"]*apps\/studio/)
  })

  test('protects the platform console and exposes complete redacted lifecycle views', () => {
    const host = readFileSync(join(APP, 'lib/host.ts'), 'utf8')
    const page = readFileSync(join(APP, 'app/internal/page.tsx'), 'utf8')
    const model = readFileSync(join(APP, 'app/internal/console-model.ts'), 'utf8')
    expect(host).toContain('requireInternalConsoleAuthority')
    expect(host).toContain('FUMA_INTERNAL_AUTHORITY_ATTESTATION_SECRET')
    expect(host).toContain('timingSafeEqual')
    expect(page).toContain('Kijani Law managed-client lifecycle')
    expect(page).toContain('paid-transfer-pending')
    expect(page).toContain('Empty by default')
    for (const view of ['users', 'organizations', 'clients', 'workspaces', 'sites', 'plans', 'offers', 'contracts', 'invoices', 'economics', 'usage', 'domains', 'email', 'jobs', 'releases', 'ai', 'audit']) expect(model).toContain(`${view}:`)
    expect(`${page}\n${model}`).not.toMatch(/from ['"][^'"]*apps\/studio/)
  })
})
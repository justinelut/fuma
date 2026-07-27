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

  test('keeps secure payment entry host-bound and secret-free toward AI', () => {
    const route = readFileSync(join(APP, 'app/api/secure-payment-settings/route.ts'), 'utf8')
    const page = readFileSync(join(APP, 'app/secure-payment/page.tsx'), 'utf8')
    expect(route).toContain("host !== 'app.fuma.co.ke'")
    expect(route).toContain("origin !== 'https://app.fuma.co.ke'")
    expect(route).toContain("'x-fuma-audience': 'secure-payment-settings'")
    expect(route).toContain("runtime !== 'http://runtime-web.fuma.svc.cluster.local'")
    expect(page).toContain('Values are never returned to AI')
    expect(page).toContain('type="password"')
  })
})

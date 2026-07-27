import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const OWNED = [
  'app/trust',
  'app/legal',
  'app/security',
  'app/contact',
  'app/privacy-request',
  'app/status',
  'app/api/contact',
  'components/contact-form.tsx',
  'components/legal-policy-page.tsx',
  'components/status-summary.tsx',
  'lib/contact-boundary.ts',
  'lib/legal-policy-history.ts',
  'lib/status-boundary.ts',
  'content/public/legal',
] as const

async function files(value: string): Promise<string[]> {
  const target = path.join(ROOT, value)
  const stat = await fs.stat(target)
  if (stat.isFile()) return [target]
  const output: string[] = []
  for (const item of await fs.readdir(target, { withFileTypes: true })) {
    const full = path.join(target, item.name)
    if (item.isDirectory()) output.push(...await files(path.relative(ROOT, full)))
    else if (/\.(?:ts|tsx|md)$/.test(item.name)) output.push(full)
  }
  return output
}

describe('FUMA-WEB-014 architecture boundaries', () => {
  test('uses TypeBox without Zod, Studio/app authority imports, shared UI packages, browser secrets, or hardcoded providers', async () => {
    const paths = (await Promise.all(OWNED.map(files))).flat()
    const text = (await Promise.all(paths.map((file) => fs.readFile(file, 'utf8')))).join('\n')
    expect(text).toContain('@sinclair/typebox')
    expect(text).not.toMatch(/from\s+['"]zod['"]|from\s+['"][^'"]*apps\/studio|from\s+['"]@studio/)
    expect(text).not.toMatch(/from\s+['"]@fuma\/(?:ui|app|studio)/)
    expect(text).not.toMatch(/NEXT_PUBLIC_.*(?:TOKEN|SECRET|STATUS|CONTACT)/)
    expect(text).not.toMatch(/\b(?:statuspage|atlassian|pagerduty|betteruptime|freshdesk|zendesk|sendgrid|mailgun)\b/i)
    expect(text).not.toMatch(/SOC\s*2|ISO\s*27001|HIPAA|PCI[- ]DSS|99\.9%|SLA guarantee/i)
  })

  test('contact and status integrations stay server-owned, strict, no-store, redirect-safe, and unavailable by default', async () => {
    const contactRoute = await fs.readFile(path.join(ROOT, 'app/api/contact/route.ts'), 'utf8')
    const contactBoundary = await fs.readFile(path.join(ROOT, 'lib/contact-boundary.ts'), 'utf8')
    const statusBoundary = await fs.readFile(path.join(ROOT, 'lib/status-boundary.ts'), 'utf8')
    const statusPage = await fs.readFile(path.join(ROOT, 'app/status/page.tsx'), 'utf8')
    expect(contactRoute).toContain('forwardContact')
    expect(contactBoundary).toContain('additionalProperties: false')
    expect(contactBoundary).toContain("'cache-control': 'no-store'")
    expect(contactBoundary).not.toContain('recipient')
    expect(statusBoundary).toContain('FUMA_STATUS_SUMMARY_URL')
    expect(statusBoundary).toContain("cache: 'no-store'")
    expect(statusBoundary).toContain("redirect: 'error'")
    expect(statusBoundary).not.toContain('https://status.fuma.co.ke')
    expect(statusPage).toContain("dynamic = 'force-dynamic'")
    expect(statusPage).toContain('revalidate = 0')
  })
})

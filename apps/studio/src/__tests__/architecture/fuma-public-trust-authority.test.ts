import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '../../..')

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
}

describe('FUMA-WEB-014 durable trust authority architecture', () => {
  test('keeps one server-owned TypeBox/PostgreSQL authority without app imports, Zod, SQLite, or raw contact content', () => {
    const contact = source('server/fuma/publicProjections/contact.ts')
    const status = source('server/fuma/publicProjections/status.ts')
    const runtime = source('server/fuma/publicProjections/runtime.ts')
    const migration = source('server/fuma/db/migrations/000080_public_trust_authority.ts')
    const combined = `${contact}\n${status}\n${runtime}\n${migration}`

    expect(contact).toContain("from '@core/utils/typeboxHelpers'")
    expect(contact).toContain('PostgresPublicContactReceiptRepository')
    expect(runtime).toContain('DurablePublicContactRoutingAuthority')
    expect(runtime).toContain('ConfiguredPublicStatusProjectionAuthority')
    expect(migration).toContain('metadata-only contact routing authority')
    expect(migration).not.toMatch(/\b(?:name|email|message|body|payload)\s+(?:text|jsonb?)\b/i)
    expect(combined).not.toMatch(/from ['"]zod['"]|\bz\.(?:object|string|union)\s*\(/)
    expect(combined).not.toMatch(/apps\/(?:web|site-runtime|control-surfaces)|@fuma\/shared-ui/)
    expect(combined).not.toMatch(/sqlite/i)
  })

  test('keeps external routing and status provider-neutral, authenticated, bounded, no-store, redirect-denied, and fail closed', () => {
    const contact = source('server/fuma/publicProjections/contact.ts')
    const status = source('server/fuma/publicProjections/status.ts')
    const combined = `${contact}\n${status}`

    for (const required of [
      "authorization: `Bearer ${this.#config.token}`",
      "cache: 'no-store'",
      "redirect: 'error'",
      'AbortSignal.timeout',
      'Public contact routing configuration is incomplete.',
      'Public status authority configuration is incomplete.',
    ]) expect(combined).toContain(required)
    expect(combined).not.toMatch(/pagerduty|statuspage|atlassian|zendesk|freshdesk|sendgrid|mailgun/i)
    expect(status).toContain('return null')
    expect(contact).toContain("outcome: 'unavailable'")
  })
})

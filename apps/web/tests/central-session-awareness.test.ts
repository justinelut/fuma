import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const source = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('central identity awareness on public landing pages', () => {
  test('reads only boolean status from the exact auth host with credentialed requests', () => {
    const session = source('components/central-session.tsx')
    expect(session).toContain("const AUTH_STATUS_URL = 'https://auth.trimly.co.ke/session/status'")
    expect(session).toContain("credentials: 'include'")
    expect(session).toContain("Object.keys(value).length === 1")
    expect(session).not.toMatch(/email|userId|sessionId|token/i)
  })

  test('switches desktop and mobile account actions and guards start pages', () => {
    expect(source('components/site-shell.tsx')).toContain('<CentralAccountActions />')
    const mobile = source('components/mobile-menu.tsx')
    expect(mobile).toContain("identityStatus === 'authenticated'")
    expect(mobile).toContain('>Dashboard</a>')
    expect(mobile).toContain('>Account</a>')
    expect(source('app/start/page.tsx')).toContain('<AuthenticatedStartRedirect />')
  })

  test('limits external connections to central auth', async () => {
    const config = source('next.config.ts')
    expect(config).toContain("connect-src 'self' https://auth.trimly.co.ke")
    expect(config).not.toContain('app.trimly.co.ke; object-src')
  })
})

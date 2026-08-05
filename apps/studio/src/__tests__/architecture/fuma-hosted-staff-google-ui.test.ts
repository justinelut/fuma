import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('Vite React hosted staff authentication UI', () => {
  test('owns Google initiation in React and validates the provider through the typed client', () => {
    const view = read('src/admin/preauth/HostedStaffPreAuth.tsx')
    const client = read('src/core/fuma/auth/client.ts')
    expect(view).toContain('beginHostedStaffGoogleSignIn')
    expect(view).toContain('Continue with Google')
    expect(view).toContain("new URL('/admin', window.location.origin)")
    expect(client).toContain("`${AUTH_BASE}/sign-in/social`")
    expect(client).toContain("url.hostname !== 'accounts.google.com'")
  })

  test('uses existing admin tokens and deliberately avoids gradients and raw utility classes', () => {
    const view = read('src/admin/preauth/HostedStaffPreAuth.tsx')
    const css = read('src/admin/preauth/HostedStaffPreAuth.module.css')
    for (const token of ['var(--space-l)', 'var(--border)', 'var(--bg-surface-2)', 'var(--text-bright)', 'var(--accent-1)']) {
      expect(css).toContain(token)
    }
    expect(css).not.toMatch(/gradient\(|#[0-9a-f]{3,8}/i)
    expect(view).not.toMatch(/className=["'][^"']*(?:flex|grid|p-[0-9]|text-[a-z])/)
    expect(css).toContain(':focus-visible')
    expect(css).toContain('prefers-reduced-motion')
  })
})

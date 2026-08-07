import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('Vite React hosted staff authentication UI', () => {
  test('owns Google initiation in React and validates the provider through the typed client', () => {
    const view = read('src/admin/preauth/HostedStaffPreAuth.tsx')
    const client = read('src/core/fuma/auth/client.ts')
    const central = read('server/auth/hosted/centralStaffHandoff.ts')
    expect(view).toContain('beginHostedStaffGoogleSignIn')
    expect(view).toContain('Continue with Google')
    expect(view).toContain("new URL('/admin', window.location.origin)")
    expect(client).toContain("new URL('/api/auth/central-google', callback.origin)")
    expect(client).not.toContain("`${AUTH_BASE}/sign-in/social`")
    expect(central).toContain("provider.hostname !== 'accounts.google.com'")
  })

  test('uses existing admin tokens and deliberately avoids gradients and raw colour values', () => {
    const view = read('src/admin/preauth/HostedStaffPreAuth.tsx')
    /*
     * The stylesheet is gone - everything outside the visual builder is Tailwind now. Every property
     * this test defended still holds; each is simply expressed as a utility rather than a declaration,
     * so all of them are re-asserted against the view instead of being dropped.
     */
    for (const token of ['bg-card', 'border-border', 'text-foreground', 'text-muted-foreground']) {
      // Semantic shadcn tokens resolve to the same theme variables the stylesheet named directly, so
      // a colour still cannot be introduced outside the design system.
      expect(view, token).toContain(token)
    }
    expect(view).not.toMatch(/gradient\(/i)
    // No raw hex anywhere in a class position: an arbitrary value would bypass the theme.
    expect(view).not.toMatch(/className=["'][^"']*#[0-9a-f]{3,8}/i)
    expect(view).not.toContain('module.css')
    // A keyboard-reachable control must show focus, and animation must yield to reduced motion.
    expect(view).toContain('focus-visible:')
    expect(view).toContain('motion-reduce:')
  })
})

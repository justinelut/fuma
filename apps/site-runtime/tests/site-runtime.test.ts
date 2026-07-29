import { describe, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { proxy } from '../proxy'
import { beginDrain, isDraining } from '../lib/drain'
import { resolveRuntimeLink } from '../lib/links'
import { authorizeRoutedHost, canonicalQuery, canonicalRoute, normalizeTenantHost, siteMemberSessionToken } from '../lib/request-authority'

const token = 'routing-token-that-is-at-least-thirty-two-bytes'
const ROOT = join(import.meta.dir, '../../..')

function headers(values: Record<string, string>): Headers { return new Headers(values) }

describe('FUMA-SITE-003 exact-host Next request boundary', () => {
  test('normalizes ASCII host ports and one terminal dot while rejecting IDN, malformed, and ambiguous authorities', () => {
    expect(normalizeTenantHost('ALPHA.fuma.co.ke:443')).toBe('alpha.fuma.co.ke')
    expect(normalizeTenantHost('customer.example.')).toBe('customer.example')
    expect(() => normalizeTenantHost('xn--bcher-kva.example')).toThrow('IDN')
    expect(() => normalizeTenantHost('customer.example..')).toThrow('Malformed')
    expect(() => normalizeTenantHost('customer.example/path')).toThrow('Malformed')
  })

  test('denies direct-origin and caller-authorization requests before tenant resolution', () => {
    expect(authorizeRoutedHost(headers({ host: 'alpha.fuma.co.ke', 'x-fuma-routed-host': 'alpha.fuma.co.ke', 'x-fuma-routing-token': token }), token)).toBe('alpha.fuma.co.ke')
    expect(() => authorizeRoutedHost(headers({ host: 'alpha.fuma.co.ke' }), token)).toThrow('Direct origin')
    expect(() => authorizeRoutedHost(headers({ host: 'alpha.fuma.co.ke', 'x-fuma-routed-host': 'beta.fuma.co.ke', 'x-fuma-routing-token': token }), token)).toThrow('Direct origin')
    expect(() => authorizeRoutedHost(headers({ host: 'alpha.fuma.co.ke', authorization: 'Bearer staff', 'x-fuma-routed-host': 'alpha.fuma.co.ke', 'x-fuma-routing-token': token }), token)).toThrow('Caller authorization')
  })

  test('canonicalizes exact routes and stable query identities', () => {
    expect(canonicalRoute(undefined)).toBe('/')
    expect(canonicalRoute(['articles', 'one'])).toBe('/articles/one')
    expect(canonicalQuery({ z: 'last', a: ['two', 'one'] })).toBe('a=one&a=two&z=last')
    expect(() => canonicalRoute(['..'])).toThrow('canonical')
    expect(() => canonicalQuery({ next: 'https://foreign.example' })).toThrow('invalid')
  })

  test('forwards only the isolated host-only site-member cookie', () => {
    const value = `fmm1_${'m'.repeat(48)}`
    expect(siteMemberSessionToken(`staff=session; __Host-fuma_member_session=${value}; other=value`)).toBe(value)
    expect(siteMemberSessionToken(`__Host-fuma_member_session=${value}; __Host-fuma_member_session=${value}`)).toBeNull()
    expect(siteMemberSessionToken('__Host-fuma_member_session=wrong-realm-token')).toBeNull()
    expect(siteMemberSessionToken('staff=session')).toBeNull()
  })

  test('uses Next links only for same-host canonical page references and denies executable schemes', () => {
    expect(resolveRuntimeLink('cms:page:/menu', 'alpha.fuma.co.ke')).toEqual({ kind: 'internal', href: '/menu' })
    expect(resolveRuntimeLink('https://alpha.fuma.co.ke/about', 'alpha.fuma.co.ke')).toEqual({ kind: 'internal', href: '/about' })
    expect(resolveRuntimeLink('https://external.example/', 'alpha.fuma.co.ke')).toEqual({ kind: 'external', href: 'https://external.example/', rel: 'noopener noreferrer' })
    expect(() => resolveRuntimeLink('javascript:alert(1)', 'alpha.fuma.co.ke')).toThrow('denied')
  })

  test('keeps lifecycle state separate from tenant state and marks graceful drain', () => {
    expect(isDraining()).toBe(false)
    beginDrain()
    expect(isDraining()).toBe(true)
  })

  test('uses a distinct nonce-bound hydration CSP on forwarded requests and responses', () => {
    const first = proxy(new NextRequest('https://3101.blyss.co.ke/menu'))
    const second = proxy(new NextRequest('https://3101.blyss.co.ke/about'))
    const firstPolicy = first.headers.get('content-security-policy')
    const secondPolicy = second.headers.get('content-security-policy')
    expect(firstPolicy).toBeTruthy()
    expect(first.headers.get('x-middleware-request-content-security-policy')).toBe(firstPolicy)
    expect(firstPolicy).not.toBe(secondPolicy)
    expect(firstPolicy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/]+=*' 'strict-dynamic'/)
    expect(firstPolicy).not.toContain("'unsafe-eval'")
    expect(firstPolicy).toContain("frame-ancestors 'none'")
    expect(firstPolicy).toContain("base-uri 'self'")
    expect(firstPolicy).toContain("form-action 'self'")
    expect(firstPolicy).toContain("object-src 'none'")
    const navigation = readFileSync(join(ROOT, 'apps/site-runtime/components/navigation-state.tsx'), 'utf8')
    const config = readFileSync(join(ROOT, 'apps/site-runtime/next.config.ts'), 'utf8')
    expect(config).not.toContain('Content-Security-Policy')
    expect(navigation).toContain('usePathname()')
    expect(navigation).toContain('data-fuma-navigation-visits={visits}')
  })

  test('has no app imports, shared UI, Zod, database, provider, or arbitrary tenant server loading', () => {
    const client = readFileSync(join(ROOT, 'apps/site-runtime/lib/private-runtime-client.ts'), 'utf8')
    const page = readFileSync(join(ROOT, 'apps/site-runtime/app/[[...route]]/page.tsx'), 'utf8')
    const manifest = JSON.parse(readFileSync(join(ROOT, 'apps/site-runtime/runtime.manifest.json'), 'utf8')) as { dependencies: Record<string, string>; architecture: string }
    const source = `${client}\n${page}`
    expect(source).not.toMatch(/apps\/(?:studio|web|control-surfaces)/)
    expect(source).not.toContain('@fuma/shared-ui')
    expect(source).not.toContain("from 'zod'")
    expect(source).not.toMatch(/postgres|DATABASE_URL|provider SDK|import\([^)]*tenant/i)
    expect(manifest.architecture).toBe('linux-arm64')
    expect(manifest.dependencies).toMatchObject({ next: '16.2.9', react: '19.2.5', tailwindcss: '4.3.3', shadcn: '4.14.1' })
  })
})

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  WORKSPACE_BOUNDARY_RULE_IDS,
  WorkspaceBoundaryAuditError,
  auditFutureWorkspace,
  type WorkspaceBoundaryRuleId,
} from '../../../../../tooling/workspace/auditor'

const temporaryDirectories: string[] = []

function write(root: string, path: string, content: string): void {
  const absolutePath = join(root, path)
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, content)
}

function manifest(name: string, dependencies: Readonly<Record<string, string>> = {}): string {
  return JSON.stringify({ name, private: true, version: '0.0.0', dependencies }, null, 2)
}

function validWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'fuma-workspace-boundary-'))
  temporaryDirectories.push(root)
  write(root, 'package.json', JSON.stringify({
    name: 'fuma',
    private: true,
    packageManager: 'bun@1.3.14',
    workspaces: ['apps/*', 'packages/*'],
    scripts: { test: 'bun test' },
  }, null, 2))
  write(root, 'bun.lock', 'lockfileVersion = 1\n')
  write(root, 'tsconfig.base.json', '{"compilerOptions":{"strict":true}}\n')
  write(root, 'infra/cloudflare/hosts.yaml', 'canonicalPublicHost: fuma.co.ke\n')
  write(root, 'tooling/README.md', 'The auditor rejects api.fuma.co.ke and FUMA_COOKIE_DOMAIN declarations.\n')
  write(root, 'vendor/README.md', 'Vendored source remains outside workspace packages.\n')
  write(root, 'docs/adr.md', 'There is no public api.fuma.co.ke and parent-domain cookies are forbidden.\n')

  write(root, 'apps/studio/package.json', manifest('@fuma/studio', { 'better-auth': '1.6.25', react: '19.2.5' }))
  write(root, 'apps/studio/src/index.ts', "export const studio = 'product'\n")
  write(root, 'apps/studio/server/auth/routes.ts', [
    "import { betterAuth } from 'better-auth'",
    "export const authRoute = { host: 'auth.fuma.co.ke', path: '/sign-in', mount: 'better-auth', betterAuth }",
    '',
  ].join('\n'))
  write(root, 'apps/studio/server/routing/hosts.ts', [
    "export const productRoute = { host: 'app.fuma.co.ke', path: '/organizations/:organizationId/workspaces/:workspaceId/sites/:siteId' }",
    "export const consoleRoute = { host: 'admin.fuma.co.ke', path: '/console/organizations' }",
    'export const hostPolicy = { unknownHostFallback: null }',
    '',
  ].join('\n'))
  write(root, 'apps/studio/server/auth/cookies.ts', [
    "export const authCookie = { host: 'auth.fuma.co.ke', name: '__Host-fuma_auth', secure: true, httpOnly: true, sameSite: 'lax', path: '/' }",
    "export const appCookie = { host: 'app.fuma.co.ke', name: '__Host-fuma_app', secure: true, httpOnly: true, sameSite: 'lax', path: '/' }",
    "export const adminCookie = { host: 'admin.fuma.co.ke', name: '__Host-fuma_admin', secure: true, httpOnly: true, sameSite: 'lax', path: '/' }",
    '',
  ].join('\n'))
  write(root, 'apps/studio/server/tenancy/reserved.ts', [
    "export const reservedTenantNames = ['auth', 'app', 'www', 'api', 'admin', 'status', 'support', 'mail']",
    'export function allocateTenantHost(name: string) { return name }',
    '',
  ].join('\n'))

  write(root, 'apps/web/package.json', manifest('@fuma/web', { '@fuma/brand': 'workspace:*', '@fuma/public-contracts': 'workspace:*', next: '16.2.9', react: '19.2.5' }))
  write(root, 'apps/web/app/page.tsx', [
    "import { brandName } from '@fuma/brand'",
    'export function Page() { return <main>{brandName}</main> }',
    '',
  ].join('\n'))
  write(root, 'apps/web/app/api/products/route.ts', [
    "const privateProjectionUrl = 'http://studio.internal/public/v1/products'",
    'export async function GET() { return fetch(privateProjectionUrl, { headers: { accept: \'application/json\' } }) }',
    '',
  ].join('\n'))

  write(root, 'packages/brand/package.json', manifest('@fuma/brand'))
  write(root, 'packages/brand/src/index.ts', "export const brandName = 'Fuma'\n")
  write(root, 'packages/design-tokens/package.json', manifest('@fuma/design-tokens'))
  write(root, 'packages/design-tokens/src/index.ts', 'export const spacing = 8\n')
  write(root, 'packages/public-contracts/package.json', manifest('@fuma/public-contracts', { '@sinclair/typebox': '0.34.49' }))
  write(root, 'packages/public-contracts/src/index.ts', [
    "import { Type } from '@sinclair/typebox'",
    'export const ProductSchema = Type.Object({ id: Type.String() }, { additionalProperties: false })',
    '',
  ].join('\n'))
  return root
}

function findingRules(root: string): WorkspaceBoundaryRuleId[] {
  return [...new Set(auditFutureWorkspace(root).map(({ ruleId }) => ruleId))]
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('FUMA-WEB-001 workspace/public-web architecture gate', () => {
  it('accepts the complete approved future workspace and ignores policy prose', () => {
    expect(auditFutureWorkspace(validWorkspace())).toEqual([])
  })

  const rejectedFixtures: Array<Readonly<{
    ruleId: WorkspaceBoundaryRuleId
    mutate(root: string): void
  }>> = [
    { ruleId: 'workspace-topology', mutate: (root) => write(root, 'packages/utils/package.json', manifest('@fuma/utils')) },
    { ruleId: 'root-orchestrator', mutate: (root) => write(root, 'package.json', JSON.stringify({ name: 'fuma', private: true, packageManager: 'bun@1.3.14', workspaces: ['apps/*', 'packages/*'], devDependencies: { turbo: '2.0.0' } })) },
    { ruleId: 'duplicate-package-name', mutate: (root) => write(root, 'packages/brand/package.json', manifest('@fuma/web')) },
    { ruleId: 'leaf-package-boundary', mutate: (root) => write(root, 'packages/design-tokens/package.json', manifest('@fuma/design-tokens', { '@fuma/brand': 'workspace:*' })) },
    { ruleId: 'nested-git', mutate: (root) => mkdirSync(join(root, 'apps/web/vendor/theme/.git'), { recursive: true }) },
    { ruleId: 'nested-lockfile', mutate: (root) => write(root, 'apps/web/bun.lock', 'lockfileVersion = 1\n') },
    { ruleId: 'app-to-app-import', mutate: (root) => write(root, 'apps/studio/src/web.ts', "import '../../web/app/page'\n") },
    { ruleId: 'next-in-studio', mutate: (root) => write(root, 'apps/studio/src/router.ts', "import { redirect } from 'next/navigation'\nexport { redirect }\n") },
    { ruleId: 'web-authority-import', mutate: (root) => write(root, 'apps/web/lib/content.ts', "import { renderRelease } from '@platform/publisher'\nexport { renderRelease }\n") },
    { ruleId: 'public-contracts-runtime-import', mutate: (root) => write(root, 'packages/public-contracts/src/react.ts', "import React from 'react'\nexport { React }\n") },
    { ruleId: 'zod', mutate: (root) => write(root, 'packages/public-contracts/src/invalid.ts', "import { z } from 'zod'\nexport const Invalid = z.string()\n") },
    { ruleId: 'shared-cookie', mutate: (root) => write(root, 'apps/studio/server/auth/domain.ts', "export const cookie = 'session=x; Domain=.fuma.co.ke; Secure; HttpOnly'\n") },
    { ruleId: 'unsafe-cookie', mutate: (root) => write(root, 'apps/studio/server/auth/unsafe.ts', "export const cookie = { host: 'app.fuma.co.ke', name: '__Host-fuma_app', secure: false, httpOnly: true, sameSite: 'lax', path: '/' }\n") },
    { ruleId: 'session-cookie-reuse', mutate: (root) => write(root, 'apps/studio/server/auth/reuse.ts', "export const cookie = { host: 'admin.fuma.co.ke', name: '__Host-fuma_app', secure: true, httpOnly: true, sameSite: 'lax', path: '/' }\n") },
    { ruleId: 'better-auth-host', mutate: (root) => write(root, 'apps/studio/server/routes/login.ts', "import { betterAuth } from 'better-auth'\nexport const login = { host: 'app.fuma.co.ke', mount: 'better-auth', betterAuth }\n") },
    { ruleId: 'product-route-on-admin', mutate: (root) => write(root, 'apps/studio/server/routing/invalid-product.ts', "export const route = { host: 'admin.fuma.co.ke', path: '/organizations/o/workspaces/w/sites/s' }\n") },
    { ruleId: 'console-route-on-app', mutate: (root) => write(root, 'apps/studio/server/routing/invalid-console.ts', "export const route = { host: 'app.fuma.co.ke', path: '/console/support' }\n") },
    { ruleId: 'staff-surface-on-public-host', mutate: (root) => write(root, 'apps/studio/server/routing/public-auth.ts', "export const route = { host: 'fuma.co.ke', path: '/sign-in' }\n") },
    { ruleId: 'reserved-tenant-name', mutate: (root) => write(root, 'apps/studio/server/tenancy/invalid.ts', "allocateTenantHost('api')\n") },
    { ruleId: 'reserved-set-incomplete', mutate: (root) => write(root, 'apps/studio/server/tenancy/reserved.ts', "export const reservedTenantNames = ['auth', 'app']\n") },
    { ruleId: 'unknown-host-fallback', mutate: (root) => write(root, 'apps/studio/server/routing/fallback.ts', "export const hostPolicy = { unknownHostFallback: 'default-site' }\n") },
    { ruleId: 'public-api-host', mutate: (root) => write(root, 'apps/web/lib/api.ts', "export const publicApi = 'https://api.fuma.co.ke/v1/pricing'\n") },
    { ruleId: 'visitor-credential-forwarding', mutate: (root) => write(root, 'apps/web/app/api/private/route.ts', "export function GET(request: Request) { return fetch('http://studio.internal', { headers: request.headers }) }\n") },
    { ruleId: 'hardcoded-price', mutate: (root) => write(root, 'apps/web/app/pricing/page.tsx', "export const headline = 'Website plans from KES 2,500/month'\n") },
    { ruleId: 'private-commercial-field', mutate: (root) => write(root, 'packages/public-contracts/src/private.ts', "import { Type } from '@sinclair/typebox'\nexport const Bad = Type.Object({ providerCost: Type.Integer() })\n") },
  ]

  it.each(rejectedFixtures)('independently rejects $ruleId', ({ ruleId, mutate }) => {
    const root = validWorkspace()
    mutate(root)
    expect(findingRules(root)).toEqual([ruleId])
  })

  it('covers every typed rule with an independent hostile fixture', () => {
    expect(rejectedFixtures.map(({ ruleId }) => ruleId)).toEqual([...WORKSPACE_BOUNDARY_RULE_IDS])
  })

  it.each(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb'])('rejects foreign or nested lockfile %s', (lockfile) => {
    const root = validWorkspace()
    write(root, `apps/web/${lockfile}`, 'forbidden\n')
    expect(findingRules(root)).toEqual(['nested-lockfile'])
  })

  it('preserves only the historical Pixelarticons source lock as a non-authoritative vendor artifact', () => {
    const root = validWorkspace()
    write(root, 'vendor/pixel-art-icons/bun.lock', 'preserved vendored source metadata\n')
    expect(findingRules(root)).toEqual([])

    write(root, 'vendor/other/package-lock.json', '{}\n')
    expect(findingRules(root)).toEqual(['nested-lockfile'])
  })

  it('rejects Git submodules independently of nested .git directories', () => {
    const root = validWorkspace()
    write(root, '.gitmodules', '[submodule "web"]\npath = apps/web/vendor/theme\nurl = https://example.invalid/theme.git\n')
    expect(findingRules(root)).toEqual(['nested-git'])
  })

  it('rejects a non-Bun package manager independently of Turborepo', () => {
    const root = validWorkspace()
    write(root, 'package.json', JSON.stringify({ name: 'fuma', private: true, packageManager: 'pnpm@10.0.0', workspaces: ['apps/*', 'packages/*'] }))
    expect(findingRules(root)).toEqual(['root-orchestrator'])
  })

  it.each(['server/http', 'auth/session', 'provider/pricing', 'publisher', 'repositories/sites', 'migrations', 'admin/router', 'postgres'])('rejects public Web authority import %s', (specifier) => {
    const root = validWorkspace()
    write(root, 'apps/web/lib/private.ts', `import authority from '${specifier}'\nexport { authority }\n`)
    expect(findingRules(root)).toEqual(['web-authority-import'])
  })

  it.each(['react', 'next', 'bun:sqlite', 'postgres', 'drizzle-orm', 'better-auth', 'provider/pricing'])('rejects public-contracts runtime import %s', (specifier) => {
    const root = validWorkspace()
    write(root, 'packages/public-contracts/src/private.ts', `import runtime from '${specifier}'\nexport { runtime }\n`)
    expect(findingRules(root)).toEqual(['public-contracts-runtime-import'])
  })

  it.each(['auth', 'app', 'www', 'api', 'admin', 'status', 'support', 'mail'])('rejects mandatory reserved tenant allocation %s', (name) => {
    const root = validWorkspace()
    write(root, 'apps/studio/server/tenancy/invalid.ts', `allocateTenantHost('${name}')\n`)
    expect(findingRules(root)).toEqual(['reserved-tenant-name'])
  })

  it.each([
    "export const pricing = { amountMinor: 250000 }",
    "export const pricing = { quota: 1000 }",
    "export const pricing = { includedFeatures: ['custom-domain'] }",
    'export const pricing = { checkoutAvailable: true }',
    "export const pricing = { promotionTerms: 'first month free' }",
  ])('rejects hardcoded public pricing truth: %s', (source) => {
    const root = validWorkspace()
    write(root, 'apps/web/app/pricing/data.ts', `${source}\n`)
    expect(findingRules(root)).toEqual(['hardcoded-price'])
  })

  it.each(['paystackPlanId', 'providerPriceId', 'providerCost', 'grossMargin', 'internalEntitlement', 'grandfatheredContract', 'privateOffer', 'paymentState', 'transferState', 'cogs'])('rejects private commercial field %s from public contracts', (field) => {
    const root = validWorkspace()
    write(root, 'packages/public-contracts/src/private.ts', `import { Type } from '@sinclair/typebox'\nexport const Bad = Type.Object({ ${field}: Type.String() })\n`)
    expect(findingRules(root)).toEqual(['private-commercial-field'])
  })

  it('returns byte-stable ordered findings for the same hostile workspace', () => {
    const root = validWorkspace()
    write(root, 'apps/web/app/pricing/page.tsx', "export const endpoint = 'https://api.fuma.co.ke'\nexport const amount = 'KES 2,500'\n")
    const first = auditFutureWorkspace(root)
    const second = auditFutureWorkspace(root)
    expect(second).toEqual(first)
    expect(first.map(({ ruleId }) => ruleId)).toEqual(['public-api-host', 'hardcoded-price'])
  })

  it('does not follow symlinks outside the supplied workspace', () => {
    const root = validWorkspace()
    const outside = mkdtempSync(join(tmpdir(), 'fuma-workspace-outside-'))
    temporaryDirectories.push(outside)
    write(outside, 'leak.ts', "export const endpoint = 'https://api.fuma.co.ke'\n")
    symlinkSync(outside, join(root, 'apps/web/external'))
    expect(auditFutureWorkspace(root)).toEqual([])
  })

  it('rejects untyped policy input outside the fixed TypeBox contract', () => {
    expect(() => auditFutureWorkspace(validWorkspace(), { apps: ['web'] })).toThrow(WorkspaceBoundaryAuditError)
  })
})

import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../../..')
const text = (path: string) => readFile(join(ROOT, path), 'utf8')

describe('FUMA-SITE-006 Lawyer runtime architecture', () => {
  test('keeps one exact-host app and compiled owned source components', async () => {
    const [manifest, registry, components, tree] = await Promise.all([
      text('apps/site-runtime/runtime.manifest.json'),
      text('apps/site-runtime/lib/component-registry.ts'),
      text('apps/site-runtime/components/lawyer-components.tsx'),
      text('apps/site-runtime/components/runtime-tree.tsx'),
    ])
    expect(manifest).toContain('"ticket": "FUMA-SITE-006"')
    expect(registry).toContain('...LAWYER_SOURCE_COMPONENTS')
    for (const id of ['lawyer.site-shell', 'lawyer.editorial-header', 'lawyer.story-card', 'lawyer.access-gate', 'lawyer.membership-panel', 'lawyer.account-panel']) {
      expect(components).toContain(`componentId: '${id}'`)
      expect(tree).toContain(`case '${id}'`)
    }
    expect(components).not.toMatch(/^['"]use client['"]/m)
    expect(components).not.toMatch(/className=\{`|className=\{[^'"}]*\+|bg-\$\{|text-\$\{/)
    expect(components).toMatch(/sm:/)
    expect(components).toMatch(/lg:/)
  })

  test('uses strict local TypeBox contracts and existing authorities without forbidden ownership', async () => {
    const [pilot, application, server, component] = await Promise.all([
      text('apps/studio/server/fuma/lawyerImport/runtimePilot.ts'),
      text('apps/studio/server/fuma/siteRuntime/application.ts'),
      text('apps/studio/server/index.ts'),
      text('apps/site-runtime/components/lawyer-components.tsx'),
    ])
    expect(pilot).toContain('{ additionalProperties: false }')
    expect(pilot).toContain("ticket: Type.Literal('FUMA-SITE-006')")
    expect(pilot).toContain("directProviderAccess: Type.Literal(false)")
    expect(server).toContain('audienceForIdentity(scope')
    expect(server).toContain('paid: audience.paid')
    expect(application).toContain('...(projection.access ? { access: projection.access } : {})')
    for (const source of [pilot, application, component]) {
      expect(source).not.toMatch(/from ['"](?:apps\/|\.\.\/\.\.\/web|\.\.\/\.\.\/studio)/)
      expect(source).not.toMatch(/\bzod\b/i)
      expect(source).not.toMatch(/shared-ui|@fuma\/ui/)
    }
    expect(pilot).not.toMatch(/fetch\s*\(|Paystack\s*\(|Resend\s*\(|new\s+S3|process\.env/)
    expect(pilot).not.toMatch(/migration|create table|alter table/i)
  })

  test('retains responsive, reduced-motion, canonical, hydration, and budget gates', async () => {
    const [css, document, source, browser] = await Promise.all([
      text('apps/site-runtime/app/site.css'),
      text('apps/site-runtime/components/runtime-document.tsx'),
      text('apps/site-runtime/components/lawyer-components.tsx'),
      text('apps/studio/tests/e2e/fuma-site-006-lawyer.acceptance.ts'),
    ])
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('min-width: 320px')
    expect(document).toContain('<link rel="canonical"')
    expect(document).toContain('<ApplicationStateSeed')
    expect(source).toContain('Skip to content')
    expect(source).toContain('aria-label="Primary navigation"')
    expect(Buffer.byteLength(source)).toBeLessThan(24 * 1024)
    expect(browser).toContain("const PUBLIC = 'https://3121.blyss.co.ke'")
    expect(browser).toContain("const PRIVATE = 'https://3123.blyss.co.ke'")
    expect(browser).toContain("process.arch === 'arm64'")
    expect(browser).toContain('page.goto(`${PUBLIC}/article/the-constitutional-pivot`')
    expect(browser).not.toMatch(/page\.goto\((?:`|'|")http:\/\/(?:localhost|127\.0\.0\.1)/)
  })
})

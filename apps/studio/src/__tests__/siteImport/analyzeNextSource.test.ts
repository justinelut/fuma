import { describe, expect, it } from 'bun:test'
import { Value } from '@core/utils/typeboxHelpers'
import {
  analyzeNextSource,
  NextSourceAnalysisReportSchema,
  type FileMap,
  type NextSourceAnalysisRequest,
} from '@core/siteImport'

const text = (value: string): Uint8Array => new TextEncoder().encode(value)
const request: NextSourceAnalysisRequest = {
  destination: {
    organizationId: 'organization-1',
    workspaceId: 'workspace-1',
    siteId: 'site-1',
  },
  provenance: {
    kind: 'zip',
    locator: 'lawyer-source.zip',
    revision: 'sha256:fixture',
  },
}

function fileMap(entries: Record<string, string>): FileMap {
  return {
    files: Object.fromEntries(
      Object.entries(entries).map(([path, content]) => [path, { bytes: text(content) }]),
    ),
  }
}

describe('analyzeNextSource', () => {
  it('builds a deterministic App Router module/import inventory and strict report', async () => {
    const entries = {
      'package.json': JSON.stringify({
        name: 'portable-site',
        packageManager: 'pnpm@10.0.0',
        scripts: { build: 'next build', postinstall: 'node scripts/install.js' },
        dependencies: { next: '^16.0.0', react: '^19.0.0', clsx: '^2.1.0' },
        devDependencies: { eslint: '^9.0.0', typescript: '^6.0.0' },
      }),
      'pnpm-lock.yaml': 'lockfileVersion: 9',
      'src/app/(marketing)/page.tsx': [
        "import Link from 'next/link'",
        "import Hero from '@/components/Hero'",
        "import type { ReactNode } from 'react'",
        'export default function Page(){ return <><Hero/><Link href="/blog">Blog</Link></> }',
      ].join('\n'),
      'src/app/blog/[slug]/page.tsx': 'export default function Article(){ return <main>Article</main> }',
      'src/components/Hero.tsx': "import { clsx } from 'clsx'; export default function Hero(){ return <h1 className={clsx('hero')}>Hero</h1> }",
      'src/app/globals.css': '.hero { color: black; }',
      'public/logo.svg': '<svg/>',
    }
    const first = await analyzeNextSource(fileMap(entries), request)
    const reversed = await analyzeNextSource(fileMap(Object.fromEntries(Object.entries(entries).reverse())), request)

    expect(first.sourceHashSha256).toBe(reversed.sourceHashSha256)
    expect(first.bindingHashSha256).toBe(reversed.bindingHashSha256)
    expect(first.router).toBe('app')
    expect(first.routes.map(({ route }) => route)).toEqual(['/', '/blog/[slug]'])
    expect(first.modules.map(({ path }) => path)).toEqual([
      'src/app/(marketing)/page.tsx',
      'src/app/blog/[slug]/page.tsx',
      'src/components/Hero.tsx',
    ])
    expect(first.modules[0]?.imports).toEqual([
      {
        specifier: 'next/link', kind: 'static', policy: 'supported',
        packageName: 'next', installedVersion: '16.2.9', line: 1,
      },
      {
        specifier: '@/components/Hero', kind: 'static', policy: 'local',
        resolvedPath: 'src/components/Hero.tsx', line: 2,
      },
      {
        specifier: 'react', kind: 'type-static', policy: 'supported',
        packageName: 'react', installedVersion: '19.2.5', line: 3,
      },
    ])
    expect(first.packageEvidence).toMatchObject({
      present: true,
      path: 'package.json',
      scriptNames: ['build', 'postinstall'],
      lockfiles: ['pnpm-lock.yaml'],
      scriptsExecuted: false,
      packagesInstalled: false,
    })
    expect(first.packageEvidence.dependencies.find(({ name }) => name === 'eslint')?.policy)
      .toBe('evidence-only')
    expect(first.blocking).toBe(false)
    expect(Value.Check(NextSourceAnalysisReportSchema, first)).toBe(true)
  })

  it('binds the same source hash to a different destination with a different receipt hash', async () => {
    const source = fileMap({ 'app/page.tsx': 'export default function Page(){ return <main/> }' })
    const first = await analyzeNextSource(source, request)
    const second = await analyzeNextSource(source, {
      ...request,
      destination: { ...request.destination, siteId: 'site-2' },
    })

    expect(first.sourceHashSha256).toBe(second.sourceHashSha256)
    expect(first.bindingHashSha256).not.toBe(second.bindingHashSha256)
    expect(second.destination.siteId).toBe('site-2')
  })

  it('blocks unsupported packages, provider SDKs, server APIs, dynamic imports, and env access', async () => {
    const report = await analyzeNextSource(fileMap({
      'package.json': JSON.stringify({
        dependencies: { next: '^15.0.0', stripe: '^18.0.0', mystery: '1.0.0' },
      }),
      'app/api/route.ts': [
        "import { NextResponse } from 'next/server'",
        "import Stripe from 'stripe'",
        "import thing from 'mystery'",
        "const legacy = require('mystery')",
        "const local = import('./worker')",
        'const computed = import(moduleName)',
        'const secret = process.env.SECRET_KEY',
        'const color = "red"',
        'export function Widget(){ return <div className={`bg-${color}`}/> }',
        'export async function POST(){ return NextResponse.json({ secret, local, computed, thing, Stripe }) }',
      ].join('\n'),
      'app/api/worker.ts': 'export default 1',
    }), request)

    const categories = new Set(report.diagnostics.map(({ category }) => category))
    expect(categories).toEqual(new Set([
      'dynamic-import-denied',
      'provider-sdk-denied',
      'secret-or-environment-access',
      'server-authority-required',
      'unsupported-dependency',
    ]))
    expect(report.blocking).toBe(true)
    expect(report.routes).toEqual([
      { router: 'app', kind: 'route-handler', route: '/api', sourcePath: 'app/api/route.ts' },
    ])
    expect(report.modules[0]?.imports.find(({ specifier, kind }) => specifier === 'mystery' && kind === 'require'))
      .toMatchObject({ policy: 'blocked', packageName: 'mystery' })
    expect(report.modules[0]?.imports.find(({ specifier }) => specifier === './worker'))
      .toMatchObject({ kind: 'dynamic', policy: 'blocked', resolvedPath: 'app/api/worker.ts' })
  })

  it('inventories finite conditional and local const class templates', async () => {
    const report = await analyzeNextSource(fileMap({
      'app/page.tsx': [
        'const color = "red"',
        'export default function Page({ active }: { active: boolean }) {',
        '  return <main><div className={`base ${active ? "text-red-500" : "text-blue-500"}`}/><div className={`bg-${color}`}/></main>',
        '}',
      ].join('\n'),
    }), request)

    expect(report.diagnostics.filter(({ category }) => category === 'dynamic-tailwind-denied')).toEqual([])
    expect(report.styles.find(({ path }) => path === 'app/page.tsx')?.staticClassNames).toEqual([
      'base', 'bg-red', 'text-blue-500', 'text-red-500',
    ])
  })


  it('inventories bounded immutable const-map values only with an explicit unknown-key fallback', async () => {
    const report = await analyzeNextSource(fileMap({
      'app/page.tsx': [
        'const statusStyles = { active: "text-green-700", idle: "text-gray-500" } as const',
        'export default function Page({ state }: { state: string }) {',
        '  return <div className={`base ${statusStyles[state] ?? "text-muted-foreground"}`}/>',
        '}',
      ].join('\n'),
    }), request)

    expect(report.diagnostics.filter(({ category }) => category === 'dynamic-tailwind-denied')).toEqual([])
    expect(report.styles.find(({ path }) => path === 'app/page.tsx')?.staticClassNames).toEqual([
      'base', 'text-gray-500', 'text-green-700', 'text-muted-foreground',
    ])
  })


  it('inventories literal string props across bounded calls to a local non-exported component', async () => {
    const report = await analyzeNextSource(fileMap({
      'app/page.tsx': [
        'function Swatch({ bg, text }: { bg: string; text: string }) {',
        '  return <div className={`tile ${bg} ${text}`}/>',
        '}',
        'export default function Page() {',
        '  return <main><Swatch bg="bg-red-500" text="text-white"/><Swatch bg="bg-paper" text="text-black"/></main>',
        '}',
      ].join('\n'),
    }), request)

    expect(report.diagnostics.filter(({ category }) => category === 'dynamic-tailwind-denied')).toEqual([])
    expect(report.styles.find(({ path }) => path === 'app/page.tsx')?.staticClassNames).toEqual([
      'bg-paper', 'bg-red-500', 'text-black', 'text-white', 'tile',
    ])
  })

  it('does not infer props for exported, spread-driven, or escaping components', async () => {
    const report = await analyzeNextSource(fileMap({
      'app/page.tsx': [
        'export function Exported({ tone }: { tone: string }) { return <div className={`exported ${tone}`}/> }',
        'function Spread({ tone }: { tone: string }) { return <div className={`spread ${tone}`}/> }',
        'function Escaped({ tone }: { tone: string }) { return <div className={`escaped ${tone}`}/> }',
        'const Alias = Escaped',
        'const props = { tone: "text-blue-500" }',
        'export default function Page() {',
        '  return <main><Exported tone="text-red-500"/><Spread {...props}/><Escaped tone="text-green-500"/></main>',
        '}',
      ].join('\n'),
    }), request)

    expect(report.diagnostics.filter(({ category }) => category === 'dynamic-tailwind-denied')).toHaveLength(3)
  })
  it('keeps mutable, spread, computed-key, unguarded, and shadowed maps blocked', async () => {
    const report = await analyzeNextSource(fileMap({
      'app/page.tsx': [
        'const mutable = { active: "text-green-700" } as const',
        'mutable.active = runtimeClass',
        'const base = { active: "text-blue-700" } as const',
        'const spread = { ...base, idle: "text-gray-500" } as const',
        'const computed = { [runtimeKey]: "text-red-700" } as const',
        'const unguarded = { active: "text-amber-700" } as const',
        'const shadowed = { active: "text-violet-700" } as const',
        'export function Shadow({ shadowed, state }: { shadowed: Record<string, string>; state: string }) {',
        '  return <div className={`shadow ${shadowed[state] ?? "text-black"}`}/>',
        '}',
        'export default function Page({ state }: { state: string }) {',
        '  return <main>',
        '    <div className={`mutable ${mutable[state] ?? "text-black"}`}/>',
        '    <div className={`spread ${spread[state] ?? "text-black"}`}/>',
        '    <div className={`computed ${computed[state] ?? "text-black"}`}/>',
        '    <div className={`unguarded ${unguarded[state]}`}/>',
        '  </main>',
        '}',
      ].join('\n'),
    }), request)

    expect(report.diagnostics.filter(({ category }) => category === 'dynamic-tailwind-denied')).toHaveLength(5)
    expect(report.styles.flatMap(({ staticClassNames }) => staticClassNames)).not.toContain('text-black')
  })
  it('reports remappable Next APIs as blocking deterministic fixes', async () => {
    const report = await analyzeNextSource(fileMap({
      'pages/index.tsx': [
        "import { useRouter } from 'next/router'",
        "import Script from 'next/script'",
        'export default function Page(){ const router = useRouter(); return <Script id={router.pathname}/> }',
      ].join('\n'),
    }), request)

    expect(report.router).toBe('pages')
    expect(report.routes[0]?.route).toBe('/')
    expect(report.diagnostics).toHaveLength(2)
    expect(report.diagnostics.every(({ category, deterministicFix }) =>
      category === 'unsupported-next-api' && Boolean(deterministicFix),
    )).toBe(true)
    expect(report.blocking).toBe(true)
  })



  it('discovers standard App Router metadata and system files without executing them', async () => {
    const report = await analyzeNextSource(fileMap({
      'app/icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
      'app/apple-icon.tsx': 'export default function Icon(){ return <div>Icon</div> }',
      'app/robots.ts': 'export default function robots(){ return { rules: [] } }',
      'app/sitemap.ts': 'export default function sitemap(){ return [] }',
      'app/error.tsx': 'export default function Error(){ return <main>Error</main> }',
      'app/not-found.tsx': 'export default function NotFound(){ return <main>Not found</main> }',
    }), request)

    expect(report.routes).toEqual([
      { router: 'app', kind: 'system', route: '/_error', sourcePath: 'app/error.tsx' },
      { router: 'app', kind: 'system', route: '/_not-found', sourcePath: 'app/not-found.tsx' },
      { router: 'app', kind: 'metadata', route: '/apple-icon', sourcePath: 'app/apple-icon.tsx' },
      { router: 'app', kind: 'metadata', route: '/icon.svg', sourcePath: 'app/icon.svg' },
      { router: 'app', kind: 'metadata', route: '/robots.txt', sourcePath: 'app/robots.ts' },
      { router: 'app', kind: 'metadata', route: '/sitemap.xml', sourcePath: 'app/sitemap.ts' },
    ])
    expect(report.diagnostics.filter(({ category }) => category === 'server-authority-required')).toHaveLength(3)
    expect(report.diagnostics.filter(({ category }) => category === 'unsupported-next-api')).toHaveLength(2)
    expect(report.diagnostics.some(({ path }) => path === 'app/icon.svg')).toBe(false)
    expect(report.importedCodeExecuted).toBe(false)
  })
  it('limits blockers and interactions to the runtime-reachable route graph', async () => {
    const report = await analyzeNextSource(fileMap({
      'package.json': JSON.stringify({ dependencies: { stripe: '^18.0.0', mystery: '1.0.0' } }),
      'app/page.tsx': "import Hero from '../components/Hero'; export default function Page(){ return <Hero/> }",
      'components/Hero.tsx': 'export default function Hero(){ return <main>Reachable</main> }',
      'tests/payment.test.tsx': "import Stripe from 'stripe'; const secret = process.env.SECRET; export const Form = () => <form onSubmit={() => Stripe(secret)} />",
      'scripts/tool.ts': "import thing from 'mystery'; export default thing",
    }), request)

    expect(report.modules.map(({ path }) => path)).toEqual(['app/page.tsx', 'components/Hero.tsx'])
    expect(report.files.map(({ path }) => path)).toContain('tests/payment.test.tsx')
    expect(report.packageEvidence.dependencies.filter(({ policy }) => policy === 'blocked')).toHaveLength(2)
    expect(report.diagnostics).toEqual([])
    expect(report.interactions).toEqual([])
    expect(report.blocking).toBe(false)
  })

  it('blocks incompatible installed ranges only for runtime-reachable imports', async () => {
    const report = await analyzeNextSource(fileMap({
      'package.json': JSON.stringify({ dependencies: { next: '^15.0.0', stripe: '^18.0.0' } }),
      'app/page.tsx': "import Link from 'next/link'; export default function Page(){ return <Link href='/'>Home</Link> }",
    }), request)

    expect(report.diagnostics).toHaveLength(1)
    expect(report.diagnostics[0]).toMatchObject({
      category: 'unsupported-dependency',
      path: 'app/page.tsx',
      specifier: 'next/link',
    })
    expect(report.diagnostics[0]?.message).toContain('does not accept installed 16.2.9')
    expect(report.diagnostics.some(({ category }) => category === 'provider-sdk-denied')).toBe(false)
    expect(report.blocking).toBe(true)
  })

  it('accepts only exact reviewed interaction bindings supplied outside imported source', async () => {
    const source = fileMap({
      'app/page.tsx': 'export default function Page(){ return <form data-fuma-authority="fake.form"><input name="email" /></form> }',
    })
    const unbound = await analyzeNextSource(source, request)
    expect(unbound.interactions).toEqual([{
      id: 'form:app/page.tsx:1',
      kind: 'form',
      path: 'app/page.tsx',
      line: 1,
      boundAuthority: null,
    }])
    expect(unbound.diagnostics.some(({ category }) => category === 'unbound-form-interaction')).toBe(true)

    const bound = await analyzeNextSource(source, {
      ...request,
      interactionBindings: [{ interactionId: 'form:app/page.tsx:1', kind: 'form', authority: 'core.public-form' }],
    })
    expect(bound.interactions[0]?.boundAuthority).toBe('core.public-form')
    expect(bound.diagnostics.some(({ category }) => category === 'unbound-form-interaction')).toBe(false)
    expect(bound.blocking).toBe(false)
    expect(bound.bindingHashSha256).not.toBe(unbound.bindingHashSha256)

    await expect(analyzeNextSource(source, {
      ...request,
      interactionBindings: [{ interactionId: 'form:app/page.tsx:1', kind: 'form', authority: 'publication.content' }],
    } as unknown as NextSourceAnalysisRequest)).rejects.toThrow('Invalid scoped Next.js source-analysis request')
  })

  it('maps every supported interaction kind only to its reviewed strict authority', async () => {
    const source = fileMap({
      'app/page.tsx': [
        "import Content from '../components/Content'",
        "import Member from '../components/Member'",
        "import Subscription from '../components/Subscription'",
        "import Contact from '../components/Contact'",
        'export default function Page(){ return <main><Content/><Member/><Subscription/><Contact/></main> }',
      ].join('\n'),
      'components/Content.tsx': 'export default function Content(){ const usePosts = true; return <section>Posts</section> }',
      'components/Member.tsx': 'export default function Member(){ const member = true; return <section>Account</section> }',
      'components/Subscription.tsx': 'export default function Subscription(){ const subscribe = true; return <section>Subscribe</section> }',
      'components/Contact.tsx': 'export default function Contact(){ return <form><input name="email" /></form> }',
    })
    const unbound = await analyzeNextSource(source, request)
    expect([...new Set(unbound.interactions.map(({ kind }) => kind))].sort()).toEqual(['content', 'form', 'member', 'subscription'])
    const authority = {
      content: 'publication.content',
      member: 'publication.member-access',
      subscription: 'publication.membership-payments',
      form: 'core.public-form',
    } as const
    const interactionBindings = unbound.interactions.map((interaction) => ({
      interactionId: interaction.id,
      kind: interaction.kind as keyof typeof authority,
      authority: authority[interaction.kind as keyof typeof authority],
    }))
    const bound = await analyzeNextSource(source, { ...request, interactionBindings })
    expect(bound.interactions.every(({ boundAuthority }) => boundAuthority !== null)).toBe(true)
    expect(bound.diagnostics.filter(({ category }) => category.startsWith('unbound-'))).toEqual([])
    expect(bound.blocking).toBe(false)
  })

  it('keeps podcast interactions blocking because no reviewed binding contract exists', async () => {
    const source = fileMap({
      'app/page.tsx': 'export default function Page(){ return <main>Podcast episodes</main> }',
    })
    const report = await analyzeNextSource(source, request)
    expect(report.interactions).toMatchObject([{ kind: 'podcast', boundAuthority: null }])
    expect(report.diagnostics).toMatchObject([{ category: 'unbound-podcast-interaction', severity: 'blocking' }])
    await expect(analyzeNextSource(source, {
      ...request,
      interactionBindings: [{
        interactionId: report.interactions[0]!.id,
        kind: 'podcast',
        authority: 'publication.content',
      }],
    } as unknown as NextSourceAnalysisRequest)).rejects.toThrow('Invalid scoped Next.js source-analysis request')
  })

  it('never executes imported source or package scripts', async () => {
    const marker = '__fumaNextSourceAnalyzerExecutionMarker'
    delete (globalThis as Record<string, unknown>)[marker]
    const report = await analyzeNextSource(fileMap({
      'package.json': JSON.stringify({ scripts: { postinstall: `globalThis.${marker} = true` } }),
      'app/page.tsx': `globalThis.${marker} = true; export default function Page(){ return null }`,
    }), request)

    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined()
    expect(report.packageEvidence.scriptsExecuted).toBe(false)
    expect(report.packageEvidence.packagesInstalled).toBe(false)
  })

  it('blocks malformed manifests, unresolved local imports, route conflicts, and unsafe file maps', async () => {
    const report = await analyzeNextSource(fileMap({
      'package.json': '{bad',
      'app/page.tsx': "import Missing from './missing'; export default function Page(){ return <Missing/> }",
      'pages/index.tsx': 'export default function Legacy(){ return null }',
    }), request)

    expect(report.router).toBe('mixed')
    expect(new Set(report.diagnostics.map(({ category }) => category))).toEqual(new Set([
      'invalid-manifest', 'route-conflict', 'unresolved-local-import',
    ]))
    await expect(analyzeNextSource({ files: { '../escape.ts': { bytes: text('') } } }, request))
      .rejects.toThrow('Unsafe ingested source path')
  })
})

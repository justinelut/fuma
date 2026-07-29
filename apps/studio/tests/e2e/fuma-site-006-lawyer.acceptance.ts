import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, type BrowserContext, type Page } from 'playwright-core'
import { ResolveResponseSchema, parseContract, type ResolveResponse, type RuntimeNode } from '../../../site-runtime/lib/contracts'

const PUBLIC = 'https://3121.blyss.co.ke'
const PRIVATE = 'https://3123.blyss.co.ke'
const NEXT_ORIGIN = 'http://127.0.0.1:3114'
const ROUTING_TOKEN = 'fuma-site-006-routing-token-0000000000000000'
const SERVICE_TOKEN = 'fuma-site-006-service-token-0000000000000000'
const HASH = createHash('sha256').update('FUMA-SITE-006').digest('hex')
const INTEGRITY = `sha256-${Buffer.from(HASH, 'hex').toString('base64')}`
const EVIDENCE = resolve(process.cwd(), '.tmp/fuma-site-006-browser')
const COMPONENTS = [
  ['lawyer.site-shell', '1.0.0'],
  ['lawyer.editorial-header', '1.0.0'],
  ['lawyer.story-card', '1.0.0'],
  ['lawyer.access-gate', '1.0.0'],
  ['lawyer.membership-panel', '1.0.0'],
  ['base.text', '2.0.0'],
] as const

function sha256(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex') }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
function official(componentId: string, exactVersion: string) { return { namespace: 'fuma.official', componentId, exactVersion } }
function node(nodeId: string, componentId: string, exactVersion: string, props: Record<string, unknown> = {}, children: RuntimeNode[] = []): RuntimeNode {
  return {
    nodeId,
    component: official(componentId, exactVersion),
    props,
    classes: [],
    styles: [],
    requiredCapabilities: [],
    bindings: [],
    slots: children.length ? [{ name: 'children', children }] : [],
  } as RuntimeNode
}
function registryEntry([componentId, exactVersion]: typeof COMPONENTS[number]) {
  return {
    reference: official(componentId, exactVersion),
    source: { kind: 'official', publisher: 'fuma', ownerKey: null, siteId: null, origin: 'runtime-source' },
    execution: 'official-server',
    trust: {
      tier: 'official', reviewState: 'compiled-into-runtime', ownerConfirmed: true,
      validation: { typecheck: true, build: true, staticUtilities: true, accessibility: true, security: true, csp: true, bundleBudget: true },
    },
    propsSchemaHashSha256: HASH,
    slotsSchemaHashSha256: HASH,
    sourceHashSha256: HASH,
    capabilities: [],
    artifactPaths: [],
    parameters: [],
    definition: null,
    dynamicTenantServerImport: false,
    persistedExecutableJsx: false,
  }
}
function routeTree(route: string): RuntimeNode {
  const navigation = [
    { label: 'Home', href: '/article/the-constitutional-pivot' },
    { label: 'Member analysis', href: '/member-analysis' },
    { label: 'Paid analysis', href: '/paid-analysis' },
    { label: 'Membership', href: '/membership' },
  ]
  const header = node('lawyer-header', 'lawyer.editorial-header', '1.0.0', {
    eyebrow: route === '/paid-analysis' ? 'Subscriber analysis' : 'The Lawyer',
    canonicalPath: route,
    title: route === '/article/the-constitutional-pivot' ? 'The constitutional pivot' : route === '/member-analysis' ? 'Member analysis' : route === '/paid-analysis' ? 'Paid analysis' : 'The Lawyer',
    excerpt: 'Independent legal journalism projected from Fuma publication content.',
    byline: 'The Lawyer newsroom', publishedAt: '2026-07-27T09:00:00Z', publishedLabel: '27 July 2026',
  })
  let content: RuntimeNode[]
  if (route === '/membership') {
    content = [node('lawyer-membership', 'lawyer.membership-panel', '1.0.0', { title: 'Read beyond the headline', tier: 'Practitioner', price: 'KES 950' })]
  } else if (route === '/member-analysis' || route === '/paid-analysis') {
    const requirement = route === '/paid-analysis' ? 'paid' : 'member'
    content = [header, node('lawyer-gate', 'lawyer.access-gate', '1.0.0', { requirement }, [
      node('lawyer-full-story', 'base.text', '2.0.0', { tag: 'p', text: `Full ${requirement} analysis from the owned source component.`, htmlAttributes: { 'data-lawyer-full-story': requirement } }),
    ])]
  } else {
    content = [header,
      node('lawyer-member-card', 'lawyer.story-card', '1.0.0', { title: 'Member analysis', href: '/member-analysis', section: 'Courts', excerpt: 'Continue with a reactivated member account.' }),
      node('lawyer-paid-card', 'lawyer.story-card', '1.0.0', { title: 'Paid analysis', href: '/paid-analysis', section: 'Practice', excerpt: 'Verified subscribers can continue.' }),
    ]
  }
  return node('lawyer-shell', 'lawyer.site-shell', '1.0.0', { navigation }, content)
}
function responseFor(route: string, memberSessionToken: string | null): ResolveResponse {
  const paid = memberSessionToken?.includes('_paid_') ?? false
  const member = paid || (memberSessionToken?.includes('_member_') ?? false)
  const audience = member
    ? { kind: 'member' as const, memberId: 'lawyer-member-1', accessFingerprintSha256: HASH }
    : { kind: 'public' as const, memberId: null, accessFingerprintSha256: HASH }
  const identity = {
    host: '3121.blyss.co.ke', platformId: 'platform-fuma', organizationId: 'organization-lawyer', workspaceId: 'workspace-lawyer', siteId: 'site-lawyer', ownerKey: 'owner-lawyer', ownerGeneration: 1,
    releaseId: 'release-lawyer-site-006', releaseHashSha256: HASH, route, canonicalQuery: '', audience,
    runtimeDeploymentVersion: '1.0.0', componentRegistryVersion: '1.0.0', rolloutPolicyVersion: 1,
  }
  const legacyHtml = '<main><h1>Retained Lawyer release</h1><p>Non-mutating exact-route rollback.</p></main>'
  const legacy = route === '/rollback' ? {
    releaseId: 'release-lawyer-retained', route, html: legacyHtml, contentHashSha256: sha256(legacyHtml), scripts: [],
    csp: "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'" as const,
  } : null
  const selected = legacy ? 'legacy' as const : 'react' as const
  const root = routeTree(route)
  const value = {
    schemaVersion: 1, contractVersion: '1.0.0', cacheIdentity: identity, sourceSnapshotHashSha256: HASH,
    application: {
      schemaVersion: 1, cacheIdentity: identity,
      member: member
        ? { authenticated: true, memberIdentityId: 'identity-lawyer-1', memberId: 'lawyer-member-1', sessionId: 'session-lawyer-1', displayName: 'Lawyer Member' }
        : { authenticated: false, memberIdentityId: null, memberId: null, sessionId: null, displayName: null },
      snapshot: { version: 0, cart: { items: [] }, booking: { selections: [] }, account: null },
      access: { member, paid, memberSource: paid ? 'paid' : member ? 'registered' : 'none', segmentIds: member ? ['lawyer-readers'] : [] },
      cachePolicy: member ? 'private' : 'public',
    },
    delivery: {
      selected, reason: legacy ? 'shadow-mismatch-fallback' : 'shadow-match',
      policy: { route, target: 'react', shadow: 'compare', fallback: 'legacy', legacyReleaseId: 'release-lawyer-retained', version: 1 },
      shadowParity: legacy ? 'mismatched' : 'matched', legacy,
    },
    routeArtifact: {
      schemaVersion: 1, contractVersion: '1.0.0',
      platformId: identity.platformId, organizationId: identity.organizationId, workspaceId: identity.workspaceId, siteId: identity.siteId, ownerKey: identity.ownerKey, ownerGeneration: 1,
      releaseId: identity.releaseId, sourceSnapshotId: 'snapshot-lawyer-site-006', sourceSnapshotHashSha256: HASH, componentRegistryVersion: '1.0.0',
      route: { route, pageId: `page-${route.replaceAll('/', '-') || 'home'}`, artifactPath: '/runtime/lawyer-route.json', semanticHtmlPath: '/runtime/lawyer-route.html', layoutIds: [], styleArtifactPaths: [], publicDataKeys: [] },
      page: { pageId: `page-${route.replaceAll('/', '-') || 'home'}`, title: route === '/article/the-constitutional-pivot' ? 'The constitutional pivot' : 'The Lawyer', root },
      layouts: [], components: COMPONENTS.map(registryEntry),
      styles: {
        tokens: [
          { name: '--lawyer-paper', value: '#fffaf0' }, { name: '--lawyer-ink', value: '#171717' }, { name: '--lawyer-muted', value: '#525252' },
          { name: '--lawyer-accent', value: '#713f12' }, { name: '--lawyer-rule', value: '#d6d3d1' }, { name: '--lawyer-panel', value: '#f5f5f4' },
        ], breakpoints: [{ id: 'lawyer-mobile', minWidthPx: 320 }], rules: [], cssArtifactPaths: [],
      },
      stylesheets: [], publicData: [],
      artifactReferences: [{ logicalPath: '/runtime/lawyer-route.html', role: 'semantic-html', mimeType: 'text/html; charset=utf-8', contentHashSha256: HASH, integritySha256: INTEGRITY, sizeBytes: 1, references: [], component: null, declaredCapabilities: [] }],
      routeHashSha256: HASH,
    },
  }
  return parseContract(ResolveResponseSchema, value, 'FUMA-SITE-006 browser fixture') as ResolveResponse
}

async function waitForNext(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { await fetch(NEXT_ORIGIN, { redirect: 'manual' }); return } catch { await Bun.sleep(100) }
  }
  throw new Error('Standalone Next liveness check did not become ready.')
}
function attachErrors(page: Page, errors: string[]) {
  page.on('pageerror', (error) => errors.push(`pageerror:${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes("frame-ancestors' is ignored when delivered via a <meta> element")) errors.push(`console:${message.text()}`)
  })
}
async function session(context: BrowserContext, kind: 'member' | 'paid') {
  await context.addCookies([{ name: '__Host-fuma_member_session', value: `fmm1_${kind}_${'s'.repeat(48)}`, url: PUBLIC, secure: true, httpOnly: true, sameSite: 'Lax' }])
}

async function main() {
  assert(process.arch === 'arm64', `Native ARM64 is required, received ${process.arch}.`)
  await mkdir(EVIDENCE, { recursive: true })
  const authority = Bun.serve({
    hostname: '0.0.0.0', port: 3123,
    async fetch(request) {
      if (new URL(request.url).pathname !== '/_fuma/private/site-runtime/v1/resolve' || request.method !== 'POST') return new Response(null, { status: 404 })
      if (request.headers.get('authorization') !== `Bearer ${SERVICE_TOKEN}` || request.headers.get('x-fuma-audience') !== 'fuma-site-runtime') return new Response(null, { status: 403 })
      const input = await request.json() as { host?: string; route?: string; canonicalQuery?: string; runtimeDeploymentVersion?: string; memberSessionToken?: string | null }
      if (input.host !== '3121.blyss.co.ke' || input.canonicalQuery !== '' || input.runtimeDeploymentVersion !== '1.0.0' || typeof input.route !== 'string') return new Response(null, { status: 400 })
      return Response.json(responseFor(input.route, input.memberSessionToken ?? null), { headers: { 'cache-control': 'no-store' } })
    },
  })
  const proxy = Bun.serve({
    hostname: '0.0.0.0', port: 3121,
    async fetch(request) {
      const source = new URL(request.url)
      const target = new URL(`${source.pathname}${source.search}`, NEXT_ORIGIN)
      const headers = new Headers(request.headers)
      headers.set('host', '3121.blyss.co.ke')
      headers.set('x-fuma-routed-host', '3121.blyss.co.ke')
      headers.set('x-fuma-routing-token', ROUTING_TOKEN)
      headers.set('x-forwarded-proto', 'https')
      headers.set('accept-encoding', 'identity')
      headers.delete('authorization')
      headers.delete('x-forwarded-authorization')
      const upstream = await fetch(target, { method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body, redirect: 'manual' })
      const responseHeaders = new Headers(upstream.headers)
      responseHeaders.delete('content-encoding')
      responseHeaders.delete('content-length')
      const body = await upstream.arrayBuffer()
      return new Response(body, { status: upstream.status, headers: responseHeaders })
    },
  })
  const standalone = resolve(process.cwd(), 'apps/site-runtime/.next/standalone/apps/site-runtime/server.js')
  const next = spawn('node', [standalone], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '3114', FUMA_SITE_RUNTIME_PRIVATE_ORIGIN: PRIVATE, FUMA_SITE_RUNTIME_SERVICE_TOKEN: SERVICE_TOKEN, FUMA_SITE_RUNTIME_ROUTING_TOKEN: ROUTING_TOKEN, FUMA_SITE_RUNTIME_DEPLOYMENT_VERSION: '1.0.0' },
  })
  let nextLog = ''
  next.stdout.on('data', (chunk) => { nextLog += chunk.toString() })
  next.stderr.on('data', (chunk) => { nextLog += chunk.toString() })
  try {
    await waitForNext()
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    assert(executablePath, 'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH must select the verified native ARM64 Chromium binary.')
    const browser = await chromium.launch({ executablePath, headless: true })
    const errors: string[] = []
    const transcript: Record<string, unknown> = { ticket: 'FUMA-SITE-006', architecture: process.arch, browserHosts: [PUBLIC], privateAuthority: PRIVATE }
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
      const page = await context.newPage(); attachErrors(page, errors)
      const response = await page.goto(`${PUBLIC}/article/the-constitutional-pivot`, { waitUntil: 'networkidle' })
      assert(response?.ok() && response.url().startsWith(PUBLIC), 'Public article did not navigate through Blyss HTTPS.')
      assert((await page.locator('link[rel="canonical"]').getAttribute('href')) === `${PUBLIC}/article/the-constitutional-pivot`, 'Canonical link changed exact host or route.')
      assert(await page.getByRole('navigation', { name: 'Primary navigation' }).isVisible(), 'Primary navigation landmark is unavailable.')
      assert(await page.getByRole('link', { name: 'Skip to content' }).count() === 1, 'Skip link is unavailable.')
      assert((await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--lawyer-accent').trim())) === '#713f12', 'Shared Lawyer token did not reach the browser.')
      await page.evaluate(() => { (window as Window & { __lawyerDocument?: string }).__lawyerDocument = crypto.randomUUID() })
      const documentToken = await page.evaluate(() => (window as Window & { __lawyerDocument?: string }).__lawyerDocument)
      await page.getByRole('link', { name: 'Member analysis' }).first().click()
      await page.waitForURL(`${PUBLIC}/member-analysis`)
      const memberDenial = page.getByRole('heading', { name: 'Sign in to continue' })
      await memberDenial.waitFor({ state: 'visible' })
      assert(await memberDenial.isVisible(), `Member denial did not render: ${(await page.locator('body').innerText()).slice(0, 500)}`)
      assert(await page.evaluate(() => (window as Window & { __lawyerDocument?: string }).__lawyerDocument) === documentToken, `Internal Next Link caused a full document reload: ${errors.join(' | ')}`)
      await page.waitForFunction(() => Number(document.querySelector('[data-fuma-navigation-visits]')?.getAttribute('data-fuma-navigation-visits')) >= 2)
      transcript.publicAndNavigation = { canonical: true, sharedToken: '#713f12', oneDocument: true, visits: await page.locator('[data-fuma-navigation-visits]').getAttribute('data-fuma-navigation-visits') }
      await page.screenshot({ path: resolve(EVIDENCE, 'member-denied.png'), fullPage: true })
      await context.close()

      const memberContext = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await session(memberContext, 'member')
      const memberPage = await memberContext.newPage(); attachErrors(memberPage, errors)
      await memberPage.goto(`${PUBLIC}/member-analysis`, { waitUntil: 'networkidle' })
      assert(await memberPage.getByText('Full member analysis from the owned source component.').isVisible(), 'Member allowance did not render protected source content.')
      assert(await memberPage.getByText('Sign in to continue').count() === 0, 'Member allowance retained the denial gate.')
      await memberPage.screenshot({ path: resolve(EVIDENCE, 'member-allowed.png'), fullPage: true }); await memberContext.close()

      const deniedContext = await browser.newContext({ viewport: { width: 320, height: 900 }, reducedMotion: 'reduce' })
      const deniedPage = await deniedContext.newPage(); attachErrors(deniedPage, errors)
      await deniedPage.goto(`${PUBLIC}/paid-analysis`, { waitUntil: 'networkidle' })
      assert(await deniedPage.getByRole('heading', { name: 'A verified subscription is required' }).isVisible(), 'Paid denial did not render.')
      assert(await deniedPage.getByText('Legacy labels never grant access.').isVisible(), 'Paid denial omitted fail-closed legacy-label guidance.')
      assert(await deniedPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '320px paid denial has horizontal overflow.')
      const motionDuration = await deniedPage.locator('body').evaluate((element) => getComputedStyle(element).transitionDuration)
      assert(motionDuration === '1e-05s' || motionDuration === '0.00001s', `Reduced motion was not active: ${motionDuration}`)
      await deniedPage.screenshot({ path: resolve(EVIDENCE, 'paid-denied-320-reduced.png'), fullPage: true }); await deniedContext.close()

      const paidContext = await browser.newContext({ viewport: { width: 320, height: 900 } }); await session(paidContext, 'paid')
      const paidPage = await paidContext.newPage(); attachErrors(paidPage, errors)
      await paidPage.goto(`${PUBLIC}/paid-analysis`, { waitUntil: 'networkidle' })
      assert(await paidPage.getByText('Full paid analysis from the owned source component.').isVisible(), 'Verified paid allowance did not render protected content.')
      await paidPage.evaluate(() => { document.documentElement.style.fontSize = '200%' })
      assert(await paidPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '320px at 200% text zoom has horizontal overflow.')
      await paidPage.screenshot({ path: resolve(EVIDENCE, 'paid-allowed-320-zoom.png'), fullPage: true }); await paidContext.close()

      const rollbackContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
      const rollbackPage = await rollbackContext.newPage(); attachErrors(rollbackPage, errors)
      await rollbackPage.goto(`${PUBLIC}/rollback`, { waitUntil: 'networkidle' })
      const frame = rollbackPage.locator('iframe[data-fuma-legacy-release="release-lawyer-retained"]')
      assert(await frame.isVisible(), 'Exact-route retained-release rollback frame did not render.')
      assert(await rollbackPage.locator('[data-fuma-delivery="legacy"]').count() === 1, 'Rollback delivery marker did not remain legacy.')
      transcript.cutoverRollback = { react: true, retainedLegacy: true, dataMutation: false }
      transcript.access = { public: true, memberDenied: true, memberAllowed: true, paidDenied: true, paidAllowed: true }
      transcript.accessibility = { landmarks: true, skipLink: true, width320: true, textZoom200: true, reducedMotion: true }
      transcript.hydrationErrors = errors
      assert(errors.length === 0, `Browser errors were captured: ${errors.join(' | ')}`)
      await rollbackPage.screenshot({ path: resolve(EVIDENCE, 'rollback.png'), fullPage: true }); await rollbackContext.close()
    } finally { await browser.close() }
    const serialized = JSON.stringify(transcript)
    const transcriptHash = sha256(serialized)
    await writeFile(resolve(EVIDENCE, 'transcript.json'), `${JSON.stringify({ ...transcript, transcriptHashSha256: transcriptHash }, null, 2)}\n`)
    console.log(`[FUMA-SITE-006 browser] ${serialized}`)
    console.log(`[FUMA-SITE-006 browser transcript sha256] ${transcriptHash}`)
  } finally {
    next.kill('SIGTERM')
    authority.stop(true)
    proxy.stop(true)
    if (next.exitCode === null) await new Promise<void>((done) => { next.once('exit', () => done()); setTimeout(done, 3_000) })
    if (next.exitCode && next.exitCode !== 0 && next.exitCode !== 143) console.error(nextLog)
  }
}

await main()

import { tryHandleAi } from './ai/handlers'
import { handleMcpHttp, MCP_ENDPOINT_PATH } from './ai/mcp'
import type { McpNativeHttpAuthority } from './ai/mcp/authority'
import { handleCmsRequest } from './handlers/cms'
import type { DbClient } from './db/client'
import { renderNotFoundResponse, renderPublicResolution } from './publish/publicRouter'
import { readStaticAsset } from './publish/staticArtefact'
import { getLatestSnapshotForVersion } from './publish/publishedSnapshotCache'
import { getPublishVersion, registerVersionedCacheReset } from './publish/publishState'
import { prefetchMediaAssets } from './publish/mediaPrefetch'
import { getSetupStatusCached } from './repositories/setup'
import { SELF_HOST_SITE_ID } from './selfHost'
import { getPublishedRuntimeAsset } from './repositories/runtimeAsset'
import { handleLoopRequest, isLoopRuntimeAssetPath, serveLoopRuntimeAsset } from './handlers/cms/loop'
import { handleHoleRequest, isHoleRuntimeAssetPath, serveHoleRuntimeAsset } from './handlers/cms/hole'
import { handleModuleJsAssetRequest, isModuleJsAssetPath } from './handlers/cms/moduleJs'
import { handlePublicFormRequest } from './forms/handler'
import { isRuntimePackagePath, tryServeRuntimePackage } from './publish/runtime/packageServer'
import { jsonResponse } from './http'
import { binaryResponse, toArrayBuffer } from './binary'
import { hardenUploadResponse, serveAdminApp, serveStaticFile } from './static'
import { registry } from '@core/module-engine'
import type { CssBundleFile, SiteCssBundleId } from '@core/publisher'
import { buildPublishedSiteCssBundle } from './publish/siteCssBundle'
import { mediaStorageRegistry } from '@core/plugins/mediaStorageRegistry'
import type { HostedStaffAuthBoundary } from './auth/hosted/routes'
import type { CentralStaffHandoffBoundary } from './auth/hosted/centralStaffHandoff'
import type { AccessibleContextCatalogBoundary } from './fuma/context/accessibleCatalog'
import type { FumaScopedRouteBoundary } from './fuma/context'
import type { PublicProjectionBoundary } from './fuma/publicProjections'
import type { PublicHandoffAppBoundary } from './fuma/publicHandoff'
import type { PublicationPublicBoundary } from './fuma/publication'
import type { MemberAuthBoundary, MemberImportBoundary } from './fuma/memberIdentity'
import { tryServeMemberAuth, tryServeMemberImports } from './fuma/memberIdentity/routerBoundary'
import type { FreeHostPublicBoundary } from './fuma/freeHosts'
import type { PaystackWebhookBoundary } from './fuma/paystack/boundary'
import type { EntitlementAdminBoundary } from './fuma/entitlements'
import type { PlatformConsoleBoundary } from './fuma/platformConsole/boundary'
import type { PublicMarketingAnalyticsAdminBoundary } from './fuma/publicAnalytics/adminBoundary'
import type { HostedSiteOnboardingBoundary } from './fuma/onboarding'
import type { WorkspaceManagementBoundary } from './fuma/workspaces/managementBoundary'
import {
  invalidateLegacyStaffCookie,
  isLegacyHostedAuthPath,
  rejectLegacyHostedAuth,
} from './auth/hosted/cutover'

const VITE_DEV_URL = 'http://localhost:5173'
const HOSTED_MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export interface ServerRuntime {
  db: DbClient
  hostedStaffAuth?: HostedStaffAuthBoundary
  centralStaffHandoff?: CentralStaffHandoffBoundary
  accessibleContextCatalog?: AccessibleContextCatalogBoundary
  publicProjections?: PublicProjectionBoundary
  publicHandoff?: PublicHandoffAppBoundary
  publicationPublic?: PublicationPublicBoundary
  freeHostPublic?: FreeHostPublicBoundary
  memberAuth?: MemberAuthBoundary
  memberImports?: MemberImportBoundary
  paystackWebhooks?: PaystackWebhookBoundary
  entitlementAdmin?: EntitlementAdminBoundary
  platformConsole?: PlatformConsoleBoundary
  publicMarketingAnalyticsAdmin?: PublicMarketingAnalyticsAdminBoundary
  hostedSiteOnboarding?: HostedSiteOnboardingBoundary
  workspaceManagement?: WorkspaceManagementBoundary
  fumaScopedApi?: FumaScopedRouteBoundary
  mcpAuthority?: McpNativeHttpAuthority
  staticDir?: string
  uploadsDir?: string
  /** PostgreSQL URL forwarded to CMS handlers that query database metrics. */
  databaseUrl?: string
}

type RouteHandler = (
  req: Request,
  runtime: ServerRuntime,
  url: URL,
  pathname: string,
) => Promise<Response | null> | Response | null

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

const routes: readonly RouteHandler[] = [
  tryServeHealth,
  tryServeCentralStaffHandoff,
  tryServeHostedStaffAuth,
  tryRejectHostedLegacyAuth,
  tryServeMcp,
  tryServeAi,
  // Private-cluster anonymous projections own their complete namespace and
  // never fall through to tenant, CMS, or published-site routing.
  tryServePublicProjections,
  tryServeMemberAuth,
  tryServePublicationPublic,
  tryServePaystackWebhooks,
  tryServeMemberImports,
  tryServeEntitlementAdmin,
  tryServePlatformConsole,
  tryServePublicMarketingAnalyticsAdmin,
  tryServeAccessibleContextCatalog,
  tryServeHostedSiteOnboarding,
  tryServeWorkspaceManagement,
  // Hosted scoped routes own `/api/fuma` completely. Keep this before the
  // legacy CMS dispatcher so hosted requests cannot enter self-host routing.
  tryServeFumaScopedApi,
  tryServeCmsApi,
  tryServeLoopRuntimeAsset,
  tryServeLoop,
  tryServeHoleRuntimeAsset,
  tryServeHole,
  tryServeModuleJsAsset,
  tryServePublicForm,
  tryServeRuntimeAsset,
  tryServeRuntimePackageNamespace,
  tryServeSiteCssNamespace,
  tryServeMediaRedirect,
  tryServeStaticAsset,
  tryServeUpload,
  tryServeAdminApp,
  tryServePublicRoute,
  trySetupRedirect,
  tryServeNotFoundPage,
]

export async function handleServerRequest(
  req: Request,
  runtime: ServerRuntime,
): Promise<Response> {
  const url = new URL(req.url)
  const { pathname } = url
  if (runtime.freeHostPublic && pathname !== '/health') {
    const publicHostResponse = await runtime.freeHostPublic.route(req)
    if (publicHostResponse) return publicHostResponse
  }
  if (runtime.publicHandoff?.handles(req)) {
    const handoffResponse = await runtime.publicHandoff.handle(req)
    if (handoffResponse) return handoffResponse
  }
  const hostedSurface = pathname === '/admin'
    || pathname.startsWith('/admin/')
    || pathname === '/api/auth'
    || pathname.startsWith('/api/auth/')

  if (runtime.hostedStaffAuth && hostedSurface) {
    if (!runtime.hostedStaffAuth.handlesProductRequest(req)) {
      return jsonResponse({ error: 'Not found' }, { status: 404 })
    }
    if (
      HOSTED_MUTATING_METHODS.has(req.method.toUpperCase())
      && !isLegacyHostedAuthPath(pathname)
      && req.headers.get('origin') !== runtime.hostedStaffAuth.origin
    ) {
      return invalidateLegacyStaffCookie(
        req,
        jsonResponse({ error: 'Origin not allowed' }, { status: 403 }),
      )
    }
  }

  for (const route of routes) {
    const response = await route(req, runtime, url, pathname)
    if (response) {
      return runtime.hostedStaffAuth?.handlesProductRequest(req)
        ? invalidateLegacyStaffCookie(req, response)
        : response
    }
  }

  const notFound = jsonResponse({ error: 'Not found' }, { status: 404 })
  return runtime.hostedStaffAuth?.handlesProductRequest(req)
    ? invalidateLegacyStaffCookie(req, notFound)
    : notFound
}

// ---------------------------------------------------------------------------
// Route handlers
//
// Each function checks its own method/path and returns `Response | null`.
// Order matters — see `routes` above.
// ---------------------------------------------------------------------------

async function tryServeEntitlementAdmin(req: Request, runtime: ServerRuntime): Promise<Response | null> {
  if (!runtime.entitlementAdmin?.handles(req)) return null
  return await runtime.entitlementAdmin.handle(req)
}

async function tryServePlatformConsole(req: Request, runtime: ServerRuntime): Promise<Response | null> {
  if (!runtime.platformConsole?.handles(req)) return null
  return await runtime.platformConsole.handle(req)
}

async function tryServePublicMarketingAnalyticsAdmin(req: Request, runtime: ServerRuntime): Promise<Response | null> {
  if (!runtime.publicMarketingAnalyticsAdmin?.handles(req)) return null
  return await runtime.publicMarketingAnalyticsAdmin.handle(req)
}

async function tryServeAccessibleContextCatalog(req: Request, runtime: ServerRuntime): Promise<Response | null> {
  if (!runtime.accessibleContextCatalog?.handles(req)) return null
  return await runtime.accessibleContextCatalog.handle(req)
}

async function tryServeHostedSiteOnboarding(req: Request, runtime: ServerRuntime): Promise<Response | null> {
  if (!runtime.hostedSiteOnboarding?.handles(req)) return null
  return await runtime.hostedSiteOnboarding.handle(req)
}

async function tryServeWorkspaceManagement(req: Request, runtime: ServerRuntime): Promise<Response | null> {
  if (!runtime.workspaceManagement?.handles(req)) return null
  return await runtime.workspaceManagement.handle(req)
}

function tryServeHealth(_req: Request, _runtime: ServerRuntime, _url: URL, pathname: string): Response | null {
  if (pathname !== '/health') return null
  return jsonResponse({ status: 'ok', ts: Date.now() })
}

async function tryServeCentralStaffHandoff(req: Request, runtime: ServerRuntime): Promise<Response | null> {
  if (!runtime.centralStaffHandoff?.handles(req)) return null
  return await runtime.centralStaffHandoff.handle(req)
}

function tryServeHostedStaffAuth(
  req: Request,
  runtime: ServerRuntime,
  _url: URL,
  pathname: string,
): Promise<Response | null> | null {
  if (!runtime.hostedStaffAuth || !pathname.startsWith('/api/auth')) return null
  return runtime.hostedStaffAuth.handle(req)
}

function tryRejectHostedLegacyAuth(
  req: Request,
  runtime: ServerRuntime,
  _url: URL,
  pathname: string,
): Response | null {
  if (!runtime.hostedStaffAuth || !isLegacyHostedAuthPath(pathname)) return null
  return rejectLegacyHostedAuth(req)
}

/**
 * AI runtime — provider-agnostic stack at `/admin/api/ai/*`. Handles chat
 * streams, browser bridge, credentials CRUD, conversation history,
 * defaults, and model discovery. See `server/ai/handlers/index.ts` for the
 * full route table; the dispatcher there is the source of truth for
 * which paths are owned by this namespace.
 *
 * Endpoints live under `/admin/api/` so the admin session cookie — scoped
 * to `Path=/admin` to keep it off the public site — is carried to them.
 * Without that, the `requireCapability('ai.chat' / 'ai.tools.write' /
 * 'ai.providers.manage')` gate would 401 every request. Matched before
 * the broader `/admin/api/cms/` route so the AI paths don't get swallowed
 * by the CMS dispatcher.
 */
function tryServeAi(req: Request, runtime: ServerRuntime, url: URL, _pathname: string): Promise<Response> | null {
  return tryHandleAi(req, runtime.db, url)
}

/**
 * MCP server endpoint (`/_instatic/mcp`). Authenticates per-connector via a
 * bearer token (NOT the admin session cookie) and exposes the capability-gated
 * CMS tool surface over the Model Context Protocol. Returns `null` for any
 * other path so the dispatcher keeps walking.
 */
function tryServeMcp(req: Request, runtime: ServerRuntime, _url: URL, pathname: string): Promise<Response | null> | null {
  if (pathname !== MCP_ENDPOINT_PATH) return null
  return handleMcpHttp(req, runtime.db, {
    uploadsDir: runtime.uploadsDir,
    ...(runtime.mcpAuthority ? { authority: runtime.mcpAuthority } : {}),
  })
}

async function tryServePublicProjections(
  req: Request,
  runtime: ServerRuntime,
  _url: URL,
  pathname: string,
): Promise<Response | null> {
  if (pathname !== '/_fuma/private/public/v1' && !pathname.startsWith('/_fuma/private/public/v1/')) return null
  try {
    if (!runtime.publicProjections?.handles(req)) {
      return jsonResponse({ error: { code: 'not_found', message: 'Resource not found.' } }, {
        status: 404,
        headers: { 'cache-control': 'no-store' },
      })
    }
    return await runtime.publicProjections.handle(req)
      ?? jsonResponse({ error: { code: 'not_found', message: 'Resource not found.' } }, {
        status: 404,
        headers: { 'cache-control': 'no-store' },
      })
  } catch {
    return jsonResponse({ error: { code: 'temporarily_unavailable', message: 'Public data is temporarily unavailable.' } }, {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    })
  }
}

async function tryServePublicationPublic(req:Request,runtime:ServerRuntime,_url:URL,pathname:string):Promise<Response|null>{
  if(pathname!=='/_fuma/publication/unsubscribe'&&pathname!=='/_fuma/publication/oci-events')return null
  try{return runtime.publicationPublic?.handles(req)?await runtime.publicationPublic.handle(req):jsonResponse({accepted:true},{status:202,headers:{'cache-control':'no-store'}})}catch(error){console.error('[fuma-publication] public boundary failed:',error);return jsonResponse({accepted:true},{status:202,headers:{'cache-control':'no-store'}})}
}

async function tryServePaystackWebhooks(req:Request,runtime:ServerRuntime,_url:URL,pathname:string):Promise<Response|null>{
  if(!pathname.startsWith('/_fuma/paystack/webhooks/'))return null
  return runtime.paystackWebhooks?.handle(req)??jsonResponse({error:'Resource not found.'},{status:404,headers:{'cache-control':'no-store'}})
}

async function tryServeFumaScopedApi(
  req: Request,
  runtime: ServerRuntime,
  _url: URL,
  pathname: string,
): Promise<Response | null> {
  if (pathname !== '/api/fuma' && !pathname.startsWith('/api/fuma/')) return null

  try {
    if (!runtime.fumaScopedApi?.handles(req)) {
      return jsonResponse({ error: 'Resource not found.' }, { status: 404 })
    }
    return await runtime.fumaScopedApi.handle(req)
      ?? jsonResponse({ error: 'Resource not found.' }, { status: 404 })
  } catch (error) {
    console.error('[fuma-router] scoped API failed:', error)
    return jsonResponse({ error: 'Internal server error.' }, { status: 500 })
  }
}

function tryServeCmsApi(req: Request, runtime: ServerRuntime, _url: URL, pathname: string): Promise<Response> | null {
  if (!pathname.startsWith('/admin/api/cms/')) return null
  return handleCmsRequest(req, runtime.db, {
    uploadsDir: runtime.uploadsDir,
    databaseUrl: runtime.databaseUrl,
  })
}

/**
 * The loop runtime is a fixed CMS asset, served before the per-site
 * runtime asset lookup so the request never falls through.
 */
function tryServeLoopRuntimeAsset(req: Request, _runtime: ServerRuntime, _url: URL, pathname: string): Response | null {
  if (req.method !== 'GET' || !isLoopRuntimeAssetPath(pathname)) return null
  return serveLoopRuntimeAsset()
}

function tryServeLoop(req: Request, runtime: ServerRuntime, url: URL, pathname: string): Promise<Response> | null {
  if (!pathname.startsWith('/_instatic/loop/')) return null
  return handleLoopRequest(req, url, { db: runtime.db })
}

/**
 * The hole runtime is a fixed CMS asset served at `/_instatic/hole-runtime.js`.
 * Registered before `tryServeHole` so the exact path is consumed here and
 * never falls through to the hole fragment handler.
 */
function tryServeHoleRuntimeAsset(req: Request, _runtime: ServerRuntime, _url: URL, pathname: string): Response | null {
  if (req.method !== 'GET' || !isHoleRuntimeAssetPath(pathname)) return null
  return serveHoleRuntimeAsset()
}

/**
 * Layer C hole fragment endpoint — `/_instatic/hole/<nodeId>`.
 * Renders a dynamic node subtree on-demand and caches the result via Layer B.
 */
function tryServeHole(req: Request, runtime: ServerRuntime, url: URL, pathname: string): Promise<Response> | null {
  if (!pathname.startsWith('/_instatic/hole/')) return null
  return handleHoleRequest(req, url, { db: runtime.db })
}

/**
 * Per-module published JS — `/_instatic/module-js/<moduleId>.js`. Prefix-
 * namespaced: unknown paths under the prefix 404 inside the handler rather
 * than falling through to the public-slug resolver.
 */
function tryServeModuleJsAsset(req: Request, runtime: ServerRuntime, url: URL, pathname: string): Promise<Response> | null {
  if (!isModuleJsAssetPath(pathname)) return null
  return handleModuleJsAssetRequest(req, url, { db: runtime.db })
}

function tryServePublicForm(req: Request, runtime: ServerRuntime, url: URL, pathname: string): Promise<Response | null> | null {
  if (!pathname.startsWith('/_instatic/form/')) return null
  return handlePublicFormRequest(req, runtime.db, url)
}

async function tryServeRuntimeAsset(req: Request, runtime: ServerRuntime, _url: URL, pathname: string): Promise<Response | null> {
  if (req.method !== 'GET' || !pathname.startsWith('/_instatic/assets/')) return null

  // Disk-first: a full publish bakes the runtime JS into the active slot, so
  // published pages serve their scripts straight off disk (no DB round-trip,
  // no rebuild). Content-hashed filenames keep `immutable` caching correct.
  if (runtime.uploadsDir) {
    const bytes = await readStaticAsset(runtime.uploadsDir, pathname)
    if (bytes) {
      return binaryResponse(bytes, {
        headers: {
          'content-type': contentTypeForAssetPath(pathname),
          'cache-control': 'public, max-age=31536000, immutable',
        },
      })
    }
  }

  // Fallback: assets stored in the DB (preview, or a publish whose disk write
  // failed). The live renderer keeps working off these.
  const runtimeAsset = await getPublishedRuntimeAsset(runtime.db, pathname)
  if (!runtimeAsset) return null
  return binaryResponse(runtimeAsset.bytes, {
    headers: {
      'content-type': runtimeAsset.contentType,
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
}

/** Derive a response content-type for a baked static asset from its extension. */
function contentTypeForAssetPath(pathname: string): string {
  if (pathname.endsWith('.js') || pathname.endsWith('.mjs')) return 'text/javascript; charset=utf-8'
  if (pathname.endsWith('.css')) return 'text/css; charset=utf-8'
  if (pathname.endsWith('.map') || pathname.endsWith('.json')) return 'application/json; charset=utf-8'
  if (pathname.endsWith('.svg')) return 'image/svg+xml'
  if (pathname.endsWith('.png')) return 'image/png'
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg'
  if (pathname.endsWith('.gif')) return 'image/gif'
  if (pathname.endsWith('.webp')) return 'image/webp'
  if (pathname.endsWith('.woff2')) return 'font/woff2'
  if (pathname.endsWith('.woff')) return 'font/woff'
  if (pathname.endsWith('.ttf')) return 'font/ttf'
  if (pathname.endsWith('.otf')) return 'font/otf'
  return 'application/octet-stream'
}

/**
 * Per-site runtime dependency cache — served from the hashed
 * `bun install` workspace under `/_instatic/runtime/cache/<hash>/<...path>`.
 * The publisher emits a `<script type="importmap">` mapping bare
 * specifiers like `three` to URLs in this namespace, so plugin module
 * scripts and frontend bundles share a single locally-installed copy
 * of every site dependency.
 *
 * The /_instatic/runtime/cache/ namespace is exclusive: unknown paths under it
 * 404 here rather than falling through to a later matcher.
 */
async function tryServeRuntimePackageNamespace(req: Request, _runtime: ServerRuntime, _url: URL, pathname: string): Promise<Response | null> {
  if (!isRuntimePackagePath(pathname)) return null
  return (await tryServeRuntimePackage(req, pathname)) ?? new Response('not found', { status: 404 })
}

/**
 * Per-site CSS bundle — `reset-<hash>.css`, `framework-<hash>.css`,
 * `style-<hash>.css`. Filenames embed a content hash, so responses can
 * use `Cache-Control: immutable` for a year. Stale-hash requests 404 so
 * the browser falls back to refetching the HTML (which carries the new
 * hash).
 *
 * The /_instatic/css/ namespace is exclusive: any unknown path under it is a
 * 404, never falls through to the public-slug handler. That prevents an
 * unrelated path like `/_instatic/css/anything.css` from accidentally
 * rendering the homepage.
 */
async function tryServeSiteCssNamespace(req: Request, runtime: ServerRuntime, _url: URL, pathname: string): Promise<Response | null> {
  if (req.method !== 'GET' || !pathname.startsWith('/_instatic/css/')) return null
  return (await serveSiteCss(runtime.db, pathname, runtime.uploadsDir)) ?? new Response('Not found', { status: 404 })
}

/**
 * Resolve a media asset request that lives on a plugin-registered storage
 * adapter with `servingMode !== 'public-url'`.
 *
 * `dispatchUpload` synthesises a host-owned URL of the shape
 *   /_instatic/media/<adapterId>/<storagePath>
 * for non-public-url writes, then stores that on `media_assets.public_path`
 * (or inside each variant's `path`). Browsers hit this route; we ask the
 * adapter for a freshly-signed read URL and 302-redirect.
 *
 * The route is exclusive: an unknown adapter id or missing `getReadUrl`
 * returns 404 here rather than falling through to the public-slug handler.
 * That keeps a misconfigured storage backend from being silently swallowed
 * by the published-page renderer.
 *
 * Variants get the same treatment automatically — the variant URLs in
 * `variants_json` carry this same shape, so the renderer's `<img srcset>`
 * emission Just Works without per-variant DB indexing.
 */
async function tryServeMediaRedirect(
  req: Request,
  _runtime: ServerRuntime,
  _url: URL,
  pathname: string,
): Promise<Response | null> {
  if (!pathname.startsWith('/_instatic/media/')) return null
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 })
  }
  const match = pathname.match(/^\/_instatic\/media\/([^/]+)\/(.+)$/)
  if (!match) return new Response('Not found', { status: 404 })
  const adapterId = decodeURIComponent(match[1])
  const storagePath = decodeURIComponent(match[2])
  // Local-disk asset URLs never use this route (the dispatcher's
  // `buildSignedRedirectUrl` only fires for non-built-in adapters with
  // `servingMode !== 'public-url'`). A request that pretends to be one is
  // an attacker probe — 404 it.
  if (!adapterId) return new Response('Not found', { status: 404 })
  const adapter = mediaStorageRegistry.resolveForRead(adapterId)
  if (!adapter || !adapter.getReadUrl) {
    return new Response('Not found', { status: 404 })
  }
  let signed: { url: string; expiresAt: number }
  try {
    // 1 hour TTL — long enough that browser-side fetches and CDN warm-ups
    // succeed, short enough that a leaked signed URL becomes useless fast.
    signed = await adapter.getReadUrl(storagePath, 3600)
  } catch (err) {
    console.error(`[router] adapter "${adapterId}" getReadUrl failed:`, err)
    return new Response('Not found', { status: 404 })
  }
  // No cache header on the 302 itself — the redirect target is signed and
  // expires; we want every browser navigation to hit us for a fresh signature
  // rather than reuse a stale one.
  return new Response(null, {
    status: 302,
    headers: {
      'location': signed.url,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  })
}

/**
 * Serve any file that the Vite build emits under `staticDir` (`dist/`):
 *
 *   - `/assets/<hashed>.{js,css,…}` — the bundler-emitted chunks.
 *   - `/favicon.svg`               — the site favicon copied from `public/`.
 *   - `/runtime/<shim>.js`         — plugin-runtime ESM shims that the
 *                                    admin's import map re-exports
 *                                    `react`, `react-dom`, `@instatic/*`
 *                                    from. Without these, plugin bundles
 *                                    fail to fetch on a production install
 *                                    (the dev server hides this because
 *                                    Vite serves `public/` at the root).
 *
 * The handler is generic — `serveStaticFile` returns `null` when the
 * resolved file doesn't exist, so non-static paths fall through to the
 * downstream route handlers naturally. `/` and `/index.html` are
 * deliberately skipped so `serveAdminApp` keeps ownership of the admin
 * HTML pipeline (login skeleton + boot-API kickoff + authenticated preload).
 */
async function tryServeStaticAsset(
  _req: Request,
  runtime: ServerRuntime,
  _url: URL,
  pathname: string,
): Promise<Response | null> {
  if (!runtime.staticDir) return null
  if (pathname === '/' || pathname === '/index.html') return null
  return await serveStaticFile(runtime.staticDir, pathname, _req)
}

async function tryServeUpload(
  req: Request,
  runtime: ServerRuntime,
  _url: URL,
  pathname: string,
): Promise<Response | null> {
  if (!runtime.uploadsDir || !pathname.startsWith('/uploads/')) return null
  const upload = await serveStaticFile(runtime.uploadsDir, pathname.slice('/uploads'.length), req)
  if (!upload) return null
  // Defense-in-depth: even though the upload handler now writes only
  // server-chosen extensions, the static handler still derives Content-Type
  // from the on-disk extension. `hardenUploadResponse` adds the `nosniff`
  // and (for non-inert MIMEs) `attachment` headers so a stray non-allowlisted
  // file in the uploads dir can never be top-level navigated and rendered as
  // HTML on the admin origin. See `INERT_UPLOAD_MIMES` in `static.ts`.
  const hardened = hardenUploadResponse(upload)
  // Plugin bundles live under `/uploads/plugins/<id>/<version>/...`. The
  // editor's preview iframe loads them with `sandbox="allow-scripts"` (no
  // `allow-same-origin`), which puts the iframe in an opaque origin —
  // module fetches across that boundary need CORS. Plugin assets are
  // distribution code (frontend bundles, plugin-shipped images), so
  // allow-all is correct here. Non-plugin uploads stay default-deny.
  if (pathname.startsWith('/uploads/plugins/')) {
    const headers = new Headers(hardened.headers)
    headers.set('access-control-allow-origin', '*')
    headers.set('cross-origin-resource-policy', 'cross-origin')
    return new Response(hardened.body, {
      status: hardened.status,
      statusText: hardened.statusText,
      headers,
    })
  }
  return hardened
}

async function tryServeAdminApp(
  req: Request,
  runtime: ServerRuntime,
  _url: URL,
  pathname: string,
): Promise<Response | null> {
  const isAdminPath = pathname === '/admin' || pathname.startsWith('/admin/')
  if (!isAdminPath) return null

  if (runtime.staticDir) {
    const adminApp = await serveAdminApp(runtime.staticDir, req, runtime.hostedStaffAuth
      ? { hostedCookieName: runtime.hostedStaffAuth.cookieName }
      : undefined)
    if (adminApp) return adminApp
  }
  // Admin SPA isn't served from this port (dev mode, or production missing a
  // build). Tell the developer where to actually find it.
  return adminUiNotBuiltResponse(pathname)
}

/**
 * Single entry for visitor-facing pages, content rows, and row-slug redirects.
 * Resolution + render live in `server/publish/publicRouter.ts`.
 * `renderPublicResolution` handles the full request: Layer A disk
 * fast-path (pre-rendered static artefacts via `readArtefact`), then
 * `resolvePublicRoute`, then the live renderer + `applyPublishedHtmlPipeline`.
 */
async function tryServePublicRoute(req: Request, runtime: ServerRuntime, url: URL, _pathname: string): Promise<Response | null> {
  if (runtime.freeHostPublic || req.method !== 'GET') return null
  return await renderPublicResolution(runtime.db, url, runtime.uploadsDir)
}

/**
 * On a fresh install with no admin user yet, bounce the visitor to /admin so
 * they land in the setup wizard instead of seeing a confusing 404. Returns
 * null when the install is already past setup.
 */
async function trySetupRedirect(req: Request, runtime: ServerRuntime, _url: URL, _pathname: string): Promise<Response | null> {
  if (runtime.freeHostPublic || req.method !== 'GET') return null
  // Sticky memo: once setup completes, this stops querying. Without it every
  // unmatched GET (bot probes, 404s) paid two COUNT queries forever.
  const setupStatus = await getSetupStatusCached(runtime.db, SELF_HOST_SITE_ID)
  return setupStatus.needsSetup
    ? new Response(null, { status: 302, headers: { location: '/admin' } })
    : null
}

/**
 * Last route before the dispatcher's bare JSON 404: serve the site's designed
 * 404 page (the `notFound` template) for any GET no other route claimed.
 * Namespaced prefixes (`/admin/api/*`, `/_instatic/*`, `/uploads/*`) never
 * reach here — they absorb their namespace and emit their own 404s. Returns
 * null (→ JSON 404) when the published site has no notFound template.
 */
async function tryServeNotFoundPage(req: Request, runtime: ServerRuntime, url: URL, _pathname: string): Promise<Response | null> {
  if (runtime.freeHostPublic || req.method !== 'GET') return null
  return await renderNotFoundResponse(runtime.db, url, runtime.uploadsDir)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function adminUiNotBuiltResponse(pathname: string): Response {
  const targetUrl = `${VITE_DEV_URL}${pathname}`
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Admin UI not served on this port</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 32px; background: #000; color: #ededed; line-height: 1.5; }
  a { color: #fff; }
  code { background: #111; padding: 2px 6px; border-radius: 3px; }
</style>
</head>
<body>
<h1>Admin UI not served on this port</h1>
<p>This is the CMS API server (port 3001). In development, the admin UI is served by the Vite dev server.</p>
<p>Open <a href="${targetUrl}">${targetUrl}</a>.</p>
<p>If Vite isn't running yet, start it with <code>bun run dev</code> from the project root.</p>
</body>
</html>`
  return new Response(html, {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

/**
 * Serve one of the three site CSS bundle files (reset / framework / style).
 *
 * The URL path is `/_instatic/css/<bundle>-<hash>.css` where `<bundle>` is the
 * logical layer name and `<hash>` is the 12-hex SHA-256 prefix that
 * `buildSiteCssBundle` produces.
 *
 * Disk-first: a full publish bakes every referenced CSS file into the active
 * slot, so this handler reads it straight off disk — no DB, no rebuild. The
 * DB rebuild below is a fallback for preview (pre-publish) or a publish whose
 * disk write failed.
 *
 *  - Browsers / CDNs cache the response for a year (`immutable`).
 *  - When a hash changes (the site, its classes, or a stylesheet was edited),
 *    HTML pages re-render with the new `<link href>` and visitors fetch the
 *    new file exactly once.
 *
 * Stale hash → 404 so the browser falls back to refetching the HTML, which
 * carries the current hash. Returning the new content under the old name
 * would defeat `immutable` caching by serving different bytes for the same
 * URL across the cache lifetime.
 *
 * `reset`/`framework`/`style` are page-invariant; `userStyles` is page-scoped
 * (each stylesheet targets a subset of pages), so the fallback walks the
 * published pages until one produces the requested hash.
 *
 * The DB fallback is memoised by `(bundle, hash)` — the hash is content-derived
 * so an entry can never go stale; it can only stop being requested. Negative
 * results are cached too (a crafted stale-hash URL would otherwise force the
 * full rebuild walk per request). The memo resets when the publish version
 * moves and concurrent first-hits share one in-flight rebuild.
 */
const cssFallbackCache = new Map<string, string | null>()
const CSS_FALLBACK_CACHE_MAX = 256
const cssFallbackInFlight = new Map<string, Promise<string | null>>()
let cssFallbackVersion = -1
registerVersionedCacheReset(() => {
  cssFallbackCache.clear()
  cssFallbackInFlight.clear()
  cssFallbackVersion = -1
})

async function serveSiteCss(db: DbClient, pathname: string, uploadsDir?: string): Promise<Response | null> {
  const filename = pathname.slice('/_instatic/css/'.length)
  const match = filename.match(/^(reset|framework|style|userStyles)-([a-f0-9]{12})\.css$/)
  if (!match) return null

  const [, requestedBundle, requestedHash] = match
  const bundleId = requestedBundle as SiteCssBundleId

  // Disk-first.
  if (uploadsDir) {
    const bytes = await readStaticAsset(uploadsDir, pathname)
    if (bytes) {
      return cssResponse(toArrayBuffer(bytes), requestedHash)
    }
  }

  // Memoised DB fallback.
  const version = getPublishVersion()
  if (version !== cssFallbackVersion) {
    cssFallbackCache.clear()
    cssFallbackVersion = version
  }
  const cacheKey = `${bundleId}:${requestedHash}`
  const cached = cssFallbackCache.get(cacheKey)
  if (cached !== undefined) {
    return cached === null ? new Response('Not found', { status: 404 }) : cssResponse(cached, requestedHash)
  }

  const inflight = cssFallbackInFlight.get(cacheKey)
  const promise = inflight ?? (async (): Promise<string | null> => {
    try {
      const content = await rebuildSiteCssFromSnapshot(db, bundleId, requestedHash, version)
      if (cssFallbackCache.size >= CSS_FALLBACK_CACHE_MAX) cssFallbackCache.clear()
      cssFallbackCache.set(cacheKey, content)
      return content
    } finally {
      cssFallbackInFlight.delete(cacheKey)
    }
  })()
  if (!inflight) cssFallbackInFlight.set(cacheKey, promise)

  const content = await promise
  return content === null ? new Response('Not found', { status: 404 }) : cssResponse(content, requestedHash)
}
/**
 * Rebuild the requested CSS bundle file from the latest published snapshot.
 * Returns the file body, or `null` when no page (nor the page-agnostic view)
 * produces the requested hash. The page-invariant trio comes from the
 * version-keyed memo, so only `userStyles` does per-page work here.
 */
async function rebuildSiteCssFromSnapshot(
  db: DbClient,
  bundleId: SiteCssBundleId,
  requestedHash: string,
  version: number,
): Promise<string | null> {
  const snapshot = await getLatestSnapshotForVersion(db, version)
  if (!snapshot) return null

  const pages = bundleId === 'userStyles' ? snapshot.site.pages : snapshot.site.pages.slice(0, 1)
  for (const page of pages) {
    const mediaAssets = await prefetchMediaAssets(page, snapshot.site, registry, db)
    const file: CssBundleFile = buildPublishedSiteCssBundle(snapshot.site, registry, page, version, { mediaAssets })[bundleId]
    if (file.hash === requestedHash) return file.content
  }
  // Page-agnostic view (every enabled stylesheet) — covers a hash that
  // predates a scope change but is still referenced somewhere.
  const fallbackMediaAssets = snapshot.site.pages[0]
    ? await prefetchMediaAssets(snapshot.site.pages[0], snapshot.site, registry, db)
    : undefined
  const fallback: CssBundleFile = buildPublishedSiteCssBundle(
    snapshot.site,
    registry,
    undefined,
    version,
    { mediaAssets: fallbackMediaAssets },
  )[bundleId]
  if (fallback.hash === requestedHash) return fallback.content

  return null
}

function cssResponse(body: BodyInit, hash: string): Response {
  return new Response(body, {
    headers: {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
      etag: `"${hash}"`,
    },
  })
}

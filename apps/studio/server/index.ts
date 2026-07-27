import { createDbClient } from './db'
import { runMigrations } from './db/runMigrations'
import { runHostedMigrations } from './fuma/db/hostedMigrationRunner'
import { assertFumaHostedDatabaseUrl, assertFumaHostedStartup } from './fuma/startupGuard'
import { syncSystemRoles } from './repositories/roles'
import { readServerConfig } from './config'
import { DEV_ORIGIN_ALLOWLIST, configurePublicOrigins, configureTrustedProxyCidrs, stampSocketIp } from './auth/security'
import { applySecurityHeaders } from './securityHeaders'
import { startConversationPurgeTick } from './ai/boot'
import { readFumaConfig } from './fuma/config'
import { createHostedAuthFakeInbox } from './auth/hosted/fakeInbox'
import {
  createHostedFumaScopedApi,
  createHostedStaffAuthRuntime,
  readHostedAuthSecret,
} from './auth/hosted/runtime'
import { createHostedPublicProjectionRuntime } from './fuma/publicProjections'
import { createHostedFreeHostRuntime, createHostedReleaseObjectStorage, type FreeHostResolution } from './fuma/freeHosts'
import {
  AnonymousEdgeVisitorAuthority,
  createHostedEdgeRuntime,
  PublicationAccessEdgeHoleResolver,
  type EdgeVisitorAuthority,
} from './fuma/edgeDelivery'
import {
  createTemplatePreviewBoundary,
  PostgresPublicTemplateCatalogRepository,
  PostgresTemplatePreviewReader,
  PostgresTemplateReleaseAuthority,
  PublicTemplateCatalogService,
  TEMPLATE_PREVIEW_HOST,
} from './fuma/publicTemplates'
import { createHostedPaystackRuntime } from './fuma/paystack/runtime'
import {
  createHostedMemberIdentityRuntime,
  createMemberImportBoundary,
  MEMBER_SESSION_COOKIE,
  PostgresMemberSiteAuthority,
  readMemberAuthSecret,
} from './fuma/memberIdentity'
import { FUMA_STAFF_FRESH_SESSION_SECONDS } from './auth/hosted/auth'
import {
  createHostedPublicationRuntime,
  type DynamicPublicationAudienceAuthority,
  PublicationCollaborationSocketHub,
  PublicationPresenceSocketHub,
  PublicationPrivacyAnalyticsPublicBoundary,
  type PublicationRepositoryScope,
  PublicationSocketHub,
  type PublicationSocketData,
} from './fuma/publication'

function requiredFumaObjectSigningSecret(): string {
  const value = process.env.FUMA_OBJECT_ACCESS_SIGNING_SECRET
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') < 32) {
    throw new TypeError('FUMA_OBJECT_ACCESS_SIGNING_SECRET must contain at least 32 bytes.')
  }
  return value
}

function memberSessionToken(request: Request): string | null {
  for (const item of (request.headers.get('cookie') ?? '').split(';')) {
    const separator = item.indexOf('=')
    if (separator < 0 || item.slice(0, separator).trim() !== MEMBER_SESSION_COOKIE) continue
    try { return decodeURIComponent(item.slice(separator + 1).trim()) } catch { return null }
  }
  return null
}

await import('./richtextSanitizer')
const { handleServerRequest } = await import('./router')
const { activateInstalledServerPlugins } = await import('./plugins/runtime')
const { mediaStorageRegistry } = await import('@core/plugins/mediaStorageRegistry')

const config = readServerConfig()
const fumaHosted = process.env.FUMA_HOSTED === 'true'
if (fumaHosted) assertFumaHostedDatabaseUrl(config.databaseUrl)
configureTrustedProxyCidrs(config.trustedProxyCidrs)
configurePublicOrigins(config.publicOrigins)
const { db, migrations } = createDbClient(config.databaseUrl)
await runMigrations(db, migrations)
if (fumaHosted) {
  await runHostedMigrations(db)
  await assertFumaHostedStartup({
    db,
    databaseUrl: config.databaseUrl,
    legacySqliteConfigured: Boolean(process.env.FUMA_LEGACY_SQLITE_PATH?.trim()),
  })
}
const hostedFumaConfig = fumaHosted ? readFumaConfig() : undefined
const hostedStaffSecret = hostedFumaConfig ? readHostedAuthSecret() : undefined
const hostedStaffAuthRuntime = hostedFumaConfig
  ? (() => {
    const fumaConfig = hostedFumaConfig
    const inbox = createHostedAuthFakeInbox()
    return createHostedStaffAuthRuntime({
      databaseUrl: fumaConfig.database.url,
      productHost: fumaConfig.hosts.product,
      protectedOwnerEmail: fumaConfig.protectedOwner.email,
      secureCookies: fumaConfig.staffCookie.secure,
      cookieName: fumaConfig.staffCookie.name,
      secret: hostedStaffSecret!,
      delivery: inbox,
    })
  })()
  : undefined
const hostedStaffAuth = hostedStaffAuthRuntime?.boundary
const memberIdentityRuntime = hostedFumaConfig && hostedStaffSecret
  ? createHostedMemberIdentityRuntime({ db, secret: readMemberAuthSecret(hostedStaffSecret) })
  : undefined
const publicProjectionRuntime = fumaHosted
  ? await createHostedPublicProjectionRuntime({ db })
  : undefined
const publicationRuntime = hostedFumaConfig
  ? await createHostedPublicationRuntime({ db, config: hostedFumaConfig, objectAccessSigningSecret: requiredFumaObjectSigningSecret() })
  : undefined
const publicSiteAuthority = hostedFumaConfig ? new PostgresMemberSiteAuthority(db) : undefined
const publicHostAuthority = publicSiteAuthority
  ? Object.freeze({
    async scopeForHost(host: string) {
      return (await publicSiteAuthority.resolve(new Request(`https://${host}/`)))?.scope ?? null
    },
  })
  : undefined
const dynamicPublicationPublic = publicationRuntime && publicHostAuthority
  ? publicationRuntime.graph.dynamicPublication.createPublicBoundary({
    hosts: publicHostAuthority,
    audience: Object.freeze({
      async audienceForRequest(request: Request, scope: PublicationRepositoryScope) {
        const session = memberIdentityRuntime
          ? await memberIdentityRuntime.service.resolve(scope, memberSessionToken(request))
          : Object.freeze({ authenticated: false as const, principal: null, expiresAt: null })
        if (!session.authenticated || session.principal === null) {
          return Object.freeze({ member: false, paid: false, memberId: null, segmentIds: [] })
        }
        const audience = await publicationRuntime.graph.memberAccess.audienceForIdentity(scope, session.principal.memberIdentityId)
        return Object.freeze({ member: audience.member, paid: audience.paid, memberId: audience.memberId, segmentIds: [...audience.segmentIds] })
      },
    }) satisfies DynamicPublicationAudienceAuthority,
  })
  : undefined
const publicationAnalyticsPublic = publicationRuntime && publicHostAuthority
  ? new PublicationPrivacyAnalyticsPublicBoundary({
    adapter: publicationRuntime.graph.privacyAnalytics.publicAdapter,
    hosts: publicHostAuthority,
  })
  : undefined
const releaseObjectStorage = hostedFumaConfig
  ? createHostedReleaseObjectStorage({
    config: hostedFumaConfig,
    objectAccessSigningSecret: requiredFumaObjectSigningSecret(),
  })
  : undefined
const templateCatalog = hostedFumaConfig
  ? new PublicTemplateCatalogService(
    new PostgresPublicTemplateCatalogRepository(db),
    new PostgresTemplateReleaseAuthority(db),
  )
  : undefined
const templatePreviewBoundary = templateCatalog && releaseObjectStorage
  ? createTemplatePreviewBoundary({
    host: TEMPLATE_PREVIEW_HOST,
    catalog: templateCatalog,
    reader: new PostgresTemplatePreviewReader(db, releaseObjectStorage),
  })
  : undefined
const edgeVisitorAuthority: EdgeVisitorAuthority = memberIdentityRuntime && publicationRuntime
  ? Object.freeze({
    async resolve(request: Request, resolution: Extract<FreeHostResolution, { kind: 'release' }>) {
      const scope: PublicationRepositoryScope = Object.freeze({
        platformId: resolution.host.platformId,
        organizationId: resolution.host.organizationId,
        workspaceId: resolution.host.workspaceId,
        siteId: resolution.host.siteId,
        ownerKey: resolution.host.ownerKey,
        generation: resolution.host.ownerGeneration,
        state: 'active',
        transferFence: null,
        profileId: 'website',
      })
      const session = await memberIdentityRuntime.service.resolve(scope, memberSessionToken(request))
      if (!session.authenticated || session.principal === null) {
        return Object.freeze({ memberId: null, claims: Object.freeze({ audience: 'anonymous' }) })
      }
      const audience = await publicationRuntime.graph.memberAccess.audienceForIdentity(scope, session.principal.memberIdentityId)
      return Object.freeze({
        memberId: audience.memberId ?? session.principal.memberIdentityId,
        claims: Object.freeze({
          audience: audience.paid ? 'paid' : audience.member ? 'member' : 'anonymous',
          memberIdentityId: session.principal.memberIdentityId,
          segmentIds: [...audience.segmentIds].toSorted().join(','),
        }),
      })
    },
  })
  : new AnonymousEdgeVisitorAuthority()
const edgeRuntime = hostedFumaConfig && releaseObjectStorage
  ? createHostedEdgeRuntime({
    db,
    objectStorage: releaseObjectStorage,
    redisUrl: hostedFumaConfig.redis.url,
    redisNamespace: `edge-${hostedFumaConfig.hosts.product.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 48)}`,
    visitors: edgeVisitorAuthority,
    holes: publicationRuntime ? [new PublicationAccessEdgeHoleResolver(publicationRuntime.graph.scheduling)] : [],
  })
  : undefined
if (edgeRuntime) await edgeRuntime.cache.connect()
const freeHostRuntime = hostedFumaConfig
  ? createHostedFreeHostRuntime({
    db,
    config: hostedFumaConfig,
    objectAccessSigningSecret: requiredFumaObjectSigningSecret(),
    ...(releaseObjectStorage ? { storage: releaseObjectStorage } : {}),
    ...(edgeRuntime ? { edge: edgeRuntime.boundary } : {}),
    extensions: [dynamicPublicationPublic, publicationAnalyticsPublic].filter((value) => value !== undefined),
  })
  : undefined
const paystackRuntime = hostedFumaConfig
  ? createHostedPaystackRuntime({ db, config: hostedFumaConfig })
  : undefined
const fumaScopedApi = createHostedFumaScopedApi({
  db,
  hostedStaffAuth: hostedStaffAuthRuntime,
  ...(publicationRuntime ? { publicationRoutes: publicationRuntime.graph.scopedRoutes } : {}),
})
const memberImportBoundary = memberIdentityRuntime && hostedStaffAuthRuntime && fumaScopedApi
  ? createMemberImportBoundary({
    repository: memberIdentityRuntime.repository,
    scopedAuthority: fumaScopedApi,
    resolveStaffSession: hostedStaffAuthRuntime.resolveSession,
    freshSessionMs: FUMA_STAFF_FRESH_SESSION_SECONDS * 1_000,
  })
  : undefined
const publicationSockets = publicationRuntime && fumaScopedApi
  ? new PublicationSocketHub({
    presence: new PublicationPresenceSocketHub({ presence: publicationRuntime.graph.presence, authority: fumaScopedApi }),
    collaboration: new PublicationCollaborationSocketHub({ collaboration: publicationRuntime.graph.collaboration, authority: fumaScopedApi }),
  })
  : undefined
// System role sync runs after migrations on every boot — the Owner row's
// capabilities are force-reset to `CORE_CAPABILITIES` so existing
// installations don't strand owners on a stale grant list when new
// capabilities are added in code. See `syncSystemRoles` for the policy.
await syncSystemRoles(db)
// Wire the built-in local-disk media adapter BEFORE plugins activate —
// plugin adapters register through the same registry but local-disk is
// always the fallback for unset roles. See `mediaStorageRegistry.ts`.
mediaStorageRegistry.configureLocalDisk({ uploadsDir: config.uploadsDir })
await activateInstalledServerPlugins(db, config.uploadsDir)
// AI runtime: start the nightly conversation-purge tick. Operators add
// their own provider credentials via /admin/ai/providers on first install.
startConversationPurgeTick(db)

/**
 * Build the CORS response headers for an incoming request.
 *
 * Returns headers ONLY when the request's `Origin` is on the dev allowlist
 * (the production admin shell is same-origin behind Caddy, so no ACAO is
 * needed). Anything else gets an empty header set — the browser then blocks
 * cross-origin reads naturally instead of us "allow"-ing a wrong value.
 *
 * Echoing an unrelated allowlist entry with `Access-Control-Allow-Credentials: true`
 * (the previous behaviour) was harmless in practice — browsers reject the
 * response when ACAO doesn't match the requesting Origin — but it was the
 * same shape as classic broken-CORS bugs and made misconfigured
 * `VITE_ALLOWED_ORIGIN` values silently open the API up.
 */
function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !DEV_ORIGIN_ALLOWLIST.includes(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    // The response body varies by Origin (we either include ACAO or don't),
    // so caches must key on Origin to avoid serving a permissive response to
    // a non-allowlisted origin.
    'Vary': 'Origin',
  }
}

const server = Bun.serve<PublicationSocketData>({
  hostname: config.hostname,
  port: config.port,
  websocket: publicationSockets?.handler ?? {
    maxPayloadLength: 1,
    message(socket) { socket.close(1008, 'Unavailable') },
  },

  // Disable Bun's default 10-second idle timeout. The agent endpoint streams
  // NDJSON for as long as Claude's loop is running — Claude's "thinking"
  // gaps between tool calls regularly exceed 10s on multi-step builds, and
  // hitting the default would kill the streaming response mid-flight, leave
  // the bridge resolver hanging server-side, and stall the agent. Other
  // routes finish as normal HTTP request/response cycles, so removing the
  // idle timeout has no downside for them.
  idleTimeout: 0,

  async fetch(req: Request, server: Bun.Server<unknown>) {
    const origin = req.headers.get('origin')
    const cors = corsHeaders(origin)
    const pathname = new URL(req.url).pathname

    // Stamp the socket peer address onto the request so downstream
    // `clientIp(req)` returns a real value when no `X-Forwarded-For` is
    // present (dev, self-hosted without a proxy). Strips any inbound spoof.
    stampSocketIp(req, server.requestIP(req)?.address ?? null)

    // Template previews are exact approved immutable releases on a dedicated
    // credential-free host; unknown paths continue into fail-closed Host routing.
    if (templatePreviewBoundary?.handles(req)) {
      const previewResponse = await templatePreviewBoundary.handle(req)
      if (previewResponse) return applySecurityHeaders(previewResponse, pathname)
    }

    // Hosted public authority is the process's first request boundary. This
    // prevents WebSocket and CORS shortcuts from creating unknown-host paths.
    // A null response is possible only for the configured control Host.
    if (freeHostRuntime && pathname !== '/health') {
      const publicHostResponse = await freeHostRuntime.boundary.route(req)
      if (publicHostResponse) return applySecurityHeaders(publicHostResponse, pathname)
    }

    if (publicationSockets?.handles(req)) {
      const upgraded = await publicationSockets.upgrade(req, server)
      if (upgraded === undefined) return
      if (upgraded !== null) return applySecurityHeaders(upgraded, pathname)
    }

    // Handle CORS preflight on the control Host after public Host authority.
    if (req.method === 'OPTIONS') {
      return applySecurityHeaders(
        new Response(null, { status: 204, headers: cors }),
        pathname,
      )
    }

    try {
      const res = await handleServerRequest(req, {
        db,
        staticDir: config.staticDir,
        uploadsDir: config.uploadsDir,
        databaseUrl: config.databaseUrl,
        hostedStaffAuth,
        publicProjections: publicProjectionRuntime?.boundary,
        publicationPublic: publicationRuntime?.publicBoundary,
        freeHostPublic: freeHostRuntime?.boundary,
        memberAuth: memberIdentityRuntime?.boundary,
        memberImports: memberImportBoundary,
        paystackWebhooks: paystackRuntime?.webhooks,
        fumaScopedApi,
      })
      for (const [k, v] of Object.entries(cors)) {
        res.headers.set(k, v)
      }
      return applySecurityHeaders(res, pathname)
    } catch (err) {
      // Never echo `err.message` to the client — inner handlers already return
      // structured error bodies for the failure modes they expect; anything
      // that escapes to here is an unexpected crash whose message can leak
      // SQL fragments, absolute paths, spawn() arguments, etc. Log fully,
      // respond generically.
      console.error('[server] Unhandled request error:', err)
      return applySecurityHeaders(
        new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...cors },
        }),
        pathname,
      )
    }
  },

  error(err: Error) {
    console.error('[server] Unhandled error:', err)
    return new Response('Internal Server Error', { status: 500 })
  },
})

let shutdownStarted = false
async function shutdown(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  if (shutdownStarted) return
  shutdownStarted = true
  process.off('SIGINT', onSigint)
  process.off('SIGTERM', onSigterm)
  try {
    await server.stop(true)
    await Promise.all([
      publicationSockets?.close(),
      hostedStaffAuthRuntime?.close(),
      publicProjectionRuntime?.close(),
      publicationRuntime?.close(),
      edgeRuntime?.cache.close(),
    ])
    process.exit(0)
  } catch (error) {
    console.error(`[server] ${signal} shutdown failed:`, error)
    process.exit(1)
  }
}
const onSigint = (): void => { void shutdown('SIGINT') }
const onSigterm = (): void => { void shutdown('SIGTERM') }
process.once('SIGINT', onSigint)
process.once('SIGTERM', onSigterm)

console.log(`[server] Listening on http://${config.hostname}:${config.port}`)

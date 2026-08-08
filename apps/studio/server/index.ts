import { createDbClient } from './db'
import { runMigrations } from './db/runMigrations'
import { reportMasterKeyAtBoot } from './secrets/masterKey'
import { runHostedMigrations } from './fuma/db/hostedMigrationRunner'
import { assertFumaHostedDatabaseUrl, assertFumaHostedStartup } from './fuma/startupGuard'
import { syncSystemRoles } from './repositories/roles'
import { readServerConfig } from './config'
import { DEV_ORIGIN_ALLOWLIST, configurePublicOrigins, configureTrustedProxyCidrs, stampSocketIp } from './auth/security'
import { applySecurityHeaders } from './securityHeaders'
import { startConversationPurgeTick } from './ai/boot'
import { readFumaConfig } from './fuma/config'
import { createHostedAuthFakeInbox } from './auth/hosted/fakeInbox'
import { createHostedAuthOciDelivery, createHostedAuthUnavailableDelivery } from './auth/hosted/ociDelivery'
import { createCentralStaffHandoffBoundary } from './auth/hosted/centralStaffHandoff'
import {
  createHostedFumaScopedApi,
  createHostedIdentityAuthRuntime,
  createHostedStaffAuthRuntime,
  readHostedAuthSecret,
} from './auth/hosted/runtime'
import {
  createHostedPublicProjectionAuthorityCatalog,
  createHostedPublicProjectionRuntime,
} from './fuma/publicProjections'
import { readPrivateProjectionConfig } from './fuma/publicProjections/config'
import { createHostedPublicMarketingAnalyticsRuntime, resolvePublicMarketingAnalyticsSchemaSentinel } from './fuma/publicAnalytics/runtime'
import { createPublicMarketingAnalyticsAdminBoundary } from './fuma/publicAnalytics/adminBoundary'
import {
  AUTH_HANDOFF_SESSION_COOKIE,
  createHostedPublicHandoffRuntime,
} from './fuma/publicHandoff'
import { createHostedSiteRuntimeAuthority, emptyApplicationSnapshot, type SiteRuntimeMemberProjectionPort } from './fuma/siteRuntime'
import { createHostedFreeHostRuntime, createHostedReleaseObjectStorage, type FreeHostResolution } from './fuma/freeHosts'
import { OrganizationBootstrapService, PostgresOrganizationBootstrapRepository, PostgresCustomerOrganizationLifecycle } from './fuma/organizations'
import { createHostedSiteOnboardingBoundary, HostedSiteOnboardingService } from './fuma/onboarding'
import { createWorkspaceManagementBoundary } from './fuma/workspaces/managementBoundary'
import { createAccessibleContextCatalogBoundary, PostgresAccessibleContextCatalog } from './fuma/context/accessibleCatalog'
import { createBuilderSessionBoundary, PostgresBuilderIdentityStore } from './fuma/builder/builderIdentity'
import { setHostedBuilderIdentityResolver } from './auth/authz'
import { setHostedSiteDocumentResolver } from './selfHost'
import { setHostedStorageAllowanceResolver } from './fuma/entitlements/storageAllowanceBridge'
import { assumedFundedStorageBytes } from './fuma/entitlements/subscription'
import { createSiteDocumentResolver } from './fuma/editor/siteDocumentResolver'
import { mintStaffSession, staffSessionCookie } from './auth/hosted/staffSessionMint'
import { PostgresFumaSiteAuthorizationAuthority } from './fuma/context/postgresRequestAuthority'
import { resolveLayeredPermissions } from './fuma/permissions/resolver'
import { permissionInput, readAuthorization } from './fuma/context/requestContext'
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
  createHostedEntitlementAdminRuntime,
  createHostedEntitlementRuntime,
  readEntitlementControlRuntimeSecret,
  readHostedKesCostConversion,
} from './fuma/entitlements'
import { createHostedPlatformCheckoutRuntime } from './fuma/checkout'
import { createHostedPlatformBillingRuntime } from './fuma/billing'
import { createHostedMcpProductionRuntime, readHostedAiByokMetadataKey } from './fuma/mcp/productionRuntime'
import { createHostedArtifactRuntime } from './fuma/artifacts'
import { createArtifactMarketplaceScopedRoutes, createHostedArtifactReviewRuntime } from './fuma/artifactReviews'
import { createQuotaRuntime } from './fuma/quotas'
import { createHostedComponentCatalogRuntime } from './fuma/componentCatalog'
import { createHostedCapabilityDashboardRuntime } from './fuma/aiCapabilityDashboard'
import { createHostedBookingRuntime } from './fuma/bookings'
import { createPlatformConsoleBoundary } from './fuma/platformConsole/boundary'
import { AuditService, PostgresAuditRepository } from './fuma/audit'
import { createHostedMeteringRuntime } from './fuma/metering'
import { createHostedDomainRuntime, readHostedDomainCredentialKeyring, type HostedDomainCredentialKeyring } from './fuma/domains/runtime'
import { createHostedCloudflareRuntime } from './fuma/cloudflare/runtime'
import { createHostedRegistrarRuntime } from './fuma/registrar/runtime'
import { FetchRegistrarGatewayHttpClient, RegistrarGatewayAdapter } from './fuma/registrar/productionGateway'
import { BetterAuthRegistrarStepUp } from './fuma/registrar/productionStepUp'
import { readHostedRegistrarConfig } from './fuma/registrar/config'
import { platformCredentialAuthority } from './fuma/domains/contracts'
import { createHostedDomainOperationsRuntime } from './fuma/domainOperations/runtime'
import { AesGcmRegistrarAuthCodeVault } from './fuma/domainOperations/authCodeVault'
import { PostgresDomainOperationsRepository } from './fuma/domainOperations/postgres'
import { RegistrarTransferGatewayAdapter } from './fuma/domainOperations/productionRegistrarTransfer'
import { CloudflareCustomerDnsDetachPort, OciRegistrarAuthCodeDelivery, PostgresDomainAutomationCredentialPort, PostgresDomainOutcomeEffects, PostgresDomainOutcomeOwnerAuthority, ProductionDomainDnsObserver } from './fuma/domainOperations/productionAdapters'
import { createHostedNextSourceRuntime, readHostedNextSourceGitHubConfig } from './fuma/nextSource'
import { createMinioObjectStorage } from './fuma/objectStorage'
import {
  BetterAuthOwnerRecoveryAuthority,
  BetterAuthSupportImpersonationAuthority,
  ObjectStorageSupportEvidenceAuthority,
  PostgresModerationMutationAuthority,
  PostgresSupportAuthorityResolver,
  PostgresSupportRouteAuthorizationAuthority,
  createHostedSupportOperationsRuntime,
} from './fuma/supportOperations'
import { configureSiteComponentCatalogPort, PostgresSiteComponentCatalogPort } from './ai/tools/site/componentCatalogPort'
import { createHostedExpertDiscoveryRuntime, readHostedExpertInquiryKey } from './fuma/expertDiscovery'
import {
  configureNextSourceAdaptationToolPort,
  PostgresNextSourceAdaptationToolPort,
} from './ai/tools/site/nextSourceAdaptationPort'
import {
  createHostedMemberIdentityRuntime,
  createMemberImportBoundary,
  MEMBER_SESSION_COOKIE,
  PostgresMemberSiteAuthority,
  readMemberAuthSecret,
} from './fuma/memberIdentity'
import { FUMA_STAFF_FRESH_SESSION_SECONDS } from './auth/hosted/auth'
import { createErrorReporter } from './fuma/observability/errorReporter'
import { setSiteScaffolder } from './fuma/editor/siteScaffoldBridge'
import { pageAllowanceForSlug } from './fuma/entitlements/planSeed'
import { reviewChargingReadiness } from './fuma/entitlements/subscription'
import { persistScaffold, scaffoldTenantWorkspace } from './fuma/editor/tenantScaffold'
import { createScopedModuleStore } from './fuma/editor/moduleStore'
import { PostgresEditorScopedStorage } from './fuma/editor/postgresStorage'
import { hashSource } from '@core/react-ir/workspace'
import { dirname as scaffoldDirname } from 'node:path'
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

function hostedDomainCredentialKeyring(environment: 'local' | 'production'): HostedDomainCredentialKeyring {
  if (environment === 'production'
    || (process.env.FUMA_DOMAIN_CREDENTIAL_ACTIVE_KEY_ID && process.env.FUMA_DOMAIN_CREDENTIAL_KEYRING)) {
    return readHostedDomainCredentialKeyring()
  }
  return Object.freeze({ activeKeyId: 'local-domain-key-v1', keys: Object.freeze([Object.freeze({ keyId: 'local-domain-key-v1', bytes: new Uint8Array(32).fill(19) })]) })
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

/**
 * Error reporting. Inert unless `SENTRY_DSN` is supplied, so development and
 * tests emit nothing. Messages and stacks are redacted before leaving the
 * process; delivery failures never propagate into request handling.
 */
const errorReporter = createErrorReporter({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.FUMA_ENV ?? process.env.NODE_ENV ?? 'development',
  release: process.env.FUMA_WEB_REVISION ?? process.env.SOURCE_SHA ?? null,
  serverName: process.env.FUMA_ROLE ?? 'studio',
})
const fumaHosted = process.env.FUMA_HOSTED === 'true'
if (fumaHosted) assertFumaHostedDatabaseUrl(config.databaseUrl)
configureTrustedProxyCidrs(config.trustedProxyCidrs)
configurePublicOrigins(config.publicOrigins)
// Verify the reversible-secret master key BEFORE touching the database.
//
// `secrets/masterKey.ts` documents that an unset INSTATIC_SECRET_KEY makes boot "fail loudly with
// instructions" in production. It did not: nothing loaded the key at startup, so it was resolved lazily
// on first use inside `ai/credentials/store.ts` and `auth/totpSecrets.ts`. A misconfigured production
// deployment therefore booted, served traffic, and failed only when a customer saved an AI credential or
// used two-factor auth - which reads as those FEATURES being broken rather than as a deployment missing
// one variable, and surfaces on a customer's screen instead of in the deploy that caused it.
//
// Failing the boot is the right direction specifically because this key also encrypts MFA TOTP seeds. A
// server that cannot decrypt a second factor must not accept sign-ins; refusing to start is safer than
// serving while an authentication factor cannot be verified.
//
// Production only, so a self-hosted `bun run dev` keeps its auto-created dev key and is unchanged.
// REPORTS, never refuses: see reportMasterKeyAtBoot for why refusing to boot was the wrong call.
if (process.env.NODE_ENV === 'production') {
  await reportMasterKeyAtBoot()
}

const { db, migrations } = createDbClient(config.databaseUrl)
await runMigrations(db, migrations)
if (fumaHosted) {
  await runHostedMigrations(db)
  await assertFumaHostedStartup({
    db,
    databaseUrl: config.databaseUrl,
  })
}
const hostedFumaConfig = fumaHosted ? readFumaConfig() : undefined
const hostedStaffSecret = hostedFumaConfig ? readHostedAuthSecret() : undefined
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim()
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
const hostedSocialProviders = googleClientId && googleClientSecret
  ? Object.freeze({ google: Object.freeze({ clientId: googleClientId, clientSecret: googleClientSecret }) })
  : undefined
const protectedOwnerBootstrap = hostedFumaConfig
  ? new OrganizationBootstrapService({ repository: new PostgresOrganizationBootstrapRepository(db) })
  : undefined
const customerOrganizationLifecycle = hostedFumaConfig ? new PostgresCustomerOrganizationLifecycle(db) : undefined
const registrarConfig = hostedFumaConfig ? readHostedRegistrarConfig() : null
const hostedStaffAuthRuntime = hostedFumaConfig
  ? (() => {
    const fumaConfig = hostedFumaConfig
    const delivery = fumaConfig.environment === 'production'
      ? fumaConfig.ociEmail === null
        ? createHostedAuthUnavailableDelivery()
        : createHostedAuthOciDelivery({ config: fumaConfig })
      : createHostedAuthFakeInbox()
    return createHostedStaffAuthRuntime({
      databaseUrl: fumaConfig.database.url,
      productHost: fumaConfig.hosts.product,
      protectedOwnerEmail: fumaConfig.protectedOwner.email,
      secureCookies: fumaConfig.staffCookie.secure,
      cookieName: fumaConfig.staffCookie.name,
      secret: hostedStaffSecret!,
      delivery,
      ...(customerOrganizationLifecycle ? { organizationLifecycle: customerOrganizationLifecycle } : {}),
      ...(protectedOwnerBootstrap ? {
        reconcileProtectedOwner: async () => {
          await protectedOwnerBootstrap.bootstrap({ protectedOwnerEmail: fumaConfig.protectedOwner.email })
        },
      } : {}),
    })
  })()
  : undefined
const controlRuntimeSecret = hostedFumaConfig ? readEntitlementControlRuntimeSecret() : undefined
const platformConsoleBoundary = hostedStaffAuthRuntime && hostedFumaConfig && controlRuntimeSecret
  ? createPlatformConsoleBoundary({
    db,
    resolveSession: hostedStaffAuthRuntime.resolveSession,
    protectedOwnerEmail: hostedFumaConfig.protectedOwner.email,
    runtimeSecret: controlRuntimeSecret,
    consoleHost: hostedFumaConfig.hosts.console,
    productHost: hostedFumaConfig.hosts.product,
  })
  : undefined
const hostedSupportOperationsRuntime = hostedFumaConfig && hostedStaffAuthRuntime
  ? (() => {
    const evidenceStorage = createMinioObjectStorage({
      config: hostedFumaConfig.minio,
      policy: {
        allowedMimeTypes: ['application/json'],
        maxObjectBytes: 2 * 1024 * 1024,
        maxTenantBytes: 1024 * 1024 * 1024,
      },
      signingSecret: requiredFumaObjectSigningSecret(),
      accessUrlBase: `https://${hostedFumaConfig.hosts.product}/_fuma/objects`,
    })
    return createHostedSupportOperationsRuntime({
      db,
      ports: {
        authority: new PostgresSupportAuthorityResolver({
          db,
          protectedOwnerEmail: hostedFumaConfig.protectedOwner.email,
          consoleHost: hostedFumaConfig.hosts.console,
        }),
        evidence: new ObjectStorageSupportEvidenceAuthority(evidenceStorage),
        impersonation: new BetterAuthSupportImpersonationAuthority(hostedStaffAuthRuntime),
        moderation: new PostgresModerationMutationAuthority({ db, auth: hostedStaffAuthRuntime }),
        recovery: new BetterAuthOwnerRecoveryAuthority(hostedStaffAuthRuntime),
        routeAuthorization: new PostgresSupportRouteAuthorizationAuthority({
          db,
          protectedOwnerEmail: hostedFumaConfig.protectedOwner.email,
        }),
        audit: new AuditService({ repository: new PostgresAuditRepository(db) }),
      },
    })
  })()
  : undefined
const hostedExpertDiscoveryRuntime = hostedFumaConfig && hostedStaffSecret
  ? await (() => {
    const inquiryStorage = createMinioObjectStorage({
      config: hostedFumaConfig.minio,
      policy: {
        allowedMimeTypes: ['application/json'],
        maxObjectBytes: 64 * 1024,
        maxTenantBytes: 5 * 1024 * 1024 * 1024,
      },
      signingSecret: requiredFumaObjectSigningSecret(),
      accessUrlBase: `https://${hostedFumaConfig.hosts.product}/_fuma/objects`,
    })
    return createHostedExpertDiscoveryRuntime({
      db,
      storage: inquiryStorage,
      inquiryKey: readHostedExpertInquiryKey(),
      abusePepper: hostedStaffSecret,
      approvalAuthorization: new PostgresSupportRouteAuthorizationAuthority({
        db,
        protectedOwnerEmail: hostedFumaConfig.protectedOwner.email,
      }),
    })
  })()
  : undefined
const hostedStaffAuth = hostedStaffAuthRuntime?.boundary
const memberIdentityRuntime = hostedFumaConfig && hostedStaffSecret
  ? createHostedMemberIdentityRuntime({ db, secret: readMemberAuthSecret(hostedStaffSecret) })
  : undefined
const hostedAuthHost = hostedFumaConfig
  ? hostedFumaConfig.hosts.auth
  : undefined
const centralIdentityAuthRuntime = hostedFumaConfig && hostedStaffSecret && hostedAuthHost
  ? (() => {
    const delivery = hostedFumaConfig.environment === 'production'
      ? hostedFumaConfig.ociEmail === null
        ? createHostedAuthUnavailableDelivery()
        : createHostedAuthOciDelivery({ config: hostedFumaConfig, linkHost: hostedAuthHost, audience: 'account' })
      : createHostedAuthFakeInbox()
    return createHostedIdentityAuthRuntime({
      databaseUrl: hostedFumaConfig.database.url,
      identityHost: hostedAuthHost,
      secureCookies: hostedFumaConfig.staffCookie.secure,
      cookieName: hostedFumaConfig.staffCookie.secure ? AUTH_HANDOFF_SESSION_COOKIE : 'fuma_auth',
      secret: hostedStaffSecret,
      delivery,
      ...(hostedSocialProviders ? { socialProviders: hostedSocialProviders } : {}),
    })
  })()
  : undefined
const centralStaffHandoff = centralIdentityAuthRuntime && hostedStaffAuthRuntime && hostedFumaConfig && hostedAuthHost && hostedStaffSecret
  ? createCentralStaffHandoffBoundary({
    db,
    appOrigin: `https://${hostedFumaConfig.hosts.product}`,
    authOrigin: `https://${hostedAuthHost}`,
    marketingOrigin: `https://${hostedFumaConfig.hosts.marketing}`,
    identityAuth: centralIdentityAuthRuntime,
    protectedOwnerEmail: hostedFumaConfig.protectedOwner.email,
    staffCookieName: hostedFumaConfig.staffCookie.name,
    staffAuthSecret: hostedStaffSecret,
    ...(protectedOwnerBootstrap ? { reconcileProtectedOwner: async (email: string) => {
      await protectedOwnerBootstrap.bootstrap({ protectedOwnerEmail: email })
    } } : {}),
    secureCookies: hostedFumaConfig.staffCookie.secure,
  })
  : undefined
const templateCatalog = hostedFumaConfig
  ? new PublicTemplateCatalogService(
    new PostgresPublicTemplateCatalogRepository(db),
    new PostgresTemplateReleaseAuthority(db),
    hostedFumaConfig.hosts.templatePreview,
  )
  : undefined
const publicProjectionAuthority = fumaHosted
  ? createHostedPublicProjectionAuthorityCatalog(db)
  : undefined
const publicHandoffRuntime = hostedFumaConfig && hostedAuthHost && centralIdentityAuthRuntime && templateCatalog && publicProjectionAuthority
  ? createHostedPublicHandoffRuntime({
    db,
    projections: publicProjectionAuthority,
    templates: templateCatalog,
    identityAuth: centralIdentityAuthRuntime,
    appHost: hostedFumaConfig.hosts.product,
    authHost: hostedAuthHost,
    marketingHost: hostedFumaConfig.hosts.marketing,
    secureCookies: hostedFumaConfig.staffCookie.secure,
    googleAuthEnabled: Boolean(hostedSocialProviders?.google),
    // Finish the sign-in the visitor already completed on the auth host, rather
    // than landing them on the app with only a handoff cookie and a second form.
    ...(hostedStaffSecret ? {
      completeStaffSession: async (
        request: Request,
        session: Readonly<{ userId: string, identitySessionId: string }>,
      ) => {
        const minted = await mintStaffSession({
          db,
          userId: session.userId,
          identitySessionId: session.identitySessionId,
          protectedOwnerEmail: hostedFumaConfig.protectedOwner.email,
          staffAuthSecret: hostedStaffSecret,
          ipAddress: request.headers.get('x-forwarded-for')?.split(',', 1)[0]?.trim() ?? null,
          userAgent: request.headers.get('user-agent'),
          now: new Date(),
        })
        if (!minted) return []
        if (minted.email.trim().toLowerCase() === hostedFumaConfig.protectedOwner.email.trim().toLowerCase()) {
          await protectedOwnerBootstrap?.bootstrap({ protectedOwnerEmail: minted.email })
        }
        return [staffSessionCookie(
          hostedFumaConfig.staffCookie.name,
          minted.cookieValue,
          hostedFumaConfig.staffCookie.secure,
        )]
      },
    } : {}),
  })
  : undefined
const publicProjectionRuntime = fumaHosted
  ? await createHostedPublicProjectionRuntime({
    db,
    ...(publicProjectionAuthority ? { authority: publicProjectionAuthority } : {}),
    ...(publicHandoffRuntime ? { handoff: publicHandoffRuntime.issuer } : {}),
  })
  : undefined
const quotaRuntime = hostedFumaConfig ? createQuotaRuntime({ db }) : undefined
const publicMarketingAnalyticsRuntime = fumaHosted
  ? await (async () => {
    const schemaSentinel = await resolvePublicMarketingAnalyticsSchemaSentinel(db)
    if (!schemaSentinel) return undefined
    const privateConfig = readPrivateProjectionConfig()
    return createHostedPublicMarketingAnalyticsRuntime({ db, privateHost: privateConfig.host, webServiceToken: privateConfig.serviceToken, schemaSentinel })
  })()
  : undefined
const publicMarketingAnalyticsAdmin = publicMarketingAnalyticsRuntime && hostedStaffAuthRuntime && hostedFumaConfig
  ? createPublicMarketingAnalyticsAdminBoundary({ productHost: hostedFumaConfig.hosts.product, protectedOwnerEmail: hostedFumaConfig.protectedOwner.email, resolveSession: hostedStaffAuthRuntime.resolveSession, service: publicMarketingAnalyticsRuntime.service })
  : undefined
const publicationRuntime = hostedFumaConfig
  ? await createHostedPublicationRuntime({
    db,
    config: hostedFumaConfig,
    objectAccessSigningSecret: requiredFumaObjectSigningSecret(),
    ...(quotaRuntime ? { campaignQuota: quotaRuntime.campaign } : {}),
  })
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
const nextSourceObjectStorage = hostedFumaConfig
  ? createMinioObjectStorage({
    config: hostedFumaConfig.minio,
    policy: {
      allowedMimeTypes: ['application/zip'],
      maxObjectBytes: 256 * 1024 * 1024,
      maxTenantBytes: 20 * 1024 * 1024 * 1024,
    },
    signingSecret: requiredFumaObjectSigningSecret(),
    accessUrlBase: `https://${hostedFumaConfig.hosts.product}/_fuma/objects`,
  })
  : undefined
const hostedMeteringRuntime = hostedFumaConfig ? createHostedMeteringRuntime({ db }) : undefined
const nextSourceGithubConfigured = Boolean(
  process.env.FUMA_GITHUB_APP_ID?.trim()
  && process.env.FUMA_GITHUB_APP_PRIVATE_KEY_PEM?.trim(),
)
const hostedNextSourceRuntime = hostedFumaConfig && hostedStaffAuthRuntime && nextSourceObjectStorage && releaseObjectStorage && hostedMeteringRuntime
  ? createHostedNextSourceRuntime({
    db,
    storage: nextSourceObjectStorage,
    releaseStorage: releaseObjectStorage,
    metering: hostedMeteringRuntime.collector,
    resolveSession: hostedStaffAuthRuntime.resolveSession,
    ...(nextSourceGithubConfigured
      ? { githubConfig: readHostedNextSourceGitHubConfig() }
      : {}),
  })
  : undefined
if (hostedNextSourceRuntime && nextSourceObjectStorage) {
  configureNextSourceAdaptationToolPort(new PostgresNextSourceAdaptationToolPort({
    db,
    storage: nextSourceObjectStorage,
  }))
}
const hostedArtifactRuntime = hostedFumaConfig
  ? createHostedArtifactRuntime({
    db,
    config: hostedFumaConfig,
    objectAccessSigningSecret: requiredFumaObjectSigningSecret(),
  })
  : undefined
const hostedArtifactReviewRuntime = hostedArtifactRuntime
  ? createHostedArtifactReviewRuntime({
    db,
    artifacts: hostedArtifactRuntime.authority,
  })
  : undefined
const artifactMarketplaceRoutes = hostedArtifactReviewRuntime
  ? createArtifactMarketplaceScopedRoutes(hostedArtifactReviewRuntime.service)
  : undefined
const hostedComponentCatalogRuntime = hostedArtifactRuntime && hostedArtifactReviewRuntime
  ? createHostedComponentCatalogRuntime({ db, artifacts: hostedArtifactRuntime.authority, reviews: hostedArtifactReviewRuntime.service })
  : undefined
if (hostedComponentCatalogRuntime) configureSiteComponentCatalogPort(new PostgresSiteComponentCatalogPort(db, hostedComponentCatalogRuntime.service))
const siteRuntimeConfigured = Boolean(
  process.env.FUMA_SITE_RUNTIME_PRIVATE_HOST?.trim()
  && process.env.FUMA_SITE_RUNTIME_SERVICE_TOKEN?.trim()
  && process.env.FUMA_SITE_RUNTIME_SUPPORTED_DEPLOYMENTS?.trim(),
)
const siteRuntimeAuthority = hostedFumaConfig && releaseObjectStorage && siteRuntimeConfigured
  ? await createHostedSiteRuntimeAuthority({
    db,
    storage: releaseObjectStorage,
    ...(memberIdentityRuntime && publicationRuntime ? {
      members: Object.freeze({
        async resolve(input: Parameters<SiteRuntimeMemberProjectionPort['resolve']>[0]) {
          const scope: PublicationRepositoryScope = Object.freeze({
            platformId: input.binding.platformId,
            organizationId: input.binding.organizationId,
            workspaceId: input.binding.workspaceId,
            siteId: input.binding.siteId,
            ownerKey: input.binding.ownerKey,
            generation: input.binding.ownerGeneration,
            state: 'active',
            transferFence: null,
            profileId: 'website',
          })
          const session = await memberIdentityRuntime.service.resolve(scope, input.memberSessionToken)
          if (!session.authenticated || session.principal === null) {
            return Object.freeze({
              audience: Object.freeze({ kind: 'public' as const, memberId: null, accessFingerprintSha256: '0'.repeat(64) }),
              member: Object.freeze({ authenticated: false as const, memberIdentityId: null, memberId: null, sessionId: null, displayName: null }),
              snapshot: emptyApplicationSnapshot(),
              access: Object.freeze({ member: false, paid: false, memberSource: 'none' as const, segmentIds: [] as string[] }),
            })
          }
          const audience = await publicationRuntime.graph.memberAccess.audienceForIdentity(scope, session.principal.memberIdentityId)
          const memberId = audience.memberId ?? session.principal.memberIdentityId
          const account = (await publicationRuntime.graph.memberAccess.listAccounts(scope, { limit: 200, afterId: null }))
            .find((item) => item.memberIdentityId === session.principal!.memberIdentityId && item.state === 'active') ?? null
          const evidence = JSON.stringify({
            memberIdentityId: session.principal.memberIdentityId,
            memberId,
            member: audience.member,
            paid: audience.paid,
            segmentIds: [...audience.segmentIds].toSorted(),
          })
          const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(evidence)))
          return Object.freeze({
            audience: Object.freeze({
              kind: 'member' as const,
              memberId,
              accessFingerprintSha256: [...digest].map((value) => value.toString(16).padStart(2, '0')).join(''),
            }),
            member: Object.freeze({
              authenticated: true as const,
              memberIdentityId: session.principal.memberIdentityId,
              memberId,
              sessionId: session.principal.sessionId,
              displayName: account?.displayName ?? session.principal.displayName,
            }),
            snapshot: Object.freeze({
              ...emptyApplicationSnapshot(),
              account: account ? Object.freeze({ displayName: account.displayName, locale: account.locale, timezone: account.timezone }) : null,
            }),
            access: Object.freeze({
              member: audience.member,
              paid: audience.paid,
              memberSource: audience.memberSource,
              segmentIds: [...audience.segmentIds].toSorted(),
            }),
          })
        },
      }),
    } : {}),
  })
  : undefined
const templatePreviewBoundary = templateCatalog && releaseObjectStorage
  ? createTemplatePreviewBoundary({
    host: hostedFumaConfig?.hosts.templatePreview ?? TEMPLATE_PREVIEW_HOST,
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
    controlHosts: [process.env.FUMA_PUBLIC_PROJECTION_INTERNAL_HOST?.trim()]
      .filter((value): value is string => Boolean(value)),
    ...(releaseObjectStorage ? { storage: releaseObjectStorage } : {}),
    ...(edgeRuntime ? { edge: edgeRuntime.boundary } : {}),
    extensions: [dynamicPublicationPublic, publicationAnalyticsPublic].filter((value) => value !== undefined),
  })
  : undefined
const hostedSiteOnboarding = hostedStaffAuthRuntime && freeHostRuntime && hostedFumaConfig
  ? createHostedSiteOnboardingBoundary({
    service: new HostedSiteOnboardingService(db, `.${hostedFumaConfig.hosts.rootDomain}`),
    resolveSession: hostedStaffAuthRuntime.resolveSession,
    handlesProductRequest: hostedStaffAuthRuntime.boundary.handlesProductRequest,
    allowsMutationOrigin: hostedStaffAuthRuntime.allowsMutationOrigin,
  })
  : undefined
// The Vite admin shell reads its organization/workspace/site scope from this
// projection. Without it the shell sees an empty catalog and cannot leave
// first-site onboarding. `reconcileOwned` repairs organizations created
// through Better Auth whose Fuma sidecars were interrupted.
const accessibleContextCatalog = hostedStaffAuthRuntime
  ? createAccessibleContextCatalogBoundary({
    catalog: new PostgresAccessibleContextCatalog(
      db,
      customerOrganizationLifecycle
        ? async (userId: string) => { await customerOrganizationLifecycle.reconcileOwned(userId) }
        : undefined,
    ),
    resolveSession: hostedStaffAuthRuntime.resolveSession,
    handlesProductRequest: hostedStaffAuthRuntime.boundary.handlesProductRequest,
    // Permissions come from the same authorization authority the scoped API
    // enforces, so navigation can never advertise a route the API denies.
    resolvePermissions: async (request, catalog) => {
      const session = await hostedStaffAuthRuntime.resolveSession(request.headers)
      if (!session) return []
      const authority = new PostgresFumaSiteAuthorizationAuthority(db)
      const projections: Array<{ organizationId: string; workspaceId: string; siteId: string; allow: string[] }> = []
      for (const site of catalog.sites) {
        if (site.status !== 'active') continue
        try {
          const authorization = await authority.loadExactSiteAuthorization({
            actor: Object.freeze({
              kind: 'staff' as const,
              userId: session.userId,
              sessionId: session.sessionId,
              impersonator: session.impersonatedBy === null ? null : Object.freeze({ userId: session.impersonatedBy }),
            }),
            routeScope: Object.freeze({
              organizationId: site.organizationId,
              workspaceId: site.workspaceId,
              siteId: site.id,
            }),
          })
          if (authorization === null) continue
          // Same input assembly the enforcing path uses; a partial object
          // fails contract validation and would silently yield no grants.
          const resolved = resolveLayeredPermissions(permissionInput(readAuthorization(authorization)))
          projections.push({
            organizationId: site.organizationId,
            workspaceId: site.workspaceId,
            siteId: site.id,
            allow: [...resolved.allowedPermissionIds],
          })
        } catch (error) {
          console.error('[fuma] permission projection unavailable for one site:', error)
        }
      }
      return Object.freeze(projections)
    },
  })
  : undefined
const workspaceManagement = hostedStaffAuthRuntime
  ? createWorkspaceManagementBoundary({ db, resolveSession: hostedStaffAuthRuntime.resolveSession, handlesProductRequest: hostedStaffAuthRuntime.boundary.handlesProductRequest, allowsMutationOrigin: hostedStaffAuthRuntime.allowsMutationOrigin })
  : undefined
// Site design is not reimplemented in the hosted product. Staff are handed the
// real builder, so their hosted staff session has to resolve a CMS identity for
// the CMS endpoints the builder calls. The store binds the two identities once;
// the authz bridge lets already-bound sessions authenticate.
const builderIdentityStore = hostedStaffAuthRuntime
  ? new PostgresBuilderIdentityStore(db)
  : undefined
const builderSession = hostedStaffAuthRuntime && builderIdentityStore
  ? createBuilderSessionBoundary({
    store: builderIdentityStore,
    handlesProductRequest: hostedStaffAuthRuntime.boundary.handlesProductRequest,
    resolveStaffUserId: async (headers) => {
      const session = await hostedStaffAuthRuntime.resolveSession(headers)
      return session?.userId ?? null
    },
    readStaffProfile: async (userId) => {
      const rows = await db<{ email: string, name: string }>`
        select identity.email, identity.name
        from auth_users identity
        join auth_staff_profiles profile on profile.user_id=identity.id
        where identity.id=${userId}
          and coalesce(identity.banned, false)=false
        limit 1`
      const row = rows.rows[0]
      return row ? { email: row.email, displayName: row.name } : null
    },
    /**
     * The plan's page allowance, so the builder's one-page free tier can actually refuse a second
     * page. Task 68 wired the check at all three creation paths and left the carrier unpopulated,
     * which made the limit inert in production.
     *
     * SELF-LIMITING for the same reason the storage allowance is: nothing is chargeable yet, so every
     * hosted tenant genuinely IS on the funded starter and returning its quota is TRUE. It stops
     * being true the moment a paid plan can be bought, so this returns null from then on - forcing the
     * persisted-assignment lookup to become required rather than optional. A figure that quietly
     * becomes wrong is worse than one that is absent.
     */
    resolvePageAllowance: async () => {
      if (reviewChargingReadiness().ready) return null
      return pageAllowanceForSlug('starter')
    },
    // The published site has its own host. Prefer an active custom domain, then
    // the allocated free host; never fall back to the admin origin, because a
    // relative link there would open the dashboard instead of the site.
    resolvePublicOrigin: async (request) => {
      const query = new URL(request.url).searchParams
      const organizationId = query.get('organizationId')?.trim() ?? ''
      const workspaceId = query.get('workspaceId')?.trim() ?? ''
      const siteId = query.get('siteId')?.trim() ?? ''
      if (!organizationId || !workspaceId || !siteId) return null
      const active = await db<{ hostname: string }>`
        select hostname
        from fuma_domains
        where organization_id=${organizationId}
          and workspace_id=${workspaceId}
          and site_id=${siteId}
          and desired='active'
          and observed='active'
        order by case when kind='free' then 1 else 0 end, hostname
        limit 1`
      const hostname = active.rows[0]?.hostname
      if (hostname) return `https://${hostname}`
      const free = await db<{ host: string }>`
        select host
        from fuma_free_hosts
        where organization_id=${organizationId}
          and workspace_id=${workspaceId}
          and site_id=${siteId}
          and state='active'
        limit 1`
      const host = free.rows[0]?.host
      return host ? `https://${host}` : null
    },
    // Authority is re-derived from the request's own site scope; the browser
    // never supplies permissions, only which site it is asking about.
    resolveSitePermissions: async (request, userId) => {
      const query = new URL(request.url).searchParams
      const organizationId = query.get('organizationId')?.trim() ?? ''
      const workspaceId = query.get('workspaceId')?.trim() ?? ''
      const siteId = query.get('siteId')?.trim() ?? ''
      if (!organizationId || !workspaceId || !siteId) return Object.freeze([])
      const session = await hostedStaffAuthRuntime.resolveSession(request.headers)
      if (!session || session.userId !== userId) return Object.freeze([])
      const authorization = await new PostgresFumaSiteAuthorizationAuthority(db)
        .loadExactSiteAuthorization({
          actor: Object.freeze({
            kind: 'staff' as const,
            userId: session.userId,
            sessionId: session.sessionId,
            impersonator: session.impersonatedBy === null
              ? null
              : Object.freeze({ userId: session.impersonatedBy }),
          }),
          routeScope: Object.freeze({ organizationId, workspaceId, siteId }),
        })
      if (authorization === null) return Object.freeze([])
      const resolved = resolveLayeredPermissions(permissionInput(readAuthorization(authorization)))
      return Object.freeze([...resolved.allowedPermissionIds])
    },
  })
  : undefined
if (builderIdentityStore) {
  setHostedBuilderIdentityResolver(async (request, requestDb) => {
    const session = await hostedStaffAuthRuntime?.resolveSession(request.headers)
    if (!session) return null
    return requestDb === db
      ? await builderIdentityStore.findBound(session.userId)
      : await new PostgresBuilderIdentityStore(requestDb).findBound(session.userId)
  })

  // Activate tenant-scoped site documents.
  //
  // Without this registration every hosted site reads and writes the ONE legacy document, so
  // editing one site overwrites another and nothing reports a conflict. The resolver derives the
  // document from the AUTHORISED scope, never from the raw query string: trusting the query
  // would let any signed-in staff user reach another tenant's design by editing `?siteId=`.
  setHostedSiteDocumentResolver(async (request) => {
    const resolution = await createSiteDocumentResolver({
      mode: 'hosted',
      authorizer: {
        authorizeScope: async (scopedRequest, scope) => {
          const session = await hostedStaffAuthRuntime?.resolveSession(scopedRequest.headers)
          if (!session) return null
          const authorization = await new PostgresFumaSiteAuthorizationAuthority(db)
            .loadExactSiteAuthorization({
              actor: Object.freeze({
                kind: 'staff' as const,
                userId: session.userId,
                sessionId: session.sessionId,
                impersonator: session.impersonatedBy === null
                  ? null
                  : Object.freeze({ userId: session.impersonatedBy }),
              }),
              routeScope: scope,
            })
          // No authorization row means no access. Returning the scope anyway would authorise by
          // omission, which is how a cross-tenant read gets shipped.
          return authorization === null ? null : scope
        },
      },
    }).resolve(request)
    return resolution.ok ? resolution.documentId : null
  })

  // The storage allowance the hosted dashboard reports. Registered here for the same reason the
  // site document resolver is: built but unregistered means the fix is inert, which is the mistake
  // task 20 nearly shipped.
  //
  // AUTHORISATION IS REUSED, NOT REIMPLEMENTED - the resolver runs the same scoped resolution
  // above, so an allowance is only reported for a request that has already proven it may read this
  // tenant. A caller who merely edits ?siteId= gets null rather than another tenant's figure.
  setHostedStorageAllowanceResolver(async (request) => {
    const resolution = await createSiteDocumentResolver({
      mode: 'hosted',
      authorizer: {
        authorizeScope: async (scopedRequest, scope) => {
          const session = await hostedStaffAuthRuntime?.resolveSession(scopedRequest.headers)
          if (!session) return null
          const authorization = await new PostgresFumaSiteAuthorizationAuthority(db)
            .loadExactSiteAuthorization({
              actor: Object.freeze({
                kind: 'staff' as const,
                userId: session.userId,
                sessionId: session.sessionId,
                impersonator: session.impersonatedBy === null
                  ? null
                  : Object.freeze({ userId: session.impersonatedBy }),
              }),
              routeScope: scope,
            })
          return authorization === null ? null : scope
        },
      },
    }).resolve(request)
    if (!resolution.ok) return null
    // Self-limiting by construction: returns null once any plan is chargeable, because from then
    // on the tenant's actual assignment must be read rather than assumed.
    return assumedFundedStorageBytes()
  })
}

// Registered so the tenant scaffold is not inert - the mistake tasks 20, 52 and 68 each made, where a
// correct fix was built and never reached by a running server. With no hosted config this never runs,
// so a self-hosted install writes nothing new.
/**
 * The studio root, derived from this module rather than from cwd: the scaffold reads real files
 * under src/admin/fuma/ui, and a server started from the repo root would otherwise resolve a
 * different directory than one started from the app dir.
 */
function scaffoldStudioRoot(): string {
  return scaffoldDirname(import.meta.dir)
}

if (hostedFumaConfig) {
  setSiteScaffolder(async (target) => {
    const scaffold = await scaffoldTenantWorkspace(scaffoldStudioRoot(), target.siteName)
    const store = createScopedModuleStore(new PostgresEditorScopedStorage(db), Object.freeze({
      platformId: target.platformId,
      organizationId: target.organizationId,
      workspaceId: target.workspaceId,
      siteId: target.siteId,
      ownerKey: target.ownerKey,
      generation: target.generation,
    }) as never)
    return await persistScaffold(
      store,
      scaffold,
      // The same hash the workspace uses, so a scaffolded module and an edited one are compared the
      // same way rather than by two different digests.
      async (source) => await hashSource(source),
      new Date().toISOString(),
    )
  })
}
const paystackRuntime = hostedFumaConfig
  ? createHostedPaystackRuntime({ db, config: hostedFumaConfig })
  : undefined
const hostedKesCostConfigured = Boolean(
  process.env.FUMA_KES_FX_VERSION?.trim()
  && process.env.FUMA_KES_MINOR_NUMERATOR?.trim()
  && process.env.FUMA_USD_MICROS_DENOMINATOR?.trim(),
)
const hostedKesCostConversion = hostedFumaConfig && hostedKesCostConfigured
  ? readHostedKesCostConversion()
  : undefined
const entitlementRuntime = hostedKesCostConversion
  ? createHostedEntitlementRuntime({
    db,
    usdMicrosToKesMinor: hostedKesCostConversion.convert,
    costConversionVersion: hostedKesCostConversion.version,
  })
  : undefined
const hostedDomainRuntime = hostedFumaConfig && entitlementRuntime && quotaRuntime && hostedMeteringRuntime
  ? await (async () => {
    const keyring = hostedDomainCredentialKeyring(hostedFumaConfig.environment)
    try {
      return await createHostedDomainRuntime({
        db,
        keyring,
        provider: Object.freeze({ async execute(): Promise<never> { throw new TypeError('Generic domain credential operations require an explicit provider adapter.') } }),
        entitlements: entitlementRuntime.service,
        quotas: quotaRuntime.service,
        metering: hostedMeteringRuntime.service,
      })
    } finally { for (const entry of keyring.keys) entry.bytes.fill(0) }
  })()
  : undefined
const hostedCloudflareRuntime = hostedFumaConfig && hostedDomainRuntime
  ? createHostedCloudflareRuntime({ db, config: hostedFumaConfig, domains: hostedDomainRuntime })
  : undefined
const hostedOciEmail = hostedFumaConfig?.ociEmail ?? null
const hostedDomainCommerce = registrarConfig && hostedOciEmail && hostedDomainRuntime && hostedCloudflareRuntime
  && hostedStaffAuthRuntime && hostedStaffSecret && entitlementRuntime && publicationRuntime
  ? await (async () => {
    const authority = platformCredentialAuthority('fuma')
    const token = new TextEncoder().encode(registrarConfig.apiToken)
    const fingerprint = new Bun.CryptoHasher('sha256').update(token).digest('hex')
    const current = await hostedDomainRuntime.repository.credentialExact(authority, registrarConfig.credentialId)
    if (!current) {
      await hostedDomainRuntime.service.storeCredential({ credentialId: registrarConfig.credentialId, authority, plaintext: token, createdAt: registrarConfig.credentialCreatedAt })
    } else if (current.state !== 'active' || current.fingerprintSha256 !== fingerprint) {
      token.fill(0)
      throw new TypeError('Registrar credential rotation requires an explicit reviewed domain credential rotation.')
    }
    const http = new FetchRegistrarGatewayHttpClient()
    const registrarProvider = new RegistrarGatewayAdapter({ origin: registrarConfig.gatewayOrigin, token, http })
    const transferProvider = new RegistrarTransferGatewayAdapter({ origin: registrarConfig.gatewayOrigin, token, http })
    token.fill(0)
    const stepUp = new BetterAuthRegistrarStepUp({ resolveSession: hostedStaffAuthRuntime.resolveSession, secret: new TextEncoder().encode(hostedStaffSecret) })
    const registrar = createHostedRegistrarRuntime({ db, provider: registrarProvider, domains: hostedDomainRuntime.service, stepUp, stepUpIssuer: stepUp, entitled: async (scope) => (await entitlementRuntime.service.evaluate(scope.organizationId)).source !== 'none', authority, credentialId: registrarConfig.credentialId })
    const operationsRepository = new PostgresDomainOperationsRepository(db)
    const operations = createHostedDomainOperationsRuntime({
      db,
      dns: new ProductionDomainDnsObserver({ cloudflare: hostedCloudflareRuntime.reconciler }),
      automation: new PostgresDomainAutomationCredentialPort(hostedDomainRuntime.repository),
      registrar: transferProvider,
      delivery: new OciRegistrarAuthCodeDelivery({ db, oci: publicationRuntime.oci, senderEmail: hostedOciEmail.approvedSender }),
      authCodes: new AesGcmRegistrarAuthCodeVault(hostedDomainRuntime.keys),
      detach: new CloudflareCustomerDnsDetachPort({ cloudflare: hostedCloudflareRuntime.reconciler, domains: hostedDomainRuntime.repository }),
      owner: new PostgresDomainOutcomeOwnerAuthority(db),
      effects: new PostgresDomainOutcomeEffects(operationsRepository),
    })
    return Object.freeze({
      registrar,
      operations,
      cloudflareRoutes: hostedCloudflareRuntime.scopedRoutesWithOnboarding(async (scope, domainId, prevalidation, capability) => { await operations.service.onboardCustomerDns(scope, domainId, prevalidation, capability) }),
      close() { registrarProvider.close(); transferProvider.close(); stepUp.close() },
    })
  })()
  : undefined
const entitlementAdminRuntime = entitlementRuntime && hostedStaffAuthRuntime && hostedFumaConfig && controlRuntimeSecret
  ? createHostedEntitlementAdminRuntime({
    db,
    entitlementServiceFor: entitlementRuntime.serviceFor,
    hostedStaffAuth: hostedStaffAuthRuntime,
    protectedOwnerEmail: hostedFumaConfig.protectedOwner.email,
    consoleHost: hostedFumaConfig.hosts.console,
    productHost: hostedFumaConfig.hosts.product,
    runtimeSecret: controlRuntimeSecret,
  })
  : undefined
const platformCheckoutRuntime = hostedFumaConfig
  && paystackRuntime
  && entitlementRuntime
  && hostedStaffAuthRuntime
  ? createHostedPlatformCheckoutRuntime({
    db,
    transport: paystackRuntime.platformBilling,
    registry: paystackRuntime.registry,
    entitlements: entitlementRuntime.service,
    callbackOrigin: `https://${hostedFumaConfig.hosts.product}`,
    resolvePayer: (request) => hostedStaffAuthRuntime.resolveSession(request.headers),
  })
  : undefined
const platformBillingRuntime = platformCheckoutRuntime && paystackRuntime && hostedFumaConfig
  ? await createHostedPlatformBillingRuntime({
    db,
    config: hostedFumaConfig,
    platformBilling: paystackRuntime.platformBilling,
    customerMerchant: paystackRuntime.customerMerchant,
  })
  : undefined
const hostedMcpRuntime = hostedFumaConfig && hostedStaffAuthRuntime && hostedStaffSecret && publicationRuntime
  ? await (async () => {
    const key = readHostedAiByokMetadataKey()
    return await createHostedMcpProductionRuntime({
      db,
      productHost: hostedFumaConfig.hosts.product,
      staffSecret: hostedStaffSecret,
      resolveStaffSession: hostedStaffAuthRuntime.resolveSession,
      publishJobs: publicationRuntime.jobs,
      byokMetadataKey: key.bytes,
      byokMetadataKeyId: key.keyId,
    })
  })()
  : undefined
const hostedCapabilityDashboardRuntime = hostedComponentCatalogRuntime && hostedMcpRuntime && hostedFumaConfig
  ? createHostedCapabilityDashboardRuntime({
    db,
    components: hostedComponentCatalogRuntime.service,
    mcp: hostedMcpRuntime.service,
    platformAuthorization: new PostgresSupportRouteAuthorizationAuthority({
      db,
      protectedOwnerEmail: hostedFumaConfig.protectedOwner.email,
    }),
  })
  : undefined
const bookingsRuntime = hostedFumaConfig ? createHostedBookingRuntime({ db }) : undefined
const domainRoutes = hostedDomainCommerce
  ? Object.freeze([...hostedDomainCommerce.cloudflareRoutes, ...hostedDomainCommerce.registrar.scopedRoutes, ...hostedDomainCommerce.operations.scopedRoutes])
  : hostedCloudflareRuntime?.scopedRoutes
const fumaScopedApi = createHostedFumaScopedApi({
  db,
  hostedStaffAuth: hostedStaffAuthRuntime,
  ...(publicationRuntime ? { publicationRoutes: publicationRuntime.graph.scopedRoutes } : {}),
  ...(platformCheckoutRuntime ? { checkoutRoutes: platformCheckoutRuntime.scopedRoutes } : {}),
  ...(quotaRuntime ? { quotaRoutes: quotaRuntime.scopedRoutes } : {}),
  ...(domainRoutes ? { domainRoutes } : {}),
  ...(hostedMcpRuntime ? { mcpRoutes: hostedMcpRuntime.scopedRoutes } : {}),
  ...(artifactMarketplaceRoutes ? { marketplaceRoutes: artifactMarketplaceRoutes } : {}),
  ...(hostedComponentCatalogRuntime ? { componentCatalogRoutes: hostedComponentCatalogRuntime.scopedRoutes } : {}),
  ...(hostedSupportOperationsRuntime ? { supportRoutes: hostedSupportOperationsRuntime.scopedRoutes } : {}),
  ...(hostedExpertDiscoveryRuntime ? { expertRoutes: hostedExpertDiscoveryRuntime.scopedRoutes } : {}),
  ...(hostedCapabilityDashboardRuntime ? { capabilityDashboardRoutes: hostedCapabilityDashboardRuntime.scopedRoutes } : {}),
  ...(bookingsRuntime ? { bookingRoutes: bookingsRuntime.scopedRoutes } : {}),
  ...(hostedNextSourceRuntime ? { nextSourceRoutes: hostedNextSourceRuntime.scopedRoutes } : {}),
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

    // The tenant Next renderer consumes exact host/release data only through
    // this private-host, bearer-bound TypeBox boundary. It never falls through
    // to public tenant routing or staff/CMS authority.
    if (siteRuntimeAuthority?.boundary.handles(req)) {
      const runtimeResponse = await siteRuntimeAuthority.boundary.handle(req)
      if (runtimeResponse) return applySecurityHeaders(runtimeResponse, pathname)
    }

    // Hosted public authority is the process's first public request boundary. This
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
        centralStaffHandoff,
        publicProjections: publicProjectionRuntime?.boundary,
        publicHandoff: publicHandoffRuntime?.boundary,
        publicationPublic: publicationRuntime?.publicBoundary,
        freeHostPublic: freeHostRuntime?.boundary,
        memberAuth: memberIdentityRuntime?.boundary,
        memberImports: memberImportBoundary,
        paystackWebhooks: platformBillingRuntime?.webhooks ?? paystackRuntime?.webhooks,
        entitlementAdmin: entitlementAdminRuntime?.boundary,
        platformConsole: platformConsoleBoundary,
        publicMarketingAnalyticsAdmin,
        accessibleContextCatalog,
        builderSession,
        hostedSiteOnboarding,
        workspaceManagement,
        fumaScopedApi,
        mcpAuthority: hostedMcpRuntime?.nativeHttpAuthority,
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
      errorReporter.capture(err, { route: pathname, method: req.method, status: 500 })
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
    errorReporter.capture(err, { tags: { scope: 'server' } })
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
      platformBillingRuntime?.close(),
      publicationSockets?.close(),
      hostedStaffAuthRuntime?.close(),
      hostedDomainCommerce?.close(),
      hostedCloudflareRuntime?.close(),
      centralIdentityAuthRuntime?.close(),
      publicProjectionRuntime?.close(),
      siteRuntimeAuthority?.close(),
      publicationRuntime?.close(),
      edgeRuntime?.cache.close(),
    ])
    await errorReporter.flush()
    process.exit(0)
  } catch (error) {
    console.error(`[server] ${signal} shutdown failed:`, error)
    errorReporter.capture(error, { tags: { scope: 'shutdown', signal } })
    await errorReporter.flush()
    process.exit(1)
  }
}
const onSigint = (): void => { void shutdown('SIGINT') }
const onSigterm = (): void => { void shutdown('SIGTERM') }
process.once('SIGINT', onSigint)
process.once('SIGTERM', onSigterm)

console.log(`[server] Listening on http://${config.hostname}:${config.port}`)

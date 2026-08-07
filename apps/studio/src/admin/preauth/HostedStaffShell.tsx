import { useState } from 'react'
import { FumaScopedShell } from '../fuma/FumaScopedShell'
import { HostedSiteOnboarding } from '../fuma/HostedSiteOnboarding'
import { PublicationRouteContent } from '../fuma/publication'
import { DomainsRouteContent } from '../fuma/domains'
import { OrganizationManagementRouteContent } from '../fuma/organizationManagement'
import { CreditsLedgerRouteContent, creditsAdminRegistry } from '../fuma/credits'
import { PlatformCheckoutRouteContent } from '../fuma/billing'
import { QuotaSelfServiceRouteContent } from '../fuma/usage'
import { McpScopedRouteContent } from '../fuma/mcp'
import { WebsiteAnalyticsRouteContent } from '../fuma/analytics/WebsiteAnalyticsRouteContent'
import { ComponentCatalogRouteContent } from '../fuma/components'
import { SupportOperationsRouteContent, type SupportClientTarget } from '../fuma/supportOperations'
import { ExpertDiscoveryRouteContent } from '../fuma/expertDiscovery'
import { PaidHandoffRouteContent } from '../fuma/paidHandoff'
import { CustomerCapabilityDashboardRouteContent, PlatformCapabilityInventoryRouteContent } from '../fuma/aiCapabilities'
import { BookingsRouteContent } from '../fuma/bookings'
import {
  WebsiteDashboardRoute,
  isWebsiteDashboardRoute,
} from '../fuma/dashboards/website/WebsiteDashboardRoute'
import {
  PublicationDashboardRoute,
  isPublicationDashboardRoute,
} from '../fuma/dashboards/publication/PublicationDashboardRoute'
import {
  HostedProfileEditorSurface,
  type HostedProfileEditorRenderAdapter,
} from '../fuma/profileEditor/HostedProfileEditorSurface'
import {
  AccessibleContextCatalogSchema,
  type AccessibleContextCatalog,
  type NavigationPermissionState,
  type PermissionDecision,
} from '@core/fuma'
import { logoutHostedStaff, type HostedStaffSession } from '@core/fuma/auth'
import { getErrorMessage } from '@core/utils/errorMessage'
import { Value } from '@core/utils/typeboxHelpers'
import { Button } from '@admin/fuma/ui/button'
import { HostedStaffSecurity } from './HostedStaffSecurity'
import { HostedThemeProvider } from '../fuma/ui/theme'
import { PlatformDashboard } from '../fuma/dashboards/PlatformDashboard'

const EMPTY_ACCESSIBLE_CONTEXT_CATALOG: AccessibleContextCatalog = {
  organizations: [],
  workspaces: [],
  sites: [],
}
const EMPTY_PERMISSION_DECISIONS: readonly PermissionDecision[] = Object.freeze([])
const EMPTY_PERMISSION_STATE: NavigationPermissionState = Object.freeze({})
const ACCOUNT_PATH = '/admin/account'

export interface HostedStaffShellProps {
  session: HostedStaffSession
  /** The live in-house-router pathname. Route scope remains authoritative. */
  pathname?: string
  /**
   * FUMA-021 replaces this optional test/composition seam with trusted server
   * context. Values are checked against the TypeBox catalog contract here.
   */
  contextCatalog?: unknown
  /** Validated permission decisions for capability-owned editor surfaces. */
  permissionDecisions?: readonly PermissionDecision[]
  /** Validated permission lookup used by composed profile navigation. */
  permissionState?: NavigationPermissionState
  /** Optional product adapter for the selected hosted editor surface. */
  editorRenderAdapter?: HostedProfileEditorRenderAdapter
}

type CatalogValidation =
  | Readonly<{ kind: 'valid'; catalog: AccessibleContextCatalog }>
  | Readonly<{ kind: 'invalid' }>

function validateContextCatalog(value: unknown): CatalogValidation {
  if (value === undefined) {
    return { kind: 'valid', catalog: EMPTY_ACCESSIBLE_CONTEXT_CATALOG }
  }
  return Value.Check(AccessibleContextCatalogSchema, value)
    ? { kind: 'valid', catalog: value }
    : { kind: 'invalid' }
}

function internalSupportTarget(pathname: string, catalog: AccessibleContextCatalog): SupportClientTarget | null {
  const match = /^\/admin\/organizations\/([^/]+)\/workspaces\/([^/]+)\/sites\/([^/]+)\/internal\/support(?:\/.*)?$/.exec(pathname)
  if (!match) return null
  try {
    const target = { organizationId: decodeURIComponent(match[1]!), workspaceId: decodeURIComponent(match[2]!), siteId: decodeURIComponent(match[3]!) }
    const exact = catalog.sites.some((site) => site.id === target.siteId && site.organizationId === target.organizationId && site.workspaceId === target.workspaceId && site.status === 'active')
    return exact ? Object.freeze(target) : null
  } catch { return null }
}

function internalExpertTarget(pathname: string, catalog: AccessibleContextCatalog): SupportClientTarget | null {
  const match = /^\/admin\/organizations\/([^/]+)\/workspaces\/([^/]+)\/sites\/([^/]+)\/internal\/experts(?:\/.*)?$/.exec(pathname)
  if (!match) return null
  try {
    const target = { organizationId: decodeURIComponent(match[1]!), workspaceId: decodeURIComponent(match[2]!), siteId: decodeURIComponent(match[3]!) }
    return catalog.sites.some((site) => site.id === target.siteId && site.organizationId === target.organizationId && site.workspaceId === target.workspaceId && site.status === 'active') ? Object.freeze(target) : null
  } catch { return null }
}


function internalPaidHandoffTarget(pathname: string, catalog: AccessibleContextCatalog): SupportClientTarget | null {
  const match = /^\/admin\/organizations\/([^/]+)\/workspaces\/([^/]+)\/sites\/([^/]+)\/internal\/transfers(?:\/.*)?$/.exec(pathname)
  if (!match) return null
  try {
    const target = { organizationId: decodeURIComponent(match[1]!), workspaceId: decodeURIComponent(match[2]!), siteId: decodeURIComponent(match[3]!) }
    return catalog.sites.some((site) => site.id === target.siteId && site.organizationId === target.organizationId && site.workspaceId === target.workspaceId && site.status === 'active') ? Object.freeze(target) : null
  } catch { return null }
}

function internalCapabilityTarget(pathname: string, catalog: AccessibleContextCatalog): SupportClientTarget | null {
  const match = /^\/admin\/organizations\/([^/]+)\/workspaces\/([^/]+)\/sites\/([^/]+)\/internal\/ai-capabilities(?:\/.*)?$/.exec(pathname)
  if (!match) return null
  try {
    const target = {
      organizationId: decodeURIComponent(match[1]!),
      workspaceId: decodeURIComponent(match[2]!),
      siteId: decodeURIComponent(match[3]!),
    }
    return catalog.sites.some((site) => site.id === target.siteId
      && site.organizationId === target.organizationId
      && site.workspaceId === target.workspaceId
      && site.status === 'active')
      ? Object.freeze(target)
      : null
  } catch {
    return null
  }
}
/**
 * Profiles that ship a dedicated dashboard owning their own navigation.
 *
 * On their home route the generic scoped chrome is suppressed so the profile
 * dashboard is the entire page. Every other route keeps the shared chrome.
 */
const DEDICATED_DASHBOARD_PROFILES: ReadonlySet<string> = new Set(['website', 'publication'])

const SCOPED_PATTERN =
  /^\/admin\/organizations\/([^/]+)\/workspaces\/([^/]+)\/sites\/([^/]+)(\/.*)?$/

/**
 * Every route of a profile that ships a dedicated dashboard renders inside that
 * dashboard's shell, so one navigation and one design language cover the whole
 * profile instead of some routes falling back to generic chrome.
 */
function dedicatedDashboardLayout(
  pathname: string,
  catalog: AccessibleContextCatalog,
): 'panel' | 'bare' {
  const match = SCOPED_PATTERN.exec(pathname)
  if (!match) return 'panel'
  let siteId: string
  try {
    siteId = decodeURIComponent(match[3]!)
  } catch {
    return 'panel'
  }
  const site = catalog.sites.find((entry) => entry.id === siteId)
  return site && DEDICATED_DASHBOARD_PROFILES.has(site.profileId) ? 'bare' : 'panel'
}

export function HostedStaffShell({
  session,
  pathname = '/admin',
  contextCatalog,
  permissionDecisions = EMPTY_PERMISSION_DECISIONS,
  permissionState = EMPTY_PERMISSION_STATE,
  editorRenderAdapter,
}: HostedStaffShellProps) {
  const [currentSession, setCurrentSession] = useState(session)
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const catalogValidation = validateContextCatalog(contextCatalog)
  const supportTarget = catalogValidation.kind === 'valid'
    ? internalSupportTarget(pathname, catalogValidation.catalog)
    : null
  const expertTarget = catalogValidation.kind === 'valid'
    ? internalExpertTarget(pathname, catalogValidation.catalog)
    : null
  const paidHandoffTarget = catalogValidation.kind === 'valid'
    ? internalPaidHandoffTarget(pathname, catalogValidation.catalog)
    : null
  const capabilityTarget = catalogValidation.kind === 'valid'
    ? internalCapabilityTarget(pathname, catalogValidation.catalog)
    : null

  async function signOut(): Promise<void> {
    if (signingOut) return
    setSigningOut(true)
    setError(null)
    try {
      await logoutHostedStaff()
      window.location.assign('/admin/login')
    } catch (caught) {
      console.error('[hosted-staff-shell] sign out failed:', caught)
      setSigningOut(false)
      setError(getErrorMessage(caught, 'Could not sign out'))
    }
  }

  const needsOnboarding = catalogValidation.kind === 'valid'
    && catalogValidation.catalog.sites.length === 0
    && !currentSession.session.impersonatedBy
  const accountRoute = pathname === ACCOUNT_PATH || pathname.startsWith(`${ACCOUNT_PATH}/`)

  if (catalogValidation.kind !== 'valid') {
    return (
      <div className="grid h-full min-h-0 w-full max-w-full justify-items-center overflow-y-auto overflow-x-hidden overscroll-y-contain content-center p-4 sm:p-8">
        <section
          className="w-[min(100%,920px)] min-w-0 max-w-full rounded-2xl bg-card p-10"
          aria-labelledby="hosted-context-error-title"
          role="alert"
        >
          <h2 id="hosted-context-error-title" className="mb-8 text-3xl font-semibold text-foreground">
            Scoped context unavailable
          </h2>
          <p className="mb-3 text-sm text-muted-foreground leading-relaxed">
            The supplied accessible context catalog did not match its validated contract.
          </p>
        </section>
      </div>
    )
  }

  // A brand-new owner sees only onboarding. Identity, security, and staff
  // controls live on their own route so no unrelated surface competes with the
  // one action that must happen first.
  if (needsOnboarding && !accountRoute) {
    return (
      <div className="grid h-full min-h-0 w-full max-w-full justify-items-center overflow-y-auto overflow-x-hidden overscroll-y-contain content-center p-4 sm:p-8">
        <HostedSiteOnboarding catalog={catalogValidation.catalog} />
      </div>
    )
  }

  const identityBar = (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
      <div className="grid min-w-0 gap-1 [&_p]:m-0">
        <p className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Fuma staff</p>
        <p className="-mt-6 break-words text-sm text-muted-foreground">{currentSession.user.email}</p>
      </div>
      <div className="flex items-center gap-3">
        {!accountRoute && <a className="inline-flex min-h-8 items-center font-medium no-underline text-sm text-muted-foreground" href={ACCOUNT_PATH}>Account</a>}
        <Button
          variant="secondary"
          size="sm"
          disabled={signingOut}
          aria-busy={signingOut}
          onClick={() => void signOut()}
        >
          {signingOut ? 'Signing out' : 'Sign out'}
        </Button>
      </div>
    </div>
  )

  if (accountRoute) {
    return (
      <div className="grid h-full min-h-0 w-full max-w-full justify-items-center overflow-y-auto overflow-x-hidden overscroll-y-contain content-center p-4 sm:p-8">
        <section className="w-[min(100%,920px)] min-w-0 max-w-full rounded-2xl bg-card p-10" aria-labelledby="hosted-shell-title">
          {identityBar}
          <h1 id="hosted-shell-title" className="mb-8 text-3xl font-semibold text-foreground">Welcome, {currentSession.user.name}</h1>
          <p className="mb-3 text-sm text-muted-foreground leading-relaxed">
            Manage the security of your hosted staff identity and active devices.
          </p>
          {currentSession.session.impersonatedBy ? (
            <div className="grid gap-1 rounded-md border-2 border-amber-600 bg-amber-50 p-3 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100" role="alert">
              <strong>Support session active</strong>
              <span>Actions are performed as this account by {currentSession.session.impersonatedBy} and are audited.</span>
            </div>
          ) : null}
          {error && <p className="m-0 text-sm leading-snug text-destructive" role="alert">{error}</p>}
          <HostedStaffSecurity session={currentSession} onSessionChange={setCurrentSession} />
        </section>
      </div>
    )
  }

  if (supportTarget) {
    return (
      <div className="grid h-full min-h-0 w-full max-w-full justify-items-center overflow-y-auto overflow-x-hidden overscroll-y-contain content-center p-4 sm:p-8">
        <SupportOperationsRouteContent
          target={supportTarget}
          pathname={pathname}
          impersonatedBy={currentSession.session.impersonatedBy ?? null}
        />
      </div>
    )
  }
  if (expertTarget) {
    return (
      <div className="grid h-full min-h-0 w-full max-w-full justify-items-center overflow-y-auto overflow-x-hidden overscroll-y-contain content-center p-4 sm:p-8">
        <ExpertDiscoveryRouteContent target={expertTarget} />
      </div>
    )
  }
  if (paidHandoffTarget) {
    return (
      <div className="grid h-full min-h-0 w-full max-w-full justify-items-center overflow-y-auto overflow-x-hidden overscroll-y-contain content-center p-4 sm:p-8">
        <PaidHandoffRouteContent target={paidHandoffTarget} />
      </div>
    )
  }
  if (capabilityTarget) {
    return (
      <div className="grid h-full min-h-0 w-full max-w-full justify-items-center overflow-y-auto overflow-x-hidden overscroll-y-contain content-center p-4 sm:p-8">
        <PlatformCapabilityInventoryRouteContent
          target={capabilityTarget}
          impersonatedBy={currentSession.session.impersonatedBy ?? null}
        />
      </div>
    )
  }

  const dashboardLayout = dedicatedDashboardLayout(pathname, catalogValidation.catalog)
  const platformHome = pathname === '/admin' || pathname === '/admin/'

  if (platformHome) {
    return (
      <HostedThemeProvider>
        <PlatformDashboard
          catalog={catalogValidation.catalog}
          actorLabel={currentSession.user.name}
          accountPath={ACCOUNT_PATH}
          onSignOut={() => void signOut()}
          signingOut={signingOut}
          error={error}
        />
      </HostedThemeProvider>
    )
  }

  const scopedShell = (
    <>
      {error && <p className="m-0 text-sm leading-snug text-destructive" role="alert">{error}</p>}
      <FumaScopedShell
        registry={creditsAdminRegistry}
        catalog={catalogValidation.catalog}
        pathname={pathname}
        actorLabel={currentSession.user.name}
        permissionState={permissionState}
        layout={dashboardLayout}
      >
        {(shell) => {
          const routeContent = (
            <>
            <PublicationRouteContent shell={shell} permissionDecisions={permissionDecisions} />
            <CreditsLedgerRouteContent shell={shell} />
            <DomainsRouteContent shell={shell} permissionDecisions={permissionDecisions} />
            <WebsiteAnalyticsRouteContent shell={shell} permissionDecisions={permissionDecisions} />
            <OrganizationManagementRouteContent shell={shell} />
            <ComponentCatalogRouteContent shell={shell} permissionDecisions={permissionDecisions} />
            <McpScopedRouteContent shell={shell} permissionDecisions={permissionDecisions} />
            <QuotaSelfServiceRouteContent
              shell={shell}
              permissionDecisions={permissionDecisions}
              customerBilling={(
                <PlatformCheckoutRouteContent
                  shell={shell}
                  permissionDecisions={permissionDecisions}
                />
              )}
            />
            <CustomerCapabilityDashboardRouteContent shell={shell} />
            <BookingsRouteContent shell={shell} />
              <HostedProfileEditorSurface
                shell={shell}
                permissionDecisions={permissionDecisions}
                renderAdapter={editorRenderAdapter}
              />
            </>
          )
          if (isWebsiteDashboardRoute(shell)) {
            return (
              <WebsiteDashboardRoute
                shell={shell}
                catalog={catalogValidation.catalog}
                actorLabel={currentSession.user.name}
                accountPath={ACCOUNT_PATH}
                onSignOut={() => void signOut()}
                signingOut={signingOut}
              >
                {routeContent}
              </WebsiteDashboardRoute>
            )
          }
          if (isPublicationDashboardRoute(shell)) {
            return (
              <PublicationDashboardRoute
                shell={shell}
                actorLabel={currentSession.user.name}
                accountPath={ACCOUNT_PATH}
                onSignOut={() => void signOut()}
                signingOut={signingOut}
              >
                {routeContent}
              </PublicationDashboardRoute>
            )
          }
          return routeContent
        }}
      </FumaScopedShell>
    </>
  )

  // A dedicated dashboard owns the full viewport, so the shared panel wrapper
  // would box it inside the generic layout.
  return dashboardLayout === 'bare'
    ? <HostedThemeProvider>{scopedShell}</HostedThemeProvider>
    : <div className="grid h-full min-h-0 w-full max-w-full justify-items-center overflow-y-auto overflow-x-hidden overscroll-y-contain content-center p-4 sm:p-8">{scopedShell}</div>
}

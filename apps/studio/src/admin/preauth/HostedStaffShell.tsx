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
import { ComponentCatalogRouteContent } from '../fuma/components'
import { SupportOperationsRouteContent, type SupportClientTarget } from '../fuma/supportOperations'
import { ExpertDiscoveryRouteContent } from '../fuma/expertDiscovery'
import { PaidHandoffRouteContent } from '../fuma/paidHandoff'
import { CustomerCapabilityDashboardRouteContent, PlatformCapabilityInventoryRouteContent } from '../fuma/aiCapabilities'
import { BookingsRouteContent } from '../fuma/bookings'
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
import { Button } from '@ui/components/Button'
import panelStyles from '../AdminEntry.module.css'
import { HostedStaffSecurity } from './HostedStaffSecurity'
import styles from './HostedStaffShell.module.css'

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
      <div className={`${panelStyles.page} ${styles.page}`}>
        <section
          className={`${panelStyles.panel} ${styles.shell}`}
          aria-labelledby="hosted-context-error-title"
          role="alert"
        >
          <h2 id="hosted-context-error-title" className={panelStyles.title}>
            Scoped context unavailable
          </h2>
          <p className={styles.copy}>
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
      <div className={`${panelStyles.page} ${styles.page}`}>
        <HostedSiteOnboarding catalog={catalogValidation.catalog} />
      </div>
    )
  }

  const identityBar = (
    <div className={styles.identityBar}>
      <div className={styles.identityText}>
        <p className={styles.eyebrow}>Fuma staff</p>
        <p className={styles.identity}>{currentSession.user.email}</p>
      </div>
      <div className={styles.identityActions}>
        {!accountRoute && <a className={styles.accountLink} href={ACCOUNT_PATH}>Account</a>}
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
      <div className={`${panelStyles.page} ${styles.page}`}>
        <section className={`${panelStyles.panel} ${styles.shell}`} aria-labelledby="hosted-shell-title">
          {identityBar}
          <h1 id="hosted-shell-title" className={panelStyles.title}>Welcome, {currentSession.user.name}</h1>
          <p className={styles.copy}>
            Manage the security of your hosted staff identity and active devices.
          </p>
          {currentSession.session.impersonatedBy ? (
            <div className={styles.supportBanner} role="alert">
              <strong>Support session active</strong>
              <span>Actions are performed as this account by {currentSession.session.impersonatedBy} and are audited.</span>
            </div>
          ) : null}
          {error && <p className={panelStyles.error} role="alert">{error}</p>}
          <HostedStaffSecurity session={currentSession} onSessionChange={setCurrentSession} />
        </section>
      </div>
    )
  }

  if (supportTarget) {
    return (
      <div className={`${panelStyles.page} ${styles.page}`}>
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
      <div className={`${panelStyles.page} ${styles.page}`}>
        <ExpertDiscoveryRouteContent target={expertTarget} />
      </div>
    )
  }
  if (paidHandoffTarget) {
    return (
      <div className={`${panelStyles.page} ${styles.page}`}>
        <PaidHandoffRouteContent target={paidHandoffTarget} />
      </div>
    )
  }
  if (capabilityTarget) {
    return (
      <div className={`${panelStyles.page} ${styles.page}`}>
        <PlatformCapabilityInventoryRouteContent
          target={capabilityTarget}
          impersonatedBy={currentSession.session.impersonatedBy ?? null}
        />
      </div>
    )
  }

  return (
    <div className={`${panelStyles.page} ${styles.page}`}>
      {error && <p className={panelStyles.error} role="alert">{error}</p>}
      <FumaScopedShell
        registry={creditsAdminRegistry}
        catalog={catalogValidation.catalog}
        pathname={pathname}
        actorLabel={currentSession.user.name}
        permissionState={permissionState}
      >
        {(shell) => (
          <>
            <PublicationRouteContent shell={shell} permissionDecisions={permissionDecisions} />
            <CreditsLedgerRouteContent shell={shell} />
            <DomainsRouteContent shell={shell} permissionDecisions={permissionDecisions} />
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
        )}
      </FumaScopedShell>
    </div>
  )
}

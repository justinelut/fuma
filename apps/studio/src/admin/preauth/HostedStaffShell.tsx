import { useState } from 'react'
import { FumaScopedShell } from '../fuma/FumaScopedShell'
import { PublicationRouteContent } from '../fuma/publication'
import { PlatformCheckoutRouteContent } from '../fuma/billing'
import { QuotaSelfServiceRouteContent } from '../fuma/usage'
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

  return (
    <div className={panelStyles.page}>
      <section className={`${panelStyles.panel} ${styles.shell}`} aria-labelledby="hosted-shell-title">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Fuma staff</p>
            <h1 id="hosted-shell-title" className={panelStyles.title}>Welcome, {currentSession.user.name}</h1>
            <p className={styles.identity}>{currentSession.user.email}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={signingOut}
            aria-busy={signingOut}
            onClick={() => void signOut()}
          >
            {signingOut ? 'Signing out' : 'Sign out'}
          </Button>
        </header>
        <p className={styles.copy}>
          Manage the security of your hosted staff identity and active devices.
        </p>
        {error && <p className={panelStyles.error} role="alert">{error}</p>}
        <HostedStaffSecurity session={currentSession} onSessionChange={setCurrentSession} />
      </section>

      {catalogValidation.kind === 'valid' ? (
        <FumaScopedShell
          catalog={catalogValidation.catalog}
          pathname={pathname}
          actorLabel={currentSession.user.name}
          permissionState={permissionState}
        >
          {(shell) => (
            <>
              <PublicationRouteContent shell={shell} permissionDecisions={permissionDecisions} />
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
              <HostedProfileEditorSurface
                shell={shell}
                permissionDecisions={permissionDecisions}
                renderAdapter={editorRenderAdapter}
              />
            </>
          )}
        </FumaScopedShell>
      ) : (
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
      )}
    </div>
  )
}

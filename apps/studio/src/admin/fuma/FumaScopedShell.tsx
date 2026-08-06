import { useEffect, type ReactNode } from 'react'
import { Link } from '@admin/lib/routing'
import { FumaManagedClientsView } from './FumaManagedClientsView'
import { ProfileNavigation } from './ProfileNavigation'
import { ProfileOnboarding } from './ProfileOnboarding'
import {
  FumaContextSwitchers,
  type FumaContextSwitchHandler,
} from './FumaContextSwitchers'
import {
  readContextPreference,
  writeContextPreference,
  type ContextPreferenceStorage,
} from './contextPreference'
import {
  buildOrganizationSwitchTarget,
  buildScopedAdminUrl,
  buildSiteSwitchTarget,
  buildWorkspaceSwitchTarget,
  composeManagedClientsView,
  composeProfileNavigation,
  fumaLaunchRegistry,
  resolveProfileOnboarding,
  resolveProfileRouteAccess,
  resolveScopedAdminContext,
  validateProfileRelativeSubpath,
  type AccessibleContextCatalog,
  type CompleteProfileOnboardingStepCommand,
  type FumaRegistry,
  type ManagedClientsView,
  type NavigationPermissionState,
  type ProfileNavigationOutput,
  type ProfileOnboardingProgress,
  type ProfileOnboardingState,
  type ProfileRelativeSubpath,
  type ProfileRouteAccess,
  type ReadyScopedContextResolution,
  type ScopedContextResolution,
  type StableContextSelection,
} from '@core/fuma'
import { EmptyState } from '@ui/components/EmptyState'
import styles from './FumaScopedShell.module.css'

const EMPTY_PERMISSION_STATE: NavigationPermissionState = Object.freeze({})

type NonReadyResolution = Exclude<
  ScopedContextResolution,
  ReadyScopedContextResolution
>

export interface FumaScopedShellSwitcherModel {
  catalog: AccessibleContextCatalog
  selection: StableContextSelection
  profileRelativeSubpath: ProfileRelativeSubpath
  organizationTarget(organizationId: string): string | null
  workspaceTarget(organizationId: string, workspaceId: string): string | null
  siteTarget(selection: StableContextSelection): string
}

export type FumaScopedShellSwitcherSlot =
  | ReactNode
  | ((model: FumaScopedShellSwitcherModel) => ReactNode)

export type FumaScopedShellReadyContext = Readonly<{
  resolution: ReadyScopedContextResolution
  navigation: ProfileNavigationOutput
  permissionState: NavigationPermissionState
  profileRelativeSubpath: ProfileRelativeSubpath
  routeAccess: ProfileRouteAccess
  /** Composed setup state, so a profile dashboard shows real progress. */
  onboarding: ProfileOnboardingState
}>

export type FumaScopedShellChildren =
  | ReactNode
  | ((context: FumaScopedShellReadyContext) => ReactNode)

export interface FumaScopedShellProps {
  catalog: AccessibleContextCatalog
  pathname: string
  actorLabel: string
  permissionState?: NavigationPermissionState
  registry?: FumaRegistry
  onboardingProgress?: ProfileOnboardingProgress
  onCompleteOnboardingStep?: (
    command: CompleteProfileOnboardingStepCommand,
  ) => void
  switcherSlot?: FumaScopedShellSwitcherSlot
  onContextSwitch?: FumaContextSwitchHandler
  preferenceStorage?: ContextPreferenceStorage
  /**
   * `panel` keeps the generic scoped chrome. `bare` renders only the resolved
   * children, for profiles that ship a dedicated dashboard owning its own
   * navigation and layout.
   */
  layout?: 'panel' | 'bare'
  children?: FumaScopedShellChildren
}

type ReadyShellModel = Readonly<{
  kind: 'ready'
  resolution: ReadyScopedContextResolution
  navigation: ProfileNavigationOutput
  onboarding: ProfileOnboardingState
  managedClients: ManagedClientsView
  currentNavigationPath: string
  routeAccess: ProfileRouteAccess
}>

type StateShellModel = Readonly<{
  kind: 'state'
  resolution: NonReadyResolution
}>

type ErrorShellModel = Readonly<{
  kind: 'error'
}>

type ShellModel = ReadyShellModel | StateShellModel | ErrorShellModel

function scopedNavigation(
  resolution: ReadyScopedContextResolution,
  navigation: ProfileNavigationOutput,
): ProfileNavigationOutput {
  return Object.freeze(navigation.map((entry) => {
    const relativePath = validateProfileRelativeSubpath(entry.path)
    if (relativePath === null) {
      throw new Error(
        `Profile navigation path "${entry.path}" is outside the scoped admin shell`,
      )
    }
    return Object.freeze({
      ...entry,
      path: buildScopedAdminUrl(resolution.selection, relativePath),
    })
  }))
}

function resolveShellModel(
  catalog: AccessibleContextCatalog,
  pathname: string,
  permissionState: NavigationPermissionState,
  registry: FumaRegistry,
  onboardingProgress: ProfileOnboardingProgress | undefined,
  preferenceStorage: ContextPreferenceStorage | undefined,
): ShellModel {
  try {
    const resolution = resolveScopedAdminContext({
      url: pathname,
      catalog,
      browserPreference: readContextPreference(preferenceStorage),
    }, registry)

    if (resolution.kind !== 'ready') {
      return { kind: 'state', resolution }
    }

    const navigation = composeProfileNavigation({
      profileId: resolution.site.profileId,
      capabilityOverrides: resolution.site.capabilityOverrides,
      permissionState,
    }, registry)
    const onboarding = resolveProfileOnboarding(registry, {
      ...resolution.selection,
      profileId: resolution.site.profileId,
      capabilityOverrides: resolution.site.capabilityOverrides,
    }, onboardingProgress)

    return {
      kind: 'ready',
      resolution,
      navigation: scopedNavigation(resolution, navigation),
      onboarding,
      managedClients: composeManagedClientsView(catalog),
      currentNavigationPath: buildScopedAdminUrl(
        resolution.selection,
        resolution.profileRelativeSubpath,
      ),
      routeAccess: resolveProfileRouteAccess({
        profileId: resolution.site.profileId,
        capabilityOverrides: resolution.site.capabilityOverrides,
        permissionState,
        method: 'GET',
        path: resolution.profileRelativeSubpath,
      }, registry),
    }
  } catch (_error) {
    // Invalid injected contracts are presented as shell state, not a crashed route.
    return { kind: 'error' }
  }
}

function statePanelContent(resolution: NonReadyResolution): {
  title: string
  description: string
  role: 'alert' | 'status'
} {
  switch (resolution.kind) {
    case 'missing':
      if (resolution.scope === 'workspace') {
        return {
          title: 'Workspace not found',
          description: 'This workspace is not present in the accessible context catalog.',
          role: 'alert',
        }
      }
      if (resolution.scope === 'site') {
        return {
          title: 'Site not found',
          description: 'This site is not present in the accessible context catalog.',
          role: 'alert',
        }
      }
      return {
        title: 'No scoped context is available',
        description: 'Choose an accessible organization, workspace, and site before continuing.',
        role: 'status',
      }
    case 'unauthorized':
      return {
        title: `${resolution.scope[0].toUpperCase()}${resolution.scope.slice(1)} access unavailable`,
        description: 'The requested scope is not in this session’s accessible catalog. No substitute context was opened.',
        role: 'alert',
      }
    case 'organization-suspended':
      return {
        title: 'Organization suspended',
        description: `${resolution.organization.name} is suspended, so its workspaces and sites are unavailable.`,
        role: 'alert',
      }
    case 'workspace-archived':
      return {
        title: 'Workspace archived',
        description: `${resolution.workspace.name} is archived and cannot open its site shell.`,
        role: 'alert',
      }
    case 'site-archived':
      return {
        title: 'Site archived',
        description: `${resolution.site.name} is archived and cannot open its profile shell.`,
        role: 'alert',
      }
    case 'invitation':
      return {
        title: 'Invitation entry',
        description: 'Review this invitation through the hosted invitation flow before selecting a site context.',
        role: 'status',
      }
  }
}

function StatePanel({ resolution }: { resolution: NonReadyResolution }) {
  const content = statePanelContent(resolution)
  return (
    <div
      className={styles.statePanel}
      data-resolution-kind={resolution.kind}
    >
      <EmptyState
        variant="centered"
        size="large"
        title={content.title}
        description={content.description}
        role={content.role}
      >
        {resolution.kind === 'invitation' ? (
          <code className={styles.invitationId}>
            {resolution.invitation.invitationId}
          </code>
        ) : null}
      </EmptyState>
    </div>
  )
}

function switcherModel(
  catalog: AccessibleContextCatalog,
  resolution: ReadyScopedContextResolution,
): FumaScopedShellSwitcherModel {
  const profileRelativeSubpath = resolution.profileRelativeSubpath
  return {
    catalog,
    selection: resolution.selection,
    profileRelativeSubpath,
    organizationTarget: (organizationId) => buildOrganizationSwitchTarget(
      catalog,
      organizationId,
      profileRelativeSubpath,
    ),
    workspaceTarget: (organizationId, workspaceId) => buildWorkspaceSwitchTarget(
      catalog,
      organizationId,
      workspaceId,
      profileRelativeSubpath,
    ),
    siteTarget: (selection) => buildSiteSwitchTarget(
      selection,
      profileRelativeSubpath,
    ),
  }
}

export function FumaScopedShell({
  catalog,
  pathname,
  actorLabel,
  permissionState = EMPTY_PERMISSION_STATE,
  registry = fumaLaunchRegistry,
  onboardingProgress,
  onCompleteOnboardingStep,
  switcherSlot,
  onContextSwitch,
  preferenceStorage,
  layout = 'panel',
  children,
}: FumaScopedShellProps) {
  const readyPermissionState = Object.freeze({ ...permissionState })
  const model = resolveShellModel(
    catalog,
    pathname,
    readyPermissionState,
    registry,
    onboardingProgress,
    preferenceStorage,
  )
  const readySelection = model.kind === 'ready'
    ? model.resolution.selection
    : null
  const organizationId = readySelection?.organizationId
  const workspaceId = readySelection?.workspaceId
  const siteId = readySelection?.siteId

  useEffect(() => {
    if (!organizationId || !workspaceId || !siteId) return
    writeContextPreference({ organizationId, workspaceId, siteId }, preferenceStorage)
  }, [organizationId, preferenceStorage, siteId, workspaceId])

  if (model.kind === 'error') {
    return (
      <section className={styles.shell} aria-label="Fuma scoped admin shell">
        <header className={styles.sessionBar}>
          <span className={styles.sessionLabel}>Current session</span>
          <strong className={styles.actorLabel}>{actorLabel}</strong>
        </header>
        <div className={styles.statePanel} data-resolution-kind="error">
          <EmptyState
            variant="centered"
            size="large"
            title="Scoped context unavailable"
            description="The supplied context could not be validated or composed."
            role="alert"
          />
        </div>
      </section>
    )
  }

  if (model.kind === 'state') {
    return (
      <section className={styles.shell} aria-label="Fuma scoped admin shell">
        <header className={styles.sessionBar}>
          <span className={styles.sessionLabel}>Current session</span>
          <strong className={styles.actorLabel}>{actorLabel}</strong>
        </header>
        <StatePanel resolution={model.resolution} />
      </section>
    )
  }

  const { resolution } = model
  const profile = resolution.profile.profile
  const managedClientsPath = buildScopedAdminUrl(
    resolution.selection,
    '/admin/managed-clients',
  )
  const showingManagedClients = resolution.profileRelativeSubpath === '/admin/managed-clients'
  const readyContext: FumaScopedShellReadyContext = Object.freeze({
    resolution,
    navigation: model.navigation,
    permissionState: readyPermissionState,
    profileRelativeSubpath: resolution.profileRelativeSubpath,
    routeAccess: model.routeAccess,
    onboarding: model.onboarding,
  })
  const renderedChildren = showingManagedClients || model.routeAccess.kind === 'denied'
    ? null
    : typeof children === 'function'
      ? children(readyContext)
      : children
  const renderedSwitcher = switcherSlot === undefined
    ? (
        <FumaContextSwitchers
          context={resolution}
          catalog={catalog}
          onSwitch={onContextSwitch}
        />
      )
    : typeof switcherSlot === 'function'
      ? switcherSlot(switcherModel(catalog, resolution))
      : switcherSlot

  // A dedicated profile dashboard supplies its own navigation, header and
  // setup surface, so the generic chrome would duplicate all three.
  if (layout === 'bare') {
    return (
      <section
        aria-label="Fuma scoped admin shell"
        data-resolution-kind="ready"
        data-profile-id={profile.id}
      >
        {renderedChildren}
      </section>
    )
  }

  return (
    <section
      className={styles.shell}
      aria-label="Fuma scoped admin shell"
      data-resolution-kind="ready"
      data-profile-id={profile.id}
    >
      <a className={styles.skipLink} href="#fuma-scoped-main">Skip to workspace</a>
      <header className={styles.header}>
        <div className={styles.contextHeading}>
          <p className={styles.profileLabel}>{profile.label} profile</p>
          <h1 className={styles.siteName}>{resolution.site.name}</h1>
          {profile.subtitle ? (
            <p className={styles.profileSubtitle}>{profile.subtitle}</p>
          ) : null}
          <p className={styles.contextPath}>
            {resolution.organization.name} / {resolution.workspace.name}
          </p>
        </div>
        <div className={styles.sessionBlock}>
          <span className={styles.sessionLabel}>Current session</span>
          <strong className={styles.actorLabel}>{actorLabel}</strong>
          {model.managedClients.entries.length > 0 ? (
            <Link
              className={styles.managedClientsLink}
              to={managedClientsPath}
              aria-current={showingManagedClients ? 'page' : undefined}
            >
              Managed clients
            </Link>
          ) : null}
        </div>
        {renderedSwitcher ? (
          <div className={styles.switcherSlot} aria-label="Context switchers">
            {renderedSwitcher}
          </div>
        ) : null}
      </header>

      <div className={styles.body}>
        <aside className={styles.navigation}>
          <ProfileNavigation
            entries={model.navigation}
            currentPath={model.currentNavigationPath}
            ariaLabel={`${profile.label} navigation`}
          />
        </aside>
        <main id="fuma-scoped-main" className={styles.main} tabIndex={-1}>
          {showingManagedClients ? (
            <FumaManagedClientsView model={model.managedClients} />
          ) : model.routeAccess.kind === 'denied' ? (
            <div className={styles.routeDenied} data-route-access={model.routeAccess.reason}>
              <EmptyState
                variant="centered"
                size="large"
                title="Route access unavailable"
                description={model.routeAccess.reason === 'capability-disabled'
                  ? 'This route is not available for the site’s active capabilities.'
                  : 'Your current permission set does not allow this route.'}
                role="alert"
              />
            </div>
          ) : (
            // One route renders one page. Setup guidance is a page of its own
            // rather than a panel appended beneath whatever else is open.
            resolution.profileRelativeSubpath === '/admin/setup' ? (
              <ProfileOnboarding
                state={model.onboarding}
                onCompleteStep={onCompleteOnboardingStep}
                ariaLabel={`${profile.label} onboarding`}
              />
            ) : (
              <div className={styles.routeContent}>{renderedChildren}</div>
            )
          )}
        </main>
      </div>
    </section>
  )
}

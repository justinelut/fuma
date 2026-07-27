import { Fragment } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { FumaScopedShell } from '@admin/fuma/FumaScopedShell'
import { HostedProfileEditorSurface } from '@admin/fuma/profileEditor/HostedProfileEditorSurface'
import { MemoryRouter, useLocation } from '@admin/lib/routing'
import {
  fumaLaunchRegistry,
  type NavigationPermissionState,
  type PermissionDecision,
} from '@core/fuma'
import type {
  FixtureCatalog,
  FumaContextHarnessInput,
} from './fumaContextHarnessContract'

let mountedRoot: Root | null = null

function personaAccess(
  persona: 'editor' | 'viewer' | undefined,
  deniedPermissions: readonly string[],
): Readonly<{
  permissionState?: NavigationPermissionState
  permissionDecisions?: readonly PermissionDecision[]
}> {
  if (!persona) return {}
  const denied = new Set(deniedPermissions)
  const editorMutations = new Set(['content.pages.write', 'publication.posts.write'])
  const permissions = fumaLaunchRegistry.compose('publication').permissions
  const permissionState = Object.freeze(Object.fromEntries(permissions.map(({ id }) => [
    id,
    !denied.has(id) && (
      (!id.endsWith('.write') && !id.endsWith('.send') && !id.endsWith('.schedule'))
      || (persona === 'editor' && editorMutations.has(id))
    ),
  ])))
  const permissionDecisions = Object.freeze(permissions.map(({ id }): PermissionDecision => ({
    permissionId: id,
    scope: {
      kind: 'site',
      platformId: 'platform-fixture',
      organizationId: 'organization-a',
      workspaceId: 'shared-workspace',
      siteId: 'shared-publication',
    },
    decision: permissionState[id] ? 'allow' : 'deny',
    precedence: 'launch-persona',
    source: {
      kind: 'launch-persona-assignment',
      assignmentId: `${persona}-fixture`,
      persona: persona === 'editor' ? 'member' : 'viewer',
    },
  })))
  return { permissionState, permissionDecisions }
}

export function ContextHarness({
  catalog,
  persona,
  deniedPermissions = [],
}: {
  catalog: FixtureCatalog
  persona?: 'editor' | 'viewer'
  deniedPermissions?: readonly string[]
}) {
  const { pathname } = useLocation()
  const access = personaAccess(persona, deniedPermissions)

  return (
    <Fragment>
      <output data-testid="route-pathname">{pathname}</output>
      <FumaScopedShell
        catalog={catalog}
        pathname={pathname}
        actorLabel={persona === 'viewer' ? 'Vera Viewer' : 'Eden Editor'}
        permissionState={access.permissionState}
      >
        {(shell) => (
          <>
            <output data-testid="publication-route-content">{shell.profileRelativeSubpath}</output>
            {access.permissionDecisions ? (
              <HostedProfileEditorSurface
                shell={shell}
                permissionDecisions={access.permissionDecisions}
                renderAdapter={({ surface }) => (
                  <output data-testid="publication-editor-surface">{surface.id}</output>
                )}
              />
            ) : null}
          </>
        )}
      </FumaScopedShell>
    </Fragment>
  )
}

window.mountFumaContextHarness = ({
  pathname,
  contextCatalog,
  preference,
  preferenceKey,
  persona,
  deniedPermissions,
}: FumaContextHarnessInput) => {
  if (preference !== undefined) {
    if (preference === null) {
      localStorage.removeItem(preferenceKey)
    } else {
      localStorage.setItem(preferenceKey, JSON.stringify(preference))
    }
  }

  mountedRoot?.unmount()
  document.body.replaceChildren()

  const rootElement = document.createElement('div')
  rootElement.id = 'fuma-e2e-root'
  document.body.append(rootElement)

  mountedRoot = createRoot(rootElement)
  mountedRoot.render(
    <MemoryRouter initialEntries={[pathname]}>
      <ContextHarness
        catalog={contextCatalog}
        persona={persona}
        deniedPermissions={deniedPermissions}
      />
    </MemoryRouter>,
  )
}

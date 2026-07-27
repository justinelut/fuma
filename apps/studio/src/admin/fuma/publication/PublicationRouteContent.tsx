import { useMemo, type ReactNode } from 'react'
import type { PermissionDecision } from '@core/fuma'
import type { FumaScopedShellReadyContext } from '../FumaScopedShell'
import { PublicationHttpClient } from './client'
import { PublicationWorkspace, type PublicationSurface } from './PublicationWorkspace'

type PublicationRouteDefinition = Readonly<{
  surface: PublicationSurface
  capabilityId: string
  writePermission: string | null
}>

const PUBLICATION_ROUTE_BY_ID: Readonly<Record<string, PublicationRouteDefinition>> = Object.freeze({
  'route.posts.list': {
    surface: 'posts',
    capabilityId: 'publication.editorial',
    writePermission: 'publication.posts.write',
  },
  'route.tags': {
    surface: 'tags',
    capabilityId: 'publication.tags',
    writePermission: 'publication.tags.write',
  },
  'route.members': {
    surface: 'members',
    capabilityId: 'publication.members',
    writePermission: 'publication.members.write',
  },
  'route.newsletters': {
    surface: 'newsletters',
    capabilityId: 'publication.newsletters',
    writePermission: 'publication.newsletters.write',
  },
  'route.publication-analytics': {
    surface: 'analytics',
    capabilityId: 'publication.analytics',
    writePermission: null,
  },
  'route.design': {
    surface: 'design',
    capabilityId: 'website.design',
    writePermission: 'website.design.write',
  },
  'route.settings': {
    surface: 'settings',
    capabilityId: 'publication.editorial',
    writePermission: 'site.settings.write',
  },
})

type SiteSelection = FumaScopedShellReadyContext['resolution']['selection']

function allows(
  decisions: readonly PermissionDecision[],
  permissionId: string | null,
  selection: SiteSelection,
): boolean {
  if (permissionId === null) return false
  return decisions.some((decision) => (
    decision.permissionId === permissionId
    && decision.decision === 'allow'
    && decision.scope.kind === 'site'
    && decision.scope.organizationId === selection.organizationId
    && decision.scope.workspaceId === selection.workspaceId
    && decision.scope.siteId === selection.siteId
  ))
}

/** Selects Publication content from active route/capability contributions, never from profile identity. */
export function PublicationRouteContent({ shell, permissionDecisions }: Readonly<{
  shell: FumaScopedShellReadyContext
  permissionDecisions: readonly PermissionDecision[]
}>): ReactNode {
  const {organizationId,workspaceId,siteId}=shell.resolution.selection
  const profileId = shell.resolution.site.profileId
  const client = useMemo(() => new PublicationHttpClient({ organizationId,workspaceId,siteId,profileId }), [organizationId,workspaceId,siteId,profileId])
  if (shell.routeAccess.kind !== 'allowed') return null
  const definition = PUBLICATION_ROUTE_BY_ID[shell.routeAccess.route.id]
  if (!definition || !shell.resolution.profile.capabilities.some(({ id }) => id === definition.capabilityId)) {
    return null
  }

  return (
    <div data-testid="publication-route-content">
      <PublicationWorkspace
        surface={definition.surface}
        client={client}
        canWrite={allows(permissionDecisions, definition.writePermission, shell.resolution.selection)}
        canWorkflowRead={allows(permissionDecisions, 'publication.workflow.read', shell.resolution.selection)}
        canWorkflowAssign={allows(permissionDecisions, 'publication.workflow.assign', shell.resolution.selection)}
        canWorkflowReview={allows(permissionDecisions, 'publication.workflow.review', shell.resolution.selection)}
        canWorkflowApprove={allows(permissionDecisions, 'publication.workflow.approve', shell.resolution.selection)}
        canSend={allows(
          permissionDecisions,
          'publication.newsletters.send',
          shell.resolution.selection,
        )}
      />
    </div>
  )
}

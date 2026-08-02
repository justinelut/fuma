import { createRoot } from 'react-dom/client'
import { ComponentCatalogRouteContent } from '@admin/fuma/components'
import type { FumaScopedShellReadyContext } from '@admin/fuma/FumaScopedShell'
import type { PermissionDecision } from '@core/fuma'

const shell = {
  resolution: { selection: { organizationId: 'organization-browser', workspaceId: 'workspace-browser', siteId: 'site-browser' } },
  profileRelativeSubpath: '/admin/design',
  routeAccess: { kind: 'allowed', route: { id: 'route.design' } },
} as unknown as FumaScopedShellReadyContext

const permissions = [{ permissionId: 'website.design.write', decision: 'allow' }] as unknown as readonly PermissionDecision[]

createRoot(document.getElementById('root')!).render(
  <ComponentCatalogRouteContent shell={shell} permissionDecisions={permissions} />,
)

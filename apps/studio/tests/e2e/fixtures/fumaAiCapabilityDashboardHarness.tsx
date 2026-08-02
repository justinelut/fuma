import { createRoot } from 'react-dom/client'
import {
  CustomerCapabilityDashboardRouteContent,
  PlatformCapabilityInventoryRouteContent,
} from '@admin/fuma/aiCapabilities'
import type { FumaScopedShellReadyContext } from '@admin/fuma/FumaScopedShell'

const target = {
  organizationId: 'organization-browser',
  workspaceId: 'workspace-browser',
  siteId: 'site-browser',
}
const shell = {
  resolution: { selection: target },
  profileRelativeSubpath: '/admin/settings/capabilities',
  routeAccess: { kind: 'allowed', route: { id: 'route.settings' } },
} as FumaScopedShellReadyContext

createRoot(document.getElementById('root')!).render(
  <main style={{ display: 'grid', gap: '2rem', margin: '0 auto', maxWidth: '1180px', padding: '1rem' }}>
    <CustomerCapabilityDashboardRouteContent shell={shell} />
    <PlatformCapabilityInventoryRouteContent target={target} impersonatedBy={null} />
    <PlatformCapabilityInventoryRouteContent target={target} impersonatedBy="support-browser" />
  </main>,
)

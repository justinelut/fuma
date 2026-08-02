import { createRoot } from 'react-dom/client'
import { ExpertDiscoveryRouteContent } from '@admin/fuma/expertDiscovery'

createRoot(document.getElementById('root')!).render(
  <ExpertDiscoveryRouteContent
    target={{
      organizationId: 'organization-browser',
      workspaceId: 'workspace-browser',
      siteId: 'site-browser',
    }}
  />,
)

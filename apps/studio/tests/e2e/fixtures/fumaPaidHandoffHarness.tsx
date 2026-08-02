import { createRoot } from 'react-dom/client'
import { PaidHandoffRouteContent } from '@admin/fuma/paidHandoff'
createRoot(document.getElementById('root')!).render(<PaidHandoffRouteContent target={{ organizationId: 'organization-source', workspaceId: 'workspace-source', siteId: 'site-ke' }} />)

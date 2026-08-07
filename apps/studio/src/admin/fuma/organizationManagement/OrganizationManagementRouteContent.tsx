import { useMemo } from 'react'
import { useNavigate } from '@admin/lib/routing'
import type { FumaScopedShellReadyContext } from '../FumaScopedShell'
import { OrganizationManagementClient } from './client'
import { OrganizationManagement } from './OrganizationManagement'
import { CreateOrganization } from './CreateOrganization'

/**
 * Where a newly created organization sends the user.
 *
 * THE PLATFORM ENTRY, not a scoped URL. A brand-new organization has no workspace and no site — the
 * creation lifecycle adds Fuma's profile, limits and placement and nothing else — so there is no
 * scoped address to navigate to, and constructing one would land on a route that cannot resolve its
 * own context. The platform entry re-reads the accessible catalog, so the new organization is present
 * and onboarding takes it from there.
 */
export const POST_CREATE_DESTINATION = '/admin'

export function OrganizationManagementRouteContent({ shell }: { shell: FumaScopedShellReadyContext }) {
  const organizationId = shell.resolution.selection.organizationId
  const client = useMemo(() => new OrganizationManagementClient(organizationId), [organizationId])
  const navigate = useNavigate()

  if (shell.routeAccess.kind !== 'allowed' || shell.routeAccess.route.id !== 'route.organization-management') {
    return null
  }

  return (
    <div data-testid="organization-management-route">
      <OrganizationManagement client={client} />
      {/*
        Creation lives beside management rather than inside it: this page is scoped to ONE
        organization, and everything above edits that one. Creating a different organization is a
        separate act with a different outcome, so mixing it into the same panel would invite reading a
        rename as a creation.
      */}
      <CreateOrganization
        client={client}
        onCreated={() => { navigate(POST_CREATE_DESTINATION) }}
      />
    </div>
  )
}

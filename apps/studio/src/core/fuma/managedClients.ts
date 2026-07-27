import type {
  ManagedClientsView,
  ManagedClientSiteView,
} from './managedClientContracts'
import {
  assertAccessibleContextCatalog,
  buildScopedAdminUrl,
  type AccessibleContextCatalog,
} from './selection'

function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) immutable(nested)
    Object.freeze(value)
  }
  return value
}

/** Projects authorized internal managed workspaces without exposing commercial authority. */
export function composeManagedClientsView(
  catalog: AccessibleContextCatalog,
): ManagedClientsView {
  assertAccessibleContextCatalog(catalog)

  const entries = (catalog.managedClients ?? []).map((managedClient) => {
    const organization = catalog.organizations.find(({ id }) => (
      id === managedClient.organizationId
    ))
    const workspace = catalog.workspaces.find((entry) => (
      entry.organizationId === managedClient.organizationId
      && entry.id === managedClient.workspaceId
    ))
    if (!organization || !workspace) {
      throw new Error('Validated managed-client workspace ownership is unavailable')
    }

    const sites = catalog.sites
      .filter((site) => (
        site.organizationId === managedClient.organizationId
        && site.workspaceId === managedClient.workspaceId
      ))
      .toSorted((left, right) => (
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
      ))
      .map((site): ManagedClientSiteView => {
        const selection = {
          organizationId: site.organizationId,
          workspaceId: site.workspaceId,
          siteId: site.id,
        }
        const available = organization.status === 'active'
          && workspace.status === 'active'
          && site.status === 'active'
        return {
          selection,
          name: site.name,
          status: site.status,
          profileId: site.profileId,
          target: available ? buildScopedAdminUrl(selection) : null,
        }
      })

    return {
      organizationId: organization.id,
      organizationName: organization.name,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceStatus: workspace.status,
      intendedOrganizationId: managedClient.intendedOrganizationId,
      intendedOrganizationName: managedClient.intendedOrganizationName,
      sites,
    }
  }).toSorted((left, right) => (
    left.intendedOrganizationName.localeCompare(right.intendedOrganizationName)
    || left.workspaceName.localeCompare(right.workspaceName)
    || left.workspaceId.localeCompare(right.workspaceId)
  ))

  return immutable({ entries })
}

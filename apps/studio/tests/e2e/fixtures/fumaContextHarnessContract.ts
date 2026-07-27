export type FixtureCatalog = {
  organizations: Array<{
    id: string
    name: string
    status: 'active' | 'suspended'
  }>
  workspaces: Array<{
    id: string
    organizationId: string
    name: string
    status: 'active' | 'archived'
    isDefault: boolean
  }>
  managedClients?: Array<{
    organizationId: string
    workspaceId: string
    intendedOrganizationId: string
    intendedOrganizationName: string
  }>
  sites: Array<{
    id: string
    organizationId: string
    workspaceId: string
    name: string
    status: 'active' | 'archived'
    profileId: string
    capabilityOverrides: { grant: string[]; revoke: string[] }
  }>
}

export type FumaContextHarnessInput = {
  pathname: string
  contextCatalog: FixtureCatalog
  preference?: unknown
  preferenceKey: string
  persona?: 'editor' | 'viewer'
  deniedPermissions?: string[]
}

declare global {
  interface Window {
    mountFumaContextHarness(input: FumaContextHarnessInput): void
  }
}

export const WORKSPACE_AUTHORITY_TABLES = Object.freeze({
  organization: 'auth_organizations',
  user: 'auth_users',
})

export const WORKSPACE_TABLE_NAMES = Object.freeze({
  workspace: 'fuma_workspaces',
  membershipOverride: 'fuma_workspace_membership_overrides',
})

export const WORKSPACE_STATUSES = Object.freeze(['active', 'archived'] as const)
export const WORKSPACE_MEMBERSHIP_ACCESS_MODES = Object.freeze([
  'inherit',
  'grant',
  'deny',
] as const)
export const WORKSPACE_ROLES = Object.freeze([
  'owner',
  'admin',
  'editor',
  'viewer',
] as const)

export const HOSTED_WORKSPACE_SCHEMA_MANIFEST = Object.freeze({
  migrationId: '000005_workspaces',
  authorityTables: WORKSPACE_AUTHORITY_TABLES,
  tables: WORKSPACE_TABLE_NAMES,
  statuses: WORKSPACE_STATUSES,
  membershipAccessModes: WORKSPACE_MEMBERSHIP_ACCESS_MODES,
  roles: WORKSPACE_ROLES,
})

export const SITE_AUTHORITY_TABLES = Object.freeze({
  organization: 'auth_organizations',
  workspace: 'fuma_workspaces',
})

export const SITE_TABLE_NAMES = Object.freeze({
  site: 'fuma_sites',
})

export const SITE_STATUSES = Object.freeze(['active', 'archived'] as const)
export const SITE_PROFILE_COLUMNS = Object.freeze({
  profileId: 'profile_id',
  capabilityOverrides: 'capability_overrides_json',
})
export const SITE_CAPABILITY_OVERRIDE_KEYS = Object.freeze(['grant', 'revoke'] as const)
export const SITE_RESERVED_SLUGS = Object.freeze([
  'admin',
  'api',
  'assets',
  'health',
  'instatic',
  'uploads',
] as const)

export const HOSTED_SITE_SCHEMA_MANIFEST = Object.freeze({
  migrationId: '000006_sites',
  authorityTables: SITE_AUTHORITY_TABLES,
  tables: SITE_TABLE_NAMES,
  statuses: SITE_STATUSES,
  profileColumns: SITE_PROFILE_COLUMNS,
  capabilityOverrideKeys: SITE_CAPABILITY_OVERRIDE_KEYS,
  reservedSlugs: SITE_RESERVED_SLUGS,
})

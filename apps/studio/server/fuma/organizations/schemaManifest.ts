export const ORGANIZATION_AUTHORITY_TABLES = Object.freeze({
  identity: 'auth_organizations',
  membership: 'auth_members',
  invitation: 'auth_invitations',
})

export const ORGANIZATION_TABLE_NAMES = Object.freeze({
  profile: 'fuma_organization_profiles',
  limits: 'fuma_organization_limits',
  placement: 'fuma_organization_placements',
  bootstrapReceipt: 'fuma_organization_bootstrap_receipts',
})

export const ORGANIZATION_KINDS = Object.freeze(['platform', 'customer'] as const)
export const ORGANIZATION_STATUSES = Object.freeze(['active', 'suspended', 'archived'] as const)
export const ORGANIZATION_PLACEMENT_CLASSES = Object.freeze(['shared', 'dedicated'] as const)

export const HOSTED_ORGANIZATION_SCHEMA_MANIFEST = Object.freeze({
  migrationId: '000004_organizations',
  authorityTables: ORGANIZATION_AUTHORITY_TABLES,
  tables: ORGANIZATION_TABLE_NAMES,
  kinds: ORGANIZATION_KINDS,
  statuses: ORGANIZATION_STATUSES,
  placementClasses: ORGANIZATION_PLACEMENT_CLASSES,
})

export const AUDIT_AUTHORITY_TABLES = Object.freeze({
  organization: 'auth_organizations',
  user: 'auth_users',
  workspace: 'fuma_workspaces',
  site: 'fuma_sites',
  job: 'fuma_jobs',
})

export const AUDIT_TABLE_NAMES = Object.freeze({
  history: 'fuma_audit_history',
})

export const AUDIT_SCOPE_KINDS = Object.freeze([
  'platform',
  'organization',
  'workspace',
  'site',
] as const)

export const AUDIT_ACTOR_KINDS = Object.freeze([
  'staff',
  'internal-job',
] as const)

export const AUDIT_OUTCOMES = Object.freeze([
  'success',
  'failure',
  'denied',
] as const)

export const AUDIT_HISTORY_INDEX_NAMES = Object.freeze({
  platformRecency: 'fuma_audit_history_platform_recency_idx',
  organizationRecency: 'fuma_audit_history_organization_recency_idx',
  workspaceRecency: 'fuma_audit_history_workspace_recency_idx',
  siteRecency: 'fuma_audit_history_site_recency_idx',
  requestCorrelation: 'fuma_audit_history_request_correlation_idx',
  originatingRequestCorrelation: 'fuma_audit_history_originating_request_correlation_idx',
  jobCorrelation: 'fuma_audit_history_job_correlation_idx',
})

export const AUDIT_HISTORY_APPEND_ONLY_POLICY = Object.freeze({
  allowedWriteOperations: Object.freeze(['insert'] as const),
  immutableFunction: 'fuma_audit_history_reject_mutation',
  updateTrigger: 'fuma_audit_history_reject_update',
  deleteTrigger: 'fuma_audit_history_reject_delete',
})

export const AUDIT_HISTORY_METADATA_POLICY = Object.freeze({
  column: 'metadata_json',
  storage: 'jsonb-object',
  content: 'redacted-only',
} as const)

export const HOSTED_AUDIT_SCHEMA_MANIFEST = Object.freeze({
  migrationId: '000007_audit_history',
  authorityTables: AUDIT_AUTHORITY_TABLES,
  tables: AUDIT_TABLE_NAMES,
  scopeKinds: AUDIT_SCOPE_KINDS,
  actorKinds: AUDIT_ACTOR_KINDS,
  outcomes: AUDIT_OUTCOMES,
  indexes: AUDIT_HISTORY_INDEX_NAMES,
  appendOnly: AUDIT_HISTORY_APPEND_ONLY_POLICY,
  metadata: AUDIT_HISTORY_METADATA_POLICY,
})

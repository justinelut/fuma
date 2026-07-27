export const TRANSFER_AUTHORITY_TABLES = Object.freeze({
  organization: 'auth_organizations',
  user: 'auth_users',
  workspace: 'fuma_workspaces',
  site: 'fuma_sites',
  job: 'fuma_jobs',
  auditHistory: 'fuma_audit_history',
})

export const TRANSFER_TABLE_NAMES = Object.freeze({
  proposal: 'fuma_site_transfer_proposals',
  confirmation: 'fuma_site_transfer_confirmations',
  lock: 'fuma_site_transfer_locks',
  step: 'fuma_site_transfer_steps',
  collaboratorIntent: 'fuma_site_transfer_collaborator_intents',
})

export const TRANSFER_LIFECYCLE_STATES = Object.freeze([
  'proposed',
  'awaiting-confirmations',
  'ready',
  'running',
  'resume-requested',
  'cancellation-requested',
  'compensating',
  'failed',
  'completed',
  'cancelled',
] as const)

export const TRANSFER_CONFIRMATION_SIDES = Object.freeze([
  'source',
  'destination',
] as const)

export const TRANSFER_LOCK_STATES = Object.freeze(['active', 'released'] as const)

export const TRANSFER_STEP_KINDS = Object.freeze([
  'forward',
  'compensation',
] as const)

export const TRANSFER_STEP_STATES = Object.freeze([
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped',
] as const)

export const TRANSFER_COLLABORATOR_INTENTS = Object.freeze(['preserve', 'remove'] as const)
export const TRANSFER_COLLABORATOR_STATES = Object.freeze([
  'pending',
  'applying',
  'applied',
  'skipped',
  'failed',
] as const)

export const TRANSFER_JSON_COLUMNS = Object.freeze({
  proposalManifest: 'manifest_json',
  proposalFailure: 'failure_json',
  stepReceipt: 'receipt_json',
  stepError: 'error_json',
  collaboratorReceipt: 'receipt_json',
  collaboratorError: 'error_json',
} as const)

export const TRANSFER_INDEX_NAMES = Object.freeze({
  proposalSourceRecency: 'fuma_site_transfer_proposals_source_recency_idx',
  proposalDestinationRecency: 'fuma_site_transfer_proposals_destination_recency_idx',
  proposalStateRecency: 'fuma_site_transfer_proposals_state_recency_idx',
  activeSiteLock: 'fuma_site_transfer_locks_active_site_unique',
  activeTransferLock: 'fuma_site_transfer_locks_active_transfer_unique',
  siteFence: 'fuma_site_transfer_locks_site_fence_unique',
  lockIdentityFence: 'fuma_site_transfer_locks_identity_fence_unique',
  stepDefinitionAttempt: 'fuma_site_transfer_steps_definition_attempt_unique',
  runnableSteps: 'fuma_site_transfer_steps_runnable_idx',
  collaboratorUser: 'fuma_site_transfer_collaborator_intents_user_unique',
  collaboratorState: 'fuma_site_transfer_collaborator_intents_state_idx',
})

export const TRANSFER_SNAPSHOT_POLICY = Object.freeze({
  authorityForeignKeys: false,
  auditHistoryForeignKey: false,
  proposalSnapshotFunction: 'fuma_site_transfer_proposals_preserve_snapshot',
  proposalSnapshotTrigger: 'fuma_site_transfer_proposals_preserve_snapshot',
  proposalDeleteFunction: 'fuma_site_transfer_proposals_reject_delete',
  proposalDeleteTrigger: 'fuma_site_transfer_proposals_reject_delete',
  confirmationMutationFunction: 'fuma_site_transfer_confirmations_reject_mutation',
  confirmationUpdateTrigger: 'fuma_site_transfer_confirmations_reject_update',
  confirmationDeleteTrigger: 'fuma_site_transfer_confirmations_reject_delete',
} as const)

export const TRANSFER_FENCE_POLICY = Object.freeze({
  type: 'positive-bigint',
  exclusiveBy: Object.freeze([
    'platform_id',
    'organization_id',
    'workspace_id',
    'site_id',
  ] as const),
  stepForeignKey: Object.freeze(['platform_id', 'lock_id', 'fence'] as const),
} as const)

export const HOSTED_TRANSFER_SCHEMA_MANIFEST = Object.freeze({
  migrationId: '000008_transfer_saga',
  authorityTables: TRANSFER_AUTHORITY_TABLES,
  tables: TRANSFER_TABLE_NAMES,
  lifecycleStates: TRANSFER_LIFECYCLE_STATES,
  confirmationSides: TRANSFER_CONFIRMATION_SIDES,
  lockStates: TRANSFER_LOCK_STATES,
  stepKinds: TRANSFER_STEP_KINDS,
  stepStates: TRANSFER_STEP_STATES,
  collaboratorIntents: TRANSFER_COLLABORATOR_INTENTS,
  collaboratorStates: TRANSFER_COLLABORATOR_STATES,
  jsonColumns: TRANSFER_JSON_COLUMNS,
  indexes: TRANSFER_INDEX_NAMES,
  snapshots: TRANSFER_SNAPSHOT_POLICY,
  fencing: TRANSFER_FENCE_POLICY,
})

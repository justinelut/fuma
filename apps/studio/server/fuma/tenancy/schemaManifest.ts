export const TENANT_KEY_TABLE_NAMES = Object.freeze({
  ownerKey: 'fuma_tenant_owner_keys',
  resourceOwner: 'fuma_tenant_resource_owners',
  backfill: 'fuma_tenant_key_backfills',
  backfillReceipt: 'fuma_tenant_key_backfill_receipts',
})

export const TENANT_KEY_RESOURCE_KINDS = Object.freeze([
  'table-row',
  'object',
] as const)

export const TENANT_KEY_STATES = Object.freeze([
  'active',
  'transferring',
] as const)

export const TENANT_KEY_BACKFILL_STATES = Object.freeze([
  'pending',
  'running',
  'complete',
  'failed',
] as const)

export const TENANT_KEY_JSON_COLUMNS = Object.freeze({
  legacyIdentity: 'legacy_identity_json',
  backfillFailure: 'failure_json',
  resumeCursor: 'resume_cursor_json',
  foreignKeyEvidence: 'foreign_key_evidence_json',
  receiptFailure: 'failure_json',
})

export const TENANT_KEY_INDEX_NAMES = Object.freeze({
  transferFence: 'fuma_tenant_owner_keys_transfer_fence_unique',
  organizationResources: 'fuma_tenant_resource_owners_organization_idx',
  workspaceResources: 'fuma_tenant_resource_owners_workspace_idx',
  siteResources: 'fuma_tenant_resource_owners_site_idx',
  objectKey: 'fuma_tenant_resource_owners_object_key_unique',
  siteBackfillState: 'fuma_tenant_key_backfills_site_state_idx',
  resumableReceipts: 'fuma_tenant_key_backfill_receipts_resume_idx',
})

export const TENANT_KEY_QUALIFIED_OWNER_COLUMNS = Object.freeze([
  'platform_id',
  'owner_key',
  'organization_id',
  'workspace_id',
  'site_id',
] as const)

export const TENANT_KEY_TRANSFER_FENCE_COLUMNS = Object.freeze([
  'transfer_id',
  'transfer_lock_id',
  'transfer_fence',
  'generation',
] as const)

export const TENANT_KEY_BACKFILL_EVIDENCE = Object.freeze({
  legacyIdentityColumn: 'legacy_identity_json',
  sourceCountColumn: 'source_count',
  mappedCountColumn: 'mapped_count',
  sourceHashColumn: 'source_content_hash',
  mappedHashColumn: 'mapped_content_hash',
  sourceForeignKeyCountColumn: 'source_foreign_key_count',
  validForeignKeyCountColumn: 'valid_foreign_key_count',
  foreignKeyEvidenceColumn: 'foreign_key_evidence_json',
  resumeCursorColumn: 'resume_cursor_json',
})

export const HOSTED_TENANT_KEY_SCHEMA_MANIFEST = Object.freeze({
  migrationId: '000009_tenant_keys',
  inventoryVersion: 'tenant-keys-v1',
  tables: TENANT_KEY_TABLE_NAMES,
  resourceKinds: TENANT_KEY_RESOURCE_KINDS,
  ownerKeyStates: TENANT_KEY_STATES,
  backfillStates: TENANT_KEY_BACKFILL_STATES,
  jsonColumns: TENANT_KEY_JSON_COLUMNS,
  indexes: TENANT_KEY_INDEX_NAMES,
  qualifiedOwnerColumns: TENANT_KEY_QUALIFIED_OWNER_COLUMNS,
  transferFenceColumns: TENANT_KEY_TRANSFER_FENCE_COLUMNS,
  backfillEvidence: TENANT_KEY_BACKFILL_EVIDENCE,
})

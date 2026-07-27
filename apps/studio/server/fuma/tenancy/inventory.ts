import {
  Type,
  safeParseValue,
  type Static,
} from '@core/utils/typeboxHelpers'
import { TENANT_OBJECT_CLASS_INVENTORY } from '../tenantObjects/inventory'
import type { TenantObjectClass } from '../tenantObjects/contracts'

export const TENANT_INVENTORY_DOMAINS = Object.freeze([
  'site',
  'content',
  'media',
  'publish',
  'plugins',
  'ai-mcp',
  'forms',
  'imports-exports',
] as const)

/**
 * Audited against both immutable historical migration sources and the hosted
 * transition stream. Every name appears exactly once as a direct table class.
 */
export const TENANT_RELATIONAL_TABLE_INVENTORY = Object.freeze([
  'active_media_storage_adapter',
  'active_media_variant_delegate',
  'ai_conversations',
  'ai_defaults',
  'ai_mcp_connectors',
  'ai_messages',
  'ai_model_pricing',
  'ai_provider_credentials',
  'audit_events',
  'data_row_redirects',
  'data_row_versions',
  'data_rows',
  'data_tables',
  'fuma_legacy_import_tables',
  'fuma_legacy_imports',
  'installed_plugins',
  'media_asset_folders',
  'media_assets',
  'media_folders',
  'media_smart_folders',
  'media_usage_refs',
  'plugin_crash_events',
  'plugin_records',
  'plugin_schedule_runs',
  'plugin_schedules',
  'plugin_secrets',
  'published_runtime_assets',
  'site',
  'site_snapshots',
  'site_sync_state',
] as const)

export const TenantInventoryDomainSchema = Type.Union(
  TENANT_INVENTORY_DOMAINS.map((domain) => Type.Literal(domain)),
)
export type TenantInventoryDomain = Static<typeof TenantInventoryDomainSchema>

export const TenantInventoryStorageKindSchema = Type.Union([
  Type.Literal('table-row'),
  Type.Literal('object'),
  Type.Literal('object-metadata'),
  Type.Literal('embedded'),
  Type.Literal('transient'),
])
export type TenantInventoryStorageKind = Static<typeof TenantInventoryStorageKindSchema>

export const TenantInventoryOwnerLevelSchema = Type.Union([
  Type.Literal('site'),
  Type.Literal('user'),
  Type.Literal('platform'),
])
export type TenantInventoryOwnerLevel = Static<typeof TenantInventoryOwnerLevelSchema>

export const TenantInventoryMappingPolicySchema = Type.Union([
  Type.Literal('required'),
  Type.Literal('through-parent'),
  Type.Literal('none'),
])
export type TenantInventoryMappingPolicy = Static<typeof TenantInventoryMappingPolicySchema>

export const TenantInventoryTransferPolicySchema = Type.Union([
  Type.Literal('rebind'),
  Type.Literal('copy-rebind'),
  Type.Literal('regenerate'),
  Type.Literal('deferred-domain'),
  Type.Literal('retain'),
  Type.Literal('through-parent'),
  Type.Literal('ephemeral'),
])
export type TenantInventoryTransferPolicy = Static<typeof TenantInventoryTransferPolicySchema>

const INVENTORY_ID_OPTIONS = {
  minLength: 3,
  maxLength: 160,
  pattern: '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$',
} as const
const COLUMN_OPTIONS = {
  minLength: 1,
  maxLength: 128,
  pattern: '^[a-z][a-z0-9_]*$',
} as const

export const TenantInventoryEntrySchema = Type.Object({
  id: Type.String(INVENTORY_ID_OPTIONS),
  domain: TenantInventoryDomainSchema,
  storageKind: TenantInventoryStorageKindSchema,
  sourceName: Type.String({ minLength: 1, maxLength: 255 }),
  identityColumns: Type.Array(Type.String(COLUMN_OPTIONS), {
    minItems: 1,
    maxItems: 16,
    uniqueItems: true,
  }),
  ownerLevel: TenantInventoryOwnerLevelSchema,
  mappingPolicy: TenantInventoryMappingPolicySchema,
  transferPolicy: TenantInventoryTransferPolicySchema,
  parentClassId: Type.Union([Type.String(INVENTORY_ID_OPTIONS), Type.Null()]),
  foreignKeyTargets: Type.Array(Type.String(INVENTORY_ID_OPTIONS), {
    maxItems: 16,
    uniqueItems: true,
  }),
}, { additionalProperties: false })
export type TenantInventoryEntry = Static<typeof TenantInventoryEntrySchema>

export const TenantInventorySchema = Type.Array(TenantInventoryEntrySchema, {
  minItems: 1,
  maxItems: 256,
})
export type TenantInventory = Static<typeof TenantInventorySchema>

const row = (
  entry: Omit<TenantInventoryEntry, 'storageKind' | 'ownerLevel' | 'mappingPolicy' | 'parentClassId'>
    & Partial<Pick<TenantInventoryEntry, 'ownerLevel' | 'mappingPolicy'>>,
): TenantInventoryEntry => ({
  ...entry,
  storageKind: 'table-row',
  ownerLevel: entry.ownerLevel ?? 'site',
  mappingPolicy: entry.mappingPolicy ?? 'required',
  parentClassId: null,
})

const child = (
  entry: Omit<TenantInventoryEntry, 'storageKind' | 'ownerLevel' | 'mappingPolicy'>,
): TenantInventoryEntry => ({
  ...entry,
  storageKind: 'embedded',
  ownerLevel: 'site',
  mappingPolicy: 'through-parent',
})

const object = (
  entry: Omit<
    TenantInventoryEntry,
    'storageKind' | 'ownerLevel' | 'mappingPolicy' | 'parentClassId' | 'transferPolicy'
  > & Partial<Pick<TenantInventoryEntry, 'transferPolicy'>>,
): TenantInventoryEntry => ({
  ...entry,
  storageKind: 'object',
  ownerLevel: 'site',
  mappingPolicy: 'required',
  transferPolicy: entry.transferPolicy ?? 'copy-rebind',
  parentClassId: null,
})

const transient = (
  entry: Omit<
    TenantInventoryEntry,
    'storageKind' | 'ownerLevel' | 'mappingPolicy' | 'transferPolicy' | 'parentClassId'
  >,
): TenantInventoryEntry => ({
  ...entry,
  storageKind: 'transient',
  ownerLevel: 'site',
  mappingPolicy: 'none',
  transferPolicy: 'ephemeral',
  parentClassId: null,
})

const TENANT_OBJECT_DOMAIN_BY_CLASS: Readonly<Record<
  TenantObjectClass,
  TenantInventoryDomain
>> = Object.freeze({
  'content-revision': 'content',
  'form-attachment': 'forms',
  media: 'media',
  'publish-release': 'publish',
  'plugin-artifact': 'plugins',
  'plugin-installation-artifact': 'plugins',
  'import-artifact': 'imports-exports',
  'export-artifact': 'imports-exports',
  'ai-artifact': 'ai-mcp',
  'mcp-artifact': 'ai-mcp',
})

const TENANT_OBJECT_FOREIGN_KEYS: Readonly<Record<
  TenantObjectClass,
  readonly string[]
>> = Object.freeze({
  'content-revision': Object.freeze(['content.data-row-version']),
  'form-attachment': Object.freeze(['forms.submission']),
  media: Object.freeze(['media.asset']),
  'publish-release': Object.freeze(['publish.site-snapshot']),
  'plugin-artifact': Object.freeze([]),
  'plugin-installation-artifact': Object.freeze(['plugins.installation']),
  'import-artifact': Object.freeze([]),
  'export-artifact': Object.freeze([]),
  'ai-artifact': Object.freeze(['ai-mcp.conversation']),
  'mcp-artifact': Object.freeze(['ai-mcp.connector']),
})

const tenantObjectEntries = TENANT_OBJECT_CLASS_INVENTORY.map((definition) => object({
  id: `objects.${definition.objectClass}`,
  domain: TENANT_OBJECT_DOMAIN_BY_CLASS[definition.objectClass],
  sourceName: definition.logicalRoot,
  identityColumns: ['logical_key'],
  transferPolicy: 'copy-rebind',
  foreignKeyTargets: [...TENANT_OBJECT_FOREIGN_KEYS[definition.objectClass]],
}))

const entries: TenantInventoryEntry[] = [
  row({
    id: 'site.shell',
    domain: 'site',
    sourceName: 'site',
    identityColumns: ['id'],
    transferPolicy: 'rebind',
    foreignKeyTargets: [],
  }),
  row({
    id: 'site.sync-state',
    domain: 'site',
    sourceName: 'site_sync_state',
    identityColumns: ['id'],
    transferPolicy: 'rebind',
    foreignKeyTargets: [],
  }),
  row({
    id: 'site.audit-event',
    domain: 'site',
    sourceName: 'audit_events',
    identityColumns: ['id'],
    transferPolicy: 'retain',
    foreignKeyTargets: [],
  }),

  row({
    id: 'content.data-table',
    domain: 'content',
    sourceName: 'data_tables',
    identityColumns: ['id'],
    transferPolicy: 'rebind',
    foreignKeyTargets: [],
  }),
  row({
    id: 'content.data-row',
    domain: 'content',
    sourceName: 'data_rows',
    identityColumns: ['id'],
    transferPolicy: 'rebind',
    foreignKeyTargets: ['content.data-table'],
  }),
  row({
    id: 'content.data-row-version',
    domain: 'content',
    sourceName: 'data_row_versions',
    identityColumns: ['id'],
    transferPolicy: 'rebind',
    foreignKeyTargets: ['content.data-row', 'publish.site-snapshot'],
  }),
  row({
    id: 'content.data-row-redirect',
    domain: 'content',
    sourceName: 'data_row_redirects',
    identityColumns: ['id'],
    transferPolicy: 'rebind',
    foreignKeyTargets: ['content.data-table', 'content.data-row'],
  }),

  row({
    id: 'media.asset',
    domain: 'media',
    sourceName: 'media_assets',
    identityColumns: ['id'],
    transferPolicy: 'rebind',
    foreignKeyTargets: [],
  }),
  row({
    id: 'media.folder',
    domain: 'media',
    sourceName: 'media_folders',
    identityColumns: ['id'],
    transferPolicy: 'rebind',
    foreignKeyTargets: ['media.folder'],
  }),
  row({
    id: 'media.asset-folder',
    domain: 'media',
    sourceName: 'media_asset_folders',
    identityColumns: ['asset_id', 'folder_id'],
    transferPolicy: 'rebind',
    foreignKeyTargets: ['media.asset', 'media.folder'],
  }),
  row({
    id: 'media.smart-folder',
    domain: 'media',
    sourceName: 'media_smart_folders',
    identityColumns: ['id'],
    transferPolicy: 'rebind',
    foreignKeyTargets: [],
  }),
  row({
    id: 'media.usage-ref',
    domain: 'media',
    sourceName: 'media_usage_refs',
    identityColumns: ['asset_id', 'ref_kind', 'ref_id', 'ref_path'],
    transferPolicy: 'regenerate',
    foreignKeyTargets: ['media.asset'],
  }),
  row({
    id: 'media.storage-adapter-election',
    domain: 'media',
    sourceName: 'active_media_storage_adapter',
    identityColumns: ['role'],
    transferPolicy: 'deferred-domain',
    foreignKeyTargets: [],
  }),
  row({
    id: 'media.variant-delegate-election',
    domain: 'media',
    sourceName: 'active_media_variant_delegate',
    identityColumns: ['singleton'],
    transferPolicy: 'deferred-domain',
    foreignKeyTargets: [],
  }),

  row({
    id: 'publish.site-snapshot',
    domain: 'publish',
    sourceName: 'site_snapshots',
    identityColumns: ['id'],
    transferPolicy: 'rebind',
    foreignKeyTargets: [],
  }),
  row({
    id: 'publish.runtime-asset',
    domain: 'publish',
    sourceName: 'published_runtime_assets',
    identityColumns: ['id'],
    transferPolicy: 'regenerate',
    foreignKeyTargets: ['content.data-row-version'],
  }),

  row({
    id: 'plugins.installation',
    domain: 'plugins',
    sourceName: 'installed_plugins',
    identityColumns: ['id'],
    transferPolicy: 'deferred-domain',
    foreignKeyTargets: [],
  }),
  row({
    id: 'plugins.record',
    domain: 'plugins',
    sourceName: 'plugin_records',
    identityColumns: ['id'],
    transferPolicy: 'deferred-domain',
    foreignKeyTargets: ['plugins.installation'],
  }),
  row({
    id: 'plugins.crash-event',
    domain: 'plugins',
    sourceName: 'plugin_crash_events',
    identityColumns: ['id'],
    transferPolicy: 'deferred-domain',
    foreignKeyTargets: ['plugins.installation'],
  }),
  row({
    id: 'plugins.schedule',
    domain: 'plugins',
    sourceName: 'plugin_schedules',
    identityColumns: ['plugin_id', 'schedule_id'],
    transferPolicy: 'deferred-domain',
    foreignKeyTargets: ['plugins.installation'],
  }),
  row({
    id: 'plugins.schedule-run',
    domain: 'plugins',
    sourceName: 'plugin_schedule_runs',
    identityColumns: ['id'],
    transferPolicy: 'deferred-domain',
    foreignKeyTargets: ['plugins.schedule'],
  }),
  row({
    id: 'plugins.secret',
    domain: 'plugins',
    sourceName: 'plugin_secrets',
    identityColumns: ['plugin_id', 'setting_id'],
    transferPolicy: 'deferred-domain',
    foreignKeyTargets: ['plugins.installation'],
  }),

  row({
    id: 'ai-mcp.provider-credential',
    domain: 'ai-mcp',
    sourceName: 'ai_provider_credentials',
    identityColumns: ['id'],
    ownerLevel: 'user',
    mappingPolicy: 'none',
    transferPolicy: 'retain',
    foreignKeyTargets: [],
  }),
  row({
    id: 'ai-mcp.default',
    domain: 'ai-mcp',
    sourceName: 'ai_defaults',
    identityColumns: ['scope'],
    transferPolicy: 'deferred-domain',
    foreignKeyTargets: ['ai-mcp.provider-credential'],
  }),
  row({
    id: 'ai-mcp.conversation',
    domain: 'ai-mcp',
    sourceName: 'ai_conversations',
    identityColumns: ['id'],
    transferPolicy: 'deferred-domain',
    foreignKeyTargets: ['ai-mcp.provider-credential'],
  }),
  row({
    id: 'ai-mcp.message',
    domain: 'ai-mcp',
    sourceName: 'ai_messages',
    identityColumns: ['id'],
    transferPolicy: 'deferred-domain',
    foreignKeyTargets: ['ai-mcp.conversation'],
  }),
  row({
    id: 'ai-mcp.connector',
    domain: 'ai-mcp',
    sourceName: 'ai_mcp_connectors',
    identityColumns: ['id'],
    transferPolicy: 'deferred-domain',
    foreignKeyTargets: [],
  }),
  row({
    id: 'ai-mcp.model-pricing',
    domain: 'ai-mcp',
    sourceName: 'ai_model_pricing',
    identityColumns: ['pricing_key'],
    ownerLevel: 'platform',
    mappingPolicy: 'none',
    transferPolicy: 'retain',
    foreignKeyTargets: [],
  }),

  child({
    id: 'forms.definition',
    domain: 'forms',
    sourceName: 'data_rows.cells_json.pageTree',
    identityColumns: ['row_id', 'form_id'],
    transferPolicy: 'through-parent',
    parentClassId: 'content.data-row',
    foreignKeyTargets: ['content.data-row'],
  }),
  child({
    id: 'forms.submission',
    domain: 'forms',
    sourceName: 'data_rows',
    identityColumns: ['id'],
    transferPolicy: 'through-parent',
    parentClassId: 'content.data-row',
    foreignKeyTargets: ['content.data-table', 'content.data-row'],
  }),
  transient({
    id: 'forms.challenge',
    domain: 'forms',
    sourceName: 'server/forms/challengeStore',
    identityColumns: ['challenge_id'],
    foreignKeyTargets: ['forms.definition'],
  }),

  row({
    id: 'imports-exports.legacy-import',
    domain: 'imports-exports',
    sourceName: 'fuma_legacy_imports',
    identityColumns: ['source_fingerprint'],
    ownerLevel: 'platform',
    mappingPolicy: 'none',
    transferPolicy: 'retain',
    foreignKeyTargets: [],
  }),
  row({
    id: 'imports-exports.legacy-import-table',
    domain: 'imports-exports',
    sourceName: 'fuma_legacy_import_tables',
    identityColumns: ['source_fingerprint', 'table_name'],
    ownerLevel: 'platform',
    mappingPolicy: 'none',
    transferPolicy: 'retain',
    foreignKeyTargets: ['imports-exports.legacy-import'],
  }),
  transient({
    id: 'imports-exports.cms-bundle-manifest',
    domain: 'imports-exports',
    sourceName: '.instatic/site-bundle.json',
    identityColumns: ['exported_at'],
    foreignKeyTargets: [],
  }),
  transient({
    id: 'imports-exports.site-import-plan',
    domain: 'imports-exports',
    sourceName: 'src/core/siteImport.ImportPlan',
    identityColumns: ['source_path'],
    foreignKeyTargets: [],
  }),

  ...tenantObjectEntries,
  {
    id: 'site.object-integrity-metadata',
    domain: 'site',
    storageKind: 'object-metadata',
    sourceName: '*.__fuma_meta.json',
    identityColumns: ['object_key'],
    ownerLevel: 'site',
    mappingPolicy: 'through-parent',
    transferPolicy: 'through-parent',
    parentClassId: 'site.shell',
    foreignKeyTargets: [],
  },
  transient({
    id: 'imports-exports.object-staged-import',
    domain: 'imports-exports',
    sourceName: 'temporary staged import bytes',
    identityColumns: ['source_path'],
    foreignKeyTargets: [],
  }),
  transient({
    id: 'imports-exports.object-export-bundle',
    domain: 'imports-exports',
    sourceName: 'site-bundle-<timestamp>.zip',
    identityColumns: ['exported_at'],
    foreignKeyTargets: ['imports-exports.cms-bundle-manifest'],
  }),
]

export const TENANT_RESOURCE_INVENTORY = Object.freeze(
  entries.map((entry) => Object.freeze({
    ...entry,
    identityColumns: Object.freeze([...entry.identityColumns]),
    foreignKeyTargets: Object.freeze([...entry.foreignKeyTargets]),
  })),
)

export const TENANT_INVENTORY_CONTROL_PLANE_EXCLUSIONS = Object.freeze({
  identity: Object.freeze([
    'roles',
    'users',
    'sessions',
    'user_preferences',
    'login_attempts',
    'auth_users',
    'auth_sessions',
    'auth_accounts',
    'auth_verifications',
    'auth_two_factors',
    'auth_staff_profiles',
    'auth_legacy_identity_links',
  ]),
  authority: Object.freeze([
    'auth_organizations',
    'auth_members',
    'auth_invitations',
    'fuma_organization_profiles',
    'fuma_organization_limits',
    'fuma_organization_placements',
    'fuma_organization_bootstrap_receipts',
    'fuma_workspaces',
    'fuma_workspace_membership_overrides',
    'fuma_sites',
  ]),
  operations: Object.freeze([
    'fuma_jobs',
    'fuma_job_attempts',
    'fuma_job_effects',
    'fuma_job_schedules',
    'fuma_audit_history',
    'fuma_site_transfer_proposals',
    'fuma_site_transfer_confirmations',
    'fuma_site_transfer_locks',
    'fuma_site_transfer_steps',
    'fuma_site_transfer_collaborator_intents',
  ]),
  bookkeeping: Object.freeze([
    'schema_migrations',
    'fuma_hosted_schema_migrations',
    'fuma_tenant_owner_keys',
    'fuma_tenant_resource_owners',
    'fuma_tenant_key_backfills',
    'fuma_tenant_key_backfill_receipts',
  ]),
})

export class TenantInventoryError extends Error {
  readonly path: string

  constructor(message: string, path: string) {
    super(message)
    this.name = 'TenantInventoryError'
    this.path = path
  }
}

export function validateTenantResourceInventory(value: unknown): TenantInventory {
  const parsed = safeParseValue(TenantInventorySchema, value)
  if (!parsed.ok) {
    throw new TenantInventoryError('Tenant resource inventory failed TypeBox validation.', 'inventory')
  }
  const inventory = parsed.value
  const byId = new Map<string, TenantInventoryEntry>()
  for (const [index, entry] of inventory.entries()) {
    if (byId.has(entry.id)) {
      throw new TenantInventoryError(`Duplicate tenant inventory ID: ${entry.id}.`, `inventory[${index}].id`)
    }
    byId.set(entry.id, entry)
  }
  for (const [index, entry] of inventory.entries()) {
    for (const target of entry.foreignKeyTargets) {
      if (!byId.has(target)) {
        throw new TenantInventoryError(
          `Inventory class ${entry.id} references missing class ${target}.`,
          `inventory[${index}].foreignKeyTargets`,
        )
      }
    }
    if (entry.mappingPolicy === 'through-parent') {
      if (entry.parentClassId === null || !byId.has(entry.parentClassId)) {
        throw new TenantInventoryError(
          `Inventory class ${entry.id} requires a registered parent class.`,
          `inventory[${index}].parentClassId`,
        )
      }
    } else if (entry.parentClassId !== null) {
      throw new TenantInventoryError(
        `Inventory class ${entry.id} cannot declare a parent without through-parent mapping.`,
        `inventory[${index}].parentClassId`,
      )
    }
    if (entry.ownerLevel === 'site'
      && (entry.storageKind === 'table-row' || entry.storageKind === 'object')
      && entry.mappingPolicy !== 'required') {
      throw new TenantInventoryError(
        `Persisted site class ${entry.id} requires an owner-key mapping.`,
        `inventory[${index}].mappingPolicy`,
      )
    }
    if (entry.storageKind === 'object' && !['copy-rebind', 'regenerate', 'deferred-domain'].includes(entry.transferPolicy)) {
      throw new TenantInventoryError(
        `Object class ${entry.id} has no integrity-safe transfer policy.`,
        `inventory[${index}].transferPolicy`,
      )
    }
  }
  for (const domain of TENANT_INVENTORY_DOMAINS) {
    if (!inventory.some((entry) => entry.domain === domain)) {
      throw new TenantInventoryError(`Tenant inventory omits domain ${domain}.`, 'inventory')
    }
  }
  const directTables = inventory
    .filter(({ storageKind }) => storageKind === 'table-row')
    .map(({ sourceName }) => sourceName)
  for (const table of TENANT_RELATIONAL_TABLE_INVENTORY) {
    const occurrences = directTables.filter((sourceName) => sourceName === table).length
    if (occurrences !== 1) {
      throw new TenantInventoryError(
        `Relational tenant table ${table} requires exactly one direct inventory class.`,
        'inventory',
      )
    }
  }
  const relationalTables = new Set<string>(TENANT_RELATIONAL_TABLE_INVENTORY)
  const unknownTable = directTables.find((sourceName) => !relationalTables.has(sourceName))
  if (unknownTable) {
    throw new TenantInventoryError(
      `Direct inventory class references unaudited relational table ${unknownTable}.`,
      'inventory',
    )
  }
  return inventory
}

validateTenantResourceInventory(TENANT_RESOURCE_INVENTORY)

import { describe, expect, it } from 'bun:test'
import { TENANT_OBJECT_CLASS_INVENTORY } from '../../../server/fuma/tenantObjects'
import {
  TENANT_INVENTORY_CONTROL_PLANE_EXCLUSIONS,
  TENANT_INVENTORY_DOMAINS,
  TENANT_RESOURCE_INVENTORY,
  TenantInventoryError,
  validateTenantResourceInventory,
} from '../../../server/fuma/tenancy'

const expectedTenantTables = [
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
]

const expectedObjectClasses = [
  'objects.ai-artifact',
  'objects.content-revision',
  'objects.export-artifact',
  'objects.form-attachment',
  'objects.import-artifact',
  'objects.mcp-artifact',
  'objects.media',
  'objects.plugin-artifact',
  'objects.plugin-installation-artifact',
  'objects.publish-release',
]

describe('FUMA-024 tenant resource inventory', () => {
  it('passes the TypeBox and semantic inventory boundary as one immutable catalog', () => {
    expect(validateTenantResourceInventory(TENANT_RESOURCE_INVENTORY)).toEqual(
      TENANT_RESOURCE_INVENTORY,
    )
    expect(Object.isFrozen(TENANT_RESOURCE_INVENTORY)).toBe(true)
    expect(TENANT_RESOURCE_INVENTORY.every(Object.isFrozen)).toBe(true)
    expect(new Set(TENANT_RESOURCE_INVENTORY.map(({ id }) => id)).size)
      .toBe(TENANT_RESOURCE_INVENTORY.length)
  })

  it('covers every required tenant concern including forms and import/export aliases', () => {
    const domains = new Set(TENANT_RESOURCE_INVENTORY.map(({ domain }) => domain))
    expect([...domains].sort()).toEqual([...TENANT_INVENTORY_DOMAINS].sort())
    expect(TENANT_RESOURCE_INVENTORY.find(({ id }) => id === 'forms.definition')).toMatchObject({
      storageKind: 'embedded',
      parentClassId: 'content.data-row',
      transferPolicy: 'through-parent',
    })
    expect(TENANT_RESOURCE_INVENTORY.find(({ id }) => id === 'forms.submission')).toMatchObject({
      sourceName: 'data_rows',
      parentClassId: 'content.data-row',
    })
    expect(TENANT_RESOURCE_INVENTORY.find(
      ({ id }) => id === 'imports-exports.cms-bundle-manifest',
    )).toMatchObject({ storageKind: 'transient', transferPolicy: 'ephemeral' })
  })

  it('inventories every current tenant/domain table exactly once as a direct table class', () => {
    const tables = TENANT_RESOURCE_INVENTORY
      .filter(({ storageKind }) => storageKind === 'table-row')
      .map(({ sourceName }) => sourceName)
      .toSorted()
    expect(tables).toEqual(expectedTenantTables)
  })

  it('inventories all current byte classes plus the integrity metadata sidecar', () => {
    const objectClasses = TENANT_RESOURCE_INVENTORY
      .filter(({ storageKind }) => storageKind === 'object')
      .map(({ id }) => id)
      .toSorted()
    expect(objectClasses).toEqual(expectedObjectClasses)
    expect(TENANT_RESOURCE_INVENTORY
      .filter(({ storageKind }) => storageKind === 'object')
      .map(({ id, sourceName }) => ({ id, sourceName })))
      .toEqual(TENANT_OBJECT_CLASS_INVENTORY.map(({ objectClass, logicalRoot }) => ({
        id: `objects.${objectClass}`,
        sourceName: logicalRoot,
      })))
    expect(TENANT_RESOURCE_INVENTORY.find(
      ({ id }) => id === 'site.object-integrity-metadata',
    )).toEqual(expect.objectContaining({
      storageKind: 'object-metadata',
      sourceName: '*.__fuma_meta.json',
      mappingPolicy: 'through-parent',
      transferPolicy: 'through-parent',
    }))
  })

  it('requires owner mappings for every persisted site row and object class', () => {
    const persistedSiteClasses = TENANT_RESOURCE_INVENTORY.filter((entry) => (
      entry.ownerLevel === 'site'
      && (entry.storageKind === 'table-row' || entry.storageKind === 'object')
    ))
    expect(persistedSiteClasses.length).toBeGreaterThan(0)
    expect(persistedSiteClasses.every(({ mappingPolicy }) => mappingPolicy === 'required'))
      .toBe(true)
    expect(persistedSiteClasses.every(({ identityColumns }) => identityColumns.length > 0))
      .toBe(true)
  })

  it('keeps credentials/global catalogs and control-plane authority out of site movement', () => {
    expect(TENANT_RESOURCE_INVENTORY.find(
      ({ id }) => id === 'ai-mcp.provider-credential',
    )).toMatchObject({ ownerLevel: 'user', mappingPolicy: 'none', transferPolicy: 'retain' })
    expect(TENANT_RESOURCE_INVENTORY.find(
      ({ id }) => id === 'ai-mcp.model-pricing',
    )).toMatchObject({ ownerLevel: 'platform', mappingPolicy: 'none', transferPolicy: 'retain' })
    expect(TENANT_INVENTORY_CONTROL_PLANE_EXCLUSIONS.authority).toContain('fuma_sites')
    expect(TENANT_INVENTORY_CONTROL_PLANE_EXCLUSIONS.operations).toContain('fuma_jobs')
    expect(TENANT_INVENTORY_CONTROL_PLANE_EXCLUSIONS.operations).toContain(
      'fuma_site_transfer_steps',
    )
  })

  it('rejects unknown fields, missing parents, and missing FK inventory targets', () => {
    const first = TENANT_RESOURCE_INVENTORY[0]
    if (!first) throw new Error('Tenant inventory fixture is empty.')
    expect(() => validateTenantResourceInventory([{ ...first, profileId: 'website' }]))
      .toThrow(TenantInventoryError)
    expect(() => validateTenantResourceInventory([{
      ...first,
      mappingPolicy: 'through-parent',
      parentClassId: 'missing.parent',
    }])).toThrow(expect.objectContaining({ path: 'inventory[0].parentClassId' }))
    expect(() => validateTenantResourceInventory([{
      ...first,
      foreignKeyTargets: ['missing.target'],
    }])).toThrow(expect.objectContaining({ path: 'inventory[0].foreignKeyTargets' }))
  })
})

import { describe, expect, it } from 'bun:test'
import { Value } from '@core/utils/typeboxHelpers'
import {
  TENANT_OBJECT_CLASSES,
  TENANT_OBJECT_CLASS_INVENTORY,
  TenantObjectInventoryItemSchema,
  TenantObjectManifestSchema,
  assertNoTenantObjectManifestCollisions,
  assertTenantObjectManifest,
  classifyTenantObjectLogicalKey,
  createTenantObjectInventory,
  createTenantObjectManifest,
  tenantObjectEntriesHashInput,
  tenantObjectManifestHashInput,
  type TenantObjectInventoryItem,
  type TenantObjectScope,
} from '../../../server/fuma/tenantObjects'
import {
  physicalObjectKey,
  tenantObjectPrefix,
} from '../../../server/fuma/objectStorage'

const SOURCE: TenantObjectScope = {
  organizationId: 'organization-source',
  workspaceId: 'workspace-source',
  siteId: 'site-shared',
}
const DESTINATION: TenantObjectScope = {
  organizationId: 'organization-destination',
  workspaceId: 'workspace-destination',
  siteId: 'site-shared',
}
const CAPTURED_AT = '2026-07-25T07:15:31.247Z'
const CHECKSUMS = {
  a: 'a'.repeat(64),
  b: 'b'.repeat(64),
  c: 'c'.repeat(64),
  d: 'd'.repeat(64),
  e: 'e'.repeat(64),
  f: 'f'.repeat(64),
  zero: '0'.repeat(64),
  one: '1'.repeat(64),
  two: '2'.repeat(64),
  three: '3'.repeat(64),
} as const

function fullInventory(): TenantObjectInventoryItem[] {
  return [
    {
      objectClass: 'content-revision',
      logicalKey: 'content/revisions/revision-01.json',
      sizeBytes: 101,
      mimeType: 'application/json',
      contentChecksumSha256: CHECKSUMS.a,
      metadata: { contentId: 'content-01', revisionId: 'revision-01' },
    },
    {
      objectClass: 'form-attachment',
      logicalKey: 'forms/attachments/form-01/submission.pdf',
      sizeBytes: 102,
      mimeType: 'application/pdf',
      contentChecksumSha256: CHECKSUMS.b,
      metadata: { formId: 'form-01', fileName: 'submission.pdf' },
    },
    {
      objectClass: 'media',
      logicalKey: 'media/media-01/original.png',
      sizeBytes: 103,
      mimeType: 'image/png',
      contentChecksumSha256: CHECKSUMS.c,
      metadata: { mediaId: 'media-01', variant: 'original' },
    },
    {
      objectClass: 'publish-release',
      logicalKey: 'publish/releases/release-01/index.html',
      sizeBytes: 104,
      mimeType: 'text/html',
      contentChecksumSha256: CHECKSUMS.d,
      metadata: { releaseId: 'release-01', purpose: 'route-html' },
    },
    {
      objectClass: 'plugin-artifact',
      logicalKey: 'plugins/artifacts/plugin-01/package.zip',
      sizeBytes: 105,
      mimeType: 'application/zip',
      contentChecksumSha256: CHECKSUMS.e,
      metadata: { pluginId: 'plugin-01', fileName: 'package.zip' },
    },
    {
      objectClass: 'plugin-installation-artifact',
      logicalKey: 'plugins/installations/installation-01/cache.json',
      sizeBytes: 106,
      mimeType: 'application/json',
      contentChecksumSha256: CHECKSUMS.f,
      metadata: { pluginId: 'plugin-01', pluginInstallationId: 'installation-01' },
    },
    {
      objectClass: 'import-artifact',
      logicalKey: 'imports/import-01/source.zip',
      sizeBytes: 107,
      mimeType: 'application/zip',
      contentChecksumSha256: CHECKSUMS.zero,
      metadata: { importId: 'import-01', provenance: 'validated-upload' },
    },
    {
      objectClass: 'export-artifact',
      logicalKey: 'exports/export-01/site.zip',
      sizeBytes: 108,
      mimeType: 'application/zip',
      contentChecksumSha256: CHECKSUMS.one,
      metadata: { exportId: 'export-01', fileName: 'site.zip' },
    },
    {
      objectClass: 'ai-artifact',
      logicalKey: 'ai/artifacts/ai-01/result.json',
      sizeBytes: 109,
      mimeType: 'application/json',
      contentChecksumSha256: CHECKSUMS.two,
      metadata: { aiArtifactId: 'ai-01', purpose: 'tool-result' },
    },
    {
      objectClass: 'mcp-artifact',
      logicalKey: 'mcp/artifacts/mcp-01/result.json',
      sizeBytes: 110,
      mimeType: 'application/json',
      contentChecksumSha256: CHECKSUMS.three,
      metadata: { mcpArtifactId: 'mcp-01', purpose: 'connector-result' },
    },
  ]
}

function manifest(inventory: unknown = fullInventory()) {
  return createTenantObjectManifest({
    transferId: 'transfer-024',
    source: SOURCE,
    destination: DESTINATION,
    inventory,
    capturedAt: CAPTURED_AT,
  })
}

describe('FUMA-024 transferable object inventory contracts', () => {
  it('covers every object-backed class with one immutable logical root', () => {
    expect(TENANT_OBJECT_CLASS_INVENTORY.map(({ objectClass }) => objectClass))
      .toEqual(TENANT_OBJECT_CLASSES)
    expect(new Set(TENANT_OBJECT_CLASS_INVENTORY.map(({ logicalRoot }) => logicalRoot)).size)
      .toBe(TENANT_OBJECT_CLASSES.length)
    expect(Object.isFrozen(TENANT_OBJECT_CLASS_INVENTORY)).toBe(true)

    for (const [index, item] of fullInventory().entries()) {
      expect(Value.Check(TenantObjectInventoryItemSchema, item)).toBe(true)
      expect(classifyTenantObjectLogicalKey(item.logicalKey)).toBe(item.objectClass)
      expect(Object.isFrozen(TENANT_OBJECT_CLASS_INVENTORY[index])).toBe(true)
      expect(Object.isFrozen(TENANT_OBJECT_CLASS_INVENTORY[index].requiredMetadataKeys)).toBe(true)
    }
  })

  it('requires class-specific metadata and rejects unknown roots or class substitution', () => {
    const media = fullInventory().find(({ objectClass }) => objectClass === 'media')!
    expect(() => createTenantObjectInventory([{ ...media, metadata: {} }])).toThrow(
      expect.objectContaining({
        name: 'TenantObjectContractError',
        code: 'class-key-mismatch',
        path: 'inventory[0].metadata.mediaId',
      }),
    )
    expect(() => createTenantObjectInventory([{ ...media, objectClass: 'export-artifact' }]))
      .toThrow(expect.objectContaining({ code: 'class-key-mismatch' }))
    expect(() => classifyTenantObjectLogicalKey('documents/unclassified.json'))
      .toThrow(expect.objectContaining({ code: 'unknown-object-class' }))
    expect(Value.Check(TenantObjectInventoryItemSchema, {
      ...media,
      objectClass: 'plugin-secret',
    })).toBe(false)
  })

  it('rejects duplicate and noncanonical logical keys before a manifest exists', () => {
    const [first] = fullInventory()
    expect(() => createTenantObjectInventory([first, { ...first }])).toThrow(
      expect.objectContaining({ code: 'duplicate-key' }),
    )
    for (const logicalKey of [
      '../media/escape.png',
      'media//escape.png',
      'media/%2e%2e/escape.png',
      'organizations/other/workspaces/x/sites/y/objects/media/escape.png',
    ]) {
      expect(() => createTenantObjectInventory([{ ...fullInventory()[2], logicalKey }]))
        .toThrow(expect.objectContaining({ code: 'class-key-mismatch' }))
    }
  })

  it('allows only bounded allowlisted metadata and rejects secret material', () => {
    const media = fullInventory()[2]
    expect(Value.Check(TenantObjectInventoryItemSchema, {
      ...media,
      metadata: { ...media.metadata, apiKey: 'not-allowed' },
    })).toBe(false)
    expect(() => createTenantObjectInventory([{
      ...media,
      metadata: { ...media.metadata, provenance: 'password=hunter2' },
    }])).toThrow(expect.objectContaining({
      code: 'secret-metadata',
      path: 'inventory[0].metadata.provenance',
    }))
    expect(Value.Check(TenantObjectInventoryItemSchema, {
      ...media,
      metadata: { ...media.metadata, provenance: 'x'.repeat(513) },
    })).toBe(false)
  })
})

describe('FUMA-024 deterministic object manifests', () => {
  it('derives exact source/destination physical keys only through FUMA-008 policy', () => {
    const value = manifest()
    expect(Value.Check(TenantObjectManifestSchema, value)).toBe(true)
    expect(() => assertTenantObjectManifest(value)).not.toThrow()
    expect(value.sourcePrefix).toBe(tenantObjectPrefix(SOURCE))
    expect(value.destinationPrefix).toBe(tenantObjectPrefix(DESTINATION))

    for (const entry of value.entries) {
      expect(entry.sourcePhysicalKey).toBe(physicalObjectKey(SOURCE, entry.logicalKey))
      expect(entry.destinationPhysicalKey).toBe(physicalObjectKey(DESTINATION, entry.logicalKey))
      expect(entry.sourcePhysicalKey).not.toBe(entry.destinationPhysicalKey)
    }
  })

  it('sorts deterministically, exposes canonical hash inputs, and deeply freezes output', () => {
    const forward = manifest(fullInventory())
    const reverse = manifest([...fullInventory()].reverse())

    expect(reverse).toEqual(forward)
    expect(reverse.entriesChecksumSha256).toBe(forward.entriesChecksumSha256)
    expect(reverse.manifestChecksumSha256).toBe(forward.manifestChecksumSha256)
    expect(tenantObjectEntriesHashInput(reverse.entries))
      .toBe(tenantObjectEntriesHashInput(forward.entries))
    const { manifestChecksumSha256: _checksum, ...withoutChecksum } = forward
    expect(tenantObjectManifestHashInput(withoutChecksum)).toContain('transfer-024')
    expect(Object.isFrozen(forward)).toBe(true)
    expect(Object.isFrozen(forward.entries)).toBe(true)
    expect(Object.isFrozen(forward.entries[0])).toBe(true)
    expect(Object.isFrozen(forward.entries[0].metadata)).toBe(true)
  })

  it('rejects source/destination prefix substitution and ownership substitution', () => {
    const value = manifest()
    expect(() => assertTenantObjectManifest({
      ...value,
      sourcePrefix: tenantObjectPrefix(DESTINATION),
    })).toThrow(expect.objectContaining({
      code: 'prefix-substitution',
      path: 'manifest.sourcePrefix',
    }))
    expect(() => createTenantObjectManifest({
      transferId: 'transfer-same-owner',
      source: SOURCE,
      destination: SOURCE,
      inventory: [],
      capturedAt: CAPTURED_AT,
    })).toThrow(expect.objectContaining({ code: 'same-owner' }))
    expect(() => createTenantObjectManifest({
      transferId: 'transfer-changed-site',
      source: SOURCE,
      destination: { ...DESTINATION, siteId: 'site-other' },
      inventory: [],
      capturedAt: CAPTURED_AT,
    })).toThrow(expect.objectContaining({ code: 'site-identity-mismatch' }))
  })

  it('rejects content checksum, byte-size, MIME, ordering, and aggregate drift', () => {
    const value = manifest()
    const first = value.entries[0]
    for (const changed of [
      { ...first, contentChecksumSha256: '9'.repeat(64) },
      { ...first, sizeBytes: first.sizeBytes + 1 },
      { ...first, mimeType: 'text/plain' },
    ]) {
      expect(() => assertTenantObjectManifest({
        ...value,
        entries: [changed, ...value.entries.slice(1)],
      })).toThrow(expect.objectContaining({ code: 'object-drift' }))
    }

    expect(() => assertTenantObjectManifest({
      ...value,
      entries: [...value.entries].reverse(),
    })).toThrow(expect.objectContaining({ code: 'ordering-drift' }))
    expect(() => assertTenantObjectManifest({
      ...value,
      entryCount: value.entryCount + 1,
    })).toThrow(expect.objectContaining({ code: 'aggregate-drift' }))
    expect(() => assertTenantObjectManifest({
      ...value,
      manifestChecksumSha256: '9'.repeat(64),
    })).toThrow(expect.objectContaining({
      code: 'aggregate-drift',
      path: 'manifest.manifestChecksumSha256',
    }))
  })

  it('rejects cross-tenant destination collisions while allowing exact replay evidence', () => {
    const first = manifest([fullInventory()[2]])
    const second = createTenantObjectManifest({
      transferId: 'transfer-025',
      source: {
        organizationId: 'organization-other-source',
        workspaceId: 'workspace-other-source',
        siteId: SOURCE.siteId,
      },
      destination: DESTINATION,
      inventory: [fullInventory()[2]],
      capturedAt: CAPTURED_AT,
    })

    expect(() => assertNoTenantObjectManifestCollisions([first, first])).not.toThrow()
    expect(() => assertNoTenantObjectManifestCollisions([first, second])).toThrow(
      expect.objectContaining({ code: 'cross-tenant-collision' }),
    )
  })
})

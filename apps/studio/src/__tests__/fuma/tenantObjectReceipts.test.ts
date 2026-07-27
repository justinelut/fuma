import { describe, expect, it } from 'bun:test'
import { Value } from '@core/utils/typeboxHelpers'
import {
  TenantObjectCompensationReceiptSchema,
  TenantObjectCopyIntentSchema,
  TenantObjectCopyProgressReceiptSchema,
  TenantObjectCopyReceiptSchema,
  TenantObjectPolicySnapshotSchema,
  TenantObjectRebindReceiptSchema,
  assertTenantObjectCompensationReceipt,
  assertTenantObjectCopyIntent,
  assertTenantObjectCopyProgressReceipt,
  assertTenantObjectCopyReceipt,
  assertTenantObjectPolicySnapshot,
  assertTenantObjectRebindReceipt,
  createTenantObjectCompensationReceipt,
  createTenantObjectCopyIntent,
  createTenantObjectCopyProgressReceipt,
  createTenantObjectCopyReceipt,
  createTenantObjectDeleteReceipt,
  createTenantObjectManifest,
  createTenantObjectPolicySnapshot,
  createTenantObjectRebindReceipt,
  tenantObjectCopyProgressHashInput,
  tenantObjectCopyReceiptHashInput,
  tenantObjectPolicyHashInput,
  type TenantObjectPolicySnapshot,
  type TenantObjectSagaFence,
  type TenantObjectScope,
} from '../../../server/fuma/tenantObjects'
import { tenantObjectPrefix } from '../../../server/fuma/objectStorage'

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
const SAGA: TenantObjectSagaFence = {
  transferId: 'transfer-024',
  lockId: 'lock-024',
  fence: 7,
}
const CAPTURED_AT = '2026-07-25T07:15:31.247Z'
const INTENDED_AT = '2026-07-25T07:16:01.247Z'
const COPIED_AT = '2026-07-25T07:16:31.247Z'
const REBOUND_AT = '2026-07-25T07:17:31.247Z'
const COMPENSATED_AT = '2026-07-25T07:18:31.247Z'

function manifest() {
  return createTenantObjectManifest({
    transferId: SAGA.transferId,
    source: SOURCE,
    destination: DESTINATION,
    inventory: [
      {
        objectClass: 'media',
        logicalKey: 'media/media-01/original.png',
        sizeBytes: 120,
        mimeType: 'image/png',
        contentChecksumSha256: 'a'.repeat(64),
        metadata: { mediaId: 'media-01', variant: 'original' },
      },
      {
        objectClass: 'publish-release',
        logicalKey: 'publish/releases/release-01/index.html',
        sizeBytes: 240,
        mimeType: 'text/html',
        contentChecksumSha256: 'b'.repeat(64),
        metadata: { releaseId: 'release-01', purpose: 'route-html' },
      },
    ],
    capturedAt: CAPTURED_AT,
  })
}

function copyReceipt(
  value: ReturnType<typeof manifest>,
  logicalKey: string,
  disposition: 'copy' | 'rebind' = 'copy',
) {
  return createTenantObjectCopyReceipt({
    manifest: value,
    saga: SAGA,
    logicalKey,
    disposition,
    copiedAt: COPIED_AT,
  })
}

function activePolicy(
  scope: TenantObjectScope,
  version: number,
  capturedAt = CAPTURED_AT,
): TenantObjectPolicySnapshot {
  return createTenantObjectPolicySnapshot({
    namespace: scope,
    owner: scope,
    state: 'active',
    version,
    bindings: [
      {
        principalKind: 'site',
        principalId: scope.siteId,
        actions: ['delete', 'read', 'write', 'list'],
      },
      {
        principalKind: 'workspace',
        principalId: scope.workspaceId,
        actions: ['read', 'list'],
      },
    ],
    capturedAt,
  })
}

function sealedPolicy(
  scope: TenantObjectScope,
  version: number,
  capturedAt = CAPTURED_AT,
): TenantObjectPolicySnapshot {
  return createTenantObjectPolicySnapshot({
    namespace: scope,
    owner: scope,
    state: 'sealed',
    version,
    bindings: [],
    capturedAt,
  })
}

function rebindFixture() {
  const value = manifest()
  const copies = value.entries.map((entry) => copyReceipt(value, entry.logicalKey))
  const progress = createTenantObjectCopyProgressReceipt(value, SAGA, copies, COPIED_AT)
  const sourceBefore = activePolicy(SOURCE, 7)
  const destinationBefore = sealedPolicy(DESTINATION, 13)
  const sourceAfter = sealedPolicy(SOURCE, 8, REBOUND_AT)
  const destinationAfter = activePolicy(DESTINATION, 14, REBOUND_AT)
  const receipt = createTenantObjectRebindReceipt({
    manifest: value,
    saga: SAGA,
    copyProgress: progress,
    sourceBefore,
    destinationBefore,
    sourceAfter,
    destinationAfter,
    reboundAt: REBOUND_AT,
  })
  return {
    manifest: value,
    progress,
    sourceBefore,
    destinationBefore,
    sourceAfter,
    destinationAfter,
    receipt,
  }
}

describe('FUMA-024 resumable object copy receipts', () => {
  it('persists a fenced intent before writes and binds its receipt to immutable entry evidence', () => {
    const value = manifest()
    const logicalKey = value.entries[0].logicalKey
    const intent = createTenantObjectCopyIntent({
      manifest: value,
      saga: SAGA,
      logicalKey,
      disposition: 'copy',
      intendedAt: INTENDED_AT,
    })
    const receipt = copyReceipt(value, logicalKey)

    expect(Value.Check(TenantObjectCopyIntentSchema, intent)).toBe(true)
    expect(Value.Check(TenantObjectCopyReceiptSchema, receipt)).toBe(true)
    expect(() => assertTenantObjectCopyIntent(intent, value, SAGA)).not.toThrow()
    expect(() => assertTenantObjectCopyReceipt(receipt, value, SAGA)).not.toThrow()
    expect(receipt.sourcePhysicalKey).toBe(value.entries[0].sourcePhysicalKey)
    expect(receipt.destinationPhysicalKey).toBe(value.entries[0].destinationPhysicalKey)
    expect(receipt.entryDescriptorChecksumSha256).toBe(value.entries[0].descriptorChecksumSha256)
    expect(receipt.lockId).toBe(SAGA.lockId)
    expect(Object.isFrozen(receipt)).toBe(true)

    const { receiptChecksumSha256: _checksum, ...withoutChecksum } = receipt
    expect(tenantObjectCopyReceiptHashInput(withoutChecksum)).toContain(receipt.logicalKey)
  })

  it('rejects checksum, byte-size, MIME, key, manifest, and fence drift', () => {
    const value = manifest()
    const receipt = copyReceipt(value, value.entries[0].logicalKey)
    const drifts = [
      { ...receipt, contentChecksumSha256: 'c'.repeat(64) },
      { ...receipt, sizeBytes: receipt.sizeBytes + 1 },
      { ...receipt, mimeType: 'application/json' },
      { ...receipt, destinationPhysicalKey: value.entries[1].destinationPhysicalKey },
      { ...receipt, manifestChecksumSha256: 'd'.repeat(64) },
      { ...receipt, fence: SAGA.fence + 1 },
    ]
    for (const drift of drifts) {
      expect(() => assertTenantObjectCopyReceipt(drift, value, SAGA)).toThrow(
        expect.objectContaining({ code: 'receipt-drift' }),
      )
    }
  })

  it('builds deterministic partial progress that resumes without duplicate receipts', () => {
    const value = manifest()
    const media = copyReceipt(value, value.entries[0].logicalKey)
    const release = copyReceipt(value, value.entries[1].logicalKey)
    const partial = createTenantObjectCopyProgressReceipt(value, SAGA, [release], COPIED_AT)
    const complete = createTenantObjectCopyProgressReceipt(value, SAGA, [release, media], COPIED_AT)
    const completeReordered = createTenantObjectCopyProgressReceipt(
      value,
      SAGA,
      [media, release],
      COPIED_AT,
    )

    expect(Value.Check(TenantObjectCopyProgressReceiptSchema, partial)).toBe(true)
    expect(partial.completedCount).toBe(1)
    expect(complete).toEqual(completeReordered)
    expect(complete.completed.map(({ logicalKey }) => logicalKey))
      .toEqual(value.entries.map(({ logicalKey }) => logicalKey))
    expect(() => assertTenantObjectCopyProgressReceipt(complete, value, SAGA)).not.toThrow()
    const { receiptChecksumSha256: _checksum, ...withoutChecksum } = complete
    expect(tenantObjectCopyProgressHashInput(withoutChecksum)).toContain(media.receiptChecksumSha256)
    expect(() => createTenantObjectCopyProgressReceipt(value, SAGA, [media, media], COPIED_AT))
      .toThrow(expect.objectContaining({ code: 'duplicate-key' }))
  })
})

describe('FUMA-024 object ownership policy snapshots and rebind receipts', () => {
  it('derives exact prefixes, canonicalizes bindings, and rejects cross-tenant principals', () => {
    const source = activePolicy(SOURCE, 7)
    expect(Value.Check(TenantObjectPolicySnapshotSchema, source)).toBe(true)
    expect(source.prefix).toBe(tenantObjectPrefix(SOURCE))
    expect(source.bindings[0].actions).toEqual(['read', 'write', 'list', 'delete'])
    expect(() => assertTenantObjectPolicySnapshot(source)).not.toThrow()
    const { policyChecksumSha256: _checksum, ...withoutChecksum } = source
    expect(tenantObjectPolicyHashInput(withoutChecksum)).toContain(source.prefix)

    expect(() => createTenantObjectPolicySnapshot({
      namespace: DESTINATION,
      owner: DESTINATION,
      state: 'active',
      version: 1,
      bindings: [{
        principalKind: 'workspace',
        principalId: SOURCE.workspaceId,
        actions: ['read'],
      }],
      capturedAt: CAPTURED_AT,
    })).toThrow(expect.objectContaining({ code: 'policy-drift' }))
  })

  it('requires a complete fenced copy receipt before one exact policy transition', () => {
    const fixture = rebindFixture()
    expect(Value.Check(TenantObjectRebindReceiptSchema, fixture.receipt)).toBe(true)
    expect(() => assertTenantObjectRebindReceipt(
      fixture.receipt,
      fixture.manifest,
      SAGA,
      fixture.progress,
    )).not.toThrow()
    expect(fixture.receipt.sourceBefore.state).toBe('active')
    expect(fixture.receipt.sourceAfter.state).toBe('sealed')
    expect(fixture.receipt.destinationBefore.state).toBe('sealed')
    expect(fixture.receipt.destinationAfter.state).toBe('active')

    const partial = createTenantObjectCopyProgressReceipt(
      fixture.manifest,
      SAGA,
      [fixture.progress.completed[0]],
      COPIED_AT,
    )
    expect(() => createTenantObjectRebindReceipt({
      manifest: fixture.manifest,
      saga: SAGA,
      copyProgress: partial,
      sourceBefore: fixture.sourceBefore,
      destinationBefore: fixture.destinationBefore,
      sourceAfter: fixture.sourceAfter,
      destinationAfter: fixture.destinationAfter,
      reboundAt: REBOUND_AT,
    })).toThrow(expect.objectContaining({ code: 'receipt-drift' }))
  })
})

describe('FUMA-024 object compensation receipts', () => {
  it('removes every transfer-created copy, preserves rebinds, and binds completed progress', () => {
    const fixture = rebindFixture()
    const completed = [
      copyReceipt(fixture.manifest, fixture.manifest.entries[0].logicalKey, 'copy'),
      copyReceipt(fixture.manifest, fixture.manifest.entries[1].logicalKey, 'rebind'),
    ]
    const progress = createTenantObjectCopyProgressReceipt(
      fixture.manifest,
      SAGA,
      completed,
      COPIED_AT,
    )
    const checkpoints = completed.map((receipt) => ({
      intent: createTenantObjectCopyIntent({
        manifest: fixture.manifest,
        saga: SAGA,
        logicalKey: receipt.logicalKey,
        disposition: receipt.disposition,
        intendedAt: INTENDED_AT,
      }),
      receipt,
    }))
    const deleted = createTenantObjectDeleteReceipt(
      fixture.manifest,
      SAGA,
      fixture.manifest.entries[0].logicalKey,
      'deleted',
      COMPENSATED_AT,
    )
    const compensation = createTenantObjectCompensationReceipt({
      manifest: fixture.manifest,
      saga: SAGA,
      copyProgress: progress,
      checkpoints,
      revertedCopies: [deleted],
      compensatedAt: COMPENSATED_AT,
    })

    expect(Value.Check(TenantObjectCompensationReceiptSchema, compensation)).toBe(true)
    expect(() => assertTenantObjectCompensationReceipt(
      compensation,
      fixture.manifest,
      SAGA,
      progress,
    )).not.toThrow()
    expect(compensation.revertedCopies.map(({ logicalKey }) => logicalKey))
      .toEqual([fixture.manifest.entries[0].logicalKey])
    expect(compensation.checkpoints.find(
      ({ intent }) => intent.disposition === 'rebind',
    )?.receipt).not.toBeNull()
  })

  it('supports partial interrupted copy compensation and rejects incomplete deletion evidence', () => {
    const fixture = rebindFixture()
    const first = fixture.manifest.entries[0]
    const partialCheckpoint = {
      intent: createTenantObjectCopyIntent({
        manifest: fixture.manifest,
        saga: SAGA,
        logicalKey: first.logicalKey,
        disposition: 'copy',
        intendedAt: INTENDED_AT,
      }),
      receipt: null,
    }
    const deleted = createTenantObjectDeleteReceipt(
      fixture.manifest,
      SAGA,
      first.logicalKey,
      'already-absent',
      COMPENSATED_AT,
    )
    const partial = createTenantObjectCompensationReceipt({
      manifest: fixture.manifest,
      saga: SAGA,
      copyProgress: null,
      checkpoints: [partialCheckpoint],
      revertedCopies: [deleted],
      compensatedAt: COMPENSATED_AT,
    })
    expect(partial.copyProgressReceiptChecksumSha256).toBeNull()
    expect(() => assertTenantObjectCompensationReceipt(
      partial,
      fixture.manifest,
      SAGA,
      null,
    )).not.toThrow()

    expect(() => createTenantObjectCompensationReceipt({
      manifest: fixture.manifest,
      saga: SAGA,
      copyProgress: null,
      checkpoints: [partialCheckpoint],
      revertedCopies: [],
      compensatedAt: COMPENSATED_AT,
    })).toThrow(expect.objectContaining({ code: 'receipt-drift' }))

    const copy = copyReceipt(fixture.manifest, first.logicalKey)
    expect(Value.Check(TenantObjectCopyReceiptSchema, {
      ...copy,
      destinationSigningSecret: 'never-authority',
    })).toBe(false)
  })
})

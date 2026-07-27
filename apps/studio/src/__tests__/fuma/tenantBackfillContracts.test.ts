import { describe, expect, it } from 'bun:test'
import {
  TenantKeyContractError,
  validateTenantKeyBackfillReceipt,
  validateTenantKeyBackfillRun,
  validateTenantOwnerKeyRecord,
  validateTenantResourceOwnership,
} from '../../../server/fuma/tenancy'

const NOW = '2026-07-25T07:15:31.244Z'
const HASH = 'a'.repeat(64)
const coordinate = {
  platformId: 'fuma',
  organizationId: 'organization-one',
  workspaceId: 'workspace-one',
  siteId: 'site-one',
}

const completeReceipt = {
  backfillId: 'backfill-one',
  classId: 'content.data-row',
  sourceName: 'data_rows',
  state: 'complete',
  resumeCursor: { legacyId: 'row-9' },
  sourceCount: 9,
  mappedCount: 9,
  sourceContentHash: HASH,
  mappedContentHash: HASH,
  sourceForeignKeyCount: 9,
  validForeignKeyCount: 9,
  foreignKeyEvidence: [{
    sourceClassId: 'content.data-row',
    sourceColumns: ['table_id'],
    targetClassId: 'content.data-table',
    targetColumns: ['id'],
    checkedCount: 9,
    validCount: 9,
  }],
  failure: null,
  updatedAt: NOW,
  completedAt: NOW,
} as const

function expectContractCode(run: () => unknown, code: TenantKeyContractError['code']): void {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(TenantKeyContractError)
    if (!(error instanceof TenantKeyContractError)) throw error
    expect(error.code).toBe(code)
    return
  }
  throw new Error(`Expected TenantKeyContractError with code ${code}.`)
}

describe('FUMA-024 tenant-key contracts and backfill evidence', () => {
  it('validates active and transfer-fenced owner directory records', () => {
    const active = validateTenantOwnerKeyRecord({
      ownerKey: 'owner-key-one',
      coordinate,
      state: 'active',
      generation: 1,
      transferId: null,
      transferLockId: null,
      transferFence: null,
      createdAt: NOW,
      updatedAt: NOW,
    })
    expect(active.coordinate).toEqual(coordinate)

    expect(validateTenantOwnerKeyRecord({
      ...active,
      state: 'transferring',
      generation: 2,
      transferId: 'transfer-one',
      transferLockId: 'lock-one',
      transferFence: 7,
    }).transferId).toBe('transfer-one')
    expectContractCode(
      () => validateTenantOwnerKeyRecord({ ...active, transferId: 'transfer-one' }),
      'invalid-owner-state',
    )
  })

  it('preserves direct legacy identities for rows and checksummed objects', () => {
    expect(validateTenantResourceOwnership({
      ownerKey: 'owner-key-one',
      coordinate,
      resourceKind: 'table-row',
      classId: 'media.asset-folder',
      sourceName: 'media_asset_folders',
      legacyId: 'asset-one/folder-one',
      legacyIdentity: { asset_id: 'asset-one', folder_id: 'folder-one' },
      objectKey: null,
      contentHash: HASH,
      sizeBytes: null,
      createdAt: NOW,
      updatedAt: NOW,
    }).legacyIdentity).toEqual({ asset_id: 'asset-one', folder_id: 'folder-one' })

    expect(validateTenantResourceOwnership({
      ownerKey: 'owner-key-one',
      coordinate,
      resourceKind: 'object',
      classId: 'objects.media',
      sourceName: 'media_assets.storage_path',
      legacyId: 'media/original.jpg',
      legacyIdentity: { storage_path: 'media/original.jpg' },
      objectKey: 'media/original.jpg',
      contentHash: HASH,
      sizeBytes: 4096,
      createdAt: NOW,
      updatedAt: NOW,
    }).sizeBytes).toBe(4096)

    expectContractCode(() => validateTenantResourceOwnership({
      ownerKey: 'owner-key-one',
      coordinate,
      resourceKind: 'object',
      classId: 'objects.media',
      sourceName: 'media_assets.storage_path',
      legacyId: 'media/original.jpg',
      legacyIdentity: { storage_path: 'media/original.jpg' },
      objectKey: 'media/original.jpg',
      contentHash: null,
      sizeBytes: 4096,
      createdAt: NOW,
      updatedAt: NOW,
    }), 'invalid-contract')
  })

  it('accepts resumable running progress and exact complete run totals', () => {
    expect(validateTenantKeyBackfillRun({
      id: 'backfill-one',
      ownerKey: 'owner-key-one',
      coordinate,
      sourceFingerprint: HASH,
      inventoryVersion: 'tenant-keys-v1',
      state: 'running',
      expectedClassCount: 30,
      completedClassCount: 12,
      expectedResourceCount: 200,
      mappedResourceCount: 90,
      failure: null,
      startedAt: NOW,
      updatedAt: NOW,
      completedAt: null,
    }).mappedResourceCount).toBe(90)

    expect(validateTenantKeyBackfillRun({
      id: 'backfill-one',
      ownerKey: 'owner-key-one',
      coordinate,
      sourceFingerprint: HASH,
      inventoryVersion: 'tenant-keys-v1',
      state: 'complete',
      expectedClassCount: 30,
      completedClassCount: 30,
      expectedResourceCount: 200,
      mappedResourceCount: 200,
      failure: null,
      startedAt: NOW,
      updatedAt: NOW,
      completedAt: NOW,
    }).state).toBe('complete')
  })

  it('accepts a complete receipt only when count, hash, and FK evidence reconcile', () => {
    expect(validateTenantKeyBackfillReceipt(completeReceipt)).toEqual(completeReceipt)

    expectContractCode(
      () => validateTenantKeyBackfillReceipt({ ...completeReceipt, mappedCount: 8 }),
      'count-mismatch',
    )
    expectContractCode(
      () => validateTenantKeyBackfillReceipt({
        ...completeReceipt,
        mappedContentHash: 'b'.repeat(64),
      }),
      'hash-mismatch',
    )
    expectContractCode(
      () => validateTenantKeyBackfillReceipt({ ...completeReceipt, validForeignKeyCount: 8 }),
      'foreign-key-mismatch',
    )
    expectContractCode(
      () => validateTenantKeyBackfillReceipt({
        ...completeReceipt,
        foreignKeyEvidence: [{
          ...completeReceipt.foreignKeyEvidence[0],
          checkedCount: 8,
          validCount: 8,
        }],
      }),
      'foreign-key-evidence-mismatch',
    )
  })

  it('keeps failed receipts resumable with structured failure and no completion fact', () => {
    expect(validateTenantKeyBackfillReceipt({
      ...completeReceipt,
      state: 'failed',
      mappedCount: 4,
      sourceContentHash: null,
      mappedContentHash: null,
      validForeignKeyCount: 4,
      foreignKeyEvidence: [],
      failure: { code: 'interrupted', retryable: true },
      completedAt: null,
    })).toMatchObject({
      state: 'failed',
      resumeCursor: { legacyId: 'row-9' },
      failure: { code: 'interrupted', retryable: true },
    })
  })
})

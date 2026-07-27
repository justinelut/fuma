import { describe, expect, it } from 'bun:test'
import {
  createTenantObjectCopyProgressReceipt,
  createTenantObjectCopyReceipt,
  createTenantObjectManifest,
  createTenantObjectPolicySnapshot,
  createTenantObjectRebindReceipt,
  type TenantObjectCopyProgressReceipt,
  type TenantObjectManifest,
  type TenantObjectPolicySnapshot,
  type TenantObjectRebindReceipt,
  type TenantObjectScope,
} from '../../../server/fuma/tenantObjects'
import {
  BASE_OWNERSHIP_TRANSFER_STEP_ID,
  BASE_OWNERSHIP_TRANSFER_STEP_ORDER,
  OBJECT_COPY_TRANSFER_STEP_ID,
  OBJECT_COPY_TRANSFER_STEP_ORDER,
  OBJECT_OWNERSHIP_POLICY_TRANSFER_STEP_ID,
  OBJECT_OWNERSHIP_POLICY_TRANSFER_STEP_ORDER,
  ObjectOwnershipPolicyTransferError,
  createObjectOwnershipPolicyTransferStep,
  createTransferStepRegistry,
  type ObjectOwnershipPolicyAdapter,
  type ObjectOwnershipPolicyAtomicInput,
  type ObjectOwnershipPolicyAtomicResult,
  type ObjectOwnershipPolicyInspection,
  type ObjectOwnershipPolicyOperationInput,
  type TransferManifest,
  type TransferReceipt,
  type TransferStepDefinition,
  type TransferStepExecutionInput,
} from '../../../server/fuma/transfers'

const SOURCE: TenantObjectScope = {
  organizationId: 'organization-source',
  workspaceId: 'workspace-source',
  siteId: 'site-primary',
}
const DESTINATION: TenantObjectScope = {
  organizationId: 'organization-destination',
  workspaceId: 'workspace-destination',
  siteId: 'site-primary',
}
const CAPTURED_AT = '2026-07-25T07:00:00.000Z'
const COPIED_AT = '2026-07-25T07:01:00.000Z'
const REBOUND_AT = '2026-07-25T07:02:00.000Z'
const RESTORED_AT = '2026-07-25T07:03:00.000Z'
const SAGA = {
  transferId: 'transfer-object-policy',
  lockId: 'lock-object-policy',
  fence: 11,
} as const

function transferManifest(): TransferManifest {
  return {
    schemaVersion: 1,
    transferId: SAGA.transferId,
    source: { platformId: 'platform-fuma', ...SOURCE },
    destination: { platformId: 'platform-fuma', ...DESTINATION },
    siteProfileId: 'website',
    siteCapabilityOverrides: { grant: [], revoke: [] },
    siteCapabilityIds: ['site.settings'],
    snapshotChecksum: 'c'.repeat(64),
    resources: ['site-record'],
    collaborators: [],
    capturedAt: CAPTURED_AT,
  }
}

function objectManifest(): TenantObjectManifest {
  return createTenantObjectManifest({
    transferId: SAGA.transferId,
    source: SOURCE,
    destination: DESTINATION,
    inventory: [
      {
        objectClass: 'media',
        logicalKey: 'media/media-01/hero.png',
        sizeBytes: 16,
        mimeType: 'image/png',
        contentChecksumSha256: 'a'.repeat(64),
        metadata: { mediaId: 'media-01' },
      },
      {
        objectClass: 'publish-release',
        logicalKey: 'publish/releases/release-01/index.html',
        sizeBytes: 24,
        mimeType: 'text/html',
        contentChecksumSha256: 'b'.repeat(64),
        metadata: { releaseId: 'release-01' },
      },
    ],
    capturedAt: CAPTURED_AT,
  })
}

function completeProgress(manifest: TenantObjectManifest): TenantObjectCopyProgressReceipt {
  return createTenantObjectCopyProgressReceipt(
    manifest,
    SAGA,
    manifest.entries.map((entry) => createTenantObjectCopyReceipt({
      manifest,
      saga: SAGA,
      logicalKey: entry.logicalKey,
      disposition: 'copy',
      copiedAt: COPIED_AT,
    })),
    COPIED_AT,
  )
}

function activePolicy(
  scope: TenantObjectScope,
  version: number,
  capturedAt: string,
): TenantObjectPolicySnapshot {
  return createTenantObjectPolicySnapshot({
    namespace: scope,
    owner: scope,
    state: 'active',
    version,
    bindings: [
      { principalKind: 'site', principalId: scope.siteId, actions: ['read', 'write', 'list', 'delete'] },
      { principalKind: 'workspace', principalId: scope.workspaceId, actions: ['read', 'list'] },
    ],
    capturedAt,
  })
}

function sealedPolicy(
  scope: TenantObjectScope,
  version: number,
  capturedAt: string,
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

function execution(
  receipt: TransferReceipt | null = null,
  fence = SAGA.fence,
): TransferStepExecutionInput {
  return {
    manifest: transferManifest(),
    saga: { ...SAGA, fence },
    receipt,
  }
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

const ADAPTER_SURFACE = {
  inspectObjectOwnershipPolicy: true,
  switchObjectOwnershipPolicy: true,
  restoreObjectOwnershipPolicy: true,
} as const satisfies Record<keyof ObjectOwnershipPolicyAdapter, true>

class InMemoryObjectPolicyAdapter implements ObjectOwnershipPolicyAdapter {
  objectManifest: TenantObjectManifest | null = objectManifest()
  copyProgressReceipt: TenantObjectCopyProgressReceipt | null = completeProgress(this.objectManifest)
  sourcePolicy = activePolicy(SOURCE, 7, CAPTURED_AT)
  destinationPolicy = sealedPolicy(DESTINATION, 13, CAPTURED_AT)
  rebindReceipt: TenantObjectRebindReceipt | null = null
  currentFence = SAGA.fence
  currentLockId = SAGA.lockId
  proposalMatches = true
  switchEffects = 0
  restoreEffects = 0
  driftBeforeAtomicSwitch = false
  staleBeforeAtomicSwitch = false
  events: string[] = []

  inspectObjectOwnershipPolicy(
    input: ObjectOwnershipPolicyOperationInput,
  ): Promise<ObjectOwnershipPolicyInspection> {
    return Promise.resolve(this.inspection(input))
  }

  switchObjectOwnershipPolicy(
    input: ObjectOwnershipPolicyAtomicInput,
  ): Promise<ObjectOwnershipPolicyAtomicResult> {
    if (this.driftBeforeAtomicSwitch) {
      this.driftBeforeAtomicSwitch = false
      this.copyProgressReceipt = null
    }
    if (this.staleBeforeAtomicSwitch) {
      this.staleBeforeAtomicSwitch = false
      this.currentFence += 1
    }
    const before = this.inspection(input)
    const rejection = this.rejection(input, before)
    if (rejection) return Promise.resolve(rejection)
    if (this.rebindReceipt) {
      return Promise.resolve({
        status: input.rebindReceipt === null || same(input.rebindReceipt, this.rebindReceipt)
          ? 'replayed'
          : 'policy-conflict',
        inspection: before,
      })
    }
    if (!this.objectManifest || !this.copyProgressReceipt
      || this.sourcePolicy.state !== 'active'
      || this.destinationPolicy.state !== 'sealed') {
      return Promise.resolve({ status: 'policy-conflict', inspection: before })
    }

    const sourceAfter = sealedPolicy(SOURCE, this.sourcePolicy.version + 1, REBOUND_AT)
    const destinationAfter = activePolicy(
      DESTINATION,
      this.destinationPolicy.version + 1,
      REBOUND_AT,
    )
    this.rebindReceipt = createTenantObjectRebindReceipt({
      manifest: this.objectManifest,
      saga: input.saga,
      copyProgress: this.copyProgressReceipt,
      sourceBefore: this.sourcePolicy,
      destinationBefore: this.destinationPolicy,
      sourceAfter,
      destinationAfter,
      reboundAt: REBOUND_AT,
    })
    this.sourcePolicy = sourceAfter
    this.destinationPolicy = destinationAfter
    this.switchEffects += 1
    this.events.push('switch-destination-policy')
    return Promise.resolve({ status: 'applied', inspection: this.inspection(input) })
  }

  restoreObjectOwnershipPolicy(
    input: ObjectOwnershipPolicyAtomicInput,
  ): Promise<ObjectOwnershipPolicyAtomicResult> {
    const before = this.inspection(input)
    const rejection = this.rejection(input, before)
    if (rejection) return Promise.resolve(rejection)
    if (!this.rebindReceipt || !same(input.rebindReceipt, this.rebindReceipt)) {
      return Promise.resolve({ status: 'policy-conflict', inspection: before })
    }
    if (this.sourcePolicy.state === 'active' && this.destinationPolicy.state === 'sealed') {
      return Promise.resolve({ status: 'replayed', inspection: before })
    }
    this.sourcePolicy = activePolicy(SOURCE, this.sourcePolicy.version + 1, RESTORED_AT)
    this.destinationPolicy = sealedPolicy(
      DESTINATION,
      this.destinationPolicy.version + 1,
      RESTORED_AT,
    )
    this.restoreEffects += 1
    this.events.push('restore-source-policy')
    return Promise.resolve({ status: 'compensated', inspection: this.inspection(input) })
  }

  deleteDestinationCopies(): void {
    if (this.sourcePolicy.state !== 'active') {
      throw new Error('destination copies cannot be removed before source authorization is restored')
    }
    this.events.push('delete-destination-copies')
  }

  private rejection(
    input: ObjectOwnershipPolicyAtomicInput,
    inspection: ObjectOwnershipPolicyInspection,
  ): ObjectOwnershipPolicyAtomicResult | null {
    if (!inspection.proposalMatches) return { status: 'ancestry-conflict', inspection }
    if (!inspection.fenceMatches) return { status: 'stale-fence', inspection }
    if (!this.objectManifest || !this.copyProgressReceipt
      || input.manifestChecksumSha256 !== this.objectManifest.manifestChecksumSha256
      || input.copyProgressReceiptChecksumSha256
        !== this.copyProgressReceipt.receiptChecksumSha256) {
      return { status: 'manifest-conflict', inspection }
    }
    return null
  }

  private inspection(
    input: ObjectOwnershipPolicyOperationInput,
  ): ObjectOwnershipPolicyInspection {
    return structuredClone({
      proposalMatches: this.proposalMatches,
      fenceMatches: input.saga.fence === this.currentFence
        && input.saga.lockId === this.currentLockId,
      objectManifest: this.objectManifest,
      copyProgressReceipt: this.copyProgressReceipt,
      sourcePolicy: this.sourcePolicy,
      destinationPolicy: this.destinationPolicy,
      rebindReceipt: this.rebindReceipt,
    })
  }
}

function policyError(code: ObjectOwnershipPolicyTransferError['code']) {
  return expect.objectContaining({
    name: 'ObjectOwnershipPolicyTransferError',
    code,
  })
}

function noopStep(
  id: string,
  order: number,
  dependsOn: readonly string[],
  mandatory = false,
): TransferStepDefinition {
  return {
    id,
    order,
    dependsOn,
    mandatory,
    async apply() { return { code: `${id}-applied`, details: {} } },
    async verify() { return { status: 'not-applied', receipt: null } },
    async compensate() { return { status: 'not-applied', receipt: null } },
  }
}

describe('FUMA-024 object ownership policy transfer step', () => {
  it('is a mandatory final definition depending on mandatory verified object copy', () => {
    const policy = createObjectOwnershipPolicyTransferStep(new InMemoryObjectPolicyAdapter())
    expect(policy).toMatchObject({
      id: OBJECT_OWNERSHIP_POLICY_TRANSFER_STEP_ID,
      order: OBJECT_OWNERSHIP_POLICY_TRANSFER_STEP_ORDER,
      dependsOn: [OBJECT_COPY_TRANSFER_STEP_ID],
      mandatory: true,
    })
    expect(Object.keys(ADAPTER_SURFACE)).toEqual([
      'inspectObjectOwnershipPolicy',
      'switchObjectOwnershipPolicy',
      'restoreObjectOwnershipPolicy',
    ])

    const registry = createTransferStepRegistry([
      noopStep(
        BASE_OWNERSHIP_TRANSFER_STEP_ID,
        BASE_OWNERSHIP_TRANSFER_STEP_ORDER,
        [],
        true,
      ),
      noopStep(
        OBJECT_COPY_TRANSFER_STEP_ID,
        OBJECT_COPY_TRANSFER_STEP_ORDER,
        [BASE_OWNERSHIP_TRANSFER_STEP_ID],
        true,
      ),
      policy,
    ])
    expect(registry.compose([]).map(({ id }) => id)).toEqual([
      BASE_OWNERSHIP_TRANSFER_STEP_ID,
      OBJECT_COPY_TRANSFER_STEP_ID,
      OBJECT_OWNERSHIP_POLICY_TRANSFER_STEP_ID,
    ])
    expect(registry.compose([]).every(({ mandatory }) => mandatory)).toBe(true)
  })

  it('switches only after complete canonical copy evidence and persists one rebind receipt', async () => {
    const adapter = new InMemoryObjectPolicyAdapter()
    const step = createObjectOwnershipPolicyTransferStep(adapter)
    const receipt = await step.apply(execution())

    expect(adapter.sourcePolicy.state).toBe('sealed')
    expect(adapter.destinationPolicy.state).toBe('active')
    expect(adapter.rebindReceipt).not.toBeNull()
    expect(receipt).toMatchObject({
      code: 'tenant-object-ownership-policy-rebound',
      details: {
        transferId: SAGA.transferId,
        lockId: SAGA.lockId,
        fence: SAGA.fence,
        entryCount: 2,
        totalSizeBytes: 40,
        rebindReceiptChecksumSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    })
    expect(adapter.switchEffects).toBe(1)
  })

  it('rejects missing, partial, atomically drifted, and stale copy evidence without policy exposure', async () => {
    const missing = new InMemoryObjectPolicyAdapter()
    missing.copyProgressReceipt = null
    await expect(createObjectOwnershipPolicyTransferStep(missing).apply(execution()))
      .rejects.toEqual(policyError('incomplete-object-copy'))
    expect(missing.sourcePolicy.state).toBe('active')

    const partial = new InMemoryObjectPolicyAdapter()
    partial.copyProgressReceipt = createTenantObjectCopyProgressReceipt(
      partial.objectManifest!,
      SAGA,
      [partial.copyProgressReceipt!.completed[0]],
      COPIED_AT,
    )
    await expect(createObjectOwnershipPolicyTransferStep(partial).apply(execution()))
      .rejects.toEqual(policyError('incomplete-object-copy'))

    const raced = new InMemoryObjectPolicyAdapter()
    raced.driftBeforeAtomicSwitch = true
    await expect(createObjectOwnershipPolicyTransferStep(raced).apply(execution()))
      .rejects.toEqual(policyError('incomplete-object-copy'))
    expect(raced.switchEffects).toBe(0)

    const stale = new InMemoryObjectPolicyAdapter()
    stale.staleBeforeAtomicSwitch = true
    await expect(createObjectOwnershipPolicyTransferStep(stale).apply(execution()))
      .rejects.toEqual(policyError('stale-fence'))
    expect(stale.switchEffects).toBe(0)
  })

  it('rejects stale fences and ancestry substitutions before policy mutation', async () => {
    const stale = new InMemoryObjectPolicyAdapter()
    await expect(createObjectOwnershipPolicyTransferStep(stale).apply(execution(null, 10)))
      .rejects.toEqual(policyError('stale-fence'))

    const substituted = new InMemoryObjectPolicyAdapter()
    substituted.proposalMatches = false
    await expect(createObjectOwnershipPolicyTransferStep(substituted).apply(execution()))
      .rejects.toEqual(policyError('transfer-ancestry-mismatch'))
    expect(substituted.switchEffects).toBe(0)
  })

  it('deduplicates apply and verifies replay against the same manifest, copy, rebind, and fence', async () => {
    const adapter = new InMemoryObjectPolicyAdapter()
    const step = createObjectOwnershipPolicyTransferStep(adapter)
    const receipt = await step.apply(execution())

    await expect(step.apply(execution(receipt))).resolves.toEqual(receipt)
    await expect(step.verify(execution(receipt))).resolves.toEqual({
      status: 'verified',
      receipt,
    })
    expect(adapter.switchEffects).toBe(1)

    await expect(step.apply(execution({
      ...receipt,
      details: { ...receipt.details, entryCount: 3 },
    }))).rejects.toEqual(policyError('receipt-mismatch'))
  })

  it('restores source authorization before copy cleanup and replays compensation', async () => {
    const adapter = new InMemoryObjectPolicyAdapter()
    const step = createObjectOwnershipPolicyTransferStep(adapter)
    const receipt = await step.apply(execution())

    expect(() => adapter.deleteDestinationCopies()).toThrow('before source authorization')
    await expect(step.compensate(execution(receipt))).resolves.toMatchObject({
      status: 'compensated',
      receipt: { code: 'tenant-object-ownership-policy-restored' },
    })
    adapter.deleteDestinationCopies()
    expect(adapter.events).toEqual([
      'switch-destination-policy',
      'restore-source-policy',
      'delete-destination-copies',
    ])
    expect(adapter.sourcePolicy.state).toBe('active')
    expect(adapter.destinationPolicy.state).toBe('sealed')
    expect(adapter.restoreEffects).toBe(1)

    await expect(step.compensate(execution(receipt))).resolves.toMatchObject({
      status: 'compensated',
    })
    expect(adapter.restoreEffects).toBe(1)
  })

  it('rejects stale compensation without restoring policy under a superseded fence', async () => {
    const adapter = new InMemoryObjectPolicyAdapter()
    const step = createObjectOwnershipPolicyTransferStep(adapter)
    const receipt = await step.apply(execution())
    adapter.currentFence = 12

    await expect(step.compensate(execution(receipt)))
      .rejects.toEqual(policyError('stale-fence'))
    expect(adapter.sourcePolicy.state).toBe('sealed')
    expect(adapter.restoreEffects).toBe(0)
  })
})

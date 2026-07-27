import { describe, expect, it } from 'bun:test'
import type { CapabilityOverrides } from '@core/fuma'
import {
  BaseOwnershipTransferError,
  createBaseOwnershipReceipt,
  createBaseOwnershipTransferStep,
  type BaseOwnershipAdapter,
  type BaseOwnershipAtomicResult,
  type BaseOwnershipInspection,
  type BaseOwnershipOperationInput,
  type BaseOwnershipSite,
  type BaseOwnershipWorkspace,
  type CapturedCollaboratorIntent,
  type TransferManifest,
  type TransferOwnershipCoordinate,
  type TransferReceipt,
  type TransferStepExecutionInput,
} from '../../../server/fuma/transfers'

const SOURCE: TransferOwnershipCoordinate = {
  platformId: 'platform-fuma',
  organizationId: 'organization-source',
  workspaceId: 'workspace-source',
  siteId: 'site-primary',
}
const DESTINATION: TransferOwnershipCoordinate = {
  platformId: 'platform-fuma',
  organizationId: 'organization-destination',
  workspaceId: 'workspace-destination',
  siteId: 'site-primary',
}
const OVERRIDES: CapabilityOverrides = {
  grant: ['publication.editorial'],
  revoke: ['website.analytics'],
}
const NOW = '2026-07-25T05:40:35.111Z'

function manifest(): TransferManifest {
  return {
    schemaVersion: 1,
    transferId: 'transfer-01',
    source: SOURCE,
    destination: DESTINATION,
    siteProfileId: 'website',
    siteCapabilityOverrides: {
      grant: [...OVERRIDES.grant],
      revoke: [...OVERRIDES.revoke],
    },
    siteCapabilityIds: ['publication.editorial'],
    snapshotChecksum: 'a'.repeat(64),
    resources: ['site-record', 'content', 'media'],
    collaborators: [
      {
        userId: 'user-editor',
        sourceRole: 'editor',
        intent: 'preserve',
        destinationRole: 'editor',
      },
      {
        userId: 'user-viewer',
        sourceRole: 'viewer',
        intent: 'remove',
        destinationRole: null,
      },
    ],
    capturedAt: NOW,
  }
}

function execution(
  fence = 7,
  receipt: TransferReceipt | null = null,
): TransferStepExecutionInput {
  return {
    manifest: manifest(),
    saga: {
      transferId: 'transfer-01',
      lockId: 'lock-transfer-01',
      fence,
    },
    receipt,
  }
}

function site(
  coordinate: TransferOwnershipCoordinate = SOURCE,
  ownershipReceipt: TransferReceipt | null = null,
): BaseOwnershipSite {
  return {
    coordinate: { ...coordinate },
    profileId: 'website',
    capabilityOverrides: {
      grant: [...OVERRIDES.grant],
      revoke: [...OVERRIDES.revoke],
    },
    ownershipReceipt,
  }
}

function workspace(status: 'active' | 'archived' = 'active'): BaseOwnershipWorkspace {
  return {
    platformId: DESTINATION.platformId,
    organizationId: DESTINATION.organizationId,
    workspaceId: DESTINATION.workspaceId,
    status,
  }
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

const BASE_OWNERSHIP_ADAPTER_SURFACE = {
  inspectBaseOwnership: true,
  publishBaseOwnership: true,
  restoreBaseOwnership: true,
} as const satisfies Record<keyof BaseOwnershipAdapter, true>

class InMemoryOwnershipAdapter implements BaseOwnershipAdapter {
  sites: BaseOwnershipSite[] = [site()]
  destinationWorkspace: BaseOwnershipWorkspace | null = workspace()
  intents: CapturedCollaboratorIntent[] = []
  currentFence = 7
  currentLockId = 'lock-transfer-01'
  proposalMatches = true
  faultAfterIntentStage = false
  faultAfterOwnershipStage = false
  faultAfterIntentDiscardStage = false
  faultAfterOwnershipRestoreStage = false
  publishEffects = 0
  restoreEffects = 0

  inspectBaseOwnership(input: BaseOwnershipOperationInput): Promise<BaseOwnershipInspection> {
    return Promise.resolve(this.inspection(input))
  }

  async publishBaseOwnership(
    input: BaseOwnershipOperationInput,
  ): Promise<BaseOwnershipAtomicResult> {
    const before = this.inspection(input)
    if (!before.proposalMatches) return { status: 'ancestry-conflict', inspection: before }
    if (!before.fenceMatches) return { status: 'stale-fence', inspection: before }
    if (!this.destinationWorkspace || this.destinationWorkspace.status !== 'active') {
      return { status: 'ancestry-conflict', inspection: before }
    }
    if (this.sites.length !== 1) return { status: 'ownership-conflict', inspection: before }
    const current = this.sites[0]
    if (!current) return { status: 'ownership-conflict', inspection: before }
    if (same(current.coordinate, input.manifest.destination)) {
      return {
        status: same(this.intents, this.expectedIntents(input)) ? 'replayed' : 'intent-conflict',
        inspection: before,
      }
    }
    if (!same(current.coordinate, input.manifest.source)) {
      return { status: 'ownership-conflict', inspection: before }
    }
    if (this.intents.length > 0) return { status: 'intent-conflict', inspection: before }

    const stagedIntents = this.expectedIntents(input)
    if (this.faultAfterIntentStage) {
      this.faultAfterIntentStage = false
      throw new Error('fault between intent publication and ownership rebind')
    }
    const stagedSites = [{
      ...structuredClone(current),
      coordinate: { ...input.manifest.destination },
      ownershipReceipt: createBaseOwnershipReceipt(input.manifest, input.saga),
    }]
    if (this.faultAfterOwnershipStage) {
      this.faultAfterOwnershipStage = false
      throw new Error('fault after ownership rebind before atomic commit')
    }

    this.intents = stagedIntents
    this.sites = stagedSites
    this.publishEffects += 1
    return { status: 'applied', inspection: this.inspection(input) }
  }

  async restoreBaseOwnership(
    input: BaseOwnershipOperationInput,
  ): Promise<BaseOwnershipAtomicResult> {
    const before = this.inspection(input)
    if (!before.proposalMatches) return { status: 'ancestry-conflict', inspection: before }
    if (!before.fenceMatches) return { status: 'stale-fence', inspection: before }
    if (!this.destinationWorkspace) return { status: 'ancestry-conflict', inspection: before }
    if (this.sites.length !== 1) return { status: 'ownership-conflict', inspection: before }
    const current = this.sites[0]
    if (!current) return { status: 'ownership-conflict', inspection: before }
    if (same(current.coordinate, input.manifest.source)) {
      return {
        status: this.intents.length === 0 ? 'replayed' : 'intent-conflict',
        inspection: before,
      }
    }
    if (!same(current.coordinate, input.manifest.destination)) {
      return { status: 'ownership-conflict', inspection: before }
    }
    if (!same(this.intents, this.expectedIntents(input))) {
      return { status: 'intent-conflict', inspection: before }
    }

    const stagedIntents: CapturedCollaboratorIntent[] = []
    if (this.faultAfterIntentDiscardStage) {
      this.faultAfterIntentDiscardStage = false
      throw new Error('fault between intent discard and ownership restore')
    }
    const stagedSites = [{
      ...structuredClone(current),
      coordinate: { ...input.manifest.source },
      ownershipReceipt: null,
    }]
    if (this.faultAfterOwnershipRestoreStage) {
      this.faultAfterOwnershipRestoreStage = false
      throw new Error('fault after ownership restore before atomic commit')
    }

    this.intents = stagedIntents
    this.sites = stagedSites
    this.restoreEffects += 1
    return { status: 'compensated', inspection: this.inspection(input) }
  }

  private expectedIntents(input: BaseOwnershipOperationInput): CapturedCollaboratorIntent[] {
    return input.manifest.collaborators.map((collaborator) => ({
      collaborator: structuredClone(collaborator),
      state: 'pending',
    }))
  }

  private inspection(input: BaseOwnershipOperationInput): BaseOwnershipInspection {
    return structuredClone({
      proposalMatches: this.proposalMatches,
      fenceMatches: input.saga.fence === this.currentFence
        && input.saga.lockId === this.currentLockId,
      destinationWorkspace: this.destinationWorkspace,
      sites: this.sites,
      collaboratorIntents: this.intents,
    })
  }
}

function ownershipError(code: BaseOwnershipTransferError['code']) {
  return expect.objectContaining({ name: 'BaseOwnershipTransferError', code })
}

describe('FUMA-023 base ownership transfer step', () => {
  it('publishes a stable definition ID through an atomic base-only adapter surface', () => {
    const step = createBaseOwnershipTransferStep(new InMemoryOwnershipAdapter())

    expect(step.id).toBe('transfer.base-ownership')
    expect(Object.keys(BASE_OWNERSHIP_ADAPTER_SURFACE)).toEqual([
      'inspectBaseOwnership',
      'publishBaseOwnership',
      'restoreBaseOwnership',
    ])
  })

  it('rejects profile and exact capability-override snapshot drift before mutation', async () => {
    const profileAdapter = new InMemoryOwnershipAdapter()
    profileAdapter.sites[0] = { ...profileAdapter.sites[0], profileId: 'publication' }
    await expect(createBaseOwnershipTransferStep(profileAdapter).apply(execution()))
      .rejects.toEqual(ownershipError('profile-mismatch'))
    expect(profileAdapter.publishEffects).toBe(0)

    const capabilityAdapter = new InMemoryOwnershipAdapter()
    capabilityAdapter.sites[0] = {
      ...capabilityAdapter.sites[0],
      capabilityOverrides: { grant: [], revoke: [...OVERRIDES.revoke] },
    }
    await expect(createBaseOwnershipTransferStep(capabilityAdapter).apply(execution()))
      .rejects.toEqual(ownershipError('capability-overrides-mismatch'))
    expect(capabilityAdapter.publishEffects).toBe(0)
  })

  it('rolls back both sides when publish faults between either staged half and commit', async () => {
    for (const fault of ['faultAfterIntentStage', 'faultAfterOwnershipStage'] as const) {
      const adapter = new InMemoryOwnershipAdapter()
      adapter[fault] = true
      const step = createBaseOwnershipTransferStep(adapter)

      await expect(step.apply(execution())).rejects.toThrow('fault')
      expect(adapter.sites).toEqual([site()])
      expect(adapter.intents).toEqual([])
      expect(adapter.publishEffects).toBe(0)

      await expect(step.apply(execution())).resolves.toMatchObject({
        code: 'base-ownership-rebound',
      })
      expect(adapter.publishEffects).toBe(1)
    }
  })

  it('replays duplicate execution with one atomic effect and one exact receipt', async () => {
    const adapter = new InMemoryOwnershipAdapter()
    const step = createBaseOwnershipTransferStep(adapter)

    const receipt = await step.apply(execution())
    const duplicate = await step.apply(execution(7, receipt))

    expect(duplicate).toEqual(receipt)
    expect(adapter.sites[0].ownershipReceipt).toEqual(receipt)
    expect(adapter.publishEffects).toBe(1)
    expect(adapter.intents).toHaveLength(2)
  })

  it('rejects stale fence and lock ID before either atomic side changes', async () => {
    const staleFence = new InMemoryOwnershipAdapter()
    await expect(createBaseOwnershipTransferStep(staleFence).apply(execution(6)))
      .rejects.toEqual(ownershipError('stale-fence'))
    expect(staleFence.sites).toEqual([site()])
    expect(staleFence.intents).toEqual([])

    const staleLock = new InMemoryOwnershipAdapter()
    staleLock.currentLockId = 'lock-new'
    await expect(createBaseOwnershipTransferStep(staleLock).apply(execution()))
      .rejects.toEqual(ownershipError('stale-fence'))
    expect(staleLock.publishEffects).toBe(0)
  })

  it('rejects a durable proposal ancestry mismatch before mutation', async () => {
    const adapter = new InMemoryOwnershipAdapter()
    adapter.proposalMatches = false

    await expect(createBaseOwnershipTransferStep(adapter).apply(execution()))
      .rejects.toEqual(ownershipError('transfer-ancestry-mismatch'))
    expect(adapter.publishEffects).toBe(0)
  })

  it('preserves profile and overrides while publishing exact pending intent', async () => {
    const adapter = new InMemoryOwnershipAdapter()
    const step = createBaseOwnershipTransferStep(adapter)
    const receipt = await step.apply(execution())

    await expect(step.verify(execution(7, receipt))).resolves.toEqual({
      status: 'verified',
      receipt,
    })
    expect(adapter.sites[0]).toMatchObject({
      coordinate: DESTINATION,
      profileId: 'website',
      capabilityOverrides: OVERRIDES,
    })
    expect(receipt.details).toMatchObject({
      transferId: 'transfer-01',
      lockId: 'lock-transfer-01',
      fence: 7,
      source: SOURCE,
      destination: DESTINATION,
      profileId: 'website',
      capabilityOverrides: OVERRIDES,
    })
    expect(adapter.intents).toEqual(manifest().collaborators.map((collaborator) => ({
      collaborator,
      state: 'pending',
    })))
  })

  it('detects verification drift in profile, overrides, receipt, and pending intent', async () => {
    const adapter = new InMemoryOwnershipAdapter()
    const step = createBaseOwnershipTransferStep(adapter)
    const receipt = await step.apply(execution())

    adapter.sites[0] = { ...adapter.sites[0], profileId: 'publication' }
    await expect(step.verify(execution(7, receipt)))
      .rejects.toEqual(ownershipError('profile-mismatch'))

    adapter.sites[0] = { ...adapter.sites[0], profileId: 'website' }
    const exactSite = adapter.sites[0]
    adapter.sites[0] = { ...exactSite, capabilityOverrides: { grant: [], revoke: [] } }
    await expect(step.verify(execution(7, receipt)))
      .rejects.toEqual(ownershipError('capability-overrides-mismatch'))

    adapter.sites[0] = exactSite
    adapter.intents = adapter.intents.slice(0, 1)
    await expect(step.verify(execution(7, receipt)))
      .rejects.toEqual(ownershipError('collaborator-intent-drift'))

    adapter.intents = manifest().collaborators.map((collaborator) => ({
      collaborator,
      state: 'pending',
    }))
    const wrongReceipt: TransferReceipt = {
      code: receipt.code,
      details: { ...receipt.details, fence: 8 },
    }
    await expect(step.verify(execution(7, wrongReceipt)))
      .rejects.toEqual(ownershipError('receipt-mismatch'))
  })

  it('rolls back both sides when compensation faults between either staged half and commit', async () => {
    for (const fault of [
      'faultAfterIntentDiscardStage',
      'faultAfterOwnershipRestoreStage',
    ] as const) {
      const adapter = new InMemoryOwnershipAdapter()
      const step = createBaseOwnershipTransferStep(adapter)
      const receipt = await step.apply(execution())
      const destinationSnapshot = structuredClone(adapter.sites)
      const intentSnapshot = structuredClone(adapter.intents)
      adapter[fault] = true

      await expect(step.compensate(execution(7, receipt))).rejects.toThrow('fault')
      expect(adapter.sites).toEqual(destinationSnapshot)
      expect(adapter.intents).toEqual(intentSnapshot)
      expect(adapter.restoreEffects).toBe(0)

      await expect(step.compensate(execution(7, receipt))).resolves.toMatchObject({
        status: 'compensated',
      })
      expect(adapter.sites).toEqual([site()])
      expect(adapter.intents).toEqual([])
    }
  })

  it('compensates idempotently only with the exact receipt and active fence', async () => {
    const adapter = new InMemoryOwnershipAdapter()
    const step = createBaseOwnershipTransferStep(adapter)

    await expect(step.compensate(execution())).resolves.toEqual({
      status: 'not-applied',
      receipt: null,
    })
    const receipt = await step.apply(execution())
    const wrongReceipt: TransferReceipt = {
      code: receipt.code,
      details: { ...receipt.details, lockId: 'lock-other' },
    }
    await expect(step.compensate(execution(7, wrongReceipt)))
      .rejects.toEqual(ownershipError('receipt-mismatch'))

    adapter.currentFence = 8
    await expect(step.compensate(execution(7, receipt)))
      .rejects.toEqual(ownershipError('stale-fence'))
    expect(adapter.sites[0].coordinate).toEqual(DESTINATION)

    adapter.currentFence = 7
    const compensated = await step.compensate(execution(7, receipt))
    expect(compensated).toEqual({
      status: 'compensated',
      receipt: {
        code: 'base-ownership-compensated',
        details: { applyReceipt: receipt },
      },
    })
    expect(adapter.sites).toEqual([site()])
    expect(adapter.intents).toEqual([])
    expect(adapter.restoreEffects).toBe(1)

    await expect(step.compensate(execution(7, receipt))).resolves.toMatchObject({
      status: 'compensated',
    })
    expect(adapter.restoreEffects).toBe(1)
  })

  it('rejects collisions and ownership outside both immutable ancestries', async () => {
    const collision = new InMemoryOwnershipAdapter()
    collision.sites.push(site(DESTINATION))
    await expect(createBaseOwnershipTransferStep(collision).apply(execution()))
      .rejects.toEqual(ownershipError('site-id-collision'))
    expect(collision.publishEffects).toBe(0)

    const unrelated = new InMemoryOwnershipAdapter()
    unrelated.sites = [site({
      ...SOURCE,
      organizationId: 'organization-unrelated',
      workspaceId: 'workspace-unrelated',
    })]
    await expect(createBaseOwnershipTransferStep(unrelated).apply(execution()))
      .rejects.toEqual(ownershipError('source-ownership-mismatch'))
    expect(unrelated.publishEffects).toBe(0)
  })

  it('requires the exact active destination workspace for apply', async () => {
    const wrongScope = new InMemoryOwnershipAdapter()
    wrongScope.destinationWorkspace = { ...workspace(), workspaceId: 'workspace-other' }
    await expect(createBaseOwnershipTransferStep(wrongScope).apply(execution()))
      .rejects.toEqual(ownershipError('destination-workspace-mismatch'))

    const archived = new InMemoryOwnershipAdapter()
    archived.destinationWorkspace = workspace('archived')
    await expect(createBaseOwnershipTransferStep(archived).apply(execution()))
      .rejects.toEqual(ownershipError('destination-workspace-mismatch'))
  })
})

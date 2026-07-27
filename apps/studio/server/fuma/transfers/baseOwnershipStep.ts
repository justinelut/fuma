import type { CapabilityOverrides } from '@core/fuma'
import type {
  TransferCollaboratorIntent,
  TransferCollaboratorState,
  TransferManifest,
  TransferOwnershipCoordinate,
  TransferReceipt,
} from './contracts'
import { assertTransferManifest } from './contracts'
import {
  BASE_OWNERSHIP_TRANSFER_STEP_ID,
  BASE_OWNERSHIP_TRANSFER_STEP_ORDER,
  type TransferSagaFence,
  type TransferStepCompensation,
  type TransferStepDefinition,
  type TransferStepExecutionInput,
  type TransferStepVerification,
} from './stepRegistry'

/** The ownership projection intentionally contains no content, tenant-key, or object-storage API. */
export type BaseOwnershipSite = Readonly<{
  coordinate: TransferOwnershipCoordinate
  profileId: string
  capabilityOverrides: CapabilityOverrides
  ownershipReceipt: TransferReceipt | null
}>

export type BaseOwnershipWorkspace = Readonly<{
  platformId: string
  organizationId: string
  workspaceId: string
  status: 'active' | 'archived'
}>

export type CapturedCollaboratorIntent = Readonly<{
  collaborator: TransferCollaboratorIntent
  state: TransferCollaboratorState
}>

export type BaseOwnershipOperationInput = Readonly<{
  saga: TransferSagaFence
  manifest: TransferManifest
}>

export type BaseOwnershipInspection = Readonly<{
  proposalMatches: boolean
  fenceMatches: boolean
  destinationWorkspace: BaseOwnershipWorkspace | null
  sites: readonly BaseOwnershipSite[]
  collaboratorIntents: readonly CapturedCollaboratorIntent[]
}>

export type BaseOwnershipAtomicResult = Readonly<{
  status:
    | 'applied'
    | 'compensated'
    | 'replayed'
    | 'stale-fence'
    | 'ancestry-conflict'
    | 'ownership-conflict'
    | 'intent-conflict'
  inspection: BaseOwnershipInspection
}>

/**
 * This port exposes one read model and two atomic fenced mutations. Implementations
 * must never publish destination site/owner-key ancestry separately from exact
 * pending intent, and must never restore either ancestry separately from
 * discarding that intent. Implementations may update the stable owner-key
 * directory inside this transaction, but expose no independent tenant-key,
 * content, object, or control-plane mutation API.
 */
export interface BaseOwnershipAdapter {
  inspectBaseOwnership(input: BaseOwnershipOperationInput): Promise<BaseOwnershipInspection>
  publishBaseOwnership(input: BaseOwnershipOperationInput): Promise<BaseOwnershipAtomicResult>
  restoreBaseOwnership(input: BaseOwnershipOperationInput): Promise<BaseOwnershipAtomicResult>
}

export type BaseOwnershipTransferErrorCode =
  | 'invalid-execution'
  | 'site-id-collision'
  | 'transfer-ancestry-mismatch'
  | 'source-ownership-mismatch'
  | 'destination-workspace-mismatch'
  | 'profile-mismatch'
  | 'capability-overrides-mismatch'
  | 'ownership-drift'
  | 'receipt-mismatch'
  | 'stale-fence'
  | 'collaborator-intent-drift'

export class BaseOwnershipTransferError extends Error {
  readonly code: BaseOwnershipTransferErrorCode
  readonly path: string

  constructor(
    code: BaseOwnershipTransferErrorCode,
    message: string,
    path: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'BaseOwnershipTransferError'
    this.code = code
    this.path = path
  }
}

function transferError(
  code: BaseOwnershipTransferErrorCode,
  message: string,
  path: string,
): never {
  throw new BaseOwnershipTransferError(code, message, path)
}

export function sameOwnershipCoordinate(
  left: TransferOwnershipCoordinate,
  right: TransferOwnershipCoordinate,
): boolean {
  return left.platformId === right.platformId
    && left.organizationId === right.organizationId
    && left.workspaceId === right.workspaceId
    && left.siteId === right.siteId
}

export function canonicalTransferValue(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(canonicalTransferValue).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonicalTransferValue(record[key])}`)
    .join(',')}}`
}

export function sameTransferValue(left: unknown, right: unknown): boolean {
  return canonicalTransferValue(left) === canonicalTransferValue(right)
}

function sameReceipt(left: TransferReceipt | null, right: TransferReceipt): boolean {
  return left !== null && sameTransferValue(left, right)
}

function validateExecution(input: TransferStepExecutionInput): void {
  try {
    assertTransferManifest(input.manifest)
  } catch (error) {
    throw new BaseOwnershipTransferError(
      'invalid-execution',
      'The base ownership step received an invalid transfer manifest.',
      'input.manifest',
      { cause: error },
    )
  }
  if (input.saga.transferId !== input.manifest.transferId
    || typeof input.saga.lockId !== 'string'
    || input.saga.lockId.length === 0
    || !Number.isSafeInteger(input.saga.fence)
    || input.saga.fence < 1) {
    transferError(
      'invalid-execution',
      'The saga fence must identify this transfer, a lock, and a positive fence.',
      'input.saga',
    )
  }
}

function assertWorkspace(
  workspace: BaseOwnershipWorkspace | null,
  destination: TransferOwnershipCoordinate,
): void {
  if (!workspace
    || workspace.platformId !== destination.platformId
    || workspace.organizationId !== destination.organizationId
    || workspace.workspaceId !== destination.workspaceId
    || workspace.status !== 'active') {
    transferError(
      'destination-workspace-mismatch',
      'The destination must be the exact active workspace in the transfer manifest.',
      'destination',
    )
  }
}

function onlySite(sites: readonly BaseOwnershipSite[]): BaseOwnershipSite {
  if (sites.length > 1) {
    transferError(
      'site-id-collision',
      'The platform contains colliding ownership records for the transfer site ID.',
      'site.id',
    )
  }
  const site = sites[0]
  if (!site) {
    transferError(
      'source-ownership-mismatch',
      'No ownership record exists for the transfer site ID.',
      'site.coordinate',
    )
  }
  return site
}

function assertManifestSiteSnapshot(
  site: BaseOwnershipSite,
  manifest: TransferManifest,
): void {
  if (site.profileId !== manifest.siteProfileId) {
    transferError(
      'profile-mismatch',
      'The site profile differs from the immutable transfer manifest.',
      'site.profileId',
    )
  }
  if (!sameTransferValue(site.capabilityOverrides, manifest.siteCapabilityOverrides)) {
    transferError(
      'capability-overrides-mismatch',
      'The site capability overrides differ from the immutable transfer manifest snapshot.',
      'site.capabilityOverrides',
    )
  }
}

export function createBaseOwnershipReceipt(
  manifest: TransferManifest,
  saga: TransferSagaFence,
): TransferReceipt {
  return {
    code: 'base-ownership-rebound',
    details: {
      transferId: manifest.transferId,
      lockId: saga.lockId,
      fence: saga.fence,
      source: { ...manifest.source },
      destination: { ...manifest.destination },
      siteId: manifest.source.siteId,
      profileId: manifest.siteProfileId,
      capabilityOverrides: {
        grant: [...manifest.siteCapabilityOverrides.grant],
        revoke: [...manifest.siteCapabilityOverrides.revoke],
      },
      collaborators: manifest.collaborators.map((collaborator) => ({ ...collaborator })),
    },
  }
}

function assertMatchingReceipt(
  candidate: TransferReceipt | null,
  expected: TransferReceipt,
  path: string,
): void {
  if (!sameReceipt(candidate, expected)) {
    transferError(
      'receipt-mismatch',
      'Ownership may only be replayed or compensated with its exact receipt and fence.',
      path,
    )
  }
}

function sortedIntents(
  records: readonly CapturedCollaboratorIntent[],
): readonly CapturedCollaboratorIntent[] {
  return records.toSorted((left, right) => (
    left.collaborator.userId.localeCompare(right.collaborator.userId)
  ))
}

function expectedIntents(
  collaborators: readonly TransferCollaboratorIntent[],
): readonly CapturedCollaboratorIntent[] {
  return collaborators
    .map((collaborator) => ({ collaborator, state: 'pending' as const }))
    .toSorted((left, right) => left.collaborator.userId.localeCompare(right.collaborator.userId))
}

function assertPendingIntents(
  actual: readonly CapturedCollaboratorIntent[],
  expected: readonly TransferCollaboratorIntent[],
): void {
  if (!sameTransferValue(sortedIntents(actual), expectedIntents(expected))) {
    transferError(
      'collaborator-intent-drift',
      'Collaborator intent must remain an exact, pending snapshot for a later step.',
      'collaboratorIntents',
    )
  }
}

function assertInspectionAuthority(
  inspection: BaseOwnershipInspection,
  manifest: TransferManifest,
  requireActiveDestination: boolean,
): BaseOwnershipSite {
  if (!inspection.proposalMatches) {
    transferError(
      'transfer-ancestry-mismatch',
      'The durable transfer proposal does not match the full source and destination ancestry.',
      'manifest',
    )
  }
  if (!inspection.fenceMatches) {
    transferError('stale-fence', 'The saga lock ID and fence are no longer active.', 'saga.fence')
  }
  if (requireActiveDestination) assertWorkspace(inspection.destinationWorkspace, manifest.destination)
  const current = onlySite(inspection.sites)
  assertManifestSiteSnapshot(current, manifest)
  return current
}

function assertAppliedInspection(
  inspection: BaseOwnershipInspection,
  input: BaseOwnershipOperationInput,
  receipt: TransferReceipt,
): void {
  const current = assertInspectionAuthority(inspection, input.manifest, true)
  if (!sameOwnershipCoordinate(current.coordinate, input.manifest.destination)) {
    transferError(
      'ownership-drift',
      'The atomic publish did not bind the site to the exact destination ancestry.',
      'site.coordinate',
    )
  }
  assertMatchingReceipt(current.ownershipReceipt, receipt, 'site.ownershipReceipt')
  assertPendingIntents(inspection.collaboratorIntents, input.manifest.collaborators)
}

function assertRestoredInspection(
  inspection: BaseOwnershipInspection,
  input: BaseOwnershipOperationInput,
): void {
  const current = assertInspectionAuthority(inspection, input.manifest, false)
  if (!sameOwnershipCoordinate(current.coordinate, input.manifest.source)
    || current.ownershipReceipt !== null) {
    transferError(
      'ownership-drift',
      'Atomic compensation did not restore the exact source authority.',
      'site',
    )
  }
  if (inspection.collaboratorIntents.length > 0) {
    transferError(
      'collaborator-intent-drift',
      'Atomic compensation did not discard pending collaborator intent.',
      'collaboratorIntents',
    )
  }
}

function handleAtomicResult(result: BaseOwnershipAtomicResult): BaseOwnershipInspection {
  if (result.status === 'stale-fence') {
    transferError('stale-fence', 'The saga lock ID and fence are no longer active.', 'saga.fence')
  }
  if (result.status === 'ancestry-conflict') {
    transferError(
      'transfer-ancestry-mismatch',
      'The atomic mutation rejected mismatched source or destination ancestry.',
      'manifest',
    )
  }
  if (result.status === 'ownership-conflict') {
    if (result.inspection.sites.length > 1) {
      transferError('site-id-collision', 'The atomic mutation found colliding site IDs.', 'site.id')
    }
    transferError(
      'ownership-drift',
      'Site ownership or its immutable profile snapshot changed during mutation.',
      'site.coordinate',
    )
  }
  if (result.status === 'intent-conflict') {
    transferError(
      'collaborator-intent-drift',
      'Stored collaborator intent differs from the immutable transfer manifest.',
      'manifest.collaborators',
    )
  }
  return result.inspection
}

function compensatedReceipt(applyReceipt: TransferReceipt): TransferReceipt {
  return {
    code: 'base-ownership-compensated',
    details: {
      applyReceipt: {
        code: applyReceipt.code,
        details: applyReceipt.details,
      },
    },
  }
}

class BaseOwnershipTransferHandlers {
  readonly #adapter: BaseOwnershipAdapter

  constructor(adapter: BaseOwnershipAdapter) {
    this.#adapter = adapter
  }

  async apply(input: TransferStepExecutionInput): Promise<TransferReceipt> {
    validateExecution(input)
    const operation = { saga: input.saga, manifest: input.manifest }
    const receipt = createBaseOwnershipReceipt(input.manifest, input.saga)
    if (input.receipt !== null) assertMatchingReceipt(input.receipt, receipt, 'input.receipt')

    const before = await this.#adapter.inspectBaseOwnership(operation)
    const current = assertInspectionAuthority(before, input.manifest, true)
    if (sameOwnershipCoordinate(current.coordinate, input.manifest.source)) {
      if (current.ownershipReceipt !== null || before.collaboratorIntents.length > 0) {
        transferError(
          'ownership-drift',
          'The source authority contains partial base-transfer state.',
          'site',
        )
      }
    } else if (sameOwnershipCoordinate(current.coordinate, input.manifest.destination)) {
      assertMatchingReceipt(current.ownershipReceipt, receipt, 'site.ownershipReceipt')
      assertPendingIntents(before.collaboratorIntents, input.manifest.collaborators)
    } else {
      transferError(
        'source-ownership-mismatch',
        'The site is owned by neither the exact source nor this transfer destination.',
        'site.coordinate',
      )
    }

    const after = handleAtomicResult(await this.#adapter.publishBaseOwnership(operation))
    assertAppliedInspection(after, operation, receipt)
    return receipt
  }

  async verify(input: TransferStepExecutionInput): Promise<TransferStepVerification> {
    validateExecution(input)
    const operation = { saga: input.saga, manifest: input.manifest }
    const inspection = await this.#adapter.inspectBaseOwnership(operation)
    const current = assertInspectionAuthority(inspection, input.manifest, true)

    if (sameOwnershipCoordinate(current.coordinate, input.manifest.source)) {
      if (current.ownershipReceipt !== null || inspection.collaboratorIntents.length > 0) {
        transferError('ownership-drift', 'A source-owned site has partial transfer state.', 'site')
      }
      return Object.freeze({ status: 'not-applied', receipt: null })
    }
    if (!sameOwnershipCoordinate(current.coordinate, input.manifest.destination)) {
      transferError(
        'ownership-drift',
        'The site is not owned by the transfer destination.',
        'site.coordinate',
      )
    }

    const receipt = createBaseOwnershipReceipt(input.manifest, input.saga)
    assertMatchingReceipt(current.ownershipReceipt, receipt, 'site.ownershipReceipt')
    if (input.receipt !== null) assertMatchingReceipt(input.receipt, receipt, 'input.receipt')
    assertPendingIntents(inspection.collaboratorIntents, input.manifest.collaborators)
    return Object.freeze({ status: 'verified', receipt })
  }

  async compensate(input: TransferStepExecutionInput): Promise<TransferStepCompensation> {
    validateExecution(input)
    const operation = { saga: input.saga, manifest: input.manifest }
    const expectedReceipt = createBaseOwnershipReceipt(input.manifest, input.saga)
    const before = await this.#adapter.inspectBaseOwnership(operation)
    const current = assertInspectionAuthority(before, input.manifest, false)

    if (sameOwnershipCoordinate(current.coordinate, input.manifest.source)) {
      if (current.ownershipReceipt !== null || before.collaboratorIntents.length > 0) {
        transferError(
          'ownership-drift',
          'The source authority contains partial compensation state.',
          'site',
        )
      }
      if (input.receipt === null) {
        return Object.freeze({ status: 'not-applied', receipt: null })
      }
      assertMatchingReceipt(input.receipt, expectedReceipt, 'input.receipt')
    } else if (sameOwnershipCoordinate(current.coordinate, input.manifest.destination)) {
      assertMatchingReceipt(input.receipt, expectedReceipt, 'input.receipt')
      assertMatchingReceipt(current.ownershipReceipt, expectedReceipt, 'site.ownershipReceipt')
      assertPendingIntents(before.collaboratorIntents, input.manifest.collaborators)
    } else {
      transferError(
        'ownership-drift',
        'Compensation found ownership outside the immutable source and destination.',
        'site.coordinate',
      )
    }

    const after = handleAtomicResult(await this.#adapter.restoreBaseOwnership(operation))
    assertRestoredInspection(after, operation)
    return Object.freeze({
      status: 'compensated',
      receipt: compensatedReceipt(expectedReceipt),
    })
  }
}

export function createBaseOwnershipTransferStep(
  adapter: BaseOwnershipAdapter,
): TransferStepDefinition {
  const handlers = new BaseOwnershipTransferHandlers(adapter)
  return Object.freeze({
    id: BASE_OWNERSHIP_TRANSFER_STEP_ID,
    order: BASE_OWNERSHIP_TRANSFER_STEP_ORDER,
    dependsOn: Object.freeze([]),
    mandatory: true,
    apply: (input) => handlers.apply(input),
    compensate: (input) => handlers.compensate(input),
    verify: (input) => handlers.verify(input),
  })
}

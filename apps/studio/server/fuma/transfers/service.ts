import { createHash } from 'node:crypto'
import {
  PermissionDecisionSchema,
  type FumaRegistry,
  type PermissionDecision,
} from '@core/fuma'
import { Type, Value, type Static } from '@core/utils/typeboxHelpers'
import {
  assertFumaRequestContext,
  type FumaRequestContext,
} from '../context'
import {
  TransferContractError,
  assertTransferManifest,
  assertTransferProposal,
  type TransferConfirmation,
  type TransferManifest,
  type TransferOwnershipCoordinate,
  type TransferProposal,
  type TransferStep,
} from './contracts'
import {
  TransferRepositoryError,
  type TransferAggregate,
  type TransferRepository,
  type TransferRepositoryKey,
  type TransferRepositoryTransaction,
} from './repository'
import {
  BASE_OWNERSHIP_TRANSFER_STEP_ID,
  type ComposedTransferStep,
  type TransferStepRegistry,
} from './stepRegistry'

export const TransferEligibilityPhaseSchema = Type.Union([
  Type.Literal('proposal'),
  Type.Literal('start'),
])
export type TransferEligibilityPhase = Static<typeof TransferEligibilityPhaseSchema>

export const TransferEligibilityResultSchema = Type.Union([
  Type.Object({ decision: Type.Literal('eligible') }, { additionalProperties: false }),
  Type.Object({
    decision: Type.Literal('ineligible'),
    reasonCode: Type.String({
      minLength: 1,
      maxLength: 128,
      pattern: '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$',
    }),
  }, { additionalProperties: false }),
])
export type TransferEligibilityResult = Static<typeof TransferEligibilityResultSchema>

export const TRANSFER_CONTROL_PERMISSION = 'site.settings.write'
export const TRANSFER_DESTINATION_PERMISSION = 'workspace.sites.create'

export type TransferAuthority = Readonly<{
  context: FumaRequestContext
  decisions: readonly PermissionDecision[]
}>

export type ProposeTransferInput = Readonly<{
  authority: TransferAuthority
  manifest: TransferManifest
}>

export type ConfirmTransferInput = Readonly<{
  authority: TransferAuthority
  source: TransferOwnershipCoordinate
  transferId: string
  side: 'source' | 'destination'
  expectedVersion: string
}>

export type StartTransferInput = Readonly<{
  authority: TransferAuthority
  source: TransferOwnershipCoordinate
  transferId: string
  expectedVersion: string
  lockId: string
  jobId: string
  runId: string
}>

export type CancelTransferInput = Readonly<{
  authority: TransferAuthority
  source: TransferOwnershipCoordinate
  transferId: string
  expectedVersion: string
  reasonCode: string
}>

export type ResumeTransferInput = Readonly<{
  authority: TransferAuthority
  source: TransferOwnershipCoordinate
  transferId: string
  expectedVersion: string
  fence: number
  reasonCode: string
}>

export type TransferServiceErrorCode =
  | 'invalid-input'
  | 'not-found'
  | 'unauthorized'
  | 'ineligible'
  | 'scope-mismatch'
  | 'stale-version'
  | 'stale-fence'
  | 'lock-contended'
  | 'conflict'
  | 'invalid-state'
  | 'invalid-step-snapshot'

export class TransferServiceError extends Error {
  readonly code: TransferServiceErrorCode
  readonly path: string

  constructor(code: TransferServiceErrorCode, message: string, path: string) {
    super(message)
    this.name = 'TransferServiceError'
    this.code = code
    this.path = path
  }
}

/** Throw from a step to model process death; the running attempt remains resumable. */
export class TransferInterruptionError extends Error {
  constructor(message = 'Transfer execution was interrupted.') {
    super(message)
    this.name = 'TransferInterruptionError'
  }
}

export interface TransferAuditPort {
  recordRequest(context: FumaRequestContext, input: unknown): Promise<unknown>
}

export type TransferManifestCaptureInput = Readonly<{
  transferId: string
  source: TransferOwnershipCoordinate
  destination: TransferOwnershipCoordinate
}>

/** Captures an exact manifest from server-owned state; caller metadata is never authoritative. */
export interface TransferManifestAuthority {
  capture(input: TransferManifestCaptureInput): Promise<unknown>
}

/** Makes the server-owned business-policy decision at proposal and immediately before start. */
export interface TransferEligibilityAuthority {
  check(input: Readonly<{
    phase: TransferEligibilityPhase
    transferId: string
    source: TransferOwnershipCoordinate
    destination: TransferOwnershipCoordinate
    manifest: TransferManifest
  }>): Promise<unknown>
}

export type TransferCommandJobKind = 'transfer.execute' | 'transfer.resume'

export type TransferCommandEnqueueInput = Readonly<{
  organizationId: string
  siteId: string
  kind: TransferCommandJobKind
  payload: Readonly<{ transferId: string }>
  maxAttempts: number
  idempotencyKey: string
}>

/** Narrow durable-job port. FUMA-024 supplies the adapter and worker composition. */
export interface TransferCommandEnqueuePort {
  enqueue(input: TransferCommandEnqueueInput): Promise<unknown>
}

export interface TransferServiceOptions {
  repository: TransferRepository
  registry: FumaRegistry
  stepRegistry: TransferStepRegistry
  manifestAuthority: TransferManifestAuthority
  eligibilityAuthority: TransferEligibilityAuthority
  enqueue: TransferCommandEnqueuePort
  audit: TransferAuditPort
  now?: () => Date
}

function serviceError(
  code: TransferServiceErrorCode,
  message: string,
  path: string,
): never {
  throw new TransferServiceError(code, message, path)
}

type StaffRequestContext = FumaRequestContext & Readonly<{
  actor: Extract<FumaRequestContext['actor'], { kind: 'staff' }>
}>

type ComposedProfile = ReturnType<FumaRegistry['compose']>

function assertStaffContext(
  context: FumaRequestContext,
): asserts context is StaffRequestContext {
  if (context.actor.kind !== 'staff') {
    serviceError('unauthorized', 'Transfer commands require an authorized staff actor.', 'authority.context.actor')
  }
}

function sameCoordinate(
  left: TransferOwnershipCoordinate,
  right: TransferOwnershipCoordinate,
): boolean {
  return left.platformId === right.platformId
    && left.organizationId === right.organizationId
    && left.workspaceId === right.workspaceId
    && left.siteId === right.siteId
}

function sameWorkspace(
  left: Pick<TransferOwnershipCoordinate, 'platformId' | 'organizationId' | 'workspaceId'>,
  right: Pick<TransferOwnershipCoordinate, 'platformId' | 'organizationId' | 'workspaceId'>,
): boolean {
  return left.platformId === right.platformId
    && left.organizationId === right.organizationId
    && left.workspaceId === right.workspaceId
}

function coordinateFromContext(context: FumaRequestContext): TransferOwnershipCoordinate {
  return {
    platformId: context.scope.platform.id,
    organizationId: context.scope.organization.id,
    workspaceId: context.scope.workspace.id,
    siteId: context.scope.site.id,
  }
}

function workspaceFromContext(
  context: FumaRequestContext,
): Pick<TransferOwnershipCoordinate, 'platformId' | 'organizationId' | 'workspaceId'> {
  return {
    platformId: context.scope.platform.id,
    organizationId: context.scope.organization.id,
    workspaceId: context.scope.workspace.id,
  }
}

function deeplyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object') return true
  if (seen.has(value)) return true
  seen.add(value)
  if (!Object.isFrozen(value)) return false
  return Object.values(value).every((nested) => deeplyFrozen(nested, seen))
}

function validStaffAuthority(authority: TransferAuthority): StaffRequestContext {
  const context = authority.context
  assertFumaRequestContext(context)
  if (!deeplyFrozen(context)) {
    serviceError('unauthorized', 'Transfer authority requires an immutable request context.', 'authority.context')
  }
  assertStaffContext(context)
  if (!Array.isArray(authority.decisions)
    || authority.decisions.some((decision) => !Value.Check(PermissionDecisionSchema, decision))) {
    serviceError('unauthorized', 'Transfer permission decisions are malformed.', 'authority.decisions')
  }
  return context
}

function assertPermissionSummary(
  context: StaffRequestContext,
  permissionId: string,
): void {
  const allowedSummary = new Set(context.permissions.allow)
  const deniedSummary = new Set(context.permissions.deny)
  if (!allowedSummary.has(permissionId) || deniedSummary.has(permissionId)) {
    serviceError('unauthorized', `Transfer permission "${permissionId}" is not allowed.`, 'authority.context.permissions')
  }
}

function validSourceAuthority(
  authority: TransferAuthority,
  scope: TransferOwnershipCoordinate,
  requiredPermissions: readonly string[] = [TRANSFER_CONTROL_PERMISSION],
): StaffRequestContext {
  const context = validStaffAuthority(authority)
  if (!sameCoordinate(coordinateFromContext(context), scope)) {
    serviceError('scope-mismatch', 'Transfer authority does not match the exact source site ancestry.', 'authority.context.scope')
  }
  for (const permissionId of new Set(requiredPermissions)) {
    assertPermissionSummary(context, permissionId)
    const decisions = authority.decisions.filter((candidate) => (
      candidate.permissionId === permissionId
      && candidate.scope.kind === 'site'
      && sameCoordinate(candidate.scope, scope)
    ))
    if (decisions.length !== 1 || decisions[0]?.decision !== 'allow') {
      serviceError(
        'unauthorized',
        `Transfer permission "${permissionId}" was not authorized for this exact site.`,
        'authority.decisions',
      )
    }
  }
  return context
}

function validDestinationAuthority(
  authority: TransferAuthority,
  destination: TransferOwnershipCoordinate,
): StaffRequestContext {
  const context = validStaffAuthority(authority)
  if (!sameWorkspace(workspaceFromContext(context), destination)) {
    serviceError(
      'scope-mismatch',
      'Destination confirmation authority does not match the exact destination workspace ancestry.',
      'authority.context.scope',
    )
  }
  assertPermissionSummary(context, TRANSFER_DESTINATION_PERMISSION)
  const decisions = authority.decisions.filter((candidate) => (
    candidate.permissionId === TRANSFER_DESTINATION_PERMISSION
    && candidate.scope.kind === 'workspace'
    && sameWorkspace(candidate.scope, destination)
  ))
  if (decisions.length !== 1 || decisions[0]?.decision !== 'allow') {
    serviceError(
      'unauthorized',
      `Transfer permission "${TRANSFER_DESTINATION_PERMISSION}" was not authorized for this exact workspace.`,
      'authority.decisions',
    )
  }
  return context
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((id, index) => id === right[index])
}

function assertManifestComposition(
  manifest: TransferManifest,
  composition: ComposedProfile,
): void {
  const capabilityIds = composition.capabilities.map(({ id }) => id)
  if (composition.profile.id !== manifest.siteProfileId) {
    serviceError(
      'invalid-input',
      'Transfer manifest profile does not match its composed profile.',
      'manifest.siteProfileId',
    )
  }
  if (!sameIds(manifest.siteCapabilityIds, capabilityIds)) {
    serviceError(
      'invalid-input',
      'Transfer manifest capability IDs do not match its composed profile and overrides.',
      'manifest.siteCapabilityIds',
    )
  }
}

function assertProposingSourceComposition(
  manifest: TransferManifest,
  context: StaffRequestContext,
  composition: ComposedProfile,
): void {
  assertManifestComposition(manifest, composition)
  if (manifest.siteProfileId !== context.scope.site.profileId
    || manifest.siteProfileId !== context.profile.id
    || !sameIds(manifest.siteCapabilityIds, context.capabilities)) {
    serviceError(
      'scope-mismatch',
      'Transfer manifest profile and capabilities do not match the proposing source context.',
      'manifest.siteProfileId',
    )
  }
}

function validNow(now: () => Date, after?: string): string {
  const value = now()
  if (!Number.isFinite(value.getTime())) {
    serviceError('invalid-input', 'Transfer service clock returned an invalid date.', 'now')
  }
  if (after !== undefined && value.getTime() <= Date.parse(after)) {
    return new Date(Date.parse(after) + 1).toISOString()
  }
  return value.toISOString()
}

function nonempty(value: string, path: string): string {
  if (typeof value !== 'string' || !value || value.length > 255) {
    serviceError('invalid-input', `${path} must be a non-empty identifier.`, path)
  }
  return value
}

function key(source: TransferOwnershipCoordinate, transferId: string): TransferRepositoryKey {
  return { source: structuredClone(source), transferId: nonempty(transferId, 'transferId') }
}

function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) immutable(nested)
    Object.freeze(value)
  }
  return value
}

function result(value: TransferAggregate): TransferAggregate {
  return immutable(structuredClone(value))
}

function assertAggregateCoordinates(
  aggregate: TransferAggregate,
  repositoryKey: TransferRepositoryKey,
): void {
  const { proposal } = aggregate
  const sourceConfirmation = aggregate.confirmations.source
  const destinationConfirmation = aggregate.confirmations.destination
  const crossesCoordinate = proposal.id !== repositoryKey.transferId
    || !sameCoordinate(proposal.source, repositoryKey.source)
    || !sameCoordinate(proposal.source, proposal.manifest.source)
    || !sameCoordinate(proposal.destination, proposal.manifest.destination)
    || (sourceConfirmation !== null
      && (sourceConfirmation.transferId !== proposal.id
        || !sameCoordinate(sourceConfirmation.scope, proposal.source)))
    || (destinationConfirmation !== null
      && (destinationConfirmation.transferId !== proposal.id
        || !sameCoordinate(destinationConfirmation.scope, proposal.destination)))
    || (aggregate.lock !== null
      && (aggregate.lock.transferId !== proposal.id
        || !sameCoordinate(aggregate.lock.scope, proposal.source)))
    || aggregate.steps.some((step) => step.transferId !== proposal.id)
  if (crossesCoordinate) {
    serviceError(
      'scope-mismatch',
      'Transfer aggregate crossed its source or destination ownership boundary.',
      'repository',
    )
  }
}

function nextProposal(
  proposal: TransferProposal,
  updatedAt: string,
  patch: Partial<TransferProposal>,
): TransferProposal {
  const next = { ...structuredClone(proposal), ...patch, updatedAt }
  assertTransferProposal(next)
  return next
}

function assertExpectedVersion(aggregate: TransferAggregate, expectedVersion: string): void {
  if (aggregate.version !== expectedVersion) {
    serviceError('stale-version', 'Transfer proposal version is stale.', 'expectedVersion')
  }
}

function assertFence(aggregate: TransferAggregate, fence: number): asserts aggregate is TransferAggregate & {
  lock: NonNullable<TransferAggregate['lock']>
} {
  if (!aggregate.lock
    || aggregate.lock.state !== 'active'
    || aggregate.lock.fence !== fence) {
    serviceError('stale-fence', 'Transfer lock fence is stale.', 'fence')
  }
}

function repositoryFailure(error: unknown): never {
  if (error instanceof TransferServiceError) throw error
  if (error instanceof TransferRepositoryError) {
    const code: TransferServiceErrorCode = error.code === 'stored-state-invalid'
      ? 'conflict'
      : error.code
    throw new TransferServiceError(code, error.message, 'repository')
  }
  throw error
}

function proposalFor(manifest: TransferManifest, context: StaffRequestContext, at: string): TransferProposal {
  return {
    id: manifest.transferId,
    source: structuredClone(manifest.source),
    destination: structuredClone(manifest.destination),
    manifest: structuredClone(manifest),
    state: 'proposed',
    proposedByUserId: context.actor.userId,
    proposedBySessionId: context.actor.sessionId,
    proposedRequestId: context.requestId,
    cancellationRequestedByUserId: null,
    cancellationRequestId: null,
    cancellationReasonCode: null,
    resumeRequestedByUserId: null,
    resumeRequestId: null,
    resumeReasonCode: null,
    resumeCount: 0,
    failure: null,
    createdAt: at,
    updatedAt: at,
    readyAt: null,
    startedAt: null,
    compensationStartedAt: null,
    compensationCompletedAt: null,
    completedAt: null,
    cancelledAt: null,
  }
}

function canonicalManifestValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalManifestValue).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([name, nested]) => `${JSON.stringify(name)}:${canonicalManifestValue(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

function sameManifest(left: TransferManifest, right: TransferManifest): boolean {
  return canonicalManifestValue(left) === canonicalManifestValue(right)
}

function validatedManifest(value: unknown, boundary: string): TransferManifest {
  try {
    assertTransferManifest(value)
  } catch (error) {
    if (error instanceof TransferContractError) {
      const path = boundary === 'manifest'
        ? error.path
        : error.path.replace(/^manifest/, boundary)
      serviceError('invalid-input', error.message, path)
    }
    throw error
  }
  return immutable(structuredClone(value))
}

function validatedEligibilityResult(value: unknown): TransferEligibilityResult {
  if (!Value.Check(TransferEligibilityResultSchema, value)) {
    serviceError(
      'invalid-input',
      'Transfer eligibility authority returned an invalid result.',
      'eligibilityAuthority',
    )
  }
  return structuredClone(value)
}

function commandIdempotencyKey(
  kind: TransferCommandJobKind,
  source: TransferOwnershipCoordinate,
  transferId: string,
  requestId: string,
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ kind, source, transferId, requestId }))
    .digest('hex')
  return `${kind}:${digest}`
}

function commandJob(
  kind: TransferCommandJobKind,
  proposal: TransferProposal,
  requestId: string,
): TransferCommandEnqueueInput {
  return {
    organizationId: proposal.source.organizationId,
    siteId: proposal.source.siteId,
    kind,
    payload: { transferId: proposal.id },
    maxAttempts: 5,
    idempotencyKey: commandIdempotencyKey(kind, proposal.source, proposal.id, requestId),
  }
}

function sameConfirmation(left: TransferConfirmation, right: TransferConfirmation): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function existingConfirmation(
  aggregate: TransferAggregate,
  side: 'source' | 'destination',
): TransferConfirmation | null {
  return aggregate.confirmations[side]
}

function snapshotId(transferId: string, definitionId: string, attempt: number): string {
  return `${transferId}:step:${definitionId}:attempt:${attempt}`
}

function pendingStep(
  transferId: string,
  lockId: string,
  fence: number,
  definition: ComposedTransferStep,
  at: string,
): TransferStep {
  if (!Number.isSafeInteger(definition.order) || definition.order <= 0) {
    serviceError(
      'invalid-step-snapshot',
      `Registered step ${definition.id} must have an arbitrary positive order.`,
      'stepRegistry',
    )
  }
  return {
    id: snapshotId(transferId, definition.id, 1),
    transferId,
    lockId,
    fence,
    definitionId: definition.id,
    sequence: definition.order,
    attempt: 1,
    kind: 'forward',
    state: 'pending',
    receipt: null,
    error: null,
    createdAt: at,
    updatedAt: at,
    startedAt: null,
    finishedAt: null,
  }
}

function latestForwardAttempts(steps: readonly TransferStep[]): readonly TransferStep[] {
  const latest = new Map<string, TransferStep>()
  for (const step of steps) {
    if (step.kind !== 'forward') continue
    const current = latest.get(step.definitionId)
    if (!current || step.attempt > current.attempt) latest.set(step.definitionId, step)
  }
  return [...latest.values()].toSorted((left, right) => left.sequence - right.sequence)
}

export class TransferService {
  readonly #repository: TransferRepository
  readonly #registry: FumaRegistry
  readonly #stepRegistry: TransferStepRegistry
  readonly #manifestAuthority: TransferManifestAuthority
  readonly #eligibilityAuthority: TransferEligibilityAuthority
  readonly #enqueue: TransferCommandEnqueuePort
  readonly #audit: TransferAuditPort
  readonly #now: () => Date

  constructor(options: TransferServiceOptions) {
    this.#repository = options.repository
    this.#registry = options.registry
    this.#stepRegistry = options.stepRegistry
    this.#manifestAuthority = options.manifestAuthority
    this.#eligibilityAuthority = options.eligibilityAuthority
    this.#enqueue = options.enqueue
    this.#audit = options.audit
    this.#now = options.now ?? (() => new Date())
  }

  async get(source: TransferOwnershipCoordinate, transferId: string): Promise<TransferAggregate> {
    const repositoryKey = key(source, transferId)
    const aggregate = await this.#repository.read(repositoryKey)
    if (!aggregate) serviceError('not-found', 'Transfer proposal was not found.', 'transferId')
    assertAggregateCoordinates(aggregate, repositoryKey)
    return result(aggregate)
  }

  async propose(input: ProposeTransferInput): Promise<TransferAggregate> {
    const claimedManifest = validatedManifest(input.manifest, 'manifest')
    const context = validSourceAuthority(input.authority, claimedManifest.source)
    const captured = await this.#manifestAuthority.capture({
      transferId: claimedManifest.transferId,
      source: structuredClone(claimedManifest.source),
      destination: structuredClone(claimedManifest.destination),
    })
    const trustedManifest = validatedManifest(captured, 'manifestAuthority')
    if (!sameManifest(claimedManifest, trustedManifest)) {
      serviceError(
        'invalid-input',
        'Transfer manifest does not exactly match the server-owned source snapshot.',
        'manifest',
      )
    }
    const composition = this.#registry.compose(
      trustedManifest.siteProfileId,
      trustedManifest.siteCapabilityOverrides,
    )
    assertProposingSourceComposition(trustedManifest, context, composition)
    const repositoryKey = key(trustedManifest.source, trustedManifest.transferId)
    try {
      return await this.#repository.transaction(repositoryKey, async (transaction) => {
        const existing = await transaction.read(repositoryKey)
        if (existing) {
          assertAggregateCoordinates(existing, repositoryKey)
          if (sameManifest(existing.proposal.manifest, trustedManifest)
            && existing.proposal.proposedByUserId === context.actor.userId
            && existing.proposal.proposedBySessionId === context.actor.sessionId
            && existing.proposal.proposedRequestId === context.requestId) return result(existing)
          serviceError('conflict', 'Transfer ID already belongs to another proposal.', 'manifest.transferId')
        }
        await this.#assertEligible('proposal', trustedManifest)
        const at = validNow(this.#now)
        const proposal = proposalFor(trustedManifest, context, at)
        await transaction.insertProposal(repositoryKey, proposal)
        await this.#audit.recordRequest(context, {
          action: 'transfer.proposed',
          target: 'site',
          outcome: 'success',
          metadata: {
            transferId: proposal.id,
            destinationOrganizationId: proposal.destination.organizationId,
          },
        })
        const stored = await transaction.read(repositoryKey)
        if (!stored) serviceError('conflict', 'Recorded transfer proposal is not visible.', 'repository')
        assertAggregateCoordinates(stored, repositoryKey)
        return result(stored)
      })
    } catch (error) {
      repositoryFailure(error)
    }
  }

  async confirm(input: ConfirmTransferInput): Promise<TransferAggregate> {
    const repositoryKey = key(input.source, input.transferId)
    try {
      return await this.#repository.transaction(repositoryKey, async (transaction) => {
        const aggregate = await this.#required(transaction, repositoryKey)
        const scope = input.side === 'source'
          ? aggregate.proposal.source
          : aggregate.proposal.destination
        const context = input.side === 'source'
          ? validSourceAuthority(input.authority, scope)
          : validDestinationAuthority(input.authority, scope)
        const confirmation: TransferConfirmation = {
          transferId: aggregate.proposal.id,
          side: input.side,
          scope: structuredClone(scope),
          confirmedByUserId: context.actor.userId,
          confirmedBySessionId: context.actor.sessionId,
          requestId: context.requestId,
          confirmedAt: validNow(this.#now, aggregate.version),
        }
        const existing = existingConfirmation(aggregate, input.side)
        if (existing) {
          if (sameConfirmation(existing, confirmation)
            || (existing.confirmedByUserId === confirmation.confirmedByUserId
              && existing.confirmedBySessionId === confirmation.confirmedBySessionId
              && existing.requestId === confirmation.requestId)) return result(aggregate)
          serviceError('conflict', `${input.side} confirmation is immutable.`, 'side')
        }
        if (!['proposed', 'awaiting-confirmations', 'ready'].includes(aggregate.proposal.state)) {
          serviceError('invalid-state', 'Transfer confirmations are closed.', 'proposal.state')
        }
        const opposite = existingConfirmation(
          aggregate,
          input.side === 'source' ? 'destination' : 'source',
        )
        if (opposite?.confirmedByUserId === context.actor.userId) {
          serviceError('unauthorized', 'Source and destination confirmations require distinct effective users.', 'authority.context.actor.userId')
        }
        assertExpectedVersion(aggregate, input.expectedVersion)
        const at = confirmation.confirmedAt
        const ready = opposite !== null
        const proposal = nextProposal(aggregate.proposal, at, {
          state: ready ? 'ready' : 'awaiting-confirmations',
          readyAt: ready ? at : null,
        })
        await transaction.recordConfirmation(
          repositoryKey,
          aggregate.version,
          proposal,
          confirmation,
        )
        await this.#audit.recordRequest(context, {
          action: 'transfer.confirmed',
          target: 'site',
          outcome: 'success',
          metadata: { transferId: proposal.id, confirmationSide: input.side },
        })
        return result(await this.#required(transaction, repositoryKey))
      })
    } catch (error) {
      repositoryFailure(error)
    }
  }

  async start(input: StartTransferInput): Promise<TransferAggregate> {
    const repositoryKey = key(input.source, input.transferId)
    try {
      return await this.#repository.transaction(repositoryKey, async (transaction) => {
        const aggregate = await this.#required(transaction, repositoryKey)
        const composition = this.#registry.compose(
          aggregate.proposal.manifest.siteProfileId,
          aggregate.proposal.manifest.siteCapabilityOverrides,
        )
        assertManifestComposition(aggregate.proposal.manifest, composition)
        const composedSteps = this.#stepRegistry.compose(composition.transfer)
        const context = validSourceAuthority(
          input.authority,
          aggregate.proposal.source,
          [
            TRANSFER_CONTROL_PERMISSION,
            ...composition.transfer.map(({ permission }) => permission),
          ],
        )
        const duplicateLock = aggregate.lock?.state === 'active'
          && aggregate.lock.id === input.lockId
          && aggregate.lock.acquiredByJobId === input.jobId
          && aggregate.lock.acquiredByRunId === input.runId
          && aggregate.lock.requestId === context.requestId
        if (duplicateLock && ['running', 'resume-requested'].includes(aggregate.proposal.state)) {
          return result(aggregate)
        }
        if (aggregate.proposal.state !== 'ready'
          || aggregate.confirmations.status !== 'confirmed') {
          serviceError('invalid-state', 'A transfer starts only after both confirmations.', 'proposal.state')
        }
        assertExpectedVersion(aggregate, input.expectedVersion)
        await this.#assertEligible('start', aggregate.proposal.manifest)
        const at = validNow(this.#now, aggregate.version)
        const lock = await transaction.acquireLock(repositoryKey, aggregate.proposal, {
          id: nonempty(input.lockId, 'lockId'),
          scope: aggregate.proposal.source,
          acquiredByJobId: nonempty(input.jobId, 'jobId'),
          acquiredByRunId: nonempty(input.runId, 'runId'),
          requestId: context.requestId,
          acquiredAt: at,
        })
        const steps = composedSteps.map((definition) => pendingStep(
          aggregate.proposal.id,
          lock.id,
          lock.fence,
          definition,
          at,
        ))
        const proposal = nextProposal(aggregate.proposal, at, {
          state: 'running',
          startedAt: at,
        })
        await transaction.recordStart(repositoryKey, aggregate.version, proposal, lock, steps)
        try {
          await this.#enqueue.enqueue(commandJob('transfer.execute', proposal, context.requestId))
        } catch (error) {
          await this.#audit.recordRequest(context, {
            action: 'transfer.failed',
            target: 'site',
            outcome: 'failure',
            metadata: {
              transferId: proposal.id,
              failureCode: 'transfer.execute.enqueue-failed',
            },
          })
          throw error
        }
        await this.#audit.recordRequest(context, {
          action: 'transfer.started',
          target: 'site',
          outcome: 'success',
          metadata: { transferId: proposal.id },
        })
        return result(await this.#required(transaction, repositoryKey))
      })
    } catch (error) {
      repositoryFailure(error)
    }
  }

  async resume(input: ResumeTransferInput): Promise<TransferAggregate> {
    const repositoryKey = key(input.source, input.transferId)
    try {
      return await this.#repository.transaction(repositoryKey, async (transaction) => {
        const aggregate = await this.#required(transaction, repositoryKey)
        const context = validSourceAuthority(input.authority, aggregate.proposal.source)
        if (aggregate.proposal.resumeRequestId === context.requestId
          && aggregate.proposal.resumeReasonCode === input.reasonCode) return result(aggregate)
        assertExpectedVersion(aggregate, input.expectedVersion)
        assertFence(aggregate, input.fence)
        const interrupted = latestForwardAttempts(aggregate.steps)
          .some(({ state }) => state === 'running')
        if (aggregate.proposal.state !== 'running' || !interrupted) {
          serviceError('invalid-state', 'Only an interrupted running transfer can resume.', 'proposal.state')
        }
        const at = validNow(this.#now, aggregate.version)
        const proposal = nextProposal(aggregate.proposal, at, {
          state: 'resume-requested',
          resumeRequestedByUserId: context.actor.userId,
          resumeRequestId: context.requestId,
          resumeReasonCode: nonempty(input.reasonCode, 'reasonCode'),
          resumeCount: aggregate.proposal.resumeCount + 1,
        })
        await transaction.recordResume(repositoryKey, aggregate.version, proposal)
        try {
          await this.#enqueue.enqueue(commandJob('transfer.resume', proposal, context.requestId))
        } catch (error) {
          await this.#audit.recordRequest(context, {
            action: 'transfer.failed',
            target: 'site',
            outcome: 'failure',
            metadata: {
              transferId: proposal.id,
              failureCode: 'transfer.resume.enqueue-failed',
            },
          })
          throw error
        }
        await this.#audit.recordRequest(context, {
          action: 'transfer.resumed',
          target: 'site',
          outcome: 'success',
          metadata: { transferId: proposal.id },
        })
        return result(await this.#required(transaction, repositoryKey))
      })
    } catch (error) {
      repositoryFailure(error)
    }
  }

  async cancel(input: CancelTransferInput): Promise<TransferAggregate> {
    const repositoryKey = key(input.source, input.transferId)
    try {
      return await this.#repository.transaction(repositoryKey, async (transaction) => {
        let aggregate = await this.#required(transaction, repositoryKey)
        const context = validSourceAuthority(input.authority, aggregate.proposal.source)
        if (aggregate.proposal.state === 'cancelled'
          && aggregate.proposal.cancellationRequestId === context.requestId
          && aggregate.proposal.cancellationReasonCode === input.reasonCode) return result(aggregate)
        assertExpectedVersion(aggregate, input.expectedVersion)
        if (['completed', 'failed', 'cancelled', 'compensating'].includes(aggregate.proposal.state)) {
          serviceError('invalid-state', 'Terminal or compensating transfers cannot be cancelled.', 'proposal.state')
        }
        const ownership = latestForwardAttempts(aggregate.steps)
          .find(({ definitionId }) => definitionId === BASE_OWNERSHIP_TRANSFER_STEP_ID)
        if (ownership && ownership.state !== 'pending') {
          serviceError('invalid-state', 'Cancellation is closed once ownership release may have begun.', 'proposal.state')
        }
        const requestedAt = validNow(this.#now, aggregate.version)
        const requested = nextProposal(aggregate.proposal, requestedAt, {
          state: 'cancellation-requested',
          cancellationRequestedByUserId: context.actor.userId,
          cancellationRequestId: context.requestId,
          cancellationReasonCode: nonempty(input.reasonCode, 'reasonCode'),
        })
        await transaction.recordCancellation(repositoryKey, aggregate.version, requested)
        aggregate = await this.#required(transaction, repositoryKey)
        const cancelledAt = validNow(this.#now, aggregate.version)
        const cancelled = nextProposal(aggregate.proposal, cancelledAt, {
          state: 'cancelled',
          cancelledAt,
        })
        await transaction.recordCancellation(repositoryKey, aggregate.version, cancelled)
        if (aggregate.lock?.state === 'active') {
          await transaction.releaseLock(
            repositoryKey,
            aggregate.proposal,
            aggregate.lock.id,
            aggregate.lock.fence,
            cancelledAt,
            'cancelled',
          )
        }
        await this.#audit.recordRequest(context, {
          action: 'transfer.cancelled',
          target: 'site',
          outcome: 'success',
          metadata: { transferId: cancelled.id, reasonCode: input.reasonCode },
        })
        return result(await this.#required(transaction, repositoryKey))
      })
    } catch (error) {
      repositoryFailure(error)
    }
  }

  async #assertEligible(
    phase: TransferEligibilityPhase,
    manifest: TransferManifest,
  ): Promise<void> {
    const eligibility = validatedEligibilityResult(await this.#eligibilityAuthority.check({
      phase,
      transferId: manifest.transferId,
      source: structuredClone(manifest.source),
      destination: structuredClone(manifest.destination),
      manifest: structuredClone(manifest),
    }))
    if (eligibility.decision === 'ineligible') {
      serviceError(
        'ineligible',
        `Transfer is ineligible (${eligibility.reasonCode}).`,
        'eligibilityAuthority.decision',
      )
    }
  }

  async #required(
    transaction: TransferRepositoryTransaction,
    repositoryKey: TransferRepositoryKey,
  ): Promise<TransferAggregate> {
    const aggregate = await transaction.read(repositoryKey)
    if (!aggregate) serviceError('not-found', 'Transfer proposal was not found.', 'transferId')
    assertAggregateCoordinates(aggregate, repositoryKey)
    return aggregate
  }
}

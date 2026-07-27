import {
  CapabilityIdSchema,
  CapabilityOverridesSchema,
} from '@core/fuma'
import {
  Type,
  Value,
  type Static,
  type TSchema,
} from '@core/utils/typeboxHelpers'
import {
  TRANSFER_COLLABORATOR_INTENTS,
  TRANSFER_COLLABORATOR_STATES,
  TRANSFER_CONFIRMATION_SIDES,
  TRANSFER_LIFECYCLE_STATES,
  TRANSFER_LOCK_STATES,
  TRANSFER_STEP_KINDS,
  TRANSFER_STEP_STATES,
} from './schemaManifest'

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T

type Contract<T> = DeepReadonly<T>

const ID_OPTIONS = {
  minLength: 1,
  maxLength: 255,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
} as const
const TIMESTAMP_OPTIONS = {
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$',
} as const
const CHECKSUM_OPTIONS = {
  pattern: '^[a-f0-9]{64}$',
} as const

function literalUnion<const Values extends readonly [string, ...string[]]>(values: Values) {
  return Type.Union(values.map((value) => Type.Literal(value)))
}

export const TransferIdSchema = Type.String(ID_OPTIONS)
export type TransferId = Contract<Static<typeof TransferIdSchema>>

export const TransferTimestampSchema = Type.String(TIMESTAMP_OPTIONS)
export type TransferTimestamp = Contract<Static<typeof TransferTimestampSchema>>

/** A site scope always carries every ancestor; bare workspace/site identifiers are invalid. */
export const TransferOwnershipCoordinateSchema = Type.Object({
  platformId: TransferIdSchema,
  organizationId: TransferIdSchema,
  workspaceId: TransferIdSchema,
  siteId: TransferIdSchema,
}, { additionalProperties: false })
export type TransferOwnershipCoordinate = Contract<Static<typeof TransferOwnershipCoordinateSchema>>

export const TransferLifecycleStateSchema = literalUnion(TRANSFER_LIFECYCLE_STATES)
export type TransferLifecycleState = Contract<Static<typeof TransferLifecycleStateSchema>>

export const TransferConfirmationSideSchema = literalUnion(TRANSFER_CONFIRMATION_SIDES)
export type TransferConfirmationSide = Contract<Static<typeof TransferConfirmationSideSchema>>

export const TransferLockStateSchema = literalUnion(TRANSFER_LOCK_STATES)
export type TransferLockState = Contract<Static<typeof TransferLockStateSchema>>

export const TransferStepKindSchema = literalUnion(TRANSFER_STEP_KINDS)
export type TransferStepKind = Contract<Static<typeof TransferStepKindSchema>>

export const TransferStepStateSchema = literalUnion(TRANSFER_STEP_STATES)
export type TransferStepState = Contract<Static<typeof TransferStepStateSchema>>

export const TransferCollaboratorIntentKindSchema = literalUnion(TRANSFER_COLLABORATOR_INTENTS)
export type TransferCollaboratorIntentKind = Contract<Static<typeof TransferCollaboratorIntentKindSchema>>

export const TransferCollaboratorStateSchema = literalUnion(TRANSFER_COLLABORATOR_STATES)
export type TransferCollaboratorState = Contract<Static<typeof TransferCollaboratorStateSchema>>

export const TransferRoleSchema = Type.Union([
  Type.Literal('owner'),
  Type.Literal('admin'),
  Type.Literal('editor'),
  Type.Literal('viewer'),
])
export type TransferRole = Contract<Static<typeof TransferRoleSchema>>

const TransferJsonKeySchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
})

export const TransferJsonValueSchema = Type.Recursive((Self) => Type.Union([
  Type.Null(),
  Type.Boolean(),
  Type.Number(),
  Type.String({ maxLength: 4_096 }),
  Type.Array(Self, { maxItems: 128 }),
  Type.Record(TransferJsonKeySchema, Self, { maxProperties: 128 }),
]))
export type TransferJsonValue = Contract<Static<typeof TransferJsonValueSchema>>

export const TransferReceiptSchema = Type.Object({
  code: Type.String({ minLength: 1, maxLength: 128 }),
  details: Type.Record(TransferJsonKeySchema, TransferJsonValueSchema, { maxProperties: 128 }),
}, { additionalProperties: false })
export type TransferReceipt = Contract<Static<typeof TransferReceiptSchema>>

export const TransferFailureSchema = Type.Object({
  code: Type.String({ minLength: 1, maxLength: 128 }),
  message: Type.String({ minLength: 1, maxLength: 2_048 }),
  retryable: Type.Boolean(),
  details: Type.Record(TransferJsonKeySchema, TransferJsonValueSchema, { maxProperties: 128 }),
}, { additionalProperties: false })
export type TransferFailure = Contract<Static<typeof TransferFailureSchema>>

export const TransferPreserveCollaboratorIntentSchema = Type.Object({
  userId: TransferIdSchema,
  sourceRole: TransferRoleSchema,
  intent: Type.Literal('preserve'),
  destinationRole: TransferRoleSchema,
}, { additionalProperties: false })

export const TransferRemoveCollaboratorIntentSchema = Type.Object({
  userId: TransferIdSchema,
  sourceRole: TransferRoleSchema,
  intent: Type.Literal('remove'),
  destinationRole: Type.Null(),
}, { additionalProperties: false })

export const TransferCollaboratorIntentSchema = Type.Union([
  TransferPreserveCollaboratorIntentSchema,
  TransferRemoveCollaboratorIntentSchema,
])
export type TransferCollaboratorIntent = Contract<Static<typeof TransferCollaboratorIntentSchema>>

export const TransferManifestSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  transferId: TransferIdSchema,
  source: TransferOwnershipCoordinateSchema,
  destination: TransferOwnershipCoordinateSchema,
  siteProfileId: TransferIdSchema,
  siteCapabilityOverrides: CapabilityOverridesSchema,
  siteCapabilityIds: Type.Array(CapabilityIdSchema),
  snapshotChecksum: Type.String(CHECKSUM_OPTIONS),
  resources: Type.Array(Type.Union([
    Type.Literal('site-record'),
    Type.Literal('content'),
    Type.Literal('media'),
    Type.Literal('redirects'),
    Type.Literal('settings'),
  ]), { minItems: 1, maxItems: 5, uniqueItems: true }),
  collaborators: Type.Array(TransferCollaboratorIntentSchema, { maxItems: 10_000 }),
  capturedAt: TransferTimestampSchema,
}, { additionalProperties: false })
export type TransferManifest = Contract<Static<typeof TransferManifestSchema>>

export const TransferProposalSchema = Type.Object({
  id: TransferIdSchema,
  source: TransferOwnershipCoordinateSchema,
  destination: TransferOwnershipCoordinateSchema,
  manifest: TransferManifestSchema,
  state: TransferLifecycleStateSchema,
  proposedByUserId: TransferIdSchema,
  proposedBySessionId: TransferIdSchema,
  proposedRequestId: TransferIdSchema,
  cancellationRequestedByUserId: Type.Union([TransferIdSchema, Type.Null()]),
  cancellationRequestId: Type.Union([TransferIdSchema, Type.Null()]),
  cancellationReasonCode: Type.Union([TransferIdSchema, Type.Null()]),
  resumeRequestedByUserId: Type.Union([TransferIdSchema, Type.Null()]),
  resumeRequestId: Type.Union([TransferIdSchema, Type.Null()]),
  resumeReasonCode: Type.Union([TransferIdSchema, Type.Null()]),
  resumeCount: Type.Integer({ minimum: 0 }),
  failure: Type.Union([TransferFailureSchema, Type.Null()]),
  createdAt: TransferTimestampSchema,
  updatedAt: TransferTimestampSchema,
  readyAt: Type.Union([TransferTimestampSchema, Type.Null()]),
  startedAt: Type.Union([TransferTimestampSchema, Type.Null()]),
  compensationStartedAt: Type.Union([TransferTimestampSchema, Type.Null()]),
  compensationCompletedAt: Type.Union([TransferTimestampSchema, Type.Null()]),
  completedAt: Type.Union([TransferTimestampSchema, Type.Null()]),
  cancelledAt: Type.Union([TransferTimestampSchema, Type.Null()]),
}, { additionalProperties: false })
export type TransferProposal = Contract<Static<typeof TransferProposalSchema>>

const TRANSFER_CONFIRMATION_PROPERTIES = {
  transferId: TransferIdSchema,
  scope: TransferOwnershipCoordinateSchema,
  confirmedByUserId: TransferIdSchema,
  confirmedBySessionId: TransferIdSchema,
  requestId: TransferIdSchema,
  confirmedAt: TransferTimestampSchema,
} as const

export const SourceTransferConfirmationSchema = Type.Object({
  side: Type.Literal('source'),
  ...TRANSFER_CONFIRMATION_PROPERTIES,
}, { additionalProperties: false })
export type SourceTransferConfirmation = Contract<Static<typeof SourceTransferConfirmationSchema>>

export const DestinationTransferConfirmationSchema = Type.Object({
  side: Type.Literal('destination'),
  ...TRANSFER_CONFIRMATION_PROPERTIES,
}, { additionalProperties: false })
export type DestinationTransferConfirmation = Contract<Static<typeof DestinationTransferConfirmationSchema>>

export const TransferConfirmationSchema = Type.Union([
  SourceTransferConfirmationSchema,
  DestinationTransferConfirmationSchema,
])
export type TransferConfirmation = Contract<Static<typeof TransferConfirmationSchema>>

export const TransferConfirmationProgressSchema = Type.Union([
  Type.Object({
    status: Type.Literal('unconfirmed'),
    source: Type.Null(),
    destination: Type.Null(),
  }, { additionalProperties: false }),
  Type.Object({
    status: Type.Literal('partially-confirmed'),
    source: SourceTransferConfirmationSchema,
    destination: Type.Null(),
  }, { additionalProperties: false }),
  Type.Object({
    status: Type.Literal('partially-confirmed'),
    source: Type.Null(),
    destination: DestinationTransferConfirmationSchema,
  }, { additionalProperties: false }),
  Type.Object({
    status: Type.Literal('confirmed'),
    source: SourceTransferConfirmationSchema,
    destination: DestinationTransferConfirmationSchema,
  }, { additionalProperties: false }),
])
export type TransferConfirmationProgress = Contract<Static<typeof TransferConfirmationProgressSchema>>

const TRANSFER_LOCK_PROPERTIES = {
  id: TransferIdSchema,
  transferId: TransferIdSchema,
  scope: TransferOwnershipCoordinateSchema,
  fence: Type.Integer({ minimum: 1 }),
  acquiredByJobId: TransferIdSchema,
  acquiredByRunId: TransferIdSchema,
  requestId: TransferIdSchema,
  acquiredAt: TransferTimestampSchema,
  heartbeatAt: TransferTimestampSchema,
} as const

export const ActiveTransferLockSchema = Type.Object({
  ...TRANSFER_LOCK_PROPERTIES,
  state: Type.Literal('active'),
  releasedAt: Type.Null(),
  releaseReasonCode: Type.Null(),
}, { additionalProperties: false })

export const ReleasedTransferLockSchema = Type.Object({
  ...TRANSFER_LOCK_PROPERTIES,
  state: Type.Literal('released'),
  releasedAt: TransferTimestampSchema,
  releaseReasonCode: TransferIdSchema,
}, { additionalProperties: false })

export const TransferLockSchema = Type.Union([
  ActiveTransferLockSchema,
  ReleasedTransferLockSchema,
])
export type TransferLock = Contract<Static<typeof TransferLockSchema>>

const TRANSFER_STEP_PROPERTIES = {
  id: TransferIdSchema,
  transferId: TransferIdSchema,
  lockId: TransferIdSchema,
  fence: Type.Integer({ minimum: 1 }),
  definitionId: TransferIdSchema,
  sequence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  attempt: Type.Integer({ minimum: 1 }),
  kind: TransferStepKindSchema,
  createdAt: TransferTimestampSchema,
  updatedAt: TransferTimestampSchema,
} as const

export const TransferStepSchema = Type.Union([
  Type.Object({
    ...TRANSFER_STEP_PROPERTIES,
    state: Type.Literal('pending'),
    receipt: Type.Null(),
    error: Type.Null(),
    startedAt: Type.Null(),
    finishedAt: Type.Null(),
  }, { additionalProperties: false }),
  Type.Object({
    ...TRANSFER_STEP_PROPERTIES,
    state: Type.Literal('running'),
    receipt: Type.Null(),
    error: Type.Null(),
    startedAt: TransferTimestampSchema,
    finishedAt: Type.Null(),
  }, { additionalProperties: false }),
  Type.Object({
    ...TRANSFER_STEP_PROPERTIES,
    state: Type.Union([Type.Literal('succeeded'), Type.Literal('skipped')]),
    receipt: TransferReceiptSchema,
    error: Type.Null(),
    startedAt: TransferTimestampSchema,
    finishedAt: TransferTimestampSchema,
  }, { additionalProperties: false }),
  Type.Object({
    ...TRANSFER_STEP_PROPERTIES,
    state: Type.Literal('failed'),
    receipt: Type.Null(),
    error: TransferFailureSchema,
    startedAt: TransferTimestampSchema,
    finishedAt: TransferTimestampSchema,
  }, { additionalProperties: false }),
])
export type TransferStep = Contract<Static<typeof TransferStepSchema>>

const TRANSFER_COLLABORATOR_RECORD_PROPERTIES = {
  id: TransferIdSchema,
  transferId: TransferIdSchema,
  collaborator: TransferCollaboratorIntentSchema,
  createdAt: TransferTimestampSchema,
  updatedAt: TransferTimestampSchema,
} as const

export const TransferCollaboratorRecordSchema = Type.Union([
  Type.Object({
    ...TRANSFER_COLLABORATOR_RECORD_PROPERTIES,
    state: Type.Union([Type.Literal('pending'), Type.Literal('applying')]),
    receipt: Type.Null(),
    error: Type.Null(),
    appliedAt: Type.Null(),
  }, { additionalProperties: false }),
  Type.Object({
    ...TRANSFER_COLLABORATOR_RECORD_PROPERTIES,
    state: Type.Union([Type.Literal('applied'), Type.Literal('skipped')]),
    receipt: TransferReceiptSchema,
    error: Type.Null(),
    appliedAt: TransferTimestampSchema,
  }, { additionalProperties: false }),
  Type.Object({
    ...TRANSFER_COLLABORATOR_RECORD_PROPERTIES,
    state: Type.Literal('failed'),
    receipt: Type.Null(),
    error: TransferFailureSchema,
    appliedAt: Type.Null(),
  }, { additionalProperties: false }),
])
export type TransferCollaboratorRecord = Contract<Static<typeof TransferCollaboratorRecordSchema>>

export const TransferCommandSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('propose'),
    transferId: TransferIdSchema,
    source: TransferOwnershipCoordinateSchema,
    destination: TransferOwnershipCoordinateSchema,
    manifest: TransferManifestSchema,
    requestId: TransferIdSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('confirm'),
    confirmation: TransferConfirmationSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('acquire-lock'),
    transferId: TransferIdSchema,
    scope: TransferOwnershipCoordinateSchema,
    lockId: TransferIdSchema,
    fence: Type.Integer({ minimum: 1 }),
    jobId: TransferIdSchema,
    runId: TransferIdSchema,
    requestId: TransferIdSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('record-step'),
    step: TransferStepSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('cancel'),
    transferId: TransferIdSchema,
    requestId: TransferIdSchema,
    reasonCode: TransferIdSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('resume'),
    transferId: TransferIdSchema,
    requestId: TransferIdSchema,
    reasonCode: TransferIdSchema,
  }, { additionalProperties: false }),
])
export type TransferCommand = Contract<Static<typeof TransferCommandSchema>>

export const TransferResultSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('proposal-recorded'),
    proposal: TransferProposalSchema,
    confirmations: TransferConfirmationProgressSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('confirmation-recorded'),
    proposal: TransferProposalSchema,
    confirmations: TransferConfirmationProgressSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('lock-acquired'),
    proposal: TransferProposalSchema,
    lock: TransferLockSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('step-recorded'),
    proposal: TransferProposalSchema,
    step: TransferStepSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Union([Type.Literal('cancellation-recorded'), Type.Literal('resume-recorded')]),
    proposal: TransferProposalSchema,
  }, { additionalProperties: false }),
])
export type TransferResult = Contract<Static<typeof TransferResultSchema>>

export const TransferContractErrorCodeSchema = Type.Union([
  Type.Literal('invalid-contract'),
  Type.Literal('same-owner'),
  Type.Literal('site-identity-mismatch'),
  Type.Literal('manifest-mismatch'),
  Type.Literal('lifecycle-shape-mismatch'),
  Type.Literal('duplicate-collaborator'),
  Type.Literal('duplicate-capability-snapshot'),
  Type.Literal('confirmation-scope-mismatch'),
  Type.Literal('confirmation-actor-conflict'),
])
export type TransferContractErrorCode = Contract<Static<typeof TransferContractErrorCodeSchema>>

export class TransferContractError extends Error {
  readonly code: TransferContractErrorCode
  readonly path: string

  constructor(code: TransferContractErrorCode, message: string, path: string) {
    super(message)
    this.name = 'TransferContractError'
    this.code = code
    this.path = path
  }
}

function assertSchema<T extends TSchema>(
  schema: T,
  value: unknown,
  path: string,
): asserts value is Static<T> {
  if (Value.Check(schema, value)) return
  const error = Value.Errors(schema, value).First()
  throw new TransferContractError(
    'invalid-contract',
    `${path} does not match its TypeBox contract${error ? `: ${error.path || '/'} ${error.message}` : ''}.`,
    path,
  )
}

function coordinateEquals(
  left: TransferOwnershipCoordinate,
  right: TransferOwnershipCoordinate,
): boolean {
  return left.platformId === right.platformId
    && left.organizationId === right.organizationId
    && left.workspaceId === right.workspaceId
    && left.siteId === right.siteId
}

function assertOwnershipMove(
  source: TransferOwnershipCoordinate,
  destination: TransferOwnershipCoordinate,
  path: string,
): void {
  if (source.platformId !== destination.platformId || source.siteId !== destination.siteId) {
    throw new TransferContractError(
      'site-identity-mismatch',
      'A transfer must retain its platform and site identity.',
      path,
    )
  }
  if (source.organizationId === destination.organizationId
    && source.workspaceId === destination.workspaceId) {
    throw new TransferContractError(
      'same-owner',
      'Source and destination ownership coordinates must differ.',
      path,
    )
  }
}

export function assertTransferManifest(value: unknown): asserts value is TransferManifest {
  assertSchema(TransferManifestSchema, value, 'manifest')
  assertOwnershipMove(value.source, value.destination, 'manifest.destination')
  const userIds = value.collaborators.map(({ userId }) => userId)
  if (new Set(userIds).size !== userIds.length) {
    throw new TransferContractError(
      'duplicate-collaborator',
      'A transfer manifest may contain each collaborator once.',
      'manifest.collaborators',
    )
  }

  const capabilitySnapshots = [
    ['manifest.siteCapabilityIds', value.siteCapabilityIds],
    ['manifest.siteCapabilityOverrides.grant', value.siteCapabilityOverrides.grant],
    ['manifest.siteCapabilityOverrides.revoke', value.siteCapabilityOverrides.revoke],
  ] as const
  for (const [path, capabilityIds] of capabilitySnapshots) {
    if (new Set(capabilityIds).size !== capabilityIds.length) {
      throw new TransferContractError(
        'duplicate-capability-snapshot',
        'A transfer manifest capability snapshot may contain each registry ID once.',
        path,
      )
    }
  }

  const revoked = new Set(value.siteCapabilityOverrides.revoke)
  const overlap = value.siteCapabilityOverrides.grant.find((id) => revoked.has(id))
  if (overlap) {
    throw new TransferContractError(
      'duplicate-capability-snapshot',
      `Capability "${overlap}" cannot be both granted and revoked in a transfer snapshot.`,
      'manifest.siteCapabilityOverrides',
    )
  }
}

function assertProposalLifecycle(value: TransferProposal): void {
  const cancellationValues = [
    value.cancellationRequestedByUserId,
    value.cancellationRequestId,
    value.cancellationReasonCode,
  ]
  const resumeValues = [
    value.resumeRequestedByUserId,
    value.resumeRequestId,
    value.resumeReasonCode,
  ]
  const cancellationPresent = cancellationValues.every((entry) => entry !== null)
  const cancellationAbsent = cancellationValues.every((entry) => entry === null)
  const resumePresent = resumeValues.every((entry) => entry !== null)
  const resumeAbsent = resumeValues.every((entry) => entry === null)
  const cancellationCoherent = cancellationPresent || cancellationAbsent
  const resumeCoherent = (value.resumeCount === 0 && resumeAbsent)
    || (value.resumeCount > 0 && resumePresent)
  const beforeStart = value.startedAt === null
  const readyOnly = value.readyAt !== null && beforeStart
  const started = value.readyAt !== null && value.startedAt !== null
  const noCompensation = value.compensationStartedAt === null
    && value.compensationCompletedAt === null
  const compensating = value.compensationStartedAt !== null
    && value.compensationCompletedAt === null
  const compensated = value.compensationStartedAt !== null
    && value.compensationCompletedAt !== null
  const noTerminal = value.completedAt === null && value.cancelledAt === null
  const noFailure = value.failure === null
  const noRequest = cancellationAbsent
  const resumeRequested = value.resumeCount > 0 && resumePresent

  const stateCoherent = (() => {
    switch (value.state) {
      case 'proposed':
      case 'awaiting-confirmations':
        return value.readyAt === null && beforeStart && noCompensation && noTerminal
          && noFailure && noRequest && value.resumeCount === 0 && resumeAbsent
      case 'ready':
        return readyOnly && noCompensation && noTerminal && noFailure && noRequest
          && value.resumeCount === 0 && resumeAbsent
      case 'running':
        return started && noCompensation && noTerminal && noFailure && noRequest
      case 'resume-requested':
        return started && noCompensation && noTerminal && noFailure && noRequest
          && resumeRequested
      case 'cancellation-requested':
        return (value.readyAt === null || readyOnly || started)
          && noCompensation && noTerminal && noFailure && cancellationPresent
      case 'compensating':
        return started && compensating && noTerminal && value.failure !== null && noRequest
      case 'failed':
        return started && compensated && noTerminal && value.failure !== null && noRequest
      case 'completed':
        return started && noCompensation && value.completedAt !== null
          && value.cancelledAt === null && noFailure && noRequest
      case 'cancelled':
        return (value.readyAt === null || readyOnly || started)
          && noCompensation && value.completedAt === null && value.cancelledAt !== null
          && noFailure && cancellationPresent
    }
  })()

  const parsed = {
    created: Date.parse(value.createdAt),
    updated: Date.parse(value.updatedAt),
    ready: value.readyAt === null ? null : Date.parse(value.readyAt),
    started: value.startedAt === null ? null : Date.parse(value.startedAt),
    compensationStarted: value.compensationStartedAt === null
      ? null
      : Date.parse(value.compensationStartedAt),
    compensationCompleted: value.compensationCompletedAt === null
      ? null
      : Date.parse(value.compensationCompletedAt),
    completed: value.completedAt === null ? null : Date.parse(value.completedAt),
    cancelled: value.cancelledAt === null ? null : Date.parse(value.cancelledAt),
  }
  const timestampsValid = Object.values(parsed).every((entry) => (
    entry === null || Number.isFinite(entry)
  ))
  const eventTimes = [
    parsed.ready,
    parsed.started,
    parsed.compensationStarted,
    parsed.compensationCompleted,
    parsed.completed,
    parsed.cancelled,
  ].filter((entry): entry is number => entry !== null)
  const versionTimelineCoherent = value.state === 'proposed'
    ? parsed.updated === parsed.created
    : parsed.updated > parsed.created
  const timelineCoherent = timestampsValid
    && versionTimelineCoherent
    && eventTimes.every((entry) => entry >= parsed.created && entry <= parsed.updated)
    && (parsed.started === null
      || (parsed.ready !== null && parsed.started >= parsed.ready))
    && (parsed.compensationStarted === null
      || (parsed.started !== null && parsed.compensationStarted >= parsed.started))
    && (parsed.compensationCompleted === null
      || (parsed.compensationStarted !== null
        && parsed.compensationCompleted >= parsed.compensationStarted))
    && (parsed.completed === null
      || (parsed.started !== null && parsed.completed >= parsed.started))
    && (parsed.cancelled === null
      || (parsed.started !== null
        ? parsed.cancelled >= parsed.started
        : parsed.ready !== null
          ? parsed.cancelled >= parsed.ready
          : parsed.cancelled >= parsed.created))
  const resumeFollowsStart = value.resumeCount === 0 || value.startedAt !== null

  if (!cancellationCoherent
    || !resumeCoherent
    || !resumeFollowsStart
    || !stateCoherent
    || !timelineCoherent) {
    throw new TransferContractError(
      'lifecycle-shape-mismatch',
      'Transfer lifecycle state, requests, failure, and monotonic timestamps are inconsistent.',
      'proposal.state',
    )
  }
}

export function assertTransferProposal(value: unknown): asserts value is TransferProposal {
  assertSchema(TransferProposalSchema, value, 'proposal')
  assertOwnershipMove(value.source, value.destination, 'proposal.destination')
  assertTransferManifest(value.manifest)
  assertProposalLifecycle(value)
  if (value.id !== value.manifest.transferId
    || !coordinateEquals(value.source, value.manifest.source)
    || !coordinateEquals(value.destination, value.manifest.destination)) {
    throw new TransferContractError(
      'manifest-mismatch',
      'The proposal and immutable manifest identities must match exactly.',
      'proposal.manifest',
    )
  }
}

export function assertTransferConfirmationProgress(
  value: unknown,
  source: TransferOwnershipCoordinate,
  destination: TransferOwnershipCoordinate,
  expectedTransferId?: string,
): asserts value is TransferConfirmationProgress {
  assertSchema(TransferConfirmationProgressSchema, value, 'confirmations')
  if (value.source && !coordinateEquals(value.source.scope, source)) {
    throw new TransferContractError(
      'confirmation-scope-mismatch',
      'Source confirmation must snapshot the exact source ancestry.',
      'confirmations.source.scope',
    )
  }
  if (value.destination && !coordinateEquals(value.destination.scope, destination)) {
    throw new TransferContractError(
      'confirmation-scope-mismatch',
      'Destination confirmation must snapshot the exact destination ancestry.',
      'confirmations.destination.scope',
    )
  }
  if ((value.source && expectedTransferId && value.source.transferId !== expectedTransferId)
    || (value.destination && expectedTransferId
      && value.destination.transferId !== expectedTransferId)
    || (value.source && value.destination
      && value.source.transferId !== value.destination.transferId)) {
    throw new TransferContractError(
      'confirmation-scope-mismatch',
      'Every confirmation must belong to the expected transfer.',
      'confirmations.destination.transferId',
    )
  }
  if (value.source && value.destination
    && value.source.confirmedByUserId === value.destination.confirmedByUserId) {
    throw new TransferContractError(
      'confirmation-actor-conflict',
      'Source and destination confirmations require distinct effective users.',
      'confirmations.destination.confirmedByUserId',
    )
  }
}

export function assertTransferStep(value: unknown): asserts value is TransferStep {
  assertSchema(TransferStepSchema, value, 'step')
}

export function assertTransferCommand(value: unknown): asserts value is TransferCommand {
  assertSchema(TransferCommandSchema, value, 'command')
  if (value.kind === 'propose') {
    assertOwnershipMove(value.source, value.destination, 'command.destination')
    assertTransferManifest(value.manifest)
    if (value.transferId !== value.manifest.transferId
      || !coordinateEquals(value.source, value.manifest.source)
      || !coordinateEquals(value.destination, value.manifest.destination)) {
      throw new TransferContractError(
        'manifest-mismatch',
        'The proposal command must match its immutable manifest.',
        'command.manifest',
      )
    }
  }
  if (value.kind === 'record-step') assertTransferStep(value.step)
}

export function assertTransferResult(value: unknown): asserts value is TransferResult {
  assertSchema(TransferResultSchema, value, 'result')
  assertTransferProposal(value.proposal)
  if (value.kind === 'proposal-recorded' || value.kind === 'confirmation-recorded') {
    assertTransferConfirmationLifecycle(value.proposal, value.confirmations)
  }
  if (value.kind === 'step-recorded') assertTransferStep(value.step)
}

export function assertTransferConfirmationLifecycle(
  proposal: unknown,
  confirmations: unknown,
): void {
  assertTransferProposal(proposal)
  assertTransferConfirmationProgress(
    confirmations,
    proposal.source,
    proposal.destination,
    proposal.id,
  )
  const records = [confirmations.source, confirmations.destination]
    .filter((confirmation): confirmation is TransferConfirmation => confirmation !== null)
  const createdAt = Date.parse(proposal.createdAt)
  const updatedAt = Date.parse(proposal.updatedAt)
  const confirmationTimes = records.map(({ confirmedAt }) => Date.parse(confirmedAt))
  const confirmationTimelineValid = confirmationTimes.every((confirmedAt) => (
    Number.isFinite(confirmedAt) && confirmedAt > createdAt && confirmedAt <= updatedAt
  ))
  const progressMatchesState = proposal.state === 'proposed'
    ? confirmations.status === 'unconfirmed'
    : proposal.state === 'awaiting-confirmations'
      ? confirmations.status === 'partially-confirmed'
      : proposal.readyAt === null
        ? confirmations.status !== 'confirmed'
        : confirmations.status === 'confirmed'
  const readyAt = proposal.readyAt === null ? null : Date.parse(proposal.readyAt)
  const readyMatchesConfirmations = readyAt === null
    || (confirmationTimes.length === 2 && Math.max(...confirmationTimes) === readyAt)
  if (!confirmationTimelineValid || !progressMatchesState || !readyMatchesConfirmations) {
    throw new TransferContractError(
      'lifecycle-shape-mismatch',
      'Transfer confirmation progress contradicts proposal lifecycle and readiness.',
      'confirmations',
    )
  }
}

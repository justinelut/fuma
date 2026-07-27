import type { FumaRegistry } from '@core/fuma'
import {
  Type,
  Value,
  safeParseValue,
  type Static,
} from '@core/utils/typeboxHelpers'
import {
  deriveFumaJobContext,
  type FumaJobContext,
  type FumaJobContextAuthority,
} from '../context'
import {
  FumaJobProcessDeathError,
  type EnqueueFumaJob,
  type FumaJobHandler,
  type FumaJobHandlerContext,
  type FumaJobJsonValue,
} from '../jobs'
import {
  TransferReceiptSchema,
  assertTransferProposal,
  type TransferFailure,
  type TransferManifest,
  type TransferOwnershipCoordinate,
  type TransferProposal,
  type TransferReceipt,
  type TransferStep,
} from './contracts'
import {
  transferFailure,
  type TransferAggregate,
  type TransferRepository,
  type TransferRepositoryKey,
  type TransferRepositoryTransaction,
} from './repository'
import { TransferInterruptionError, TRANSFER_CONTROL_PERMISSION } from './service'
import {
  type TransferStepDefinition,
  type TransferStepRegistry,
} from './stepRegistry'

export const TRANSFER_EXECUTE_JOB_KIND = 'transfer.execute'
export const TRANSFER_RESUME_JOB_KIND = 'transfer.resume'
export const TRANSFER_COMPENSATE_JOB_KIND = 'transfer.compensate'
export const TRANSFER_SAGA_JOB_KINDS = Object.freeze([
  TRANSFER_EXECUTE_JOB_KIND,
  TRANSFER_RESUME_JOB_KIND,
  TRANSFER_COMPENSATE_JOB_KIND,
] as const)

export const TransferSagaJobKindSchema = Type.Union([
  Type.Literal(TRANSFER_EXECUTE_JOB_KIND),
  Type.Literal(TRANSFER_RESUME_JOB_KIND),
  Type.Literal(TRANSFER_COMPENSATE_JOB_KIND),
])
export type TransferSagaJobKind = Static<typeof TransferSagaJobKindSchema>

const TRANSFER_JOB_ID_OPTIONS = {
  minLength: 1,
  maxLength: 255,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
} as const

/** Payloads select one immutable saga only. Tenant, actor, fence, and permission claims are forbidden. */
export const TransferExecuteJobPayloadSchema = Type.Object({
  transferId: Type.String(TRANSFER_JOB_ID_OPTIONS),
}, { additionalProperties: false })
export type TransferExecuteJobPayload = Static<typeof TransferExecuteJobPayloadSchema>

export const TransferResumeJobPayloadSchema = Type.Object({
  transferId: Type.String(TRANSFER_JOB_ID_OPTIONS),
}, { additionalProperties: false })
export type TransferResumeJobPayload = Static<typeof TransferResumeJobPayloadSchema>

export const TransferCompensateJobPayloadSchema = Type.Object({
  transferId: Type.String(TRANSFER_JOB_ID_OPTIONS),
}, { additionalProperties: false })
export type TransferCompensateJobPayload = Static<typeof TransferCompensateJobPayloadSchema>

export const TransferSagaJobPayloadSchema = Type.Union([
  TransferExecuteJobPayloadSchema,
  TransferResumeJobPayloadSchema,
  TransferCompensateJobPayloadSchema,
])
export type TransferSagaJobPayload = Static<typeof TransferSagaJobPayloadSchema>

const TransferSagaClaimStatusSchema = Type.Union([
  Type.Literal('advanced'),
  Type.Literal('cancelled'),
  Type.Literal('terminal'),
  Type.Literal('unchanged'),
])

export const TransferSagaClaimResultSchema = Type.Object({
  status: TransferSagaClaimStatusSchema,
  transferId: Type.String(TRANSFER_JOB_ID_OPTIONS),
  operation: TransferSagaJobKindSchema,
  transition: Type.String({ minLength: 1, maxLength: 128 }),
  proposalState: Type.String({ minLength: 1, maxLength: 64 }),
  version: Type.String({ minLength: 1, maxLength: 64 }),
  stepId: Type.Union([Type.String(TRANSFER_JOB_ID_OPTIONS), Type.Null()]),
  nextJobKind: Type.Union([TransferSagaJobKindSchema, Type.Null()]),
}, { additionalProperties: false })
export type TransferSagaClaimResult = Static<typeof TransferSagaClaimResultSchema>

export type TransferSagaJobErrorCode =
  | 'invalid-job-kind'
  | 'invalid-payload'
  | 'authority-substitution'
  | 'not-found'
  | 'invalid-state'
  | 'stale-fence'
  | 'invalid-step'

export class TransferSagaJobError extends Error {
  readonly code: TransferSagaJobErrorCode
  readonly path: string

  constructor(code: TransferSagaJobErrorCode, message: string, path: string) {
    super(message)
    this.name = 'TransferSagaJobError'
    this.code = code
    this.path = path
  }
}

export interface TransferSagaContinuationPort {
  enqueue(input: EnqueueFumaJob): Promise<unknown>
}

export interface TransferSagaJobAuditPort {
  recordJob(context: FumaJobContext, input: unknown): Promise<unknown>
}

export interface TransferSagaExecutorOptions {
  repository: TransferRepository
  stepRegistry: TransferStepRegistry
  registry: FumaRegistry
  now?: () => Date
}

export interface TransferSagaJobHandlersOptions extends TransferSagaExecutorOptions {
  authority: FumaJobContextAuthority
  enqueue: TransferSagaContinuationPort
  audit: TransferSagaJobAuditPort
}

type SiteJobContext = Extract<FumaJobContext, { kind: 'site' }>

type ClaimAdvance = Readonly<{
  result: TransferSagaClaimResult
}>

type TransactionAdvance = Readonly<{
  aggregate: TransferAggregate
  didWrite: boolean
}>

function transactionAdvance(
  aggregate: TransferAggregate,
  didWrite: boolean,
): TransactionAdvance {
  return { aggregate, didWrite }
}

function sagaError(
  code: TransferSagaJobErrorCode,
  message: string,
  path: string,
): never {
  throw new TransferSagaJobError(code, message, path)
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

function assertRepositoryAncestry(
  aggregate: TransferAggregate,
  key: TransferRepositoryKey,
): void {
  if (aggregate.proposal.id !== key.transferId
    || aggregate.proposal.manifest.transferId !== key.transferId
    || !sameCoordinate(aggregate.proposal.source, key.source)
    || !sameCoordinate(aggregate.proposal.manifest.source, key.source)) {
    sagaError(
      'authority-substitution',
      'Transfer aggregate crossed its exact persisted source ancestry.',
      'repository',
    )
  }
}

function coordinateFromContext(context: SiteJobContext): TransferOwnershipCoordinate {
  return {
    platformId: context.scope.platform.id,
    organizationId: context.scope.organization.id,
    workspaceId: context.scope.workspace.id,
    siteId: context.scope.site.id,
  }
}

function repositoryKey(
  context: SiteJobContext,
  transferId: string,
): TransferRepositoryKey {
  return { source: coordinateFromContext(context), transferId }
}

function parsedPayload(kind: string, payload: unknown): TransferSagaJobPayload {
  if (!Value.Check(TransferSagaJobKindSchema, kind)) {
    sagaError('invalid-job-kind', `Unknown transfer saga job kind "${kind}".`, 'job.kind')
  }
  const schema = kind === TRANSFER_EXECUTE_JOB_KIND
    ? TransferExecuteJobPayloadSchema
    : kind === TRANSFER_RESUME_JOB_KIND
      ? TransferResumeJobPayloadSchema
      : TransferCompensateJobPayloadSchema
  const parsed = safeParseValue(schema, payload)
  if (!parsed.ok) {
    sagaError(
      'invalid-payload',
      'Transfer saga payloads may contain only the immutable transfer ID.',
      'job.payload',
    )
  }
  return parsed.value
}

function validTime(now: () => Date, after: string): string {
  const candidate = now()
  if (!Number.isFinite(candidate.getTime())) {
    sagaError('invalid-state', 'Transfer saga clock returned an invalid date.', 'now')
  }
  const afterTime = Date.parse(after)
  return candidate.getTime() > afterTime
    ? candidate.toISOString()
    : new Date(afterTime + 1).toISOString()
}

function nextProposal(
  proposal: TransferProposal,
  at: string,
  patch: Partial<TransferProposal>,
): TransferProposal {
  const next = { ...structuredClone(proposal), ...patch, updatedAt: at }
  assertTransferProposal(next)
  return next
}

function sameOrderedValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index])
}

function latestForwardSteps(steps: readonly TransferStep[]): readonly TransferStep[] {
  const latest = new Map<string, TransferStep>()
  for (const step of steps) {
    if (step.kind !== 'forward') continue
    const current = latest.get(step.definitionId)
    if (!current || step.attempt > current.attempt) latest.set(step.definitionId, step)
  }
  return [...latest.values()].toSorted((left, right) => left.sequence - right.sequence)
}

function definitionFor(
  registry: FumaRegistry,
  stepRegistry: TransferStepRegistry,
  manifest: TransferManifest,
  step: TransferStep,
): TransferStepDefinition {
  if (step.kind !== 'forward') {
    sagaError('invalid-step', 'Only a persisted forward step selects a transfer handler.', 'step.kind')
  }
  const registered = stepRegistry.get(step.definitionId)
  if (!registered) {
    sagaError(
      'invalid-step',
      `No registered handler owns transfer step definition "${step.definitionId}".`,
      'step.definitionId',
    )
  }
  if (registered.order !== step.sequence) {
    sagaError(
      'invalid-step',
      `Registered handler "${step.definitionId}" has order ${registered.order}, not persisted order ${step.sequence}.`,
      'step.sequence',
    )
  }

  let selected: TransferStepDefinition | undefined
  try {
    const profile = registry.compose(
      manifest.siteProfileId,
      manifest.siteCapabilityOverrides,
    )
    selected = stepRegistry.compose(profile.transfer)
      .find(({ id }) => id === step.definitionId)
  } catch (_error) {
    sagaError(
      'invalid-step',
      'The immutable transfer manifest no longer composes a valid handler set.',
      'proposal.manifest',
    )
  }
  if (!selected || selected.order !== step.sequence) {
    sagaError(
      'invalid-step',
      `Persisted transfer step definition "${step.definitionId}" is not selected by its immutable manifest.`,
      'step.definitionId',
    )
  }
  return selected
}

function assertActiveFence(aggregate: TransferAggregate): asserts aggregate is TransferAggregate & {
  lock: NonNullable<TransferAggregate['lock']>
} {
  if (!aggregate.lock || aggregate.lock.state !== 'active') {
    sagaError('stale-fence', 'The transfer has no active lock.', 'lock')
  }
  for (const step of aggregate.steps) {
    if (step.lockId !== aggregate.lock.id || step.fence !== aggregate.lock.fence) {
      sagaError('stale-fence', 'A transfer step carries a stale lock fence.', 'step.fence')
    }
  }
}

function assertAggregateAuthority(
  aggregate: TransferAggregate,
  context: SiteJobContext,
  transferId: string,
  registry: FumaRegistry,
): void {
  const trustedScope = coordinateFromContext(context)
  let composedCapabilityIds: readonly string[]
  let composedProfileId: string
  try {
    const composed = registry.compose(
      aggregate.proposal.manifest.siteProfileId,
      aggregate.proposal.manifest.siteCapabilityOverrides,
    )
    composedProfileId = composed.profile.id
    composedCapabilityIds = composed.capabilities.map(({ id }) => id)
  } catch (_error) {
    sagaError(
      'authority-substitution',
      'The immutable transfer manifest does not compose trusted site authority.',
      'proposal.manifest',
    )
  }

  if (aggregate.proposal.id !== transferId
    || !sameCoordinate(aggregate.proposal.source, trustedScope)
    || aggregate.proposal.manifest.transferId !== transferId
    || !sameCoordinate(aggregate.proposal.manifest.source, trustedScope)
    || context.scope.site.profileId !== aggregate.proposal.manifest.siteProfileId
    || context.profile.id !== aggregate.proposal.manifest.siteProfileId
    || composedProfileId !== aggregate.proposal.manifest.siteProfileId
    || !sameOrderedValues(
      context.capabilities,
      aggregate.proposal.manifest.siteCapabilityIds,
    )
    || !sameOrderedValues(
      composedCapabilityIds,
      aggregate.proposal.manifest.siteCapabilityIds,
    )
    || context.requiredPermission !== TRANSFER_CONTROL_PERMISSION
    || !context.permissions.allow.includes(TRANSFER_CONTROL_PERMISSION)
    || context.permissions.deny.includes(TRANSFER_CONTROL_PERMISSION)) {
    sagaError(
      'authority-substitution',
      'Trusted job scope, profile, ordered capabilities, permission, and persisted transfer authority must match exactly.',
      'context',
    )
  }
}

function claimResult(
  operation: TransferSagaJobKind,
  aggregate: TransferAggregate,
  status: TransferSagaClaimResult['status'],
  transition: string,
  stepId: string | null,
  nextJobKind: TransferSagaJobKind | null,
): TransferSagaClaimResult {
  return {
    status,
    transferId: aggregate.proposal.id,
    operation,
    transition,
    proposalState: aggregate.proposal.state,
    version: aggregate.version,
    stepId,
    nextJobKind,
  }
}

function claimEffectKey(
  jobId: string,
  operation: TransferSagaJobKind,
  transferId: string,
): string {
  return ['transfer-claim', jobId, operation, transferId].join(':')
}

function failureFor(error: unknown): TransferFailure {
  return { ...transferFailure(error), retryable: true }
}

function retryStep(
  transferId: string,
  failed: TransferStep,
  definition: TransferStepDefinition,
  at: string,
): TransferStep {
  return {
    id: `${transferId}:step:${definition.id}:attempt:${failed.attempt + 1}`,
    transferId,
    lockId: failed.lockId,
    fence: failed.fence,
    sequence: failed.sequence,
    definitionId: failed.definitionId,
    attempt: failed.attempt + 1,
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

function compensationOriginalId(step: TransferStep): string | null {
  const value = step.receipt?.details.originalStepId
  return typeof value === 'string' ? value : null
}

function compensationReceipt(
  original: TransferStep,
  status: 'compensated' | 'not-applied',
  receipt: TransferReceipt | null,
): TransferReceipt {
  return status === 'compensated'
    ? {
        code: 'transfer-step-compensated',
        details: {
          originalStepId: original.id,
          handlerReceipt: structuredClone(receipt),
        },
      }
    : {
        code: 'transfer-step-not-applied',
        details: { originalStepId: original.id },
      }
}

function compensationStep(
  aggregate: TransferAggregate,
  original: TransferStep,
  status: 'compensated' | 'not-applied',
  receipt: TransferReceipt | null,
  at: string,
): TransferStep {
  const attempt = aggregate.steps
    .filter((step) => (
      step.kind === 'compensation'
      && step.definitionId === original.definitionId
    ))
    .reduce((maximum, step) => Math.max(maximum, step.attempt), 0) + 1
  return {
    id: `${aggregate.proposal.id}:compensate:${original.definitionId}:attempt:${attempt}`,
    transferId: aggregate.proposal.id,
    lockId: original.lockId,
    fence: original.fence,
    sequence: original.sequence,
    definitionId: original.definitionId,
    attempt,
    kind: 'compensation',
    state: status === 'compensated' ? 'succeeded' : 'skipped',
    receipt: compensationReceipt(original, status, receipt),
    error: null,
    createdAt: at,
    updatedAt: at,
    startedAt: at,
    finishedAt: at,
  }
}

function interruption(error: unknown): boolean {
  return error instanceof TransferInterruptionError
    || error instanceof FumaJobProcessDeathError
}

export class TransferSagaExecutor {
  readonly #repository: TransferRepository
  readonly #stepRegistry: TransferStepRegistry
  readonly #registry: FumaRegistry
  readonly #now: () => Date

  constructor(options: TransferSagaExecutorOptions) {
    this.#repository = options.repository
    this.#stepRegistry = options.stepRegistry
    this.#registry = options.registry
    this.#now = options.now ?? (() => new Date())
  }

  async runOne(
    operation: TransferSagaJobKind,
    payload: TransferSagaJobPayload,
    context: SiteJobContext,
  ): Promise<ClaimAdvance> {
    const key = repositoryKey(context, payload.transferId)
    const aggregate = await this.#required(key)
    assertAggregateAuthority(aggregate, context, payload.transferId, this.#registry)
    const result = operation === TRANSFER_EXECUTE_JOB_KIND
      ? await this.#execute(key, aggregate)
      : operation === TRANSFER_RESUME_JOB_KIND
        ? await this.#resume(key, aggregate)
        : await this.#compensate(key, aggregate)
    return { result }
  }

  async #execute(
    key: TransferRepositoryKey,
    aggregate: TransferAggregate,
  ): Promise<TransferSagaClaimResult> {
    if (['completed', 'failed', 'cancelled'].includes(aggregate.proposal.state)) {
      return claimResult(TRANSFER_EXECUTE_JOB_KIND, aggregate, 'terminal', 'terminal-replay', null, null)
    }
    if (aggregate.proposal.state === 'compensating') {
      return claimResult(
        TRANSFER_EXECUTE_JOB_KIND,
        aggregate,
        'unchanged',
        'compensation-required',
        null,
        TRANSFER_COMPENSATE_JOB_KIND,
      )
    }
    if (aggregate.proposal.state !== 'running') {
      sagaError('invalid-state', 'Execute jobs require a running transfer.', 'proposal.state')
    }
    assertActiveFence(aggregate)
    const steps = latestForwardSteps(aggregate.steps)
    const next = steps.find(({ state }) => state !== 'succeeded' && state !== 'skipped')
    if (next?.state === 'running') return await this.#applyForwardStep(key, aggregate, next)

    if (next?.state === 'pending') {
      const at = validTime(this.#now, aggregate.version)
      const started: TransferStep = {
        ...structuredClone(next),
        state: 'running',
        updatedAt: at,
        startedAt: at,
      }
      const advance = await this.#repository.transaction(key, async (transaction) => {
        const current = await this.#requiredTransaction(transaction, key)
        assertActiveFence(current)
        const stored = current.steps.find(({ id }) => id === next.id)
        if (!stored || stored.state !== 'pending') return transactionAdvance(current, false)
        const proposal = nextProposal(current.proposal, at, {})
        await transaction.recordStep(key, current.version, proposal, started)
        return transactionAdvance(
          await this.#requiredTransaction(transaction, key),
          true,
        )
      })
      return claimResult(
        TRANSFER_EXECUTE_JOB_KIND,
        advance.aggregate,
        advance.didWrite ? 'advanced' : 'unchanged',
        'step-started',
        next.id,
        TRANSFER_EXECUTE_JOB_KIND,
      )
    }

    if (next?.state === 'failed' && next.error.retryable) {
      const definition = definitionFor(
        this.#registry,
        this.#stepRegistry,
        aggregate.proposal.manifest,
        next,
      )
      const at = validTime(this.#now, aggregate.version)
      const retry = retryStep(aggregate.proposal.id, next, definition, at)
      const advance = await this.#repository.transaction(key, async (transaction) => {
        const current = await this.#requiredTransaction(transaction, key)
        assertActiveFence(current)
        const latest = latestForwardSteps(current.steps).find(({ definitionId }) => (
          next.definitionId === definitionId
        ))
        if (!latest || latest.id !== next.id || latest.state !== 'failed') {
          return transactionAdvance(current, false)
        }
        const proposal = nextProposal(current.proposal, at, {})
        await transaction.recordStep(key, current.version, proposal, retry)
        return transactionAdvance(
          await this.#requiredTransaction(transaction, key),
          true,
        )
      })
      return claimResult(
        TRANSFER_EXECUTE_JOB_KIND,
        advance.aggregate,
        advance.didWrite ? 'advanced' : 'unchanged',
        'step-retry-created',
        retry.id,
        TRANSFER_EXECUTE_JOB_KIND,
      )
    }

    if (next) {
      sagaError('invalid-state', 'Running transfer has no valid next transition.', 'steps')
    }

    if (!steps.every(({ state }) => state === 'succeeded' || state === 'skipped')) {
      sagaError('invalid-state', 'Running transfer has no valid next transition.', 'steps')
    }
    const at = validTime(this.#now, aggregate.version)
    const advance = await this.#repository.transaction(key, async (transaction) => {
      const current = await this.#requiredTransaction(transaction, key)
      if (current.proposal.state === 'completed') return transactionAdvance(current, false)
      assertActiveFence(current)
      if (!latestForwardSteps(current.steps).every(({ state }) => (
        state === 'succeeded' || state === 'skipped'
      ))) return transactionAdvance(current, false)
      const proposal = nextProposal(current.proposal, at, {
        state: 'completed',
        completedAt: at,
      })
      await transaction.recordCompletion(key, current.version, proposal)
      await transaction.releaseLock(
        key,
        proposal,
        current.lock.id,
        current.lock.fence,
        at,
        'completed',
      )
      return transactionAdvance(
        await this.#requiredTransaction(transaction, key),
        true,
      )
    })
    return claimResult(
      TRANSFER_EXECUTE_JOB_KIND,
      advance.aggregate,
      advance.didWrite ? 'advanced' : 'unchanged',
      'transfer-completed',
      null,
      null,
    )
  }

  async #applyForwardStep(
    key: TransferRepositoryKey,
    aggregate: TransferAggregate,
    running: TransferStep,
  ): Promise<TransferSagaClaimResult> {
    const definition = definitionFor(
      this.#registry,
      this.#stepRegistry,
      aggregate.proposal.manifest,
      running,
    )
    let receipt: TransferReceipt
    try {
      receipt = await definition.apply({
        manifest: aggregate.proposal.manifest,
        saga: {
          transferId: aggregate.proposal.id,
          lockId: running.lockId,
          fence: running.fence,
        },
        receipt: running.receipt,
      })
      if (!Value.Check(TransferReceiptSchema, receipt)) {
        sagaError('invalid-step', 'Transfer handler returned an invalid receipt.', 'step.receipt')
      }
    } catch (error) {
      if (interruption(error)) throw error
      return await this.#recordForwardFailure(key, aggregate, running, error)
    }

    const at = validTime(this.#now, aggregate.version)
    const advance = await this.#repository.transaction(key, async (transaction) => {
      const current = await this.#requiredTransaction(transaction, key)
      assertActiveFence(current)
      const stored = current.steps.find(({ id }) => id === running.id)
      if (stored?.state === 'succeeded') return transactionAdvance(current, false)
      if (!stored || stored.state !== 'running') return transactionAdvance(current, false)
      const succeeded: TransferStep = {
        ...structuredClone(stored),
        state: 'succeeded',
        receipt: structuredClone(receipt),
        error: null,
        updatedAt: at,
        finishedAt: at,
      }
      const proposal = nextProposal(current.proposal, at, {})
      await transaction.recordStep(key, current.version, proposal, succeeded)
      return transactionAdvance(
        await this.#requiredTransaction(transaction, key),
        true,
      )
    })
    return claimResult(
      TRANSFER_EXECUTE_JOB_KIND,
      advance.aggregate,
      advance.didWrite ? 'advanced' : 'unchanged',
      'step-effect-recorded',
      running.id,
      TRANSFER_EXECUTE_JOB_KIND,
    )
  }

  async #recordForwardFailure(
    key: TransferRepositoryKey,
    aggregate: TransferAggregate,
    running: TransferStep,
    error: unknown,
  ): Promise<TransferSagaClaimResult> {
    const at = validTime(this.#now, aggregate.version)
    const failure = failureFor(error)
    const advance = await this.#repository.transaction(key, async (transaction) => {
      const current = await this.#requiredTransaction(transaction, key)
      assertActiveFence(current)
      const stored = current.steps.find(({ id }) => id === running.id)
      if (!stored || stored.state !== 'running') return transactionAdvance(current, false)
      const failed: TransferStep = {
        ...structuredClone(stored),
        state: 'failed',
        receipt: null,
        error: failure,
        updatedAt: at,
        finishedAt: at,
      }
      const proposal = nextProposal(current.proposal, at, {
        state: 'compensating',
        failure,
        compensationStartedAt: at,
      })
      await transaction.recordFailure(key, current.version, proposal, failed)
      return transactionAdvance(
        await this.#requiredTransaction(transaction, key),
        true,
      )
    })
    return claimResult(
      TRANSFER_EXECUTE_JOB_KIND,
      advance.aggregate,
      advance.didWrite ? 'advanced' : 'unchanged',
      'step-failed',
      running.id,
      TRANSFER_COMPENSATE_JOB_KIND,
    )
  }

  async #resume(
    key: TransferRepositoryKey,
    aggregate: TransferAggregate,
  ): Promise<TransferSagaClaimResult> {
    if (['completed', 'failed', 'cancelled'].includes(aggregate.proposal.state)) {
      return claimResult(TRANSFER_RESUME_JOB_KIND, aggregate, 'terminal', 'terminal-replay', null, null)
    }
    if (aggregate.proposal.state !== 'resume-requested') {
      sagaError('invalid-state', 'Resume jobs require a persisted resume request.', 'proposal.state')
    }
    assertActiveFence(aggregate)
    const running = latestForwardSteps(aggregate.steps).find(({ state }) => state === 'running')
    if (!running) sagaError('invalid-state', 'Resume request has no interrupted running step.', 'steps')
    const definition = definitionFor(
      this.#registry,
      this.#stepRegistry,
      aggregate.proposal.manifest,
      running,
    )
    const verification = await definition.verify({
      manifest: aggregate.proposal.manifest,
      saga: {
        transferId: aggregate.proposal.id,
        lockId: running.lockId,
        fence: running.fence,
      },
      receipt: running.receipt,
    })
    if (verification.status === 'verified'
      && !Value.Check(TransferReceiptSchema, verification.receipt)) {
      sagaError('invalid-step', 'Transfer verification returned an invalid receipt.', 'step.receipt')
    }
    const at = validTime(this.#now, aggregate.version)
    const advance = await this.#repository.transaction(key, async (transaction) => {
      const current = await this.#requiredTransaction(transaction, key)
      assertActiveFence(current)
      const stored = current.steps.find(({ id }) => id === running.id)
      if (!stored || stored.state !== 'running' || current.proposal.state !== 'resume-requested') {
        return transactionAdvance(current, false)
      }
      const step: TransferStep = verification.status === 'verified'
        ? {
            ...structuredClone(stored),
            state: 'succeeded',
            receipt: structuredClone(verification.receipt),
            error: null,
            updatedAt: at,
            finishedAt: at,
          }
        : {
            ...structuredClone(stored),
            state: 'failed',
            receipt: null,
            error: {
              code: 'interrupted-before-effect',
              message: 'Interrupted attempt was verified as not applied.',
              retryable: true,
              details: {},
            },
            updatedAt: at,
            finishedAt: at,
          }
      const proposal = nextProposal(current.proposal, at, { state: 'running' })
      await transaction.recordStep(key, current.version, proposal, step)
      return transactionAdvance(
        await this.#requiredTransaction(transaction, key),
        true,
      )
    })
    return claimResult(
      TRANSFER_RESUME_JOB_KIND,
      advance.aggregate,
      advance.didWrite ? 'advanced' : 'unchanged',
      verification.status === 'verified' ? 'interrupted-effect-verified' : 'interrupted-attempt-failed',
      running.id,
      TRANSFER_EXECUTE_JOB_KIND,
    )
  }

  async #compensate(
    key: TransferRepositoryKey,
    aggregate: TransferAggregate,
  ): Promise<TransferSagaClaimResult> {
    if (['completed', 'failed', 'cancelled'].includes(aggregate.proposal.state)) {
      return claimResult(TRANSFER_COMPENSATE_JOB_KIND, aggregate, 'terminal', 'terminal-replay', null, null)
    }
    if (aggregate.proposal.state !== 'compensating') {
      sagaError('invalid-state', 'Compensate jobs require a compensating transfer.', 'proposal.state')
    }
    assertActiveFence(aggregate)
    const compensations = aggregate.steps.filter(({ kind }) => kind === 'compensation')
    const original = latestForwardSteps(aggregate.steps)
      .filter(({ state }) => state === 'succeeded' || state === 'failed')
      .toSorted((left, right) => right.sequence - left.sequence)
      .find((forward) => !compensations.some((compensation) => (
        compensation.definitionId === forward.definitionId
        && compensationOriginalId(compensation) === forward.id
      )))

    if (!original) {
      const at = validTime(this.#now, aggregate.version)
      const advance = await this.#repository.transaction(key, async (transaction) => {
        const current = await this.#requiredTransaction(transaction, key)
        if (current.proposal.state === 'failed') return transactionAdvance(current, false)
        assertActiveFence(current)
        const proposal = nextProposal(current.proposal, at, {
          state: 'failed',
          compensationCompletedAt: at,
        })
        await transaction.recordFailure(key, current.version, proposal)
        await transaction.releaseLock(
          key,
          proposal,
          current.lock.id,
          current.lock.fence,
          at,
          'transfer-failed',
        )
        return transactionAdvance(
          await this.#requiredTransaction(transaction, key),
          true,
        )
      })
      return claimResult(
        TRANSFER_COMPENSATE_JOB_KIND,
        advance.aggregate,
        advance.didWrite ? 'advanced' : 'unchanged',
        'compensation-completed',
        null,
        null,
      )
    }

    const definition = definitionFor(
      this.#registry,
      this.#stepRegistry,
      aggregate.proposal.manifest,
      original,
    )
    const compensation = await definition.compensate({
      manifest: aggregate.proposal.manifest,
      saga: {
        transferId: aggregate.proposal.id,
        lockId: original.lockId,
        fence: original.fence,
      },
      receipt: original.receipt,
    })
    if (compensation.status === 'compensated'
      && !Value.Check(TransferReceiptSchema, compensation.receipt)) {
      sagaError('invalid-step', 'Transfer compensation returned an invalid receipt.', 'step.receipt')
    }
    const at = validTime(this.#now, aggregate.version)
    const step = compensationStep(
      aggregate,
      original,
      compensation.status,
      compensation.receipt,
      at,
    )
    const advance = await this.#repository.transaction(key, async (transaction) => {
      const current = await this.#requiredTransaction(transaction, key)
      assertActiveFence(current)
      const alreadyRecorded = current.steps.some((candidate) => (
        candidate.kind === 'compensation'
        && candidate.definitionId === original.definitionId
        && compensationOriginalId(candidate) === original.id
      ))
      if (alreadyRecorded) return transactionAdvance(current, false)
      const proposal = nextProposal(current.proposal, at, {})
      await transaction.recordCompensation(key, current.version, proposal, step)
      return transactionAdvance(
        await this.#requiredTransaction(transaction, key),
        true,
      )
    })
    return claimResult(
      TRANSFER_COMPENSATE_JOB_KIND,
      advance.aggregate,
      advance.didWrite ? 'advanced' : 'unchanged',
      compensation.status === 'compensated' ? 'step-compensated' : 'step-compensation-skipped',
      original.id,
      TRANSFER_COMPENSATE_JOB_KIND,
    )
  }

  async #required(key: TransferRepositoryKey): Promise<TransferAggregate> {
    const aggregate = await this.#repository.read(key)
    if (!aggregate) sagaError('not-found', 'Transfer saga was not found.', 'payload.transferId')
    assertRepositoryAncestry(aggregate, key)
    return aggregate
  }

  async #requiredTransaction(
    transaction: TransferRepositoryTransaction,
    key: TransferRepositoryKey,
  ): Promise<TransferAggregate> {
    const aggregate = await transaction.read(key)
    if (!aggregate) sagaError('not-found', 'Transfer saga was not found.', 'payload.transferId')
    assertRepositoryAncestry(aggregate, key)
    return aggregate
  }
}

function failureCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code) return code
  }
  return error instanceof Error && error.name ? error.name : 'transfer-job-failed'
}

function parseCommittedResult(value: FumaJobJsonValue): TransferSagaClaimResult {
  const parsed = safeParseValue(TransferSagaClaimResultSchema, value)
  if (!parsed.ok) {
    sagaError('invalid-state', 'Durable transfer job effect contains an invalid result.', 'job.effect')
  }
  return parsed.value
}

function continuationInput(
  context: SiteJobContext,
  currentJobId: string,
  result: TransferSagaClaimResult,
): EnqueueFumaJob {
  if (!result.nextJobKind) {
    sagaError('invalid-state', 'A continuation requires a next job kind.', 'result.nextJobKind')
  }
  const idempotencyKey = [
    'transfer-continuation',
    result.transferId,
    result.nextJobKind,
    result.version,
    result.transition,
  ].join(':')
  return {
    id: `${currentJobId}:continuation:${result.version}:${result.nextJobKind}`,
    organizationId: context.scope.organization.id,
    siteId: context.scope.site.id,
    kind: result.nextJobKind,
    payload: { transferId: result.transferId },
    maxAttempts: 100,
    idempotencyKey,
  }
}

async function recordJobFact(
  audit: TransferSagaJobAuditPort,
  context: FumaJobContext,
  action: 'job.started' | 'job.succeeded' | 'job.failed' | 'job.cancelled',
  jobKind: string,
  attempt: number,
  metadata: Record<string, FumaJobJsonValue> = {},
): Promise<void> {
  await audit.recordJob(context, {
    action,
    target: 'site',
    outcome: action === 'job.failed' ? 'failure' : 'success',
    metadata: {
      jobKind,
      attempt,
      ...metadata,
    },
  })
}

async function recordTransferTransitionFact(
  audit: TransferSagaJobAuditPort,
  context: SiteJobContext,
  result: TransferSagaClaimResult,
  aggregate: TransferAggregate,
): Promise<void> {
  if (result.status !== 'advanced') return

  let input: Readonly<{
    action:
      | 'transfer.step.completed'
      | 'transfer.failed'
      | 'transfer.compensated'
      | 'transfer.completed'
    outcome: 'success' | 'failure'
    metadata: Record<string, FumaJobJsonValue>
  }> | null = null

  if (result.transition === 'step-effect-recorded'
    || result.transition === 'interrupted-effect-verified') {
    if (!result.stepId) {
      sagaError('invalid-state', 'A completed transfer step requires its persisted step ID.', 'result.stepId')
    }
    input = {
      action: 'transfer.step.completed',
      outcome: 'success',
      metadata: { transferId: result.transferId, stepId: result.stepId },
    }
  } else if (result.transition === 'step-compensated'
    || result.transition === 'step-compensation-skipped') {
    if (!result.stepId) {
      sagaError('invalid-state', 'A compensated transfer step requires its persisted step ID.', 'result.stepId')
    }
    input = {
      action: 'transfer.compensated',
      outcome: 'success',
      metadata: {
        transferId: result.transferId,
        stepId: result.stepId,
        transition: result.transition,
      },
    }
  } else if (result.transition === 'compensation-completed') {
    input = {
      action: 'transfer.failed',
      outcome: 'failure',
      metadata: {
        transferId: result.transferId,
        failureCode: aggregate.proposal.failure?.code ?? 'transfer-step-failed',
      },
    }
  } else if (result.transition === 'transfer-completed') {
    input = {
      action: 'transfer.completed',
      outcome: 'success',
      metadata: {
        transferId: result.transferId,
        destinationOrganizationId: aggregate.proposal.destination.organizationId,
      },
    }
  }

  if (input) {
    await audit.recordJob(context, {
      ...input,
      target: 'site',
    })
  }
}

/**
 * Produces the three FUMA-009 handlers. FUMA-024 owns registering their job
 * contributions and mounting this returned map in the worker composition root.
 */
export function createTransferSagaJobHandlers(
  options: TransferSagaJobHandlersOptions,
): Readonly<Record<TransferSagaJobKind, FumaJobHandler>> {
  const executor = new TransferSagaExecutor(options)

  const handle = async (handlerContext: FumaJobHandlerContext): Promise<FumaJobJsonValue> => {
    const operation = handlerContext.job.kind
    const payload = parsedPayload(operation, handlerContext.job.payload)
    const trusted = await deriveFumaJobContext({
      jobRecord: handlerContext.job,
      authority: options.authority,
      registry: options.registry,
      ...(options.now ? { now: options.now } : {}),
    })
    if (trusted.kind !== 'site') {
      sagaError('authority-substitution', 'Transfer saga jobs require exact site authority.', 'context.kind')
    }
    const jobKind = operation as TransferSagaJobKind
    await recordJobFact(options.audit, trusted, 'job.started', jobKind, handlerContext.attemptNumber, {
      transferId: payload.transferId,
    })

    try {
      const durableEffectKey = claimEffectKey(
        handlerContext.job.id,
        jobKind,
        payload.transferId,
      )
      const prior = await handlerContext.readDurableResult(durableEffectKey)
      let committedResult: FumaJobJsonValue

      if (prior === null) {
        let claim: TransferSagaClaimResult
        if (await handlerContext.cancellationRequested()) {
          const aggregate = await options.repository.read(repositoryKey(trusted, payload.transferId))
          if (!aggregate) sagaError('not-found', 'Transfer saga was not found.', 'payload.transferId')
          assertAggregateAuthority(aggregate, trusted, payload.transferId, options.registry)
          claim = claimResult(
            jobKind,
            aggregate,
            'cancelled',
            'job-cancelled',
            null,
            null,
          )
        } else {
          claim = (await executor.runOne(jobKind, payload, trusted)).result
        }
        committedResult = (await handlerContext.commitDurableResult(
          durableEffectKey,
          claim,
        )).result
      } else {
        committedResult = prior.result
      }

      const result = parseCommittedResult(committedResult)
      if (result.status === 'cancelled') {
        await recordJobFact(options.audit, trusted, 'job.cancelled', jobKind, handlerContext.attemptNumber, {
          transferId: result.transferId,
        })
        return result
      }
      if (result.nextJobKind) {
        await options.enqueue.enqueue(continuationInput(
          trusted,
          handlerContext.job.id,
          result,
        ))
      }
      const committedAggregate = await options.repository.read(
        repositoryKey(trusted, result.transferId),
      )
      if (!committedAggregate) {
        sagaError('not-found', 'Committed transfer saga was not found.', 'job.effect.transferId')
      }
      assertRepositoryAncestry(
        committedAggregate,
        repositoryKey(trusted, result.transferId),
      )
      assertAggregateAuthority(
        committedAggregate,
        trusted,
        result.transferId,
        options.registry,
      )
      await recordTransferTransitionFact(
        options.audit,
        trusted,
        result,
        committedAggregate,
      )
      await recordJobFact(options.audit, trusted, 'job.succeeded', jobKind, handlerContext.attemptNumber, {
        transferId: result.transferId,
        transition: result.transition,
      })
      return result
    } catch (error) {
      await recordJobFact(options.audit, trusted, 'job.failed', jobKind, handlerContext.attemptNumber, {
        transferId: payload.transferId,
        failureCode: failureCode(error),
      })
      throw error
    }
  }

  return Object.freeze({
    [TRANSFER_EXECUTE_JOB_KIND]: handle,
    [TRANSFER_RESUME_JOB_KIND]: handle,
    [TRANSFER_COMPENSATE_JOB_KIND]: handle,
  })
}

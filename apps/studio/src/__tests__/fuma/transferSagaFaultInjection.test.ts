import { describe, expect, it } from 'bun:test'
import { FumaRegistry } from '@core/fuma'
import { Value } from '@core/utils/typeboxHelpers'
import type { FumaJobContext } from '../../../server/fuma/context'
import {
  TRANSFER_COMPENSATE_JOB_KIND,
  TRANSFER_EXECUTE_JOB_KIND,
  TRANSFER_RESUME_JOB_KIND,
  TransferCompensateJobPayloadSchema,
  TransferExecuteJobPayloadSchema,
  TransferResumeJobPayloadSchema,
  TransferSagaExecutor,
  type TransferSagaJobKind,
} from '../../../server/fuma/transfers/jobs'
import {
  TransferInterruptionError,
  type TransferAggregate,
  type TransferConfirmation,
  type TransferLockRequest,
  type TransferManifest,
  type TransferOwnershipCoordinate,
  type TransferProposal,
  type TransferReceipt,
  type TransferRepository,
  type TransferRepositoryKey,
  type TransferRepositoryTransaction,
  type TransferStep,
  type TransferStepDefinition,
} from '../../../server/fuma/transfers'
import { TransferRepositoryError } from '../../../server/fuma/transfers/repository'
import { createTransferStepRegistry } from '../../../server/fuma/transfers/stepRegistry'

const SOURCE: TransferOwnershipCoordinate = {
  platformId: 'platform-fuma',
  organizationId: 'organization-source',
  workspaceId: 'workspace-source',
  siteId: 'site-transfer',
}
const DESTINATION: TransferOwnershipCoordinate = {
  platformId: 'platform-fuma',
  organizationId: 'organization-destination',
  workspaceId: 'workspace-destination',
  siteId: 'site-transfer',
}
const BASE_TIME = Date.parse('2026-07-25T06:00:00.000Z')

type RepositoryFault =
  | 'record-step-before'
  | 'record-step-after'
  | 'record-compensation-before'
  | 'record-compensation-after'
  | 'record-failure-before'
  | 'record-failure-after'
  | 'record-completion-before'
  | 'record-completion-after'
  | 'release-lock-before'
  | 'release-lock-after'
  | null

type ApplyFault = 'before' | 'after' | null

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

function context(scope = SOURCE): Extract<FumaJobContext, { kind: 'site' }> {
  return deepFreeze({
    kind: 'site',
    originatingRequestId: 'request-transfer-start',
    requestId: 'job-transfer:request:7',
    source: {
      kind: 'internal-job',
      correlationId: 'job-transfer:request:7',
      jobId: 'job-transfer',
      runId: 'job-transfer:run:7',
    },
    actor: {
      kind: 'internal-job',
      jobId: 'job-transfer',
      runId: 'job-transfer:run:7',
    },
    scope: {
      platform: { id: scope.platformId, status: 'active' },
      organization: {
        id: scope.organizationId,
        platformId: scope.platformId,
        status: 'active',
      },
      workspace: {
        id: scope.workspaceId,
        platformId: scope.platformId,
        organizationId: scope.organizationId,
        status: 'active',
      },
      site: {
        id: scope.siteId,
        platformId: scope.platformId,
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        profileId: 'website',
        status: 'active',
      },
    },
    profile: { id: 'website', status: 'active' },
    capabilities: ['site.settings'],
    permissions: {
      subjectId: 'job-transfer',
      allow: ['site.settings.write'],
      deny: [],
    },
    requiredPermission: 'site.settings.write',
  })
}

function manifest(): TransferManifest {
  return {
    schemaVersion: 1,
    transferId: 'transfer-01',
    source: SOURCE,
    destination: DESTINATION,
    siteProfileId: 'website',
    siteCapabilityOverrides: { grant: [], revoke: [] },
    siteCapabilityIds: ['site.settings'],
    snapshotChecksum: 'a'.repeat(64),
    resources: ['site-record', 'content'],
    collaborators: [{
      userId: 'user-editor',
      sourceRole: 'editor',
      intent: 'preserve',
      destinationRole: 'editor',
    }],
    capturedAt: new Date(BASE_TIME).toISOString(),
  }
}

function testRegistry(): FumaRegistry {
  return new FumaRegistry({
    capabilities: [{
      id: 'site.settings',
      transfer: [{
        id: 'transfer.fake-downstream',
        stepId: 'transfer.fake-downstream',
        permission: 'site.settings.write',
      }],
    }],
    profiles: [{
      id: 'website',
      label: 'Website',
      capabilityPreset: ['site.settings'],
      navigationPreset: [],
      onboardingPreset: [],
      starterTemplatePreset: [],
    }],
  })
}

function proposal(state: TransferProposal['state'] = 'running'): TransferProposal {
  const at = new Date(BASE_TIME).toISOString()
  return {
    id: 'transfer-01',
    source: SOURCE,
    destination: DESTINATION,
    manifest: manifest(),
    state,
    proposedByUserId: 'source-owner',
    proposedBySessionId: 'session-source-owner',
    proposedRequestId: 'request-propose',
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
    readyAt: at,
    startedAt: at,
    compensationStartedAt: null,
    compensationCompletedAt: null,
    completedAt: null,
    cancelledAt: null,
  }
}

function confirmation(side: 'source' | 'destination'): TransferConfirmation {
  return {
    transferId: 'transfer-01',
    side,
    scope: side === 'source' ? SOURCE : DESTINATION,
    confirmedByUserId: `${side}-owner`,
    confirmedBySessionId: `session-${side}`,
    requestId: `request-${side}`,
    confirmedAt: new Date(BASE_TIME).toISOString(),
  }
}

function step(
  definition: TransferStepDefinition,
  kind: TransferStep['kind'],
): TransferStep {
  const at = new Date(BASE_TIME).toISOString()
  return {
    id: `transfer-01:step:${definition.id}:attempt:1`,
    transferId: 'transfer-01',
    lockId: 'lock-transfer-01',
    fence: 7,
    definitionId: definition.id,
    sequence: definition.order,
    attempt: 1,
    kind,
    state: 'pending',
    receipt: null,
    error: null,
    createdAt: at,
    updatedAt: at,
    startedAt: null,
    finishedAt: null,
  }
}

class FakeWorld {
  owner: 'source' | 'destination' = 'source'
  ownershipReceipt: TransferReceipt | null = null
  collaboratorIntent: 'absent' | 'pending' = 'absent'
  downstreamApplied = false
  baseEffects = 0
  applyFault: ApplyFault = null
  downstreamFailure = false
  downstreamCompensation: 'compensated' | 'not-applied' | 'failure' = 'compensated'
  compensationOrder: string[] = []

  assertVisible(): void {
    const source = this.owner === 'source'
      && this.ownershipReceipt === null
      && this.collaboratorIntent === 'absent'
    const destination = this.owner === 'destination'
      && this.ownershipReceipt?.code === 'base-owned'
      && this.collaboratorIntent === 'pending'
    expect(source || destination).toBe(true)
  }
}

function definitions(world: FakeWorld): readonly TransferStepDefinition[] {
  const baseReceipt = (): TransferReceipt => ({
    code: 'base-owned',
    details: {
      transferId: 'transfer-01',
      lockId: 'lock-transfer-01',
      fence: 7,
    },
  })
  const base: TransferStepDefinition = {
    id: 'transfer.base-ownership',
    order: 40,
    dependsOn: [],
    mandatory: true,
    async apply() {
      if (world.applyFault === 'before') {
        world.applyFault = null
        throw new TransferInterruptionError('death before base effect')
      }
      if (world.owner === 'source') {
        world.owner = 'destination'
        world.ownershipReceipt = baseReceipt()
        world.collaboratorIntent = 'pending'
        world.baseEffects += 1
      }
      if (world.applyFault === 'after') {
        world.applyFault = null
        throw new TransferInterruptionError('death after base effect')
      }
      world.assertVisible()
      return baseReceipt()
    },
    async verify() {
      world.assertVisible()
      return world.owner === 'destination'
        ? { status: 'verified', receipt: baseReceipt() }
        : { status: 'not-applied', receipt: null }
    },
    async compensate(input) {
      world.compensationOrder.push('base')
      if (world.owner === 'destination') {
        expect(input.receipt).toEqual(baseReceipt())
        world.owner = 'source'
        world.ownershipReceipt = null
        world.collaboratorIntent = 'absent'
      }
      world.assertVisible()
      return {
        status: 'compensated',
        receipt: { code: 'base-restored', details: {} },
      }
    },
  }
  const downstream: TransferStepDefinition = {
    id: 'transfer.fake-downstream',
    order: 50,
    dependsOn: [base.id],
    async apply() {
      if (world.downstreamFailure) throw new Error('registered downstream failed')
      world.downstreamApplied = true
      return { code: 'downstream-applied', details: {} }
    },
    async verify() {
      return world.downstreamApplied
        ? { status: 'verified', receipt: { code: 'downstream-applied', details: {} } }
        : { status: 'not-applied', receipt: null }
    },
    async compensate() {
      world.compensationOrder.push('downstream')
      if (world.downstreamCompensation === 'failure') {
        throw new Error('registered compensation failed')
      }
      if (world.downstreamCompensation === 'not-applied') {
        return { status: 'not-applied', receipt: null }
      }
      world.downstreamApplied = false
      return {
        status: 'compensated',
        receipt: { code: 'downstream-restored', details: {} },
      }
    },
  }
  return [base, downstream]
}

class MemorySagaRepository implements TransferRepository, TransferRepositoryTransaction {
  aggregate: TransferAggregate
  fault: RepositoryFault = null
  beforeTransactionWork: (() => void) | null = null

  constructor(steps: readonly TransferStep[]) {
    const sourceConfirmation = confirmation('source')
    const destinationConfirmation = confirmation('destination')
    this.aggregate = {
      proposal: proposal(),
      confirmations: {
        status: 'confirmed',
        source: sourceConfirmation,
        destination: destinationConfirmation,
      },
      lock: {
        id: 'lock-transfer-01',
        transferId: 'transfer-01',
        scope: SOURCE,
        fence: 7,
        state: 'active',
        acquiredByJobId: 'job-transfer-start',
        acquiredByRunId: 'job-transfer-start:run:1',
        requestId: 'request-transfer-start',
        acquiredAt: new Date(BASE_TIME).toISOString(),
        heartbeatAt: new Date(BASE_TIME).toISOString(),
        releasedAt: null,
        releaseReasonCode: null,
      },
      steps: structuredClone(steps),
      version: new Date(BASE_TIME).toISOString(),
    }
  }

  read(key: TransferRepositoryKey): Promise<TransferAggregate | null> {
    if (key.transferId !== this.aggregate.proposal.id
      || JSON.stringify(key.source) !== JSON.stringify(this.aggregate.proposal.source)) {
      return Promise.resolve(null)
    }
    return Promise.resolve(structuredClone(this.aggregate))
  }

  async transaction<T>(
    _key: TransferRepositoryKey,
    work: (transaction: TransferRepositoryTransaction) => Promise<T>,
  ): Promise<T> {
    const beforeTransactionWork = this.beforeTransactionWork
    this.beforeTransactionWork = null
    beforeTransactionWork?.()
    const snapshot = structuredClone(this.aggregate)
    try {
      return await work(this)
    } catch (error) {
      this.aggregate = snapshot
      throw error
    }
  }

  insertProposal(): Promise<void> {
    throw new Error('not used by transfer saga jobs')
  }

  recordConfirmation(): Promise<void> {
    throw new Error('not used by transfer saga jobs')
  }

  acquireLock(
    _key: TransferRepositoryKey,
    _proposal: TransferProposal,
    _request: TransferLockRequest,
  ) {
    throw new Error('not used by transfer saga jobs')
  }

  recordStart(): Promise<void> {
    throw new Error('not used by transfer saga jobs')
  }

  recordStep(
    _key: TransferRepositoryKey,
    expectedVersion: string,
    nextProposal: TransferProposal,
    nextStep: TransferStep,
  ): Promise<void> {
    this.#version(expectedVersion)
    this.#fault('record-step-before')
    const steps = [...this.aggregate.steps]
    const index = steps.findIndex(({ id }) => id === nextStep.id)
    if (index === -1) steps.push(structuredClone(nextStep))
    else steps[index] = structuredClone(nextStep)
    this.aggregate = {
      ...this.aggregate,
      proposal: structuredClone(nextProposal),
      steps,
      version: nextProposal.updatedAt,
    }
    this.#fault('record-step-after')
    return Promise.resolve()
  }

  recordCancellation(): Promise<void> {
    throw new Error('not used by transfer saga jobs')
  }

  recordResume(): Promise<void> {
    throw new Error('not used by transfer saga jobs')
  }

  recordFailure(
    key: TransferRepositoryKey,
    expectedVersion: string,
    nextProposal: TransferProposal,
    nextStep?: TransferStep,
  ): Promise<void> {
    if (nextStep) return this.recordStep(key, expectedVersion, nextProposal, nextStep)
    this.#version(expectedVersion)
    this.#fault('record-failure-before')
    this.aggregate = {
      ...this.aggregate,
      proposal: structuredClone(nextProposal),
      version: nextProposal.updatedAt,
    }
    this.#fault('record-failure-after')
    return Promise.resolve()
  }

  recordCompensation(
    key: TransferRepositoryKey,
    expectedVersion: string,
    nextProposal: TransferProposal,
    nextStep: TransferStep,
  ): Promise<void> {
    this.#fault('record-compensation-before')
    const recorded = this.recordStep(key, expectedVersion, nextProposal, nextStep)
    this.#fault('record-compensation-after')
    return recorded
  }

  recordCompletion(
    _key: TransferRepositoryKey,
    expectedVersion: string,
    nextProposal: TransferProposal,
  ): Promise<void> {
    this.#version(expectedVersion)
    this.#fault('record-completion-before')
    this.aggregate = {
      ...this.aggregate,
      proposal: structuredClone(nextProposal),
      version: nextProposal.updatedAt,
    }
    this.#fault('record-completion-after')
    return Promise.resolve()
  }

  releaseLock(
    _key: TransferRepositoryKey,
    nextProposal: TransferProposal,
    lockId: string,
    fence: number,
    releasedAt: string,
    reasonCode: string,
  ) {
    if (nextProposal.id !== this.aggregate.proposal.id
      || !this.aggregate.lock
      || this.aggregate.lock.state !== 'active'
      || this.aggregate.lock.id !== lockId
      || this.aggregate.lock.fence !== fence) {
      throw new TransferRepositoryError('stale-fence', 'stale fake lock')
    }
    this.#fault('release-lock-before')
    const lock = {
      ...this.aggregate.lock,
      state: 'released' as const,
      heartbeatAt: releasedAt,
      releasedAt,
      releaseReasonCode: reasonCode,
    }
    this.aggregate = { ...this.aggregate, lock }
    this.#fault('release-lock-after')
    return Promise.resolve(structuredClone(lock))
  }

  requestResume(): void {
    const at = new Date(Date.parse(this.aggregate.version) + 1).toISOString()
    this.aggregate = {
      ...this.aggregate,
      proposal: {
        ...this.aggregate.proposal,
        state: 'resume-requested',
        resumeRequestedByUserId: 'source-owner',
        resumeRequestId: 'request-resume',
        resumeReasonCode: 'worker-restarted',
        resumeCount: this.aggregate.proposal.resumeCount + 1,
        updatedAt: at,
      },
      version: at,
    }
  }

  cancel(): void {
    const at = new Date(Date.parse(this.aggregate.version) + 1).toISOString()
    this.aggregate = {
      ...this.aggregate,
      proposal: {
        ...this.aggregate.proposal,
        state: 'cancelled',
        cancellationRequestedByUserId: 'source-owner',
        cancellationRequestId: 'request-cancel',
        cancellationReasonCode: 'operator-cancelled',
        cancelledAt: at,
        updatedAt: at,
      },
      version: at,
    }
  }

  #version(expectedVersion: string): void {
    if (this.aggregate.version !== expectedVersion) {
      throw new TransferRepositoryError('stale-version', 'stale fake version')
    }
  }

  #fault(expected: Exclude<RepositoryFault, null>): void {
    if (this.fault !== expected) return
    this.fault = null
    throw new Error(`fault:${expected}`)
  }
}

function harness() {
  const world = new FakeWorld()
  const registered = definitions(world)
  const repository = new MemorySagaRepository([
    step(registered[0]!, 'forward'),
    step(registered[1]!, 'forward'),
  ])
  const stepRegistry = createTransferStepRegistry(registered)
  let tick = 1
  const executor = new TransferSagaExecutor({
    repository,
    stepRegistry,
    registry: testRegistry(),
    now: () => new Date(BASE_TIME + tick++),
  })
  const run = (kind: TransferSagaJobKind) => executor.runOne(
    kind,
    { transferId: 'transfer-01' },
    context(),
  )
  return { world, repository, executor, run }
}

function stepState(repository: MemorySagaRepository, sequence: number): TransferStep['state'] {
  return repository.aggregate.steps
    .filter((candidate) => candidate.kind === 'forward' && candidate.sequence === sequence)
    .toSorted((left, right) => right.attempt - left.attempt)[0]!.state
}

function raceTransaction(
  repository: MemorySagaRepository,
  winner: (aggregate: TransferAggregate, at: string) => TransferAggregate,
): void {
  repository.beforeTransactionWork = () => {
    const at = new Date(Date.parse(repository.aggregate.version) + 100).toISOString()
    repository.aggregate = winner(repository.aggregate, at)
  }
}

function withProposalVersion(
  aggregate: TransferAggregate,
  at: string,
  patch: Partial<TransferProposal> = {},
): TransferAggregate {
  return {
    ...aggregate,
    proposal: { ...aggregate.proposal, ...patch, updatedAt: at },
    version: at,
  }
}

async function prepareCompensating(
  h: ReturnType<typeof harness>,
): Promise<void> {
  await h.run(TRANSFER_EXECUTE_JOB_KIND)
  await h.run(TRANSFER_EXECUTE_JOB_KIND)
  await h.run(TRANSFER_EXECUTE_JOB_KIND)
  h.world.downstreamFailure = true
  await h.run(TRANSFER_EXECUTE_JOB_KIND)
}

function markForwardStepsSucceeded(repository: MemorySagaRepository): void {
  const at = new Date(Date.parse(repository.aggregate.version) + 1).toISOString()
  repository.aggregate = withProposalVersion({
    ...repository.aggregate,
    steps: repository.aggregate.steps.map((candidate) => ({
      ...candidate,
      state: 'succeeded' as const,
      receipt: { code: `${candidate.definitionId}-complete`, details: {} },
      startedAt: at,
      finishedAt: at,
      updatedAt: at,
    })),
  }, at)
}

describe('FUMA-023 durable transfer fault injection', () => {
  it('closes execute/resume/compensate payloads against every authority substitution', () => {
    for (const schema of [
      TransferExecuteJobPayloadSchema,
      TransferResumeJobPayloadSchema,
      TransferCompensateJobPayloadSchema,
    ]) {
      expect(Value.Check(schema, { transferId: 'transfer-01' })).toBe(true)
      for (const substitution of [
        { organizationId: 'organization-attacker' },
        { workspaceId: 'workspace-attacker' },
        { siteId: 'site-attacker' },
        { platformId: 'platform-attacker' },
        { fence: 999 },
        { actor: { kind: 'staff', userId: 'attacker' } },
        { permissions: ['site.settings.write'] },
        { requestId: 'request-attacker' },
        { platformInternalGrantId: 'grant-private' },
        { billingAuthorityId: 'billing-private' },
        { paidTransferPendingId: 'pending-private' },
      ]) {
        expect(Value.Check(schema, { transferId: 'transfer-01', ...substitution })).toBe(false)
      }
    }
  })

  it('rolls back faults before and after the pending-to-running transition', async () => {
    for (const fault of ['record-step-before', 'record-step-after'] as const) {
      const h = harness()
      h.repository.fault = fault
      await expect(h.run(TRANSFER_EXECUTE_JOB_KIND)).rejects.toThrow(`fault:${fault}`)
      expect(stepState(h.repository, 40)).toBe('pending')
      expect(h.world.baseEffects).toBe(0)
      h.world.assertVisible()

      await expect(h.run(TRANSFER_EXECUTE_JOB_KIND)).resolves.toMatchObject({
        result: { transition: 'step-started' },
      })
      expect(stepState(h.repository, 40)).toBe('running')
      expect(h.world.baseEffects).toBe(0)
    }
  })

  it('survives death before and after the base effect, then resumes without duplicate visibility', async () => {
    for (const fault of ['before', 'after'] as const) {
      const h = harness()
      await h.run(TRANSFER_EXECUTE_JOB_KIND)
      h.world.applyFault = fault
      await expect(h.run(TRANSFER_EXECUTE_JOB_KIND)).rejects.toBeInstanceOf(TransferInterruptionError)
      expect(stepState(h.repository, 40)).toBe('running')
      expect(h.world.baseEffects).toBe(fault === 'before' ? 0 : 1)
      h.world.assertVisible()

      h.repository.requestResume()
      await expect(h.run(TRANSFER_RESUME_JOB_KIND)).resolves.toMatchObject({
        result: {
          transition: fault === 'after'
            ? 'interrupted-effect-verified'
            : 'interrupted-attempt-failed',
        },
      })
      if (fault === 'before') {
        await h.run(TRANSFER_EXECUTE_JOB_KIND)
        await h.run(TRANSFER_EXECUTE_JOB_KIND)
        await h.run(TRANSFER_EXECUTE_JOB_KIND)
      }
      expect(stepState(h.repository, 40)).toBe('succeeded')
      expect(h.world.baseEffects).toBe(1)
      h.world.assertVisible()
    }
  })

  it('replays a base effect after receipt persistence faults with exactly one external mutation', async () => {
    const h = harness()
    await h.run(TRANSFER_EXECUTE_JOB_KIND)
    h.repository.fault = 'record-step-after'
    await expect(h.run(TRANSFER_EXECUTE_JOB_KIND)).rejects.toThrow('fault:record-step-after')
    expect(stepState(h.repository, 40)).toBe('running')
    expect(h.world.baseEffects).toBe(1)
    h.world.assertVisible()

    await expect(h.run(TRANSFER_EXECUTE_JOB_KIND)).resolves.toMatchObject({
      result: { transition: 'step-effect-recorded' },
    })
    expect(stepState(h.repository, 40)).toBe('succeeded')
    expect(h.world.baseEffects).toBe(1)
    h.world.assertVisible()
  })

  it('treats persisted cancellation as terminal before ownership release', async () => {
    const h = harness()
    h.repository.cancel()
    await expect(h.run(TRANSFER_EXECUTE_JOB_KIND)).resolves.toMatchObject({
      result: { status: 'terminal', transition: 'terminal-replay' },
    })
    expect(h.world.baseEffects).toBe(0)
    expect(stepState(h.repository, 40)).toBe('pending')
    h.world.assertVisible()
  })

  it('rejects trusted-scope substitution and stale step fences before effects', async () => {
    const h = harness()
    await expect(h.executor.runOne(
      TRANSFER_EXECUTE_JOB_KIND,
      { transferId: 'transfer-01' },
      context({ ...SOURCE, organizationId: 'organization-attacker' }),
    )).rejects.toMatchObject({ code: 'not-found' })

    const base = h.repository.aggregate.steps.find(({ sequence }) => sequence === 40)!
    h.repository.aggregate = {
      ...h.repository.aggregate,
      steps: h.repository.aggregate.steps.map((candidate) => (
        candidate.id === base.id ? { ...candidate, fence: 6 } : candidate
      )),
    }
    await expect(h.run(TRANSFER_EXECUTE_JOB_KIND)).rejects.toMatchObject({
      code: 'stale-fence',
    })
    expect(h.world.baseEffects).toBe(0)
    h.world.assertVisible()
  })

  it('rejects a persisted definition ID whose registered order does not match', async () => {
    const h = harness()
    await h.run(TRANSFER_EXECUTE_JOB_KIND)
    const base = h.repository.aggregate.steps.find(({ sequence }) => sequence === 40)!
    h.repository.aggregate = {
      ...h.repository.aggregate,
      steps: h.repository.aggregate.steps.map((candidate) => (
        candidate.id === base.id
          ? { ...candidate, definitionId: 'transfer.fake-downstream' }
          : candidate
      )),
    }

    await expect(h.run(TRANSFER_EXECUTE_JOB_KIND)).rejects.toMatchObject({
      code: 'invalid-step',
      path: 'step.sequence',
    })
    expect(h.world.baseEffects).toBe(0)
    h.world.assertVisible()
  })

  it('compensates a failed downstream step in strict reverse order and releases only at the end', async () => {
    const h = harness()
    await h.run(TRANSFER_EXECUTE_JOB_KIND)
    await h.run(TRANSFER_EXECUTE_JOB_KIND)
    await h.run(TRANSFER_EXECUTE_JOB_KIND)
    h.world.downstreamFailure = true
    await expect(h.run(TRANSFER_EXECUTE_JOB_KIND)).resolves.toMatchObject({
      result: {
        transition: 'step-failed',
        nextJobKind: TRANSFER_COMPENSATE_JOB_KIND,
      },
    })
    expect(h.repository.aggregate.proposal.state).toBe('compensating')
    expect(h.repository.aggregate.lock?.state).toBe('active')
    expect(h.world.owner).toBe('destination')
    h.world.assertVisible()

    await h.run(TRANSFER_COMPENSATE_JOB_KIND)
    expect(h.world.compensationOrder).toEqual(['downstream'])
    expect(h.repository.aggregate.lock?.state).toBe('active')
    await h.run(TRANSFER_COMPENSATE_JOB_KIND)
    expect(h.world.compensationOrder).toEqual(['downstream', 'base'])
    expect(h.world.owner).toBe('source')
    h.world.assertVisible()
    await h.run(TRANSFER_COMPENSATE_JOB_KIND)

    expect(h.repository.aggregate.proposal.state).toBe('failed')
    expect(h.repository.aggregate.proposal.compensationCompletedAt).not.toBeNull()
    expect(h.repository.aggregate.lock).toMatchObject({
      state: 'released',
      releaseReasonCode: 'transfer-failed',
    })
  })

  it('rolls compensation persistence faults back and safely replays the reverse effect', async () => {
    for (const fault of ['record-compensation-before', 'record-compensation-after'] as const) {
      const h = harness()
      await h.run(TRANSFER_EXECUTE_JOB_KIND)
      await h.run(TRANSFER_EXECUTE_JOB_KIND)
      await h.run(TRANSFER_EXECUTE_JOB_KIND)
      h.world.downstreamFailure = true
      await h.run(TRANSFER_EXECUTE_JOB_KIND)
      h.repository.fault = fault
      await expect(h.run(TRANSFER_COMPENSATE_JOB_KIND)).rejects.toThrow(`fault:${fault}`)
      expect(h.repository.aggregate.steps.filter(({ kind }) => kind === 'compensation')).toEqual([])
      expect(h.world.compensationOrder).toEqual(['downstream'])
      h.world.assertVisible()

      await h.run(TRANSFER_COMPENSATE_JOB_KIND)
      expect(h.world.compensationOrder).toEqual(['downstream', 'downstream'])
      expect(h.repository.aggregate.steps.filter(({ kind, definitionId }) => (
        kind === 'compensation' && definitionId === 'transfer.fake-downstream'
      ))).toHaveLength(1)
      h.world.assertVisible()
    }
  })
})

describe('FUMA-023 concurrent transition exactness', () => {
  it('reports unchanged when another invocation wins step start, receipt, retry, completion, compensation receipt, or final release', async () => {
    const start = harness()
    raceTransaction(start.repository, (aggregate, at) => withProposalVersion({
      ...aggregate,
      steps: aggregate.steps.map((candidate) => candidate.sequence === 40
        ? { ...candidate, state: 'running', startedAt: at, updatedAt: at }
        : candidate),
    }, at))
    await expect(start.run(TRANSFER_EXECUTE_JOB_KIND)).resolves.toMatchObject({
      result: { status: 'unchanged', transition: 'step-started' },
    })

    const receipt = harness()
    await receipt.run(TRANSFER_EXECUTE_JOB_KIND)
    raceTransaction(receipt.repository, (aggregate, at) => withProposalVersion({
      ...aggregate,
      steps: aggregate.steps.map((candidate) => candidate.sequence === 40
        ? {
            ...candidate,
            state: 'succeeded',
            receipt: {
              code: 'base-owned',
              details: { transferId: 'transfer-01', lockId: 'lock-transfer-01', fence: 7 },
            },
            finishedAt: at,
            updatedAt: at,
          }
        : candidate),
    }, at))
    await expect(receipt.run(TRANSFER_EXECUTE_JOB_KIND)).resolves.toMatchObject({
      result: { status: 'unchanged', transition: 'step-effect-recorded' },
    })

    const retry = harness()
    await retry.run(TRANSFER_EXECUTE_JOB_KIND)
    retry.world.applyFault = 'before'
    await expect(retry.run(TRANSFER_EXECUTE_JOB_KIND)).rejects.toBeInstanceOf(TransferInterruptionError)
    retry.repository.requestResume()
    await retry.run(TRANSFER_RESUME_JOB_KIND)
    raceTransaction(retry.repository, (aggregate, at) => {
      const failed = aggregate.steps.find((candidate) => (
        candidate.kind === 'forward' && candidate.sequence === 40 && candidate.state === 'failed'
      ))!
      return withProposalVersion({
        ...aggregate,
        steps: [...aggregate.steps, {
          ...failed,
          id: 'transfer-01:step:transfer.base-ownership:attempt:2',
          attempt: 2,
          state: 'pending',
          receipt: null,
          error: null,
          createdAt: at,
          updatedAt: at,
          startedAt: null,
          finishedAt: null,
        }],
      }, at)
    })
    await expect(retry.run(TRANSFER_EXECUTE_JOB_KIND)).resolves.toMatchObject({
      result: { status: 'unchanged', transition: 'step-retry-created' },
    })

    const completion = harness()
    markForwardStepsSucceeded(completion.repository)
    raceTransaction(completion.repository, (aggregate, at) => ({
      ...withProposalVersion(aggregate, at, { state: 'completed', completedAt: at }),
      lock: aggregate.lock && {
        ...aggregate.lock,
        state: 'released',
        heartbeatAt: at,
        releasedAt: at,
        releaseReasonCode: 'completed',
      },
    }))
    await expect(completion.run(TRANSFER_EXECUTE_JOB_KIND)).resolves.toMatchObject({
      result: { status: 'unchanged', transition: 'transfer-completed' },
    })

    const compensation = harness()
    await prepareCompensating(compensation)
    raceTransaction(compensation.repository, (aggregate, at) => {
      const original = aggregate.steps.find((candidate) => (
        candidate.kind === 'forward' && candidate.sequence === 50
      ))!
      return withProposalVersion({
        ...aggregate,
        steps: [...aggregate.steps, {
          id: 'transfer-01:compensate:transfer.fake-downstream:attempt:1',
          transferId: original.transferId,
          lockId: original.lockId,
          fence: original.fence,
          definitionId: original.definitionId,
          sequence: original.sequence,
          attempt: 1,
          kind: 'compensation',
          state: 'succeeded',
          receipt: {
            code: 'transfer-step-compensated',
            details: { originalStepId: original.id, handlerReceipt: null },
          },
          error: null,
          createdAt: at,
          updatedAt: at,
          startedAt: at,
          finishedAt: at,
        }],
      }, at)
    })
    await expect(compensation.run(TRANSFER_COMPENSATE_JOB_KIND)).resolves.toMatchObject({
      result: { status: 'unchanged', transition: 'step-compensated' },
    })

    const finalRelease = harness()
    await prepareCompensating(finalRelease)
    await finalRelease.run(TRANSFER_COMPENSATE_JOB_KIND)
    await finalRelease.run(TRANSFER_COMPENSATE_JOB_KIND)
    raceTransaction(finalRelease.repository, (aggregate, at) => ({
      ...withProposalVersion(aggregate, at, {
        state: 'failed',
        compensationCompletedAt: at,
      }),
      lock: aggregate.lock && {
        ...aggregate.lock,
        state: 'released',
        heartbeatAt: at,
        releasedAt: at,
        releaseReasonCode: 'transfer-failed',
      },
    }))
    await expect(finalRelease.run(TRANSFER_COMPENSATE_JOB_KIND)).resolves.toMatchObject({
      result: { status: 'unchanged', transition: 'compensation-completed' },
    })
  })

  it('rolls back missing completion and final-failure transitions around every persistence boundary', async () => {
    for (const fault of [
      'record-completion-before',
      'record-completion-after',
      'release-lock-before',
      'release-lock-after',
    ] as const) {
      const h = harness()
      markForwardStepsSucceeded(h.repository)
      h.repository.fault = fault
      await expect(h.run(TRANSFER_EXECUTE_JOB_KIND)).rejects.toThrow(`fault:${fault}`)
      expect(h.repository.aggregate.proposal.state).toBe('running')
      expect(h.repository.aggregate.lock?.state).toBe('active')
    }

    for (const fault of [
      'record-failure-before',
      'record-failure-after',
      'release-lock-before',
      'release-lock-after',
    ] as const) {
      const h = harness()
      await prepareCompensating(h)
      await h.run(TRANSFER_COMPENSATE_JOB_KIND)
      await h.run(TRANSFER_COMPENSATE_JOB_KIND)
      h.repository.fault = fault
      await expect(h.run(TRANSFER_COMPENSATE_JOB_KIND)).rejects.toThrow(`fault:${fault}`)
      expect(h.repository.aggregate.proposal.state).toBe('compensating')
      expect(h.repository.aggregate.proposal.compensationCompletedAt).toBeNull()
      expect(h.repository.aggregate.lock?.state).toBe('active')
    }
  })

  it('persists no receipt on compensation failure and records skipped and completed outcomes exactly once', async () => {
    const failed = harness()
    await prepareCompensating(failed)
    failed.world.downstreamCompensation = 'failure'
    await expect(failed.run(TRANSFER_COMPENSATE_JOB_KIND)).rejects.toThrow('registered compensation failed')
    expect(failed.repository.aggregate.steps.filter(({ kind }) => kind === 'compensation')).toEqual([])

    const skipped = harness()
    await prepareCompensating(skipped)
    skipped.world.downstreamCompensation = 'not-applied'
    await expect(skipped.run(TRANSFER_COMPENSATE_JOB_KIND)).resolves.toMatchObject({
      result: { status: 'advanced', transition: 'step-compensation-skipped' },
    })
    expect(skipped.repository.aggregate.steps.filter(({ kind }) => kind === 'compensation')).toEqual([
      expect.objectContaining({ state: 'skipped', definitionId: 'transfer.fake-downstream' }),
    ])

    const completed = harness()
    await prepareCompensating(completed)
    await expect(completed.run(TRANSFER_COMPENSATE_JOB_KIND)).resolves.toMatchObject({
      result: { status: 'advanced', transition: 'step-compensated' },
    })
    expect(completed.repository.aggregate.steps.filter(({ kind }) => kind === 'compensation')).toEqual([
      expect.objectContaining({ state: 'succeeded', definitionId: 'transfer.fake-downstream' }),
    ])
  })
})

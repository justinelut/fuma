import { describe, expect, it } from 'bun:test'
import { FumaRegistry } from '@core/fuma'
import type {
  FumaJobContext,
  FumaJobContextAuthority,
} from '../../../server/fuma/context'
import type {
  EnqueueFumaJob,
  FumaJobHandlerContext,
  FumaJobJsonValue,
  FumaJobRecord,
} from '../../../server/fuma/jobs'
import {
  TRANSFER_COMPENSATE_JOB_KIND,
  TRANSFER_EXECUTE_JOB_KIND,
  TRANSFER_RESUME_JOB_KIND,
  TransferSagaExecutor,
  createTransferSagaJobHandlers,
} from '../../../server/fuma/transfers/jobs'
import {
  TransferInterruptionError,
  createTransferStepRegistry,
  type TransferAggregate,
  type TransferLockRequest,
  type TransferManifest,
  type TransferOwnershipCoordinate,
  type TransferProposal,
  type TransferRepository,
  type TransferRepositoryKey,
  type TransferRepositoryTransaction,
  type TransferStep,
  type TransferStepDefinition,
} from '../../../server/fuma/transfers'

const SOURCE: TransferOwnershipCoordinate = {
  platformId: 'platform-fuma',
  organizationId: 'organization-source',
  workspaceId: 'workspace-source',
  siteId: 'site-demo',
}
const DESTINATION: TransferOwnershipCoordinate = {
  platformId: 'platform-fuma',
  organizationId: 'organization-destination',
  workspaceId: 'workspace-destination',
  siteId: 'site-demo',
}
const START = Date.parse('2026-07-25T06:30:00.000Z')

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested)
    Object.freeze(value)
  }
  return value
}

function jobContext(): Extract<FumaJobContext, { kind: 'site' }> {
  return freeze({
    kind: 'site',
    originatingRequestId: 'request-demo-start',
    requestId: 'job-demo:request:7',
    source: {
      kind: 'internal-job',
      correlationId: 'job-demo:request:7',
      jobId: 'job-demo',
      runId: 'job-demo:run:7',
    },
    actor: { kind: 'internal-job', jobId: 'job-demo', runId: 'job-demo:run:7' },
    scope: {
      platform: { id: SOURCE.platformId, status: 'active' },
      organization: {
        id: SOURCE.organizationId,
        platformId: SOURCE.platformId,
        status: 'active',
      },
      workspace: {
        id: SOURCE.workspaceId,
        platformId: SOURCE.platformId,
        organizationId: SOURCE.organizationId,
        status: 'active',
      },
      site: {
        id: SOURCE.siteId,
        platformId: SOURCE.platformId,
        organizationId: SOURCE.organizationId,
        workspaceId: SOURCE.workspaceId,
        profileId: 'website',
        status: 'active',
      },
    },
    profile: { id: 'website', status: 'active' },
    capabilities: ['site.settings'],
    permissions: {
      subjectId: 'job-demo',
      allow: ['site.settings.write'],
      deny: [],
    },
    requiredPermission: 'site.settings.write',
  })
}

function manifest(): TransferManifest {
  return {
    schemaVersion: 1,
    transferId: 'transfer-demo',
    source: SOURCE,
    destination: DESTINATION,
    siteProfileId: 'website',
    siteCapabilityOverrides: { grant: [], revoke: [] },
    siteCapabilityIds: ['site.settings'],
    snapshotChecksum: 'd'.repeat(64),
    resources: ['site-record', 'content', 'media'],
    collaborators: [{
      userId: 'user-demo-editor',
      sourceRole: 'editor',
      intent: 'preserve',
      destinationRole: 'editor',
    }],
    capturedAt: new Date(START).toISOString(),
  }
}

function testRegistry(): FumaRegistry {
  return new FumaRegistry({
    capabilities: [{
      id: 'site.settings',
      permissions: [{
        id: 'site.settings.write',
        label: 'Edit site settings',
        description: 'Edit site settings and run site transfers.',
      }],
      transfer: [
        {
          id: 'transfer.demo-downstream',
          stepId: 'transfer.demo-downstream',
          permission: 'site.settings.write',
        },
        {
          id: 'transfer.demo-final',
          stepId: 'transfer.demo-final',
          permission: 'site.settings.write',
        },
      ],
      jobs: [
        {
          id: TRANSFER_EXECUTE_JOB_KIND,
          handlerId: TRANSFER_EXECUTE_JOB_KIND,
          permission: 'site.settings.write',
        },
        {
          id: TRANSFER_RESUME_JOB_KIND,
          handlerId: TRANSFER_RESUME_JOB_KIND,
          permission: 'site.settings.write',
        },
        {
          id: TRANSFER_COMPENSATE_JOB_KIND,
          handlerId: TRANSFER_COMPENSATE_JOB_KIND,
          permission: 'site.settings.write',
        },
      ],
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

class DemoWorld {
  owner: 'source' | 'destination' = 'source'
  downstreamApplied = false
  downstreamDiesOnce = true
  compensationOrder: string[] = []
}

function registeredSteps(world: DemoWorld): readonly TransferStepDefinition[] {
  const base: TransferStepDefinition = {
    id: 'transfer.base-ownership',
    order: 40,
    dependsOn: [],
    mandatory: true,
    async apply() {
      world.owner = 'destination'
      return { code: 'demo-base-owned', details: { owner: world.owner } }
    },
    async verify() {
      return world.owner === 'destination'
        ? { status: 'verified', receipt: { code: 'demo-base-owned', details: { owner: world.owner } } }
        : { status: 'not-applied', receipt: null }
    },
    async compensate() {
      world.compensationOrder.push('base')
      world.owner = 'source'
      return { status: 'compensated', receipt: { code: 'demo-base-restored', details: {} } }
    },
  }
  const downstream: TransferStepDefinition = {
    id: 'transfer.demo-downstream',
    order: 50,
    dependsOn: [base.id],
    async apply() {
      world.downstreamApplied = true
      if (world.downstreamDiesOnce) {
        world.downstreamDiesOnce = false
        throw new TransferInterruptionError('demo downstream died after effect')
      }
      return { code: 'demo-downstream-applied', details: {} }
    },
    async verify() {
      return world.downstreamApplied
        ? { status: 'verified', receipt: { code: 'demo-downstream-applied', details: {} } }
        : { status: 'not-applied', receipt: null }
    },
    async compensate() {
      world.compensationOrder.push('downstream')
      world.downstreamApplied = false
      return { status: 'compensated', receipt: { code: 'demo-downstream-restored', details: {} } }
    },
  }
  const final: TransferStepDefinition = {
    id: 'transfer.demo-final',
    order: 60,
    dependsOn: [downstream.id],
    async apply() {
      throw new Error('demo finalization failure')
    },
    async verify() {
      return { status: 'not-applied', receipt: null }
    },
    async compensate() {
      world.compensationOrder.push('final')
      return { status: 'not-applied', receipt: null }
    },
  }
  return [base, downstream, final]
}

function pending(
  definition: TransferStepDefinition,
  kind: TransferStep['kind'],
): TransferStep {
  const at = new Date(START).toISOString()
  return {
    id: `transfer-demo:step:${definition.id}:attempt:1`,
    transferId: 'transfer-demo',
    lockId: 'lock-transfer-demo',
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

class DemoRepository implements TransferRepository, TransferRepositoryTransaction {
  aggregate: TransferAggregate

  constructor(steps: readonly TransferStep[]) {
    const at = new Date(START).toISOString()
    const proposal: TransferProposal = {
      id: 'transfer-demo',
      source: SOURCE,
      destination: DESTINATION,
      manifest: manifest(),
      state: 'running',
      proposedByUserId: 'source-owner',
      proposedBySessionId: 'session-source',
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
    this.aggregate = {
      proposal,
      confirmations: {
        status: 'confirmed',
        source: {
          transferId: 'transfer-demo',
          side: 'source',
          scope: SOURCE,
          confirmedByUserId: 'source-owner',
          confirmedBySessionId: 'session-source',
          requestId: 'request-source-confirm',
          confirmedAt: at,
        },
        destination: {
          transferId: 'transfer-demo',
          side: 'destination',
          scope: DESTINATION,
          confirmedByUserId: 'destination-owner',
          confirmedBySessionId: 'session-destination',
          requestId: 'request-destination-confirm',
          confirmedAt: at,
        },
      },
      lock: {
        id: 'lock-transfer-demo',
        transferId: 'transfer-demo',
        scope: SOURCE,
        fence: 7,
        state: 'active',
        acquiredByJobId: 'job-demo-start',
        acquiredByRunId: 'job-demo-start:run:1',
        requestId: 'request-demo-start',
        acquiredAt: at,
        heartbeatAt: at,
        releasedAt: null,
        releaseReasonCode: null,
      },
      steps: structuredClone(steps),
      version: at,
    }
  }

  read(key: TransferRepositoryKey): Promise<TransferAggregate | null> {
    return Promise.resolve(key.transferId === 'transfer-demo'
      && JSON.stringify(key.source) === JSON.stringify(SOURCE)
      ? structuredClone(this.aggregate)
      : null)
  }

  transaction<T>(
    _key: TransferRepositoryKey,
    work: (transaction: TransferRepositoryTransaction) => Promise<T>,
  ): Promise<T> {
    return work(this)
  }

  insertProposal(): Promise<void> { throw new Error('not used') }
  recordConfirmation(): Promise<void> { throw new Error('not used') }
  acquireLock(
    _key: TransferRepositoryKey,
    _proposal: TransferProposal,
    _request: TransferLockRequest,
  ) { throw new Error('not used') }
  recordStart(): Promise<void> { throw new Error('not used') }
  recordCancellation(): Promise<void> { throw new Error('not used') }
  recordResume(): Promise<void> { throw new Error('not used') }

  recordStep(
    _key: TransferRepositoryKey,
    expectedVersion: string,
    proposal: TransferProposal,
    step: TransferStep,
  ): Promise<void> {
    this.#version(expectedVersion)
    const steps = [...this.aggregate.steps]
    const index = steps.findIndex(({ id }) => id === step.id)
    if (index === -1) steps.push(structuredClone(step))
    else steps[index] = structuredClone(step)
    this.aggregate = {
      ...this.aggregate,
      proposal: structuredClone(proposal),
      steps,
      version: proposal.updatedAt,
    }
    return Promise.resolve()
  }

  recordFailure(
    key: TransferRepositoryKey,
    expectedVersion: string,
    proposal: TransferProposal,
    step?: TransferStep,
  ): Promise<void> {
    if (step) return this.recordStep(key, expectedVersion, proposal, step)
    return this.#proposal(expectedVersion, proposal)
  }

  recordCompensation(
    key: TransferRepositoryKey,
    expectedVersion: string,
    proposal: TransferProposal,
    step: TransferStep,
  ): Promise<void> {
    return this.recordStep(key, expectedVersion, proposal, step)
  }

  recordCompletion(
    _key: TransferRepositoryKey,
    expectedVersion: string,
    proposal: TransferProposal,
  ): Promise<void> {
    return this.#proposal(expectedVersion, proposal)
  }

  releaseLock(
    _key: TransferRepositoryKey,
    proposal: TransferProposal,
    lockId: string,
    fence: number,
    releasedAt: string,
    reasonCode: string,
  ) {
    if (proposal.id !== this.aggregate.proposal.id
      || !this.aggregate.lock
      || this.aggregate.lock.state !== 'active'
      || this.aggregate.lock.id !== lockId
      || this.aggregate.lock.fence !== fence) throw new Error('stale demo fence')
    const lock = {
      ...this.aggregate.lock,
      state: 'released' as const,
      heartbeatAt: releasedAt,
      releasedAt,
      releaseReasonCode: reasonCode,
    }
    this.aggregate = { ...this.aggregate, lock }
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
        resumeRequestId: 'request-demo-resume',
        resumeReasonCode: 'worker-restarted',
        resumeCount: 1,
        updatedAt: at,
      },
      version: at,
    }
  }

  #proposal(expectedVersion: string, proposal: TransferProposal): Promise<void> {
    this.#version(expectedVersion)
    this.aggregate = {
      ...this.aggregate,
      proposal: structuredClone(proposal),
      version: proposal.updatedAt,
    }
    return Promise.resolve()
  }

  #version(expectedVersion: string): void {
    if (this.aggregate.version !== expectedVersion) throw new Error('stale demo version')
  }
}

function latest(repository: DemoRepository, sequence: number): TransferStep {
  return repository.aggregate.steps
    .filter((step) => step.kind === 'forward' && step.sequence === sequence)
    .toSorted((left, right) => right.attempt - left.attempt)[0]!
}

function durableJob(kind: FumaJobRecord['kind']): FumaJobRecord {
  const at = new Date(START).toISOString()
  return {
    id: 'job-demo',
    organizationId: SOURCE.organizationId,
    siteId: SOURCE.siteId,
    kind,
    payload: { transferId: 'transfer-demo' },
    status: 'running',
    priority: 0,
    organizationWeight: 1,
    siteWeight: 1,
    maxAttempts: 100,
    attemptCount: 1,
    runAt: at,
    claimedBy: 'worker-demo',
    claimExpiresAt: new Date(START + 60_000).toISOString(),
    fence: '7',
    cancellationRequestedAt: null,
    idempotencyKey: null,
    result: null,
    error: null,
    createdAt: at,
    updatedAt: at,
    completedAt: null,
  }
}

function handlerAuthority(): FumaJobContextAuthority {
  const binding = {
    platformId: SOURCE.platformId,
    organizationId: SOURCE.organizationId,
    workspaceId: SOURCE.workspaceId,
    siteId: SOURCE.siteId,
  }
  return {
    async loadTrustedJobAuthority() {
      return {
        kind: 'site',
        originatingRequestId: 'request-demo-start',
        authorization: {
          platformOrganizationId: 'organization-platform',
          platform: { id: SOURCE.platformId, status: 'active' },
          organization: {
            id: SOURCE.organizationId,
            platformId: SOURCE.platformId,
            kind: 'customer',
            status: 'active',
          },
          workspace: {
            id: SOURCE.workspaceId,
            platformId: SOURCE.platformId,
            organizationId: SOURCE.organizationId,
            status: 'active',
          },
          site: {
            id: SOURCE.siteId,
            platformId: SOURCE.platformId,
            organizationId: SOURCE.organizationId,
            workspaceId: SOURCE.workspaceId,
            profileId: 'website',
            status: 'active',
          },
          profile: { ...binding, id: 'website', status: 'active' },
          capabilities: {
            ...binding,
            profileId: 'website',
            overrides: { grant: [], revoke: [] },
          },
          permissions: {
            subjectId: 'job-demo',
            scope: { kind: 'site', ...binding },
            protectedOwnerInvariant: null,
            roleAssignments: [{
              id: 'assignment.job-demo.admin',
              subjectId: 'job-demo',
              scope: {
                kind: 'organization',
                platformId: SOURCE.platformId,
                organizationId: SOURCE.organizationId,
              },
              role: { kind: 'launch-persona', persona: 'admin' },
            }],
            permissionOverrides: [],
            customRoles: [],
          },
        },
      }
    },
  }
}

function auditAction(input: unknown): string | null {
  if (!input || typeof input !== 'object' || !('action' in input)) return null
  return typeof input.action === 'string' ? input.action : null
}

type HandlerHarness = Readonly<{
  handlers: ReturnType<typeof createTransferSagaJobHandlers>
  enqueued: EnqueueFumaJob[]
  audits: Array<Readonly<{ context: FumaJobContext; input: unknown }>>
  events: string[]
  failAuditOnce(action: string): void
}>

function handlerHarness(
  repository: DemoRepository,
  definitions: readonly TransferStepDefinition[],
): HandlerHarness {
  const enqueued: EnqueueFumaJob[] = []
  const audits: Array<Readonly<{ context: FumaJobContext; input: unknown }>> = []
  const events: string[] = []
  let failedAction: string | null = null
  let didFail = false
  const registry = testRegistry()
  return {
    handlers: createTransferSagaJobHandlers({
      repository,
      stepRegistry: createTransferStepRegistry(definitions),
      registry,
      authority: handlerAuthority(),
      enqueue: {
        async enqueue(input) {
          events.push('enqueue')
          enqueued.push(structuredClone(input))
        },
      },
      audit: {
        async recordJob(context, input) {
          events.push(`audit:${auditAction(input) ?? 'unknown'}`)
          audits.push({ context, input: structuredClone(input) })
          if (!didFail && auditAction(input) === failedAction) {
            didFail = true
            throw new Error(`audit failed:${failedAction}`)
          }
        },
      },
      now: () => new Date(Date.parse(repository.aggregate.version) + 1),
    }),
    enqueued,
    audits,
    events,
    failAuditOnce(action) {
      failedAction = action
    },
  }
}

function durableHandlerContext(
  kind: FumaJobRecord['kind'],
  commit: FumaJobHandlerContext['commitDurableResult'],
  cancellationRequested = false,
  read: FumaJobHandlerContext['readDurableResult'] = async () => null,
): FumaJobHandlerContext {
  return {
    job: durableJob(kind),
    attemptNumber: 1,
    fence: '7',
    cancellationRequested: () => Promise.resolve(cancellationRequested),
    readDurableResult: read,
    commitDurableResult: commit,
  }
}

describe('FUMA-023 transfer saga demo', () => {
  it('inspects a downstream death, resumes from receipts, then compensates to source ownership', async () => {
    const world = new DemoWorld()
    const definitions = registeredSteps(world)
    const repository = new DemoRepository([
      pending(definitions[0]!, 'forward'),
      pending(definitions[1]!, 'forward'),
      pending(definitions[2]!, 'forward'),
    ])
    let tick = 1
    const executor = new TransferSagaExecutor({
      repository,
      stepRegistry: createTransferStepRegistry(definitions),
      registry: testRegistry(),
      now: () => new Date(START + tick++),
    })
    const run = (kind: typeof TRANSFER_EXECUTE_JOB_KIND
      | typeof TRANSFER_RESUME_JOB_KIND
      | typeof TRANSFER_COMPENSATE_JOB_KIND) => executor.runOne(
      kind,
      { transferId: 'transfer-demo' },
      jobContext(),
    )

    await run(TRANSFER_EXECUTE_JOB_KIND)
    await run(TRANSFER_EXECUTE_JOB_KIND)
    await run(TRANSFER_EXECUTE_JOB_KIND)
    await expect(run(TRANSFER_EXECUTE_JOB_KIND)).rejects.toBeInstanceOf(TransferInterruptionError)

    const interruptedSnapshot = structuredClone(repository.aggregate)
    expect(interruptedSnapshot.proposal.manifest).toEqual(manifest())
    expect(latest(repository, 40)).toMatchObject({
      state: 'succeeded',
      receipt: { code: 'demo-base-owned' },
    })
    expect(latest(repository, 50)).toMatchObject({ state: 'running', receipt: null })
    expect(interruptedSnapshot.lock).toMatchObject({
      id: 'lock-transfer-demo',
      fence: 7,
      state: 'active',
    })
    expect(world).toMatchObject({ owner: 'destination', downstreamApplied: true })

    repository.requestResume()
    await expect(run(TRANSFER_RESUME_JOB_KIND)).resolves.toMatchObject({
      result: { transition: 'interrupted-effect-verified' },
    })
    expect(latest(repository, 50)).toMatchObject({
      state: 'succeeded',
      receipt: { code: 'demo-downstream-applied' },
    })

    await run(TRANSFER_EXECUTE_JOB_KIND)
    await expect(run(TRANSFER_EXECUTE_JOB_KIND)).resolves.toMatchObject({
      result: {
        transition: 'step-failed',
        nextJobKind: TRANSFER_COMPENSATE_JOB_KIND,
      },
    })
    expect(repository.aggregate.proposal.state).toBe('compensating')
    expect(world.owner).toBe('destination')

    await run(TRANSFER_COMPENSATE_JOB_KIND)
    await run(TRANSFER_COMPENSATE_JOB_KIND)
    await run(TRANSFER_COMPENSATE_JOB_KIND)
    expect(world.compensationOrder).toEqual(['final', 'downstream', 'base'])
    expect(world).toMatchObject({ owner: 'source', downstreamApplied: false })
    expect(repository.aggregate.lock?.state).toBe('active')

    await run(TRANSFER_COMPENSATE_JOB_KIND)
    expect(repository.aggregate.proposal).toMatchObject({
      state: 'failed',
      compensationCompletedAt: expect.any(String),
    })
    expect(repository.aggregate.lock).toMatchObject({
      state: 'released',
      releaseReasonCode: 'transfer-failed',
    })
    expect(repository.aggregate.proposal.manifest).toEqual(interruptedSnapshot.proposal.manifest)
  })
})

describe('FUMA-023 transfer saga handlers', () => {
  it('commits the durable result before authority-free continuation enqueue and correlated transfer/job facts', async () => {
    const world = new DemoWorld()
    const definitions = registeredSteps(world)
    const repository = new DemoRepository(definitions.map((definition) => pending(definition, 'forward')))
    const executor = new TransferSagaExecutor({
      repository,
      stepRegistry: createTransferStepRegistry(definitions),
      registry: testRegistry(),
      now: () => new Date(Date.parse(repository.aggregate.version) + 1),
    })
    await executor.runOne(
      TRANSFER_EXECUTE_JOB_KIND,
      { transferId: 'transfer-demo' },
      jobContext(),
    )

    const h = handlerHarness(repository, definitions)
    const commits: Array<Readonly<{ effectKey: string; result: FumaJobJsonValue }>> = []
    const result = await h.handlers[TRANSFER_EXECUTE_JOB_KIND](durableHandlerContext(
      TRANSFER_EXECUTE_JOB_KIND,
      async (effectKey, value) => {
        h.events.push('commit')
        commits.push({ effectKey, result: structuredClone(value) })
        return { result: value, created: true }
      },
    ))

    expect(result).toMatchObject({
      status: 'advanced',
      transition: 'step-effect-recorded',
      stepId: 'transfer-demo:step:transfer.base-ownership:attempt:1',
    })
    expect(commits).toHaveLength(1)
    expect(h.enqueued).toHaveLength(1)
    expect(h.enqueued[0]).toMatchObject({
      organizationId: SOURCE.organizationId,
      siteId: SOURCE.siteId,
      kind: TRANSFER_EXECUTE_JOB_KIND,
      payload: { transferId: 'transfer-demo' },
    })
    expect(h.enqueued[0]!.payload).toEqual({ transferId: 'transfer-demo' })
    expect(h.audits.map(({ input }) => auditAction(input))).toEqual([
      'job.started',
      'transfer.step.completed',
      'job.succeeded',
    ])
    expect(h.events).toEqual([
      'audit:job.started',
      'commit',
      'enqueue',
      'audit:transfer.step.completed',
      'audit:job.succeeded',
    ])
    for (const { context } of h.audits) {
      expect(context).toMatchObject({
        requestId: 'job-demo:request:7',
        originatingRequestId: 'request-demo-start',
        source: {
          kind: 'internal-job',
          correlationId: 'job-demo:request:7',
          jobId: 'job-demo',
          runId: 'job-demo:run:7',
        },
      })
    }
  })

  it('replays a committed transition after audit failure without changing its continuation or facts', async () => {
    const world = new DemoWorld()
    const definitions = registeredSteps(world)
    const repository = new DemoRepository(definitions.map((definition) => pending(definition, 'forward')))
    const executor = new TransferSagaExecutor({
      repository,
      stepRegistry: createTransferStepRegistry(definitions),
      registry: testRegistry(),
      now: () => new Date(Date.parse(repository.aggregate.version) + 1),
    })
    await executor.runOne(
      TRANSFER_EXECUTE_JOB_KIND,
      { transferId: 'transfer-demo' },
      jobContext(),
    )

    const h = handlerHarness(repository, definitions)
    h.failAuditOnce('transfer.step.completed')
    const durableResults = new Map<string, FumaJobJsonValue>()
    const created: boolean[] = []
    const commit: FumaJobHandlerContext['commitDurableResult'] = async (effectKey, value) => {
      const prior = durableResults.get(effectKey)
      if (prior !== undefined) {
        created.push(false)
        return { result: structuredClone(prior), created: false }
      }
      durableResults.set(effectKey, structuredClone(value))
      created.push(true)
      return { result: structuredClone(value), created: true }
    }
    const read: FumaJobHandlerContext['readDurableResult'] = async (effectKey) => {
      const prior = durableResults.get(effectKey)
      return prior === undefined ? null : { result: structuredClone(prior) }
    }
    const context = () => durableHandlerContext(
      TRANSFER_EXECUTE_JOB_KIND,
      commit,
      false,
      read,
    )

    await expect(h.handlers[TRANSFER_EXECUTE_JOB_KIND](context()))
      .rejects.toThrow('audit failed:transfer.step.completed')
    const afterCommittedClaim = structuredClone(repository.aggregate)
    const durableResult = [...durableResults.values()][0] ?? null
    await expect(h.handlers[TRANSFER_EXECUTE_JOB_KIND](context())).resolves.toEqual(durableResult)

    expect(created).toEqual([true])
    expect(repository.aggregate).toEqual(afterCommittedClaim)
    expect(latest(repository, 50)).toMatchObject({ state: 'pending', receipt: null })
    expect(world).toMatchObject({ owner: 'destination', downstreamApplied: false })
    expect(h.enqueued).toHaveLength(2)
    expect(h.enqueued[1]).toEqual(h.enqueued[0])
    expect(h.audits.map(({ input }) => auditAction(input))).toEqual([
      'job.started',
      'transfer.step.completed',
      'job.failed',
      'job.started',
      'transfer.step.completed',
      'job.succeeded',
    ])
  })

  it('durably replays cancellation after its audit append fails without executing or enqueueing saga work', async () => {
    const world = new DemoWorld()
    const definitions = registeredSteps(world)
    const repository = new DemoRepository(definitions.map((definition) => pending(definition, 'forward')))
    const h = handlerHarness(repository, definitions)
    h.failAuditOnce('job.cancelled')
    const durableResults = new Map<string, FumaJobJsonValue>()
    const created: boolean[] = []
    const commit: FumaJobHandlerContext['commitDurableResult'] = async (effectKey, value) => {
      const prior = durableResults.get(effectKey)
      if (prior !== undefined) {
        created.push(false)
        return { result: structuredClone(prior), created: false }
      }
      durableResults.set(effectKey, structuredClone(value))
      created.push(true)
      return { result: structuredClone(value), created: true }
    }
    const read: FumaJobHandlerContext['readDurableResult'] = async (effectKey) => {
      const prior = durableResults.get(effectKey)
      return prior === undefined ? null : { result: structuredClone(prior) }
    }
    const context = () => durableHandlerContext(
      TRANSFER_EXECUTE_JOB_KIND,
      commit,
      true,
      read,
    )

    await expect(h.handlers[TRANSFER_EXECUTE_JOB_KIND](context()))
      .rejects.toThrow('audit failed:job.cancelled')
    const durableResult = [...durableResults.values()][0] ?? null
    await expect(h.handlers[TRANSFER_EXECUTE_JOB_KIND](context())).resolves.toEqual(durableResult)

    expect(created).toEqual([true])
    expect(repository.aggregate.steps.every(({ state }) => state === 'pending')).toBe(true)
    expect(h.enqueued).toEqual([])
    expect(h.audits.map(({ input }) => auditAction(input))).toEqual([
      'job.started',
      'job.cancelled',
      'job.failed',
      'job.started',
      'job.cancelled',
    ])
  })
})

// Handler facts are exercised against real saga writes, not synthetic audit inputs.
describe('FUMA-023 transfer transition facts', () => {
  it('records transfer.completed, transfer.compensated, and transfer.failed alongside generic job facts', async () => {
    const commit: FumaJobHandlerContext['commitDurableResult'] = async (_effectKey, value) => ({
      result: value,
      created: true,
    })

    const completedWorld = new DemoWorld()
    const completedDefinitions = registeredSteps(completedWorld)
    const completedRepository = new DemoRepository(
      completedDefinitions.map((definition) => pending(definition, 'forward')),
    )
    const completedAt = new Date(START + 1).toISOString()
    completedRepository.aggregate = {
      ...completedRepository.aggregate,
      proposal: {
        ...completedRepository.aggregate.proposal,
        updatedAt: completedAt,
      },
      steps: completedRepository.aggregate.steps.map((candidate) => ({
        ...candidate,
        state: 'succeeded',
        receipt: { code: `${candidate.definitionId}-completed`, details: {} },
        startedAt: completedAt,
        finishedAt: completedAt,
        updatedAt: completedAt,
      })),
      version: completedAt,
    }
    const completed = handlerHarness(completedRepository, completedDefinitions)
    await completed.handlers[TRANSFER_EXECUTE_JOB_KIND](durableHandlerContext(
      TRANSFER_EXECUTE_JOB_KIND,
      commit,
    ))
    expect(completed.audits.map(({ input }) => auditAction(input))).toEqual([
      'job.started',
      'transfer.completed',
      'job.succeeded',
    ])

    const failedWorld = new DemoWorld()
    const failedDefinitions = registeredSteps(failedWorld)
    const failedRepository = new DemoRepository(
      failedDefinitions.map((definition) => pending(definition, 'forward')),
    )
    const failedAt = new Date(START + 1).toISOString()
    failedRepository.aggregate = {
      ...failedRepository.aggregate,
      proposal: {
        ...failedRepository.aggregate.proposal,
        state: 'compensating',
        failure: {
          code: 'demo-finalization-failed',
          message: 'Demo finalization failed.',
          retryable: true,
          details: {},
        },
        compensationStartedAt: failedAt,
        updatedAt: failedAt,
      },
      steps: failedRepository.aggregate.steps.map((candidate) => candidate.sequence === 60
        ? {
            ...candidate,
            state: 'failed',
            error: {
              code: 'demo-finalization-failed',
              message: 'Demo finalization failed.',
              retryable: true,
              details: {},
            },
            startedAt: failedAt,
            finishedAt: failedAt,
            updatedAt: failedAt,
          }
        : {
            ...candidate,
            state: 'succeeded',
            receipt: { code: `${candidate.definitionId}-completed`, details: {} },
            startedAt: failedAt,
            finishedAt: failedAt,
            updatedAt: failedAt,
          }),
      version: failedAt,
    }
    const compensated = handlerHarness(failedRepository, failedDefinitions)
    for (let index = 0; index < 4; index += 1) {
      await compensated.handlers[TRANSFER_COMPENSATE_JOB_KIND](durableHandlerContext(
        TRANSFER_COMPENSATE_JOB_KIND,
        commit,
      ))
    }

    expect(failedWorld.compensationOrder).toEqual(['final', 'downstream', 'base'])
    expect(compensated.audits.map(({ input }) => auditAction(input))).toEqual([
      'job.started', 'transfer.compensated', 'job.succeeded',
      'job.started', 'transfer.compensated', 'job.succeeded',
      'job.started', 'transfer.compensated', 'job.succeeded',
      'job.started', 'transfer.failed', 'job.succeeded',
    ])
    expect(failedRepository.aggregate.proposal.state).toBe('failed')
    expect(failedRepository.aggregate.lock).toMatchObject({
      state: 'released',
      fence: 7,
      releaseReasonCode: 'transfer-failed',
    })
  })
})

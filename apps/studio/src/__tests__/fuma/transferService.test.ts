import { describe, expect, it } from 'bun:test'
import {
  createFumaRegistry,
  type FumaRegistry,
  type PermissionDecision,
} from '@core/fuma'
import {
  freezeFumaRequestContext,
  type FumaRequestContext,
} from '../../../server/fuma/context'
import {
  BASE_OWNERSHIP_TRANSFER_STEP_ID,
  BASE_OWNERSHIP_TRANSFER_STEP_ORDER,
  TRANSFER_CONTROL_PERMISSION,
  TRANSFER_DESTINATION_PERMISSION,
  TransferRepositoryError,
  TransferService,
  createTransferStepRegistry,
  type TransferAggregate,
  type TransferAuditPort,
  type TransferAuthority,
  type TransferCommandEnqueueInput,
  type TransferCommandEnqueuePort,
  type TransferConfirmation,
  type TransferConfirmationProgress,
  type TransferEligibilityAuthority,
  type TransferLockRequest,
  type TransferManifest,
  type TransferManifestAuthority,
  type TransferManifestCaptureInput,
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
  siteId: 'site-transfer',
}
const DESTINATION: TransferOwnershipCoordinate = {
  platformId: 'platform-fuma',
  organizationId: 'organization-destination',
  workspaceId: 'workspace-destination',
  siteId: 'site-transfer',
}
const OTHER_SOURCE: TransferOwnershipCoordinate = {
  ...SOURCE,
  organizationId: 'organization-other',
  workspaceId: 'workspace-other',
}
const CHECKSUM = '0'.repeat(64)
const BASE_TIME = Date.parse('2026-07-25T05:30:00.000Z')

function manifest(
  transferId = 'transfer-01',
  source = SOURCE,
  destination = DESTINATION,
): TransferManifest {
  return {
    schemaVersion: 1,
    transferId,
    source: structuredClone(source),
    destination: structuredClone(destination),
    siteProfileId: 'website',
    siteCapabilityOverrides: { grant: [], revoke: [] },
    siteCapabilityIds: ['site.settings'],
    snapshotChecksum: CHECKSUM,
    resources: ['site-record'],
    collaborators: [],
    capturedAt: new Date(BASE_TIME).toISOString(),
  }
}

function context(
  scope: TransferOwnershipCoordinate,
  userId: string,
  requestId: string,
  permissionIds: readonly string[],
  selectedSiteId: string,
  profileId: string,
  capabilities: readonly string[],
  allow: boolean,
): FumaRequestContext {
  return freezeFumaRequestContext({
    requestId,
    source: {
      kind: 'staff-session',
      correlationId: requestId,
      userId,
      sessionId: `session-${userId}`,
      impersonatedBy: null,
    },
    actor: {
      kind: 'staff',
      userId,
      sessionId: `session-${userId}`,
      impersonator: null,
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
        id: selectedSiteId,
        platformId: scope.platformId,
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        profileId,
        status: 'active',
      },
    },
    profile: { id: profileId, status: 'active' },
    capabilities: [...capabilities],
    permissions: {
      subjectId: userId,
      allow: allow ? [...permissionIds] : [],
      deny: allow ? [] : [...permissionIds],
    },
  })
}

type AuthorityOptions = Readonly<{
  allow?: boolean
  permissionId?: string
  permissionIds?: readonly string[]
  selectedSiteId?: string
  profileId?: string
  capabilities?: readonly string[]
}>

function authority(
  scope: TransferOwnershipCoordinate,
  userId: string,
  requestId: string,
  options: AuthorityOptions = {},
): TransferAuthority {
  const allow = options.allow ?? true
  const permissionIds = options.permissionIds
    ?? [options.permissionId ?? TRANSFER_CONTROL_PERMISSION]
  const trusted = context(
    scope,
    userId,
    requestId,
    permissionIds,
    options.selectedSiteId ?? scope.siteId,
    options.profileId ?? 'website',
    options.capabilities ?? ['site.settings'],
    allow,
  )
  const decisions = permissionIds.map((permissionId): PermissionDecision => (
    permissionId === TRANSFER_DESTINATION_PERMISSION
      ? {
          permissionId,
          scope: {
            kind: 'workspace',
            platformId: scope.platformId,
            organizationId: scope.organizationId,
            workspaceId: scope.workspaceId,
          },
          decision: allow ? 'allow' : 'deny',
          precedence: allow ? 'launch-persona' : 'default-deny',
          source: allow
            ? {
                kind: 'launch-persona-assignment',
                assignmentId: `assignment-${userId}`,
                persona: 'owner',
              }
            : { kind: 'default-deny' },
        }
      : {
          permissionId,
          scope: { kind: 'site', ...structuredClone(scope) },
          decision: allow ? 'allow' : 'deny',
          precedence: allow ? 'launch-persona' : 'default-deny',
          source: allow
            ? {
                kind: 'launch-persona-assignment',
                assignmentId: `assignment-${userId}`,
                persona: 'owner',
              }
            : { kind: 'default-deny' },
        }
  ))
  return { context: trusted, decisions: Object.freeze(decisions) }
}

function destinationAuthority(
  scope: TransferOwnershipCoordinate,
  userId: string,
  requestId: string,
  selectedSiteId = 'site-existing-destination-selection',
  allow = true,
): TransferAuthority {
  return authority(scope, userId, requestId, {
    allow,
    permissionId: TRANSFER_DESTINATION_PERMISSION,
    selectedSiteId,
  })
}

function progress(confirmations: readonly TransferConfirmation[]): TransferConfirmationProgress {
  const source = confirmations.find(({ side }) => side === 'source') ?? null
  const destination = confirmations.find(({ side }) => side === 'destination') ?? null
  if (source && destination) return { status: 'confirmed', source, destination }
  if (source) return { status: 'partially-confirmed', source, destination: null }
  if (destination) return { status: 'partially-confirmed', source: null, destination }
  return { status: 'unconfirmed', source: null, destination: null }
}

function repositoryKey(key: TransferRepositoryKey): string {
  return [
    key.source.platformId,
    key.source.organizationId,
    key.source.workspaceId,
    key.source.siteId,
    key.transferId,
  ].join(':')
}

type StoredTransfer = {
  proposal: TransferProposal
  confirmations: TransferConfirmation[]
  lock: TransferAggregate['lock']
  steps: TransferStep[]
}

class MemoryTransferRepository
implements TransferRepository, TransferRepositoryTransaction {
  records = new Map<string, StoredTransfer>()
  fenceBySite = new Map<string, number>()

  async transaction<T>(
    _key: TransferRepositoryKey,
    work: (transaction: TransferRepositoryTransaction) => Promise<T>,
  ): Promise<T> {
    const records = structuredClone(this.records)
    const fences = structuredClone(this.fenceBySite)
    try {
      return await work(this)
    } catch (error) {
      this.records = records
      this.fenceBySite = fences
      throw error
    }
  }

  read(key: TransferRepositoryKey): Promise<TransferAggregate | null> {
    const stored = this.records.get(repositoryKey(key))
    if (!stored) return Promise.resolve(null)
    return Promise.resolve(structuredClone({
      proposal: stored.proposal,
      confirmations: progress(stored.confirmations),
      lock: stored.lock,
      steps: stored.steps,
      version: stored.proposal.updatedAt,
    }))
  }

  insertProposal(key: TransferRepositoryKey, proposal: TransferProposal): Promise<void> {
    const id = repositoryKey(key)
    if (this.records.has(id)) throw new TransferRepositoryError('conflict', 'duplicate proposal')
    this.records.set(id, {
      proposal: structuredClone(proposal),
      confirmations: [],
      lock: null,
      steps: [],
    })
    return Promise.resolve()
  }

  async recordConfirmation(
    key: TransferRepositoryKey,
    expectedVersion: string,
    proposal: TransferProposal,
    confirmation: TransferConfirmation,
  ): Promise<void> {
    const stored = this.#required(key, expectedVersion)
    if (stored.confirmations.some(({ side }) => side === confirmation.side)) {
      throw new TransferRepositoryError('conflict', 'duplicate confirmation')
    }
    stored.confirmations.push(structuredClone(confirmation))
    stored.proposal = structuredClone(proposal)
  }

  acquireLock(
    key: TransferRepositoryKey,
    proposal: TransferProposal,
    request: TransferLockRequest,
  ) {
    const stored = this.#required(key)
    if (JSON.stringify(stored.proposal.destination) !== JSON.stringify(proposal.destination)) {
      throw new TransferRepositoryError('conflict', 'destination ancestry mismatch')
    }
    for (const record of this.records.values()) {
      if (record.lock?.state === 'active'
        && JSON.stringify(record.lock.scope) === JSON.stringify(request.scope)) {
        if (record.proposal.id === key.transferId
          && record.lock.id === request.id
          && record.lock.requestId === request.requestId) {
          return Promise.resolve(structuredClone(record.lock))
        }
        throw new TransferRepositoryError('lock-contended', 'site lock contended')
      }
    }
    const site = JSON.stringify(request.scope)
    const fence = (this.fenceBySite.get(site) ?? 0) + 1
    this.fenceBySite.set(site, fence)
    stored.lock = {
      id: request.id,
      transferId: key.transferId,
      scope: structuredClone(request.scope),
      fence,
      state: 'active',
      acquiredByJobId: request.acquiredByJobId,
      acquiredByRunId: request.acquiredByRunId,
      requestId: request.requestId,
      acquiredAt: request.acquiredAt,
      heartbeatAt: request.acquiredAt,
      releasedAt: null,
      releaseReasonCode: null,
    }
    return Promise.resolve(structuredClone(stored.lock))
  }

  async recordStart(
    key: TransferRepositoryKey,
    expectedVersion: string,
    proposal: TransferProposal,
    lock: NonNullable<TransferAggregate['lock']>,
    steps: readonly TransferStep[],
  ): Promise<void> {
    const stored = this.#required(key, expectedVersion)
    if (stored.lock?.id !== lock.id || stored.lock.fence !== lock.fence) {
      throw new TransferRepositoryError('stale-fence', 'stale start fence')
    }
    stored.steps = structuredClone([...steps])
    stored.proposal = structuredClone(proposal)
  }

  async recordStep(
    key: TransferRepositoryKey,
    expectedVersion: string,
    proposal: TransferProposal,
    step: TransferStep,
  ): Promise<void> {
    const stored = this.#required(key, expectedVersion)
    if (stored.lock?.state !== 'active'
      || stored.lock.id !== step.lockId
      || stored.lock.fence !== step.fence) {
      throw new TransferRepositoryError('stale-fence', 'stale step fence')
    }
    const index = stored.steps.findIndex(({ id }) => id === step.id)
    if (index === -1) stored.steps.push(structuredClone(step))
    else stored.steps[index] = structuredClone(step)
    stored.proposal = structuredClone(proposal)
  }

  recordCancellation(
    key: TransferRepositoryKey,
    expectedVersion: string,
    proposal: TransferProposal,
  ): Promise<void> {
    return this.#proposal(key, expectedVersion, proposal)
  }

  recordResume(
    key: TransferRepositoryKey,
    expectedVersion: string,
    proposal: TransferProposal,
  ): Promise<void> {
    return this.#proposal(key, expectedVersion, proposal)
  }

  async recordFailure(
    key: TransferRepositoryKey,
    expectedVersion: string,
    proposal: TransferProposal,
    step?: TransferStep,
  ): Promise<void> {
    if (step) await this.recordStep(key, expectedVersion, proposal, step)
    else await this.#proposal(key, expectedVersion, proposal)
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
    key: TransferRepositoryKey,
    expectedVersion: string,
    proposal: TransferProposal,
  ): Promise<void> {
    return this.#proposal(key, expectedVersion, proposal)
  }

  releaseLock(
    key: TransferRepositoryKey,
    proposal: TransferProposal,
    lockId: string,
    fence: number,
    releasedAt: string,
    reasonCode: string,
  ) {
    const stored = this.#required(key)
    if (JSON.stringify(stored.proposal.destination) !== JSON.stringify(proposal.destination)) {
      throw new TransferRepositoryError('conflict', 'destination ancestry mismatch')
    }
    if (stored.lock?.state !== 'active'
      || stored.lock.id !== lockId
      || stored.lock.fence !== fence) {
      throw new TransferRepositoryError('stale-fence', 'stale release fence')
    }
    stored.lock = {
      ...stored.lock,
      state: 'released',
      heartbeatAt: releasedAt,
      releasedAt,
      releaseReasonCode: reasonCode,
    }
    return Promise.resolve(structuredClone(stored.lock))
  }

  markForwardStepRunning(
    source: TransferOwnershipCoordinate,
    transferId: string,
    definitionId: string,
  ): void {
    const stored = this.#required({ source, transferId })
    const index = stored.steps.findIndex((step) => (
      step.definitionId === definitionId && step.kind === 'forward'
    ))
    const step = stored.steps[index]
    if (!step || step.state !== 'pending') {
      throw new Error(`Pending forward step ${definitionId} was not found.`)
    }
    const startedAt = new Date(Date.parse(step.updatedAt) + 1).toISOString()
    const running: TransferStep = {
      ...step,
      state: 'running',
      receipt: null,
      error: null,
      updatedAt: startedAt,
      startedAt,
      finishedAt: null,
    }
    stored.steps[index] = running
  }

  #proposal(
    key: TransferRepositoryKey,
    expectedVersion: string,
    proposal: TransferProposal,
  ): Promise<void> {
    const stored = this.#required(key, expectedVersion)
    stored.proposal = structuredClone(proposal)
    return Promise.resolve()
  }

  #required(key: TransferRepositoryKey, expectedVersion?: string): StoredTransfer {
    const stored = this.records.get(repositoryKey(key))
    if (!stored) throw new TransferRepositoryError('not-found', 'missing proposal')
    if (expectedVersion !== undefined && stored.proposal.updatedAt !== expectedVersion) {
      throw new TransferRepositoryError('stale-version', 'stale version')
    }
    return stored
  }
}

class RecordingAudit implements TransferAuditPort {
  events: { context: FumaRequestContext; input: Record<string, unknown> }[] = []
  failAction: string | null = null

  recordRequest(context: FumaRequestContext, input: unknown): Promise<unknown> {
    const record = input as Record<string, unknown>
    if (record.action === this.failAction) return Promise.reject(new Error('audit unavailable'))
    this.events.push({ context, input: structuredClone(record) })
    return Promise.resolve(record)
  }

  actions(): string[] {
    return this.events.map(({ input }) => input.action as string)
  }
}

class RecordingManifestAuthority implements TransferManifestAuthority {
  readonly captures: TransferManifestCaptureInput[] = []
  readonly #capture: (input: TransferManifestCaptureInput) => unknown

  constructor(capture: (input: TransferManifestCaptureInput) => unknown = (input) => (
    manifest(input.transferId, input.source, input.destination)
  )) {
    this.#capture = capture
  }

  capture(input: TransferManifestCaptureInput): Promise<unknown> {
    this.captures.push(structuredClone(input))
    return Promise.resolve(this.#capture(input))
  }
}

type EligibilityCheckInput = Parameters<TransferEligibilityAuthority['check']>[0]

class RecordingEligibilityAuthority implements TransferEligibilityAuthority {
  readonly checks: EligibilityCheckInput[] = []
  readonly #check: (input: EligibilityCheckInput) => unknown

  constructor(check: (input: EligibilityCheckInput) => unknown = () => ({
    decision: 'eligible',
  })) {
    this.#check = check
  }

  check(input: EligibilityCheckInput): Promise<unknown> {
    this.checks.push(structuredClone(input))
    return Promise.resolve(this.#check(input))
  }
}

class RecordingTransferEnqueue implements TransferCommandEnqueuePort {
  readonly jobs: TransferCommandEnqueueInput[] = []
  readonly #keys = new Set<string>()
  failKind: TransferCommandEnqueueInput['kind'] | null = null

  enqueue(input: TransferCommandEnqueueInput): Promise<unknown> {
    if (input.kind === this.failKind) {
      return Promise.reject(new Error(`${input.kind} enqueue unavailable`))
    }
    if (!this.#keys.has(input.idempotencyKey)) {
      this.#keys.add(input.idempotencyKey)
      this.jobs.push(structuredClone(input))
    }
    return Promise.resolve({ created: true })
  }
}

function baseStep(): TransferStepDefinition {
  return {
    id: BASE_OWNERSHIP_TRANSFER_STEP_ID,
    order: BASE_OWNERSHIP_TRANSFER_STEP_ORDER,
    dependsOn: [],
    mandatory: true,
    async apply() {
      return { code: 'base-applied', details: {} }
    },
    async verify() {
      return { status: 'not-applied', receipt: null }
    },
    async compensate() {
      return { status: 'not-applied', receipt: null }
    },
  }
}

function contributedStep(
  id: string,
  order: number,
  dependsOn: readonly string[],
): TransferStepDefinition {
  return {
    id,
    order,
    dependsOn,
    async apply() {
      return { code: `${id}-applied`, details: {} }
    },
    async verify() {
      return { status: 'not-applied', receipt: null }
    },
    async compensate() {
      return { status: 'not-applied', receipt: null }
    },
  }
}

type HarnessOptions = Readonly<{
  registry?: FumaRegistry
  steps?: readonly TransferStepDefinition[]
  captureManifest?: (input: TransferManifestCaptureInput) => unknown
  checkEligibility?: (input: EligibilityCheckInput) => unknown
}>

function harness(options: HarnessOptions = {}) {
  const repository = new MemoryTransferRepository()
  const audit = new RecordingAudit()
  const enqueue = new RecordingTransferEnqueue()
  const manifestAuthority = new RecordingManifestAuthority(options.captureManifest)
  const eligibilityAuthority = new RecordingEligibilityAuthority(options.checkEligibility)
  const registry = options.registry ?? createFumaRegistry({
    capabilities: [{
      id: 'site.settings',
      permissions: [{
        id: TRANSFER_CONTROL_PERMISSION,
        label: 'Transfer site',
        description: 'Transfer site ownership.',
      }],
    }],
    profiles: [
      {
        id: 'website',
        label: 'Website',
        capabilityPreset: ['site.settings'],
        navigationPreset: [],
        onboardingPreset: [],
        starterTemplatePreset: [],
      },
      {
        id: 'publication',
        label: 'Publication',
        capabilityPreset: ['site.settings'],
        navigationPreset: [],
        onboardingPreset: [],
        starterTemplatePreset: [],
      },
    ],
  })
  let tick = 0
  const service = new TransferService({
    repository,
    registry,
    stepRegistry: createTransferStepRegistry(options.steps ?? [baseStep()]),
    manifestAuthority,
    eligibilityAuthority,
    enqueue,
    audit,
    now: () => new Date(BASE_TIME + tick++),
  })
  return { repository, manifestAuthority, eligibilityAuthority, enqueue, audit, service }
}

async function proposed(service: TransferService, transfer = manifest()) {
  return await service.propose({
    authority: authority(
      transfer.source,
      'source-owner',
      `request-propose-${transfer.transferId}`,
      { capabilities: transfer.siteCapabilityIds },
    ),
    manifest: transfer,
  })
}

async function confirmed(service: TransferService, transfer = manifest()) {
  let aggregate = await proposed(service, transfer)
  aggregate = await service.confirm({
    authority: authority(transfer.source, 'source-owner', `request-source-${transfer.transferId}`),
    source: transfer.source,
    transferId: transfer.transferId,
    side: 'source',
    expectedVersion: aggregate.version,
  })
  return await service.confirm({
    authority: destinationAuthority(
      transfer.destination,
      'destination-owner',
      `request-destination-${transfer.transferId}`,
    ),
    source: transfer.source,
    transferId: transfer.transferId,
    side: 'destination',
    expectedVersion: aggregate.version,
  })
}

async function started(service: TransferService, transfer = manifest()) {
  const aggregate = await confirmed(service, transfer)
  return await service.start({
    authority: authority(
      transfer.source,
      'source-owner',
      `request-start-${transfer.transferId}`,
      { capabilities: transfer.siteCapabilityIds },
    ),
    source: transfer.source,
    transferId: transfer.transferId,
    expectedVersion: aggregate.version,
    lockId: `lock-${transfer.transferId}`,
    jobId: `job-${transfer.transferId}`,
    runId: `run-${transfer.transferId}`,
  })
}

function transferError(code: string) {
  return expect.objectContaining({ name: 'TransferServiceError', code })
}

describe('FUMA-023 transfer service commands', () => {
  it('records a proposal and both confirmation orderings, reaching ready only after distinct actors confirm', async () => {
    const { service } = harness()
    let aggregate = await proposed(service)
    expect(aggregate.proposal.state).toBe('proposed')
    expect(aggregate.proposal.manifest).toMatchObject({
      siteProfileId: 'website',
      siteCapabilityOverrides: { grant: [], revoke: [] },
      siteCapabilityIds: ['site.settings'],
    })
    expect(aggregate.confirmations.status).toBe('unconfirmed')

    aggregate = await service.confirm({
      authority: destinationAuthority(DESTINATION, 'destination-owner', 'request-destination'),
      source: SOURCE,
      transferId: 'transfer-01',
      side: 'destination',
      expectedVersion: aggregate.version,
    })
    expect(aggregate.proposal.state).toBe('awaiting-confirmations')
    expect(aggregate.confirmations).toMatchObject({
      status: 'partially-confirmed',
      source: null,
      destination: {
        confirmedByUserId: 'destination-owner',
        scope: DESTINATION,
      },
    })

    aggregate = await service.confirm({
      authority: authority(SOURCE, 'source-owner', 'request-source'),
      source: SOURCE,
      transferId: 'transfer-01',
      side: 'source',
      expectedVersion: aggregate.version,
    })
    expect(aggregate.proposal.state).toBe('ready')
    expect(aggregate.confirmations.status).toBe('confirmed')

    const secondHarness = harness()
    const sourceFirst = await confirmed(secondHarness.service, manifest('transfer-02'))
    expect(sourceFirst.proposal.state).toBe('ready')
    expect(sourceFirst.confirmations.status).toBe('confirmed')
  })

  it('makes proposal and confirmation commands idempotent without duplicating audit records', async () => {
    const { audit, service } = harness()
    const first = await proposed(service)
    const replay = await proposed(service)
    expect(replay).toEqual(first)

    const input = {
      authority: authority(SOURCE, 'source-owner', 'request-source'),
      source: SOURCE,
      transferId: 'transfer-01',
      side: 'source' as const,
      expectedVersion: first.version,
    }
    const confirmation = await service.confirm(input)
    const duplicate = await service.confirm(input)
    expect(duplicate).toEqual(confirmation)
    expect(audit.actions()).toEqual(['transfer.proposed', 'transfer.confirmed'])
  })

  it('enforces exact source and destination decisions plus distinct confirmation actors', async () => {
    const { service } = harness()
    const aggregate = await proposed(service)
    await expect(service.confirm({
      authority: authority(SOURCE, 'source-owner', 'request-denied', { allow: false }),
      source: SOURCE,
      transferId: 'transfer-01',
      side: 'source',
      expectedVersion: aggregate.version,
    })).rejects.toEqual(transferError('unauthorized'))
    await expect(service.confirm({
      authority: authority(OTHER_SOURCE, 'source-owner', 'request-cross-tenant'),
      source: SOURCE,
      transferId: 'transfer-01',
      side: 'source',
      expectedVersion: aggregate.version,
    })).rejects.toEqual(transferError('scope-mismatch'))
    await expect(service.confirm({
      authority: destinationAuthority(
        { ...DESTINATION, workspaceId: 'workspace-wrong' },
        'destination-owner',
        'request-wrong-destination-workspace',
      ),
      source: SOURCE,
      transferId: 'transfer-01',
      side: 'destination',
      expectedVersion: aggregate.version,
    })).rejects.toEqual(transferError('scope-mismatch'))

    const source = await service.confirm({
      authority: authority(SOURCE, 'same-owner', 'request-source'),
      source: SOURCE,
      transferId: 'transfer-01',
      side: 'source',
      expectedVersion: aggregate.version,
    })
    await expect(service.confirm({
      authority: destinationAuthority(DESTINATION, 'same-owner', 'request-destination'),
      source: SOURCE,
      transferId: 'transfer-01',
      side: 'destination',
      expectedVersion: source.version,
    })).rejects.toEqual(transferError('unauthorized'))
  })

  it('rejects caller tampering with every server-owned manifest snapshot field', async () => {
    const { repository, service } = harness()
    const tampered: TransferManifest = {
      ...manifest('transfer-tampered'),
      siteProfileId: 'publication',
      siteCapabilityOverrides: { grant: ['site.content'], revoke: [] },
      siteCapabilityIds: ['site.content'],
      snapshotChecksum: '1'.repeat(64),
      resources: ['site-record', 'content'],
      collaborators: [{
        userId: 'collaborator-one',
        sourceRole: 'editor',
        intent: 'preserve',
        destinationRole: 'viewer',
      }],
      capturedAt: new Date(BASE_TIME + 1).toISOString(),
    }
    await expect(service.propose({
      authority: authority(SOURCE, 'source-owner', 'request-tampered'),
      manifest: tampered,
    })).rejects.toEqual(transferError('invalid-input'))
    expect(repository.records.size).toBe(0)

    const malformed = harness({ captureManifest: () => ({ transferId: 'transfer-malformed' }) })
    await expect(malformed.service.propose({
      authority: authority(SOURCE, 'source-owner', 'request-malformed'),
      manifest: manifest('transfer-malformed'),
    })).rejects.toEqual(transferError('invalid-input'))
    expect(malformed.repository.records.size).toBe(0)
  })

  it('persists a detached trusted manifest that cannot be changed through the authority result', async () => {
    const captured = structuredClone(manifest('transfer-detached'))
    const { service } = harness({ captureManifest: () => captured })
    const aggregate = await proposed(service, structuredClone(captured))

    Reflect.set(captured, 'snapshotChecksum', 'f'.repeat(64))
    Reflect.set(captured.resources, 0, 'content')

    expect(aggregate.proposal.manifest).toMatchObject({
      snapshotChecksum: CHECKSUM,
      resources: ['site-record'],
    })
    const stored = await service.get(SOURCE, 'transfer-detached')
    expect(stored.proposal.manifest).toMatchObject({
      snapshotChecksum: CHECKSUM,
      resources: ['site-record'],
    })
  })

  it('fails closed on server-owned proposal eligibility without records, audit, or caller bypass', async () => {
    const { audit, eligibilityAuthority, repository, service } = harness({
      checkEligibility: () => ({ decision: 'ineligible', reasonCode: 'billing.unsettled' }),
    })
    const command = {
      authority: authority(SOURCE, 'source-owner', 'request-ineligible-proposal'),
      manifest: manifest('transfer-ineligible-proposal'),
    }
    Reflect.set(command, 'eligibility', { decision: 'eligible' })

    await expect(service.propose(command)).rejects.toEqual(transferError('ineligible'))
    expect(repository.records.size).toBe(0)
    expect(audit.events).toEqual([])
    expect(eligibilityAuthority.checks).toEqual([expect.objectContaining({
      phase: 'proposal',
      transferId: 'transfer-ineligible-proposal',
      source: SOURCE,
      destination: DESTINATION,
    })])
  })

  it('rechecks stored-manifest eligibility before start and leaves ready state untouched on denial', async () => {
    const { audit, eligibilityAuthority, enqueue, service } = harness({
      checkEligibility: ({ phase }) => phase === 'proposal'
        ? { decision: 'eligible' }
        : { decision: 'ineligible', reasonCode: 'destination.suspended' },
    })
    const ready = await confirmed(service, manifest('transfer-ineligible-start'))

    await expect(service.start({
      authority: authority(
        SOURCE,
        'source-owner',
        'request-start-ineligible',
        { capabilities: ['site.settings'] },
      ),
      source: SOURCE,
      transferId: ready.proposal.id,
      expectedVersion: ready.version,
      lockId: 'lock-ineligible',
      jobId: 'job-ineligible',
      runId: 'run-ineligible',
    })).rejects.toEqual(transferError('ineligible'))

    const stored = await service.get(SOURCE, ready.proposal.id)
    expect(stored.proposal.state).toBe('ready')
    expect(stored.lock).toBeNull()
    expect(stored.steps).toEqual([])
    expect(enqueue.jobs).toEqual([])
    expect(audit.actions()).toEqual([
      'transfer.proposed',
      'transfer.confirmed',
      'transfer.confirmed',
    ])
    expect(eligibilityAuthority.checks.map(({ phase }) => phase)).toEqual(['proposal', 'start'])
    expect(eligibilityAuthority.checks[1]?.manifest).toEqual(stored.proposal.manifest)
  })

  it('rejects malformed or control-plane-enriched eligibility results', async () => {
    const malformed = harness({
      checkEligibility: () => ({
        decision: 'eligible',
        platformInternalGrantId: 'grant-private',
        billingAuthorityId: 'billing-private',
      }),
    })
    await expect(proposed(malformed.service, manifest('transfer-bad-eligibility')))
      .rejects.toEqual(transferError('invalid-input'))
    expect(malformed.repository.records.size).toBe(0)
  })

  it('acquires one fenced lock, snapshots forward steps, and enqueues execution only after both confirmations', async () => {
    const { audit, enqueue, service } = harness()
    const proposal = await proposed(service)
    await expect(service.start({
      authority: authority(SOURCE, 'source-owner', 'request-start-early'),
      source: SOURCE,
      transferId: 'transfer-01',
      expectedVersion: proposal.version,
      lockId: 'lock-early',
      jobId: 'job-early',
      runId: 'run-early',
    })).rejects.toEqual(transferError('invalid-state'))

    const aggregate = await started(service)
    expect(aggregate.proposal.state).toBe('running')
    expect(aggregate.lock).toMatchObject({ state: 'active', fence: 1 })
    expect(aggregate.steps).toHaveLength(1)
    expect(aggregate.steps[0]).toMatchObject({
      definitionId: BASE_OWNERSHIP_TRANSFER_STEP_ID,
      kind: 'forward',
      sequence: BASE_OWNERSHIP_TRANSFER_STEP_ORDER,
      state: 'pending',
      fence: 1,
    })
    expect(enqueue.jobs).toEqual([{
      organizationId: SOURCE.organizationId,
      siteId: SOURCE.siteId,
      kind: 'transfer.execute',
      payload: { transferId: 'transfer-01' },
      maxAttempts: 5,
      idempotencyKey: expect.stringMatching(/^transfer\.execute:[a-f0-9]{64}$/),
    }])
    const duplicate = await service.start({
      authority: authority(SOURCE, 'source-owner', 'request-start-transfer-01'),
      source: SOURCE,
      transferId: 'transfer-01',
      expectedVersion: 'stale-but-idempotent',
      lockId: 'lock-transfer-01',
      jobId: 'job-transfer-01',
      runId: 'run-transfer-01',
    })
    expect(duplicate).toEqual(aggregate)
    expect(enqueue.jobs).toHaveLength(1)
    expect(audit.actions().filter((action) => action === 'transfer.started')).toHaveLength(1)
  })

  it('requires every selected transfer contribution permission before start', async () => {
    const contentPermission = 'site.content.transfer'
    const analyticsPermission = 'site.analytics.transfer'
    const selectedManifest: TransferManifest = {
      ...manifest('transfer-contributions'),
      siteCapabilityIds: ['site.settings', 'site.content', 'site.analytics'],
    }
    const registry = createFumaRegistry({
      capabilities: [
        {
          id: 'site.settings',
          permissions: [{
            id: TRANSFER_CONTROL_PERMISSION,
            label: 'Transfer site',
            description: 'Transfer site ownership.',
          }],
        },
        {
          id: 'site.content',
          permissions: [{
            id: contentPermission,
            label: 'Transfer content',
            description: 'Transfer site content.',
          }],
          transfer: [{
            id: 'transfer-content',
            stepId: 'transfer.content',
            permission: contentPermission,
          }],
        },
        {
          id: 'site.analytics',
          permissions: [{
            id: analyticsPermission,
            label: 'Transfer analytics',
            description: 'Transfer site analytics.',
          }],
          transfer: [{
            id: 'transfer-analytics',
            stepId: 'transfer.analytics',
            permission: analyticsPermission,
          }],
        },
      ],
      profiles: [{
        id: 'website',
        label: 'Website',
        capabilityPreset: ['site.settings', 'site.content', 'site.analytics'],
        navigationPreset: [],
        onboardingPreset: [],
        starterTemplatePreset: [],
      }],
    })
    const { enqueue, service } = harness({
      registry,
      steps: [
        baseStep(),
        contributedStep('transfer.content', 50, [BASE_OWNERSHIP_TRANSFER_STEP_ID]),
        contributedStep('transfer.analytics', 60, ['transfer.content']),
      ],
      captureManifest: () => selectedManifest,
    })
    const ready = await confirmed(service, selectedManifest)
    const startInput = {
      source: SOURCE,
      transferId: selectedManifest.transferId,
      expectedVersion: ready.version,
      lockId: 'lock-contributions',
      jobId: 'job-contributions',
      runId: 'run-contributions',
    }

    await expect(service.start({
      ...startInput,
      authority: authority(SOURCE, 'source-owner', 'request-contributions', {
        capabilities: selectedManifest.siteCapabilityIds,
        permissionIds: [TRANSFER_CONTROL_PERMISSION, contentPermission],
      }),
    })).rejects.toEqual(transferError('unauthorized'))

    const aggregate = await service.start({
      ...startInput,
      authority: authority(SOURCE, 'source-owner', 'request-contributions', {
        capabilities: selectedManifest.siteCapabilityIds,
        permissionIds: [TRANSFER_CONTROL_PERMISSION, contentPermission, analyticsPermission],
      }),
    })
    expect(aggregate.steps.map(({ definitionId }) => definitionId)).toEqual([
      BASE_OWNERSHIP_TRANSFER_STEP_ID,
      'transfer.content',
      'transfer.analytics',
    ])
    expect(enqueue.jobs.map(({ kind }) => kind)).toEqual(['transfer.execute'])
  })

  it('rejects lock contention across transfers for the same full site ancestry', async () => {
    const { service } = harness()
    await started(service, manifest('transfer-one'))
    const second = await confirmed(service, manifest('transfer-two'))
    await expect(service.start({
      authority: authority(SOURCE, 'source-owner', 'request-start-two'),
      source: SOURCE,
      transferId: 'transfer-two',
      expectedVersion: second.version,
      lockId: 'lock-two',
      jobId: 'job-two',
      runId: 'run-two',
    })).rejects.toEqual(transferError('lock-contended'))
  })

  it('allows cancellation before the base forward step starts and closes it once running', async () => {
    const first = harness()
    const running = await started(first.service)
    expect(running.steps[0]).toMatchObject({
      definitionId: BASE_OWNERSHIP_TRANSFER_STEP_ID,
      kind: 'forward',
      state: 'pending',
    })
    const cancelled = await first.service.cancel({
      authority: authority(SOURCE, 'source-owner', 'request-cancel'),
      source: SOURCE,
      transferId: 'transfer-01',
      expectedVersion: running.version,
      reasonCode: 'owner-request',
    })
    expect(cancelled.proposal.state).toBe('cancelled')
    expect(cancelled.proposal.cancelledAt).not.toBeNull()
    expect(cancelled.lock).toMatchObject({ state: 'released', releaseReasonCode: 'cancelled' })
    const duplicate = await first.service.cancel({
      authority: authority(SOURCE, 'source-owner', 'request-cancel'),
      source: SOURCE,
      transferId: 'transfer-01',
      expectedVersion: 'stale-idempotent',
      reasonCode: 'owner-request',
    })
    expect(duplicate).toEqual(cancelled)

    const second = harness()
    await started(second.service)
    second.repository.markForwardStepRunning(
      SOURCE,
      'transfer-01',
      BASE_OWNERSHIP_TRANSFER_STEP_ID,
    )
    const baseStarted = await second.service.get(SOURCE, 'transfer-01')
    await expect(second.service.cancel({
      authority: authority(SOURCE, 'source-owner', 'request-cancel-late'),
      source: SOURCE,
      transferId: 'transfer-01',
      expectedVersion: baseStarted.version,
      reasonCode: 'too-late',
    })).rejects.toEqual(transferError('invalid-state'))
  })

  it('records an idempotent resume request and enqueues one durable resume job', async () => {
    const { audit, enqueue, repository, service } = harness()
    await started(service)
    repository.markForwardStepRunning(SOURCE, 'transfer-01', BASE_OWNERSHIP_TRANSFER_STEP_ID)
    const interrupted = await service.get(SOURCE, 'transfer-01')
    expect(interrupted.steps[0]).toMatchObject({
      definitionId: BASE_OWNERSHIP_TRANSFER_STEP_ID,
      kind: 'forward',
      state: 'running',
    })

    const input = {
      authority: authority(SOURCE, 'source-owner', 'request-resume'),
      source: SOURCE,
      transferId: 'transfer-01',
      expectedVersion: interrupted.version,
      fence: interrupted.lock!.fence,
      reasonCode: 'worker-restarted',
    }
    const resumed = await service.resume(input)
    expect(resumed.proposal).toMatchObject({
      state: 'resume-requested',
      resumeRequestId: 'request-resume',
      resumeReasonCode: 'worker-restarted',
      resumeCount: 1,
    })
    const duplicate = await service.resume({ ...input, expectedVersion: 'stale-idempotent' })
    expect(duplicate).toEqual(resumed)
    expect(enqueue.jobs.filter(({ kind }) => kind === 'transfer.resume')).toEqual([{
      organizationId: SOURCE.organizationId,
      siteId: SOURCE.siteId,
      kind: 'transfer.resume',
      payload: { transferId: 'transfer-01' },
      maxAttempts: 5,
      idempotencyKey: expect.stringMatching(/^transfer\.resume:[a-f0-9]{64}$/),
    }])
    expect(audit.actions().filter((action) => action === 'transfer.resumed')).toHaveLength(1)
  })

  it('audits enqueue failures and rolls back start and resume without partial transfer state', async () => {
    const startHarness = harness()
    const ready = await confirmed(startHarness.service)
    startHarness.enqueue.failKind = 'transfer.execute'
    await expect(startHarness.service.start({
      authority: authority(SOURCE, 'source-owner', 'request-start-enqueue-failure'),
      source: SOURCE,
      transferId: 'transfer-01',
      expectedVersion: ready.version,
      lockId: 'lock-enqueue-failure',
      jobId: 'job-enqueue-failure',
      runId: 'run-enqueue-failure',
    })).rejects.toThrow('transfer.execute enqueue unavailable')
    const startUnchanged = await startHarness.service.get(SOURCE, 'transfer-01')
    expect(startUnchanged.proposal.state).toBe('ready')
    expect(startUnchanged.lock).toBeNull()
    expect(startUnchanged.steps).toEqual([])
    expect(startHarness.enqueue.jobs).toEqual([])
    expect(startHarness.audit.events.at(-1)?.input).toMatchObject({
      action: 'transfer.failed',
      outcome: 'failure',
      metadata: {
        transferId: 'transfer-01',
        failureCode: 'transfer.execute.enqueue-failed',
      },
    })
    expect(startHarness.audit.actions()).not.toContain('transfer.started')

    const resumeHarness = harness()
    await started(resumeHarness.service)
    resumeHarness.repository.markForwardStepRunning(
      SOURCE,
      'transfer-01',
      BASE_OWNERSHIP_TRANSFER_STEP_ID,
    )
    const interrupted = await resumeHarness.service.get(SOURCE, 'transfer-01')
    resumeHarness.enqueue.failKind = 'transfer.resume'
    await expect(resumeHarness.service.resume({
      authority: authority(SOURCE, 'source-owner', 'request-resume-enqueue-failure'),
      source: SOURCE,
      transferId: 'transfer-01',
      expectedVersion: interrupted.version,
      fence: interrupted.lock!.fence,
      reasonCode: 'worker-restarted',
    })).rejects.toThrow('transfer.resume enqueue unavailable')
    const resumeUnchanged = await resumeHarness.service.get(SOURCE, 'transfer-01')
    expect(resumeUnchanged.proposal).toMatchObject({
      state: 'running',
      resumeRequestId: null,
      resumeReasonCode: null,
      resumeCount: 0,
    })
    expect(resumeHarness.enqueue.jobs.map(({ kind }) => kind).filter((kind) => (
      kind === 'transfer.resume'
    ))).toEqual([])
    expect(resumeHarness.audit.events.at(-1)?.input).toMatchObject({
      action: 'transfer.failed',
      outcome: 'failure',
      metadata: {
        transferId: 'transfer-01',
        failureCode: 'transfer.resume.enqueue-failed',
      },
    })
    expect(resumeHarness.audit.actions()).not.toContain('transfer.resumed')
  })

  it('rolls back transfer state when required audit persistence fails', async () => {
    const { audit, repository, service } = harness()
    audit.failAction = 'transfer.proposed'
    await expect(proposed(service)).rejects.toThrow('audit unavailable')
    expect(repository.records.size).toBe(0)

    audit.failAction = null
    const proposal = await proposed(service)
    audit.failAction = 'transfer.confirmed'
    await expect(service.confirm({
      authority: authority(SOURCE, 'source-owner', 'request-source'),
      source: SOURCE,
      transferId: 'transfer-01',
      side: 'source',
      expectedVersion: proposal.version,
    })).rejects.toThrow('audit unavailable')
    const unchanged = await service.get(SOURCE, 'transfer-01')
    expect(unchanged.proposal.state).toBe('proposed')
    expect(unchanged.confirmations.status).toBe('unconfirmed')
  })
})

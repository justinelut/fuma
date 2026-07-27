import { safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import {
  TransferConfirmationSchema,
  TransferLockSchema,
  TransferProposalSchema,
  TransferStepSchema,
  assertTransferConfirmationLifecycle,
  assertTransferProposal,
  assertTransferStep,
  type TransferConfirmation,
  type TransferConfirmationProgress,
  type TransferFailure,
  type TransferLock,
  type TransferOwnershipCoordinate,
  type TransferProposal,
  type TransferStep,
} from './contracts'

export type TransferRepositoryKey = Readonly<{
  transferId: string
  source: TransferOwnershipCoordinate
}>

export type TransferAggregate = Readonly<{
  proposal: TransferProposal
  confirmations: TransferConfirmationProgress
  lock: TransferLock | null
  steps: readonly TransferStep[]
  version: string
}>

export type TransferLockRequest = Readonly<{
  id: string
  scope: TransferOwnershipCoordinate
  acquiredByJobId: string
  acquiredByRunId: string
  requestId: string
  acquiredAt: string
}>

export type TransferRepositoryErrorCode =
  | 'not-found'
  | 'conflict'
  | 'stale-version'
  | 'stale-fence'
  | 'lock-contended'
  | 'stored-state-invalid'

export class TransferRepositoryError extends Error {
  readonly code: TransferRepositoryErrorCode

  constructor(code: TransferRepositoryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TransferRepositoryError'
    this.code = code
  }
}

export interface TransferRepositoryTransaction {
  read(key: TransferRepositoryKey): Promise<TransferAggregate | null>
  insertProposal(key: TransferRepositoryKey, proposal: TransferProposal): Promise<void>
  recordConfirmation(
    key: TransferRepositoryKey,
    expectedVersion: string,
    proposal: TransferProposal,
    confirmation: TransferConfirmation,
  ): Promise<void>
  acquireLock(
    key: TransferRepositoryKey,
    proposal: TransferProposal,
    request: TransferLockRequest,
  ): Promise<TransferLock>
  recordStart(
    key: TransferRepositoryKey,
    expectedVersion: string,
    proposal: TransferProposal,
    lock: TransferLock,
    steps: readonly TransferStep[],
  ): Promise<void>
  recordStep(
    key: TransferRepositoryKey,
    expectedVersion: string,
    proposal: TransferProposal,
    step: TransferStep,
  ): Promise<void>
  recordCancellation(
    key: TransferRepositoryKey,
    expectedVersion: string,
    proposal: TransferProposal,
  ): Promise<void>
  recordResume(
    key: TransferRepositoryKey,
    expectedVersion: string,
    proposal: TransferProposal,
  ): Promise<void>
  recordFailure(
    key: TransferRepositoryKey,
    expectedVersion: string,
    proposal: TransferProposal,
    step?: TransferStep,
  ): Promise<void>
  recordCompensation(
    key: TransferRepositoryKey,
    expectedVersion: string,
    proposal: TransferProposal,
    step: TransferStep,
  ): Promise<void>
  recordCompletion(
    key: TransferRepositoryKey,
    expectedVersion: string,
    proposal: TransferProposal,
  ): Promise<void>
  releaseLock(
    key: TransferRepositoryKey,
    proposal: TransferProposal,
    lockId: string,
    fence: number,
    releasedAt: string,
    reasonCode: string,
  ): Promise<TransferLock>
}

export interface TransferRepository {
  read(key: TransferRepositoryKey): Promise<TransferAggregate | null>
  transaction<T>(
    key: TransferRepositoryKey,
    work: (transaction: TransferRepositoryTransaction) => Promise<T>,
  ): Promise<T>
}

interface ProposalRow {
  platform_id: string
  id: string
  source_organization_id: string
  source_workspace_id: string
  source_site_id: string
  destination_organization_id: string
  destination_workspace_id: string
  destination_site_id: string
  manifest_json: unknown
  state: string
  proposed_by_user_id: string
  proposed_by_session_id: string
  proposed_request_id: string
  cancellation_requested_by_user_id: string | null
  cancellation_request_id: string | null
  cancellation_reason_code: string | null
  resume_requested_by_user_id: string | null
  resume_request_id: string | null
  resume_reason_code: string | null
  resume_count: number
  failure_json: unknown | null
  created_at: string | Date
  updated_at: string | Date
  ready_at: string | Date | null
  started_at: string | Date | null
  compensation_started_at: string | Date | null
  compensation_completed_at: string | Date | null
  completed_at: string | Date | null
  cancelled_at: string | Date | null
}

interface ConfirmationRow {
  transfer_id: string
  side: string
  platform_id: string
  organization_id: string
  workspace_id: string
  site_id: string
  confirmed_by_user_id: string
  confirmed_by_session_id: string
  request_id: string
  confirmed_at: string | Date
}

interface LockRow {
  platform_id: string
  id: string
  transfer_id: string
  organization_id: string
  workspace_id: string
  site_id: string
  fence: string | number
  state: string
  acquired_by_job_id: string
  acquired_by_run_id: string
  request_id: string
  acquired_at: string | Date
  heartbeat_at: string | Date
  released_at: string | Date | null
  release_reason_code: string | null
}

interface StepRow {
  id: string
  transfer_id: string
  lock_id: string
  fence: string | number
  definition_id: string
  sequence: string | number
  attempt: number
  kind: string
  state: string
  receipt_json: unknown | null
  error_json: unknown | null
  created_at: string | Date
  updated_at: string | Date
  started_at: string | Date | null
  finished_at: string | Date | null
}

const PROPOSAL_COLUMNS = `
  platform_id, id, source_organization_id, source_workspace_id, source_site_id,
  destination_organization_id, destination_workspace_id, destination_site_id,
  manifest_json, state, proposed_by_user_id, proposed_by_session_id,
  proposed_request_id, cancellation_requested_by_user_id, cancellation_request_id,
  cancellation_reason_code, resume_requested_by_user_id, resume_request_id,
  resume_reason_code, resume_count, failure_json, created_at, updated_at, ready_at,
  started_at, compensation_started_at, compensation_completed_at, completed_at,
  cancelled_at
`

const CONFIRMATION_COLUMNS = `
  transfer_id, side, platform_id, organization_id, workspace_id, site_id,
  confirmed_by_user_id, confirmed_by_session_id, request_id, confirmed_at
`

const LOCK_COLUMNS = `
  platform_id, id, transfer_id, organization_id, workspace_id, site_id, fence,
  state, acquired_by_job_id, acquired_by_run_id, request_id, acquired_at,
  heartbeat_at, released_at, release_reason_code
`

const STEP_COLUMNS = `
  id, transfer_id, lock_id, fence, definition_id, sequence, attempt, kind, state,
  receipt_json, error_json, created_at, updated_at, started_at, finished_at
`

function iso(value: string | Date): string
function iso(value: string | Date | null): string | null
function iso(value: string | Date | null): string | null {
  if (value === null) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function stored<Schema extends TSchema>(
  schema: Schema,
  value: unknown,
  label: string,
): Static<Schema> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) {
    throw new TransferRepositoryError('stored-state-invalid', `Stored ${label} is invalid.`)
  }
  return parsed.value
}

function assertStored(label: string, assertion: () => void): void {
  try {
    assertion()
  } catch (cause) {
    if (cause instanceof TransferRepositoryError) throw cause
    throw new TransferRepositoryError(
      'stored-state-invalid',
      `Stored ${label} violates transfer invariants.`,
      { cause },
    )
  }
}

function mapProposal(row: ProposalRow): TransferProposal {
  const proposal = stored(TransferProposalSchema, {
    id: row.id,
    source: {
      platformId: row.platform_id,
      organizationId: row.source_organization_id,
      workspaceId: row.source_workspace_id,
      siteId: row.source_site_id,
    },
    destination: {
      platformId: row.platform_id,
      organizationId: row.destination_organization_id,
      workspaceId: row.destination_workspace_id,
      siteId: row.destination_site_id,
    },
    manifest: row.manifest_json,
    state: row.state,
    proposedByUserId: row.proposed_by_user_id,
    proposedBySessionId: row.proposed_by_session_id,
    proposedRequestId: row.proposed_request_id,
    cancellationRequestedByUserId: row.cancellation_requested_by_user_id,
    cancellationRequestId: row.cancellation_request_id,
    cancellationReasonCode: row.cancellation_reason_code,
    resumeRequestedByUserId: row.resume_requested_by_user_id,
    resumeRequestId: row.resume_request_id,
    resumeReasonCode: row.resume_reason_code,
    resumeCount: row.resume_count,
    failure: row.failure_json,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    readyAt: iso(row.ready_at),
    startedAt: iso(row.started_at),
    compensationStartedAt: iso(row.compensation_started_at),
    compensationCompletedAt: iso(row.compensation_completed_at),
    completedAt: iso(row.completed_at),
    cancelledAt: iso(row.cancelled_at),
  }, `transfer proposal ${row.id}`)
  assertStored(`transfer proposal ${row.id}`, () => assertTransferProposal(proposal))
  return proposal
}

function mapConfirmation(row: ConfirmationRow): TransferConfirmation {
  return stored(TransferConfirmationSchema, {
    transferId: row.transfer_id,
    side: row.side,
    scope: {
      platformId: row.platform_id,
      organizationId: row.organization_id,
      workspaceId: row.workspace_id,
      siteId: row.site_id,
    },
    confirmedByUserId: row.confirmed_by_user_id,
    confirmedBySessionId: row.confirmed_by_session_id,
    requestId: row.request_id,
    confirmedAt: iso(row.confirmed_at),
  }, `transfer confirmation ${row.transfer_id}:${row.side}`)
}

function mapLock(row: LockRow): TransferLock {
  return stored(TransferLockSchema, {
    id: row.id,
    transferId: row.transfer_id,
    scope: {
      platformId: row.platform_id,
      organizationId: row.organization_id,
      workspaceId: row.workspace_id,
      siteId: row.site_id,
    },
    fence: Number(row.fence),
    state: row.state,
    acquiredByJobId: row.acquired_by_job_id,
    acquiredByRunId: row.acquired_by_run_id,
    requestId: row.request_id,
    acquiredAt: iso(row.acquired_at),
    heartbeatAt: iso(row.heartbeat_at),
    releasedAt: iso(row.released_at),
    releaseReasonCode: row.release_reason_code,
  }, `transfer lock ${row.id}`)
}

function mapStep(row: StepRow): TransferStep {
  const step = stored(TransferStepSchema, {
    id: row.id,
    transferId: row.transfer_id,
    lockId: row.lock_id,
    fence: Number(row.fence),
    definitionId: row.definition_id,
    sequence: Number(row.sequence),
    attempt: row.attempt,
    kind: row.kind,
    state: row.state,
    receipt: row.receipt_json,
    error: row.error_json,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
  }, `transfer step ${row.id}`)
  assertTransferStep(step)
  return step
}

function confirmationProgress(
  rows: readonly ConfirmationRow[],
  proposal: TransferProposal,
): TransferConfirmationProgress {
  const confirmations = rows.map(mapConfirmation)
  const source = confirmations.find(
    (confirmation): confirmation is Extract<TransferConfirmation, { side: 'source' }> => (
      confirmation.side === 'source'
    ),
  ) ?? null
  const destination = confirmations.find(
    (confirmation): confirmation is Extract<TransferConfirmation, { side: 'destination' }> => (
      confirmation.side === 'destination'
    ),
  ) ?? null
  const progress: TransferConfirmationProgress = source && destination
    ? { status: 'confirmed', source, destination }
    : source
      ? { status: 'partially-confirmed', source, destination: null }
      : destination
        ? { status: 'partially-confirmed', source: null, destination }
        : { status: 'unconfirmed', source: null, destination: null }
  assertStored(`transfer confirmations for ${proposal.id}`, () => {
    assertTransferConfirmationLifecycle(proposal, progress)
  })
  return progress
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

function assertKey(key: TransferRepositoryKey, proposal: TransferProposal): void {
  if (key.transferId !== proposal.id || !sameCoordinate(key.source, proposal.source)) {
    throw new TransferRepositoryError('conflict', 'Transfer repository key does not match proposal ownership.')
  }
}

class PostgresTransferTransaction implements TransferRepositoryTransaction {
  readonly #db: DbClient

  constructor(db: DbClient) {
    this.#db = db
  }

  async read(key: TransferRepositoryKey): Promise<TransferAggregate | null> {
    return await this.#readExplicit(key)
  }

  async #readExplicit(key: TransferRepositoryKey): Promise<TransferAggregate | null> {
    const { rows } = await this.#db.unsafe<ProposalRow>(`
      select ${PROPOSAL_COLUMNS}
      from fuma_site_transfer_proposals
      where platform_id = $1 and id = $2
        and source_organization_id = $3 and source_workspace_id = $4
        and source_site_id = $5
      for update
    `, [
      key.source.platformId,
      key.transferId,
      key.source.organizationId,
      key.source.workspaceId,
      key.source.siteId,
    ])
    return rows[0] ? await this.#aggregate(key, rows[0]) : null
  }

  async #aggregate(key: TransferRepositoryKey, proposalRow: ProposalRow): Promise<TransferAggregate> {
    const proposal = mapProposal(proposalRow)
    assertKey(key, proposal)
    const ancestry = [
      key.source.platformId,
      key.transferId,
      key.source.organizationId,
      key.source.workspaceId,
      key.source.siteId,
      proposal.destination.organizationId,
      proposal.destination.workspaceId,
      proposal.destination.siteId,
    ]
    const [confirmationResult, lockResult, stepResult] = await Promise.all([
      this.#db.unsafe<ConfirmationRow>(`
        select ${CONFIRMATION_COLUMNS}
        from fuma_site_transfer_confirmations as confirmation
        where confirmation.platform_id = $1 and confirmation.transfer_id = $2
          and exists (
            select 1 from fuma_site_transfer_proposals as proposal
            where proposal.platform_id = $1 and proposal.id = $2
              and proposal.source_organization_id = $3
              and proposal.source_workspace_id = $4
              and proposal.source_site_id = $5
              and proposal.destination_organization_id = $6
              and proposal.destination_workspace_id = $7
              and proposal.destination_site_id = $8
          )
        order by confirmation.side
      `, ancestry),
      this.#db.unsafe<LockRow>(`
        select ${LOCK_COLUMNS}
        from fuma_site_transfer_locks as transfer_lock
        where transfer_lock.platform_id = $1 and transfer_lock.transfer_id = $2
          and transfer_lock.organization_id = $3
          and transfer_lock.workspace_id = $4
          and transfer_lock.site_id = $5
          and exists (
            select 1 from fuma_site_transfer_proposals as proposal
            where proposal.platform_id = $1 and proposal.id = $2
              and proposal.source_organization_id = $3
              and proposal.source_workspace_id = $4
              and proposal.source_site_id = $5
              and proposal.destination_organization_id = $6
              and proposal.destination_workspace_id = $7
              and proposal.destination_site_id = $8
          )
        order by case when transfer_lock.state = 'active' then 0 else 1 end,
          transfer_lock.fence desc, transfer_lock.id
        limit 1
      `, ancestry),
      this.#db.unsafe<StepRow>(`
        select ${STEP_COLUMNS}
        from fuma_site_transfer_steps as step
        where step.platform_id = $1 and step.transfer_id = $2
          and exists (
            select 1 from fuma_site_transfer_proposals as proposal
            where proposal.platform_id = $1 and proposal.id = $2
              and proposal.source_organization_id = $3
              and proposal.source_workspace_id = $4
              and proposal.source_site_id = $5
              and proposal.destination_organization_id = $6
              and proposal.destination_workspace_id = $7
              and proposal.destination_site_id = $8
          )
          and exists (
            select 1 from fuma_site_transfer_locks as transfer_lock
            where transfer_lock.platform_id = $1
              and transfer_lock.transfer_id = $2
              and transfer_lock.organization_id = $3
              and transfer_lock.workspace_id = $4
              and transfer_lock.site_id = $5
              and transfer_lock.id = step.lock_id
              and transfer_lock.fence = step.fence
          )
        order by step.sequence, step.kind, step.definition_id, step.attempt, step.id
      `, ancestry),
    ])
    return {
      proposal,
      confirmations: confirmationProgress(confirmationResult.rows, proposal),
      lock: lockResult.rows[0] ? mapLock(lockResult.rows[0]) : null,
      steps: Object.freeze(stepResult.rows.map(mapStep)),
      version: proposal.updatedAt,
    }
  }

  async insertProposal(key: TransferRepositoryKey, proposal: TransferProposal): Promise<void> {
    assertTransferProposal(proposal)
    assertKey(key, proposal)
    if (proposal.state !== 'proposed') {
      throw new TransferRepositoryError('conflict', 'Transfer proposal must begin in proposed state.')
    }
    const manifestJson = JSON.stringify(proposal.manifest)
    const failureJson = proposal.failure === null ? null : JSON.stringify(proposal.failure)
    const { rowCount } = await this.#db`
      insert into fuma_site_transfer_proposals (
        platform_id, id, source_organization_id, source_workspace_id, source_site_id,
        destination_organization_id, destination_workspace_id, destination_site_id,
        manifest_json, state, proposed_by_user_id, proposed_by_session_id,
        proposed_request_id, cancellation_requested_by_user_id, cancellation_request_id,
        cancellation_reason_code, resume_requested_by_user_id, resume_request_id,
        resume_reason_code, resume_count, failure_json, created_at, updated_at, ready_at,
        started_at, compensation_started_at, compensation_completed_at, completed_at,
        cancelled_at
      ) values (
        ${key.source.platformId}, ${key.transferId}, ${key.source.organizationId},
        ${key.source.workspaceId}, ${key.source.siteId},
        ${proposal.destination.organizationId}, ${proposal.destination.workspaceId},
        ${proposal.destination.siteId}, ${manifestJson}, ${proposal.state},
        ${proposal.proposedByUserId}, ${proposal.proposedBySessionId},
        ${proposal.proposedRequestId}, ${proposal.cancellationRequestedByUserId},
        ${proposal.cancellationRequestId}, ${proposal.cancellationReasonCode},
        ${proposal.resumeRequestedByUserId}, ${proposal.resumeRequestId},
        ${proposal.resumeReasonCode}, ${proposal.resumeCount}, ${failureJson},
        ${proposal.createdAt}, ${proposal.updatedAt}, ${proposal.readyAt},
        ${proposal.startedAt}, ${proposal.compensationStartedAt},
        ${proposal.compensationCompletedAt}, ${proposal.completedAt}, ${proposal.cancelledAt}
      ) on conflict (platform_id, id) do nothing
    `
    if (rowCount !== 1) throw new TransferRepositoryError('conflict', 'Transfer proposal already exists.')
  }

  async #updateProposal(
    key: TransferRepositoryKey,
    expectedVersion: string,
    proposal: TransferProposal,
  ): Promise<void> {
    assertTransferProposal(proposal)
    assertKey(key, proposal)
    const failureJson = proposal.failure === null ? null : JSON.stringify(proposal.failure)
    const { rowCount } = await this.#db`
      update fuma_site_transfer_proposals
      set state = ${proposal.state},
        cancellation_requested_by_user_id = ${proposal.cancellationRequestedByUserId},
        cancellation_request_id = ${proposal.cancellationRequestId},
        cancellation_reason_code = ${proposal.cancellationReasonCode},
        resume_requested_by_user_id = ${proposal.resumeRequestedByUserId},
        resume_request_id = ${proposal.resumeRequestId},
        resume_reason_code = ${proposal.resumeReasonCode},
        resume_count = ${proposal.resumeCount}, failure_json = ${failureJson},
        updated_at = ${proposal.updatedAt}, ready_at = ${proposal.readyAt},
        started_at = ${proposal.startedAt},
        compensation_started_at = ${proposal.compensationStartedAt},
        compensation_completed_at = ${proposal.compensationCompletedAt},
        completed_at = ${proposal.completedAt}, cancelled_at = ${proposal.cancelledAt}
      where platform_id = ${key.source.platformId} and id = ${key.transferId}
        and source_organization_id = ${key.source.organizationId}
        and source_workspace_id = ${key.source.workspaceId}
        and source_site_id = ${key.source.siteId}
        and destination_organization_id = ${proposal.destination.organizationId}
        and destination_workspace_id = ${proposal.destination.workspaceId}
        and destination_site_id = ${proposal.destination.siteId}
        and updated_at = ${expectedVersion}
    `
    if (rowCount !== 1) {
      throw new TransferRepositoryError('stale-version', 'Transfer proposal version is stale.')
    }
  }

  async recordConfirmation(
    key: TransferRepositoryKey,
    expectedVersion: string,
    proposal: TransferProposal,
    confirmation: TransferConfirmation,
  ): Promise<void> {
    assertKey(key, proposal)
    const scope = confirmation.scope
    const expectedScope = confirmation.side === 'source' ? proposal.source : proposal.destination
    if (confirmation.transferId !== proposal.id || !sameCoordinate(scope, expectedScope)) {
      throw new TransferRepositoryError('conflict', 'Transfer confirmation does not match proposal ownership.')
    }
    const { rowCount } = await this.#db`
      insert into fuma_site_transfer_confirmations (
        platform_id, transfer_id, side, organization_id, workspace_id, site_id,
        confirmed_by_user_id, confirmed_by_session_id, request_id, confirmed_at
      ) select
        ${key.source.platformId}, ${key.transferId}, ${confirmation.side},
        ${scope.organizationId}, ${scope.workspaceId}, ${scope.siteId},
        ${confirmation.confirmedByUserId}, ${confirmation.confirmedBySessionId},
        ${confirmation.requestId}, ${confirmation.confirmedAt}
      where exists (
        select 1 from fuma_site_transfer_proposals as stored_proposal
        where stored_proposal.platform_id = ${key.source.platformId}
          and stored_proposal.id = ${key.transferId}
          and stored_proposal.source_organization_id = ${key.source.organizationId}
          and stored_proposal.source_workspace_id = ${key.source.workspaceId}
          and stored_proposal.source_site_id = ${key.source.siteId}
          and stored_proposal.destination_organization_id = ${proposal.destination.organizationId}
          and stored_proposal.destination_workspace_id = ${proposal.destination.workspaceId}
          and stored_proposal.destination_site_id = ${proposal.destination.siteId}
          and (
            (${confirmation.side} = 'source'
              and stored_proposal.source_organization_id = ${scope.organizationId}
              and stored_proposal.source_workspace_id = ${scope.workspaceId}
              and stored_proposal.source_site_id = ${scope.siteId})
            or (${confirmation.side} = 'destination'
              and stored_proposal.destination_organization_id = ${scope.organizationId}
              and stored_proposal.destination_workspace_id = ${scope.workspaceId}
              and stored_proposal.destination_site_id = ${scope.siteId})
          )
      ) and not exists (
        select 1 from fuma_site_transfer_confirmations as opposite
        where opposite.platform_id = ${key.source.platformId}
          and opposite.transfer_id = ${key.transferId}
          and opposite.side <> ${confirmation.side}
          and opposite.confirmed_by_user_id = ${confirmation.confirmedByUserId}
      ) on conflict (platform_id, transfer_id, side) do nothing
    `
    if (rowCount !== 1) throw new TransferRepositoryError('conflict', 'Transfer confirmation already exists.')
    await this.#updateProposal(key, expectedVersion, proposal)
  }

  async acquireLock(
    key: TransferRepositoryKey,
    proposal: TransferProposal,
    request: TransferLockRequest,
  ): Promise<TransferLock> {
    assertTransferProposal(proposal)
    assertKey(key, proposal)
    if (!sameCoordinate(request.scope, proposal.source)) {
      throw new TransferRepositoryError('conflict', 'Transfer lock must use the exact source ownership scope.')
    }
    const advisoryKey = `fuma:transfer:${key.source.platformId}:${key.source.organizationId}:${key.source.workspaceId}:${key.source.siteId}`
    await this.#db`select pg_advisory_xact_lock(hashtextextended(${advisoryKey}, 0))`
    const existing = await this.#db.unsafe<LockRow>(`
      select ${LOCK_COLUMNS}
      from fuma_site_transfer_locks as transfer_lock
      where transfer_lock.platform_id = $1 and transfer_lock.state = 'active'
        and transfer_lock.organization_id = $2 and transfer_lock.workspace_id = $3
        and transfer_lock.site_id = $4
        and exists (
          select 1 from fuma_site_transfer_proposals as proposal
          where proposal.platform_id = $1 and proposal.id = $5
            and proposal.source_organization_id = $2
            and proposal.source_workspace_id = $3 and proposal.source_site_id = $4
            and proposal.destination_organization_id = $6
            and proposal.destination_workspace_id = $7
            and proposal.destination_site_id = $8
        )
      for update
    `, [
      key.source.platformId,
      key.source.organizationId,
      key.source.workspaceId,
      key.source.siteId,
      key.transferId,
      proposal.destination.organizationId,
      proposal.destination.workspaceId,
      proposal.destination.siteId,
    ])
    if (existing.rows[0]) {
      const lock = mapLock(existing.rows[0])
      if (lock.transferId === key.transferId
        && lock.id === request.id
        && lock.acquiredByJobId === request.acquiredByJobId
        && lock.acquiredByRunId === request.acquiredByRunId
        && lock.requestId === request.requestId) return lock
      throw new TransferRepositoryError('lock-contended', 'Another transfer owns the site lock.')
    }

    const { rows: fenceRows } = await this.#db<{ fence: string | number }>`
      select coalesce(max(transfer_lock.fence), 0) + 1 as fence
      from fuma_site_transfer_locks as transfer_lock
      where transfer_lock.platform_id = ${key.source.platformId}
        and transfer_lock.organization_id = ${key.source.organizationId}
        and transfer_lock.workspace_id = ${key.source.workspaceId}
        and transfer_lock.site_id = ${key.source.siteId}
        and exists (
          select 1 from fuma_site_transfer_proposals as proposal
          where proposal.platform_id = ${key.source.platformId}
            and proposal.id = ${key.transferId}
            and proposal.source_organization_id = ${key.source.organizationId}
            and proposal.source_workspace_id = ${key.source.workspaceId}
            and proposal.source_site_id = ${key.source.siteId}
            and proposal.destination_organization_id = ${proposal.destination.organizationId}
            and proposal.destination_workspace_id = ${proposal.destination.workspaceId}
            and proposal.destination_site_id = ${proposal.destination.siteId}
        )
    `
    const fence = Number(fenceRows[0]?.fence)
    if (!Number.isSafeInteger(fence) || fence < 1) {
      throw new TransferRepositoryError('stored-state-invalid', 'Next transfer fence is invalid.')
    }
    const { rows } = await this.#db<LockRow>`
      insert into fuma_site_transfer_locks (
        platform_id, id, transfer_id, organization_id, workspace_id, site_id,
        fence, state, acquired_by_job_id, acquired_by_run_id, request_id,
        acquired_at, heartbeat_at, released_at, release_reason_code
      ) select
        ${key.source.platformId}, ${request.id}, ${key.transferId},
        ${key.source.organizationId}, ${key.source.workspaceId}, ${key.source.siteId},
        ${fence}, 'active', ${request.acquiredByJobId}, ${request.acquiredByRunId},
        ${request.requestId}, ${request.acquiredAt}, ${request.acquiredAt}, null, null
      where exists (
        select 1 from fuma_site_transfer_proposals
        where platform_id = ${key.source.platformId} and id = ${key.transferId}
          and source_organization_id = ${key.source.organizationId}
          and source_workspace_id = ${key.source.workspaceId}
          and source_site_id = ${key.source.siteId}
          and destination_organization_id = ${proposal.destination.organizationId}
          and destination_workspace_id = ${proposal.destination.workspaceId}
          and destination_site_id = ${proposal.destination.siteId}
      ) returning platform_id, id, transfer_id, organization_id, workspace_id,
        site_id, fence, state, acquired_by_job_id, acquired_by_run_id, request_id,
        acquired_at, heartbeat_at, released_at, release_reason_code
    `
    if (!rows[0]) throw new TransferRepositoryError('not-found', 'Transfer proposal does not exist.')
    return mapLock(rows[0])
  }

  async #insertStep(
    key: TransferRepositoryKey,
    proposal: TransferProposal,
    step: TransferStep,
  ): Promise<void> {
    assertTransferStep(step)
    assertKey(key, proposal)
    if (step.transferId !== proposal.id) {
      throw new TransferRepositoryError('conflict', 'Transfer step does not match proposal ownership.')
    }
    const receiptJson = step.receipt === null ? null : JSON.stringify(step.receipt)
    const errorJson = step.error === null ? null : JSON.stringify(step.error)
    const { rowCount } = await this.#db`
      insert into fuma_site_transfer_steps (
        platform_id, id, transfer_id, lock_id, fence, definition_id, sequence,
        attempt, kind, state, receipt_json, error_json, created_at, updated_at,
        started_at, finished_at
      ) select
        ${key.source.platformId}, ${step.id}, ${key.transferId}, ${step.lockId},
        ${step.fence}, ${step.definitionId}, ${step.sequence}, ${step.attempt},
        ${step.kind}, ${step.state}, ${receiptJson}, ${errorJson}, ${step.createdAt},
        ${step.updatedAt}, ${step.startedAt}, ${step.finishedAt}
      where exists (
        select 1 from fuma_site_transfer_proposals
        where platform_id = ${key.source.platformId} and id = ${key.transferId}
          and source_organization_id = ${key.source.organizationId}
          and source_workspace_id = ${key.source.workspaceId}
          and source_site_id = ${key.source.siteId}
          and destination_organization_id = ${proposal.destination.organizationId}
          and destination_workspace_id = ${proposal.destination.workspaceId}
          and destination_site_id = ${proposal.destination.siteId}
      ) and exists (
        select 1 from fuma_site_transfer_locks
        where platform_id = ${key.source.platformId}
          and transfer_id = ${key.transferId}
          and organization_id = ${key.source.organizationId}
          and workspace_id = ${key.source.workspaceId}
          and site_id = ${key.source.siteId}
          and id = ${step.lockId} and fence = ${step.fence}
      )
    `
    if (rowCount !== 1) throw new TransferRepositoryError('conflict', `Transfer step ${step.id} already exists.`)
  }

  async recordStart(
    key: TransferRepositoryKey,
    expectedVersion: string,
    proposal: TransferProposal,
    lock: TransferLock,
    steps: readonly TransferStep[],
  ): Promise<void> {
    assertKey(key, proposal)
    if (lock.transferId !== key.transferId
      || lock.state !== 'active'
      || !sameCoordinate(lock.scope, proposal.source)) {
      throw new TransferRepositoryError('stale-fence', 'Transfer lock is not active for this transfer.')
    }
    for (const step of steps) {
      if (step.lockId !== lock.id || step.fence !== lock.fence) {
        throw new TransferRepositoryError('stale-fence', 'Transfer step snapshot uses a stale lock fence.')
      }
      await this.#insertStep(key, proposal, step)
    }
    await this.#updateProposal(key, expectedVersion, proposal)
  }

  async recordStep(
    key: TransferRepositoryKey,
    expectedVersion: string,
    proposal: TransferProposal,
    step: TransferStep,
  ): Promise<void> {
    assertTransferStep(step)
    assertKey(key, proposal)
    if (step.transferId !== proposal.id) {
      throw new TransferRepositoryError('conflict', 'Transfer step does not match proposal ownership.')
    }
    const receiptJson = step.receipt === null ? null : JSON.stringify(step.receipt)
    const errorJson = step.error === null ? null : JSON.stringify(step.error)
    const { rowCount } = await this.#db`
      update fuma_site_transfer_steps as stored_step
      set state = ${step.state}, receipt_json = ${receiptJson}, error_json = ${errorJson},
        updated_at = ${step.updatedAt}, started_at = ${step.startedAt},
        finished_at = ${step.finishedAt}
      where stored_step.platform_id = ${key.source.platformId}
        and stored_step.transfer_id = ${key.transferId} and stored_step.id = ${step.id}
        and stored_step.lock_id = ${step.lockId} and stored_step.fence = ${step.fence}
        and stored_step.definition_id = ${step.definitionId}
        and stored_step.kind = ${step.kind} and stored_step.sequence = ${step.sequence}
        and stored_step.attempt = ${step.attempt}
        and exists (
          select 1 from fuma_site_transfer_proposals as proposal
          where proposal.platform_id = ${key.source.platformId}
            and proposal.id = ${key.transferId}
            and proposal.source_organization_id = ${key.source.organizationId}
            and proposal.source_workspace_id = ${key.source.workspaceId}
            and proposal.source_site_id = ${key.source.siteId}
            and proposal.destination_organization_id = ${proposal.destination.organizationId}
            and proposal.destination_workspace_id = ${proposal.destination.workspaceId}
            and proposal.destination_site_id = ${proposal.destination.siteId}
        )
        and exists (
          select 1 from fuma_site_transfer_locks as transfer_lock
          where transfer_lock.platform_id = ${key.source.platformId}
            and transfer_lock.transfer_id = ${key.transferId}
            and transfer_lock.organization_id = ${key.source.organizationId}
            and transfer_lock.workspace_id = ${key.source.workspaceId}
            and transfer_lock.site_id = ${key.source.siteId}
            and transfer_lock.id = stored_step.lock_id
            and transfer_lock.fence = stored_step.fence
        )
    `
    if (rowCount === 0) await this.#insertStep(key, proposal, step)
    await this.#updateProposal(key, expectedVersion, proposal)
  }

  recordCancellation(key: TransferRepositoryKey, expectedVersion: string, proposal: TransferProposal): Promise<void> {
    return this.#updateProposal(key, expectedVersion, proposal)
  }

  recordResume(key: TransferRepositoryKey, expectedVersion: string, proposal: TransferProposal): Promise<void> {
    return this.#updateProposal(key, expectedVersion, proposal)
  }

  async recordFailure(
    key: TransferRepositoryKey,
    expectedVersion: string,
    proposal: TransferProposal,
    step?: TransferStep,
  ): Promise<void> {
    if (step) await this.recordStep(key, expectedVersion, proposal, step)
    else await this.#updateProposal(key, expectedVersion, proposal)
  }

  recordCompensation(
    key: TransferRepositoryKey,
    expectedVersion: string,
    proposal: TransferProposal,
    step: TransferStep,
  ): Promise<void> {
    return this.recordStep(key, expectedVersion, proposal, step)
  }

  recordCompletion(key: TransferRepositoryKey, expectedVersion: string, proposal: TransferProposal): Promise<void> {
    return this.#updateProposal(key, expectedVersion, proposal)
  }

  async releaseLock(
    key: TransferRepositoryKey,
    proposal: TransferProposal,
    lockId: string,
    fence: number,
    releasedAt: string,
    reasonCode: string,
  ): Promise<TransferLock> {
    assertTransferProposal(proposal)
    assertKey(key, proposal)
    const { rows } = await this.#db<LockRow>`
      update fuma_site_transfer_locks as transfer_lock
      set state = 'released', released_at = ${releasedAt},
        release_reason_code = ${reasonCode}, heartbeat_at = ${releasedAt}
      where transfer_lock.platform_id = ${key.source.platformId}
        and transfer_lock.id = ${lockId} and transfer_lock.transfer_id = ${key.transferId}
        and transfer_lock.organization_id = ${key.source.organizationId}
        and transfer_lock.workspace_id = ${key.source.workspaceId}
        and transfer_lock.site_id = ${key.source.siteId}
        and transfer_lock.fence = ${fence} and transfer_lock.state = 'active'
        and exists (
          select 1 from fuma_site_transfer_proposals as proposal
          where proposal.platform_id = ${key.source.platformId}
            and proposal.id = ${key.transferId}
            and proposal.source_organization_id = ${key.source.organizationId}
            and proposal.source_workspace_id = ${key.source.workspaceId}
            and proposal.source_site_id = ${key.source.siteId}
            and proposal.destination_organization_id = ${proposal.destination.organizationId}
            and proposal.destination_workspace_id = ${proposal.destination.workspaceId}
            and proposal.destination_site_id = ${proposal.destination.siteId}
        )
      returning platform_id, id, transfer_id, organization_id, workspace_id,
        site_id, fence, state, acquired_by_job_id, acquired_by_run_id, request_id,
        acquired_at, heartbeat_at, released_at, release_reason_code
    `
    if (!rows[0]) throw new TransferRepositoryError('stale-fence', 'Transfer lock fence is stale.')
    return mapLock(rows[0])
  }
}

export class PostgresTransferRepository implements TransferRepository {
  readonly #db: DbClient

  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') {
      throw new Error('Fuma site transfers require PostgreSQL authority.')
    }
    this.#db = db
  }

  read(key: TransferRepositoryKey): Promise<TransferAggregate | null> {
    return this.#db.transaction(async (db) => (
      await new PostgresTransferTransaction(db).read(key)
    ))
  }

  transaction<T>(
    key: TransferRepositoryKey,
    work: (transaction: TransferRepositoryTransaction) => Promise<T>,
  ): Promise<T> {
    void key
    return this.#db.transaction(async (db) => (
      await work(new PostgresTransferTransaction(db))
    ))
  }
}

export function transferFailure(error: unknown): TransferFailure {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    const candidate = error as { code: unknown; message: unknown }
    return {
      code: typeof candidate.code === 'string' && candidate.code ? candidate.code : 'transfer-step-failed',
      message: typeof candidate.message === 'string' && candidate.message
        ? candidate.message.slice(0, 2_048)
        : 'Transfer step failed.',
      retryable: true,
      details: {},
    }
  }
  return {
    code: 'transfer-step-failed',
    message: error instanceof Error && error.message
      ? error.message.slice(0, 2_048)
      : 'Transfer step failed.',
    retryable: true,
    details: {},
  }
}

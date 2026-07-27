import {
  safeParseValue,
} from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import {
  EditorSiteDocumentSchema,
  type EditorSiteDocument,
} from '../editor/contracts'
import type { FumaRepositoryScope } from '../tenancy'
import {
  PublishWorkerError,
  type ClaimedSnapshot,
  type PublishAttemptAuthority,
  type PublishAuthority,
  type PublishClaim,
  type PublishProgressEvent,
  type PublishSnapshotAuthority,
} from './workerPublisher'

interface SnapshotRow {
  accepted_sequence: string | number | bigint
  document_json: unknown
}

interface AttemptRow {
  attempt_id: string
  platform_id: string
  owner_key: string
  organization_id: string
  workspace_id: string
  site_id: string
  release_id: string
  snapshot_id: string
  snapshot_hash: string
  job_id: string
  fence: string | number | bigint
  audit_correlation_id: string
  stage: string
  completed: string | number | bigint
  total: string | number | bigint | null
}

const STAGE_RANK: Readonly<Record<PublishProgressEvent['stage'], number>> = Object.freeze({
  claimed: 0,
  rendering: 1,
  uploaded: 2,
  finalized: 3,
  activated: 4,
  cancelled: 5,
})

export function canonicalPublishJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) throw new TypeError('Publish snapshot is not canonical JSON.')
    return encoded
  }
  if (Array.isArray(value)) return `[${value.map(canonicalPublishJson).join(',')}]`
  const record = value as Readonly<Record<string, unknown>>
  return `{${Object.keys(record).sort().map((name) => (
    `${JSON.stringify(name)}:${canonicalPublishJson(record[name])}`
  )).join(',')}}`
}

export function publishSnapshotHash(document: EditorSiteDocument): string {
  return new Bun.CryptoHasher('sha256').update(canonicalPublishJson(document)).digest('hex')
}

function positiveInteger(value: string | number | bigint, label: string): number {
  const numeric = Number(value)
  if (!Number.isSafeInteger(numeric) || numeric < 1 || String(numeric) !== String(value)) {
    throw new PublishWorkerError('untrusted-result', `${label} is invalid.`)
  }
  return numeric
}

function attemptDigest(input: Omit<PublishClaim, 'attemptId'>): string {
  const coordinates = [
    input.scope.platformId,
    input.scope.organizationId,
    input.scope.workspaceId,
    input.scope.siteId,
    input.scope.ownerKey,
    String(input.scope.generation),
    input.profileId,
    input.releaseId,
    input.sourceSnapshotId,
    input.sourceSnapshotHashSha256,
    input.jobId,
    input.fence,
    input.auditCorrelationId,
  ]
  return new Bun.CryptoHasher('sha256').update(JSON.stringify(coordinates)).digest('hex')
}

function rowMatchesCoordinates(row: AttemptRow, claim: PublishClaim): boolean {
  return row.platform_id === claim.scope.platformId
    && row.owner_key === claim.scope.ownerKey
    && row.organization_id === claim.scope.organizationId
    && row.workspace_id === claim.scope.workspaceId
    && row.site_id === claim.scope.siteId
    && row.release_id === claim.releaseId
    && row.snapshot_id === claim.sourceSnapshotId
    && row.snapshot_hash === claim.sourceSnapshotHashSha256
    && row.job_id === claim.jobId
    && row.audit_correlation_id === claim.auditCorrelationId
}

function rowMatchesPersistedClaim(row: AttemptRow, claim: PublishClaim): boolean {
  return rowMatchesCoordinates(row, claim)
    && row.attempt_id === claim.attemptId
    && String(row.fence) === claim.fence
}

async function assertCurrentAuthority(db: DbClient, scope: FumaRepositoryScope): Promise<void> {
  const { rows } = await db<{ authorized: number }>`
    select 1 as authorized
    from fuma_tenant_owner_keys
    where platform_id = ${scope.platformId}
      and owner_key = ${scope.ownerKey}
      and organization_id = ${scope.organizationId}
      and workspace_id = ${scope.workspaceId}
      and site_id = ${scope.siteId}
      and generation = ${scope.generation}
      and state = 'active'
      and transfer_id is null
      and transfer_lock_id is null
      and transfer_fence is null
    for share
  `
  if (rows.length !== 1) {
    throw new PublishWorkerError('invalid-authority', 'Current publish owner generation denied.')
  }
}

async function assertRunningJobClaim(db: DbClient, claim: PublishClaim): Promise<void> {
  const { rows } = await db<{ authorized: number }>`
    select 1 as authorized
    from fuma_jobs
    where id = ${claim.jobId}
      and organization_id = ${claim.scope.organizationId}
      and site_id = ${claim.scope.siteId}
      and kind = 'fuma.publish-release'
      and status = 'running'
      and fence = ${claim.fence}
    for share
  `
  if (rows.length !== 1) {
    throw new PublishWorkerError('claim-mismatch', 'Current durable publish job fence denied.')
  }
}

function persistedClaim(row: AttemptRow, requested: PublishClaim): PublishClaim {
  const claim: PublishClaim = Object.freeze({
    ...requested,
    attemptId: row.attempt_id,
    fence: String(row.fence),
  })
  const expectedAttemptId = `publish-attempt-${attemptDigest({
    releaseId: claim.releaseId,
    sourceSnapshotId: claim.sourceSnapshotId,
    sourceSnapshotHashSha256: claim.sourceSnapshotHashSha256,
    auditCorrelationId: claim.auditCorrelationId,
    profileId: claim.profileId,
    scope: claim.scope,
    jobId: claim.jobId,
    fence: claim.fence,
  })}`
  let monotonic: boolean
  try {
    monotonic = BigInt(claim.fence) <= BigInt(requested.fence)
  } catch {
    monotonic = false
  }
  if (!rowMatchesCoordinates(row, requested)
    || claim.attemptId !== expectedAttemptId
    || !monotonic) {
    throw new PublishWorkerError('claim-mismatch', 'Stored immutable publish claim does not match this retry.')
  }
  return claim
}

/** Exact immutable editor-mutation source authority for the production worker. */
export class PostgresPublishSnapshotAuthority implements PublishSnapshotAuthority {
  readonly #db: DbClient

  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new TypeError('Hosted publish snapshots require PostgreSQL.')
    this.#db = db
  }

  async claimExact(
    authority: PublishAuthority,
    snapshotId: string,
    expectedHashSha256: string,
  ): Promise<ClaimedSnapshot> {
    return await this.#db.transaction(async (db) => {
      await assertCurrentAuthority(db, authority.scope)
      const { rows } = await db<SnapshotRow>`
        select mutation.accepted_sequence, mutation.document_json
        from fuma_editor_draft_mutations mutation
        where mutation.platform_id = ${authority.scope.platformId}
          and mutation.owner_key = ${authority.scope.ownerKey}
          and mutation.owner_generation = ${authority.scope.generation}
          and mutation.profile_id = ${authority.profileId}
          and mutation.resource_kind = 'site-document'
          and mutation.logical_id = ${authority.scope.siteId}
          and mutation.mutation_id = ${snapshotId}
      `
      if (rows.length !== 1) {
        throw new PublishWorkerError('snapshot-drift', 'Exact immutable publish snapshot was not found.')
      }
      const parsed = safeParseValue(EditorSiteDocumentSchema, rows[0]!.document_json)
      if (!parsed.ok || parsed.value.site.id !== authority.scope.siteId) {
        throw new PublishWorkerError('snapshot-drift', 'Stored publish snapshot failed semantic validation.')
      }
      const hashSha256 = publishSnapshotHash(parsed.value)
      if (hashSha256 !== expectedHashSha256) {
        throw new PublishWorkerError('snapshot-drift', 'Stored publish snapshot hash changed.')
      }
      return Object.freeze({
        id: snapshotId,
        hashSha256,
        immutableRevision: String(positiveInteger(
          rows[0]!.accepted_sequence,
          'Publish snapshot revision',
        )),
        document: Object.freeze(structuredClone(parsed.value)),
      })
    })
  }
}

/** PostgreSQL authority for one exact release/source/owner/generation/job/fence claim. */
export class PostgresPublishAttemptAuthority implements PublishAttemptAuthority {
  readonly #db: DbClient
  readonly #now: () => Date

  constructor(db: DbClient, now: () => Date = () => new Date()) {
    if (db.dialect !== 'postgres') throw new TypeError('Hosted publish attempts require PostgreSQL.')
    this.#db = db
    this.#now = now
  }

  exactAttemptId(input: Omit<PublishClaim, 'attemptId'>): string {
    return `publish-attempt-${attemptDigest(input)}`
  }

  async claimExact(claim: PublishClaim): Promise<PublishClaim> {
    if (claim.attemptId !== this.exactAttemptId(claim)) {
      throw new PublishWorkerError('claim-mismatch', 'Publish attempt identity is not canonical.')
    }
    return await this.#db.transaction(async (db) => {
      await db`select pg_advisory_xact_lock(hashtextextended(${'fuma-publish:' + claim.scope.platformId + ':' + claim.scope.ownerKey + ':' + claim.releaseId}, 0))`
      await assertCurrentAuthority(db, claim.scope)
      await assertRunningJobClaim(db, claim)
      const existing = await this.#read(db, claim, true)
      if (existing !== null) return persistedClaim(existing, claim)
      const time = this.#now().toISOString()
      const { rowCount } = await db`
        insert into fuma_publish_attempts (
          attempt_id, platform_id, owner_key, organization_id, workspace_id,
          site_id, release_id, snapshot_id, snapshot_hash, job_id, fence,
          audit_correlation_id, stage, completed, total, created_at, updated_at
        ) values (
          ${claim.attemptId}, ${claim.scope.platformId}, ${claim.scope.ownerKey},
          ${claim.scope.organizationId}, ${claim.scope.workspaceId},
          ${claim.scope.siteId}, ${claim.releaseId}, ${claim.sourceSnapshotId},
          ${claim.sourceSnapshotHashSha256}, ${claim.jobId}, ${claim.fence},
          ${claim.auditCorrelationId}, 'claimed', 0, null, ${time}, ${time}
        ) on conflict do nothing
      `
      if (rowCount === 1) return claim
      const raced = await this.#read(db, claim, true)
      if (raced === null) {
        throw new PublishWorkerError('claim-mismatch', 'Publish claim lost an exact-coordinate race.')
      }
      return persistedClaim(raced, claim)
    })
  }

  async record(claim: PublishClaim, event: PublishProgressEvent): Promise<void> {
    if (!Number.isSafeInteger(event.completed) || event.completed < 0
      || (event.total !== null && (!Number.isSafeInteger(event.total) || event.total < event.completed))) {
      throw new PublishWorkerError('untrusted-result', 'Publish progress is invalid.')
    }
    await this.#db.transaction(async (db) => {
      await assertCurrentAuthority(db, claim.scope)
      const current = await this.#read(db, claim, true)
      if (current === null || !rowMatchesPersistedClaim(current, claim)) {
        throw new PublishWorkerError('claim-mismatch', 'Publish progress claim no longer matches.')
      }
      const currentStage = current.stage as PublishProgressEvent['stage']
      if (!(currentStage in STAGE_RANK)) {
        throw new PublishWorkerError('untrusted-result', 'Stored publish progress stage is invalid.')
      }
      if (currentStage === 'cancelled') {
        if (event.stage !== 'cancelled') {
          throw new PublishWorkerError('claim-mismatch', 'Cancelled publish progress is terminal.')
        }
        return
      }
      if (STAGE_RANK[event.stage] < STAGE_RANK[currentStage]) return
      const completed = Math.max(Number(current.completed), event.completed)
      const total = event.total ?? (current.total === null ? null : Number(current.total))
      const { rowCount } = await db`
        update fuma_publish_attempts set
          stage = ${event.stage}, completed = ${completed}, total = ${total},
          updated_at = ${this.#now().toISOString()}
        where attempt_id = ${claim.attemptId}
          and platform_id = ${claim.scope.platformId}
          and owner_key = ${claim.scope.ownerKey}
          and organization_id = ${claim.scope.organizationId}
          and workspace_id = ${claim.scope.workspaceId}
          and site_id = ${claim.scope.siteId}
          and release_id = ${claim.releaseId}
          and snapshot_id = ${claim.sourceSnapshotId}
          and snapshot_hash = ${claim.sourceSnapshotHashSha256}
          and job_id = ${claim.jobId}
          and fence = ${claim.fence}
          and audit_correlation_id = ${claim.auditCorrelationId}
      `
      if (rowCount !== 1) {
        throw new PublishWorkerError('claim-mismatch', 'Publish progress update lost exact authority.')
      }
    })
  }

  async #read(db: DbClient, claim: PublishClaim, lock: boolean): Promise<AttemptRow | null> {
    const suffix = lock ? ' for update' : ''
    const { rows } = await db.unsafe<AttemptRow>(`
      select attempt_id, platform_id, owner_key, organization_id, workspace_id,
        site_id, release_id, snapshot_id, snapshot_hash, job_id, fence,
        audit_correlation_id, stage, completed, total
      from fuma_publish_attempts
      where platform_id = $1 and owner_key = $2 and release_id = $3${suffix}
    `, [claim.scope.platformId, claim.scope.ownerKey, claim.releaseId])
    return rows[0] ?? null
  }
}

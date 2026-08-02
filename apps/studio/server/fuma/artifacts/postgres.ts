import type { DbClient } from '../../db/client'
import {
  ArtifactInstallationSchema,
  ArtifactReleaseSchema,
  ArtifactScheduleSchema,
  ArtifactTransferReceiptSchema,
  ArtifactAuthorityError,
  parseArtifactContract,
  type ArtifactCrash,
  type ArtifactInstallation,
  type ArtifactRelease,
  type ArtifactSchedule,
  type ArtifactStorageUsage,
  type ArtifactTransferReceipt,
} from './contracts'
import type { ArtifactAuthorityRepository } from './service'

function json(value: unknown): string { return JSON.stringify(value) }
function value(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try { return JSON.parse(raw) as unknown } catch { return null }
}
function parsed<T>(schema: Parameters<typeof parseArtifactContract>[0], raw: unknown, label: string): T | null {
  try { return parseArtifactContract(schema, value(raw), label) as T } catch { return null }
}
interface JsonRow { value_json: unknown }

function canonical(raw: unknown): string {
  if (raw === null || typeof raw !== 'object') return JSON.stringify(raw)
  if (Array.isArray(raw)) return `[${raw.map(canonical).join(',')}]`
  return `{${Object.entries(raw as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
}
class ArtifactRepositoryRollback extends Error {}

export class PostgresArtifactAuthorityRepository implements ArtifactAuthorityRepository {
  readonly #db: DbClient

  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new TypeError('Hosted artifact installations require PostgreSQL authority.')
    this.#db = db
  }

  async readArtifact(artifactId: string): Promise<ArtifactRelease | null> {
    const result = await this.#db<JsonRow>`select artifact_json as value_json from fuma_artifact_releases_v2 where artifact_id=${artifactId}`
    return result.rows[0] ? parsed<ArtifactRelease>(ArtifactReleaseSchema, result.rows[0].value_json, 'stored artifact') : null
  }

  async insertArtifact(artifact: ArtifactRelease): Promise<boolean> {
    const result = await this.#db`
      insert into fuma_artifact_releases_v2 (
        artifact_id,artifact_kind,package_id,exact_version,execution_policy,object_key,mime_type,
        content_hash_sha256,size_bytes,permissions_json,provenance_json,artifact_json,created_at
      ) values (
        ${artifact.artifactId},${artifact.kind},${artifact.packageId},${artifact.exactVersion},${artifact.executionPolicy},${artifact.objectKey},${artifact.mimeType},
        ${artifact.contentHashSha256},${artifact.sizeBytes},${json(artifact.permissions)}::text::jsonb,${json(artifact.provenance)}::text::jsonb,${json(artifact)}::text::jsonb,${artifact.createdAt}
      ) on conflict do nothing
    `
    return result.rowCount === 1
  }

  async readInstallation(scope: Pick<ArtifactInstallation, 'platformId' | 'ownerKey' | 'installationId'>): Promise<ArtifactInstallation | null> {
    const result = await this.#db<JsonRow>`
      select installation.installation_json as value_json
      from fuma_artifact_installations_v2 installation
      join fuma_tenant_owner_keys owner
        on owner.platform_id=installation.platform_id and owner.organization_id=installation.organization_id
       and owner.workspace_id=installation.workspace_id and owner.site_id=installation.site_id
       and owner.owner_key=installation.owner_key and owner.generation=installation.owner_generation
      where installation.platform_id=${scope.platformId} and installation.owner_key=${scope.ownerKey}
        and installation.installation_id=${scope.installationId}
        and owner.state='active' and owner.transfer_id is null and owner.transfer_lock_id is null and owner.transfer_fence is null
    `
    return result.rows[0] ? parsed<ArtifactInstallation>(ArtifactInstallationSchema, result.rows[0].value_json, 'stored installation') : null
  }

  async insertInstallation(installation: ArtifactInstallation): Promise<boolean> {
    return await this.#db.transaction(async (db) => {
      const owner = await db<{ ok: number }>`
        select 1 as ok from fuma_tenant_owner_keys where platform_id=${installation.platformId}
          and organization_id=${installation.organizationId} and workspace_id=${installation.workspaceId}
          and site_id=${installation.siteId} and owner_key=${installation.ownerKey} and generation=${installation.ownerGeneration}
          and state='active' and transfer_id is null and transfer_lock_id is null and transfer_fence is null for share
      `
      if (owner.rows.length !== 1) return false
      const result = await db`
        insert into fuma_artifact_installations_v2 (
          platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,installation_id,
          artifact_id,artifact_kind,package_id,exact_version,content_hash_sha256,execution_policy,
          settings_object_key,secret_json,state,worker_generation,storage_quota_bytes,schedule_quota,calls_per_minute,
          previous_artifact_id,version,installation_json,installed_at,updated_at
        ) values (
          ${installation.platformId},${installation.organizationId},${installation.workspaceId},${installation.siteId},${installation.ownerKey},${installation.ownerGeneration},${installation.installationId},
          ${installation.artifactId},${installation.artifactKind},${installation.packageId},${installation.exactVersion},${installation.contentHashSha256},${installation.executionPolicy},
          ${installation.settingsObjectKey},${installation.secret ? json(installation.secret) : null}::text::jsonb,${installation.state},${installation.workerGeneration},${installation.quota.storageBytes},${installation.quota.scheduledJobs},${installation.quota.callsPerMinute},
          ${installation.previousArtifactId},${installation.version},${json(installation)}::text::jsonb,${installation.installedAt},${installation.updatedAt}
        ) on conflict do nothing
      `
      return result.rowCount === 1
    })
  }

  async replaceInstallation(current: ArtifactInstallation, next: ArtifactInstallation): Promise<boolean> {
    const result = await this.#db`
      update fuma_artifact_installations_v2 set
        artifact_id=${next.artifactId}, exact_version=${next.exactVersion}, content_hash_sha256=${next.contentHashSha256}, execution_policy=${next.executionPolicy},
        state=${next.state}, worker_generation=${next.workerGeneration}, previous_artifact_id=${next.previousArtifactId}, version=${next.version},
        installation_json=${json(next)}::text::jsonb, updated_at=${next.updatedAt}
      where platform_id=${current.platformId} and owner_key=${current.ownerKey} and installation_id=${current.installationId}
        and owner_generation=${current.ownerGeneration} and artifact_id=${current.artifactId} and version=${current.version}
    `
    return result.rowCount === 1
  }

  async transferInstallation(current: ArtifactInstallation, next: ArtifactInstallation, receipt: ArtifactTransferReceipt): Promise<boolean> {
    try {
      return await this.#db.transaction(async (db) => {
        await db`select pg_advisory_xact_lock(hashtextextended(${'fuma-artifact-transfer:' + receipt.transferId + ':' + current.installationId}::text,0))`
        const replay = await db<JsonRow>`select receipt_json as value_json from fuma_artifact_transfer_receipts_v2 where transfer_id=${receipt.transferId} and installation_id=${receipt.installationId}`
        if (replay.rows[0]) {
          const stored = parsed<ArtifactTransferReceipt>(ArtifactTransferReceiptSchema, replay.rows[0].value_json, 'stored transfer receipt')
          return stored !== null && canonical(stored) === canonical(receipt)
        }
        const destination = await db<{ ok: number }>`
          select 1 as ok from fuma_tenant_owner_keys where platform_id=${current.platformId}
            and organization_id=${next.organizationId} and workspace_id=${next.workspaceId} and site_id=${next.siteId}
            and owner_key=${next.ownerKey} and generation=${next.ownerGeneration} and state='active'
            and transfer_id is null and transfer_lock_id is null and transfer_fence is null for share
        `
        if (destination.rows.length !== 1) return false
        const updated = await db`
          update fuma_artifact_installations_v2 set organization_id=${next.organizationId},workspace_id=${next.workspaceId},site_id=${next.siteId},
            owner_key=${next.ownerKey},owner_generation=${next.ownerGeneration},secret_json=${next.secret ? json(next.secret) : null}::text::jsonb,
            state=${next.state},worker_generation=${next.workerGeneration},version=${next.version},installation_json=${json(next)}::text::jsonb,updated_at=${next.updatedAt}
          where platform_id=${current.platformId} and owner_key=${current.ownerKey} and installation_id=${current.installationId}
            and owner_generation=${current.ownerGeneration} and artifact_id=${current.artifactId} and version=${current.version}
        `
        if (updated.rowCount !== 1) return false
        const nextScope = json({ organizationId: next.organizationId, workspaceId: next.workspaceId, siteId: next.siteId, ownerKey: next.ownerKey, ownerGeneration: next.ownerGeneration })
        await db`
          update fuma_artifact_schedules_v2 set schedule_json=schedule_json || ${nextScope}::text::jsonb
          where platform_id=${next.platformId} and owner_key=${next.ownerKey} and owner_generation=${next.ownerGeneration} and installation_id=${next.installationId}
        `
        await db`
          update fuma_artifact_storage_usage_v2 set usage_json=usage_json || ${nextScope}::text::jsonb
          where platform_id=${next.platformId} and owner_key=${next.ownerKey} and owner_generation=${next.ownerGeneration} and installation_id=${next.installationId}
        `
        const inserted = await db`insert into fuma_artifact_transfer_receipts_v2 (transfer_id,installation_id,artifact_id,source_owner_key,source_owner_generation,destination_owner_key,destination_owner_generation,receipt_json,transferred_at) values (${receipt.transferId},${receipt.installationId},${receipt.artifactId},${receipt.sourceOwnerKey},${receipt.sourceOwnerGeneration},${receipt.destinationOwnerKey},${receipt.destinationOwnerGeneration},${json(receipt)}::text::jsonb,${receipt.transferredAt}) on conflict do nothing`
        if (inserted.rowCount !== 1) throw new ArtifactRepositoryRollback('Artifact transfer receipt fence changed.')
        return true
      })
    } catch (error) {
      if (error instanceof ArtifactRepositoryRollback) return false
      throw error
    }
  }

  async countSchedules(installation: ArtifactInstallation): Promise<number> {
    const result = await this.#db<{ count: string | number | bigint }>`select count(*) as count from fuma_artifact_schedules_v2 where platform_id=${installation.platformId} and owner_key=${installation.ownerKey} and owner_generation=${installation.ownerGeneration} and installation_id=${installation.installationId}`
    return Number(result.rows[0]?.count ?? 0)
  }

  async putScheduleIfAbsent(schedule: ArtifactSchedule): Promise<boolean> {
    return await this.#db.transaction(async (db) => {
      const installation = await db<{ schedule_quota: string | number | bigint }>`
        select schedule_quota from fuma_artifact_installations_v2
        where platform_id=${schedule.platformId} and owner_key=${schedule.ownerKey} and owner_generation=${schedule.ownerGeneration}
          and installation_id=${schedule.installationId} and artifact_kind='plugin' and execution_policy='plugin-sandbox-worker' and state='active'
        for update
      `
      if (!installation.rows[0]) throw new ArtifactAuthorityError('scope-denied', 'Plugin schedule installation scope changed.')
      const existing = await db<JsonRow>`select schedule_json as value_json from fuma_artifact_schedules_v2 where platform_id=${schedule.platformId} and owner_key=${schedule.ownerKey} and owner_generation=${schedule.ownerGeneration} and installation_id=${schedule.installationId} and schedule_id=${schedule.scheduleId}`
      if (existing.rows[0]) {
        const stored = parsed<ArtifactSchedule>(ArtifactScheduleSchema, existing.rows[0].value_json, 'stored artifact schedule')
        if (stored === null || canonical(stored) !== canonical(schedule)) throw new ArtifactAuthorityError('conflict', 'Artifact schedule idempotency identity changed.')
        return false
      }
      const count = await db<{ count: string | number | bigint }>`select count(*) as count from fuma_artifact_schedules_v2 where platform_id=${schedule.platformId} and owner_key=${schedule.ownerKey} and owner_generation=${schedule.ownerGeneration} and installation_id=${schedule.installationId}`
      if (Number(count.rows[0]?.count ?? 0) >= Number(installation.rows[0].schedule_quota)) throw new ArtifactAuthorityError('quota-exceeded', 'Plugin schedule quota is exhausted.')
      const result = await db`insert into fuma_artifact_schedules_v2 (platform_id,owner_key,owner_generation,installation_id,schedule_id,cron_expression,handler_name,enabled,next_run_at,schedule_json) values (${schedule.platformId},${schedule.ownerKey},${schedule.ownerGeneration},${schedule.installationId},${schedule.scheduleId},${schedule.cronExpression},${schedule.handlerName},${schedule.enabled},${schedule.nextRunAt},${json(schedule)}::text::jsonb) on conflict do nothing`
      if (result.rowCount !== 1) throw new ArtifactAuthorityError('conflict', 'Artifact schedule insertion fence changed.')
      return true
    })
  }

  async putStorageUsage(installation: ArtifactInstallation, usage: ArtifactStorageUsage): Promise<boolean> {
    const result = await this.#db`
      insert into fuma_artifact_storage_usage_v2 (platform_id,owner_key,owner_generation,installation_id,object_count,bytes_used,version,usage_json)
      values (${usage.platformId},${usage.ownerKey},${usage.ownerGeneration},${usage.installationId},${usage.objectCount},${usage.bytesUsed},${usage.version},${json(usage)}::text::jsonb)
      on conflict (platform_id,owner_key,installation_id) do update set object_count=excluded.object_count,bytes_used=excluded.bytes_used,version=excluded.version,usage_json=excluded.usage_json
      where fuma_artifact_storage_usage_v2.owner_generation=excluded.owner_generation
        and fuma_artifact_storage_usage_v2.version+1=excluded.version and excluded.bytes_used<=${installation.quota.storageBytes}
    `
    return result.rowCount === 1
  }

  async recordCrashAndContain(installation: ArtifactInstallation, crash: ArtifactCrash, next: ArtifactInstallation): Promise<boolean> {
    try {
      return await this.#db.transaction(async (db) => {
        const inserted = await db`insert into fuma_artifact_crashes_v2 (platform_id,owner_key,owner_generation,installation_id,crash_id,worker_generation,error_code,evidence_hash_sha256,crash_json,occurred_at) values (${crash.platformId},${crash.ownerKey},${crash.ownerGeneration},${crash.installationId},${crash.crashId},${crash.workerGeneration},${crash.errorCode},${crash.evidenceHashSha256},${json(crash)}::text::jsonb,${crash.occurredAt}) on conflict do nothing`
        if (inserted.rowCount !== 1) return false
        const updated = await db`update fuma_artifact_installations_v2 set state='crashed',version=${next.version},installation_json=${json(next)}::text::jsonb,updated_at=${next.updatedAt} where platform_id=${installation.platformId} and owner_key=${installation.ownerKey} and installation_id=${installation.installationId} and owner_generation=${installation.ownerGeneration} and worker_generation=${installation.workerGeneration} and state='active' and version=${installation.version}`
        if (updated.rowCount !== 1) throw new ArtifactRepositoryRollback('Artifact crash containment fence changed.')
        return true
      })
    } catch (error) {
      if (error instanceof ArtifactRepositoryRollback) return false
      throw error
    }
  }

  async consumeCalls(installation: ArtifactInstallation, windowStartedAt: string, units: number): Promise<boolean> {
    if (units > installation.quota.callsPerMinute) return false
    const result = await this.#db`
      insert into fuma_artifact_call_windows_v2 (platform_id,owner_key,owner_generation,installation_id,window_started_at,units)
      values (${installation.platformId},${installation.ownerKey},${installation.ownerGeneration},${installation.installationId},${windowStartedAt},${units})
      on conflict (platform_id,owner_key,installation_id,window_started_at) do update set units=fuma_artifact_call_windows_v2.units+excluded.units
      where fuma_artifact_call_windows_v2.owner_generation=excluded.owner_generation
        and fuma_artifact_call_windows_v2.units+excluded.units<=${installation.quota.callsPerMinute}
    `
    return result.rowCount === 1
  }
}

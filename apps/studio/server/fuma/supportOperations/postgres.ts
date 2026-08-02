import type { TSchema } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import {
  BreakGlassApprovalRecordSchema, BreakGlassExecutionRecordSchema, BreakGlassRequestRecordSchema,
  ModerationEvidenceRecordSchema, SupportActionRecordSchema, SupportOperationEffectRecordSchema,
  SupportSessionEndRecordSchema, SupportSessionRecordSchema, SupportOperationsError, parseSupportContract,
  type BreakGlassApprovalRecord, type BreakGlassExecutionRecord, type BreakGlassRequestRecord,
  type ModerationEvidenceRecord, type ModerationQueue, type SupportActionRecord,
  type SupportOperationEffectRecord, type SupportSessionEndRecord, type SupportSessionRecord,
  type SupportTenantScope,
} from './contracts'
import type { SupportOperationsRepository } from './service'

interface JsonRow { record_json: unknown }
function json(value: unknown): string { return JSON.stringify(value) }
function raw(value: unknown): unknown { if (typeof value !== 'string') return value; try { return JSON.parse(value) as unknown } catch { throw new SupportOperationsError('evidence-denied', 'Stored support evidence is not valid JSON.') } }
function parse<T>(schema: TSchema, value: unknown, label: string): T { return parseSupportContract(schema, raw(value), label) as T }
function queueEvent(queue: ModerationQueue): ModerationEvidenceRecord['event'] { return queue === 'moderation' ? 'opened' : queue === 'suspension' ? 'suspended' : 'appealed' }
function moderationTransition(previous: ModerationEvidenceRecord | null, record: ModerationEvidenceRecord): boolean {
  if (!previous || previous.event === 'resolved') return record.event === 'opened' && record.priorEvidenceId === null
  if (record.caseId !== previous.caseId || record.priorEvidenceId !== previous.evidenceId) return false
  if (previous.event === 'opened') return record.event === 'suspended' || record.event === 'resolved'
  if (previous.event === 'suspended') return record.event === 'appealed' || record.event === 'resolved'
  return previous.event === 'appealed' && (record.event === 'suspended' || record.event === 'resolved')
}

export class PostgresSupportOperationsRepository implements SupportOperationsRepository {
  readonly #db: DbClient
  constructor(db: DbClient) { if (db.dialect !== 'postgres') throw new TypeError('Hosted support operations require PostgreSQL.'); this.#db = db }

  async insertSupportSession(record: SupportSessionRecord): Promise<boolean> {
    return await this.#db.transaction(async (tx) => {
      const lock = json(['support-session', record.scope.platformId, record.scope.organizationId, record.scope.workspaceId, record.scope.siteId, record.staffActorId])
      await tx`select pg_advisory_xact_lock(hashtextextended(${lock},0))`
      const active = await tx`select 1 from fuma_support_sessions_v2 session where session.platform_id=${record.scope.platformId} and session.organization_id=${record.scope.organizationId} and session.workspace_id=${record.scope.workspaceId} and session.site_id=${record.scope.siteId} and session.owner_key=${record.scope.ownerKey} and session.owner_generation=${record.scope.ownerGeneration} and session.staff_actor_id=${record.staffActorId} and session.expires_at>${record.startedAt} and not exists(select 1 from fuma_support_session_ends_v2 ended where ended.support_session_id=session.support_session_id) limit 1`
      if (active.rowCount > 0) return false
      const result = await tx`insert into fuma_support_sessions_v2 (support_session_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,staff_actor_id,target_user_id,expires_at,record_json,created_at) values (${record.supportSessionId},${record.scope.platformId},${record.scope.organizationId},${record.scope.workspaceId},${record.scope.siteId},${record.scope.ownerKey},${record.scope.ownerGeneration},${record.staffActorId},${record.targetUserId},${record.expiresAt},${json(record)}::text::jsonb,${record.startedAt}) on conflict do nothing`
      return result.rowCount === 1
    })
  }
  async readSupportSession(id: string): Promise<SupportSessionRecord | null> { const result = await this.#db<JsonRow>`select record_json from fuma_support_sessions_v2 where support_session_id=${id}`; return result.rows[0] ? parse<SupportSessionRecord>(SupportSessionRecordSchema, result.rows[0].record_json, 'stored support session') : null }
  async findActiveSupportSession(scope: SupportTenantScope, staffActorId: string, targetUserId: string, at: string): Promise<SupportSessionRecord | null> {
    const result = await this.#db<JsonRow>`select session.record_json from fuma_support_sessions_v2 session where session.platform_id=${scope.platformId} and session.organization_id=${scope.organizationId} and session.workspace_id=${scope.workspaceId} and session.site_id=${scope.siteId} and session.owner_key=${scope.ownerKey} and session.owner_generation=${scope.ownerGeneration} and session.staff_actor_id=${staffActorId} and session.target_user_id=${targetUserId} and session.expires_at>${at} and not exists(select 1 from fuma_support_session_ends_v2 ended where ended.support_session_id=session.support_session_id) order by session.created_at desc,session.support_session_id desc limit 1`
    return result.rows[0] ? parse<SupportSessionRecord>(SupportSessionRecordSchema, result.rows[0].record_json, 'active support session') : null
  }
  async insertSupportSessionEnd(record: SupportSessionEndRecord): Promise<boolean> { const result = await this.#db`insert into fuma_support_session_ends_v2 (support_session_id,record_json,ended_at) values (${record.supportSessionId},${json(record)}::text::jsonb,${record.endedAt}) on conflict do nothing`; return result.rowCount === 1 }
  async readSupportSessionEnd(id: string): Promise<SupportSessionEndRecord | null> { const result = await this.#db<JsonRow>`select record_json from fuma_support_session_ends_v2 where support_session_id=${id}`; return result.rows[0] ? parse<SupportSessionEndRecord>(SupportSessionEndRecordSchema, result.rows[0].record_json, 'stored support session end') : null }
  async insertSupportAction(record: SupportActionRecord): Promise<boolean> { const result = await this.#db`insert into fuma_support_actions_v2 (operation_id,support_session_id,record_json,created_at) values (${record.operationId},${record.supportSessionId},${json(record)}::text::jsonb,${record.createdAt}) on conflict do nothing`; return result.rowCount === 1 }
  async readSupportAction(id: string): Promise<SupportActionRecord | null> { const result = await this.#db<JsonRow>`select record_json from fuma_support_actions_v2 where operation_id=${id}`; return result.rows[0] ? parse<SupportActionRecord>(SupportActionRecordSchema, result.rows[0].record_json, 'stored support action') : null }

  async insertModerationEvidence(record: ModerationEvidenceRecord): Promise<boolean> {
    return await this.#db.transaction(async (tx) => {
      const lock = json([record.scope.platformId, record.scope.organizationId, record.scope.workspaceId, record.scope.siteId, record.scope.ownerKey, record.scope.ownerGeneration, record.subject.kind, record.subject.id])
      await tx`select pg_advisory_xact_lock(hashtextextended(${lock},0))`
      const duplicate = await tx`select 1 from fuma_moderation_evidence_v2 where evidence_id=${record.evidenceId}`
      if (duplicate.rowCount > 0) return false
      const latestResult = await tx<JsonRow>`select record_json from fuma_moderation_evidence_v2 where platform_id=${record.scope.platformId} and organization_id=${record.scope.organizationId} and workspace_id=${record.scope.workspaceId} and site_id=${record.scope.siteId} and owner_key=${record.scope.ownerKey} and owner_generation=${record.scope.ownerGeneration} and subject_kind=${record.subject.kind} and subject_id=${record.subject.id} order by created_at desc,evidence_id desc limit 1`
      const previous = latestResult.rows[0] ? parse<ModerationEvidenceRecord>(ModerationEvidenceRecordSchema, latestResult.rows[0].record_json, 'stored moderation evidence') : null
      if (!moderationTransition(previous, record)) return false
      const result = await tx`insert into fuma_moderation_evidence_v2 (evidence_id,case_id,prior_evidence_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,subject_kind,subject_id,event,record_json,created_at) values (${record.evidenceId},${record.caseId},${record.priorEvidenceId},${record.scope.platformId},${record.scope.organizationId},${record.scope.workspaceId},${record.scope.siteId},${record.scope.ownerKey},${record.scope.ownerGeneration},${record.subject.kind},${record.subject.id},${record.event},${json(record)}::text::jsonb,${record.createdAt}) on conflict do nothing`
      return result.rowCount === 1
    })
  }
  async readModerationEvidence(id: string): Promise<ModerationEvidenceRecord | null> { const result = await this.#db<JsonRow>`select record_json from fuma_moderation_evidence_v2 where evidence_id=${id}`; return result.rows[0] ? parse<ModerationEvidenceRecord>(ModerationEvidenceRecordSchema, result.rows[0].record_json, 'stored moderation evidence') : null }
  async latestModerationEvidence(scope: SupportTenantScope, kind: string, id: string): Promise<ModerationEvidenceRecord | null> { const result = await this.#db<JsonRow>`select record_json from fuma_moderation_evidence_v2 where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.ownerGeneration} and subject_kind=${kind} and subject_id=${id} order by created_at desc,evidence_id desc limit 1`; return result.rows[0] ? parse<ModerationEvidenceRecord>(ModerationEvidenceRecordSchema, result.rows[0].record_json, 'stored moderation evidence') : null }
  async listModerationQueue(scope: SupportTenantScope, queue: ModerationQueue, afterEvidenceId: string | null, limit: number): Promise<readonly ModerationEvidenceRecord[]> {
    const result = await this.#db<JsonRow>`with ranked as (
      select record_json,evidence_id,created_at,row_number() over(partition by subject_kind,subject_id order by created_at desc,evidence_id desc) position
      from fuma_moderation_evidence_v2 where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.ownerGeneration}
    ), cursor_row as (
      select created_at,evidence_id from fuma_moderation_evidence_v2 where evidence_id=${afterEvidenceId} and platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.ownerGeneration}
    ) select ranked.record_json from ranked where position=1 and ranked.record_json->>'event'=${queueEvent(queue)} and (cast(${afterEvidenceId} as text) is null or exists(select 1 from cursor_row where (ranked.created_at,ranked.evidence_id)>(cursor_row.created_at,cursor_row.evidence_id))) order by ranked.created_at,ranked.evidence_id limit ${limit}`
    return Object.freeze(result.rows.map((row) => parse<ModerationEvidenceRecord>(ModerationEvidenceRecordSchema, row.record_json, 'stored moderation queue evidence')))
  }

  async insertBreakGlassRequest(record: BreakGlassRequestRecord): Promise<boolean> { const result = await this.#db`insert into fuma_break_glass_requests_v2 (request_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,target_owner_id,requested_by_actor_id,expires_at,record_json,created_at) values (${record.requestId},${record.scope.platformId},${record.scope.organizationId},${record.scope.workspaceId},${record.scope.siteId},${record.scope.ownerKey},${record.scope.ownerGeneration},${record.targetOwnerId},${record.requestedByActorId},${record.expiresAt},${json(record)}::text::jsonb,${record.createdAt}) on conflict do nothing`; return result.rowCount === 1 }
  async readBreakGlassRequest(id: string): Promise<BreakGlassRequestRecord | null> { const result = await this.#db<JsonRow>`select record_json from fuma_break_glass_requests_v2 where request_id=${id}`; return result.rows[0] ? parse<BreakGlassRequestRecord>(BreakGlassRequestRecordSchema, result.rows[0].record_json, 'stored break-glass request') : null }
  async insertBreakGlassApproval(record: BreakGlassApprovalRecord): Promise<boolean> {
    return await this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`break-glass-approval:${record.requestId}`},0))`
      const state = await tx<{ duplicate: boolean; approvals: number }>`select exists(select 1 from fuma_break_glass_approvals_v2 where approval_id=${record.approvalId} or (request_id=${record.requestId} and approver_id=${record.approverId})) duplicate,(select count(*)::integer from fuma_break_glass_approvals_v2 where request_id=${record.requestId}) approvals`
      if (state.rows[0]?.duplicate || (state.rows[0]?.approvals ?? 2) >= 2) return false
      const result = await tx`insert into fuma_break_glass_approvals_v2 (approval_id,request_id,approver_id,record_json,approved_at) values (${record.approvalId},${record.requestId},${record.approverId},${json(record)}::text::jsonb,${record.approvedAt}) on conflict do nothing`
      return result.rowCount === 1
    })
  }
  async readBreakGlassApproval(id: string): Promise<BreakGlassApprovalRecord | null> { const result = await this.#db<JsonRow>`select record_json from fuma_break_glass_approvals_v2 where approval_id=${id}`; return result.rows[0] ? parse<BreakGlassApprovalRecord>(BreakGlassApprovalRecordSchema, result.rows[0].record_json, 'stored break-glass approval') : null }
  async listBreakGlassApprovals(id: string): Promise<readonly BreakGlassApprovalRecord[]> { const result = await this.#db<JsonRow>`select record_json from fuma_break_glass_approvals_v2 where request_id=${id} order by approved_at,approval_id`; return Object.freeze(result.rows.map((row) => parse<BreakGlassApprovalRecord>(BreakGlassApprovalRecordSchema, row.record_json, 'stored break-glass approval'))) }
  async insertBreakGlassExecution(record: BreakGlassExecutionRecord): Promise<boolean> { const result = await this.#db`insert into fuma_break_glass_executions_v2 (execution_id,request_id,record_json,executed_at) values (${record.executionId},${record.requestId},${json(record)}::text::jsonb,${record.executedAt}) on conflict do nothing`; return result.rowCount === 1 }
  async readBreakGlassExecution(id: string): Promise<BreakGlassExecutionRecord | null> { const result = await this.#db<JsonRow>`select record_json from fuma_break_glass_executions_v2 where request_id=${id}`; return result.rows[0] ? parse<BreakGlassExecutionRecord>(BreakGlassExecutionRecordSchema, result.rows[0].record_json, 'stored break-glass execution') : null }
  async insertEffect(record: SupportOperationEffectRecord): Promise<boolean> { const result = await this.#db`insert into fuma_support_operation_effects_v2 (effect_key,kind,operation_id,record_json,completed_at) values (${record.effectKey},${record.kind},${record.operationId},${json(record)}::text::jsonb,${record.completedAt}) on conflict do nothing`; return result.rowCount === 1 }
  async readEffect(id: string): Promise<SupportOperationEffectRecord | null> { const result = await this.#db<JsonRow>`select record_json from fuma_support_operation_effects_v2 where effect_key=${id}`; return result.rows[0] ? parse<SupportOperationEffectRecord>(SupportOperationEffectRecordSchema, result.rows[0].record_json, 'stored support operation effect') : null }
  async runEffect(record: SupportOperationEffectRecord, execute: () => Promise<void>): Promise<boolean> {
    return await this.#db.transaction(async (tx) => {
      await tx`insert into fuma_support_operation_locks_v2(effect_key) values (${record.effectKey}) on conflict do nothing`
      await tx`select effect_key from fuma_support_operation_locks_v2 where effect_key=${record.effectKey} for update`
      const existing = await tx`select 1 from fuma_support_operation_effects_v2 where effect_key=${record.effectKey}`
      if (existing.rowCount > 0) return false
      await execute()
      const inserted = await tx`insert into fuma_support_operation_effects_v2 (effect_key,kind,operation_id,record_json,completed_at) values (${record.effectKey},${record.kind},${record.operationId},${json(record)}::text::jsonb,${record.completedAt}) on conflict do nothing`
      if (inserted.rowCount !== 1) throw new SupportOperationsError('conflict', 'Support effect completion conflicted.')
      return true
    })
  }
}

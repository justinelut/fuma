import type { DbClient } from '../../db/client'
import { isoDateOrNull } from '@core/utils/isoDate'
import {
  parseSiteAiContract,
  SiteAiAuditFactSchema,
  SiteAiConversationBindingSchema,
  SiteAiSnapshotBindingSchema,
  SiteAiToolReceiptSchema,
  SiteAiTurnJobSchema,
  type SiteAiAuditFact,
  type SiteAiConversationBinding,
  type SiteAiSnapshotBinding,
  type SiteAiToolReceipt,
  type SiteAiTurnJob,
} from './contracts'
import type { SiteAiRepository, SiteAiToolClaim } from './repository'

type ConversationRow = Readonly<{
  conversation_id: string
  platform_id: string
  organization_id: string
  workspace_id: string
  site_id: string
  owner_key: string
  owner_generation: string | number | bigint
  profile_id: 'website' | 'publication'
  actor_id: string
  session_id: string
  editor_session_id: string
  created_at: string | Date
}>
type SnapshotRow = Readonly<{
  snapshot_id: string
  conversation_id: string
  platform_id: string
  organization_id: string
  workspace_id: string
  site_id: string
  owner_key: string
  owner_generation: string | number | bigint
  profile_id: 'website' | 'publication'
  actor_id: string
  sequence: string | number | bigint
  snapshot_hash_sha256: string
  created_at: string | Date
}>
type JobRow = Readonly<ConversationRow & {
  job_id: string
  snapshot_id: string
  authority_revision: string | number | bigint
  provider_id: string
  model_id: string
  required_capability: string
  reservation_id: string | null
  state: SiteAiTurnJob['state']
  attempt: string | number | bigint
  prompt_tokens: string | number | bigint
  completion_tokens: string | number | bigint
  failure_code: string | null
  updated_at: string | Date
}>
type ToolRow = Readonly<{
  job_id: string
  tool_call_id: string
  tool_name: string
  input_hash_sha256: string
  mutates: boolean
  state: SiteAiToolReceipt['state']
  attempt: string | number | bigint
  output_json: unknown
  created_at: string | Date
  completed_at: string | Date | null
}>
type AuditRow = Readonly<{
  audit_id: string
  action: SiteAiAuditFact['action']
  platform_id: string
  organization_id: string
  workspace_id: string
  site_id: string
  owner_key: string
  owner_generation: string | number | bigint
  profile_id: 'website' | 'publication'
  actor_id: string
  conversation_id: string
  snapshot_id: string | null
  job_id: string | null
  tool_call_id: string | null
  outcome: SiteAiAuditFact['outcome']
  reason_code: string | null
  occurred_at: string | Date
}>

function integer(value: string | number | bigint): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('Invalid site AI integer.')
  return parsed
}
function iso(value: string | Date | null): string | null {
  return isoDateOrNull(value)
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
function conversation(row: ConversationRow): SiteAiConversationBinding {
  return parseSiteAiContract(SiteAiConversationBindingSchema, {
    conversationId: row.conversation_id,
    scope: {
      platformId: row.platform_id,
      organizationId: row.organization_id,
      workspaceId: row.workspace_id,
      siteId: row.site_id,
      ownerKey: row.owner_key,
      ownerGeneration: integer(row.owner_generation),
      profileId: row.profile_id,
    },
    actor: {
      actorId: row.actor_id,
      sessionId: row.session_id,
      editorSessionId: row.editor_session_id,
    },
    createdAt: iso(row.created_at),
  }, 'siteAi.postgres.conversation') as SiteAiConversationBinding
}
function snapshot(row: SnapshotRow): SiteAiSnapshotBinding {
  return parseSiteAiContract(SiteAiSnapshotBindingSchema, {
    snapshotId: row.snapshot_id,
    conversationId: row.conversation_id,
    scope: {
      platformId: row.platform_id,
      organizationId: row.organization_id,
      workspaceId: row.workspace_id,
      siteId: row.site_id,
      ownerKey: row.owner_key,
      ownerGeneration: integer(row.owner_generation),
      profileId: row.profile_id,
    },
    actorId: row.actor_id,
    sequence: integer(row.sequence),
    snapshotHashSha256: row.snapshot_hash_sha256,
    createdAt: iso(row.created_at),
  }, 'siteAi.postgres.snapshot') as SiteAiSnapshotBinding
}
function job(row: JobRow): SiteAiTurnJob {
  const binding = conversation(row)
  return parseSiteAiContract(SiteAiTurnJobSchema, {
    jobId: row.job_id,
    conversationId: row.conversation_id,
    snapshotId: row.snapshot_id,
    scope: binding.scope,
    actor: binding.actor,
    authorityRevision: integer(row.authority_revision),
    providerId: row.provider_id,
    modelId: row.model_id,
    requiredCapability: row.required_capability,
    reservationId: row.reservation_id,
    state: row.state,
    attempt: integer(row.attempt),
    promptTokens: integer(row.prompt_tokens),
    completionTokens: integer(row.completion_tokens),
    failureCode: row.failure_code,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }, 'siteAi.postgres.job') as SiteAiTurnJob
}
function tool(row: ToolRow): SiteAiToolReceipt {
  return parseSiteAiContract(SiteAiToolReceiptSchema, {
    jobId: row.job_id,
    toolCallId: row.tool_call_id,
    toolName: row.tool_name,
    inputHashSha256: row.input_hash_sha256,
    mutates: row.mutates,
    state: row.state,
    attempt: integer(row.attempt),
    output: row.output_json,
    createdAt: iso(row.created_at),
    completedAt: iso(row.completed_at),
  }, 'siteAi.postgres.tool') as SiteAiToolReceipt
}
function audit(row: AuditRow): SiteAiAuditFact {
  return parseSiteAiContract(SiteAiAuditFactSchema, {
    auditId: row.audit_id,
    action: row.action,
    scope: {
      platformId: row.platform_id,
      organizationId: row.organization_id,
      workspaceId: row.workspace_id,
      siteId: row.site_id,
      ownerKey: row.owner_key,
      ownerGeneration: integer(row.owner_generation),
      profileId: row.profile_id,
    },
    actorId: row.actor_id,
    conversationId: row.conversation_id,
    snapshotId: row.snapshot_id,
    jobId: row.job_id,
    toolCallId: row.tool_call_id,
    outcome: row.outcome,
    reasonCode: row.reason_code,
    occurredAt: iso(row.occurred_at),
  }, 'siteAi.postgres.audit') as SiteAiAuditFact
}

const CONVERSATION_COLUMNS = `conversation_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,actor_id,session_id,editor_session_id,created_at`
const JOB_COLUMNS = `${CONVERSATION_COLUMNS},job_id,snapshot_id,authority_revision,provider_id,model_id,required_capability,reservation_id,state,attempt,prompt_tokens,completion_tokens,failure_code,updated_at`

export class PostgresSiteAiRepository implements SiteAiRepository {
  readonly #db: DbClient
  constructor(db: DbClient) { this.#db = db }

  async putConversation(raw: SiteAiConversationBinding): Promise<SiteAiConversationBinding> {
    const value = parseSiteAiContract(SiteAiConversationBindingSchema, raw, 'siteAi.postgres.putConversation') as SiteAiConversationBinding
    await this.#db`insert into fuma_site_ai_conversation_bindings
      (conversation_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,actor_id,session_id,editor_session_id,created_at)
      values (${value.conversationId},${value.scope.platformId},${value.scope.organizationId},${value.scope.workspaceId},${value.scope.siteId},${value.scope.ownerKey},${value.scope.ownerGeneration},${value.scope.profileId},${value.actor.actorId},${value.actor.sessionId},${value.actor.editorSessionId},${value.createdAt})
      on conflict do nothing`
    const stored = await this.conversation(value.conversationId)
    if (!stored || canonical(stored) !== canonical(value)) throw new Error('conversation-binding-conflict')
    return stored
  }

  async conversation(id: string): Promise<SiteAiConversationBinding | null> {
    const row = (await this.#db.unsafe<ConversationRow>(
      `select ${CONVERSATION_COLUMNS} from fuma_site_ai_conversation_bindings where conversation_id=$1`, [id],
    )).rows[0]
    return row ? conversation(row) : null
  }

  async putSnapshot(raw: SiteAiSnapshotBinding): Promise<SiteAiSnapshotBinding> {
    const value = parseSiteAiContract(SiteAiSnapshotBindingSchema, raw, 'siteAi.postgres.putSnapshot') as SiteAiSnapshotBinding
    await this.#db`insert into fuma_site_ai_snapshot_bindings
      (snapshot_id,conversation_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,actor_id,sequence,snapshot_hash_sha256,created_at)
      values (${value.snapshotId},${value.conversationId},${value.scope.platformId},${value.scope.organizationId},${value.scope.workspaceId},${value.scope.siteId},${value.scope.ownerKey},${value.scope.ownerGeneration},${value.scope.profileId},${value.actorId},${value.sequence},${value.snapshotHashSha256},${value.createdAt})
      on conflict do nothing`
    const stored = await this.snapshot(value.snapshotId)
    if (!stored || canonical(stored) !== canonical(value)) throw new Error('snapshot-binding-conflict')
    return stored
  }

  async snapshot(id: string): Promise<SiteAiSnapshotBinding | null> {
    const row = (await this.#db.unsafe<SnapshotRow>(
      `select snapshot_id,conversation_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,actor_id,sequence,snapshot_hash_sha256,created_at from fuma_site_ai_snapshot_bindings where snapshot_id=$1`, [id],
    )).rows[0]
    return row ? snapshot(row) : null
  }

  async putJob(raw: SiteAiTurnJob): Promise<SiteAiTurnJob> {
    const value = parseSiteAiContract(SiteAiTurnJobSchema, raw, 'siteAi.postgres.putJob') as SiteAiTurnJob
    await this.#db`insert into fuma_site_ai_turn_jobs
      (job_id,conversation_id,snapshot_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,actor_id,session_id,editor_session_id,authority_revision,provider_id,model_id,required_capability,reservation_id,state,attempt,prompt_tokens,completion_tokens,failure_code,created_at,updated_at)
      values (${value.jobId},${value.conversationId},${value.snapshotId},${value.scope.platformId},${value.scope.organizationId},${value.scope.workspaceId},${value.scope.siteId},${value.scope.ownerKey},${value.scope.ownerGeneration},${value.scope.profileId},${value.actor.actorId},${value.actor.sessionId},${value.actor.editorSessionId},${value.authorityRevision},${value.providerId},${value.modelId},${value.requiredCapability},${value.reservationId},${value.state},${value.attempt},${value.promptTokens},${value.completionTokens},${value.failureCode},${value.createdAt},${value.updatedAt})
      on conflict do nothing`
    const stored = await this.job(value.jobId)
    if (!stored || canonical(stored) !== canonical(value)) throw new Error('job-binding-conflict')
    return stored
  }

  async job(id: string): Promise<SiteAiTurnJob | null> {
    const row = (await this.#db.unsafe<JobRow>(
      `select ${JOB_COLUMNS} from fuma_site_ai_turn_jobs where job_id=$1`, [id],
    )).rows[0]
    return row ? job(row) : null
  }

  async updateJob(raw: SiteAiTurnJob, expectedState: SiteAiTurnJob['state']): Promise<boolean> {
    const value = parseSiteAiContract(SiteAiTurnJobSchema, raw, 'siteAi.postgres.updateJob') as SiteAiTurnJob
    const result = await this.#db`update fuma_site_ai_turn_jobs set state=${value.state},prompt_tokens=${value.promptTokens},completion_tokens=${value.completionTokens},failure_code=${value.failureCode},updated_at=${value.updatedAt}
      where job_id=${value.jobId} and state=${expectedState} and platform_id=${value.scope.platformId} and organization_id=${value.scope.organizationId} and workspace_id=${value.scope.workspaceId} and site_id=${value.scope.siteId} and owner_key=${value.scope.ownerKey} and owner_generation=${value.scope.ownerGeneration} and profile_id=${value.scope.profileId} and actor_id=${value.actor.actorId}`
    return result.rowCount === 1
  }

  async claimTool(raw: SiteAiToolReceipt): Promise<SiteAiToolClaim> {
    const value = parseSiteAiContract(SiteAiToolReceiptSchema, raw, 'siteAi.postgres.claimTool') as SiteAiToolReceipt
    const inserted = await this.#db`insert into fuma_site_ai_tool_receipts
      (job_id,tool_call_id,tool_name,input_hash_sha256,mutates,state,attempt,output_json,created_at,completed_at)
      values (${value.jobId},${value.toolCallId},${value.toolName},${value.inputHashSha256},${value.mutates},${value.state},${value.attempt},null,${value.createdAt},null) on conflict do nothing`
    const row = (await this.#db<ToolRow>`select job_id,tool_call_id,tool_name,input_hash_sha256,mutates,state,attempt,output_json,created_at,completed_at from fuma_site_ai_tool_receipts where job_id=${value.jobId} and tool_call_id=${value.toolCallId}`).rows[0]
    if (!row) throw new Error('tool-claim-missing')
    const receipt = tool(row)
    if (inserted.rowCount === 1) return { outcome: 'claimed', receipt }
    if (receipt.toolName !== value.toolName || receipt.inputHashSha256 !== value.inputHashSha256 || receipt.mutates !== value.mutates) return { outcome: 'conflict', receipt }
    return receipt.state === 'started' ? { outcome: 'in-flight', receipt } : { outcome: 'replay', receipt }
  }

  async completeTool(raw: SiteAiToolReceipt): Promise<SiteAiToolReceipt> {
    const value = parseSiteAiContract(SiteAiToolReceiptSchema, raw, 'siteAi.postgres.completeTool') as SiteAiToolReceipt
    const result = await this.#db`update fuma_site_ai_tool_receipts set state=${value.state},output_json=${JSON.stringify(value.output)}::text::jsonb,completed_at=${value.completedAt}
      where job_id=${value.jobId} and tool_call_id=${value.toolCallId} and state='started' and tool_name=${value.toolName} and input_hash_sha256=${value.inputHashSha256}`
    if (result.rowCount !== 1) throw new Error('tool-receipt-conflict')
    return value
  }

  async appendAudit(raw: SiteAiAuditFact): Promise<void> {
    const value = parseSiteAiContract(SiteAiAuditFactSchema, raw, 'siteAi.postgres.appendAudit') as SiteAiAuditFact
    const inserted = await this.#db`insert into fuma_site_ai_audit_facts
      (audit_id,action,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,actor_id,conversation_id,snapshot_id,job_id,tool_call_id,outcome,reason_code,occurred_at)
      values (${value.auditId},${value.action},${value.scope.platformId},${value.scope.organizationId},${value.scope.workspaceId},${value.scope.siteId},${value.scope.ownerKey},${value.scope.ownerGeneration},${value.scope.profileId},${value.actorId},${value.conversationId},${value.snapshotId},${value.jobId},${value.toolCallId},${value.outcome},${value.reasonCode},${value.occurredAt}) on conflict do nothing`
    if (inserted.rowCount === 1) return
    const row = (await this.#db<AuditRow>`select audit_id,action,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,actor_id,conversation_id,snapshot_id,job_id,tool_call_id,outcome,reason_code,occurred_at from fuma_site_ai_audit_facts where audit_id=${value.auditId}`).rows[0]
    if (!row || canonical(audit(row)) !== canonical(value)) throw new Error('audit-conflict')
  }

  async auditForConversation(conversationId: string): Promise<readonly SiteAiAuditFact[]> {
    const rows = (await this.#db<AuditRow>`select audit_id,action,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,actor_id,conversation_id,snapshot_id,job_id,tool_call_id,outcome,reason_code,occurred_at from fuma_site_ai_audit_facts where conversation_id=${conversationId} order by occurred_at,audit_id`).rows
    return rows.map(audit)
  }
}

import type { SupportOperationsRepository } from './service'
import type {
  BreakGlassApprovalRecord, BreakGlassExecutionRecord, BreakGlassRequestRecord, ModerationEvidenceRecord,
  ModerationQueue, SupportActionRecord, SupportOperationEffectRecord, SupportSessionEndRecord,
  SupportSessionRecord, SupportTenantScope,
} from './contracts'

function clone<T>(value: T): T { return structuredClone(value) }
function scopeKey(scope: SupportTenantScope): string { return `${scope.platformId}\0${scope.organizationId}\0${scope.workspaceId}\0${scope.siteId}\0${scope.ownerKey}\0${scope.ownerGeneration}` }
function moderationTransition(previous: ModerationEvidenceRecord | null, record: ModerationEvidenceRecord): boolean {
  if (!previous || previous.event === 'resolved') return record.event === 'opened' && record.priorEvidenceId === null
  if (record.caseId !== previous.caseId || record.priorEvidenceId !== previous.evidenceId) return false
  if (previous.event === 'opened') return record.event === 'suspended' || record.event === 'resolved'
  if (previous.event === 'suspended') return record.event === 'appealed' || record.event === 'resolved'
  return previous.event === 'appealed' && (record.event === 'suspended' || record.event === 'resolved')
}
function queueEvent(queue: ModerationQueue): ModerationEvidenceRecord['event'] {
  if (queue === 'moderation') return 'opened'
  return queue === 'suspension' ? 'suspended' : 'appealed'
}

export class MemorySupportOperationsRepository implements SupportOperationsRepository {
  readonly support = new Map<string, SupportSessionRecord>()
  readonly supportEnds = new Map<string, SupportSessionEndRecord>()
  readonly supportActions = new Map<string, SupportActionRecord>()
  readonly moderation: ModerationEvidenceRecord[] = []
  readonly requests = new Map<string, BreakGlassRequestRecord>()
  readonly approvals: BreakGlassApprovalRecord[] = []
  readonly executions = new Map<string, BreakGlassExecutionRecord>()
  readonly effects = new Map<string, SupportOperationEffectRecord>()
  readonly #effectLocks = new Map<string, Promise<void>>()

  async insertSupportSession(record: SupportSessionRecord): Promise<boolean> {
    if (this.support.has(record.supportSessionId)) return false
    const active = [...this.support.values()].some((candidate) => (
      scopeKey(candidate.scope) === scopeKey(record.scope)
      && candidate.staffActorId === record.staffActorId
      && !this.supportEnds.has(candidate.supportSessionId)
      && candidate.expiresAt > record.startedAt
    ))
    if (active) return false
    this.support.set(record.supportSessionId, clone(record))
    return true
  }
  async readSupportSession(id: string): Promise<SupportSessionRecord | null> { const value = this.support.get(id); return value ? clone(value) : null }
  async findActiveSupportSession(scope: SupportTenantScope, staffActorId: string, targetUserId: string, at: string): Promise<SupportSessionRecord | null> {
    const value = [...this.support.values()]
      .filter((record) => scopeKey(record.scope) === scopeKey(scope) && record.staffActorId === staffActorId && record.targetUserId === targetUserId && record.expiresAt > at && !this.supportEnds.has(record.supportSessionId))
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt) || right.supportSessionId.localeCompare(left.supportSessionId))[0]
    return value ? clone(value) : null
  }
  async insertSupportSessionEnd(record: SupportSessionEndRecord): Promise<boolean> { if (this.supportEnds.has(record.supportSessionId)) return false; this.supportEnds.set(record.supportSessionId, clone(record)); return true }
  async readSupportSessionEnd(id: string): Promise<SupportSessionEndRecord | null> { const value = this.supportEnds.get(id); return value ? clone(value) : null }
  async insertSupportAction(record: SupportActionRecord): Promise<boolean> { if (this.supportActions.has(record.operationId)) return false; this.supportActions.set(record.operationId, clone(record)); return true }
  async readSupportAction(id: string): Promise<SupportActionRecord | null> { const value = this.supportActions.get(id); return value ? clone(value) : null }

  async insertModerationEvidence(record: ModerationEvidenceRecord): Promise<boolean> {
    if (this.moderation.some(({ evidenceId }) => evidenceId === record.evidenceId)) return false
    const latest = await this.latestModerationEvidence(record.scope, record.subject.kind, record.subject.id)
    if (!moderationTransition(latest, record)) return false
    this.moderation.push(clone(record))
    return true
  }
  async readModerationEvidence(id: string): Promise<ModerationEvidenceRecord | null> { const value = this.moderation.find(({ evidenceId }) => evidenceId === id); return value ? clone(value) : null }
  async latestModerationEvidence(scope: SupportTenantScope, kind: string, id: string): Promise<ModerationEvidenceRecord | null> {
    const value = this.moderation.filter((record) => scopeKey(record.scope) === scopeKey(scope) && record.subject.kind === kind && record.subject.id === id).at(-1)
    return value ? clone(value) : null
  }
  async listModerationQueue(scope: SupportTenantScope, queue: ModerationQueue, afterEvidenceId: string | null, limit: number): Promise<readonly ModerationEvidenceRecord[]> {
    const latest = new Map<string, ModerationEvidenceRecord>()
    for (const record of this.moderation) {
      if (scopeKey(record.scope) === scopeKey(scope)) latest.set(`${record.subject.kind}\0${record.subject.id}`, record)
    }
    const rows = [...latest.values()]
      .filter(({ event }) => event === queueEvent(queue))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.evidenceId.localeCompare(right.evidenceId))
    const offset = afterEvidenceId === null ? 0 : rows.findIndex(({ evidenceId }) => evidenceId === afterEvidenceId) + 1
    if (afterEvidenceId !== null && offset === 0) return []
    return Object.freeze(rows.slice(offset, offset + limit).map(clone))
  }

  async insertBreakGlassRequest(record: BreakGlassRequestRecord): Promise<boolean> { if (this.requests.has(record.requestId)) return false; this.requests.set(record.requestId, clone(record)); return true }
  async readBreakGlassRequest(id: string): Promise<BreakGlassRequestRecord | null> { const value = this.requests.get(id); return value ? clone(value) : null }
  async insertBreakGlassApproval(record: BreakGlassApprovalRecord): Promise<boolean> {
    if (this.approvals.some(({ approvalId, requestId, approverId }) => approvalId === record.approvalId || (requestId === record.requestId && approverId === record.approverId))) return false
    if (this.approvals.filter(({ requestId }) => requestId === record.requestId).length >= 2) return false
    this.approvals.push(clone(record))
    return true
  }
  async readBreakGlassApproval(id: string): Promise<BreakGlassApprovalRecord | null> { const value = this.approvals.find(({ approvalId }) => approvalId === id); return value ? clone(value) : null }
  async listBreakGlassApprovals(id: string): Promise<readonly BreakGlassApprovalRecord[]> { return Object.freeze(this.approvals.filter(({ requestId }) => requestId === id).map(clone)) }
  async insertBreakGlassExecution(record: BreakGlassExecutionRecord): Promise<boolean> { if (this.executions.has(record.requestId)) return false; this.executions.set(record.requestId, clone(record)); return true }
  async readBreakGlassExecution(id: string): Promise<BreakGlassExecutionRecord | null> { const value = this.executions.get(id); return value ? clone(value) : null }
  async insertEffect(record: SupportOperationEffectRecord): Promise<boolean> { if (this.effects.has(record.effectKey)) return false; this.effects.set(record.effectKey, clone(record)); return true }
  async readEffect(id: string): Promise<SupportOperationEffectRecord | null> { const value = this.effects.get(id); return value ? clone(value) : null }
  async runEffect(record: SupportOperationEffectRecord, execute: () => Promise<void>): Promise<boolean> {
    const previous = this.#effectLocks.get(record.effectKey) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    const chained = previous.then(() => current)
    this.#effectLocks.set(record.effectKey, chained)
    await previous
    try {
      if (this.effects.has(record.effectKey)) return false
      await execute()
      this.effects.set(record.effectKey, clone(record))
      return true
    } finally {
      release()
      if (this.#effectLocks.get(record.effectKey) === chained) this.#effectLocks.delete(record.effectKey)
    }
  }
}

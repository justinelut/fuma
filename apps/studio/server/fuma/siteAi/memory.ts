import {
  parseSiteAiContract,
  sameSiteAiActor,
  sameSiteAiScope,
  SiteAiAuditFactSchema,
  SiteAiAuthoritySnapshotSchema,
  SiteAiConversationBindingSchema,
  SiteAiSnapshotBindingSchema,
  SiteAiToolReceiptSchema,
  SiteAiTurnJobSchema,
  type SiteAiAuditFact,
  type SiteAiAuthoritySnapshot,
  type SiteAiConversationBinding,
  type SiteAiSnapshotBinding,
  type SiteAiToolReceipt,
  type SiteAiTurnJob,
} from './contracts'
import type { SiteAiRepository, SiteAiToolClaim } from './repository'
import type { SiteAiLiveAuthorityPort } from './service'

function clone<T>(value: T): T {
  return structuredClone(value)
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export class MemorySiteAiLiveAuthority implements SiteAiLiveAuthorityPort {
  readonly #records = new Map<string, SiteAiAuthoritySnapshot>()

  set(raw: unknown): SiteAiAuthoritySnapshot {
    const value = parseSiteAiContract(
      SiteAiAuthoritySnapshotSchema,
      raw,
      'siteAi.memoryAuthority.set',
    ) as SiteAiAuthoritySnapshot
    this.#records.set(this.#key(value), clone(value))
    return clone(value)
  }

  revoke(raw: unknown): SiteAiAuthoritySnapshot {
    const current = parseSiteAiContract(
      SiteAiAuthoritySnapshotSchema,
      raw,
      'siteAi.memoryAuthority.revoke',
    ) as SiteAiAuthoritySnapshot
    return this.set({
      ...current,
      state: 'revoked',
      capabilities: [],
      revision: current.revision + 1,
    })
  }

  async load(expected: SiteAiAuthoritySnapshot): Promise<SiteAiAuthoritySnapshot | null> {
    return clone(this.#records.get(this.#key(expected)) ?? null)
  }

  #key(value: SiteAiAuthoritySnapshot): string {
    return [
      value.scope.platformId,
      value.scope.organizationId,
      value.scope.workspaceId,
      value.scope.siteId,
      value.actor.actorId,
      value.actor.sessionId,
      value.actor.editorSessionId,
    ].join('\0')
  }
}

export class MemorySiteAiRepository implements SiteAiRepository {
  readonly #conversations = new Map<string, SiteAiConversationBinding>()
  readonly #snapshots = new Map<string, SiteAiSnapshotBinding>()
  readonly #jobs = new Map<string, SiteAiTurnJob>()
  readonly #tools = new Map<string, SiteAiToolReceipt>()
  readonly #audit: SiteAiAuditFact[] = []
  failNext: Error | null = null

  #fail(): void {
    if (!this.failNext) return
    const error = this.failNext
    this.failNext = null
    throw error
  }

  async putConversation(raw: SiteAiConversationBinding): Promise<SiteAiConversationBinding> {
    this.#fail()
    const value = parseSiteAiContract(
      SiteAiConversationBindingSchema,
      raw,
      'siteAi.memory.conversation',
    ) as SiteAiConversationBinding
    const current = this.#conversations.get(value.conversationId)
    if (current && canonical(current) !== canonical(value)) throw new Error('conversation-binding-conflict')
    this.#conversations.set(value.conversationId, clone(value))
    return clone(value)
  }

  async conversation(id: string): Promise<SiteAiConversationBinding | null> {
    this.#fail()
    return clone(this.#conversations.get(id) ?? null)
  }

  async putSnapshot(raw: SiteAiSnapshotBinding): Promise<SiteAiSnapshotBinding> {
    this.#fail()
    const value = parseSiteAiContract(
      SiteAiSnapshotBindingSchema,
      raw,
      'siteAi.memory.snapshot',
    ) as SiteAiSnapshotBinding
    const current = this.#snapshots.get(value.snapshotId)
    if (current && canonical(current) !== canonical(value)) throw new Error('snapshot-binding-conflict')
    for (const existing of this.#snapshots.values()) {
      if (
        existing.conversationId === value.conversationId
        && existing.sequence === value.sequence
        && existing.snapshotId !== value.snapshotId
      ) throw new Error('snapshot-sequence-conflict')
    }
    this.#snapshots.set(value.snapshotId, clone(value))
    return clone(value)
  }

  async snapshot(id: string): Promise<SiteAiSnapshotBinding | null> {
    this.#fail()
    return clone(this.#snapshots.get(id) ?? null)
  }

  async putJob(raw: SiteAiTurnJob): Promise<SiteAiTurnJob> {
    this.#fail()
    const value = parseSiteAiContract(SiteAiTurnJobSchema, raw, 'siteAi.memory.job') as SiteAiTurnJob
    const current = this.#jobs.get(value.jobId)
    if (current && canonical(current) !== canonical(value)) throw new Error('job-binding-conflict')
    this.#jobs.set(value.jobId, clone(value))
    return clone(value)
  }

  async job(id: string): Promise<SiteAiTurnJob | null> {
    this.#fail()
    return clone(this.#jobs.get(id) ?? null)
  }

  async updateJob(raw: SiteAiTurnJob, expectedState: SiteAiTurnJob['state']): Promise<boolean> {
    this.#fail()
    const value = parseSiteAiContract(SiteAiTurnJobSchema, raw, 'siteAi.memory.jobUpdate') as SiteAiTurnJob
    const current = this.#jobs.get(value.jobId)
    if (!current || current.state !== expectedState) return false
    this.#jobs.set(value.jobId, clone(value))
    return true
  }

  async claimTool(raw: SiteAiToolReceipt): Promise<SiteAiToolClaim> {
    this.#fail()
    const value = parseSiteAiContract(
      SiteAiToolReceiptSchema,
      raw,
      'siteAi.memory.toolClaim',
    ) as SiteAiToolReceipt
    const key = `${value.jobId}\0${value.toolCallId}`
    const current = this.#tools.get(key)
    if (!current) {
      this.#tools.set(key, clone(value))
      return { outcome: 'claimed', receipt: clone(value) }
    }
    const same = current.toolName === value.toolName
      && current.inputHashSha256 === value.inputHashSha256
      && current.mutates === value.mutates
    if (!same) return { outcome: 'conflict', receipt: clone(current) }
    if (current.state === 'started') return { outcome: 'in-flight', receipt: clone(current) }
    return { outcome: 'replay', receipt: clone(current) }
  }

  async completeTool(raw: SiteAiToolReceipt): Promise<SiteAiToolReceipt> {
    this.#fail()
    const value = parseSiteAiContract(
      SiteAiToolReceiptSchema,
      raw,
      'siteAi.memory.toolComplete',
    ) as SiteAiToolReceipt
    const key = `${value.jobId}\0${value.toolCallId}`
    const current = this.#tools.get(key)
    if (!current || current.state !== 'started'
      || current.toolName !== value.toolName
      || current.inputHashSha256 !== value.inputHashSha256) {
      throw new Error('tool-receipt-conflict')
    }
    this.#tools.set(key, clone(value))
    return clone(value)
  }

  async appendAudit(raw: SiteAiAuditFact): Promise<void> {
    this.#fail()
    const value = parseSiteAiContract(SiteAiAuditFactSchema, raw, 'siteAi.memory.audit') as SiteAiAuditFact
    const current = this.#audit.find(({ auditId }) => auditId === value.auditId)
    if (current && canonical(current) !== canonical(value)) throw new Error('audit-conflict')
    if (!current) this.#audit.push(clone(value))
  }

  async auditForConversation(conversationId: string): Promise<readonly SiteAiAuditFact[]> {
    this.#fail()
    return clone(this.#audit.filter((fact) => fact.conversationId === conversationId))
  }

  assertBinding(authority: SiteAiAuthoritySnapshot, conversationId: string): boolean {
    const binding = this.#conversations.get(conversationId)
    return Boolean(binding
      && sameSiteAiScope(binding.scope, authority.scope)
      && sameSiteAiActor(binding.actor, authority.actor))
  }
}

import type { AiToolOutput } from '@core/ai'
import type {
  AiRuntimeAuthorityPhase,
  AiRuntimeExecutionAuthority,
} from '../../ai/runtime/types'
import {
  BeginSiteAiTurnCommandSchema,
  BindSiteAiConversationCommandSchema,
  BindSiteAiSnapshotCommandSchema,
  parseSiteAiContract,
  sameSiteAiActor,
  sameSiteAiScope,
  type BeginSiteAiTurnCommand,
  type SiteAiAuditAction,
  type SiteAiAuditFact,
  type SiteAiAuthoritySnapshot,
  type SiteAiConversationBinding,
  type SiteAiScope,
  type SiteAiSnapshotBinding,
  type SiteAiToolReceipt,
  type SiteAiTurnJob,
} from './contracts'
import type { SiteAiRepository } from './repository'

export interface SiteAiLiveAuthorityPort {
  load(expected: SiteAiAuthoritySnapshot): Promise<SiteAiAuthoritySnapshot | null>
}

export interface SiteAiModelAuthorityPort {
  authorize(input: Readonly<{
    scope: SiteAiScope
    providerId: string
    modelId: string
  }>): Promise<void>
}

export interface SiteAiCreditAuthorityPort {
  reserve(input: Readonly<{
    reservationId: string
    jobId: string
    scope: SiteAiScope
    providerId: string
    modelId: string
    estimatedInputTokens: number
    estimatedOutputTokens: number
  }>): Promise<void>
  settle(input: Readonly<{
    reservationId: string
    jobId: string
    promptTokens: number
    completionTokens: number
  }>): Promise<void>
  release(input: Readonly<{
    reservationId: string
    jobId: string
    reasonCode: string
  }>): Promise<void>
}

export type SiteAiServiceOptions = Readonly<{
  repository: SiteAiRepository
  liveAuthority: SiteAiLiveAuthorityPort
  models: SiteAiModelAuthorityPort
  credits?: SiteAiCreditAuthorityPort
  now?: () => Date
  generateAuditId?: () => string
}>

export class SiteAiAuthorityError extends Error {
  override readonly name = 'SiteAiAuthorityError'
  readonly code:
    | 'denied'
    | 'conflict'
    | 'not-found'
    | 'tool-in-flight'
  constructor(code: SiteAiAuthorityError['code'], message: string) {
    super(message)
    this.code = code
  }
}

type AuditAction = SiteAiAuditAction
type SiteAiAuditInput = Readonly<{
  action: AuditAction
  authority: SiteAiAuthoritySnapshot
  conversationId: string
  snapshotId?: string | null
  jobId?: string | null
  toolCallId?: string | null
  outcome: SiteAiAuditFact['outcome']
  reasonCode?: string | null
}>

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export async function hashSiteAiSnapshot(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function sameConversation(
  binding: SiteAiConversationBinding,
  authority: SiteAiAuthoritySnapshot,
): boolean {
  return sameSiteAiScope(binding.scope, authority.scope)
    && sameSiteAiActor(binding.actor, authority.actor)
}

function sameSnapshot(
  snapshot: SiteAiSnapshotBinding,
  conversation: SiteAiConversationBinding,
  authority: SiteAiAuthoritySnapshot,
): boolean {
  return snapshot.conversationId === conversation.conversationId
    && snapshot.actorId === authority.actor.actorId
    && sameSiteAiScope(snapshot.scope, authority.scope)
}

function sameJobCommand(job: SiteAiTurnJob, command: BeginSiteAiTurnCommand): boolean {
  return job.conversationId === command.conversationId
    && job.snapshotId === command.snapshotId
    && job.providerId === command.providerId
    && job.modelId === command.modelId
    && job.requiredCapability === command.requiredCapability
    && job.attempt === command.attempt
    && sameSiteAiScope(job.scope, command.authority.scope)
    && sameSiteAiActor(job.actor, command.authority.actor)
}

export class SiteAiService {
  readonly #repository: SiteAiRepository
  readonly #liveAuthority: SiteAiLiveAuthorityPort
  readonly #models: SiteAiModelAuthorityPort
  readonly #credits?: SiteAiCreditAuthorityPort
  readonly #now: () => Date
  readonly #generateAuditId: () => string

  constructor(options: SiteAiServiceOptions) {
    this.#repository = options.repository
    this.#liveAuthority = options.liveAuthority
    this.#models = options.models
    this.#credits = options.credits
    this.#now = options.now ?? (() => new Date())
    this.#generateAuditId = options.generateAuditId ?? (() => crypto.randomUUID())
  }

  #instant(): string {
    return this.#now().toISOString()
  }

  async #audit(input: SiteAiAuditInput): Promise<void> {
    await this.#repository.appendAudit({
      auditId: this.#generateAuditId(),
      action: input.action,
      scope: input.authority.scope,
      actorId: input.authority.actor.actorId,
      conversationId: input.conversationId,
      snapshotId: input.snapshotId ?? null,
      jobId: input.jobId ?? null,
      toolCallId: input.toolCallId ?? null,
      outcome: input.outcome,
      reasonCode: input.reasonCode ?? null,
      occurredAt: this.#instant(),
    })
  }

  async revalidate(
    expected: SiteAiAuthoritySnapshot,
    capability: string,
  ): Promise<SiteAiAuthoritySnapshot> {
    const live = await this.#liveAuthority.load(expected)
    const exact = live
      && live.state === 'active'
      && live.revision >= expected.revision
      && sameSiteAiScope(live.scope, expected.scope)
      && sameSiteAiActor(live.actor, expected.actor)
      && live.capabilities.includes(capability)
    if (!exact) throw new SiteAiAuthorityError('denied', 'Live site AI authority denied.')
    return live
  }

  async bindConversation(raw: unknown): Promise<SiteAiConversationBinding> {
    const command = parseSiteAiContract(
      BindSiteAiConversationCommandSchema,
      raw,
      'siteAi.bindConversation',
    )
    await this.revalidate(command.authority, 'ai.chat')
    const binding = await this.#repository.putConversation({
      conversationId: command.conversationId,
      scope: command.authority.scope,
      actor: command.authority.actor,
      createdAt: this.#instant(),
    })
    await this.#audit({
      action: 'site.ai.conversation.bound',
      authority: command.authority,
      conversationId: binding.conversationId,
      outcome: 'success',
    })
    return binding
  }

  async bindSnapshot(raw: unknown): Promise<SiteAiSnapshotBinding> {
    const command = parseSiteAiContract(
      BindSiteAiSnapshotCommandSchema,
      raw,
      'siteAi.bindSnapshot',
    )
    await this.revalidate(command.authority, 'ai.chat')
    const conversation = await this.#repository.conversation(command.conversationId)
    if (!conversation || !sameConversation(conversation, command.authority)) {
      throw new SiteAiAuthorityError('not-found', 'Conversation binding is unavailable.')
    }
    const snapshot = await this.#repository.putSnapshot({
      snapshotId: command.snapshotId,
      conversationId: command.conversationId,
      scope: command.authority.scope,
      actorId: command.authority.actor.actorId,
      sequence: command.sequence,
      snapshotHashSha256: command.snapshotHashSha256,
      createdAt: this.#instant(),
    })
    await this.#audit({
      action: 'site.ai.snapshot.bound',
      authority: command.authority,
      conversationId: command.conversationId,
      snapshotId: command.snapshotId,
      outcome: 'success',
    })
    return snapshot
  }

  async beginTurn(raw: unknown): Promise<Readonly<{
    job: SiteAiTurnJob
    authority: AiRuntimeExecutionAuthority
  }>> {
    const command = parseSiteAiContract(
      BeginSiteAiTurnCommandSchema,
      raw,
      'siteAi.beginTurn',
    ) as BeginSiteAiTurnCommand
    await this.revalidate(command.authority, command.requiredCapability)
    const conversation = await this.#repository.conversation(command.conversationId)
    const snapshot = await this.#repository.snapshot(command.snapshotId)
    if (!conversation || !sameConversation(conversation, command.authority)
      || !snapshot || !sameSnapshot(snapshot, conversation, command.authority)) {
      await this.#audit({
        action: 'site.ai.turn.denied',
        authority: command.authority,
        conversationId: command.conversationId,
        snapshotId: command.snapshotId,
        jobId: command.jobId,
        outcome: 'denied',
        reasonCode: 'binding-mismatch',
      })
      throw new SiteAiAuthorityError('denied', 'Exact conversation and snapshot binding is required.')
    }
    const prior = await this.#repository.job(command.jobId)
    if (prior) {
      if (!sameJobCommand(prior, command) || prior.state !== 'running') {
        throw new SiteAiAuthorityError('conflict', 'Turn job idempotency evidence changed.')
      }
      return {
        job: prior,
        authority: new SiteAiNativeTurnAuthority(this, prior, command.authority),
      }
    }
    await this.#models.authorize({
      scope: command.authority.scope,
      providerId: command.providerId,
      modelId: command.modelId,
    })
    const reservationId = this.#credits ? `site-ai:${command.jobId}` : null
    if (reservationId) {
      await this.#credits!.reserve({
        reservationId,
        jobId: command.jobId,
        scope: command.authority.scope,
        providerId: command.providerId,
        modelId: command.modelId,
        estimatedInputTokens: command.estimatedInputTokens,
        estimatedOutputTokens: command.estimatedOutputTokens,
      })
    }
    const now = this.#instant()
    const job: SiteAiTurnJob = {
      jobId: command.jobId,
      conversationId: command.conversationId,
      snapshotId: command.snapshotId,
      scope: command.authority.scope,
      actor: command.authority.actor,
      authorityRevision: command.authority.revision,
      providerId: command.providerId,
      modelId: command.modelId,
      requiredCapability: command.requiredCapability,
      reservationId,
      state: 'running',
      attempt: command.attempt,
      promptTokens: 0,
      completionTokens: 0,
      failureCode: null,
      createdAt: now,
      updatedAt: now,
    }
    try {
      await this.#repository.putJob(job)
      await this.#audit({
        action: 'site.ai.turn.started',
        authority: command.authority,
        conversationId: command.conversationId,
        snapshotId: command.snapshotId,
        jobId: command.jobId,
        outcome: 'success',
      })
    } catch (error) {
      if (reservationId) {
        await this.#credits!.release({
          reservationId,
          jobId: command.jobId,
          reasonCode: 'job-persistence-failed',
        }).catch(() => {})
      }
      throw error
    }
    return {
      job,
      authority: new SiteAiNativeTurnAuthority(this, job, command.authority),
    }
  }

  repository(): SiteAiRepository {
    return this.#repository
  }

  credits(): SiteAiCreditAuthorityPort | undefined {
    return this.#credits
  }

  instant(): string {
    return this.#instant()
  }

  audit(input: SiteAiAuditInput): Promise<void> {
    return this.#audit(input)
  }
}

class SiteAiNativeTurnAuthority implements AiRuntimeExecutionAuthority {
  readonly #service: SiteAiService
  readonly #job: SiteAiTurnJob
  readonly #authority: SiteAiAuthoritySnapshot
  readonly #claims = new Map<string, SiteAiToolReceipt>()
  #usage: Readonly<{ promptTokens: number; completionTokens: number }> | null = null

  constructor(service: SiteAiService, job: SiteAiTurnJob, authority: SiteAiAuthoritySnapshot) {
    this.#service = service
    this.#job = structuredClone(job)
    this.#authority = structuredClone(authority)
  }

  async verifySnapshot(snapshot: unknown): Promise<void> {
    const binding = await this.#service.repository().snapshot(this.#job.snapshotId)
    const exact = binding
      && binding.conversationId === this.#job.conversationId
      && sameSiteAiScope(binding.scope, this.#job.scope)
      && binding.actorId === this.#job.actor.actorId
      && binding.snapshotHashSha256 === await hashSiteAiSnapshot(snapshot)
    if (!exact) {
      await this.#service.audit({
        action: 'site.ai.turn.denied',
        authority: this.#authority,
        conversationId: this.#job.conversationId,
        snapshotId: this.#job.snapshotId,
        jobId: this.#job.jobId,
        outcome: 'denied',
        reasonCode: 'snapshot-mismatch',
      })
      throw new SiteAiAuthorityError('denied', 'Bound site AI snapshot does not match native context.')
    }
  }

  async revalidate(input: Readonly<{
    phase: AiRuntimeAuthorityPhase
    toolCallId?: string
    toolName?: string
    mutates?: boolean
  }>): Promise<void> {
    const capability = input.mutates ? 'ai.tools.write' : this.#job.requiredCapability
    try {
      await this.#service.revalidate(this.#authority, capability)
      const current = await this.#service.repository().job(this.#job.jobId)
      if (!current || current.state !== 'running'
        || !sameSiteAiScope(current.scope, this.#job.scope)
        || !sameSiteAiActor(current.actor, this.#job.actor)) {
        throw new SiteAiAuthorityError('denied', 'Turn job authority denied.')
      }
    } catch (error) {
      await this.#service.audit({
        action: 'site.ai.turn.denied',
        authority: this.#authority,
        conversationId: this.#job.conversationId,
        snapshotId: this.#job.snapshotId,
        jobId: this.#job.jobId,
        toolCallId: input.toolCallId,
        outcome: 'denied',
        reasonCode: 'authority-revoked',
      })
      throw error
    }
  }

  async authorizeTool(input: Readonly<{
    toolCallId: string
    toolName: string
    mutates: boolean
    input: unknown
  }>): Promise<Readonly<{ replay: AiToolOutput | null }>> {
    const receipt: SiteAiToolReceipt = {
      jobId: this.#job.jobId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      inputHashSha256: await hashSiteAiSnapshot(input.input),
      mutates: input.mutates,
      state: 'started',
      attempt: this.#job.attempt,
      output: null,
      createdAt: this.#service.instant(),
      completedAt: null,
    }
    const claim = await this.#service.repository().claimTool(receipt)
    if (claim.outcome === 'conflict') {
      throw new SiteAiAuthorityError('conflict', 'Tool retry evidence changed.')
    }
    if (claim.outcome === 'in-flight') {
      throw new SiteAiAuthorityError('tool-in-flight', 'Tool call is already in flight.')
    }
    if (claim.outcome === 'replay') {
      if (!claim.receipt.output) throw new SiteAiAuthorityError('conflict', 'Tool receipt has no replay output.')
      return { replay: structuredClone(claim.receipt.output) }
    }
    this.#claims.set(input.toolCallId, receipt)
    await this.#service.audit({
      action: 'site.ai.tool.started',
      authority: this.#authority,
      conversationId: this.#job.conversationId,
      snapshotId: this.#job.snapshotId,
      jobId: this.#job.jobId,
      toolCallId: input.toolCallId,
      outcome: 'success',
    })
    return { replay: null }
  }

  async recordToolResult(input: Readonly<{
    toolCallId: string
    toolName: string
    mutates: boolean
    input: unknown
    output: AiToolOutput
  }>): Promise<void> {
    await this.revalidate({
      phase: 'tool-result',
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      mutates: input.mutates,
    })
    const claim = this.#claims.get(input.toolCallId)
    if (!claim || claim.inputHashSha256 !== await hashSiteAiSnapshot(input.input)) {
      throw new SiteAiAuthorityError('conflict', 'Tool result does not match its claim.')
    }
    await this.#service.repository().completeTool({
      ...claim,
      state: input.output.ok ? 'completed' : 'failed',
      output: structuredClone(input.output),
      completedAt: this.#service.instant(),
    })
    this.#claims.delete(input.toolCallId)
    await this.#service.audit({
      action: input.output.ok ? 'site.ai.tool.completed' : 'site.ai.tool.failed',
      authority: this.#authority,
      conversationId: this.#job.conversationId,
      snapshotId: this.#job.snapshotId,
      jobId: this.#job.jobId,
      toolCallId: input.toolCallId,
      outcome: input.output.ok ? 'success' : 'failure',
      reasonCode: input.output.ok ? null : 'tool-failed',
    })
  }

  async recordUsage(input: Readonly<{
    promptTokens: number
    completionTokens: number
  }>): Promise<void> {
    await this.revalidate({ phase: 'usage' })
    if (this.#usage) {
      if (canonical(this.#usage) !== canonical(input)) {
        throw new SiteAiAuthorityError('conflict', 'Turn usage evidence changed.')
      }
      return
    }
    if (this.#job.reservationId) {
      await this.#service.credits()!.settle({
        reservationId: this.#job.reservationId,
        jobId: this.#job.jobId,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
      })
    }
    this.#usage = structuredClone(input)
  }

  async finish(
    outcome: 'succeeded' | 'failed' | 'cancelled',
    failureCode?: string,
  ): Promise<void> {
    const current = await this.#service.repository().job(this.#job.jobId)
    if (!current) throw new SiteAiAuthorityError('not-found', 'Turn job is unavailable.')
    const nextState = outcome === 'succeeded' ? 'succeeded' : 'failed'
    if (current.state !== 'running') {
      if (current.state === nextState) return
      throw new SiteAiAuthorityError('conflict', 'Turn job is already terminal.')
    }
    if (outcome !== 'succeeded' && current.reservationId) {
      await this.#service.credits()!.release({
        reservationId: current.reservationId,
        jobId: current.jobId,
        reasonCode: failureCode ?? outcome,
      })
    }
    const next: SiteAiTurnJob = {
      ...current,
      state: nextState,
      promptTokens: this.#usage?.promptTokens ?? 0,
      completionTokens: this.#usage?.completionTokens ?? 0,
      failureCode: outcome === 'succeeded' ? null : (failureCode ?? outcome),
      updatedAt: this.#service.instant(),
    }
    if (!await this.#service.repository().updateJob(next, 'running')) {
      throw new SiteAiAuthorityError('conflict', 'Turn job changed concurrently.')
    }
    await this.#service.audit({
      action: outcome === 'succeeded' ? 'site.ai.turn.succeeded' : 'site.ai.turn.failed',
      authority: this.#authority,
      conversationId: this.#job.conversationId,
      snapshotId: this.#job.snapshotId,
      jobId: this.#job.jobId,
      outcome: outcome === 'succeeded' ? 'success' : 'failure',
      reasonCode: outcome === 'succeeded' ? null : (failureCode ?? outcome),
    })
  }
}

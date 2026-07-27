import {
  PublicationPreviewIssueCommandSchema,
  PublicationPreviewIssueResultSchema,
  PublicationPreviewTokenRecordSchema,
  PublicationPublicResolveRequestSchema,
  PublicationPublicResolveResultSchema,
  PublicationScheduleCommandSchema,
  PublicationScheduleRecordSchema,
  parsePublicationContract,
  type PublicationPreviewIssueResult,
  type PublicationPreviewTokenRecord,
  type PublicationPublicResolveResult,
  type PublicationScheduleRecord,
} from '@core/fuma/publication'
import type { FumaJobJsonValue } from '../jobs'
import type { PublicationMemberAccessService } from './memberAccess'
import type { PublicationRepositoryScope } from './scope'
import type { PublicationDomainStore } from './servicePorts'
import type { PublicationEditorialService } from './services'

export type PublicationScheduleClaim = Readonly<{ record: PublicationScheduleRecord; fence: number }>

export interface PublicationSchedulingRepository {
  listRecoveryScopes?(dueAt: string, limit: number): Promise<readonly PublicationRepositoryScope[]>
  putSchedule(scope: PublicationRepositoryScope, record: PublicationScheduleRecord): Promise<boolean>
  listRecoverable(scope: PublicationRepositoryScope, dueAt: string, limit: number): Promise<readonly PublicationScheduleRecord[]>
  claimDue(scope: PublicationRepositoryScope, scheduleId: string, workerId: string, now: string, leaseExpiresAt: string): Promise<PublicationScheduleClaim | null>
  finishClaim(scope: PublicationRepositoryScope, scheduleId: string, workerId: string, fence: number, state: 'completed' | 'superseded', completedAt: string): Promise<boolean>
  putPreviewToken(scope: PublicationRepositoryScope, record: PublicationPreviewTokenRecord): Promise<boolean>
  usePreviewToken(scope: PublicationRepositoryScope, tokenId: string, digestSha256: string, usedAt: string): Promise<PublicationPreviewTokenRecord | null>
  revokePreviewToken(scope: PublicationRepositoryScope, tokenId: string, revokedAt: string): Promise<boolean>
}

export interface PublicationScheduleJobPort {
  enqueue(input: Readonly<{ id: string; organizationId: string; siteId: string; kind: string; payload: FumaJobJsonValue; runAt: string; idempotencyKey: string; maxAttempts?: number }>): Promise<unknown>
}

export class PublicationSchedulingError extends Error {
  readonly code: 'conflict' | 'not-found' | 'invalid-schedule' | 'invalid-preview' | 'preview-expired'
  constructor(code: PublicationSchedulingError['code'], message: string) { super(message); this.name = 'PublicationSchedulingError'; this.code = code }
}

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new PublicationSchedulingError('invalid-schedule', 'Timestamp is invalid.')
  return parsed
}

function validTimezone(value: string): boolean {
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(0); return true } catch { return false }
}

export function formatPublicationSchedule(instant: string, timezone: string): string {
  if (!validTimezone(timezone)) throw new PublicationSchedulingError('invalid-schedule', 'Display timezone is invalid.')
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', timeZoneName: 'shortOffset',
  }).format(new Date(timestamp(instant)))
}

function digest(value: string): string { return new Bun.CryptoHasher('sha256').update(value).digest('hex') }
function tokenSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Buffer.from(bytes).toString('base64url')
}
function scopeIdentity(scope: PublicationRepositoryScope): string {
  return [scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId, scope.ownerKey, scope.generation, scope.profileId].join(':')
}
function scheduleJobId(scope: PublicationRepositoryScope, scheduleId: string): string { return `publication-schedule-${digest(`${scopeIdentity(scope)}:${scheduleId}`).slice(0, 32)}` }

export class PublicationSchedulingService {
  readonly #repository: PublicationSchedulingRepository
  readonly #domain: PublicationDomainStore
  readonly #editorial: Pick<PublicationEditorialService, 'publishDue' | 'transition'>
  readonly #members: Pick<PublicationMemberAccessService, 'evaluate'>
  readonly #jobs: PublicationScheduleJobPort
  readonly #now: () => Date
  readonly #leaseMs: number

  constructor(input: Readonly<{
    repository: PublicationSchedulingRepository
    domain: PublicationDomainStore
    editorial: Pick<PublicationEditorialService, 'publishDue' | 'transition'>
    members: Pick<PublicationMemberAccessService, 'evaluate'>
    jobs: PublicationScheduleJobPort
    now?: () => Date
    leaseMs?: number
  }>) {
    this.#repository = input.repository; this.#domain = input.domain; this.#editorial = input.editorial; this.#members = input.members; this.#jobs = input.jobs
    this.#now = input.now ?? (() => new Date()); this.#leaseMs = input.leaseMs ?? 30_000
  }

  async schedule(scope: PublicationRepositoryScope, raw: unknown): Promise<PublicationScheduleRecord> {
    const command = parsePublicationContract('schedule command', PublicationScheduleCommandSchema, raw)
    const now = this.#now().getTime()
    if (!validTimezone(command.displayTimezone) || timestamp(command.dueAt) <= now) throw new PublicationSchedulingError('invalid-schedule', 'Schedule must be a future absolute instant with a valid IANA display timezone.')
    const content = await this.#domain.getContent(scope, command.contentId)
    if (!content || content.workflowVersion !== command.expectedWorkflowVersion) throw new PublicationSchedulingError('not-found', 'Scheduled content version was not found.')
    if (command.action === 'publish' ? content.status !== 'scheduled' || content.scheduledAt !== command.dueAt : content.status !== 'published') {
      throw new PublicationSchedulingError('invalid-schedule', 'Content lifecycle is incompatible with the requested schedule action.')
    }
    const record = parsePublicationContract('schedule record', PublicationScheduleRecordSchema, {
      ...command, state: 'pending', claimFence: 0, claimedBy: null, claimExpiresAt: null, completedAt: null, createdAt: this.#now().toISOString(),
    })
    if (!await this.#repository.putSchedule(scope, record)) throw new PublicationSchedulingError('conflict', 'An active schedule already exists.')
    try { await this.#enqueue(scope, record) } catch (error) { console.warn('[fuma:publication] durable schedule enqueue failed; restart recovery will retry:', error) }
    return record
  }

  async recover(scope: PublicationRepositoryScope, limit = 500): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new PublicationSchedulingError('invalid-schedule', 'Recovery limit is invalid.')
    const records = await this.#repository.listRecoverable(scope, this.#now().toISOString(), limit)
    let recovered = 0
    for (const record of records) {
      try { await this.#enqueue(scope, record); recovered += 1 } catch (error) { console.warn('[fuma:publication] missed schedule remains recoverable:', error) }
    }
    return recovered
  }

  async recoverAll(scopeLimit = 100, scheduleLimit = 500): Promise<number> {
    if (!Number.isInteger(scopeLimit) || scopeLimit < 1 || scopeLimit > 100 || !this.#repository.listRecoveryScopes) {
      throw new PublicationSchedulingError('invalid-schedule', 'Recovery scope limit is invalid or unavailable.')
    }
    const scopes = await this.#repository.listRecoveryScopes(this.#now().toISOString(), scopeLimit)
    let recovered = 0
    for (const scope of scopes) recovered += await this.recover(scope, scheduleLimit)
    return recovered
  }

  async runDue(scope: PublicationRepositoryScope, scheduleId: string, workerId: string): Promise<Readonly<{ scheduleId: string; applied: boolean; state: 'completed' | 'superseded' }>> {
    const now = this.#now(); const nowIso = now.toISOString()
    const claim = await this.#repository.claimDue(scope, scheduleId, workerId, nowIso, new Date(now.getTime() + this.#leaseMs).toISOString())
    if (!claim) return Object.freeze({ scheduleId, applied: false, state: 'completed' })
    const { record, fence } = claim
    const current = await this.#domain.getContent(scope, record.contentId)
    let applied = false
    if (record.action === 'publish') {
      const published = await this.#editorial.publishDue(scope, { contentId: record.contentId, workflowVersion: record.expectedWorkflowVersion, actorId: workerId, now: nowIso })
      applied = published !== null
    } else if (current?.status === 'published' && current.workflowVersion === record.expectedWorkflowVersion) {
      await this.#editorial.transition(scope, { transitionId: `scheduled-unpublish-${record.scheduleId}`, contentId: record.contentId, from: 'published', to: 'unpublished', actorId: workerId, expectedVersion: record.expectedWorkflowVersion, scheduledAt: null, note: 'Unpublished by durable schedule.', createdAt: nowIso })
      applied = true
    }
    const after = await this.#domain.getContent(scope, record.contentId)
    const reachedTarget = after !== null && after.workflowVersion === record.expectedWorkflowVersion + 1 && (record.action === 'publish' ? after.status === 'published' : after.status === 'unpublished')
    const state = reachedTarget ? 'completed' as const : 'superseded' as const
    if (!await this.#repository.finishClaim(scope, record.scheduleId, workerId, fence, state, nowIso)) throw new PublicationSchedulingError('conflict', 'Schedule claim fence was lost.')
    return Object.freeze({ scheduleId, applied, state })
  }

  async issuePreview(scope: PublicationRepositoryScope, raw: unknown): Promise<PublicationPreviewIssueResult> {
    const command = parsePublicationContract('preview issue command', PublicationPreviewIssueCommandSchema, raw)
    const now = this.#now(); const expires = timestamp(command.expiresAt)
    if (expires <= now.getTime() || expires - now.getTime() > 30 * 86_400_000) throw new PublicationSchedulingError('invalid-preview', 'Preview expiry must be within 30 days.')
    if (!await this.#domain.getContent(scope, command.contentId)) throw new PublicationSchedulingError('not-found', 'Preview content was not found.')
    const token = `${command.tokenId}.${tokenSecret()}`
    const record = parsePublicationContract('preview token record', PublicationPreviewTokenRecordSchema, { ...command, tokenDigestSha256: digest(token), createdAt: now.toISOString(), revokedAt: null, lastUsedAt: null, useCount: 0 })
    if (!await this.#repository.putPreviewToken(scope, record)) throw new PublicationSchedulingError('conflict', 'Preview token identity conflicts.')
    return parsePublicationContract('preview issue result', PublicationPreviewIssueResultSchema, { tokenId: command.tokenId, contentId: command.contentId, token, expiresAt: command.expiresAt, createdAt: record.createdAt })
  }

  async revokePreview(scope: PublicationRepositoryScope, tokenId: string): Promise<boolean> { return await this.#repository.revokePreviewToken(scope, tokenId, this.#now().toISOString()) }

  async resolve(scope: PublicationRepositoryScope, raw: unknown, memberIdentityId: string | null, origin: string): Promise<PublicationPublicResolveResult> {
    const request = parsePublicationContract('public resolve request', PublicationPublicResolveRequestSchema, raw)
    const now = this.#now().toISOString()
    let preview = false
    if (request.previewToken !== null) {
      const separator = request.previewToken.lastIndexOf('.')
      if (separator < 1) throw new PublicationSchedulingError('invalid-preview', 'Preview token is invalid.')
      const tokenId = request.previewToken.slice(0, separator)
      const token = await this.#repository.usePreviewToken(scope, tokenId, digest(request.previewToken), now)
      if (!token || token.contentId !== request.contentId) throw new PublicationSchedulingError('preview-expired', 'Preview token is expired, revoked, or invalid.')
      preview = true
    }
    const evaluation = await this.#members.evaluate(scope, { memberIdentityId, contentId: request.contentId, mode: preview ? 'preview' : 'public', origin, requestedPath: request.requestedPath, evaluatedAt: now })
    const content = await this.#domain.getContent(scope, request.contentId)
    if (!content) throw new PublicationSchedulingError('not-found', 'Publication content was not found.')
    const audience = preview ? 'preview' : content.metadata.visibility.kind === 'paid' ? 'paid' : content.metadata.visibility.kind === 'segment' ? 'segment' : content.metadata.visibility.kind === 'member' ? 'member' : 'anonymous'
    return parsePublicationContract('public resolve result', PublicationPublicResolveResultSchema, { contentId: request.contentId, audience, presentation: evaluation.presentation })
  }

  async #enqueue(scope: PublicationRepositoryScope, record: PublicationScheduleRecord): Promise<void> {
    await this.#jobs.enqueue({ id: scheduleJobId(scope, record.scheduleId), organizationId: scope.organizationId, siteId: scope.siteId, kind: 'publication.schedule-due', payload: { scheduleId: record.scheduleId }, runAt: record.dueAt, maxAttempts: 20, idempotencyKey: `publication-schedule:${scopeIdentity(scope)}:${record.scheduleId}` })
  }
}

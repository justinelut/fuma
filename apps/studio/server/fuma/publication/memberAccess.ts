import {
  PublicationAccessEvaluationRequestSchema,
  PublicationAccessEvaluationSchema,
  PublicationMemberAccessSchema,
  PublicationMemberAccountSchema,
  PublicationMemberExportSchema,
  PublicationMemberSegmentSchema,
  PublicationNewsletterConsentEventSchema,
  PublicationNewsletterConsentStateSchema,
  PublicationPrivacyRequestSchema,
  PublicationSegmentMembershipSnapshotSchema,
  parsePublicationContract,
  type PublicationAccessEvaluation,
  type PublicationAccessEvaluationRequest,
  type PublicationContent,
  type PublicationMember,
  type PublicationMemberAccess,
  type PublicationMemberAccount,
  type PublicationMemberExport,
  type PublicationMemberSegment,
  type PublicationNewsletterConsentEvent,
  type PublicationNewsletterConsentState,
  type PublicationPrivacyRequest,
  type PublicationSegmentMembershipSnapshot,
} from '@core/fuma/publication'
import type { PublicationRepositoryScope } from './scope'
import type { PublicationDomainStore, PublicationIdAuthority } from './servicePorts'
import { decidePublicationPresentation } from './presentation'
import { memberMatchesSegment } from './services'

export type PublicationMemberPage = Readonly<{ limit: number; afterId: string | null }>

export interface PublicationMemberAccessRepository {
  putAccount(scope: PublicationRepositoryScope, account: PublicationMemberAccount, expectedUpdatedAt: string | null): Promise<boolean>
  getAccount(scope: PublicationRepositoryScope, accountId: string): Promise<PublicationMemberAccount | null>
  getAccountByIdentity(scope: PublicationRepositoryScope, memberIdentityId: string): Promise<PublicationMemberAccount | null>
  listAccounts(scope: PublicationRepositoryScope, page?: PublicationMemberPage): Promise<readonly PublicationMemberAccount[]>
  appendConsent(scope: PublicationRepositoryScope, event: PublicationNewsletterConsentEvent): Promise<boolean>
  listConsents(scope: PublicationRepositoryScope, memberId: string, limit?: number): Promise<readonly PublicationNewsletterConsentEvent[]>
  putMemberSegment(scope: PublicationRepositoryScope, segment: PublicationMemberSegment, expectedVersion: number | null): Promise<boolean>
  getMemberSegment(scope: PublicationRepositoryScope, segmentId: string): Promise<PublicationMemberSegment | null>
  listMemberSegments(scope: PublicationRepositoryScope, page?: PublicationMemberPage): Promise<readonly PublicationMemberSegment[]>
  replaceSegmentSnapshot(scope: PublicationRepositoryScope, snapshot: PublicationSegmentMembershipSnapshot): Promise<boolean>
  listMemberSegmentSnapshots(scope: PublicationRepositoryScope, memberId: string, limit?: number): Promise<readonly PublicationSegmentMembershipSnapshot[]>
  putAccess(scope: PublicationRepositoryScope, access: PublicationMemberAccess): Promise<boolean>
  getAccess(scope: PublicationRepositoryScope, accessId: string): Promise<PublicationMemberAccess | null>
  updateAccessState(scope: PublicationRepositoryScope, accessId: string, memberId: string, state: PublicationMemberAccess['state'], updatedAt: string): Promise<boolean>
  listAccess(scope: PublicationRepositoryScope, memberId: string, limit?: number): Promise<readonly PublicationMemberAccess[]>
  putPrivacyRequest(scope: PublicationRepositoryScope, request: PublicationPrivacyRequest): Promise<boolean>
  getPrivacyRequest(scope: PublicationRepositoryScope, requestId: string): Promise<PublicationPrivacyRequest | null>
  beginDeletion(scope: PublicationRepositoryScope, request: PublicationPrivacyRequest, account: PublicationMemberAccount, expectedUpdatedAt: string): Promise<boolean>
  completeDeletion(scope: PublicationRepositoryScope, request: PublicationPrivacyRequest, account: PublicationMemberAccount): Promise<boolean>
}

export class PublicationMemberAccessError extends Error {
  readonly code: 'conflict' | 'not-found' | 'rate-limited' | 'invalid-access' | 'deletion-pending'
  constructor(code: PublicationMemberAccessError['code'], message = 'Member account unavailable.') {
    super(message)
    this.code = code
    this.name = 'PublicationMemberAccessError'
  }
}

export interface PublicationMemberOperationLimiter {
  consume(bucket: string, limit: number, windowMs: number, nowMs: number): boolean
}

export class MemoryPublicationMemberOperationLimiter implements PublicationMemberOperationLimiter {
  readonly #attempts = new Map<string, number[]>()
  consume(bucket: string, limit: number, windowMs: number, nowMs: number): boolean {
    const current = (this.#attempts.get(bucket) ?? []).filter((value) => value > nowMs - windowMs)
    if (current.length >= limit) return false
    current.push(nowMs)
    this.#attempts.set(bucket, current)
    return true
  }
}

const OPERATION_LIMIT = Object.freeze({ writes: 30, exports: 3, deletions: 3, windowMs: 60 * 60 * 1000 })
const MAX_EXPORT_ROWS = 10_000
const DEFAULT_PAGE = Object.freeze({ limit: 100, afterId: null })

function scopeKey(scope: PublicationRepositoryScope): string {
  return [scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId, scope.ownerKey, scope.generation, scope.profileId].join('\0')
}

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new PublicationMemberAccessError('conflict')
  return parsed
}

function currentAccessState(value: PublicationMemberAccess, nowMs: number): PublicationMemberAccess['state'] {
  if (value.state === 'revoked' || value.state === 'expired') return value.state
  if (timestamp(value.startsAt) > nowMs) return 'expired'
  if (value.state === 'grace') return value.graceEndsAt !== null && timestamp(value.graceEndsAt) > nowMs ? 'grace' : 'expired'
  if (value.expiresAt === null || timestamp(value.expiresAt) > nowMs) return 'active'
  if (value.graceEndsAt !== null && timestamp(value.graceEndsAt) > nowMs) return 'grace'
  return 'expired'
}

function accessApplies(value: PublicationMemberAccess, content: PublicationContent, siteId: string): boolean {
  return (value.resourceKind === 'publication' && value.resourceId === siteId)
    || (value.resourceKind === 'post' && value.resourceId === content.contentId)
    || (value.resourceKind === 'tag' && content.metadata.tagIds.includes(value.resourceId))
}

function stateRank(value: PublicationAccessEvaluation['accessState']): number {
  return ['anonymous', 'expired', 'revoked', 'disabled', 'grace', 'active'].indexOf(value)
}

function boundedPage(page: PublicationMemberPage = DEFAULT_PAGE): PublicationMemberPage {
  if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > 200 || (page.afterId !== null && (page.afterId.length < 1 || page.afterId.length > 255))) {
    throw new PublicationMemberAccessError('conflict', 'Member list page is invalid.')
  }
  return Object.freeze({ limit: page.limit, afterId: page.afterId })
}

function sameConsent(left: PublicationNewsletterConsentEvent, right: PublicationNewsletterConsentEvent): number {
  return left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId)
}

export class PublicationMemberAccessService {
  readonly #repository: PublicationMemberAccessRepository
  readonly #domain: PublicationDomainStore
  readonly #ids: PublicationIdAuthority
  readonly #now: () => Date
  readonly #limiter: PublicationMemberOperationLimiter

  constructor(input: Readonly<{
    repository: PublicationMemberAccessRepository
    domain: PublicationDomainStore
    ids: PublicationIdAuthority
    now?: () => Date
    limiter?: PublicationMemberOperationLimiter
  }>) {
    this.#repository = input.repository
    this.#domain = input.domain
    this.#ids = input.ids
    this.#now = input.now ?? (() => new Date())
    this.#limiter = input.limiter ?? new MemoryPublicationMemberOperationLimiter()
  }

  listAccounts(scope: PublicationRepositoryScope, page?: PublicationMemberPage): Promise<readonly PublicationMemberAccount[]> {
    return this.#repository.listAccounts(scope, boundedPage(page))
  }

  listSegments(scope: PublicationRepositoryScope, page?: PublicationMemberPage): Promise<readonly PublicationMemberSegment[]> {
    return this.#repository.listMemberSegments(scope, boundedPage(page))
  }

  listAccess(scope: PublicationRepositoryScope, memberId: string, limit = 200): Promise<readonly PublicationMemberAccess[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new PublicationMemberAccessError('conflict')
    return this.#repository.listAccess(scope, memberId, limit)
  }

  async audienceForIdentity(scope: PublicationRepositoryScope, memberIdentityId: string): Promise<Readonly<{
    member: boolean
    paid: boolean
    memberId: string | null
    memberSource: 'none' | 'registered' | 'complimentary' | 'manual' | 'paid'
    segmentIds: readonly string[]
  }>> {
    const account = await this.#repository.getAccountByIdentity(scope, memberIdentityId)
    const member = account?.state === 'active' ? await this.#domain.getMember(scope, account.memberId) : null
    if (!account || !member || member.status === 'blocked' || member.status === 'unsubscribed') {
      return Object.freeze({ member: false, paid: false, memberId: null, memberSource: 'none', segmentIds: Object.freeze([]) })
    }
    const segmentIds = Object.freeze([
      ...new Set((await this.#repository.listMemberSegmentSnapshots(scope, member.memberId, MAX_EXPORT_ROWS)).map((item) => item.segmentId)),
    ].toSorted())
    const nowMs = this.#now().getTime()
    const usable = (await this.#repository.listAccess(scope, member.memberId, MAX_EXPORT_ROWS))
      .filter((item) => item.access === 'premium')
      .map((item) => ({ item, state: currentAccessState(item, nowMs) }))
      .filter(({ state }) => state === 'active' || state === 'grace')
      .map(({ item }) => item)
    const sources = new Set(usable.map((item) => item.source))
    const memberSource = sources.has('paid') ? 'paid'
      : sources.has('manual') ? 'manual'
        : sources.has('complimentary') ? 'complimentary'
          : 'registered'
    return Object.freeze({ member: true, paid: usable.length > 0, memberId: member.memberId, memberSource, segmentIds })
  }

  async saveAccount(scope: PublicationRepositoryScope, raw: unknown, expectedUpdatedAt: string | null): Promise<PublicationMemberAccount> {
    const account = parsePublicationContract('member account', PublicationMemberAccountSchema, raw)
    this.#rate(scope, account.memberIdentityId, 'account-write', OPERATION_LIMIT.writes)
    const createdAt = timestamp(account.createdAt)
    const updatedAt = timestamp(account.updatedAt)
    if (updatedAt < createdAt || (account.state === 'deleted') !== (account.deletedAt !== null) || (account.deletedAt !== null && timestamp(account.deletedAt) !== updatedAt)) {
      throw new PublicationMemberAccessError('conflict')
    }
    const member = await this.#domain.getMember(scope, account.memberId)
    if (!member || member.status === 'blocked') throw new PublicationMemberAccessError('not-found')
    if (!await this.#repository.putAccount(scope, account, expectedUpdatedAt)) throw new PublicationMemberAccessError('conflict')
    return account
  }

  async recordConsent(scope: PublicationRepositoryScope, raw: unknown): Promise<PublicationNewsletterConsentEvent> {
    const event = parsePublicationContract('newsletter consent event', PublicationNewsletterConsentEventSchema, raw)
    this.#rate(scope, event.accountId, 'consent', OPERATION_LIMIT.writes)
    const receiptRequired = event.source === 'staff-import' || event.source === 'one-click'
    if (receiptRequired !== (event.sourceReceiptId !== null)) throw new PublicationMemberAccessError('conflict', 'Consent provenance receipt is invalid.')
    const account = await this.#repository.getAccount(scope, event.accountId)
    if (!account || account.memberId !== event.memberId || account.state === 'deleted') throw new PublicationMemberAccessError('not-found')
    if (!await this.#repository.appendConsent(scope, event)) throw new PublicationMemberAccessError('conflict')
    return event
  }

  async consentState(scope: PublicationRepositoryScope, memberId: string, newsletterId: string | null): Promise<PublicationNewsletterConsentState> {
    const account = (await this.#repository.listAccounts(scope, { limit: 200, afterId: null })).find((item) => item.memberId === memberId)
    if (!account || account.state === 'deleted') throw new PublicationMemberAccessError('not-found')
    const provenance = (await this.#repository.listConsents(scope, memberId, MAX_EXPORT_ROWS))
      .filter((event) => event.newsletterId === null || event.newsletterId === newsletterId)
      .sort(sameConsent)
      .at(-1) ?? null
    return parsePublicationContract('newsletter consent state', PublicationNewsletterConsentStateSchema, {
      memberId,
      newsletterId,
      subscribed: provenance?.action === 'subscribed',
      provenance,
    })
  }

  async saveSegment(scope: PublicationRepositoryScope, raw: unknown, expectedVersion: number | null): Promise<PublicationMemberSegment> {
    const segment = parsePublicationContract('member segment', PublicationMemberSegmentSchema, raw)
    this.#rate(scope, segment.segmentId, 'segment-write', OPERATION_LIMIT.writes)
    if (segment.kind === 'explicit' ? segment.rules.length !== 0 : segment.rules.length === 0 || segment.explicitMemberIds.length !== 0) {
      throw new PublicationMemberAccessError('conflict', 'Explicit segments contain member IDs; dynamic segments contain rules.')
    }
    if ((expectedVersion === null && segment.version !== 1) || (expectedVersion !== null && segment.version !== expectedVersion + 1)) throw new PublicationMemberAccessError('conflict')
    if (!await this.#repository.putMemberSegment(scope, segment, expectedVersion)) throw new PublicationMemberAccessError('conflict')
    return segment
  }

  async recalculateSegment(scope: PublicationRepositoryScope, segmentId: string, calculatedAt = this.#now().toISOString()): Promise<PublicationSegmentMembershipSnapshot> {
    const segment = await this.#repository.getMemberSegment(scope, segmentId)
    if (!segment) throw new PublicationMemberAccessError('not-found')
    this.#rate(scope, segment.segmentId, 'segment-recalculate', OPERATION_LIMIT.writes)
    const members = await this.#domain.listMembers(scope)
    const allowed = new Map(members.filter((member) => member.status !== 'blocked' && member.status !== 'unsubscribed').map((member) => [member.memberId, member]))
    const memberIds = segment.kind === 'explicit'
      ? segment.explicitMemberIds.filter((memberId) => allowed.has(memberId))
      : [...allowed.values()].filter((member) => memberMatchesSegment(member, segment)).map((member) => member.memberId)
    const snapshot = parsePublicationContract('segment membership snapshot', PublicationSegmentMembershipSnapshotSchema, {
      segmentId: segment.segmentId,
      segmentVersion: segment.version,
      memberIds: [...new Set(memberIds)].toSorted(),
      calculatedAt,
    })
    if (!await this.#repository.replaceSegmentSnapshot(scope, snapshot)) throw new PublicationMemberAccessError('conflict')
    return snapshot
  }

  async grantAccess(scope: PublicationRepositoryScope, raw: unknown): Promise<PublicationMemberAccess> {
    const access = parsePublicationContract('member access', PublicationMemberAccessSchema, raw)
    this.#rate(scope, access.memberId, 'access-write', OPERATION_LIMIT.writes)
    const member = await this.#domain.getMember(scope, access.memberId)
    const account = (await this.#repository.listAccounts(scope, { limit: 200, afterId: null })).find((item) => item.memberId === access.memberId)
    if (!member || member.status === 'blocked' || member.status === 'unsubscribed' || !account || account.state !== 'active') throw new PublicationMemberAccessError('not-found')
    if ((access.source === 'paid') !== (access.paymentReferenceSha256 !== null)) throw new PublicationMemberAccessError('invalid-access', 'Paid access requires a verified payment reference digest; non-paid access cannot carry one.')
    const startsAt = timestamp(access.startsAt)
    if (access.expiresAt !== null && timestamp(access.expiresAt) <= startsAt) throw new PublicationMemberAccessError('invalid-access')
    if (access.graceEndsAt !== null && (access.expiresAt === null || timestamp(access.graceEndsAt) <= timestamp(access.expiresAt))) throw new PublicationMemberAccessError('invalid-access')
    if (access.state === 'grace' && access.graceEndsAt === null) throw new PublicationMemberAccessError('invalid-access')
    if (timestamp(access.updatedAt) < timestamp(access.createdAt)) throw new PublicationMemberAccessError('invalid-access')
    if (!await this.#repository.putAccess(scope, access)) throw new PublicationMemberAccessError('conflict')
    return access
  }

  async transitionAccess(scope: PublicationRepositoryScope, accessId: string, memberId: string, state: PublicationMemberAccess['state'], updatedAt = this.#now().toISOString()): Promise<PublicationMemberAccess> {
    this.#rate(scope, memberId, 'access-write', OPERATION_LIMIT.writes)
    const current = await this.#repository.getAccess(scope, accessId)
    if (!current || current.memberId !== memberId) throw new PublicationMemberAccessError('not-found')
    const allowed: Readonly<Record<PublicationMemberAccess['state'], readonly PublicationMemberAccess['state'][]>> = {
      active: ['grace', 'expired', 'revoked'],
      grace: ['expired', 'revoked'],
      expired: ['revoked'],
      revoked: [],
    }
    if (!allowed[current.state].includes(state) || timestamp(updatedAt) < timestamp(current.updatedAt)) throw new PublicationMemberAccessError('invalid-access')
    if (!await this.#repository.updateAccessState(scope, accessId, memberId, state, updatedAt)) throw new PublicationMemberAccessError('conflict')
    return parsePublicationContract('member access', PublicationMemberAccessSchema, { ...current, state, updatedAt })
  }

  async evaluate(scope: PublicationRepositoryScope, raw: unknown): Promise<PublicationAccessEvaluation> {
    const request = parsePublicationContract('member access evaluation request', PublicationAccessEvaluationRequestSchema, raw) as PublicationAccessEvaluationRequest
    const content = await this.#domain.getContent(scope, request.contentId)
    if (!content) throw new PublicationMemberAccessError('not-found')
    let account: PublicationMemberAccount | null = null
    let member: PublicationMember | null = null
    if (request.memberIdentityId !== null) {
      account = await this.#repository.getAccountByIdentity(scope, request.memberIdentityId)
      if (account?.state === 'active') member = await this.#domain.getMember(scope, account.memberId)
    }
    const eligible = Boolean(account && member && member.status !== 'blocked' && member.status !== 'unsubscribed')
    const snapshots = eligible ? await this.#repository.listMemberSegmentSnapshots(scope, member!.memberId, 10_000) : []
    const segmentIds = [...new Set(snapshots.map((snapshot) => snapshot.segmentId))].toSorted()
    const nowMs = timestamp(request.evaluatedAt)
    const allAccess = eligible ? await this.#repository.listAccess(scope, member!.memberId, MAX_EXPORT_ROWS) : []
    const applicable = allAccess.filter((value) => value.access === 'premium' && accessApplies(value, content, scope.siteId))
      .map((value) => ({ value, state: currentAccessState(value, nowMs) }))
    const usable = applicable.filter(({ state }) => state === 'active' || state === 'grace')
    const accessSources = [...new Set(usable.map(({ value }) => value.source))].toSorted()
    const accessState: PublicationAccessEvaluation['accessState'] = !account
      ? 'anonymous'
      : !eligible
        ? 'disabled'
        : applicable.length === 0
          ? 'active'
          : applicable.reduce<PublicationAccessEvaluation['accessState']>((best, item) => stateRank(item.state) > stateRank(best) ? item.state : best, 'expired')
    const audience = { member: eligible, paid: usable.length > 0, segmentIds }
    const presentation = decidePublicationPresentation(content, { mode: request.mode, origin: request.origin, requestedPath: request.requestedPath, audience })
    return parsePublicationContract('member access evaluation', PublicationAccessEvaluationSchema, {
      accountId: account?.accountId ?? null,
      memberId: member?.memberId ?? null,
      ...audience,
      accessSources,
      accessState,
      presentation,
    })
  }

  async export(scope: PublicationRepositoryScope, accountId: string, requestedBy: PublicationPrivacyRequest['requestedBy']): Promise<PublicationMemberExport> {
    this.#rate(scope, accountId, 'export', OPERATION_LIMIT.exports)
    const account = await this.#requiredAccount(scope, accountId)
    const member = await this.#domain.getMember(scope, account.memberId)
    if (!member) throw new PublicationMemberAccessError('not-found')
    const now = this.#now().toISOString()
    const request = parsePublicationContract('privacy request', PublicationPrivacyRequestSchema, { requestId: this.#ids.id('privacy-export'), accountId, memberId: account.memberId, kind: 'export', state: 'completed', requestedBy, reason: '', createdAt: now, completedAt: now })
    if (!await this.#repository.putPrivacyRequest(scope, request)) throw new PublicationMemberAccessError('conflict')
    return parsePublicationContract('member export', PublicationMemberExportSchema, {
      exportId: request.requestId,
      generatedAt: now,
      account,
      member,
      newsletterConsents: await this.#repository.listConsents(scope, account.memberId, MAX_EXPORT_ROWS),
      segments: await this.#repository.listMemberSegmentSnapshots(scope, account.memberId, 10_000),
      access: await this.#repository.listAccess(scope, account.memberId, MAX_EXPORT_ROWS),
    })
  }

  async requestDeletion(scope: PublicationRepositoryScope, accountId: string, requestedBy: PublicationPrivacyRequest['requestedBy'], reason: string): Promise<PublicationPrivacyRequest> {
    this.#rate(scope, accountId, 'deletion', OPERATION_LIMIT.deletions)
    const account = await this.#requiredAccount(scope, accountId)
    if (account.state === 'deletion-pending') throw new PublicationMemberAccessError('deletion-pending')
    if (account.state !== 'active' && account.state !== 'disabled') throw new PublicationMemberAccessError('not-found')
    const now = this.#now().toISOString()
    const request = parsePublicationContract('privacy request', PublicationPrivacyRequestSchema, { requestId: this.#ids.id('privacy-deletion'), accountId, memberId: account.memberId, kind: 'deletion', state: 'pending', requestedBy, reason, createdAt: now, completedAt: null })
    const pending = parsePublicationContract('member account', PublicationMemberAccountSchema, { ...account, state: 'deletion-pending', updatedAt: now })
    if (!await this.#repository.beginDeletion(scope, request, pending, account.updatedAt)) throw new PublicationMemberAccessError('conflict')
    return request
  }

  async completeDeletion(scope: PublicationRepositoryScope, raw: unknown): Promise<PublicationPrivacyRequest> {
    const request = parsePublicationContract('privacy request', PublicationPrivacyRequestSchema, raw)
    if (request.kind !== 'deletion' || request.state !== 'completed' || request.completedAt === null || timestamp(request.completedAt) < timestamp(request.createdAt)) throw new PublicationMemberAccessError('conflict')
    const pendingRequest = await this.#repository.getPrivacyRequest(scope, request.requestId)
    if (!pendingRequest || pendingRequest.kind !== 'deletion' || !['pending', 'processing'].includes(pendingRequest.state)
      || pendingRequest.accountId !== request.accountId || pendingRequest.memberId !== request.memberId
      || pendingRequest.requestedBy !== request.requestedBy || pendingRequest.reason !== request.reason || pendingRequest.createdAt !== request.createdAt) {
      throw new PublicationMemberAccessError('not-found')
    }
    const account = await this.#requiredAccount(scope, request.accountId)
    if (account.state !== 'deletion-pending' || account.memberId !== request.memberId) throw new PublicationMemberAccessError('conflict')
    const deleted = parsePublicationContract('member account', PublicationMemberAccountSchema, {
      ...account,
      displayName: '',
      locale: 'und',
      timezone: 'Etc/UTC',
      state: 'deleted',
      updatedAt: request.completedAt,
      deletedAt: request.completedAt,
    })
    if (!await this.#repository.completeDeletion(scope, request, deleted)) throw new PublicationMemberAccessError('conflict')
    return request
  }

  async #requiredAccount(scope: PublicationRepositoryScope, accountId: string): Promise<PublicationMemberAccount> {
    const account = await this.#repository.getAccount(scope, accountId)
    if (!account || account.state === 'deleted') throw new PublicationMemberAccessError('not-found')
    return account
  }

  #rate(scope: PublicationRepositoryScope, subject: string, operation: string, limit: number): void {
    if (!this.#limiter.consume(`${operation}:${scopeKey(scope)}:${subject}`, limit, OPERATION_LIMIT.windowMs, this.#now().getTime())) {
      throw new PublicationMemberAccessError('rate-limited', 'Too many member account requests.')
    }
  }
}

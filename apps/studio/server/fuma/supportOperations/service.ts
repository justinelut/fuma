import type { AuditService } from '../audit'
import { assertFumaRequestContext, type FumaRequestContext } from '../context'
import { FumaRepositoryScopeSchema, type FumaRepositoryScope } from '../tenancy'
import { Value } from '@core/utils/typeboxHelpers'
import {
  ApproveBreakGlassCommandSchema,
  BeginSupportCommandSchema,
  BreakGlassApprovalRecordSchema,
  BreakGlassExecutionRecordSchema,
  BreakGlassRequestRecordSchema,
  CreateBreakGlassRequestSchema,
  CurrentStaffAuthoritySchema,
  EndSupportCommandSchema,
  ExecuteBreakGlassCommandSchema,
  ListModerationQueueCommandSchema,
  ModerationEvidenceRecordSchema,
  ModerationQueuePageSchema,
  RecordModerationCommandSchema,
  SupportActionCommandSchema,
  SupportActionRecordSchema,
  SupportOperationsError,
  SupportOperationEffectRecordSchema,
  SupportSessionEndRecordSchema,
  SupportSessionRecordSchema,
  SupportTargetAuthoritySchema,
  parseSupportContract,
  supportEvidenceHash,
  type BreakGlassApprovalRecord,
  type BreakGlassExecutionRecord,
  type BreakGlassRequestRecord,
  type CurrentStaffAuthority,
  type ImmutableEvidenceReference,
  type ModerationEvidenceRecord,
  type ModerationQueue,
  type ModerationQueuePage,
  type ModerationSubject,
  type SupportActionRecord,
  type SupportOperationEffectKind,
  type SupportOperationEffectRecord,
  type SupportSessionEndRecord,
  type SupportSessionRecord,
  type SupportTargetAuthority,
  type SupportTenantScope,
} from './contracts'

export interface SupportOperationsRepository {
  insertSupportSession(record: SupportSessionRecord): Promise<boolean>
  readSupportSession(sessionId: string): Promise<SupportSessionRecord | null>
  findActiveSupportSession(scope: SupportTenantScope, staffActorId: string, targetUserId: string, at: string): Promise<SupportSessionRecord | null>
  insertSupportSessionEnd(record: SupportSessionEndRecord): Promise<boolean>
  readSupportSessionEnd(sessionId: string): Promise<SupportSessionEndRecord | null>
  insertSupportAction(record: SupportActionRecord): Promise<boolean>
  readSupportAction(operationId: string): Promise<SupportActionRecord | null>
  insertModerationEvidence(record: ModerationEvidenceRecord): Promise<boolean>
  readModerationEvidence(evidenceId: string): Promise<ModerationEvidenceRecord | null>
  latestModerationEvidence(scope: SupportTenantScope, subjectKind: string, subjectId: string): Promise<ModerationEvidenceRecord | null>
  listModerationQueue(scope: SupportTenantScope, queue: ModerationQueue, afterEvidenceId: string | null, limit: number): Promise<readonly ModerationEvidenceRecord[]>
  insertBreakGlassRequest(record: BreakGlassRequestRecord): Promise<boolean>
  readBreakGlassRequest(requestId: string): Promise<BreakGlassRequestRecord | null>
  insertBreakGlassApproval(record: BreakGlassApprovalRecord): Promise<boolean>
  readBreakGlassApproval(approvalId: string): Promise<BreakGlassApprovalRecord | null>
  listBreakGlassApprovals(requestId: string): Promise<readonly BreakGlassApprovalRecord[]>
  insertBreakGlassExecution(record: BreakGlassExecutionRecord): Promise<boolean>
  readBreakGlassExecution(requestId: string): Promise<BreakGlassExecutionRecord | null>
  insertEffect(record: SupportOperationEffectRecord): Promise<boolean>
  readEffect(effectKey: string): Promise<SupportOperationEffectRecord | null>
  runEffect(record: SupportOperationEffectRecord, execute: () => Promise<void>): Promise<boolean>
}

export interface SupportAuthorityResolver {
  resolveDirect(input: Readonly<{ context: FumaRequestContext; scope: FumaRepositoryScope; targetUserId: string | null }>): Promise<Readonly<{ staff: CurrentStaffAuthority; target: SupportTargetAuthority | null }>>
  resolveCurrentStaff(userId: string, scope: SupportTenantScope, sessionId?: string): Promise<CurrentStaffAuthority | null>
  resolveCurrentTarget(userId: string, scope: SupportTenantScope, capability?: string): Promise<SupportTargetAuthority | null>
}

export interface ImmutableSupportEvidenceAuthority {
  assertImmutable(scope: SupportTenantScope, reference: ImmutableEvidenceReference): Promise<void>
}

export type SupportAuthMutation = Readonly<{ setCookies: readonly string[] }>
export type SupportMutationResult<T> = Readonly<{ value: T; setCookies: readonly string[] }>

/**
 * This port is the sole support identity mutation seam. Production delegates to
 * Better Auth's signed impersonation/admin cookies and never stores a parallel identity.
 */
export interface SupportImpersonationAuthority {
  start(input: Readonly<{
    requestHeaders: Headers
    supportSessionId: string
    staffActorId: string
    targetUserId: string
    expiresAt: string
    banner: string
  }>): Promise<SupportAuthMutation>
  end(input: Readonly<{
    requestHeaders: Headers
    supportSessionId: string
    staffActorId: string
    targetUserId: string
  }>): Promise<SupportAuthMutation>
}

/** Subject ownership stays canonical; evidenceId makes every apply replay-safe. */
export interface ModerationMutationAuthority {
  assertSubject(scope: SupportTenantScope, subject: ModerationSubject): Promise<void>
  apply(record: ModerationEvidenceRecord, requestHeaders: Headers): Promise<void>
}

/** Recovery stays isolated from ordinary APIs and is idempotent by idempotencyKey. */
export interface OwnerRecoveryAuthority {
  recover(input: Readonly<{
    requestHeaders: Headers
    requestId: string
    targetOwnerId: string
    scope: SupportTenantScope
    idempotencyKey: string
  }>): Promise<void>
}

export type TrustedSupportRequest = Readonly<{
  context: FumaRequestContext
  scope: FumaRepositoryScope
  requestHeaders: Headers
}>

const SUPPORT_BANNER = 'Support session active — actions are performed as this account and are audited.' as const
const FRESH_STEP_UP_MS = 5 * 60_000
const RESERVED_SUPPORT_CAPABILITY = /^(?:internal|platform|support|owner|protected-owner|break-glass|moderation)\./

function immutable<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) immutable(nested)
    Object.freeze(value)
  }
  return value
}

function denied(code: ConstructorParameters<typeof SupportOperationsError>[0], message: string): never {
  throw new SupportOperationsError(code, message)
}

function validateTrusted(input: TrustedSupportRequest): SupportTenantScope {
  try { assertFumaRequestContext(input.context) } catch { denied('authority-denied', 'Trusted support request context is invalid.') }
  if (!Object.isFrozen(input.context) || !Value.Check(FumaRepositoryScopeSchema, input.scope) || !Object.isFrozen(input.scope)
    || !(input.requestHeaders instanceof Headers)) {
    denied('authority-denied', 'Support operations require frozen canonical context, repository authority, and trusted request headers.')
  }
  const { platform, organization, workspace, site } = input.context.scope
  if (input.scope.state !== 'active' || input.scope.transferFence !== null
    || input.scope.platformId !== platform.id || input.scope.organizationId !== organization.id
    || input.scope.workspaceId !== workspace.id || input.scope.siteId !== site.id) {
    denied('scope-denied', 'Support operation tenant authority does not match current ownership.')
  }
  return immutable({ platformId: input.scope.platformId, organizationId: input.scope.organizationId, workspaceId: input.scope.workspaceId, siteId: input.scope.siteId, ownerKey: input.scope.ownerKey, ownerGeneration: input.scope.generation })
}

function exactScope(left: SupportTenantScope, right: SupportTenantScope): boolean {
  return left.platformId === right.platformId && left.organizationId === right.organizationId
    && left.workspaceId === right.workspaceId && left.siteId === right.siteId
    && left.ownerKey === right.ownerKey && left.ownerGeneration === right.ownerGeneration
}

function freshStepUp(staff: CurrentStaffAuthority, now: Date): string {
  if (!staff.active || staff.impersonatedBy !== null || staff.stepUpAt === null) denied('step-up-required', 'A current direct staff session with recent step-up is required.')
  const step = Date.parse(staff.stepUpAt)
  const age = now.getTime() - step
  if (!Number.isFinite(step) || age < 0 || age > FRESH_STEP_UP_MS) denied('step-up-required', 'Staff step-up is missing or stale.')
  return new Date(step).toISOString()
}

function requireCapability(staff: CurrentStaffAuthority, capability: string): void {
  if (!staff.active || !staff.capabilities.includes(capability)) denied('authority-denied', `Current staff capability ${capability} is required.`)
}

function directMatches(context: FumaRequestContext, staff: CurrentStaffAuthority): void {
  if (context.actor.kind !== 'staff' || context.actor.impersonator !== null || context.source.kind !== 'staff-session'
    || context.actor.userId !== staff.userId || context.actor.sessionId !== staff.sessionId
    || context.source.userId !== staff.userId || context.source.sessionId !== staff.sessionId
    || staff.impersonatedBy !== null) denied('nested-impersonation-denied', 'Direct staff authority is required; nested impersonation is denied.')
}

function moderationTransition(previous: ModerationEvidenceRecord | null, event: ModerationEvidenceRecord['event'], priorEvidenceId: string | null, caseId: string): boolean {
  if (!previous || previous.event === 'resolved') return event === 'opened' && priorEvidenceId === null
  if (previous.caseId !== caseId || priorEvidenceId !== previous.evidenceId) return false
  if (previous.event === 'opened') return event === 'suspended' || event === 'resolved'
  if (previous.event === 'suspended') return event === 'appealed' || event === 'resolved'
  return previous.event === 'appealed' && (event === 'suspended' || event === 'resolved')
}

function effectKey(kind: SupportOperationEffectKind, operationId: string): string { return `${kind}:${operationId}` }
function equalEvidence(left: ImmutableEvidenceReference, right: ImmutableEvidenceReference): boolean { return left.objectKey === right.objectKey && left.hashSha256 === right.hashSha256 }

export class SupportOperationsService {
  readonly #repository: SupportOperationsRepository
  readonly #authority: SupportAuthorityResolver
  readonly #evidence: ImmutableSupportEvidenceAuthority
  readonly #impersonation: SupportImpersonationAuthority
  readonly #moderation: ModerationMutationAuthority
  readonly #recovery: OwnerRecoveryAuthority
  readonly #audit: Pick<AuditService, 'recordRequest'>
  readonly #now: () => Date

  constructor(input: Readonly<{ repository: SupportOperationsRepository; authority: SupportAuthorityResolver; evidence: ImmutableSupportEvidenceAuthority; impersonation: SupportImpersonationAuthority; moderation: ModerationMutationAuthority; recovery: OwnerRecoveryAuthority; audit: Pick<AuditService, 'recordRequest'>; now?: () => Date }>) {
    this.#repository = input.repository; this.#authority = input.authority; this.#evidence = input.evidence
    this.#impersonation = input.impersonation; this.#moderation = input.moderation; this.#recovery = input.recovery
    this.#audit = input.audit; this.#now = input.now ?? (() => new Date())
  }

  async #effect(kind: SupportOperationEffectKind, operationId: string, execute: () => Promise<void>): Promise<void> {
    const key = effectKey(kind, operationId)
    const record = parseSupportContract(SupportOperationEffectRecordSchema, { effectKey: key, kind, operationId, completedAt: this.#now().toISOString() }, 'support operation effect') as SupportOperationEffectRecord
    await this.#repository.runEffect(record, execute)
  }

  async beginSupport(request: TrustedSupportRequest, raw: unknown): Promise<SupportMutationResult<SupportSessionRecord>> {
    const scope = validateTrusted(request)
    const command = parseSupportContract(BeginSupportCommandSchema, raw, 'begin support command')
    const now = this.#now()
    const resolved = await this.#authority.resolveDirect({ context: request.context, scope: request.scope, targetUserId: command.targetUserId })
    const staff = parseSupportContract(CurrentStaffAuthoritySchema, resolved.staff, 'current staff authority') as CurrentStaffAuthority
    const target = parseSupportContract(SupportTargetAuthoritySchema, resolved.target, 'support target authority') as SupportTargetAuthority
    directMatches(request.context, staff); requireCapability(staff, 'internal.support.impersonate')
    const stepUpAt = freshStepUp(staff, now)
    if (!target.active || target.userId !== command.targetUserId || target.protectedOwner || staff.protectedOwner || target.userId === staff.userId) denied('protected-owner-denied', 'Protected, inactive, internal-staff, or self-target support impersonation is denied.')
    let record = await this.#repository.readSupportSession(command.supportSessionId)
    if (record) {
      const duration = Date.parse(record.expiresAt) - Date.parse(record.startedAt)
      if (!exactScope(record.scope, scope) || record.staffActorId !== staff.userId || record.staffSessionId !== staff.sessionId || record.targetUserId !== target.userId || record.reason !== command.reason || duration !== command.durationMinutes * 60_000 || !equalEvidence(record.evidence, command.evidence)) denied('conflict', 'Support session replay changed immutable evidence.')
      if (await this.#repository.readSupportSessionEnd(record.supportSessionId) || Date.parse(record.expiresAt) <= now.getTime()) denied('expired', 'Support session replay is already ended or expired.')
    } else {
      await this.#evidence.assertImmutable(scope, command.evidence)
      const startedAt = now.toISOString()
      record = parseSupportContract(SupportSessionRecordSchema, {
        supportSessionId: command.supportSessionId, scope, staffActorId: staff.userId, staffSessionId: staff.sessionId,
        targetUserId: target.userId, reason: command.reason, stepUpAt, startedAt,
        expiresAt: new Date(now.getTime() + command.durationMinutes * 60_000).toISOString(), banner: SUPPORT_BANNER, evidence: command.evidence,
      }, 'support session evidence') as SupportSessionRecord
      if (!await this.#repository.insertSupportSession(record)) {
        const concurrent = await this.#repository.readSupportSession(command.supportSessionId)
        if (!concurrent) denied('conflict', 'Another bounded support session is already active for this staff actor.')
        return await this.beginSupport(request, command)
      }
      await this.#audit.recordRequest(request.context, { action: 'access.impersonation.started', target: 'site', outcome: 'success', metadata: { supportSessionId: record.supportSessionId, subjectUserId: record.targetUserId, evidenceHashSha256: record.evidence.hashSha256 } })
    }
    const mutation = await this.#impersonation.start({
      requestHeaders: new Headers(request.requestHeaders), supportSessionId: record.supportSessionId,
      staffActorId: record.staffActorId, targetUserId: record.targetUserId,
      expiresAt: record.expiresAt, banner: record.banner,
    })
    const effect = parseSupportContract(SupportOperationEffectRecordSchema, { effectKey: effectKey('support-started', record.supportSessionId), kind: 'support-started', operationId: record.supportSessionId, completedAt: this.#now().toISOString() }, 'support start effect') as SupportOperationEffectRecord
    await this.#repository.insertEffect(effect)
    return immutable({ value: record, setCookies: [...mutation.setCookies] })
  }

  async currentSupportSession(request: TrustedSupportRequest): Promise<SupportSessionRecord> {
    const scope = validateTrusted(request)
    const { actor, source } = request.context
    if (actor.kind !== 'staff' || source.kind !== 'staff-session' || actor.impersonator === null
      || source.impersonatedBy !== actor.impersonator.userId || source.userId !== actor.userId
      || source.sessionId !== actor.sessionId) denied('nested-impersonation-denied', 'A current Better Auth support impersonation is required.')
    const session = await this.#repository.findActiveSupportSession(scope, actor.impersonator.userId, actor.userId, this.#now().toISOString())
    if (!session || await this.#repository.readSupportSessionEnd(session.supportSessionId)) denied('expired', 'Support session ended or expired.')
    return session
  }

  async authorizeSupportAction(request: TrustedSupportRequest, raw: unknown): Promise<SupportActionRecord> {
    const scope = validateTrusted(request)
    const command = parseSupportContract(SupportActionCommandSchema, raw, 'support action command')
    const session = await this.#repository.readSupportSession(command.supportSessionId)
    if (!session || !exactScope(session.scope, scope)) denied('scope-denied', 'Support session is unavailable in this exact tenant scope.')
    if (await this.#repository.readSupportSessionEnd(session.supportSessionId) || Date.parse(session.expiresAt) <= this.#now().getTime()) denied('expired', 'Support session ended or expired.')
    if (request.context.actor.kind !== 'staff' || request.context.source.kind !== 'staff-session'
      || request.context.actor.userId !== session.targetUserId
      || request.context.actor.impersonator?.userId !== session.staffActorId
      || request.context.source.userId !== session.targetUserId
      || request.context.source.sessionId !== request.context.actor.sessionId
      || request.context.source.impersonatedBy !== session.staffActorId) denied('nested-impersonation-denied', 'Support action is not correlated to the exact bounded Better Auth impersonation.')
    const rawStaff = await this.#authority.resolveCurrentStaff(session.staffActorId, scope, session.staffSessionId)
    const staff = rawStaff === null ? null : parseSupportContract(CurrentStaffAuthoritySchema, rawStaff, 'current support staff authority') as CurrentStaffAuthority
    if (!staff || !staff.active || staff.protectedOwner || staff.impersonatedBy !== null
      || staff.sessionId !== session.staffSessionId || !staff.capabilities.includes('internal.support.impersonate')) {
      denied('authority-denied', 'The originating direct staff authority is no longer current.')
    }
    const rawTarget = await this.#authority.resolveCurrentTarget(session.targetUserId, scope, command.capability)
    const target = rawTarget === null ? null : parseSupportContract(SupportTargetAuthoritySchema, rawTarget, 'current support target authority') as SupportTargetAuthority
    if (!target || !target.active || target.protectedOwner || !target.capabilities.includes(command.capability) || RESERVED_SUPPORT_CAPABILITY.test(command.capability)) denied('authority-denied', 'Support action exceeds the target current authority.')
    const inputHashSha256 = supportEvidenceHash(command.input)
    const existing = await this.#repository.readSupportAction(command.operationId)
    if (existing) {
      if (existing.supportSessionId !== session.supportSessionId || existing.capability !== command.capability || existing.inputHashSha256 !== inputHashSha256 || existing.actorId !== session.staffActorId) denied('conflict', 'Support action replay changed immutable operation evidence.')
      return existing
    }
    const record = parseSupportContract(SupportActionRecordSchema, { supportSessionId: session.supportSessionId, operationId: command.operationId, capability: command.capability, inputHashSha256, actorId: session.staffActorId, createdAt: this.#now().toISOString() }, 'support action evidence') as SupportActionRecord
    if (!await this.#repository.insertSupportAction(record)) return await this.authorizeSupportAction(request, command)
    await this.#audit.recordRequest(request.context, { action: 'support.action.authorized', target: 'site', outcome: 'success', metadata: { supportSessionId: session.supportSessionId, operationId: command.operationId, capability: command.capability } })
    await this.#effect('support-action-executed', command.operationId, async () => {})
    return record
  }

  async endSupport(request: TrustedSupportRequest, raw: unknown): Promise<SupportMutationResult<SupportSessionEndRecord>> {
    const scope = validateTrusted(request)
    const command = parseSupportContract(EndSupportCommandSchema, raw, 'end support command')
    const session = await this.#repository.readSupportSession(command.supportSessionId)
    if (!session || !exactScope(session.scope, scope)) denied('scope-denied', 'Support session is unavailable in this exact tenant scope.')
    const { actor, source } = request.context
    const impersonated = actor.kind === 'staff' && source.kind === 'staff-session'
      && actor.userId === session.targetUserId && actor.impersonator?.userId === session.staffActorId
      && source.userId === session.targetUserId && source.sessionId === actor.sessionId
      && source.impersonatedBy === session.staffActorId
    const direct = actor.kind === 'staff' && source.kind === 'staff-session'
      && actor.userId === session.staffActorId && actor.impersonator === null
      && source.userId === session.staffActorId && source.sessionId === session.staffSessionId
      && source.impersonatedBy === null
    if (!impersonated && !direct) denied('authority-denied', 'Only the exact originating Better Auth support identity may end support.')
    const existing = await this.#repository.readSupportSessionEnd(command.supportSessionId)
    if (existing) {
      if (existing.endedByActorId !== session.staffActorId || existing.reasonCode !== command.reasonCode) denied('conflict', 'Support end replay changed immutable evidence.')
      if (!impersonated) return immutable({ value: existing, setCookies: [] })
      const mutation = await this.#impersonation.end({ requestHeaders: new Headers(request.requestHeaders), supportSessionId: command.supportSessionId, staffActorId: session.staffActorId, targetUserId: session.targetUserId })
      return immutable({ value: existing, setCookies: [...mutation.setCookies] })
    }
    if (!impersonated) denied('authority-denied', 'An active impersonated Better Auth session is required to end support.')
    const mutation = await this.#impersonation.end({ requestHeaders: new Headers(request.requestHeaders), supportSessionId: command.supportSessionId, staffActorId: session.staffActorId, targetUserId: session.targetUserId })
    const record = parseSupportContract(SupportSessionEndRecordSchema, { supportSessionId: command.supportSessionId, endedByActorId: session.staffActorId, reasonCode: command.reasonCode, endedAt: this.#now().toISOString() }, 'support session end evidence') as SupportSessionEndRecord
    if (!await this.#repository.insertSupportSessionEnd(record)) {
      const concurrent = await this.#repository.readSupportSessionEnd(command.supportSessionId)
      if (!concurrent || concurrent.endedByActorId !== session.staffActorId || concurrent.reasonCode !== command.reasonCode) denied('conflict', 'Support end evidence conflicted after Better Auth restored the staff identity.')
      return immutable({ value: concurrent, setCookies: [...mutation.setCookies] })
    }
    await this.#audit.recordRequest(request.context, { action: 'access.impersonation.ended', target: 'site', outcome: 'success', metadata: { supportSessionId: command.supportSessionId, subjectUserId: session.targetUserId, reasonCode: command.reasonCode } })
    const effect = parseSupportContract(SupportOperationEffectRecordSchema, { effectKey: effectKey('support-ended', command.supportSessionId), kind: 'support-ended', operationId: command.supportSessionId, completedAt: this.#now().toISOString() }, 'support end effect') as SupportOperationEffectRecord
    await this.#repository.insertEffect(effect)
    return immutable({ value: record, setCookies: [...mutation.setCookies] })
  }

  async recordModeration(request: TrustedSupportRequest, raw: unknown): Promise<ModerationEvidenceRecord> {
    const scope = validateTrusted(request)
    const command = parseSupportContract(RecordModerationCommandSchema, raw, 'moderation evidence command')
    const resolved = await this.#authority.resolveDirect({ context: request.context, scope: request.scope, targetUserId: command.subject.kind === 'user' ? command.subject.id : null })
    const staff = parseSupportContract(CurrentStaffAuthoritySchema, resolved.staff, 'current moderation staff authority') as CurrentStaffAuthority
    directMatches(request.context, staff); requireCapability(staff, 'internal.moderation.write'); freshStepUp(staff, this.#now())
    if (staff.protectedOwner || (command.subject.kind === 'user' && (!resolved.target || resolved.target.protectedOwner))) denied('protected-owner-denied', 'Protected-owner moderation is denied.')
    await this.#moderation.assertSubject(scope, command.subject)
    const existing = await this.#repository.readModerationEvidence(command.evidenceId)
    if (existing) {
      if (!exactScope(existing.scope, scope) || existing.caseId !== command.caseId || existing.priorEvidenceId !== command.priorEvidenceId || existing.event !== command.event || existing.reasonCode !== command.reasonCode || existing.reason !== command.reason || existing.actorId !== staff.userId || existing.subject.kind !== command.subject.kind || existing.subject.id !== command.subject.id || !equalEvidence(existing.evidence, command.evidence)) denied('conflict', 'Moderation replay changed immutable evidence.')
      await this.#effect('moderation-applied', existing.evidenceId, async () => this.#moderation.apply(existing, new Headers(request.requestHeaders)))
      return existing
    }
    const previous = await this.#repository.latestModerationEvidence(scope, command.subject.kind, command.subject.id)
    if (!moderationTransition(previous, command.event, command.priorEvidenceId, command.caseId)) denied('invalid-transition', 'Moderation, suspension, appeal, and resolution evidence must form one immutable lineage.')
    await this.#evidence.assertImmutable(scope, command.evidence)
    const record = parseSupportContract(ModerationEvidenceRecordSchema, { ...command, scope, actorId: staff.userId, createdAt: this.#now().toISOString() }, 'moderation evidence') as ModerationEvidenceRecord
    if (!await this.#repository.insertModerationEvidence(record)) return await this.recordModeration(request, command)
    await this.#audit.recordRequest(request.context, { action: 'moderation.evidence.recorded', target: 'site', outcome: 'success', metadata: { caseId: record.caseId, evidenceId: record.evidenceId, event: record.event, subjectId: record.subject.id, reasonCode: record.reasonCode } })
    await this.#effect('moderation-applied', record.evidenceId, async () => this.#moderation.apply(record, new Headers(request.requestHeaders)))
    return record
  }

  async listModerationQueue(request: TrustedSupportRequest, raw: unknown): Promise<ModerationQueuePage> {
    const scope = validateTrusted(request)
    const command = parseSupportContract(ListModerationQueueCommandSchema, raw, 'moderation queue command')
    const resolved = await this.#authority.resolveDirect({ context: request.context, scope: request.scope, targetUserId: null })
    const staff = parseSupportContract(CurrentStaffAuthoritySchema, resolved.staff, 'current moderation queue staff authority') as CurrentStaffAuthority
    directMatches(request.context, staff)
    requireCapability(staff, 'internal.moderation.read')
    const rows = await this.#repository.listModerationQueue(scope, command.queue, command.afterEvidenceId, command.limit + 1)
    const pageRows = rows.slice(0, command.limit)
    return parseSupportContract(ModerationQueuePageSchema, {
      queue: command.queue,
      rows: pageRows,
      nextAfterEvidenceId: rows.length > command.limit ? pageRows.at(-1)?.evidenceId ?? null : null,
    }, 'moderation queue page') as ModerationQueuePage
  }

  async createBreakGlass(request: TrustedSupportRequest, raw: unknown): Promise<BreakGlassRequestRecord> {
    const scope = validateTrusted(request)
    const command = parseSupportContract(CreateBreakGlassRequestSchema, raw, 'break-glass request command')
    const resolved = await this.#authority.resolveDirect({ context: request.context, scope: request.scope, targetUserId: command.targetOwnerId })
    const staff = parseSupportContract(CurrentStaffAuthoritySchema, resolved.staff, 'current break-glass requester authority') as CurrentStaffAuthority
    const target = parseSupportContract(SupportTargetAuthoritySchema, resolved.target, 'protected owner recovery target') as SupportTargetAuthority
    directMatches(request.context, staff); requireCapability(staff, 'internal.break-glass.request'); freshStepUp(staff, this.#now())
    if (staff.protectedOwner || !target.active || !target.protectedOwner || target.userId !== command.targetOwnerId || staff.userId === target.userId) denied('protected-owner-denied', 'Break glass is reserved for recovery of the current protected owner by non-owner staff.')
    const existing = await this.#repository.readBreakGlassRequest(command.requestId)
    if (existing) {
      const duration = Date.parse(existing.expiresAt) - Date.parse(existing.createdAt)
      if (!exactScope(existing.scope, scope) || existing.targetOwnerId !== command.targetOwnerId || existing.requestedByActorId !== staff.userId || existing.reason !== command.reason || existing.channel !== command.channel || duration !== command.expiresInMinutes * 60_000 || !equalEvidence(existing.evidence, command.evidence)) denied('conflict', 'Break-glass request replay changed immutable evidence.')
      return existing
    }
    await this.#evidence.assertImmutable(scope, command.evidence)
    const createdAt = this.#now().toISOString()
    const record = parseSupportContract(BreakGlassRequestRecordSchema, { requestId: command.requestId, scope, targetOwnerId: command.targetOwnerId, requestedByActorId: staff.userId, reason: command.reason, evidence: command.evidence, channel: command.channel, createdAt, expiresAt: new Date(Date.parse(createdAt) + command.expiresInMinutes * 60_000).toISOString() }, 'break-glass request evidence') as BreakGlassRequestRecord
    if (!await this.#repository.insertBreakGlassRequest(record)) return await this.createBreakGlass(request, command)
    await this.#audit.recordRequest(request.context, { action: 'breakglass.recovery.requested', target: 'site', outcome: 'success', metadata: { breakGlassRequestId: record.requestId, targetOwnerId: record.targetOwnerId, evidenceHashSha256: record.evidence.hashSha256 } })
    return record
  }

  async approveBreakGlass(request: TrustedSupportRequest, raw: unknown): Promise<BreakGlassApprovalRecord> {
    const scope = validateTrusted(request)
    const command = parseSupportContract(ApproveBreakGlassCommandSchema, raw, 'break-glass approval command')
    const recovery = await this.#repository.readBreakGlassRequest(command.requestId)
    if (!recovery || !exactScope(recovery.scope, scope)) denied('scope-denied', 'Break-glass request is unavailable in this exact tenant scope.')
    const resolved = await this.#authority.resolveDirect({ context: request.context, scope: request.scope, targetUserId: recovery.targetOwnerId })
    const staff = parseSupportContract(CurrentStaffAuthoritySchema, resolved.staff, 'current break-glass approver authority') as CurrentStaffAuthority
    const target = parseSupportContract(SupportTargetAuthoritySchema, resolved.target, 'current protected owner approval target') as SupportTargetAuthority
    directMatches(request.context, staff); requireCapability(staff, 'internal.break-glass.approve')
    const stepUpAt = freshStepUp(staff, this.#now())
    if (!target.active || !target.protectedOwner || target.userId !== recovery.targetOwnerId) denied('protected-owner-denied', 'Protected owner recovery target is no longer current.')
    if (staff.protectedOwner || staff.userId === recovery.requestedByActorId || staff.userId === recovery.targetOwnerId) denied('authority-denied', 'Requester, protected owner, and recovery target cannot approve break glass.')
    const prior = await this.#repository.readBreakGlassApproval(command.approvalId)
    if (prior) {
      if (prior.requestId !== command.requestId || prior.approverId !== staff.userId || prior.approverSessionId !== staff.sessionId || !equalEvidence(prior.evidence, command.evidence)) denied('conflict', 'Break-glass approval replay changed immutable evidence.')
      return prior
    }
    if (Date.parse(recovery.expiresAt) <= this.#now().getTime()) denied('expired', 'Break-glass request expired.')
    const existing = await this.#repository.listBreakGlassApprovals(recovery.requestId)
    if (existing.some(({ approverId }) => approverId === staff.userId) || existing.length >= 2) denied('conflict', 'Break glass requires exactly two distinct approvals.')
    await this.#evidence.assertImmutable(scope, command.evidence)
    const record = parseSupportContract(BreakGlassApprovalRecordSchema, { approvalId: command.approvalId, requestId: command.requestId, approverId: staff.userId, approverSessionId: staff.sessionId, stepUpAt, evidence: command.evidence, approvedAt: this.#now().toISOString() }, 'break-glass approval evidence') as BreakGlassApprovalRecord
    if (!await this.#repository.insertBreakGlassApproval(record)) return await this.approveBreakGlass(request, command)
    await this.#audit.recordRequest(request.context, { action: 'breakglass.recovery.approved', target: 'site', outcome: 'success', metadata: { breakGlassRequestId: record.requestId, approvalId: record.approvalId, evidenceHashSha256: record.evidence.hashSha256 } })
    return record
  }

  async #currentApprovals(scope: SupportTenantScope, recovery: BreakGlassRequestRecord): Promise<readonly BreakGlassApprovalRecord[]> {
    const approvals = await this.#repository.listBreakGlassApprovals(recovery.requestId)
    if (approvals.length !== 2 || approvals[0]!.approverId === approvals[1]!.approverId) denied('authority-denied', 'Exactly two distinct current approvals are required.')
    const now = this.#now().getTime()
    for (const approval of approvals) {
      const stepUp = Date.parse(approval.stepUpAt)
      const approved = Date.parse(approval.approvedAt)
      if (!Number.isFinite(stepUp) || !Number.isFinite(approved) || approved < stepUp || approved > Date.parse(recovery.expiresAt)
        || now < stepUp || now - stepUp > FRESH_STEP_UP_MS) denied('step-up-required', 'A break-glass approval is stale or has invalid timing evidence.')
      const current = await this.#authority.resolveCurrentStaff(approval.approverId, scope, approval.approverSessionId)
      const validated = current === null ? null : parseSupportContract(CurrentStaffAuthoritySchema, current, 'current break-glass approval authority') as CurrentStaffAuthority
      if (!validated || !validated.active || validated.protectedOwner || validated.impersonatedBy !== null || validated.sessionId !== approval.approverSessionId || !validated.capabilities.includes('internal.break-glass.approve')) denied('authority-denied', 'A recorded break-glass approver is no longer a current direct approver.')
    }
    return approvals
  }

  async executeBreakGlass(request: TrustedSupportRequest, raw: unknown): Promise<BreakGlassExecutionRecord> {
    const scope = validateTrusted(request)
    const command = parseSupportContract(ExecuteBreakGlassCommandSchema, raw, 'break-glass execution command')
    const recovery = await this.#repository.readBreakGlassRequest(command.requestId)
    if (!recovery || !exactScope(recovery.scope, scope)) denied('scope-denied', 'Break-glass request is unavailable in this exact tenant scope.')
    const resolved = await this.#authority.resolveDirect({ context: request.context, scope: request.scope, targetUserId: recovery.targetOwnerId })
    const executor = parseSupportContract(CurrentStaffAuthoritySchema, resolved.staff, 'current break-glass executor authority') as CurrentStaffAuthority
    const target = parseSupportContract(SupportTargetAuthoritySchema, resolved.target, 'current protected owner recovery target') as SupportTargetAuthority
    directMatches(request.context, executor); requireCapability(executor, 'internal.break-glass.execute'); freshStepUp(executor, this.#now())
    if (executor.protectedOwner || !target.active || !target.protectedOwner || target.userId !== recovery.targetOwnerId) denied('protected-owner-denied', 'Protected owner recovery target is no longer current.')
    const prior = await this.#repository.readBreakGlassExecution(command.requestId)
    if (prior) {
      if (prior.recoveryIdempotencyKey !== command.recoveryIdempotencyKey || prior.executionId !== command.executionId || prior.executorId !== executor.userId) denied('conflict', 'Break-glass execution identity changed.')
      await this.#currentApprovals(scope, recovery)
      await this.#effect('recovery-executed', prior.executionId, async () => this.#recovery.recover({ requestHeaders: new Headers(request.requestHeaders), requestId: recovery.requestId, targetOwnerId: recovery.targetOwnerId, scope, idempotencyKey: prior.recoveryIdempotencyKey }))
      return prior
    }
    if (Date.parse(recovery.expiresAt) <= this.#now().getTime()) denied('expired', 'Break-glass request expired.')
    const approvals = await this.#currentApprovals(scope, recovery)
    if ([recovery.requestedByActorId, recovery.targetOwnerId, ...approvals.map(({ approverId }) => approverId)].includes(executor.userId)) denied('authority-denied', 'Break-glass executor must remain separate from requester, target, and both approvers.')
    const approverIds = approvals.map(({ approverId }) => approverId).sort() as [string, string]
    const record = parseSupportContract(BreakGlassExecutionRecordSchema, { executionId: command.executionId, requestId: command.requestId, executorId: executor.userId, approverIds, recoveryIdempotencyKey: command.recoveryIdempotencyKey, executedAt: this.#now().toISOString() }, 'break-glass execution evidence') as BreakGlassExecutionRecord
    if (!await this.#repository.insertBreakGlassExecution(record)) return await this.executeBreakGlass(request, command)
    await this.#audit.recordRequest(request.context, { action: 'breakglass.recovery.executed', target: 'site', outcome: 'success', metadata: { breakGlassRequestId: record.requestId, executionId: record.executionId, approverIds: record.approverIds } })
    await this.#effect('recovery-executed', record.executionId, async () => this.#recovery.recover({ requestHeaders: new Headers(request.requestHeaders), requestId: recovery.requestId, targetOwnerId: recovery.targetOwnerId, scope, idempotencyKey: command.recoveryIdempotencyKey }))
    return record
  }
}

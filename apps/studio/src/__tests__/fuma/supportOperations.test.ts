import { freezeFumaRequestContext, type FumaRequestContext } from '../../../server/fuma/context'
import {
  MemorySupportOperationsRepository,
  SupportOperationsError,
  SupportOperationsService,
  createSupportOperationsScopedRoutes,
  type CurrentStaffAuthority,
  type SupportAuthorityResolver,
  type SupportTargetAuthority,
  type SupportTenantScope,
} from '../../../server/fuma/supportOperations'
import type { FumaRepositoryScope } from '../../../server/fuma/tenancy'

const BASE = new Date('2026-08-01T10:00:00.000Z')
const HASH = 'a'.repeat(64)
const evidence = (name: string) => ({ objectKey: `support/evidence/${name}.json`, hashSha256: HASH })
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}
const scope = deepFreeze({
  platformId: 'platform-fuma', organizationId: 'org-a', workspaceId: 'workspace-a', siteId: 'site-a',
  ownerKey: 'owner-a', generation: 3, state: 'active' as const, transferFence: null,
}) as FumaRepositoryScope
function tenantScope(value = scope): SupportTenantScope {
  return deepFreeze({ platformId: value.platformId, organizationId: value.organizationId, workspaceId: value.workspaceId, siteId: value.siteId, ownerKey: value.ownerKey, ownerGeneration: value.generation })
}
function context(input: Readonly<{ actorId?: string; sessionId?: string; impersonatorId?: string | null; siteId?: string }> = {}): FumaRequestContext {
  const actorId = input.actorId ?? 'staff-a'
  const sessionId = input.sessionId ?? `session-${actorId}`
  const impersonatorId = input.impersonatorId ?? null
  const siteId = input.siteId ?? scope.siteId
  return freezeFumaRequestContext({
    requestId: `request-${actorId}-${sessionId}`,
    source: { kind: 'staff-session', correlationId: `correlation-${actorId}`, userId: actorId, sessionId, impersonatedBy: impersonatorId },
    actor: { kind: 'staff', userId: actorId, sessionId, impersonator: impersonatorId === null ? null : { userId: impersonatorId } },
    scope: {
      platform: { id: scope.platformId, status: 'active' },
      organization: { id: scope.organizationId, platformId: scope.platformId, status: 'active' },
      workspace: { id: scope.workspaceId, platformId: scope.platformId, organizationId: scope.organizationId, status: 'active' },
      site: { id: siteId, platformId: scope.platformId, organizationId: scope.organizationId, workspaceId: scope.workspaceId, profileId: 'website', status: 'active' },
    },
    profile: { id: 'website', status: 'active' },
    capabilities: ['content.pages'],
    permissions: { subjectId: actorId, allow: ['site.read'], deny: [] },
  })
}

const INTERNAL = Object.freeze([
  'internal.support.impersonate', 'internal.moderation.read', 'internal.moderation.write',
  'internal.break-glass.request', 'internal.break-glass.approve', 'internal.break-glass.execute',
])
type StaffState = { sessionId: string; active: boolean; protectedOwner: boolean; stepUpAt: string | null; capabilities: string[] }
function harness() {
  let now = new Date(BASE)
  const repository = new MemorySupportOperationsRepository()
  const staff = new Map<string, StaffState>()
  for (const id of ['staff-a', 'staff-b', 'staff-c', 'staff-d']) staff.set(id, { sessionId: `session-${id}`, active: true, protectedOwner: false, stepUpAt: new Date(BASE.getTime() - 60_000).toISOString(), capabilities: [...INTERNAL] })
  const targetPermissions = new Map<string, Set<string>>([['customer-a', new Set(['content.pages.write', 'site.read'])], ['owner-a', new Set(['site.read'])]])
  const target = (userId: string, capability?: string): SupportTargetAuthority => ({
    userId, active: targetPermissions.has(userId), protectedOwner: userId === 'owner-a' || userId.startsWith('staff-'),
    capabilities: capability && targetPermissions.get(userId)?.has(capability) ? [capability] : [],
  })
  const currentStaff = (userId: string): CurrentStaffAuthority => {
    const value = staff.get(userId)!
    return { userId, sessionId: value.sessionId, impersonatedBy: null, stepUpAt: value.stepUpAt, active: value.active, protectedOwner: value.protectedOwner, capabilities: [...value.capabilities] }
  }
  const authority: SupportAuthorityResolver = {
    async resolveDirect({ context: requestContext, targetUserId }) {
      const value = staff.get(requestContext.actor.userId)
      const resolvedStaff = value ? currentStaff(requestContext.actor.userId) : { userId: requestContext.actor.userId, sessionId: requestContext.actor.sessionId, impersonatedBy: null, stepUpAt: new Date(BASE.getTime() - 60_000).toISOString(), active: true, protectedOwner: false, capabilities: [...INTERNAL] }
      return { staff: resolvedStaff, target: targetUserId === null ? null : target(targetUserId) }
    },
    async resolveCurrentStaff(userId, _tenant, sessionId) { const value = staff.get(userId); return value && value.sessionId === sessionId ? currentStaff(userId) : null },
    async resolveCurrentTarget(userId, _tenant, capability) { return targetPermissions.has(userId) ? target(userId, capability) : null },
  }
  const calls = { evidence: [] as string[], starts: 0, ends: 0, moderation: [] as string[], recoveries: [] as string[], audits: [] as string[] }
  const service = new SupportOperationsService({
    repository,
    authority,
    evidence: { async assertImmutable(exactScope, reference) { expect(exactScope).toEqual(tenantScope()); calls.evidence.push(reference.objectKey) } },
    impersonation: {
      async start(input) { calls.starts += 1; expect(input.requestHeaders.get('cookie') ?? input.requestHeaders.get('x-support-test')).toBe('staff-cookie'); return { setCookies: ['__Host-fuma_staff=target; Path=/; HttpOnly; SameSite=Lax; Secure'] } },
      async end(input) { calls.ends += 1; expect(input.requestHeaders.get('cookie') ?? input.requestHeaders.get('x-support-test')).toBe('target-cookie'); return { setCookies: ['__Host-fuma_staff=staff; Path=/; HttpOnly; SameSite=Lax; Secure'] } },
    },
    moderation: { async assertSubject() {}, async apply(record) { calls.moderation.push(record.evidenceId) } },
    recovery: { async recover(input) { expect(input.requestHeaders.get('cookie')).toBe('executor-cookie'); calls.recoveries.push(input.idempotencyKey) } },
    audit: { async recordRequest(_context, input) { calls.audits.push(input.action); return {} as never } },
    now: () => new Date(now),
  })
  const request = (requestContext = context(), cookie = 'staff-cookie', repositoryScope = scope) => deepFreeze({ context: requestContext, scope: repositoryScope, requestHeaders: new Headers({ cookie }) })
  return { repository, service, staff, calls, request, setNow(value: string) { now = new Date(value) } }
}
function beginCommand(overrides: Record<string, unknown> = {}) {
  return { supportSessionId: 'support-a', targetUserId: 'customer-a', reason: 'Investigate customer-reported editor failure.', durationMinutes: 10, evidence: evidence('support-a'), ...overrides }
}
function expectCode(promise: Promise<unknown>, code: string) { return expect(promise).rejects.toMatchObject({ name: 'SupportOperationsError', code }) }

 describe('FUMA-072 support operations', () => {
  it('starts one bounded direct support session with fresh step-up, exact evidence, and Better Auth cookies', async () => {
    const h = harness()
    const result = await h.service.beginSupport(h.request(), beginCommand())
    expect(result.value).toMatchObject({ supportSessionId: 'support-a', staffActorId: 'staff-a', staffSessionId: 'session-staff-a', targetUserId: 'customer-a', banner: 'Support session active — actions are performed as this account and are audited.' })
    expect(Date.parse(result.value.expiresAt) - Date.parse(result.value.startedAt)).toBe(10 * 60_000)
    expect(result.setCookies[0]).toContain('__Host-fuma_staff=target')
    expect(h.calls).toMatchObject({ starts: 1, evidence: ['support/evidence/support-a.json'] })
    const replay = await h.service.beginSupport(h.request(), beginCommand())
    expect(replay.value).toEqual(result.value)
    expect(h.calls.starts).toBe(2)
    await expectCode(h.service.beginSupport(h.request(), beginCommand({ reason: 'Changed immutable support reason.' })), 'conflict')
  })

  it('denies stale, nested, self, protected, inactive, and concurrent support targets', async () => {
    const h = harness()
    h.staff.get('staff-a')!.stepUpAt = '2026-08-01T09:54:59.999Z'
    await expectCode(h.service.beginSupport(h.request(), beginCommand()), 'step-up-required')
    h.staff.get('staff-a')!.stepUpAt = '2026-08-01T09:59:00.000Z'
    await expectCode(h.service.beginSupport(h.request(context({ actorId: 'customer-a', sessionId: 'target-session', impersonatorId: 'staff-a' }), 'target-cookie'), beginCommand()), 'nested-impersonation-denied')
    await expectCode(h.service.beginSupport(h.request(), beginCommand({ targetUserId: 'staff-a' })), 'protected-owner-denied')
    await expectCode(h.service.beginSupport(h.request(), beginCommand({ targetUserId: 'owner-a' })), 'protected-owner-denied')
    await expectCode(h.service.beginSupport(h.request(), beginCommand({ targetUserId: 'missing-user' })), 'protected-owner-denied')
    await h.service.beginSupport(h.request(), beginCommand())
    await expectCode(h.service.beginSupport(h.request(), beginCommand({ supportSessionId: 'support-b', evidence: evidence('support-b') })), 'conflict')
  })

  it('shows the current banner, records non-elevating action evidence, and restores the originating Better Auth identity', async () => {
    const h = harness()
    await h.service.beginSupport(h.request(), beginCommand())
    const impersonated = h.request(context({ actorId: 'customer-a', sessionId: 'better-auth-impersonation', impersonatorId: 'staff-a' }), 'target-cookie')
    expect((await h.service.currentSupportSession(impersonated)).supportSessionId).toBe('support-a')
    const action = await h.service.authorizeSupportAction(impersonated, { supportSessionId: 'support-a', operationId: 'operation-a', capability: 'content.pages.write', input: { pageId: 'page-a' } })
    expect(action).toMatchObject({ actorId: 'staff-a', capability: 'content.pages.write', operationId: 'operation-a' })
    h.staff.get('staff-a')!.active = false
    await expectCode(h.service.authorizeSupportAction(impersonated, { supportSessionId: 'support-a', operationId: 'operation-revoked', capability: 'content.pages.write', input: {} }), 'authority-denied')
    h.staff.get('staff-a')!.active = true
    await expectCode(h.service.authorizeSupportAction(impersonated, { supportSessionId: 'support-a', operationId: 'operation-owner', capability: 'owner.roles.write', input: {} }), 'authority-denied')
    const ended = await h.service.endSupport(impersonated, { supportSessionId: 'support-a', reasonCode: 'completed' })
    expect(ended.value).toMatchObject({ endedByActorId: 'staff-a', reasonCode: 'completed' })
    expect(ended.setCookies[0]).toContain('__Host-fuma_staff=staff')
    await expectCode(h.service.currentSupportSession(impersonated), 'expired')
    await expectCode(h.service.authorizeSupportAction(impersonated, { supportSessionId: 'support-a', operationId: 'operation-late', capability: 'content.pages.write', input: {} }), 'expired')
  })

  it('fences owner generation and expires support without losing immutable evidence', async () => {
    const h = harness()
    const started = await h.service.beginSupport(h.request(), beginCommand())
    const wrongScope = deepFreeze({ ...scope, generation: 4 }) as FumaRepositoryScope
    await expectCode(h.service.currentSupportSession(h.request(context({ actorId: 'customer-a', sessionId: 'impersonated', impersonatorId: 'staff-a' }), 'target-cookie', wrongScope)), 'expired')
    h.setNow(started.value.expiresAt)
    await expectCode(h.service.authorizeSupportAction(h.request(context({ actorId: 'customer-a', sessionId: 'impersonated', impersonatorId: 'staff-a' }), 'target-cookie'), { supportSessionId: 'support-a', operationId: 'late', capability: 'site.read', input: null }), 'expired')
    expect(await h.repository.readSupportSession('support-a')).toEqual(started.value)
  })

  it('maintains append-only moderation lineage, queue pagination, and concurrent duplicate denial', async () => {
    const h = harness()
    const open = { evidenceId: 'evidence-open', caseId: 'case-a', priorEvidenceId: null, subject: { kind: 'site', id: 'site-a' }, event: 'opened', reasonCode: 'abuse-report', reason: 'Verified abuse report requires moderation.', evidence: evidence('moderation-open') }
    const [first, duplicate] = await Promise.allSettled([h.service.recordModeration(h.request(), open), h.service.recordModeration(h.request(), open)])
    expect([first.status, duplicate.status].filter((status) => status === 'fulfilled')).toHaveLength(2)
    const suspended = await h.service.recordModeration(h.request(), { ...open, evidenceId: 'evidence-suspended', priorEvidenceId: 'evidence-open', event: 'suspended', reason: 'Suspend while the verified appeal window remains open.', evidence: evidence('moderation-suspended') })
    const appealed = await h.service.recordModeration(h.request(), { ...open, evidenceId: 'evidence-appealed', priorEvidenceId: suspended.evidenceId, event: 'appealed', reason: 'Customer submitted an appeal with reviewable evidence.', evidence: evidence('moderation-appealed') })
    expect((await h.service.listModerationQueue(h.request(), { queue: 'appeal', afterEvidenceId: null, limit: 1 })).rows.map((row) => row.evidenceId)).toEqual([appealed.evidenceId])
    await expectCode(h.service.recordModeration(h.request(), { ...open, evidenceId: 'bad-transition', priorEvidenceId: 'evidence-open', event: 'resolved', evidence: evidence('bad') }), 'invalid-transition')
    expect(h.calls.moderation).toEqual(['evidence-open', 'evidence-suspended', 'evidence-appealed'])
  })

  it('requires two fresh distinct current approvers and a separate executor for isolated owner recovery', async () => {
    const h = harness()
    const request = await h.service.createBreakGlass(h.request(), { requestId: 'recovery-a', targetOwnerId: 'owner-a', reason: 'Recover the protected owner after verified account lockout.', expiresInMinutes: 10, evidence: evidence('recovery-request'), channel: 'isolated-owner-recovery' })
    expect(request.channel).toBe('isolated-owner-recovery')
    for (const actorId of ['staff-b', 'staff-c']) await h.service.approveBreakGlass(h.request(context({ actorId })), { approvalId: `approval-${actorId}`, requestId: 'recovery-a', evidence: evidence(`approval-${actorId}`), channel: 'isolated-owner-recovery' })
    await expectCode(h.service.executeBreakGlass(h.request(context({ actorId: 'staff-b' }), 'executor-cookie'), { executionId: 'execution-a', requestId: 'recovery-a', recoveryIdempotencyKey: 'recovery-effect-a', channel: 'isolated-owner-recovery' }), 'authority-denied')
    const execution = await h.service.executeBreakGlass(h.request(context({ actorId: 'staff-d' }), 'executor-cookie'), { executionId: 'execution-a', requestId: 'recovery-a', recoveryIdempotencyKey: 'recovery-effect-a', channel: 'isolated-owner-recovery' })
    expect(execution).toMatchObject({ executorId: 'staff-d', approverIds: ['staff-b', 'staff-c'] })
    expect(h.calls.recoveries).toEqual(['recovery-effect-a'])
    expect(await h.service.executeBreakGlass(h.request(context({ actorId: 'staff-d' }), 'executor-cookie'), { executionId: 'execution-a', requestId: 'recovery-a', recoveryIdempotencyKey: 'recovery-effect-a', channel: 'isolated-owner-recovery' })).toEqual(execution)
    expect(h.calls.recoveries).toEqual(['recovery-effect-a'])
  })

  it('denies duplicate, stale, revoked, and requester approvals', async () => {
    const h = harness()
    await h.service.createBreakGlass(h.request(), { requestId: 'recovery-a', targetOwnerId: 'owner-a', reason: 'Recover the protected owner after verified account lockout.', expiresInMinutes: 10, evidence: evidence('recovery-request'), channel: 'isolated-owner-recovery' })
    await expectCode(h.service.approveBreakGlass(h.request(), { approvalId: 'requester-approval', requestId: 'recovery-a', evidence: evidence('requester'), channel: 'isolated-owner-recovery' }), 'authority-denied')
    await h.service.approveBreakGlass(h.request(context({ actorId: 'staff-b' })), { approvalId: 'approval-b', requestId: 'recovery-a', evidence: evidence('approval-b'), channel: 'isolated-owner-recovery' })
    await expectCode(h.service.approveBreakGlass(h.request(context({ actorId: 'staff-b' })), { approvalId: 'approval-b2', requestId: 'recovery-a', evidence: evidence('approval-b2'), channel: 'isolated-owner-recovery' }), 'conflict')
    await h.service.approveBreakGlass(h.request(context({ actorId: 'staff-c' })), { approvalId: 'approval-c', requestId: 'recovery-a', evidence: evidence('approval-c'), channel: 'isolated-owner-recovery' })
    h.staff.get('staff-c')!.active = false
    await expectCode(h.service.executeBreakGlass(h.request(context({ actorId: 'staff-d' }), 'executor-cookie'), { executionId: 'execution-a', requestId: 'recovery-a', recoveryIdempotencyKey: 'effect-a', channel: 'isolated-owner-recovery' }), 'authority-denied')
  })

  it('maps strict route errors and propagates Better Auth Set-Cookie without exposing identity inputs', async () => {
    const h = harness()
    const routes = createSupportOperationsScopedRoutes(h.service)
    const begin = routes.find((route) => route.path === '/support/sessions' && route.method === 'POST')!
    expect(routes.every((route) => route.permission === 'site.read')).toBe(true)
    const response = await begin.handler({ request: new Request('https://admin.trimly.co.ke/api/fuma/organizations/org-a/workspaces/workspace-a/sites/site-a/support/sessions', { method: 'POST', headers: { 'content-type': 'application/json', 'x-support-test': 'staff-cookie' }, body: JSON.stringify(beginCommand()) }), context: context(), repositoryScope: scope, params: {} })
    expect(response.status).toBe(201)
    expect(response.headers.get('x-fuma-auth-cookie-mutations')).toBe('1')
    const invalid = await begin.handler({ request: new Request('https://admin.trimly.co.ke/support', { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'staff-cookie' }, body: '{}' }), context: context(), repositoryScope: scope, params: {} })
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toEqual({ error: expect.stringContaining('strict TypeBox validation') })
  })
})

it('uses the FUMA-072 error class for policy failures', () => {
  expect(new SupportOperationsError('authority-denied', 'denied')).toMatchObject({ name: 'SupportOperationsError', code: 'authority-denied' })
})

import { describe, expect, it } from 'bun:test'
import {
  freezeFumaRequestContext,
  type FumaJobContext,
  type FumaRequestContext,
} from '../../../server/fuma/context'
import type {
  AuditListFilter,
  CreatedAuditEvent,
} from '../../../server/fuma/audit/contracts'
import type {
  AuditRepository,
} from '../../../server/fuma/audit/repository'
import {
  AuditService,
} from '../../../server/fuma/audit/service'

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

function requestContext(
  organizationId = 'organization-a',
  requestId = 'request-shared',
): FumaRequestContext {
  return freezeFumaRequestContext({
    requestId,
    source: {
      kind: 'staff-session',
      correlationId: requestId,
      userId: 'staff-effective',
      sessionId: 'session-01',
      impersonatedBy: 'staff-operator',
    },
    actor: {
      kind: 'staff',
      userId: 'staff-effective',
      sessionId: 'session-01',
      impersonator: { userId: 'staff-operator' },
    },
    scope: {
      platform: { id: 'platform-fuma', status: 'active' },
      organization: {
        id: organizationId,
        platformId: 'platform-fuma',
        status: 'active',
      },
      workspace: {
        id: 'workspace-collision',
        platformId: 'platform-fuma',
        organizationId,
        status: 'active',
      },
      site: {
        id: 'site-collision',
        platformId: 'platform-fuma',
        organizationId,
        workspaceId: 'workspace-collision',
        profileId: 'website',
        status: 'active',
      },
    },
    profile: { id: 'website', status: 'active' },
    capabilities: [],
    permissions: {
      subjectId: 'staff-effective',
      allow: [],
      deny: [],
    },
  })
}

function siteJobContext(
  organizationId = 'organization-a',
  originatingRequestId: string | null = 'request-enqueue',
): FumaJobContext {
  const context: FumaJobContext = {
    kind: 'site',
    originatingRequestId,
    requestId: 'job-collision:request:7',
    source: {
      kind: 'internal-job',
      correlationId: 'job-collision:request:7',
      jobId: 'job-collision',
      runId: 'job-collision:run:7',
    },
    actor: {
      kind: 'internal-job',
      jobId: 'job-collision',
      runId: 'job-collision:run:7',
    },
    scope: {
      platform: { id: 'platform-fuma', status: 'active' },
      organization: {
        id: organizationId,
        platformId: 'platform-fuma',
        status: 'active',
      },
      workspace: {
        id: 'workspace-collision',
        platformId: 'platform-fuma',
        organizationId,
        status: 'active',
      },
      site: {
        id: 'site-collision',
        platformId: 'platform-fuma',
        organizationId,
        workspaceId: 'workspace-collision',
        profileId: 'website',
        status: 'active',
      },
    },
    profile: { id: 'website', status: 'active' },
    capabilities: [],
    permissions: {
      subjectId: 'job-collision',
      allow: ['content.pages.write'],
      deny: [],
    },
    requiredPermission: 'content.pages.write',
  }
  return deepFreeze(context)
}

function scopeMatches(
  event: CreatedAuditEvent,
  filter: AuditListFilter,
): boolean {
  return JSON.stringify(event.scope) === JSON.stringify(filter.scope)
}

class RecordingAuditRepository implements AuditRepository {
  readonly persisted: CreatedAuditEvent[] = []
  failWith: Error | null = null

  append(event: CreatedAuditEvent): Promise<CreatedAuditEvent> {
    if (this.failWith) return Promise.reject(this.failWith)
    const stored = structuredClone(event)
    this.persisted.push(stored)
    return Promise.resolve(structuredClone(stored))
  }

  list(filter: AuditListFilter): Promise<readonly CreatedAuditEvent[]> {
    let rows = this.persisted.filter((event) => scopeMatches(event, filter))
    if (filter.actions) {
      const actions = filter.actions
      rows = rows.filter(({ action }) => actions.includes(action))
    }
    if (filter.outcomes) {
      const outcomes = filter.outcomes
      rows = rows.filter(({ outcome }) => outcomes.includes(outcome))
    }
    if (filter.actor) {
      const actorFilter = filter.actor
      rows = rows.filter(({ actor }) => actorFilter.kind === 'staff'
        ? actor.kind === 'staff' && actor.userId === actorFilter.userId
        : actor.kind === 'internal-job' && actor.jobId === actorFilter.jobId)
    }
    if (filter.requestId) {
      rows = rows.filter(({ correlation }) => (
        correlation.requestId === filter.requestId
        || (correlation.kind === 'job'
          && correlation.originatingRequestId === filter.requestId)
      ))
    }
    if (filter.jobId) {
      rows = rows.filter(({ correlation }) => (
        correlation.kind === 'job' && correlation.jobId === filter.jobId
      ))
    }
    rows.sort((left, right) => (
      right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id)
    ))
    return Promise.resolve(structuredClone(rows.slice(0, filter.limit ?? 50)))
  }
}

function harness(ids = ['audit-01', 'audit-02', 'audit-03']) {
  const repository = new RecordingAuditRepository()
  let index = 0
  const service = new AuditService({
    repository,
    generateId: () => ids[index++] ?? `audit-${index}`,
    now: () => new Date('2026-07-25T05:20:00.000Z'),
  })
  return { repository, service }
}

describe('FUMA-022 request audit integration', () => {
  it('derives exact scope, actor, impersonator, and request ID only from frozen context', async () => {
    const { repository, service } = harness()
    const context = requestContext()

    const event = await service.recordRequest(context, {
      action: 'site.created',
      target: 'site',
      outcome: 'success',
      metadata: { siteSlug: 'main', profileId: 'website' },
    })

    expect(repository.persisted[0]).toMatchObject({
      id: 'audit-01',
      scope: {
        kind: 'site',
        platformId: 'platform-fuma',
        organizationId: 'organization-a',
        workspaceId: 'workspace-collision',
        siteId: 'site-collision',
      },
      actor: {
        kind: 'staff',
        userId: 'staff-effective',
        sessionId: 'session-01',
        impersonator: { userId: 'staff-operator' },
      },
      correlation: { kind: 'request', requestId: 'request-shared' },
      outcome: 'success',
      createdAt: '2026-07-25T05:20:00.000Z',
    })
    expect(event).toEqual(repository.persisted[0])
    expect(Object.isFrozen(event)).toBe(true)
    expect(Object.isFrozen(event.actor)).toBe(true)
    expect(Object.isFrozen(event.metadata)).toBe(true)
  })

  it('redacts metadata before repository insertion and detaches caller data', async () => {
    const { repository, service } = harness()
    const metadata = {
      permissionId: 'site.home.read',
      authorization: 'Bearer secret',
      nested: { api_key: 'secret-key', safe: 'retained' },
    }

    const event = await service.recordRequest(requestContext(), {
      action: 'access.denied',
      target: 'site',
      outcome: 'denied',
      metadata,
    })
    metadata.nested.safe = 'mutated-after-write'

    expect(repository.persisted[0]!.metadata).toEqual({
      authorization: '[REDACTED]',
      nested: { api_key: '[REDACTED]', safe: 'retained' },
      permissionId: 'site.home.read',
    })
    expect(event.metadata).toEqual(repository.persisted[0]!.metadata)
  })

  it('rejects payload/header-shaped authority copies instead of accepting them', async () => {
    const { service } = harness()
    await expect(service.recordRequest(requestContext(), {
      action: 'site.updated',
      target: 'site',
      outcome: 'success',
      metadata: { changedFields: ['name'] },
      actor: { kind: 'staff', userId: 'payload-attacker' },
      requestId: 'header-request-id',
      scope: { organizationId: 'organization-b' },
    })).rejects.toMatchObject({
      name: 'AuditContractError',
      path: 'input',
    })
  })

  it('validates the closed catalog action, outcome, and target before persistence', async () => {
    const { repository, service } = harness()
    const base = {
      action: 'site.updated',
      target: 'site',
      outcome: 'success',
      metadata: { changedFields: ['name'] },
    }

    for (const invalid of [
      { ...base, action: 'site.unknown' },
      { ...base, outcome: 'succeeded' },
      { ...base, target: 'tenant' },
    ]) {
      await expect(service.recordRequest(requestContext(), invalid)).rejects.toMatchObject({
        name: 'AuditContractError',
        path: 'input',
      })
    }
    expect(repository.persisted).toEqual([])
  })

  it('records denied and failure outcomes without rewriting them', async () => {
    const { repository, service } = harness()
    await service.recordRequest(requestContext(), {
      action: 'context.request.denied',
      target: 'site',
      outcome: 'denied',
      metadata: { denialCode: 'permission-denied' },
    })
    await service.recordRequest(requestContext(), {
      action: 'auth.login.failed',
      target: 'platform',
      outcome: 'failure',
      metadata: { authMethod: 'password', failureCode: 'invalid-credentials' },
    })

    expect(repository.persisted.map(({ outcome }) => outcome)).toEqual([
      'denied',
      'failure',
    ])
    expect(repository.persisted[1]!.scope).toEqual({
      kind: 'platform',
      platformId: 'platform-fuma',
    })
  })
})

describe('FUMA-022 durable-job audit integration', () => {
  it('preserves execution request, originating request, job, and run correlation', async () => {
    const { repository, service } = harness()
    const event = await service.recordJob(siteJobContext(), {
      action: 'job.failed',
      target: 'site',
      outcome: 'failure',
      metadata: {
        jobKind: 'website.publish',
        attempt: 7,
        failureCode: 'render-failed',
        payload: {
          actor: 'spoofed-staff',
          requestId: 'spoofed-request',
          organizationId: 'organization-b',
        },
      },
    })

    expect(event).toMatchObject({
      actor: {
        kind: 'internal-job',
        jobId: 'job-collision',
        runId: 'job-collision:run:7',
      },
      correlation: {
        kind: 'job',
        requestId: 'job-collision:request:7',
        originatingRequestId: 'request-enqueue',
        jobId: 'job-collision',
        runId: 'job-collision:run:7',
      },
      scope: {
        organizationId: 'organization-a',
        workspaceId: 'workspace-collision',
        siteId: 'site-collision',
      },
      outcome: 'failure',
      metadata: { payload: '[REDACTED]' },
    })
    expect(repository.persisted[0]).toEqual(event)
  })

  it('does not permit internal jobs to discard required organization ancestry', async () => {
    const { service } = harness()
    await expect(service.recordJob(siteJobContext(), {
      action: 'job.started',
      target: 'platform',
      outcome: 'success',
      metadata: { jobKind: 'website.publish', attempt: 7 },
    })).rejects.toMatchObject({
      name: 'AuditContractError',
      path: 'input.target',
    })
  })

  it('keeps colliding job, workspace, site, and request IDs isolated by full ancestry', async () => {
    const { service } = harness(['audit-a', 'audit-b'])
    await service.recordJob(siteJobContext('organization-a', 'request-shared'), {
      action: 'job.succeeded',
      target: 'site',
      outcome: 'success',
      metadata: { jobKind: 'website.publish', attempt: 7 },
    })
    await service.recordJob(siteJobContext('organization-b', 'request-shared'), {
      action: 'job.succeeded',
      target: 'site',
      outcome: 'success',
      metadata: { jobKind: 'website.publish', attempt: 7 },
    })

    const scopeA = {
      kind: 'site',
      platformId: 'platform-fuma',
      organizationId: 'organization-a',
      workspaceId: 'workspace-collision',
      siteId: 'site-collision',
    } as const
    const scopeB = { ...scopeA, organizationId: 'organization-b' } as const
    const a = await service.list({
      scope: scopeA,
      requestId: 'request-shared',
      jobId: 'job-collision',
    })
    const b = await service.list({
      scope: scopeB,
      requestId: 'request-shared',
      jobId: 'job-collision',
    })

    expect(a.map(({ id }) => id)).toEqual(['audit-a'])
    expect(b.map(({ id }) => id)).toEqual(['audit-b'])
    expect(Object.isFrozen(a)).toBe(true)
    expect(Object.isFrozen(a[0]!.scope)).toBe(true)
  })

  it('rejects a repository response that substitutes authoritative event fields', async () => {
    const repository: AuditRepository = {
      async append(event) {
        return {
          ...structuredClone(event),
          scope: {
            kind: 'site',
            platformId: 'platform-fuma',
            organizationId: 'organization-b',
            workspaceId: 'workspace-collision',
            siteId: 'site-collision',
          },
        }
      },
      async list() {
        return []
      },
    }
    const service = new AuditService({
      repository,
      generateId: () => 'audit-substitution',
      now: () => new Date('2026-07-25T05:20:00.000Z'),
    })

    await expect(service.recordJob(siteJobContext(), {
      action: 'job.succeeded',
      target: 'site',
      outcome: 'success',
      metadata: { jobKind: 'website.publish', attempt: 7 },
    })).rejects.toThrow('Audit repository returned a mismatched event')
  })

  it('surfaces repository write failures unchanged', async () => {
    const { repository, service } = harness()
    const failure = new Error('audit persistence unavailable')
    repository.failWith = failure

    await expect(service.recordJob(siteJobContext(), {
      action: 'job.succeeded',
      target: 'site',
      outcome: 'success',
      metadata: { jobKind: 'website.publish', attempt: 7 },
    })).rejects.toBe(failure)
    expect(repository.persisted).toEqual([])
  })
})

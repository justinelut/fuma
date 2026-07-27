import { describe, expect, it } from 'bun:test'
import { Value } from '@core/utils/typeboxHelpers'
import {
  AuditActionSchema,
  AuditAppendInputSchema,
  AuditListFilterSchema,
  AuditOutcomeSchema,
  AuditTenantScopeSchema,
  CreatedAuditEventSchema,
  FUMA_AUDIT_ACTIONS,
  assertAuditAppendInput,
  assertAuditListFilter,
  assertCreatedAuditEvent,
} from '../../../server/fuma/audit/contracts'
import {
  AuditEventCatalogSchema,
  FUMA_AUDIT_EVENT_CATALOG,
  createAuditEventCatalog,
  getAuditEventCatalogEntry,
} from '../../../server/fuma/audit/catalog'

const SITE_SCOPE = {
  kind: 'site',
  platformId: 'platform-fuma',
  organizationId: 'organization-acme',
  workspaceId: 'workspace-main',
  siteId: 'site-primary',
} as const

function staffAppendInput() {
  return {
    action: 'site.created',
    scope: SITE_SCOPE,
    actor: {
      kind: 'staff',
      userId: 'staff-effective',
      sessionId: 'session-01',
      impersonator: { userId: 'staff-operator' },
    },
    correlation: {
      kind: 'request',
      requestId: 'request-01',
    },
    outcome: 'success',
    metadata: {
      siteSlug: 'primary',
      profileId: 'website',
    },
  }
}

function jobAppendInput() {
  return {
    action: 'job.succeeded',
    scope: SITE_SCOPE,
    actor: {
      kind: 'internal-job',
      jobId: 'job-01',
      runId: 'job-01:run:7',
    },
    correlation: {
      kind: 'job',
      requestId: 'job-01:request:7',
      jobId: 'job-01',
      runId: 'job-01:run:7',
      originatingRequestId: 'request-01',
    },
    outcome: 'success',
    metadata: {
      jobKind: 'site.publish',
      attempt: 2,
    },
  }
}

function without(
  value: Readonly<Record<string, unknown>>,
  key: string,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key))
}

describe('FUMA-022 scoped audit contracts', () => {
  it('publishes a closed action set and exact tenant ancestry at every scope', () => {
    for (const action of FUMA_AUDIT_ACTIONS) {
      expect(Value.Check(AuditActionSchema, action)).toBe(true)
    }
    for (const action of ['site.created.extra', 'site_create', 'unknown.event']) {
      expect(Value.Check(AuditActionSchema, action)).toBe(false)
    }
    for (const outcome of ['success', 'failure', 'denied']) {
      expect(Value.Check(AuditOutcomeSchema, outcome)).toBe(true)
    }
    for (const outcome of ['succeeded', 'failed', 'deny']) {
      expect(Value.Check(AuditOutcomeSchema, outcome)).toBe(false)
    }

    const scopes = [
      { kind: 'platform', platformId: 'platform-fuma' },
      {
        kind: 'organization',
        platformId: 'platform-fuma',
        organizationId: 'organization-acme',
      },
      {
        kind: 'workspace',
        platformId: 'platform-fuma',
        organizationId: 'organization-acme',
        workspaceId: 'workspace-main',
      },
      SITE_SCOPE,
    ]
    for (const scope of scopes) expect(Value.Check(AuditTenantScopeSchema, scope)).toBe(true)

    expect(Value.Check(AuditTenantScopeSchema, without(SITE_SCOPE, 'organizationId')))
      .toBe(false)
    expect(Value.Check(AuditTenantScopeSchema, {
      ...SITE_SCOPE,
      tenantId: 'ambiguous-tenant',
    })).toBe(false)
  })

  it('defines strict append and created-event contracts for staff and workers', () => {
    const staff = staffAppendInput()
    const job = jobAppendInput()

    expect(Value.Check(AuditAppendInputSchema, staff)).toBe(true)
    expect(Value.Check(AuditAppendInputSchema, job)).toBe(true)
    expect(() => assertAuditAppendInput(staff)).not.toThrow()
    expect(() => assertAuditAppendInput(job)).not.toThrow()

    const created = {
      id: 'audit-01',
      ...staff,
      createdAt: '2026-07-25T05:10:24.168Z',
    }
    expect(Value.Check(CreatedAuditEventSchema, created)).toBe(true)
    expect(() => assertCreatedAuditEvent(created)).not.toThrow()
    expect(Value.Check(CreatedAuditEventSchema, staff)).toBe(false)
    expect(Value.Check(AuditAppendInputSchema, { ...staff, id: 'caller-event-id' }))
      .toBe(false)
  })

  it('binds actors to request/job correlation and makes impersonation explicit', () => {
    const mismatchedJob = jobAppendInput()
    mismatchedJob.correlation.runId = 'job-01:run:8'
    expect(() => assertAuditAppendInput(mismatchedJob)).toThrow(
      expect.objectContaining({
        name: 'AuditContractError',
        code: 'actor-correlation-mismatch',
        path: 'event.correlation',
      }),
    )

    const jobWithRequestCorrelation = {
      ...jobAppendInput(),
      correlation: staffAppendInput().correlation,
    }
    expect(() => assertAuditAppendInput(jobWithRequestCorrelation)).toThrow(
      expect.objectContaining({ code: 'actor-correlation-mismatch' }),
    )

    const selfImpersonation = staffAppendInput()
    selfImpersonation.actor.impersonator.userId = selfImpersonation.actor.userId
    expect(() => assertAuditAppendInput(selfImpersonation)).toThrow(
      expect.objectContaining({
        code: 'invalid-impersonation',
        path: 'event.actor.impersonator.userId',
      }),
    )

    expect(Value.Check(AuditAppendInputSchema, {
      ...staffAppendInput(),
      actor: without(staffAppendInput().actor, 'impersonator'),
    })).toBe(false)
  })

  it('requires scoped listings and validates bounded filters and time ordering', () => {
    const filter = {
      scope: SITE_SCOPE,
      actions: ['site.created', 'site.updated'],
      outcomes: ['success'],
      requestId: 'request-01',
      limit: 100,
    }
    expect(Value.Check(AuditListFilterSchema, filter)).toBe(true)
    expect(() => assertAuditListFilter(filter)).not.toThrow()
    expect(Value.Check(AuditListFilterSchema, without(filter, 'scope'))).toBe(false)
    expect(Value.Check(AuditListFilterSchema, { ...filter, limit: 201 })).toBe(false)
    expect(Value.Check(AuditListFilterSchema, {
      ...filter,
      scope: without(SITE_SCOPE, 'workspaceId'),
    })).toBe(false)

    expect(() => assertAuditListFilter({
      scope: SITE_SCOPE,
      createdAfter: '2026-07-26T00:00:00Z',
      createdBefore: '2026-07-25T00:00:00Z',
    })).toThrow(expect.objectContaining({ code: 'invalid-time-range' }))
  })
})

describe('FUMA-022 sensitive-event catalog', () => {
  it('covers every action exactly once with immutable sensitivity and metadata rules', () => {
    expect(FUMA_AUDIT_EVENT_CATALOG.map(({ action }) => action))
      .toEqual(FUMA_AUDIT_ACTIONS)
    expect(new Set(FUMA_AUDIT_EVENT_CATALOG.map(({ action }) => action)).size)
      .toBe(FUMA_AUDIT_ACTIONS.length)

    expect(Value.Check(AuditEventCatalogSchema, FUMA_AUDIT_EVENT_CATALOG)).toBe(true)
    expect(Object.isFrozen(FUMA_AUDIT_EVENT_CATALOG)).toBe(true)
    for (const entry of FUMA_AUDIT_EVENT_CATALOG) {
      expect(Object.isFrozen(entry)).toBe(true)
      expect(Object.isFrozen(entry.requiredMetadataKeys)).toBe(true)
      expect(entry.action.startsWith(`${entry.category}.`)).toBe(true)
      expect(['tenant', 'privileged', 'security']).toContain(entry.sensitivity)
    }
  })

  it('rejects action and normalized required-key collisions', () => {
    const entry = FUMA_AUDIT_EVENT_CATALOG[0]
    expect(() => createAuditEventCatalog([entry, entry])).toThrow(
      expect.objectContaining({
        name: 'AuditCatalogError',
        code: 'duplicate-action',
      }),
    )

    expect(() => createAuditEventCatalog([{
      action: 'job.enqueued',
      category: 'job',
      sensitivity: 'tenant',
      requiredMetadataKeys: ['jobId', 'job-id'],
    }])).toThrow(expect.objectContaining({
      code: 'duplicate-required-metadata-key',
    }))
  })

  it('detaches and deeply freezes composed catalogs and fails closed for unknown actions', () => {
    const input = [{
      action: 'job.enqueued',
      category: 'job',
      sensitivity: 'tenant',
      requiredMetadataKeys: ['jobKind'],
    }]
    const catalog = createAuditEventCatalog(input)
    input[0].requiredMetadataKeys[0] = 'changedAfterCreation'

    expect(catalog[0].requiredMetadataKeys).toEqual(['jobKind'])
    expect(Object.isFrozen(catalog)).toBe(true)
    expect(Object.isFrozen(catalog[0])).toBe(true)
    expect(Object.isFrozen(catalog[0].requiredMetadataKeys)).toBe(true)
    expect(getAuditEventCatalogEntry('job.enqueued')).toEqual(
      expect.objectContaining({ category: 'job' }),
    )
    expect(() => getAuditEventCatalogEntry('job.unknown')).toThrow(
      expect.objectContaining({ code: 'unknown-action' }),
    )
  })
})

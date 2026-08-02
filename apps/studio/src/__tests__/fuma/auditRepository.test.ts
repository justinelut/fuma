import { describe, expect, it } from 'bun:test'
import type { DbClient, DbResult } from '../../../server/db/client'
import {
  PostgresAuditRepository,
} from '../../../server/fuma/audit/repository'
import type {
  CreatedAuditEvent,
} from '../../../server/fuma/audit/contracts'

type CapturedCall = Readonly<{
  sql: string
  parameters: readonly unknown[]
}>

interface AuditRowFixture {
  platform_id: string
  organization_id: string | null
  workspace_id: string | null
  site_id: string | null
  id: string
  scope_kind: string
  actor_kind: string
  actor_user_id: string | null
  actor_session_id: string | null
  impersonator_user_id: string | null
  request_id: string | null
  originating_request_id: string | null
  job_id: string | null
  run_id: string | null
  action: string
  outcome: string
  metadata_json: unknown
  created_at: string
}

function result<Row>(rows: Row[]): DbResult<Row> {
  return { rows, rowCount: rows.length }
}

function recordingDb(
  taggedRows: AuditRowFixture[] = [],
  unsafeRows: AuditRowFixture[] = [],
): Readonly<{
  db: DbClient
  tagged: CapturedCall[]
  unsafe: CapturedCall[]
}> {
  const tagged: CapturedCall[] = []
  const unsafe: CapturedCall[] = []
  const db = (async <Row = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<DbResult<Row>> => {
    tagged.push({ sql: strings.join('?'), parameters: structuredClone(values) })
    return result(structuredClone(taggedRows) as unknown as Row[])
  }) as DbClient
  db.unsafe = async <Row = Record<string, unknown>>(
    sql: string,
    parameters: unknown[] = [],
  ): Promise<DbResult<Row>> => {
    unsafe.push({ sql, parameters: structuredClone(parameters) })
    return result(structuredClone(unsafeRows) as unknown as Row[])
  }
  db.transaction = async <T>(work: (tx: DbClient) => Promise<T>): Promise<T> => (
    await work(db)
  )
  Object.defineProperty(db, 'dialect', { configurable: true, value: 'postgres' })
  return { db, tagged, unsafe }
}

const SITE_EVENT: CreatedAuditEvent = {
  id: 'audit-01',
  action: 'site.created',
  scope: {
    kind: 'site',
    platformId: 'platform-fuma',
    organizationId: 'organization-a',
    workspaceId: 'workspace-shared',
    siteId: 'site-shared',
  },
  actor: {
    kind: 'staff',
    userId: 'staff-effective',
    sessionId: 'session-01',
    impersonator: { userId: 'staff-operator' },
  },
  correlation: { kind: 'request', requestId: 'request-shared' },
  outcome: 'success',
  metadata: { siteSlug: 'main', profileId: 'website' },
  createdAt: '2026-07-25T05:20:00.000Z',
}

function row(event: CreatedAuditEvent = SITE_EVENT): AuditRowFixture {
  return {
    platform_id: event.scope.platformId,
    organization_id: event.scope.kind === 'platform' ? null : event.scope.organizationId,
    workspace_id: event.scope.kind === 'workspace' || event.scope.kind === 'site'
      ? event.scope.workspaceId
      : null,
    site_id: event.scope.kind === 'site' ? event.scope.siteId : null,
    id: event.id,
    scope_kind: event.scope.kind,
    actor_kind: event.actor.kind,
    actor_user_id: event.actor.kind === 'staff' ? event.actor.userId : null,
    actor_session_id: event.actor.kind === 'staff' ? event.actor.sessionId : null,
    impersonator_user_id: event.actor.kind === 'staff'
      ? event.actor.impersonator?.userId ?? null
      : null,
    request_id: event.correlation.requestId,
    originating_request_id: event.correlation.kind === 'job'
      ? event.correlation.originatingRequestId
      : null,
    job_id: event.actor.kind === 'internal-job' ? event.actor.jobId : null,
    run_id: event.actor.kind === 'internal-job' ? event.actor.runId : null,
    action: event.action,
    outcome: event.outcome,
    metadata_json: structuredClone(event.metadata),
    created_at: event.createdAt,
  }
}

function normalized(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

describe('FUMA-022 PostgreSQL audit repository', () => {
  it('has an append/list-only API', () => {
    expect(Object.getOwnPropertyNames(PostgresAuditRepository.prototype).sort()).toEqual([
      'append',
      'constructor',
      'list',
    ])
  })

  it('appends every trusted field and exposes no mutation SQL', async () => {
    const capture = recordingDb([row()])
    const repository = new PostgresAuditRepository(capture.db)

    const created = await repository.append(SITE_EVENT)

    expect(created).toEqual(SITE_EVENT)
    expect(Object.isFrozen(created)).toBe(true)
    expect(Object.isFrozen(created.metadata)).toBe(true)
    expect(capture.tagged).toHaveLength(1)
    const call = capture.tagged[0]!
    const sql = normalized(call.sql).toLowerCase()
    expect(sql).toContain('insert into fuma_audit_history')
    expect(sql).toContain('returning platform_id, organization_id, workspace_id, site_id')
    expect(sql).not.toContain(' update ')
    expect(sql).not.toContain(' delete ')
    expect(call.parameters).toContain('platform-fuma')
    expect(call.parameters).toContain('organization-a')
    expect(call.parameters).toContain('workspace-shared')
    expect(call.parameters).toContain('site-shared')
    expect(call.parameters).toContain('staff-effective')
    expect(call.parameters).toContain('staff-operator')
    expect(call.parameters).toContain('request-shared')
  })

  it('uses an exact complete-ancestry predicate for every scope level', async () => {
    const capture = recordingDb()
    const repository = new PostgresAuditRepository(capture.db)
    const scopes = [
      { kind: 'platform', platformId: 'platform-fuma' },
      {
        kind: 'organization',
        platformId: 'platform-fuma',
        organizationId: 'organization-a',
      },
      {
        kind: 'workspace',
        platformId: 'platform-fuma',
        organizationId: 'organization-a',
        workspaceId: 'workspace-shared',
      },
      SITE_EVENT.scope,
    ] as const

    for (const scope of scopes) await repository.list({ scope })

    expect(capture.unsafe).toHaveLength(4)
    const [platform, organization, workspace, site] = capture.unsafe.map(({ sql }) => (
      normalized(sql)
    ))
    expect(platform).toContain('event.scope_kind = $1 and event.platform_id = $2 and event.organization_id is null and event.workspace_id is null and event.site_id is null')
    expect(organization).toContain('event.scope_kind = $1 and event.platform_id = $2 and event.organization_id = $3 and event.workspace_id is null and event.site_id is null')
    expect(workspace).toContain('event.scope_kind = $1 and event.platform_id = $2 and event.organization_id = $3 and event.workspace_id = $4 and event.site_id is null')
    expect(site).toContain('event.scope_kind = $1 and event.platform_id = $2 and event.organization_id = $3 and event.workspace_id = $4 and event.site_id = $5')
    for (const call of capture.unsafe) {
      expect(normalized(call.sql)).toContain('order by event.created_at desc, event.id')
      expect(call.parameters.at(-1)).toBe(50)
    }
  })

  it('keeps request/job filters inside exact tenant scope and scopes cursor lookup too', async () => {
    const capture = recordingDb()
    const repository = new PostgresAuditRepository(capture.db)

    await repository.list({
      scope: SITE_EVENT.scope,
      actions: ['job.failed'],
      actor: { kind: 'internal-job', jobId: 'job-collision' },
      outcomes: ['failure', 'denied'],
      requestId: 'request-collision',
      jobId: 'job-collision',
      createdAfter: '2026-07-25T04:00:00.000Z',
      createdBefore: '2026-07-25T06:00:00.000Z',
      cursor: 'audit-cursor',
      limit: 17,
    })

    const call = capture.unsafe[0]!
    const sql = normalized(call.sql)
    expect(sql).toContain('from fuma_audit_history as cursor_event where cursor_event.scope_kind = $1 and cursor_event.platform_id = $2 and cursor_event.organization_id = $3 and cursor_event.workspace_id = $4 and cursor_event.site_id = $5 and cursor_event.id = $6')
    expect(sql).toContain('event.scope_kind = $7 and event.platform_id = $8 and event.organization_id = $9 and event.workspace_id = $10 and event.site_id = $11')
    expect(sql).toContain('(event.request_id = $17 or event.originating_request_id = $17)')
    expect(sql).toContain('event.job_id = $18')
    expect(sql).toContain('event.created_at < (select created_at from cursor_event)')
    expect(sql).toContain('event.id > (select id from cursor_event)')
    expect(call.parameters.slice(0, 11)).toEqual([
      'site',
      'platform-fuma',
      'organization-a',
      'workspace-shared',
      'site-shared',
      'audit-cursor',
      'site',
      'platform-fuma',
      'organization-a',
      'workspace-shared',
      'site-shared',
    ])
    expect(call.parameters).toContain('request-collision')
    expect(call.parameters.at(-1)).toBe(17)
  })

  it('maps and detaches returned records from database row objects', async () => {
    const fixture = row()
    const capture = recordingDb([], [fixture])
    const repository = new PostgresAuditRepository(capture.db)

    const events = await repository.list({ scope: SITE_EVENT.scope })
    fixture.metadata_json = { siteSlug: 'mutated', profileId: 'publication' }

    expect(events).toEqual([SITE_EVENT])
    expect(Object.isFrozen(events)).toBe(true)
    expect(Object.isFrozen(events[0]!.scope)).toBe(true)
  })
})

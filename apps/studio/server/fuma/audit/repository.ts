import type { DbClient } from '../../db/client'
import {
  assertAuditListFilter,
  assertCreatedAuditEvent,
  type AuditListFilter,
  type AuditTenantScope,
  type CreatedAuditEvent,
} from './contracts'

interface AuditHistoryRow {
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
  created_at: string | Date
}

/** The persistence API is intentionally append-only. */
export interface AuditRepository {
  append(event: CreatedAuditEvent): Promise<CreatedAuditEvent>
  list(filter: AuditListFilter): Promise<readonly CreatedAuditEvent[]>
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

function mapAuditEvent(row: AuditHistoryRow): CreatedAuditEvent {
  const scope = row.scope_kind === 'platform'
    ? {
        kind: 'platform' as const,
        platformId: row.platform_id,
      }
    : row.scope_kind === 'organization'
      ? {
          kind: 'organization' as const,
          platformId: row.platform_id,
          organizationId: row.organization_id,
        }
      : row.scope_kind === 'workspace'
        ? {
            kind: 'workspace' as const,
            platformId: row.platform_id,
            organizationId: row.organization_id,
            workspaceId: row.workspace_id,
          }
        : {
            kind: row.scope_kind,
            platformId: row.platform_id,
            organizationId: row.organization_id,
            workspaceId: row.workspace_id,
            siteId: row.site_id,
          }

  const actor = row.actor_kind === 'staff'
    ? {
        kind: 'staff' as const,
        userId: row.actor_user_id,
        sessionId: row.actor_session_id,
        impersonator: row.impersonator_user_id === null
          ? null
          : { userId: row.impersonator_user_id },
      }
    : {
        kind: row.actor_kind,
        jobId: row.job_id,
        runId: row.run_id,
      }

  const correlation = row.actor_kind === 'staff'
    ? {
        kind: 'request' as const,
        requestId: row.request_id,
      }
    : {
        kind: 'job' as const,
        requestId: row.request_id,
        jobId: row.job_id,
        runId: row.run_id,
        originatingRequestId: row.originating_request_id,
      }

  const candidate = structuredClone({
    id: row.id,
    action: row.action,
    scope,
    actor,
    correlation,
    outcome: row.outcome,
    metadata: row.metadata_json,
    createdAt: iso(row.created_at),
  })
  assertCreatedAuditEvent(candidate)
  return deepFreeze(candidate)
}

function ancestry(scope: AuditTenantScope): Readonly<{
  organizationId: string | null
  workspaceId: string | null
  siteId: string | null
}> {
  return {
    organizationId: scope.kind === 'platform' ? null : scope.organizationId,
    workspaceId: scope.kind === 'workspace' || scope.kind === 'site'
      ? scope.workspaceId
      : null,
    siteId: scope.kind === 'site' ? scope.siteId : null,
  }
}

type SqlParameters = unknown[]

function bind(parameters: SqlParameters, value: unknown): string {
  parameters.push(value)
  return `$${parameters.length}`
}

/**
 * Matches exactly one scope. Explicit null predicates are intentional: a
 * broader target must never include descendants, and every narrower target
 * carries every available ancestor in the same predicate.
 */
function exactScopePredicate(
  alias: string,
  scope: AuditTenantScope,
  parameters: SqlParameters,
): string {
  const predicates = [
    `${alias}.scope_kind = ${bind(parameters, scope.kind)}`,
    `${alias}.platform_id = ${bind(parameters, scope.platformId)}`,
  ]
  if (scope.kind === 'platform') {
    predicates.push(
      `${alias}.organization_id is null`,
      `${alias}.workspace_id is null`,
      `${alias}.site_id is null`,
    )
  } else {
    predicates.push(`${alias}.organization_id = ${bind(parameters, scope.organizationId)}`)
    if (scope.kind === 'organization') {
      predicates.push(`${alias}.workspace_id is null`, `${alias}.site_id is null`)
    } else {
      predicates.push(`${alias}.workspace_id = ${bind(parameters, scope.workspaceId)}`)
      if (scope.kind === 'workspace') {
        predicates.push(`${alias}.site_id is null`)
      } else {
        predicates.push(`${alias}.site_id = ${bind(parameters, scope.siteId)}`)
      }
    }
  }
  return predicates.join('\n        and ')
}

const AUDIT_COLUMNS = `
  platform_id, organization_id, workspace_id, site_id, id, scope_kind,
  actor_kind, actor_user_id, actor_session_id, impersonator_user_id,
  request_id, originating_request_id, job_id, run_id, action, outcome,
  metadata_json, created_at
`

export class PostgresAuditRepository implements AuditRepository {
  readonly #db: DbClient

  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') {
      throw new Error('Fuma audit history requires PostgreSQL authority.')
    }
    this.#db = db
  }

  async append(event: CreatedAuditEvent): Promise<CreatedAuditEvent> {
    assertCreatedAuditEvent(event)
    const ownedEvent = structuredClone(event)
    const scope = ancestry(ownedEvent.scope)
    const staffActor = ownedEvent.actor.kind === 'staff' ? ownedEvent.actor : null
    const jobActor = ownedEvent.actor.kind === 'internal-job' ? ownedEvent.actor : null
    const jobCorrelation = ownedEvent.correlation.kind === 'job'
      ? ownedEvent.correlation
      : null
    const metadataJson = JSON.stringify(ownedEvent.metadata)

    const { rows } = await this.#db<AuditHistoryRow>`
      insert into fuma_audit_history (
        platform_id, organization_id, workspace_id, site_id, id, scope_kind,
        actor_kind, actor_user_id, actor_session_id, impersonator_user_id,
        request_id, originating_request_id, job_id, run_id, action, outcome,
        metadata_json, created_at
      ) values (
        ${ownedEvent.scope.platformId}, ${scope.organizationId}, ${scope.workspaceId},
        ${scope.siteId}, ${ownedEvent.id}, ${ownedEvent.scope.kind},
        ${ownedEvent.actor.kind}, ${staffActor?.userId ?? null},
        ${staffActor?.sessionId ?? null}, ${staffActor?.impersonator?.userId ?? null},
        ${ownedEvent.correlation.requestId},
        ${jobCorrelation?.originatingRequestId ?? null}, ${jobActor?.jobId ?? null},
        ${jobActor?.runId ?? null}, ${ownedEvent.action}, ${ownedEvent.outcome},
        ${metadataJson}, ${ownedEvent.createdAt}
      ) returning
        platform_id, organization_id, workspace_id, site_id, id, scope_kind,
        actor_kind, actor_user_id, actor_session_id, impersonator_user_id,
        request_id, originating_request_id, job_id, run_id, action, outcome,
        metadata_json, created_at
    `
    if (!rows[0]) throw new Error(`Failed to append audit event ${ownedEvent.id}.`)
    return mapAuditEvent(rows[0])
  }

  async list(filter: AuditListFilter): Promise<readonly CreatedAuditEvent[]> {
    assertAuditListFilter(filter)
    const ownedFilter = structuredClone(filter)
    const parameters: SqlParameters = []
    let cursorCte = ''
    let cursorPredicate = ''

    if (ownedFilter.cursor !== undefined) {
      const cursorScope = exactScopePredicate('cursor_event', ownedFilter.scope, parameters)
      const cursorId = bind(parameters, ownedFilter.cursor)
      cursorCte = `
        with cursor_event as (
          select created_at, id
          from fuma_audit_history as cursor_event
          where ${cursorScope}
            and cursor_event.id = ${cursorId}
        )
      `
      cursorPredicate = `
        and exists (select 1 from cursor_event)
        and (
          event.created_at < (select created_at from cursor_event)
          or (
            event.created_at = (select created_at from cursor_event)
            and event.id > (select id from cursor_event)
          )
        )
      `
    }

    const predicates = [exactScopePredicate('event', ownedFilter.scope, parameters)]
    if (ownedFilter.actions !== undefined) {
      predicates.push(`event.action in (${ownedFilter.actions.map((action) => (
        bind(parameters, action)
      )).join(', ')})`)
    }
    if (ownedFilter.actor !== undefined) {
      predicates.push(`event.actor_kind = ${bind(parameters, ownedFilter.actor.kind)}`)
      predicates.push(ownedFilter.actor.kind === 'staff'
        ? `event.actor_user_id = ${bind(parameters, ownedFilter.actor.userId)}`
        : `event.job_id = ${bind(parameters, ownedFilter.actor.jobId)}`)
    }
    if (ownedFilter.outcomes !== undefined) {
      predicates.push(`event.outcome in (${ownedFilter.outcomes.map((outcome) => (
        bind(parameters, outcome)
      )).join(', ')})`)
    }
    if (ownedFilter.requestId !== undefined) {
      const requestId = bind(parameters, ownedFilter.requestId)
      predicates.push(`(event.request_id = ${requestId} or event.originating_request_id = ${requestId})`)
    }
    if (ownedFilter.jobId !== undefined) {
      predicates.push(`event.job_id = ${bind(parameters, ownedFilter.jobId)}`)
    }
    if (ownedFilter.createdAfter !== undefined) {
      predicates.push(`event.created_at > ${bind(parameters, ownedFilter.createdAfter)}`)
    }
    if (ownedFilter.createdBefore !== undefined) {
      predicates.push(`event.created_at < ${bind(parameters, ownedFilter.createdBefore)}`)
    }
    const limit = bind(parameters, ownedFilter.limit ?? 50)

    const { rows } = await this.#db.unsafe<AuditHistoryRow>(`
      ${cursorCte}
      select ${AUDIT_COLUMNS}
      from fuma_audit_history as event
      where ${predicates.join('\n        and ')}
        ${cursorPredicate}
      order by event.created_at desc, event.id
      limit ${limit}
    `, parameters)
    return deepFreeze(rows.map(mapAuditEvent))
  }
}

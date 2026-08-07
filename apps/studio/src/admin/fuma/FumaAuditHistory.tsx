import { useId, type ReactNode } from 'react'
import { Badge } from '@admin/pages/users/components/Badge'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '@ui/components/DataTable'
import { Skeleton } from '@admin/fuma/ui/skeleton'
export type FumaAuditHistoryScope = Readonly<
  | { kind: 'platform'; platformId: string }
  | { kind: 'organization'; platformId: string; organizationId: string }
  | {
      kind: 'workspace'
      platformId: string
      organizationId: string
      workspaceId: string
    }
  | {
      kind: 'site'
      platformId: string
      organizationId: string
      workspaceId: string
      siteId: string
    }
>

export interface FumaAuditMetadataObject {
  readonly [key: string]: FumaAuditMetadataValue
}

export type FumaAuditMetadataValue =
  | null
  | boolean
  | number
  | string
  | readonly FumaAuditMetadataValue[]
  | FumaAuditMetadataObject

export type FumaAuditHistoryRecord = Readonly<{
  id: string
  action: string
  scope: FumaAuditHistoryScope
  actor: Readonly<
    | {
        kind: 'staff'
        userId: string
        sessionId: string
        impersonator: Readonly<{ userId: string }> | null
      }
    | { kind: 'internal-job'; jobId: string; runId: string }
  >
  correlation: Readonly<
    | { kind: 'request'; requestId: string }
    | {
        kind: 'job'
        requestId: string
        jobId: string
        runId: string
        originatingRequestId: string | null
      }
  >
  outcome: 'success' | 'failure' | 'denied'
  metadata: Readonly<Record<string, FumaAuditMetadataValue>>
  createdAt: string
}>

type AuditTenantScope = FumaAuditHistoryScope
type AuditMetadataValue = FumaAuditMetadataValue
type AuditActor = FumaAuditHistoryRecord['actor']
type AuditCorrelation = FumaAuditHistoryRecord['correlation']
type AuditOutcome = FumaAuditHistoryRecord['outcome']
type CreatedAuditEvent = FumaAuditHistoryRecord

const AUDIT_REDACTED_VALUE = '[REDACTED]'

const OUTCOME_LABELS: Record<AuditOutcome, string> = {
  success: 'Success',
  failure: 'Failure',
  denied: 'Denied',
}

const SCOPE_LABELS: Record<AuditTenantScope['kind'], string> = {
  platform: 'Platform',
  organization: 'Organization',
  workspace: 'Workspace',
  site: 'Site',
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString()
}

export interface FumaAuditHistoryProps {
  scope: AuditTenantScope
  records: readonly CreatedAuditEvent[]
  loading?: boolean
  error?: string | null
  title?: string
}

type ScopeCoordinate = Readonly<{
  label: string
  value: string
}>

function scopeCoordinates(scope: AuditTenantScope): readonly ScopeCoordinate[] {
  const coordinates: ScopeCoordinate[] = [
    { label: 'Platform', value: scope.platformId },
  ]
  if (scope.kind !== 'platform') {
    coordinates.push({ label: 'Organization', value: scope.organizationId })
  }
  if (scope.kind === 'workspace' || scope.kind === 'site') {
    coordinates.push({ label: 'Workspace', value: scope.workspaceId })
  }
  if (scope.kind === 'site') {
    coordinates.push({ label: 'Site', value: scope.siteId })
  }
  return coordinates
}

function isExactScope(
  expected: AuditTenantScope,
  candidate: AuditTenantScope,
): boolean {
  if (
    expected.kind !== candidate.kind
    || expected.platformId !== candidate.platformId
  ) {
    return false
  }
  if (expected.kind === 'platform' || candidate.kind === 'platform') return true
  if (expected.organizationId !== candidate.organizationId) return false
  if (
    expected.kind === 'organization'
    || candidate.kind === 'organization'
  ) {
    return true
  }
  if (expected.workspaceId !== candidate.workspaceId) return false
  if (expected.kind === 'workspace' || candidate.kind === 'workspace') return true
  return expected.siteId === candidate.siteId
}

function ScopeDetails({ scope }: { scope: AuditTenantScope }) {
  return (
    <div className="flex max-w-[min(100%,760px)] flex-wrap items-start justify-end gap-2" role="group" aria-label="Audit scope">
      <Badge label={`${SCOPE_LABELS[scope.kind]} scope`} muted />
      <dl className="m-0 flex flex-wrap justify-end gap-2">
        {scopeCoordinates(scope).map(({ label, value }) => (
          <div className="inline-flex min-w-0 items-baseline gap-0.5 [&_dt]:text-[0.6875rem] [&_dt]:font-semibold [&_dt]:text-muted-foreground [&_dd]:m-0 [&_dd]:min-w-0 [&_code]:font-mono [&_code]:break-words [&_code]:text-foreground" key={label}>
            <dt>{label}</dt>
            <dd><code>{value}</code></dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function Resource({ scope }: { scope: AuditTenantScope }) {
  return (
    <div className="grid min-w-[150px] justify-items-start gap-0.5">
      <Badge label={SCOPE_LABELS[scope.kind]} muted />
      {scopeCoordinates(scope).map(({ label, value }) => (
        <span className="grid max-w-[260px] gap-px [&_code]:font-mono [&_code]:break-words [&_code]:text-foreground" key={label}>
          <span className="text-[0.6875rem] font-semibold text-muted-foreground">{label}</span>
          <code>{value}</code>
        </span>
      ))}
    </div>
  )
}

function Actor({ actor }: { actor: AuditActor }) {
  if (actor.kind === 'staff') {
    return (
      <div className="grid min-w-[150px] justify-items-start gap-0.5">
        <Badge label="Staff" muted />
        <span className="grid max-w-[260px] gap-px [&_code]:font-mono [&_code]:break-words [&_code]:text-foreground">
          <span className="text-[0.6875rem] font-semibold text-muted-foreground">Effective actor</span>
          <code>{actor.userId}</code>
        </span>
        <span className="grid max-w-[260px] gap-px [&_code]:font-mono [&_code]:break-words [&_code]:text-foreground">
          <span className="text-[0.6875rem] font-semibold text-muted-foreground">Session</span>
          <code>{actor.sessionId}</code>
        </span>
        {actor.impersonator ? (
          <span className="mt-0.5 grid max-w-[260px] gap-px rounded-md bg-amber-500/10 p-1 text-amber-800 dark:text-amber-200">
            <span className="text-[0.6875rem] font-semibold text-muted-foreground">Impersonated by</span>
            <code>{actor.impersonator.userId}</code>
          </span>
        ) : null}
      </div>
    )
  }

  return (
    <div className="grid min-w-[150px] justify-items-start gap-0.5">
      <Badge label="Internal job" muted />
      <span className="grid max-w-[260px] gap-px [&_code]:font-mono [&_code]:break-words [&_code]:text-foreground">
        <span className="text-[0.6875rem] font-semibold text-muted-foreground">Job actor</span>
        <code>{actor.jobId}</code>
      </span>
      <span className="grid max-w-[260px] gap-px [&_code]:font-mono [&_code]:break-words [&_code]:text-foreground">
        <span className="text-[0.6875rem] font-semibold text-muted-foreground">Run</span>
        <code>{actor.runId}</code>
      </span>
    </div>
  )
}

function Correlation({ correlation }: { correlation: AuditCorrelation }) {
  if (correlation.kind === 'request') {
    return (
      <div className="grid min-w-[150px] justify-items-start gap-0.5" aria-label={`Request correlation ${correlation.requestId}`}>
        <Badge label="Request" muted />
        <span className="grid max-w-[260px] gap-px [&_code]:font-mono [&_code]:break-words [&_code]:text-foreground">
          <span className="text-[0.6875rem] font-semibold text-muted-foreground">Request</span>
          <code>{correlation.requestId}</code>
        </span>
      </div>
    )
  }

  const provenanceLabel = correlation.originatingRequestId
    ? `Job correlation from request ${correlation.originatingRequestId} to execution request ${correlation.requestId}`
    : `Job correlation for execution request ${correlation.requestId}`

  return (
    <div className="grid min-w-[150px] justify-items-start gap-0.5" aria-label={provenanceLabel}>
      <Badge label="Request → job" muted />
      {correlation.originatingRequestId ? (
        <span className="grid max-w-[260px] gap-px [&_code]:font-mono [&_code]:break-words [&_code]:text-foreground">
          <span className="text-[0.6875rem] font-semibold text-muted-foreground">Originating request</span>
          <code>{correlation.originatingRequestId}</code>
        </span>
      ) : null}
      <span className="grid max-w-[260px] gap-px [&_code]:font-mono [&_code]:break-words [&_code]:text-foreground">
        <span className="text-[0.6875rem] font-semibold text-muted-foreground">Execution request</span>
        <code>{correlation.requestId}</code>
      </span>
      <span className="grid max-w-[260px] gap-px [&_code]:font-mono [&_code]:break-words [&_code]:text-foreground">
        <span className="text-[0.6875rem] font-semibold text-muted-foreground">Job</span>
        <code>{correlation.jobId}</code>
      </span>
      <span className="grid max-w-[260px] gap-px [&_code]:font-mono [&_code]:break-words [&_code]:text-foreground">
        <span className="text-[0.6875rem] font-semibold text-muted-foreground">Run</span>
        <code>{correlation.runId}</code>
      </span>
    </div>
  )
}

function MetadataValue({ value }: { value: AuditMetadataValue }): ReactNode {
  if (value === AUDIT_REDACTED_VALUE) return <Badge label="Redacted" muted />
  if (value === null) return <code className="font-mono">null</code>
  if (typeof value === 'string') return <span className="break-words">{value}</span>
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <code className="font-mono">{String(value)}</code>
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">Empty list</span>
    return (
      <ol className="grid gap-px">
        {value.map((item, index) => (
          <li key={index}><MetadataValue value={item} /></li>
        ))}
      </ol>
    )
  }

  const entries = Object.entries(value)
  if (entries.length === 0) return <span className="text-muted-foreground">Empty object</span>
  return (
    <dl className="m-0 grid min-w-0 gap-1 pl-2 [&_dt]:text-[0.6875rem] [&_dt]:font-semibold [&_dt]:text-muted-foreground [&_dd]:m-0 [&_dd]:min-w-0 [&>div]:grid [&>div]:min-w-0 [&>div]:gap-px">
      {entries.map(([key, nestedValue]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd><MetadataValue value={nestedValue} /></dd>
        </div>
      ))}
    </dl>
  )
}

function Metadata({ event }: { event: CreatedAuditEvent }) {
  const entries = Object.entries(event.metadata)
  if (entries.length === 0) {
    return <span className="text-muted-foreground">No metadata</span>
  }
  return (
    <dl className="m-0 grid min-w-[190px] gap-1" aria-label={`Metadata for ${event.action}`}>
      {entries.map(([key, value]) => (
        <div className="grid min-w-0 gap-px [&>dt]:text-[0.6875rem] [&>dt]:font-semibold [&>dt]:text-muted-foreground [&>dd]:m-0 [&>dd]:min-w-0" key={key}>
          <dt>{key}</dt>
          <dd><MetadataValue value={value} /></dd>
        </div>
      ))}
    </dl>
  )
}

function Outcome({ outcome }: { outcome: AuditOutcome }) {
  const label = OUTCOME_LABELS[outcome]
  return (
    <span
      className="inline-flex items-center gap-0.5 data-[outcome=success]:[&_span]:bg-primary data-[outcome=failure]:[&_span]:bg-destructive data-[outcome=denied]:[&_span]:bg-amber-500"
      data-outcome={outcome}
      aria-label={`Outcome: ${label}`}
    >
      <span className="size-1.5 flex-none rounded-full bg-muted-foreground" aria-hidden="true" />
      <Badge label={label} muted />
    </span>
  )
}

function LoadingTable({ scope }: { scope: AuditTenantScope }) {
  return (
    <DataTable
      aria-label={`Loading ${scope.kind} audit history`}
      aria-busy="true"
      density="compact"
      className="min-w-[1460px]"
    >
      <DataTableHead>
        <DataTableRow>
          <DataTableHeader scope="col">Action</DataTableHeader>
          <DataTableHeader scope="col">Outcome</DataTableHeader>
          <DataTableHeader scope="col">Actor</DataTableHeader>
          <DataTableHeader scope="col">Resource</DataTableHeader>
          <DataTableHeader scope="col">Correlation</DataTableHeader>
          <DataTableHeader scope="col">Metadata</DataTableHeader>
          <DataTableHeader scope="col">Timestamp</DataTableHeader>
        </DataTableRow>
      </DataTableHead>
      <DataTableBody>
        {Array.from({ length: 4 }, (_, index) => (
          <DataTableRow key={`audit-skeleton-${index}`}>
            <DataTableCell><Skeleton className="w-[170px] h-[13px]" /></DataTableCell>
            <DataTableCell><Skeleton className="w-[64px] h-[18px]" /></DataTableCell>
            <DataTableCell><Skeleton className="w-[140px] h-[34px]" /></DataTableCell>
            <DataTableCell><Skeleton className="w-[150px] h-[34px]" /></DataTableCell>
            <DataTableCell><Skeleton className="w-[170px] h-[34px]" /></DataTableCell>
            <DataTableCell><Skeleton className="w-[150px] h-[34px]" /></DataTableCell>
            <DataTableCell><Skeleton className="w-[130px] h-[13px]" /></DataTableCell>
          </DataTableRow>
        ))}
      </DataTableBody>
    </DataTable>
  )
}

export function FumaAuditHistory({
  scope,
  records,
  loading = false,
  error = null,
  title = 'Audit history',
}: FumaAuditHistoryProps) {
  const headingId = useId()
  const scopedRecords = records.filter((record) => isExactScope(scope, record.scope))

  return (
    <section
      className="grid min-w-0 gap-6 text-foreground"
      aria-labelledby={headingId}
      aria-busy={loading && !error ? 'true' : undefined}
    >
      <header className="flex items-start justify-between gap-8">
        <div className="grid gap-1 [&_h2]:m-0 [&_h2]:text-2xl [&_h2]:text-foreground [&_p]:m-0 [&_p]:text-sm [&_p]:text-muted-foreground">
          <h2 id={headingId}>{title}</h2>
          <p>Read-only hosted security and operations history for this exact tenant scope.</p>
        </div>
        <ScopeDetails scope={scope} />
      </header>

      {error ? (
        <div className="text-sm text-muted-foreground" role="alert">
          <strong>Audit history unavailable</strong>
          <span>{error}</span>
        </div>
      ) : loading ? (
        <LoadingTable scope={scope} />
      ) : scopedRecords.length === 0 ? (
        <div className="text-sm text-muted-foreground" role="status" aria-label="Empty audit history">
          <strong>No audit events</strong>
          <span>No events were recorded for this exact scope.</span>
        </div>
      ) : (
        <DataTable
          aria-label={`${SCOPE_LABELS[scope.kind]} audit history`}
          density="compact"
          className="min-w-[1460px]"
        >
          <DataTableHead>
            <DataTableRow>
              <DataTableHeader scope="col">Action</DataTableHeader>
              <DataTableHeader scope="col">Outcome</DataTableHeader>
              <DataTableHeader scope="col">Actor</DataTableHeader>
              <DataTableHeader scope="col">Resource</DataTableHeader>
              <DataTableHeader scope="col">Correlation</DataTableHeader>
              <DataTableHeader scope="col">Metadata</DataTableHeader>
              <DataTableHeader scope="col">Timestamp</DataTableHeader>
            </DataTableRow>
          </DataTableHead>
          <DataTableBody>
            {scopedRecords.map((event) => (
              <DataTableRow
                key={event.id}
                aria-label={`${event.action}, ${OUTCOME_LABELS[event.outcome]}`}
              >
                <DataTableCell>
                  <code className="font-mono text-xs break-words text-foreground">{event.action}</code>
                </DataTableCell>
                <DataTableCell><Outcome outcome={event.outcome} /></DataTableCell>
                <DataTableCell><Actor actor={event.actor} /></DataTableCell>
                <DataTableCell><Resource scope={event.scope} /></DataTableCell>
                <DataTableCell><Correlation correlation={event.correlation} /></DataTableCell>
                <DataTableCell><Metadata event={event} /></DataTableCell>
                <DataTableCell>
                  <time className="font-mono" dateTime={event.createdAt} title={event.createdAt}>
                    {formatTimestamp(event.createdAt)}
                  </time>
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      )}
    </section>
  )
}

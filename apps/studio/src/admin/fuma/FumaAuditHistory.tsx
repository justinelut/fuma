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
import { Skeleton } from '@ui/components/Skeleton'
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
import styles from './FumaAuditHistory.module.css'

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
    <div className={styles.scopeGroup} role="group" aria-label="Audit scope">
      <Badge label={`${SCOPE_LABELS[scope.kind]} scope`} muted />
      <dl className={styles.scopeCoordinates}>
        {scopeCoordinates(scope).map(({ label, value }) => (
          <div className={styles.scopeCoordinate} key={label}>
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
    <div className={styles.cellStack}>
      <Badge label={SCOPE_LABELS[scope.kind]} muted />
      {scopeCoordinates(scope).map(({ label, value }) => (
        <span className={styles.identifierLine} key={label}>
          <span className={styles.detailLabel}>{label}</span>
          <code>{value}</code>
        </span>
      ))}
    </div>
  )
}

function Actor({ actor }: { actor: AuditActor }) {
  if (actor.kind === 'staff') {
    return (
      <div className={styles.cellStack}>
        <Badge label="Staff" muted />
        <span className={styles.identifierLine}>
          <span className={styles.detailLabel}>Effective actor</span>
          <code>{actor.userId}</code>
        </span>
        <span className={styles.identifierLine}>
          <span className={styles.detailLabel}>Session</span>
          <code>{actor.sessionId}</code>
        </span>
        {actor.impersonator ? (
          <span className={styles.impersonatorLine}>
            <span className={styles.detailLabel}>Impersonated by</span>
            <code>{actor.impersonator.userId}</code>
          </span>
        ) : null}
      </div>
    )
  }

  return (
    <div className={styles.cellStack}>
      <Badge label="Internal job" muted />
      <span className={styles.identifierLine}>
        <span className={styles.detailLabel}>Job actor</span>
        <code>{actor.jobId}</code>
      </span>
      <span className={styles.identifierLine}>
        <span className={styles.detailLabel}>Run</span>
        <code>{actor.runId}</code>
      </span>
    </div>
  )
}

function Correlation({ correlation }: { correlation: AuditCorrelation }) {
  if (correlation.kind === 'request') {
    return (
      <div className={styles.cellStack} aria-label={`Request correlation ${correlation.requestId}`}>
        <Badge label="Request" muted />
        <span className={styles.identifierLine}>
          <span className={styles.detailLabel}>Request</span>
          <code>{correlation.requestId}</code>
        </span>
      </div>
    )
  }

  const provenanceLabel = correlation.originatingRequestId
    ? `Job correlation from request ${correlation.originatingRequestId} to execution request ${correlation.requestId}`
    : `Job correlation for execution request ${correlation.requestId}`

  return (
    <div className={styles.cellStack} aria-label={provenanceLabel}>
      <Badge label="Request → job" muted />
      {correlation.originatingRequestId ? (
        <span className={styles.identifierLine}>
          <span className={styles.detailLabel}>Originating request</span>
          <code>{correlation.originatingRequestId}</code>
        </span>
      ) : null}
      <span className={styles.identifierLine}>
        <span className={styles.detailLabel}>Execution request</span>
        <code>{correlation.requestId}</code>
      </span>
      <span className={styles.identifierLine}>
        <span className={styles.detailLabel}>Job</span>
        <code>{correlation.jobId}</code>
      </span>
      <span className={styles.identifierLine}>
        <span className={styles.detailLabel}>Run</span>
        <code>{correlation.runId}</code>
      </span>
    </div>
  )
}

function MetadataValue({ value }: { value: AuditMetadataValue }): ReactNode {
  if (value === AUDIT_REDACTED_VALUE) return <Badge label="Redacted" muted />
  if (value === null) return <code className={styles.metadataPrimitive}>null</code>
  if (typeof value === 'string') return <span className={styles.metadataString}>{value}</span>
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <code className={styles.metadataPrimitive}>{String(value)}</code>
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className={styles.emptyValue}>Empty list</span>
    return (
      <ol className={styles.metadataArray}>
        {value.map((item, index) => (
          <li key={index}><MetadataValue value={item} /></li>
        ))}
      </ol>
    )
  }

  const entries = Object.entries(value)
  if (entries.length === 0) return <span className={styles.emptyValue}>Empty object</span>
  return (
    <dl className={styles.nestedMetadata}>
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
    return <span className={styles.emptyValue}>No metadata</span>
  }
  return (
    <dl className={styles.metadata} aria-label={`Metadata for ${event.action}`}>
      {entries.map(([key, value]) => (
        <div className={styles.metadataEntry} key={key}>
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
      className={styles.outcome}
      data-outcome={outcome}
      aria-label={`Outcome: ${label}`}
    >
      <span className={styles.outcomeDot} aria-hidden="true" />
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
      className={styles.table}
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
            <DataTableCell><Skeleton width={170} height={13} /></DataTableCell>
            <DataTableCell><Skeleton width={64} height={18} /></DataTableCell>
            <DataTableCell><Skeleton width={140} height={34} /></DataTableCell>
            <DataTableCell><Skeleton width={150} height={34} /></DataTableCell>
            <DataTableCell><Skeleton width={170} height={34} /></DataTableCell>
            <DataTableCell><Skeleton width={150} height={34} /></DataTableCell>
            <DataTableCell><Skeleton width={130} height={13} /></DataTableCell>
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
      className={styles.section}
      aria-labelledby={headingId}
      aria-busy={loading && !error ? 'true' : undefined}
    >
      <header className={styles.header}>
        <div className={styles.headingGroup}>
          <h2 id={headingId}>{title}</h2>
          <p>Read-only hosted security and operations history for this exact tenant scope.</p>
        </div>
        <ScopeDetails scope={scope} />
      </header>

      {error ? (
        <div className={styles.state} role="alert">
          <strong>Audit history unavailable</strong>
          <span>{error}</span>
        </div>
      ) : loading ? (
        <LoadingTable scope={scope} />
      ) : scopedRecords.length === 0 ? (
        <div className={styles.state} role="status" aria-label="Empty audit history">
          <strong>No audit events</strong>
          <span>No events were recorded for this exact scope.</span>
        </div>
      ) : (
        <DataTable
          aria-label={`${SCOPE_LABELS[scope.kind]} audit history`}
          density="compact"
          className={styles.table}
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
                  <code className={styles.action}>{event.action}</code>
                </DataTableCell>
                <DataTableCell><Outcome outcome={event.outcome} /></DataTableCell>
                <DataTableCell><Actor actor={event.actor} /></DataTableCell>
                <DataTableCell><Resource scope={event.scope} /></DataTableCell>
                <DataTableCell><Correlation correlation={event.correlation} /></DataTableCell>
                <DataTableCell><Metadata event={event} /></DataTableCell>
                <DataTableCell>
                  <time className={styles.timestamp} dateTime={event.createdAt} title={event.createdAt}>
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

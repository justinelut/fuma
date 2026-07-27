import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen, within } from '@testing-library/react'
import { FumaAuditHistory } from '@admin/fuma'
import type {
  AuditTenantScope,
  CreatedAuditEvent,
} from '../../../server/fuma/audit/contracts'

const SITE_SCOPE: AuditTenantScope = {
  kind: 'site',
  platformId: 'platform-africa',
  organizationId: 'organization-acacia',
  workspaceId: 'workspace-editorial',
  siteId: 'site-daily',
}

function makeEvent(
  overrides: Partial<CreatedAuditEvent> = {},
): CreatedAuditEvent {
  return {
    id: 'audit-1',
    action: 'site.updated',
    scope: SITE_SCOPE,
    actor: {
      kind: 'staff',
      userId: 'staff-editor',
      sessionId: 'session-editor',
      impersonator: null,
    },
    correlation: {
      kind: 'request',
      requestId: 'request-web-1',
    },
    outcome: 'success',
    metadata: {
      changedFields: ['name'],
    },
    createdAt: '2026-07-25T04:30:00.000Z',
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
})

describe('FUMA-022 scoped audit history', () => {
  it('displays the complete exact tenant ancestry and resource scope', () => {
    render(<FumaAuditHistory scope={SITE_SCOPE} records={[makeEvent()]} />)

    const scope = screen.getByRole('group', { name: 'Audit scope' })
    expect(within(scope).getByText('Site scope')).toBeTruthy()
    for (const [label, value] of [
      ['Platform', 'platform-africa'],
      ['Organization', 'organization-acacia'],
      ['Workspace', 'workspace-editorial'],
      ['Site', 'site-daily'],
    ]) {
      expect(within(scope).getByText(label)).toBeTruthy()
      expect(within(scope).getByText(value)).toBeTruthy()
    }

    const table = screen.getByRole('table', { name: 'Site audit history' })
    const row = within(table).getByRole('row', { name: 'site.updated, Success' })
    expect(within(row).getByText('site.updated')).toBeTruthy()
    expect(within(row).getByText('site-daily')).toBeTruthy()
    const timestamp = row.querySelector('time')
    if (!timestamp) throw new Error('Expected an audit timestamp')
    expect(timestamp.getAttribute('datetime')).toBe('2026-07-25T04:30:00.000Z')
  })

  it('does not mix records from another exact scope at the component boundary', () => {
    const crossScopeEvent = makeEvent({
      id: 'audit-cross-scope',
      action: 'site.archived',
      scope: {
        kind: 'site',
        platformId: 'platform-africa',
        organizationId: 'organization-baobab',
        workspaceId: 'workspace-editorial',
        siteId: 'site-daily',
      },
      metadata: { marker: 'cross-scope-secret' },
    })
    const exactScopeEvent = makeEvent({
      id: 'audit-exact-scope',
      metadata: { marker: 'exact-scope-visible' },
    })

    render(
      <FumaAuditHistory
        scope={SITE_SCOPE}
        records={[crossScopeEvent, exactScopeEvent]}
      />,
    )

    expect(screen.getByText('exact-scope-visible')).toBeTruthy()
    expect(screen.queryByText('cross-scope-secret')).toBeNull()
    expect(screen.queryByText('site.archived')).toBeNull()
    expect(screen.getAllByRole('row')).toHaveLength(2)
  })

  it('shows the effective staff actor and distinct impersonator', () => {
    const event = makeEvent({
      id: 'audit-impersonation',
      action: 'access.impersonation.started',
      actor: {
        kind: 'staff',
        userId: 'staff-effective',
        sessionId: 'session-impersonated',
        impersonator: { userId: 'staff-support-admin' },
      },
      metadata: { subjectUserId: 'staff-effective' },
    })

    render(<FumaAuditHistory scope={SITE_SCOPE} records={[event]} />)

    const row = screen.getByRole('row', {
      name: 'access.impersonation.started, Success',
    })
    expect(within(row).getByText('Effective actor')).toBeTruthy()
    expect(within(row).getAllByText('staff-effective').length).toBeGreaterThan(0)
    expect(within(row).getByText('Session')).toBeTruthy()
    expect(within(row).getByText('session-impersonated')).toBeTruthy()
    expect(within(row).getByText('Impersonated by')).toBeTruthy()
    expect(within(row).getByText('staff-support-admin')).toBeTruthy()
  })

  it('preserves request-to-job provenance and durable execution identifiers', () => {
    const event = makeEvent({
      id: 'audit-job',
      action: 'job.succeeded',
      actor: {
        kind: 'internal-job',
        jobId: 'job-transfer-1',
        runId: 'job-transfer-1:run:4',
      },
      correlation: {
        kind: 'job',
        requestId: 'job-transfer-1:request:4',
        originatingRequestId: 'request-enqueue-transfer',
        jobId: 'job-transfer-1',
        runId: 'job-transfer-1:run:4',
      },
      metadata: { jobKind: 'site-transfer', attempt: 4 },
    })

    render(<FumaAuditHistory scope={SITE_SCOPE} records={[event]} />)

    const correlation = screen.getByLabelText(
      'Job correlation from request request-enqueue-transfer to execution request job-transfer-1:request:4',
    )
    expect(within(correlation).getByText('Originating request')).toBeTruthy()
    expect(within(correlation).getByText('request-enqueue-transfer')).toBeTruthy()
    expect(within(correlation).getByText('Execution request')).toBeTruthy()
    expect(within(correlation).getByText('job-transfer-1:request:4')).toBeTruthy()
    expect(within(correlation).getByText('Job')).toBeTruthy()
    expect(within(correlation).getByText('Run')).toBeTruthy()
    expect(screen.getAllByText('job-transfer-1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('job-transfer-1:run:4').length).toBeGreaterThan(0)
  })

  it('renders the closed success, failure, and denied outcomes', () => {
    render(
      <FumaAuditHistory
        scope={SITE_SCOPE}
        records={[
          makeEvent({ id: 'audit-success', outcome: 'success' }),
          makeEvent({
            id: 'audit-failure',
            action: 'job.failed',
            outcome: 'failure',
          }),
          makeEvent({
            id: 'audit-denied',
            action: 'access.denied',
            outcome: 'denied',
          }),
        ]}
      />,
    )

    expect(screen.getByLabelText('Outcome: Success')).toBeTruthy()
    expect(screen.getByLabelText('Outcome: Failure')).toBeTruthy()
    expect(screen.getByLabelText('Outcome: Denied')).toBeTruthy()
  })

  it('renders useful metadata but never exposes the known redaction placeholder', () => {
    const event = makeEvent({
      metadata: {
        changedFields: ['title', 'slug'],
        apiToken: '[REDACTED]',
        nested: {
          password: '[REDACTED]',
          safeNote: 'retained forensic detail',
        },
      },
    })

    render(<FumaAuditHistory scope={SITE_SCOPE} records={[event]} />)

    expect(screen.getByText('retained forensic detail')).toBeTruthy()
    expect(screen.getByText('title')).toBeTruthy()
    expect(screen.getByText('slug')).toBeTruthy()
    expect(screen.getAllByText('Redacted')).toHaveLength(2)
    expect(screen.queryByText('[REDACTED]')).toBeNull()
  })

  it('provides accessible loading, empty, and error states', () => {
    const view = render(
      <FumaAuditHistory scope={SITE_SCOPE} records={[]} loading />,
    )

    const loadingTable = screen.getByRole('table', {
      name: 'Loading site audit history',
    })
    expect(loadingTable.getAttribute('aria-busy')).toBe('true')

    view.rerender(<FumaAuditHistory scope={SITE_SCOPE} records={[]} />)
    const empty = screen.getByRole('status', { name: 'Empty audit history' })
    expect(within(empty).getByText('No audit events')).toBeTruthy()
    expect(within(empty).getByText('No events were recorded for this exact scope.')).toBeTruthy()

    view.rerender(
      <FumaAuditHistory
        scope={SITE_SCOPE}
        records={[]}
        error="The scoped listing could not be loaded."
      />,
    )
    const error = screen.getByRole('alert')
    expect(within(error).getByText('Audit history unavailable')).toBeTruthy()
    expect(within(error).getByText('The scoped listing could not be loaded.')).toBeTruthy()
  })
})

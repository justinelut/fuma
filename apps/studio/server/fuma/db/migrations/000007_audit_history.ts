import type { HostedMigration } from '../migrationPolicy'

export const auditHistoryMigration: HostedMigration = {
  id: '000007_audit_history',
  description: 'Create tenant-qualified append-only audit history',
  sql: `
    create table fuma_audit_history (
      platform_id text not null,
      organization_id text null,
      workspace_id text null,
      site_id text null,
      id text not null,
      scope_kind text not null check (scope_kind in ('platform', 'organization', 'workspace', 'site')),
      actor_kind text not null check (actor_kind in ('staff', 'internal-job')),
      actor_user_id text null,
      actor_session_id text null,
      impersonator_user_id text null,
      request_id text null,
      originating_request_id text null,
      job_id text null,
      run_id text null,
      action text not null check (btrim(action) <> ''),
      outcome text not null check (outcome in ('success', 'failure', 'denied')),
      metadata_json jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default current_timestamp,
      primary key (platform_id, id),
      constraint fuma_audit_history_nonempty_ids check (
        btrim(platform_id) <> ''
        and btrim(id) <> ''
        and (organization_id is null or btrim(organization_id) <> '')
        and (workspace_id is null or btrim(workspace_id) <> '')
        and (site_id is null or btrim(site_id) <> '')
        and (actor_user_id is null or btrim(actor_user_id) <> '')
        and (actor_session_id is null or btrim(actor_session_id) <> '')
        and (impersonator_user_id is null or btrim(impersonator_user_id) <> '')
        and (request_id is null or btrim(request_id) <> '')
        and (originating_request_id is null or btrim(originating_request_id) <> '')
        and (job_id is null or btrim(job_id) <> '')
        and (run_id is null or btrim(run_id) <> '')
      ),
      constraint fuma_audit_history_scope_ancestry check (
        (scope_kind = 'platform'
          and organization_id is null and workspace_id is null and site_id is null)
        or (scope_kind = 'organization'
          and organization_id is not null and workspace_id is null and site_id is null)
        or (scope_kind = 'workspace'
          and organization_id is not null and workspace_id is not null and site_id is null)
        or (scope_kind = 'site'
          and organization_id is not null and workspace_id is not null and site_id is not null)
      ),
      constraint fuma_audit_history_job_tenant_shape check (
        job_id is null or organization_id is not null
      ),
      constraint fuma_audit_history_actor_shape check (
        (actor_kind = 'staff'
          and actor_user_id is not null
          and actor_session_id is not null
          and request_id is not null
          and originating_request_id is null
          and job_id is null
          and run_id is null)
        or (actor_kind = 'internal-job'
          and actor_user_id is null
          and actor_session_id is null
          and impersonator_user_id is null
          and request_id is not null
          and job_id is not null
          and run_id is not null)
      ),
      constraint fuma_audit_history_impersonator_shape check (
        impersonator_user_id is null
        or (actor_kind = 'staff' and impersonator_user_id <> actor_user_id)
      ),
      constraint fuma_audit_history_correlation check (
        request_id is not null or job_id is not null
      ),
      constraint fuma_audit_history_originating_request_shape check (
        originating_request_id is null or job_id is not null
      ),
      constraint fuma_audit_history_metadata_object check (
        jsonb_typeof(metadata_json) = 'object'
      )
    );

    comment on column fuma_audit_history.metadata_json is
      'Redacted audit metadata only; secrets, credentials, and raw request bodies are forbidden.';

    create index fuma_audit_history_platform_recency_idx
      on fuma_audit_history (platform_id, created_at desc, id)
      where scope_kind = 'platform';

    create index fuma_audit_history_organization_recency_idx
      on fuma_audit_history (platform_id, organization_id, created_at desc, id)
      where scope_kind = 'organization';

    create index fuma_audit_history_workspace_recency_idx
      on fuma_audit_history (platform_id, organization_id, workspace_id, created_at desc, id)
      where scope_kind = 'workspace';

    create index fuma_audit_history_site_recency_idx
      on fuma_audit_history (
        platform_id,
        organization_id,
        workspace_id,
        site_id,
        created_at desc,
        id
      )
      where scope_kind = 'site';

    create index fuma_audit_history_request_correlation_idx
      on fuma_audit_history (platform_id, request_id, created_at desc, id)
      where request_id is not null;

    create index fuma_audit_history_originating_request_correlation_idx
      on fuma_audit_history (platform_id, originating_request_id, created_at desc, id)
      where originating_request_id is not null;

    create index fuma_audit_history_job_correlation_idx
      on fuma_audit_history (platform_id, organization_id, job_id, created_at desc, id)
      where job_id is not null;

    create function fuma_audit_history_reject_mutation()
    returns trigger
    language plpgsql
    as $audit_trigger$
    begin
      raise exception 'fuma_audit_history is append-only: % is forbidden', tg_op
        using errcode = '55000';
      return null;
    end;
    $audit_trigger$;

    create trigger fuma_audit_history_reject_update
      before update on fuma_audit_history
      for each statement
      execute function fuma_audit_history_reject_mutation();

    create trigger fuma_audit_history_reject_delete
      before delete on fuma_audit_history
      for each statement
      execute function fuma_audit_history_reject_mutation();
  `,
}

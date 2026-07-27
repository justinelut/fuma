import type { HostedMigration } from '../migrationPolicy'

const scopeColumns = `
      platform_id text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      owner_key text not null,
      owner_generation bigint not null check (owner_generation > 0),
      profile_id text not null`
const scopeKeys = 'platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id'

export const publicationEditorialWorkflowMigration: HostedMigration = Object.freeze({
  id: '000046_editorial_workflow',
  description: 'Add exact-scope Publication editorial roles, assignments, review decisions, history, and notifications',
  sql: `
    create table fuma_publication_editorial_roles (${scopeColumns},
      user_id text not null,
      role text not null check (role in ('author','editor','managing-editor')),
      active boolean not null,
      version bigint not null check (version > 0),
      assigned_by text not null,
      note text not null,
      updated_at timestamptz not null,
      primary key (${scopeKeys}, user_id),
      foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)
        references fuma_tenant_owner_keys(platform_id, owner_key, organization_id, workspace_id, site_id)
        on update cascade on delete restrict
    );
    create index fuma_publication_editorial_roles_inbox_idx
      on fuma_publication_editorial_roles (${scopeKeys}, role, active, user_id);

    create table fuma_publication_content_assignments (${scopeColumns},
      content_id text not null,
      assignee_id text not null,
      assigned_by text not null,
      version bigint not null check (version > 0),
      note text not null,
      updated_at timestamptz not null,
      primary key (${scopeKeys}, content_id),
      foreign key (${scopeKeys}, assignee_id)
        references fuma_publication_editorial_roles(${scopeKeys}, user_id)
        on update cascade on delete restrict
    );
    create index fuma_publication_content_assignments_inbox_idx
      on fuma_publication_content_assignments (${scopeKeys}, assignee_id, updated_at desc, content_id);

    create table fuma_publication_review_requests (${scopeColumns},
      review_id text not null,
      content_id text not null,
      content_version bigint not null check (content_version > 0),
      requested_by text not null,
      reviewer_id text not null,
      status text not null check (status in ('pending','changes-requested','rejected','approved')),
      request_note text not null,
      decision_note text,
      decided_by text,
      requested_at timestamptz not null,
      decided_at timestamptz,
      primary key (${scopeKeys}, review_id),
      check ((status='pending' and decision_note is null and decided_by is null and decided_at is null)
        or (status<>'pending' and decision_note is not null and decided_by is not null and decided_at is not null)),
      check (requested_by <> reviewer_id)
    );
    create unique index fuma_publication_review_requests_one_pending_idx
      on fuma_publication_review_requests (${scopeKeys}, content_id) where status='pending';
    create index fuma_publication_review_requests_inbox_idx
      on fuma_publication_review_requests (${scopeKeys}, reviewer_id, status, requested_at desc, review_id);
    create index fuma_publication_review_requests_readiness_idx
      on fuma_publication_review_requests (${scopeKeys}, content_id, content_version, status, decided_at desc);

    create table fuma_publication_workflow_history (${scopeColumns},
      event_id text not null,
      event_kind text not null check (event_kind in ('role-assigned','role-revoked','content-assigned','review-requested','changes-requested','rejected','approved')),
      actor_id text not null,
      content_id text,
      review_id text,
      subject_user_id text,
      content_version bigint check (content_version is null or content_version > 0),
      note text not null,
      created_at timestamptz not null,
      primary key (${scopeKeys}, event_id),
      check (content_id is not null or subject_user_id is not null)
    );
    create index fuma_publication_workflow_history_content_idx
      on fuma_publication_workflow_history (${scopeKeys}, content_id, created_at, event_id);

    create table fuma_publication_workflow_notifications (${scopeColumns},
      notification_id text not null,
      recipient_id text not null,
      kind text not null check (kind in ('assignment','review-requested','changes-requested','rejected','approved')),
      content_id text not null,
      review_id text,
      message text not null,
      created_at timestamptz not null,
      read_at timestamptz,
      primary key (${scopeKeys}, notification_id)
    );
    create index fuma_publication_workflow_notifications_inbox_idx
      on fuma_publication_workflow_notifications (${scopeKeys}, recipient_id, read_at, created_at desc, notification_id);

    create function fuma_publication_workflow_history_reject_mutation() returns trigger
    language plpgsql as $$
    begin
      raise exception 'publication workflow history is immutable';
    end;
    $$;
    create trigger fuma_publication_workflow_history_immutable
      before update or delete on fuma_publication_workflow_history
      for each row execute function fuma_publication_workflow_history_reject_mutation();
  `,
})

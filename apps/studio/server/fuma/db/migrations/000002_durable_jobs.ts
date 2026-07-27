import type { HostedMigration } from '../migrationPolicy'

export const durableJobsMigration: HostedMigration = {
  id: '000002_durable_jobs',
  description: 'Create durable jobs, attempts, effects, and schedules',
  sql: `
    create table if not exists fuma_jobs (
      id text primary key,
      organization_id text not null,
      site_id text,
      kind text not null,
      payload_json jsonb not null,
      status text not null check (status in ('queued', 'running', 'retry_wait', 'succeeded', 'cancelled', 'dead_letter')),
      priority integer not null default 0,
      organization_weight integer not null default 1 check (organization_weight > 0),
      site_weight integer not null default 1 check (site_weight > 0),
      max_attempts integer not null check (max_attempts > 0),
      attempt_count integer not null default 0 check (attempt_count >= 0),
      run_at timestamptz not null,
      claimed_by text,
      claim_expires_at timestamptz,
      fence bigint not null default 0 check (fence >= 0),
      cancellation_requested_at timestamptz,
      idempotency_key text,
      result_json jsonb,
      error_json jsonb,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      completed_at timestamptz
    );

    create unique index if not exists fuma_jobs_idempotency_idx
      on fuma_jobs (organization_id, coalesce(site_id, ''), kind, idempotency_key)
      where idempotency_key is not null;
    create index if not exists fuma_jobs_ready_idx
      on fuma_jobs (status, run_at, priority desc, created_at, id);
    create index if not exists fuma_jobs_organization_active_idx
      on fuma_jobs (organization_id, status);
    create index if not exists fuma_jobs_site_active_idx
      on fuma_jobs (site_id, status) where site_id is not null;
    create index if not exists fuma_jobs_expired_claim_idx
      on fuma_jobs (claim_expires_at) where status = 'running';

    create table if not exists fuma_job_attempts (
      id text primary key,
      job_id text not null references fuma_jobs(id),
      attempt_number integer not null check (attempt_number > 0),
      fence bigint not null check (fence > 0),
      worker_id text not null,
      status text not null check (status in ('running', 'succeeded', 'failed', 'abandoned', 'cancelled')),
      started_at timestamptz not null default current_timestamp,
      finished_at timestamptz,
      error_json jsonb,
      unique (job_id, attempt_number),
      unique (job_id, fence)
    );
    create index if not exists fuma_job_attempts_job_idx
      on fuma_job_attempts (job_id, attempt_number);

    create table if not exists fuma_job_effects (
      job_id text not null references fuma_jobs(id),
      effect_key text not null,
      fence bigint not null check (fence > 0),
      result_json jsonb not null,
      created_at timestamptz not null default current_timestamp,
      primary key (job_id, effect_key)
    );

    create table if not exists fuma_job_schedules (
      id text primary key,
      organization_id text not null,
      site_id text,
      kind text not null,
      payload_json jsonb not null,
      interval_ms bigint not null check (interval_ms > 0),
      next_run_at timestamptz not null,
      max_attempts integer not null check (max_attempts > 0),
      priority integer not null default 0,
      organization_weight integer not null default 1 check (organization_weight > 0),
      site_weight integer not null default 1 check (site_weight > 0),
      enabled boolean not null default true,
      enqueue_fence bigint not null default 0 check (enqueue_fence >= 0),
      last_enqueued_at timestamptz,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp
    );
    create index if not exists fuma_job_schedules_due_idx
      on fuma_job_schedules (next_run_at, id) where enabled = true;
  `,
}

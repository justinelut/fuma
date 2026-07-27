-- FUMA-067..070. Forward-only; package bytes remain immutable object-storage artifacts.
create table fuma_plugin_artifacts (
  artifact_id text primary key,
  plugin_id text not null,
  version text not null,
  object_key text not null unique,
  package_hash_sha256 text not null check (package_hash_sha256 ~ '^[a-f0-9]{64}$'),
  permissions_json jsonb not null check (jsonb_typeof(permissions_json) = 'array'),
  provenance_json jsonb not null check (jsonb_typeof(provenance_json) = 'object'),
  created_at timestamptz not null default now(),
  unique(plugin_id, version, package_hash_sha256)
);

create table fuma_plugin_installations (
  platform_id text not null,
  organization_id text not null,
  workspace_id text not null,
  site_id text not null,
  owner_key text not null,
  installation_id text not null,
  artifact_id text not null references fuma_plugin_artifacts(artifact_id) on delete restrict,
  settings_object_key text not null,
  secret_object_key text null,
  state text not null check (state in ('active','suspended','crashed','transferring')),
  quota_units bigint not null check (quota_units > 0),
  owner_generation bigint not null check (owner_generation > 0),
  version bigint not null default 1 check (version > 0),
  primary key(platform_id, owner_key, installation_id),
  foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)
    references fuma_tenant_owner_keys(platform_id, owner_key, organization_id, workspace_id, site_id)
    on update cascade on delete restrict
);

create table fuma_plugin_reviews (
  submission_id text primary key,
  artifact_id text not null references fuma_plugin_artifacts(artifact_id) on delete restrict,
  package_hash_sha256 text not null check (package_hash_sha256 ~ '^[a-f0-9]{64}$'),
  submitter_id text not null,
  reviewer_id text null,
  scan_state text not null check (scan_state in ('pending','clean','rejected')),
  decision text not null check (decision in ('pending','approved','rejected','revoked')),
  permission_diff_json jsonb not null check (jsonb_typeof(permission_diff_json) = 'array'),
  signature text null,
  decided_at timestamptz null,
  revoked_at timestamptz null,
  check (reviewer_id is null or reviewer_id <> submitter_id),
  check ((decision = 'approved' and scan_state = 'clean' and signature is not null) or decision <> 'approved')
);

create table fuma_plugin_scan_findings (
  submission_id text not null references fuma_plugin_reviews(submission_id) on delete restrict,
  scanner_id text not null,
  scanner_version text not null,
  finding_hash_sha256 text not null check (finding_hash_sha256 ~ '^[a-f0-9]{64}$'),
  severity text not null check (severity in ('info','low','medium','high','critical')),
  state text not null check (state in ('open','accepted','fixed')),
  primary key(submission_id, scanner_id, finding_hash_sha256)
);

create table fuma_ai_payment_proposals (
  platform_id text not null,
  owner_key text not null,
  site_id text not null,
  proposal_id text not null,
  reviewed_artifact_id text not null references fuma_plugin_artifacts(artifact_id) on delete restrict,
  proposal_json jsonb not null check (jsonb_typeof(proposal_json) = 'object'),
  nonce_hash_sha256 text not null check (nonce_hash_sha256 ~ '^[a-f0-9]{64}$'),
  confirmed_by text null,
  confirmed_at timestamptz null,
  secure_entry_consumed_at timestamptz null,
  primary key(platform_id, owner_key, proposal_id),
  check ((confirmed_by is null and confirmed_at is null) or (confirmed_by is not null and confirmed_at is not null))
);

create index fuma_plugin_installations_site_idx on fuma_plugin_installations(platform_id, organization_id, workspace_id, site_id, owner_key, state);
create index fuma_plugin_reviews_marketplace_idx on fuma_plugin_reviews(decision, revoked_at, decided_at) where decision = 'approved' and revoked_at is null;

create table fuma_plugin_schedules (
  platform_id text not null,
  owner_key text not null,
  installation_id text not null,
  schedule_id text not null,
  cron_expression text not null,
  handler_name text not null,
  enabled boolean not null default false,
  owner_generation bigint not null check (owner_generation > 0),
  next_run_at timestamptz null,
  primary key (platform_id, owner_key, installation_id, schedule_id),
  foreign key (platform_id, owner_key, installation_id) references fuma_plugin_installations(platform_id, owner_key, installation_id) on update cascade on delete restrict
);

create table fuma_plugin_crash_events (
  platform_id text not null,
  owner_key text not null,
  installation_id text not null,
  crash_id text not null,
  worker_generation bigint not null check (worker_generation > 0),
  error_code text not null,
  evidence_hash_sha256 text not null check (evidence_hash_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key (platform_id, owner_key, installation_id, crash_id),
  foreign key (platform_id, owner_key, installation_id) references fuma_plugin_installations(platform_id, owner_key, installation_id) on update cascade on delete restrict
);

create table fuma_plugin_storage_usage (
  platform_id text not null,
  owner_key text not null,
  installation_id text not null,
  object_count bigint not null check (object_count >= 0),
  bytes_used bigint not null check (bytes_used >= 0),
  version bigint not null check (version > 0),
  primary key (platform_id, owner_key, installation_id),
  foreign key (platform_id, owner_key, installation_id) references fuma_plugin_installations(platform_id, owner_key, installation_id) on update cascade on delete restrict
);

create index fuma_plugin_schedules_due_idx on fuma_plugin_schedules(enabled, next_run_at) where enabled;

-- FUMA-075..077. Import provenance and rollback receipts are append-only.
create table fuma_structured_imports (
  import_id text primary key,
  platform_id text not null,
  organization_id text not null,
  workspace_id text not null,
  site_id text not null,
  source_kind text not null check (source_kind in ('ghost-5','the-lawyer')),
  source_hash_sha256 text not null check (source_hash_sha256 ~ '^[a-f0-9]{64}$'),
  manifest_json jsonb not null check (jsonb_typeof(manifest_json) = 'object'),
  manifest_hash_sha256 text not null check (manifest_hash_sha256 ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('dry-run','running','applied','rolled-back','failed')),
  resumable_cursor text null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,
  unique(platform_id, site_id, source_hash_sha256, manifest_hash_sha256)
);

create table fuma_import_objects (
  import_id text not null references fuma_structured_imports(import_id) on delete restrict,
  object_kind text not null,
  source_id text not null,
  destination_id text null,
  content_hash_sha256 text not null check (content_hash_sha256 ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('planned','applied','quarantined','rolled-back')),
  error_code text null,
  primary key(import_id, object_kind, source_id)
);

create table fuma_lawyer_reconciliations (
  import_id text primary key references fuma_structured_imports(import_id) on delete restrict,
  inventory_hash_sha256 text not null check (inventory_hash_sha256 ~ '^[a-f0-9]{64}$'),
  route_count bigint not null check (route_count > 0),
  member_count bigint not null check (member_count >= 0),
  report_json jsonb not null check (jsonb_typeof(report_json) = 'object'),
  payment_exceptions bigint not null check (payment_exceptions >= 0),
  email_migration text not null check (email_migration = 'oci-email-delivery'),
  staff_reauth_required boolean not null check (staff_reauth_required),
  member_reauth_required boolean not null check (member_reauth_required),
  created_at timestamptz not null default now()
);

create table fuma_design_conversion_manifests (
  import_id text primary key references fuma_structured_imports(import_id) on delete restrict,
  inventory_hash_sha256 text not null check (inventory_hash_sha256 ~ '^[a-f0-9]{64}$'),
  route_bindings_json jsonb not null check (jsonb_typeof(route_bindings_json) = 'array'),
  template_ids_json jsonb not null check (jsonb_typeof(template_ids_json) = 'array'),
  token_hash_sha256 text not null check (token_hash_sha256 ~ '^[a-f0-9]{64}$'),
  asset_hash_sha256 text not null check (asset_hash_sha256 ~ '^[a-f0-9]{64}$'),
  flattened_copies integer not null check (flattened_copies = 0),
  created_at timestamptz not null default now()
);

create index fuma_structured_imports_site_idx on fuma_structured_imports(platform_id, organization_id, workspace_id, site_id, created_at);

create table fuma_import_rollback_receipts (
  import_id text primary key references fuma_structured_imports(import_id) on delete restrict,
  manifest_hash_sha256 text not null check (manifest_hash_sha256 ~ '^[a-f0-9]{64}$'),
  inserted_ids_hash_sha256 text not null check (inserted_ids_hash_sha256 ~ '^[a-f0-9]{64}$'),
  media_keys_hash_sha256 text not null check (media_keys_hash_sha256 ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('applied','rolled-back')),
  rolled_back_at timestamptz null,
  check ((state = 'applied' and rolled_back_at is null) or (state = 'rolled-back' and rolled_back_at is not null))
);

create table fuma_import_reauthentication (
  import_id text not null references fuma_structured_imports(import_id) on delete restrict,
  subject_kind text not null check (subject_kind in ('staff','member')),
  source_subject_id text not null,
  destination_subject_id text null,
  required boolean not null check (required),
  completed_at timestamptz null,
  primary key (import_id, subject_kind, source_subject_id)
);

create index fuma_import_reauthentication_pending_idx on fuma_import_reauthentication(import_id, subject_kind) where completed_at is null;

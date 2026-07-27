-- FUMA-078..085 and TRACKER-086. Evidence is append-only; deployment remains externally approved.
create table fuma_paired_release_manifests (
  source_sha text primary key check (source_sha ~ '^[a-f0-9]{40}([a-f0-9]{24})?$'),
  lock_hash_sha256 text not null check (lock_hash_sha256 ~ '^[a-f0-9]{64}$'),
  migration_high_water_mark text not null,
  runtime_image_digest text not null,
  public_web_image_digest text not null,
  manifest_json jsonb not null check (jsonb_typeof(manifest_json) = 'object'),
  manifest_hash_sha256 text not null check (manifest_hash_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique(runtime_image_digest),
  unique(public_web_image_digest)
);

create table fuma_operational_evidence (
  evidence_id text primary key,
  source_sha text not null references fuma_paired_release_manifests(source_sha) on delete restrict,
  kind text not null check (kind in ('migration','backup','restore','smoke','observability','security','capacity','pilot','canary','rollback','public-web-seam')),
  object_key text not null,
  object_hash_sha256 text not null check (object_hash_sha256 ~ '^[a-f0-9]{64}$'),
  signed_by text not null,
  signed_at timestamptz not null,
  expires_at timestamptz null
);

create table fuma_privacy_subject_index (
  platform_id text not null,
  subject_id text not null,
  record_table text not null,
  record_id text not null,
  classification text not null check (classification in ('customer-data','legal-hold','financial-record')),
  retain_until timestamptz null,
  created_at timestamptz not null default now(),
  primary key(platform_id, subject_id, record_table, record_id)
);

create table fuma_privacy_request_receipts (
  request_id text primary key,
  platform_id text not null,
  subject_id text not null,
  kind text not null check (kind in ('export','delete')),
  manifest_object_key text not null,
  manifest_hash_sha256 text not null check (manifest_hash_sha256 ~ '^[a-f0-9]{64}$'),
  exception_count bigint not null check (exception_count >= 0),
  state text not null check (state in ('queued','running','completed','failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);

create table fuma_launch_decisions (
  decision_id text primary key,
  source_sha text not null references fuma_paired_release_manifests(source_sha) on delete restrict,
  decision text not null check (decision in ('declare','abort','rollback')),
  gate_json jsonb not null check (jsonb_typeof(gate_json) = 'object'),
  evidence_hash_sha256 text not null check (evidence_hash_sha256 ~ '^[a-f0-9]{64}$'),
  signed_by_json jsonb not null check (jsonb_typeof(signed_by_json) = 'array'),
  decided_at timestamptz not null
);

create index fuma_operational_evidence_release_idx on fuma_operational_evidence(source_sha, kind, signed_at);
create index fuma_privacy_subject_lookup_idx on fuma_privacy_subject_index(platform_id, subject_id, classification);

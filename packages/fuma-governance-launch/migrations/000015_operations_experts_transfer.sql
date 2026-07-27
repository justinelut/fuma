-- FUMA-071..074. Internal actions append evidence and retain domain-service mutation authority.
create table fuma_console_contributions (
  contribution_id text primary key,
  owner_ticket text not null check (owner_ticket in ('FUMA-068','FUMA-072','FUMA-073','FUMA-074')),
  routes_json jsonb not null check (jsonb_typeof(routes_json) = 'array'),
  authorities_json jsonb not null check (jsonb_typeof(authorities_json) = 'array'),
  enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table fuma_support_sessions (
  session_id text primary key,
  staff_actor_id text not null,
  target_user_id text not null,
  reason text not null check (length(reason) between 10 and 500),
  step_up_at timestamptz not null,
  started_at timestamptz not null,
  expires_at timestamptz not null,
  ended_at timestamptz null,
  evidence_hash_sha256 text not null check (evidence_hash_sha256 ~ '^[a-f0-9]{64}$'),
  check (expires_at > started_at and expires_at <= started_at + interval '30 minutes')
);

create table fuma_moderation_evidence (
  evidence_id text primary key,
  subject_kind text not null check (subject_kind in ('user','organization','site','expert','plugin')),
  subject_id text not null,
  state text not null check (state in ('open','suspended','appealed','resolved')),
  reason_code text not null,
  immutable_object_key text not null,
  object_hash_sha256 text not null check (object_hash_sha256 ~ '^[a-f0-9]{64}$'),
  actor_id text not null,
  created_at timestamptz not null default now()
);

create table fuma_break_glass_requests (
  request_id text primary key,
  target_owner_id text not null,
  reason text not null check (length(reason) between 20 and 1000),
  first_approver_id text not null,
  second_approver_id text not null,
  evidence_hash_sha256 text not null check (evidence_hash_sha256 ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  executed_at timestamptz null,
  check (first_approver_id <> second_approver_id)
);

create table fuma_expert_public_releases (
  release_id text primary key,
  expert_id text not null,
  artifact_object_key text not null,
  artifact_hash_sha256 text not null check (artifact_hash_sha256 ~ '^[a-f0-9]{64}$'),
  submitted_by text not null,
  approved_by text not null,
  approved_at timestamptz not null,
  withdrawn_at timestamptz null,
  check (submitted_by <> approved_by)
);

create table fuma_expert_attribution_consents (
  release_id text not null references fuma_expert_public_releases(release_id) on delete restrict,
  party_kind text not null check (party_kind in ('expert','site-owner')),
  actor_id text not null,
  consent_version bigint not null check (consent_version > 0),
  consented_at timestamptz not null,
  revoked_at timestamptz null,
  primary key (release_id, party_kind)
);

create table fuma_expert_profiles (
  expert_id text primary key,
  organization_id text not null,
  kind text not null check (kind in ('designer','developer','studio','agency')),
  display_name text not null,
  profile_json jsonb not null check (jsonb_typeof(profile_json) = 'object'),
  approved_release_id text not null references fuma_expert_public_releases(release_id) on delete restrict,
  opted_in boolean not null default false,
  suspended boolean not null default false,
  consent_version bigint not null check (consent_version > 0),
  public_revision bigint not null check (public_revision > 0),
  search_document tsvector generated always as (to_tsvector('simple', coalesce(display_name, ''))) stored,
  updated_at timestamptz not null
);

create table fuma_expert_inquiries (
  inquiry_id text primary key,
  expert_id text not null references fuma_expert_profiles(expert_id) on delete restrict,
  sender_fingerprint_sha256 text not null check (sender_fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
  encrypted_object_key text not null,
  consent_version bigint not null check (consent_version > 0),
  state text not null check (state in ('queued','forwarded','blocked','expired')),
  created_at timestamptz not null default now()
);

create table fuma_transfer_handoffs (
  platform_id text not null,
  owner_key text not null,
  site_id text not null,
  transfer_id text not null,
  contract_id text not null,
  offer_version bigint not null check (offer_version > 0),
  payment_state text not null check (payment_state = 'paid-transfer-pending'),
  destination_organization_id text not null,
  selected_assets_json jsonb not null check (jsonb_typeof(selected_assets_json) = 'array'),
  locale text not null check (locale = 'en-KE'),
  currency text not null check (currency = 'KES'),
  timezone text not null check (timezone = 'Africa/Nairobi'),
  saga_id text null,
  version bigint not null default 1 check (version > 0),
  primary key(platform_id, owner_key, transfer_id)
);

create index fuma_expert_profiles_public_search_idx on fuma_expert_profiles using gin(search_document) where opted_in and not suspended;
create index fuma_moderation_subject_idx on fuma_moderation_evidence(subject_kind, subject_id, created_at);

create table fuma_expert_plugin_links (
  expert_id text not null references fuma_expert_profiles(expert_id) on delete restrict,
  plugin_id text not null,
  publisher_organization_id text not null,
  verification_hash_sha256 text not null check (verification_hash_sha256 ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz not null,
  revoked_at timestamptz null,
  primary key (expert_id, plugin_id)
);

create index fuma_expert_plugin_links_public_idx on fuma_expert_plugin_links(expert_id, plugin_id) where revoked_at is null;

-- FUMA-063..066. Forward-only; registration is intentionally delegated to the migration integrator.
create table fuma_ai_providers (
  provider_id text primary key,
  display_name text not null,
  enabled boolean not null default false,
  platform_credential_object_key text null,
  refreshed_at timestamptz not null,
  refresh_sequence bigint not null check (refresh_sequence > 0),
  created_at timestamptz not null default now(),
  check (btrim(provider_id) <> '' and btrim(display_name) <> '')
);

create table fuma_ai_models (
  model_id text primary key,
  provider_id text not null references fuma_ai_providers(provider_id) on delete restrict,
  display_name text not null,
  capabilities_json jsonb not null check (jsonb_typeof(capabilities_json) = 'array'),
  context_tokens bigint not null check (context_tokens > 0),
  input_micros_per_million bigint not null check (input_micros_per_million >= 0),
  output_micros_per_million bigint not null check (output_micros_per_million >= 0),
  markup_basis_points integer not null check (markup_basis_points between 0 and 100000),
  included boolean not null default false,
  default_profiles_json jsonb not null default '[]'::jsonb check (jsonb_typeof(default_profiles_json) = 'array'),
  enabled boolean not null default false,
  refreshed_at timestamptz not null
);

create table fuma_ai_catalog_refreshes (
  refresh_id text primary key,
  provider_id text not null references fuma_ai_providers(provider_id) on delete restrict,
  catalog_hash_sha256 text not null check (catalog_hash_sha256 ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('started','applied','failed')),
  error_code text null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);

create table fuma_ai_credit_accounts (
  platform_id text not null,
  organization_id text not null,
  workspace_id text not null,
  site_id text not null,
  owner_key text not null,
  account_id text not null,
  balance_micros bigint not null check (balance_micros >= 0),
  reserved_micros bigint not null default 0 check (reserved_micros >= 0 and reserved_micros <= balance_micros),
  budget_micros bigint not null check (budget_micros >= 0),
  version bigint not null default 1 check (version > 0),
  primary key (platform_id, owner_key, account_id),
  foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)
    references fuma_tenant_owner_keys(platform_id, owner_key, organization_id, workspace_id, site_id)
    on update cascade on delete restrict
);

create table fuma_ai_credit_entries (
  platform_id text not null,
  owner_key text not null,
  account_id text not null,
  entry_id text not null,
  kind text not null check (kind in ('grant','purchase','reserve','settle','refund','expire')),
  amount_micros bigint not null,
  idempotency_key text not null,
  expires_at timestamptz null,
  created_at timestamptz not null default now(),
  primary key (platform_id, owner_key, entry_id),
  unique (platform_id, owner_key, account_id, idempotency_key),
  foreign key (platform_id, owner_key, account_id) references fuma_ai_credit_accounts(platform_id, owner_key, account_id) on update cascade on delete restrict
);

create table fuma_ai_byok_credentials (
  platform_id text not null,
  organization_id text not null,
  workspace_id text not null,
  site_id text not null,
  owner_key text not null,
  credential_id text not null,
  provider_id text not null references fuma_ai_providers(provider_id) on delete restrict,
  ciphertext_object_key text not null,
  key_id text not null,
  fingerprint_sha256 text not null check (fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
  owner_generation bigint not null check (owner_generation > 0),
  state text not null check (state in ('active','detached','rekey-required')),
  primary key (platform_id, owner_key, credential_id),
  foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)
    references fuma_tenant_owner_keys(platform_id, owner_key, organization_id, workspace_id, site_id)
    on update cascade on delete restrict
);

create table fuma_ai_site_conversations (
  platform_id text not null,
  organization_id text not null,
  workspace_id text not null,
  site_id text not null,
  owner_key text not null,
  conversation_id text not null,
  actor_id text not null,
  profile_id text not null check (profile_id in ('website','publication')),
  snapshot_hash_sha256 text not null check (snapshot_hash_sha256 ~ '^[a-f0-9]{64}$'),
  owner_generation bigint not null check (owner_generation > 0),
  created_at timestamptz not null default now(),
  primary key (platform_id, owner_key, conversation_id),
  foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)
    references fuma_tenant_owner_keys(platform_id, owner_key, organization_id, workspace_id, site_id)
    on update cascade on delete restrict
);

create table fuma_mcp_connectors (
  platform_id text not null,
  organization_id text not null,
  workspace_id text not null,
  site_id text not null,
  owner_key text not null,
  connector_id text not null,
  token_hash_sha256 text not null check (token_hash_sha256 ~ '^[a-f0-9]{64}$'),
  capabilities_json jsonb not null check (jsonb_typeof(capabilities_json) = 'array'),
  requests_per_minute integer not null check (requests_per_minute between 1 and 10000),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  primary key (platform_id, owner_key, connector_id),
  foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)
    references fuma_tenant_owner_keys(platform_id, owner_key, organization_id, workspace_id, site_id)
    on update cascade on delete restrict
);

create index fuma_ai_credit_accounts_site_idx on fuma_ai_credit_accounts(platform_id, organization_id, workspace_id, site_id, owner_key);
create index fuma_mcp_connectors_site_idx on fuma_mcp_connectors(platform_id, organization_id, workspace_id, site_id, owner_key, revoked_at, expires_at);

create table fuma_ai_reservations (
  platform_id text not null,
  owner_key text not null,
  account_id text not null,
  reservation_id text not null,
  site_id text not null,
  model_id text not null references fuma_ai_models(model_id) on delete restrict,
  reserved_micros bigint not null check (reserved_micros > 0),
  settled_micros bigint null check (settled_micros is null or settled_micros between 0 and reserved_micros),
  state text not null check (state in ('reserved','settled','refunded')),
  expires_at timestamptz not null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  resolved_at timestamptz null,
  primary key (platform_id, owner_key, reservation_id),
  foreign key (platform_id, owner_key, account_id) references fuma_ai_credit_accounts(platform_id, owner_key, account_id) on update cascade on delete restrict,
  check ((state = 'reserved' and settled_micros is null and resolved_at is null) or (state <> 'reserved' and settled_micros is not null and resolved_at is not null))
);

create table fuma_mcp_usage_windows (
  platform_id text not null,
  owner_key text not null,
  connector_id text not null,
  site_id text not null,
  capability text not null check (capability in ('read','write','publish')),
  window_started_at timestamptz not null,
  requests_used integer not null check (requests_used > 0),
  request_units bigint not null check (request_units > 0),
  credit_micros bigint not null check (credit_micros >= 0),
  primary key (platform_id, owner_key, connector_id, capability, window_started_at),
  foreign key (platform_id, owner_key, connector_id) references fuma_mcp_connectors(platform_id, owner_key, connector_id) on update cascade on delete restrict
);

create index fuma_ai_reservations_expiry_idx on fuma_ai_reservations(state, expires_at) where state = 'reserved';
create index fuma_mcp_usage_site_idx on fuma_mcp_usage_windows(platform_id, site_id, window_started_at);

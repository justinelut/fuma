import { jsonField } from '../../../db/jsonExtract'
import type { HostedMigration } from '../migrationPolicy'

/** Conductor-finalized FUMA-066 authority for the one existing native MCP runtime. */
export const mcpConnectorAuthorityMigration: HostedMigration = Object.freeze({
  id: '000069_mcp_connector_authority',
  description: 'Add exact site-scoped MCP connector session metering audit and transfer authority',
  sql: String.raw`
alter table fuma_tenant_owner_keys
  add constraint fuma_tenant_owner_keys_generation_reference_unique
  unique (platform_id, owner_key, organization_id, workspace_id, site_id, generation);

create table fuma_mcp_connector_bindings_v2 (
  connector_id text primary key references ai_mcp_connectors(id) on delete restrict,
  platform_id text not null,
  organization_id text not null,
  workspace_id text not null,
  site_id text not null,
  owner_key text not null,
  owner_generation bigint not null check (owner_generation > 0),
  profile_id text not null check (profile_id in ('website','publication')),
  actor_id text not null,
  connector_capabilities_json jsonb not null check (jsonb_typeof(connector_capabilities_json)='array'),
  rate_policy_json jsonb not null check (jsonb_typeof(rate_policy_json)='object'),
  state text not null check (state in ('active','revoked','transferring')),
  version bigint not null default 1 check (version > 0),
  foreign key (platform_id,owner_key,organization_id,workspace_id,site_id,owner_generation)
    references fuma_tenant_owner_keys(platform_id,owner_key,organization_id,workspace_id,site_id,generation)
    on update cascade on delete restrict
);
create index fuma_mcp_connector_bindings_site_v2_idx
  on fuma_mcp_connector_bindings_v2
  (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,state);

create table fuma_mcp_sessions_v2 (
  session_id text primary key,
  connector_id text not null references fuma_mcp_connector_bindings_v2(connector_id) on delete restrict,
  actor_id text not null,
  scope_json jsonb not null check (jsonb_typeof(scope_json)='object'),
  connector_version bigint not null check (connector_version > 0),
  state text not null check (state in ('active','closed','revoked')),
  opened_at timestamptz not null,
  expires_at timestamptz not null,
  last_validated_at timestamptz not null,
  closed_at timestamptz null,
  check ((state='active' and closed_at is null) or (state<>'active' and closed_at is not null))
);
create index fuma_mcp_sessions_live_v2_idx
  on fuma_mcp_sessions_v2(connector_id,state,expires_at);

create table fuma_mcp_tool_receipts_v2 (
  operation_id text primary key,
  session_id text not null references fuma_mcp_sessions_v2(session_id) on delete restrict,
  connector_id text not null references fuma_mcp_connector_bindings_v2(connector_id) on delete restrict,
  tool_name text not null,
  capability text not null check (capability in ('read','mutate','publish')),
  input_hash_sha256 text not null check (input_hash_sha256 ~ '^[a-f0-9]{64}$'),
  reservation_id text not null unique,
  state text not null check (state in ('started','completed','failed','denied')),
  output_json jsonb null,
  created_at timestamptz not null,
  completed_at timestamptz null,
  check ((state='started' and completed_at is null and output_json is null)
    or (state<>'started' and completed_at is not null and output_json is not null))
);

create table fuma_mcp_usage_windows_v2 (
  connector_id text not null references fuma_mcp_connector_bindings_v2(connector_id) on delete restrict,
  site_id text not null,
  capability text not null check (capability in ('read','mutate','publish')),
  window_started_at timestamptz not null,
  requests_used integer not null check (requests_used > 0),
  input_tokens bigint not null check (input_tokens >= 0),
  output_tokens bigint not null check (output_tokens >= 0),
  primary key (connector_id,capability,window_started_at)
);

create table fuma_mcp_audit_facts_v2 (
  audit_id text primary key,
  action text not null,
  scope_json jsonb not null check (jsonb_typeof(scope_json)='object'),
  actor_id text not null,
  connector_id text not null references fuma_mcp_connector_bindings_v2(connector_id) on delete restrict,
  session_id text null,
  operation_id text null,
  outcome text not null check (outcome in ('success','failure','denied')),
  reason_code text null,
  occurred_at timestamptz not null
);
create index fuma_mcp_audit_site_v2_idx
  on fuma_mcp_audit_facts_v2((${jsonField('scope_json', 'siteId', 'postgres').sql}),occurred_at,audit_id);
create function fuma_mcp_audit_immutable_v2() returns trigger language plpgsql as $mcp_audit_immutable$
begin
  raise exception 'MCP audit facts are immutable' using errcode='55000';
end;
$mcp_audit_immutable$;
create trigger fuma_mcp_audit_immutable_v2
  before update or delete on fuma_mcp_audit_facts_v2
  for each row execute function fuma_mcp_audit_immutable_v2();

create table fuma_mcp_transfer_choices_v2 (
  transfer_id text primary key,
  connector_id text not null references fuma_mcp_connector_bindings_v2(connector_id) on delete restrict,
  choice text not null check (choice in ('rescope','revoke')),
  destination_scope_json jsonb not null check (jsonb_typeof(destination_scope_json)='object'),
  source_connector_json jsonb not null check (jsonb_typeof(source_connector_json)='object'),
  recorded_at timestamptz not null,
  applied_fence bigint null check (applied_fence is null or applied_fence > 0),
  compensated_fence bigint null check (compensated_fence is null or compensated_fence > 0)
);
`,
})

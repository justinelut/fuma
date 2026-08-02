import type { HostedMigration } from '../migrationPolicy'

/** Conductor-finalized additive FUMA-065 scope authority for the existing native AI runtime. */
export const siteAiScopeAuthorityMigration: HostedMigration = Object.freeze({
  id: '000068_site_ai_scope_authority',
  description: 'Add exact site-scoped native AI conversation snapshot job tool and audit authority',
  sql: String.raw`
create table fuma_site_ai_conversation_bindings (
  conversation_id text primary key references ai_conversations(id) on delete cascade,
  platform_id text not null,
  organization_id text not null,
  workspace_id text not null,
  site_id text not null,
  owner_key text not null,
  owner_generation bigint not null check (owner_generation > 0),
  profile_id text not null check (profile_id in ('website','publication')),
  actor_id text not null,
  session_id text not null,
  editor_session_id text not null,
  created_at timestamptz not null,
  unique (conversation_id, platform_id, organization_id, workspace_id, site_id,
          owner_key, owner_generation, profile_id, actor_id),
  unique (conversation_id, platform_id, organization_id, workspace_id, site_id,
          owner_key, owner_generation, profile_id, actor_id, session_id, editor_session_id)
);

create index fuma_site_ai_conversation_scope_idx
  on fuma_site_ai_conversation_bindings
  (platform_id, organization_id, workspace_id, site_id, owner_key,
   owner_generation, profile_id, actor_id, created_at desc);

create table fuma_site_ai_snapshot_bindings (
  snapshot_id text primary key,
  conversation_id text not null references fuma_site_ai_conversation_bindings(conversation_id) on delete cascade,
  platform_id text not null,
  organization_id text not null,
  workspace_id text not null,
  site_id text not null,
  owner_key text not null,
  owner_generation bigint not null check (owner_generation > 0),
  profile_id text not null check (profile_id in ('website','publication')),
  actor_id text not null,
  sequence bigint not null check (sequence >= 0),
  snapshot_hash_sha256 text not null check (snapshot_hash_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null,
  unique (conversation_id, sequence),
  unique (snapshot_id, conversation_id, platform_id, organization_id, workspace_id,
          site_id, owner_key, owner_generation, profile_id, actor_id),
  foreign key (conversation_id, platform_id, organization_id, workspace_id, site_id,
               owner_key, owner_generation, profile_id, actor_id)
    references fuma_site_ai_conversation_bindings
      (conversation_id, platform_id, organization_id, workspace_id, site_id,
       owner_key, owner_generation, profile_id, actor_id)
);

create table fuma_site_ai_turn_jobs (
  job_id text primary key,
  conversation_id text not null references fuma_site_ai_conversation_bindings(conversation_id),
  snapshot_id text not null references fuma_site_ai_snapshot_bindings(snapshot_id),
  platform_id text not null,
  organization_id text not null,
  workspace_id text not null,
  site_id text not null,
  owner_key text not null,
  owner_generation bigint not null check (owner_generation > 0),
  profile_id text not null check (profile_id in ('website','publication')),
  actor_id text not null,
  session_id text not null,
  editor_session_id text not null,
  authority_revision bigint not null check (authority_revision > 0),
  provider_id text not null,
  model_id text not null,
  required_capability text not null,
  reservation_id text null unique,
  state text not null check (state in ('running','succeeded','failed','denied')),
  attempt integer not null check (attempt > 0),
  prompt_tokens bigint not null default 0 check (prompt_tokens >= 0),
  completion_tokens bigint not null default 0 check (completion_tokens >= 0),
  failure_code text null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (conversation_id, platform_id, organization_id, workspace_id, site_id,
               owner_key, owner_generation, profile_id, actor_id, session_id, editor_session_id)
    references fuma_site_ai_conversation_bindings
      (conversation_id, platform_id, organization_id, workspace_id, site_id,
       owner_key, owner_generation, profile_id, actor_id, session_id, editor_session_id),
  foreign key (snapshot_id, conversation_id, platform_id, organization_id, workspace_id,
               site_id, owner_key, owner_generation, profile_id, actor_id)
    references fuma_site_ai_snapshot_bindings
      (snapshot_id, conversation_id, platform_id, organization_id, workspace_id,
       site_id, owner_key, owner_generation, profile_id, actor_id)
);

create index fuma_site_ai_turn_scope_idx
  on fuma_site_ai_turn_jobs
  (platform_id, organization_id, workspace_id, site_id, owner_key,
   owner_generation, profile_id, actor_id, state, updated_at desc);

create table fuma_site_ai_tool_receipts (
  job_id text not null references fuma_site_ai_turn_jobs(job_id) on delete cascade,
  tool_call_id text not null,
  tool_name text not null,
  input_hash_sha256 text not null check (input_hash_sha256 ~ '^[a-f0-9]{64}$'),
  mutates boolean not null,
  state text not null check (state in ('started','completed','failed')),
  attempt integer not null check (attempt > 0),
  output_json jsonb null,
  created_at timestamptz not null,
  completed_at timestamptz null,
  primary key (job_id, tool_call_id),
  check ((state = 'started') = (output_json is null and completed_at is null))
);

create table fuma_site_ai_audit_facts (
  audit_id text primary key,
  action text not null,
  platform_id text not null,
  organization_id text not null,
  workspace_id text not null,
  site_id text not null,
  owner_key text not null,
  owner_generation bigint not null check (owner_generation > 0),
  profile_id text not null check (profile_id in ('website','publication')),
  actor_id text not null,
  conversation_id text not null references fuma_site_ai_conversation_bindings(conversation_id),
  snapshot_id text null,
  job_id text null,
  tool_call_id text null,
  outcome text not null check (outcome in ('success','failure','denied')),
  reason_code text null,
  occurred_at timestamptz not null,
  foreign key (conversation_id, platform_id, organization_id, workspace_id, site_id,
               owner_key, owner_generation, profile_id, actor_id)
    references fuma_site_ai_conversation_bindings
      (conversation_id, platform_id, organization_id, workspace_id, site_id,
       owner_key, owner_generation, profile_id, actor_id)
);

create index fuma_site_ai_audit_scope_idx
  on fuma_site_ai_audit_facts
  (platform_id, organization_id, workspace_id, site_id, owner_key,
   owner_generation, profile_id, actor_id, occurred_at desc, audit_id);
`,
})

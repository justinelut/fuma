import type { HostedMigration } from '../migrationPolicy'

/** FUMA-WEB-013 secure public-to-app intent and relying-session authority. */
export const publicHandoffAuthorityMigration: HostedMigration = Object.freeze({
  id: '000077_public_handoff_authority',
  description: 'Add secure public handoff intent auth code and app session authority',
  sql: String.raw`
create table fuma_public_handoff_intents_v1 (
  token_hash_sha256 text primary key check(token_hash_sha256 ~ '^[a-f0-9]{64}$'),
  audience text not null check(audience='fuma-app'), callback_path text not null check(callback_path='/resume'),
  correlation text not null unique check(correlation ~ '^[A-Za-z0-9_-]{16,128}$'),
  request_json jsonb not null check(jsonb_typeof(request_json)='object'),
  issued_at timestamptz not null, expires_at timestamptz not null, consumed_at timestamptz null, cancelled_at timestamptz null,
  check(expires_at>issued_at), check(not(consumed_at is not null and cancelled_at is not null))
);
create index fuma_public_handoff_intent_expiry_v1 on fuma_public_handoff_intents_v1(expires_at) where consumed_at is null and cancelled_at is null;

create table fuma_app_handoff_codes_v1 (
  code_hash_sha256 text primary key check(code_hash_sha256 ~ '^[a-f0-9]{64}$'),
  intent_token_hash_sha256 text not null unique references fuma_public_handoff_intents_v1(token_hash_sha256) on delete restrict,
  audience text not null check(audience='fuma-app'), callback_path text not null check(callback_path='/resume'),
  state text not null unique check(state ~ '^[A-Za-z0-9_-]{16,128}$'), user_id text not null references auth_users(id) on delete restrict,
  identity_session_id text not null references auth_sessions(id) on delete cascade,
  issued_at timestamptz not null, expires_at timestamptz not null, consumed_at timestamptz null, cancelled_at timestamptz null,
  check(expires_at>issued_at), check(not(consumed_at is not null and cancelled_at is not null))
);
create index fuma_app_handoff_code_expiry_v1 on fuma_app_handoff_codes_v1(expires_at) where consumed_at is null and cancelled_at is null;

create table fuma_app_handoff_sessions_v1 (
  token_hash_sha256 text primary key check(token_hash_sha256 ~ '^[a-f0-9]{64}$'),
  audience text not null check(audience='fuma-app'), user_id text not null references auth_users(id) on delete restrict,
  identity_session_id text not null references auth_sessions(id) on delete cascade,
  created_at timestamptz not null, expires_at timestamptz not null, revoked_at timestamptz null,
  check(expires_at>created_at)
);
create index fuma_app_handoff_session_user_v1 on fuma_app_handoff_sessions_v1(user_id,expires_at desc) where revoked_at is null;
create index fuma_app_handoff_session_identity_v1 on fuma_app_handoff_sessions_v1(identity_session_id,expires_at desc) where revoked_at is null;

create table fuma_public_handoff_events_v1 (
  event_id text primary key, intent_token_hash_sha256 text null check(intent_token_hash_sha256 is null or intent_token_hash_sha256 ~ '^[a-f0-9]{64}$'),
  code_hash_sha256 text null check(code_hash_sha256 is null or code_hash_sha256 ~ '^[a-f0-9]{64}$'),
  user_id text null, event_kind text not null check(event_kind in ('issued','authorized','exchanged','cancelled','rejected','expired')),
  source text null, occurred_at timestamptz not null,
  check(intent_token_hash_sha256 is not null or code_hash_sha256 is not null)
);
create index fuma_public_handoff_event_time_v1 on fuma_public_handoff_events_v1(occurred_at,event_id);
create function fuma_public_handoff_events_immutable_v1() returns trigger language plpgsql as $public_handoff_events_immutable$
begin raise exception 'public handoff events are append-only' using errcode='55000'; end;
$public_handoff_events_immutable$;
create trigger fuma_public_handoff_events_immutable_v1 before update or delete on fuma_public_handoff_events_v1 for each row execute function fuma_public_handoff_events_immutable_v1();
`,
})

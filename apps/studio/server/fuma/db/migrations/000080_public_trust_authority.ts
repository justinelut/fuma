import type { HostedMigration } from '../migrationPolicy'

/** FUMA-WEB-014 finalized durable metadata-only contact routing authority. */
export const publicTrustAuthorityMigration: HostedMigration = Object.freeze({
  id: '000080_public_trust_authority',
  description: 'Add durable public contact routing receipt authority',
  sql: String.raw`
create table fuma_public_contact_routing_receipts_v2 (
  replay_token text primary key check(replay_token ~ '^[A-Za-z0-9_-]{16,128}$'),
  request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
  routed_as text not null check(routed_as in ('general','security','privacy','abuse','expert_inquiry')),
  receipt_id text not null unique check(receipt_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,159}$'),
  state text not null check(state in ('routing','accepted')),
  accepted_at timestamptz null,
  delete_after timestamptz null,
  retention_policy_version text null check(
    retention_policy_version is null
    or retention_policy_version ~ '^[0-9A-Za-z._-]{1,80}$'
  ),
  lease_owner text not null check(
    lease_owner ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  ),
  lease_expires_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check(lease_expires_at >= created_at),
  check(updated_at >= created_at),
  check(
    (state='routing' and accepted_at is null and delete_after is null and retention_policy_version is null)
    or
    (state='accepted' and accepted_at is not null and delete_after > accepted_at and retention_policy_version is not null)
  )
);
create index fuma_public_contact_receipt_expiry_v2
  on fuma_public_contact_routing_receipts_v2(delete_after,replay_token)
  where state='accepted';

create function fuma_public_contact_receipt_update_guard_v2() returns trigger language plpgsql as $public_contact_update_guard$
begin
  if NEW.replay_token is distinct from OLD.replay_token
    or NEW.request_sha256 is distinct from OLD.request_sha256
    or NEW.routed_as is distinct from OLD.routed_as
    or NEW.receipt_id is distinct from OLD.receipt_id
    or NEW.created_at is distinct from OLD.created_at then
    raise exception 'public contact receipt identity is immutable' using errcode='55000';
  end if;
  if OLD.state='accepted' then
    raise exception 'accepted public contact receipt is immutable until expiry' using errcode='55000';
  end if;
  if NEW.state='routing' and (
    NEW.accepted_at is not null
    or NEW.delete_after is not null
    or NEW.retention_policy_version is not null
  ) then
    raise exception 'routing public contact receipt cannot contain acceptance evidence' using errcode='23514';
  end if;
  if NEW.state='accepted' and (
    NEW.accepted_at is null
    or NEW.delete_after is null
    or NEW.retention_policy_version is null
  ) then
    raise exception 'accepted public contact receipt requires complete retention evidence' using errcode='23514';
  end if;
  return NEW;
end;
$public_contact_update_guard$;
create trigger fuma_public_contact_receipt_update_guard_v2
  before update on fuma_public_contact_routing_receipts_v2
  for each row execute function fuma_public_contact_receipt_update_guard_v2();

create function fuma_public_contact_receipt_delete_guard_v2() returns trigger language plpgsql as $public_contact_delete_guard$
begin
  if OLD.state<>'accepted' or OLD.delete_after is null or OLD.delete_after>statement_timestamp() then
    raise exception 'public contact receipt cannot be deleted before retention expiry' using errcode='55000';
  end if;
  return OLD;
end;
$public_contact_delete_guard$;
create trigger fuma_public_contact_receipt_delete_guard_v2
  before delete on fuma_public_contact_routing_receipts_v2
  for each row execute function fuma_public_contact_receipt_delete_guard_v2();
`,
})

export const entitlementEvidenceMigrationCandidate = Object.freeze({
  description: 'Add immutable entitlement economics evidence assignments snapshots and atomic offer acceptance',
  sql: `
create table fuma_price_book_evidence (
  version text primary key references fuma_price_books(version) on delete restrict,
  cost_model_version text not null,
  private_json jsonb not null,
  evidence_sha256 text not null check(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null
);
create table fuma_custom_offer_evidence (
  offer_id text not null,
  offer_version bigint not null,
  private_json jsonb not null,
  evidence_sha256 text not null check(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null,
  accepted_at timestamptz null,
  primary key(offer_id,offer_version),
  foreign key(offer_id,offer_version) references fuma_custom_offers(offer_id,version) on delete restrict
);
alter table fuma_contract_candidates add column destination_organization_id text;
alter table fuma_contract_candidates add column destination_workspace_id text;
alter table fuma_contract_candidates add column site_id text;
alter table fuma_contract_candidates add column snapshot_sha256 text;
alter table fuma_contract_candidates add column created_at timestamptz;
alter table fuma_contract_candidates add column paid_transfer_pending boolean not null default false;
alter table fuma_contract_candidates add constraint fuma_candidate_destination_complete check(
  destination_organization_id is not null and destination_workspace_id is not null and site_id is not null
  and snapshot_sha256 ~ '^[0-9a-f]{64}$' and created_at is not null
  and not paid_transfer_pending and state='awaiting-payment' and activated_at is null
);
create table fuma_entitlement_assignments (
  assignment_id text primary key,
  organization_id text not null,
  source text not null check(source in ('public-contract','private-contract','grandfathered')),
  source_id text not null,
  state text not null check(state in ('active','expired','revoked')),
  effective_at timestamptz not null,
  expires_at timestamptz null,
  created_at timestamptz not null,
  check(expires_at is null or expires_at>effective_at),
  unique(organization_id,source,source_id)
);
create table fuma_entitlement_snapshots (
  snapshot_id text primary key,
  organization_id text not null,
  source text not null check(source in ('platform-internal','public-contract','private-contract','grandfathered')),
  source_id text not null,
  quota_json jsonb not null,
  effective_at timestamptz not null,
  expires_at timestamptz null,
  immutable_sha256 text not null check(immutable_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null,
  check(expires_at is null or expires_at>effective_at)
);
create index fuma_current_entitlement_snapshot on fuma_entitlement_snapshots(organization_id,effective_at desc,snapshot_id);
create table fuma_grandfathered_assignments (
  assignment_id text primary key references fuma_entitlement_assignments(assignment_id) on delete restrict,
  private_json jsonb not null,
  source text not null check(source in ('legacy-customer','the-lawyer')),
  inventory_evidence_sha256 text null,
  immutable_sha256 text not null check(immutable_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null,
  check((source='the-lawyer')=(inventory_evidence_sha256 is not null))
);
create function fuma_entitlement_evidence_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'entitlement evidence is immutable' using errcode='55000';
end $$;
create trigger fuma_price_book_evidence_immutable before update or delete on fuma_price_book_evidence for each row execute function fuma_entitlement_evidence_immutable();
create trigger fuma_custom_offer_evidence_immutable before delete on fuma_custom_offer_evidence for each row execute function fuma_entitlement_evidence_immutable();
create trigger fuma_entitlement_snapshots_immutable before update or delete on fuma_entitlement_snapshots for each row execute function fuma_entitlement_evidence_immutable();
create trigger fuma_grandfathered_assignments_immutable before update or delete on fuma_grandfathered_assignments for each row execute function fuma_entitlement_evidence_immutable();
create or replace function fuma_commercial_snapshot_immutable() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' or tg_table_name='fuma_price_books' then
    raise exception 'commercial snapshot is immutable' using errcode='55000';
  end if;
  if (to_jsonb(new)-'state')<>(to_jsonb(old)-'state') or not (
    (old.state='draft' and new.state='issued') or
    (old.state='issued' and new.state in ('accepted','withdrawn','expired'))
  ) then raise exception 'commercial snapshot is immutable' using errcode='55000'; end if;
  return new;
end $$;
create function fuma_offer_evidence_acceptance_only() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new)-'accepted_at')<>(to_jsonb(old)-'accepted_at') or old.accepted_at is not null or new.accepted_at is null then
    raise exception 'offer evidence is immutable' using errcode='55000';
  end if;
  return new;
end $$;
create trigger fuma_custom_offer_evidence_update before update on fuma_custom_offer_evidence for each row execute function fuma_offer_evidence_acceptance_only();
`,
})

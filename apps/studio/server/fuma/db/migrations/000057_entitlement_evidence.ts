import type { HostedMigration } from '../migrationPolicy'

/** Conductor-finalized additive FUMA-054 entitlement evidence authority. */
export const entitlementEvidenceMigration: HostedMigration = {
  id: '000057_entitlement_evidence',
  description: 'Add immutable entitlement economics evidence assignments snapshots and atomic offer acceptance',
  sql: `
    do $entitlement_legacy_guard$
    begin
      if exists (select 1 from fuma_price_books limit 1)
        or exists (select 1 from fuma_custom_offers limit 1)
        or exists (select 1 from fuma_contract_candidates limit 1) then
        raise exception 'pre-FUMA-054 commercial rows require reviewed immutable-evidence backfill' using errcode = '55000';
      end if;
    end;
    $entitlement_legacy_guard$;

    create table fuma_price_book_evidence (
      version text primary key references fuma_price_books(version) on delete restrict,
      cost_model_version text not null,
      private_json jsonb not null,
      evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
      created_at timestamptz not null
    );
    create table fuma_custom_offer_evidence (
      offer_id text not null,
      offer_version bigint not null,
      private_json jsonb not null,
      evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
      issued_at timestamptz not null,
      accepted_at timestamptz null,
      primary key (offer_id, offer_version),
      foreign key (offer_id, offer_version)
        references fuma_custom_offers(offer_id, version) on delete restrict
    );

    alter table fuma_contract_candidates add column destination_organization_id text not null;
    alter table fuma_contract_candidates add column destination_workspace_id text not null;
    alter table fuma_contract_candidates add column site_id text not null;
    alter table fuma_contract_candidates add column snapshot_sha256 text not null
      check (snapshot_sha256 ~ '^[0-9a-f]{64}$');
    alter table fuma_contract_candidates add column created_at timestamptz not null;
    alter table fuma_contract_candidates add column paid_transfer_pending boolean not null default false;
    alter table fuma_contract_candidates add constraint fuma_candidate_acceptance_initial_state check (
      state <> 'awaiting-payment'
      or (
        not setup_fee_settled and not recurring_settled and activated_at is null
        and not paid_transfer_pending
      )
    );

    create table fuma_entitlement_assignments (
      assignment_id text primary key,
      organization_id text not null,
      source text not null check (source in ('public-contract', 'private-contract', 'grandfathered')),
      source_id text not null,
      state text not null check (state in ('active', 'expired', 'revoked')),
      effective_at timestamptz not null,
      expires_at timestamptz null,
      created_at timestamptz not null,
      check (expires_at is null or expires_at > effective_at),
      unique (organization_id, source, source_id)
    );
    create table fuma_entitlement_snapshots (
      snapshot_id text primary key,
      organization_id text not null,
      source text not null check (source in ('platform-internal', 'public-contract', 'private-contract', 'grandfathered')),
      source_id text not null,
      quota_json jsonb not null,
      effective_at timestamptz not null,
      expires_at timestamptz null,
      immutable_sha256 text not null check (immutable_sha256 ~ '^[0-9a-f]{64}$'),
      created_at timestamptz not null,
      check (expires_at is null or expires_at > effective_at)
    );
    create index fuma_current_entitlement_snapshot
      on fuma_entitlement_snapshots (organization_id, effective_at desc, snapshot_id);
    create table fuma_grandfathered_assignments (
      assignment_id text primary key references fuma_entitlement_assignments(assignment_id) on delete restrict,
      private_json jsonb not null,
      source text not null check (source in ('legacy-customer', 'the-lawyer')),
      inventory_evidence_sha256 text null,
      immutable_sha256 text not null check (immutable_sha256 ~ '^[0-9a-f]{64}$'),
      created_at timestamptz not null,
      check ((source = 'the-lawyer') = (inventory_evidence_sha256 is not null))
    );

    create function fuma_entitlement_evidence_immutable()
    returns trigger language plpgsql as $entitlement_immutable$
    begin
      raise exception 'entitlement evidence is immutable' using errcode = '55000';
    end;
    $entitlement_immutable$;
    create trigger fuma_price_book_evidence_immutable
      before update or delete on fuma_price_book_evidence
      for each row execute function fuma_entitlement_evidence_immutable();
    create trigger fuma_custom_offer_evidence_immutable
      before delete on fuma_custom_offer_evidence
      for each row execute function fuma_entitlement_evidence_immutable();
    create trigger fuma_entitlement_snapshots_immutable
      before update or delete on fuma_entitlement_snapshots
      for each row execute function fuma_entitlement_evidence_immutable();
    create trigger fuma_grandfathered_assignments_immutable
      before update or delete on fuma_grandfathered_assignments
      for each row execute function fuma_entitlement_evidence_immutable();

    create function fuma_entitlement_assignment_guard()
    returns trigger language plpgsql as $assignment_guard$
    begin
      if tg_op = 'DELETE'
        or new.assignment_id <> old.assignment_id
        or new.organization_id <> old.organization_id
        or new.source <> old.source
        or new.source_id <> old.source_id
        or new.effective_at <> old.effective_at
        or new.expires_at is distinct from old.expires_at
        or new.created_at <> old.created_at
        or old.state <> 'active'
        or new.state not in ('expired', 'revoked') then
        raise exception 'entitlement assignment identity is immutable' using errcode = '55000';
      end if;
      return new;
    end;
    $assignment_guard$;
    create trigger fuma_entitlement_assignment_guard
      before update or delete on fuma_entitlement_assignments
      for each row execute function fuma_entitlement_assignment_guard();

    create or replace function fuma_commercial_snapshot_immutable()
    returns trigger language plpgsql as $commercial_snapshot_guard$
    begin
      if tg_op = 'DELETE' or tg_table_name = 'fuma_price_books' then
        raise exception 'commercial snapshot is immutable' using errcode = '55000';
      end if;
      if (to_jsonb(new) - 'state') <> (to_jsonb(old) - 'state') or not (
        (old.state = 'draft' and new.state = 'issued')
        or (old.state = 'issued' and new.state in ('accepted', 'withdrawn', 'expired'))
      ) then
        raise exception 'commercial snapshot is immutable' using errcode = '55000';
      end if;
      return new;
    end;
    $commercial_snapshot_guard$;

    create function fuma_offer_evidence_acceptance_only()
    returns trigger language plpgsql as $offer_evidence_guard$
    begin
      if (to_jsonb(new) - 'accepted_at') <> (to_jsonb(old) - 'accepted_at')
        or old.accepted_at is not null or new.accepted_at is null then
        raise exception 'offer evidence is immutable' using errcode = '55000';
      end if;
      return new;
    end;
    $offer_evidence_guard$;
    create trigger fuma_custom_offer_evidence_update
      before update on fuma_custom_offer_evidence
      for each row execute function fuma_offer_evidence_acceptance_only();
  `,
}

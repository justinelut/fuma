import type { HostedMigration } from '../db/migrationPolicy'

/** Worker-owned FUMA-057 candidate; the conductor assigns the finalized hosted ID/checksum. */
export const quotaSelfServiceMigrationCandidate: HostedMigration = Object.freeze({
  id: 'unfinalized_fuma057_quota_self_service',
  description: 'Add verified entitlement quota reservations usage collection notices dunning and self-service evidence',
  sql: `
    create table fuma_quota_entitlement_snapshots_v2 (
      snapshot_id text primary key,
      organization_id text not null,
      source text not null check (source in (
        'public-contract','private-contract','grandfathered','platform-internal'
      )),
      source_id text not null,
      source_version text not null,
      contract_id text null references fuma_organization_contracts(contract_id) on delete restrict,
      quota_json jsonb not null,
      evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
      activated_at timestamptz not null,
      created_at timestamptz not null,
      unique (organization_id, source, source_id, source_version, evidence_sha256),
      check ((source = 'platform-internal') = (contract_id is null and source_id = 'platform-internal')
        or source <> 'platform-internal')
    );

    create table fuma_quota_entitlement_bindings_v2 (
      organization_id text primary key,
      snapshot_id text not null references fuma_quota_entitlement_snapshots_v2(snapshot_id) on delete restrict,
      source text not null check (source in (
        'public-contract','private-contract','grandfathered','platform-internal'
      )),
      source_id text not null,
      source_version text not null,
      activated_at timestamptz not null,
      bound_at timestamptz not null
    );

    create table fuma_quota_balances_v2 (
      organization_id text not null,
      quota_class text not null check (quota_class in (
        'sites','pages','cmsItems','members','storageBytes','bandwidthBytes',
        'emailRecipientsDay','emailRecipientsMonth','buildPublishMinutes',
        'pluginComputeMinutes','aiCredits','releaseRetentionBytes','collaborators','customDomains'
      )),
      entitlement_snapshot_id text not null references fuma_quota_entitlement_snapshots_v2(snapshot_id) on delete restrict,
      window_key text not null,
      limit_units bigint not null check (limit_units > 0),
      used_units bigint not null default 0 check (used_units >= 0),
      reserved_units bigint not null default 0 check (reserved_units >= 0),
      version bigint not null default 1 check (version > 0),
      updated_at timestamptz not null,
      primary key (organization_id, quota_class)
    );

    create table fuma_quota_reservations_v2 (
      idempotency_key text primary key,
      organization_id text not null,
      workspace_id text null,
      site_id text null,
      operation text not null check (operation in (
        'create','campaign','build','domain','import','publish','plugin','ai',
        'storage','bandwidth','collaborator'
      )),
      entitlement_snapshot_id text not null references fuma_quota_entitlement_snapshots_v2(snapshot_id) on delete restrict,
      request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
      settlement_sha256 text null check (settlement_sha256 is null or settlement_sha256 ~ '^[a-f0-9]{64}$'),
      state text not null check (state in ('reserved','settled','released')),
      created_at timestamptz not null,
      resolved_at timestamptz null,
      check ((state = 'reserved') = (resolved_at is null)),
      check ((state = 'settled') = (settlement_sha256 is not null))
    );

    create table fuma_quota_reservation_items_v2 (
      idempotency_key text not null references fuma_quota_reservations_v2(idempotency_key) on delete restrict,
      quota_class text not null check (quota_class in (
        'sites','pages','cmsItems','members','storageBytes','bandwidthBytes',
        'emailRecipientsDay','emailRecipientsMonth','buildPublishMinutes',
        'pluginComputeMinutes','aiCredits','releaseRetentionBytes','collaborators','customDomains'
      )),
      window_key text not null,
      reserved_units bigint not null check (reserved_units > 0),
      actual_units bigint null check (actual_units is null or actual_units >= 0),
      primary key (idempotency_key, quota_class),
      check (actual_units is null or actual_units <= reserved_units)
    );

    create table fuma_quota_notices_v2 (
      organization_id text not null,
      entitlement_snapshot_id text not null references fuma_quota_entitlement_snapshots_v2(snapshot_id) on delete restrict,
      quota_class text not null,
      window_key text not null,
      threshold integer not null check (threshold in (50,75,90,100)),
      used_units bigint not null check (used_units >= 0),
      limit_units bigint not null check (limit_units > 0),
      emitted_at timestamptz not null,
      primary key (organization_id, entitlement_snapshot_id, quota_class, window_key, threshold)
    );

    create table fuma_quota_usage_observations_v2 (
      idempotency_key text primary key,
      organization_id text not null,
      entitlement_snapshot_id text not null references fuma_quota_entitlement_snapshots_v2(snapshot_id) on delete restrict,
      source text not null check (source in ('setup','import','continuous','reconciliation')),
      usage_json jsonb not null,
      observation_sha256 text not null check (observation_sha256 ~ '^[a-f0-9]{64}$'),
      observed_at timestamptz not null,
      created_at timestamptz not null
    );
    create index fuma_quota_usage_observations_current_v2
      on fuma_quota_usage_observations_v2 (organization_id, observed_at desc, idempotency_key);

    create table fuma_billing_accounts_v2 (
      organization_id text primary key,
      contract_id text not null references fuma_organization_contracts(contract_id) on delete restrict,
      source text not null check (source in ('public-contract','private-contract')),
      payment_state text not null check (payment_state in ('current','past-due','grace','cancelled')),
      grace_ends_at timestamptz null,
      cancellation_requested_at timestamptz null,
      version bigint not null default 1 check (version > 0),
      updated_at timestamptz not null,
      check ((payment_state = 'grace') = (grace_ends_at is not null))
    );

    create table fuma_billing_account_transitions_v2 (
      transition_id text primary key,
      organization_id text not null,
      contract_id text not null references fuma_organization_contracts(contract_id) on delete restrict,
      from_state text null check (from_state is null or from_state in ('current','past-due','grace','cancelled')),
      to_state text not null check (to_state in ('current','past-due','grace','cancelled')),
      reason text not null check (reason in (
        'contract-activated','provider-past-due','grace-started','grace-expired',
        'verified-payment','customer-cancellation-requested'
      )),
      occurred_at timestamptz not null,
      unique (organization_id, contract_id, to_state, reason, occurred_at)
    );

    create table fuma_billing_dunning_notices_v2 (
      organization_id text not null,
      account_version bigint not null,
      kind text not null check (kind in ('past-due','grace-expiring','cancelled')),
      emitted_at timestamptz not null,
      primary key (organization_id, account_version, kind)
    );

    create table fuma_quota_topup_requests_v2 (
      idempotency_key text primary key,
      organization_id text not null,
      quota_class text not null,
      units bigint not null check (units > 0),
      reason text not null,
      requested_by text not null,
      state text not null default 'requested' check (state in ('requested','approved','declined','expired')),
      requested_at timestamptz not null,
      decided_at timestamptz null,
      check ((state = 'requested') = (decided_at is null))
    );

    create function fuma_quota_immutable_evidence_v2()
    returns trigger language plpgsql as $quota_immutable$
    begin
      raise exception 'quota evidence is immutable' using errcode = '55000';
    end;
    $quota_immutable$;

    create trigger fuma_quota_entitlement_snapshot_immutable_v2
      before update or delete on fuma_quota_entitlement_snapshots_v2
      for each row execute function fuma_quota_immutable_evidence_v2();
    create trigger fuma_quota_usage_observation_immutable_v2
      before update or delete on fuma_quota_usage_observations_v2
      for each row execute function fuma_quota_immutable_evidence_v2();
    create trigger fuma_billing_account_transition_immutable_v2
      before update or delete on fuma_billing_account_transitions_v2
      for each row execute function fuma_quota_immutable_evidence_v2();

    create function fuma_quota_reservation_guard_v2()
    returns trigger language plpgsql as $quota_reservation_guard$
    begin
      if tg_op = 'DELETE'
        or new.idempotency_key <> old.idempotency_key
        or new.organization_id <> old.organization_id
        or new.workspace_id is distinct from old.workspace_id
        or new.site_id is distinct from old.site_id
        or new.operation <> old.operation
        or new.entitlement_snapshot_id <> old.entitlement_snapshot_id
        or new.request_sha256 <> old.request_sha256
        or new.created_at <> old.created_at
        or old.state <> 'reserved'
        or new.state not in ('settled','released') then
        raise exception 'quota reservation identity is immutable' using errcode = '55000';
      end if;
      return new;
    end;
    $quota_reservation_guard$;
    create trigger fuma_quota_reservation_guard_v2
      before update or delete on fuma_quota_reservations_v2
      for each row execute function fuma_quota_reservation_guard_v2();

    create function fuma_quota_reservation_item_guard_v2()
    returns trigger language plpgsql as $quota_item_guard$
    begin
      if tg_op = 'DELETE'
        or new.idempotency_key <> old.idempotency_key
        or new.quota_class <> old.quota_class
        or new.window_key <> old.window_key
        or new.reserved_units <> old.reserved_units
        or old.actual_units is not null
        or new.actual_units is null then
        raise exception 'quota reservation item identity is immutable' using errcode = '55000';
      end if;
      return new;
    end;
    $quota_item_guard$;
    create trigger fuma_quota_reservation_item_guard_v2
      before update or delete on fuma_quota_reservation_items_v2
      for each row execute function fuma_quota_reservation_item_guard_v2();
  `,
})

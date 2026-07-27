/** Worker-owned candidate; the conductor assigns the immutable hosted migration ID/checksum. */
import type { HostedMigration } from '../migrationPolicy'

/** Conductor-finalized additive FUMA-056 billing reconciliation authority. */
export const platformBillingReconciliationMigration: HostedMigration = Object.freeze({
  id: '000059_platform_billing_reconciliation',
  description: 'Finalize durable platform webhook reduction settlement activation and handoff evidence',
  sql: `
    alter table fuma_billing_events add column claim_id text null;
    alter table fuma_billing_events add column claim_expires_at timestamptz null;
    alter table fuma_billing_events add column attempt_count integer not null default 0
      check (attempt_count >= 0);
    alter table fuma_billing_events add column error_code text null
      check (error_code is null or error_code ~ '^[a-z][a-z0-9-]{0,63}$');
    alter table fuma_billing_events add constraint fuma_billing_event_claim_pair check (
      (claim_id is null) = (claim_expires_at is null)
    );
    create index fuma_billing_events_reduction_v2
      on fuma_billing_events (state, provider_sequence, event_id);

    alter table fuma_platform_checkout_obligations_v2
      add column provider_transaction_id text null;
    alter table fuma_platform_checkout_obligations_v2
      add column settled_at timestamptz null;
    alter table fuma_platform_checkout_obligations_v2
      add constraint fuma_platform_obligation_settlement_pair_v2 check (
        (provider_transaction_id is null) = (settled_at is null)
      );
    create unique index fuma_platform_obligation_provider_transaction_v2
      on fuma_platform_checkout_obligations_v2 (provider_transaction_id)
      where provider_transaction_id is not null;

    alter table fuma_organization_contracts alter column candidate_id drop not null;
    alter table fuma_organization_contracts
      add column checkout_id text null references fuma_platform_checkout_candidates_v2(checkout_id) on delete restrict;
    alter table fuma_organization_contracts add column source_kind text null
      check (source_kind is null or source_kind in ('public-plan','private-offer'));
    alter table fuma_organization_contracts add column source_id text null;
    alter table fuma_organization_contracts add column source_version text null;
    alter table fuma_organization_contracts add column cadence text null
      check (cadence is null or cadence in ('monthly','annual'));
    alter table fuma_organization_contracts add column evidence_sha256 text null
      check (evidence_sha256 is null or evidence_sha256 ~ '^[a-f0-9]{64}$');
    alter table fuma_organization_contracts
      add constraint fuma_organization_contract_checkout_unique unique (checkout_id);
    alter table fuma_organization_contracts
      add constraint fuma_organization_contract_source_v2 check (
        (checkout_id is null and source_kind is null and source_id is null
          and source_version is null and cadence is null and evidence_sha256 is null
          and candidate_id is not null)
        or
        (checkout_id is not null and source_kind is not null and source_id is not null
          and source_version is not null and cadence is not null and evidence_sha256 is not null)
      );

    create table fuma_platform_subscription_reductions_v2 (
      scope text not null default 'platform_billing' check (scope = 'platform_billing'),
      reference text primary key,
      state text not null check (state in ('active','non-renewing','disabled')),
      last_provider_sequence numeric(39,0) not null,
      last_event_id text not null references fuma_billing_events(event_id) on delete restrict,
      updated_at timestamptz not null,
      foreign key (scope, reference)
        references fuma_paystack_initializations(scope, reference) on delete restrict
    );

    create function fuma_billing_event_identity_guard_v2()
    returns trigger language plpgsql as $billing_event_guard$
    begin
      if tg_op = 'DELETE'
        or new.event_id <> old.event_id
        or new.provider_sequence <> old.provider_sequence
        or new.event_type <> old.event_type
        or new.reference is distinct from old.reference
        or new.raw_sha256 <> old.raw_sha256
        or new.received_at <> old.received_at
        or old.state in ('reduced','unknown') and to_jsonb(new) <> to_jsonb(old)
        or old.state = 'stored' and new.state not in ('stored','reduced') then
        raise exception 'billing event identity is immutable' using errcode = '55000';
      end if;
      return new;
    end;
    $billing_event_guard$;
    create trigger fuma_billing_event_identity_guard_v2
      before update or delete on fuma_billing_events
      for each row execute function fuma_billing_event_identity_guard_v2();

    create function fuma_platform_obligation_settlement_guard_v2()
    returns trigger language plpgsql as $billing_obligation_guard$
    begin
      if old.provider_transaction_id is not null and (
          new.provider_transaction_id is distinct from old.provider_transaction_id
          or new.settled_at is distinct from old.settled_at
        )
        or old.provider_transaction_id is null and (
          (new.provider_transaction_id is null) <> (new.settled_at is null)
        ) then
        raise exception 'platform obligation settlement is immutable' using errcode = '55000';
      end if;
      return new;
    end;
    $billing_obligation_guard$;
    create trigger fuma_platform_obligation_settlement_guard_v2
      before update on fuma_platform_checkout_obligations_v2
      for each row execute function fuma_platform_obligation_settlement_guard_v2();

    create function fuma_settled_checkout_cancel_guard_v2()
    returns trigger language plpgsql as $billing_checkout_cancel_guard$
    begin
      if new.state = 'cancelled'
        and exists (
          select 1
          from fuma_platform_checkout_obligations_v2
          where checkout_id = old.checkout_id
            and settled_at is not null
        ) then
        raise exception 'settled checkout cannot be cancelled'
          using errcode = '55000';
      end if;
      return new;
    end;
    $billing_checkout_cancel_guard$;

    create trigger fuma_settled_checkout_cancel_guard_v2
      before update on fuma_platform_checkout_candidates_v2
      for each row execute function fuma_settled_checkout_cancel_guard_v2();

    create function fuma_organization_contract_identity_guard_v2()
    returns trigger language plpgsql as $billing_contract_guard$
    begin
      if tg_op = 'DELETE'
        or (to_jsonb(new) - 'state') <> (to_jsonb(old) - 'state')
        or old.state = 'cancelled'
        or old.state = 'active' and new.state <> old.state
        or old.state = 'paid-transfer-pending' and new.state not in ('paid-transfer-pending','active','cancelled') then
        raise exception 'organization contract identity is immutable' using errcode = '55000';
      end if;
      return new;
    end;
    $billing_contract_guard$;
    create trigger fuma_organization_contract_identity_guard_v2
      before update or delete on fuma_organization_contracts
      for each row execute function fuma_organization_contract_identity_guard_v2();

    create function fuma_platform_subscription_identity_guard_v2()
    returns trigger language plpgsql as $billing_subscription_guard$
    begin
      if tg_op = 'DELETE'
        or new.scope <> old.scope
        or new.reference <> old.reference
        or new.last_provider_sequence < old.last_provider_sequence
        or new.last_provider_sequence = old.last_provider_sequence
          and new.last_event_id <= old.last_event_id then
        raise exception 'platform subscription reduction is immutable or stale' using errcode = '55000';
      end if;
      return new;
    end;
    $billing_subscription_guard$;
    create trigger fuma_platform_subscription_identity_guard_v2
      before update or delete on fuma_platform_subscription_reductions_v2
      for each row execute function fuma_platform_subscription_identity_guard_v2();
  `,
})

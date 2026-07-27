import type { HostedMigration } from '../migrationPolicy'

/** Conductor-finalized additive FUMA-055 checkout authority. */
export const platformCheckoutAuthorityMigration: HostedMigration = {
  id: '000058_platform_checkout_authority',
  description: 'Add isolated platform checkout candidates obligations and initialization claims',
  sql: `
    create table fuma_platform_checkout_candidates_v2 (
      checkout_id text primary key,
      candidate_id text not null unique,
      entitlement_candidate_id text null references fuma_contract_candidates(candidate_id) on delete restrict,
      source_kind text not null check (source_kind in ('public-plan', 'private-offer')),
      source_id text not null,
      source_version text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      profile_id text not null,
      customer_actor_id text not null,
      payer_email_sha256 text not null check (payer_email_sha256 ~ '^[0-9a-f]{64}$'),
      cadence text not null check (cadence in ('monthly', 'annual')),
      currency char(3) not null check (currency = 'KES'),
      recurring_amount_minor bigint not null check (recurring_amount_minor > 0),
      setup_fee_minor bigint not null check (setup_fee_minor >= 0),
      callback_url text not null check (callback_url like 'https://%'),
      allowed_channels text[] not null,
      evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
      state text not null check (state in ('awaiting-payment', 'cancelled')),
      created_at timestamptz not null,
      cancelled_at timestamptz null,
      check (cardinality(allowed_channels) between 1 and 3),
      check (allowed_channels <@ array['card','mobile_money','bank']::text[]),
      check ((state = 'cancelled') = (cancelled_at is not null)),
      unique (source_kind, source_id, source_version, cadence, organization_id, workspace_id, site_id)
    );
    create table fuma_platform_checkout_obligations_v2 (
      checkout_id text not null references fuma_platform_checkout_candidates_v2(checkout_id) on delete restrict,
      kind text not null check (kind in ('setup', 'recurring')),
      reference text null unique,
      amount_minor bigint not null check (amount_minor > 0),
      currency char(3) not null check (currency = 'KES'),
      state text not null check (state in ('pending', 'initializing', 'ready', 'callback-verified', 'failed')),
      authorization_url text null check (authorization_url is null or authorization_url like 'https://%'),
      claim_id text null,
      claim_expires_at timestamptz null,
      callback_verified_at timestamptz null,
      attempt_count integer not null default 0 check (attempt_count >= 0),
      created_at timestamptz not null,
      updated_at timestamptz not null,
      primary key (checkout_id, kind),
      check ((state = 'initializing') = (claim_id is not null and claim_expires_at is not null)),
      check ((state in ('ready', 'callback-verified')) = (authorization_url is not null)),
      check ((state = 'callback-verified') = (callback_verified_at is not null))
    );
    create index fuma_platform_checkout_destination_v2
      on fuma_platform_checkout_candidates_v2 (organization_id, workspace_id, site_id, created_at desc);
    create index fuma_platform_checkout_obligation_reference_v2
      on fuma_platform_checkout_obligations_v2 (reference) where reference is not null;

    create function fuma_platform_checkout_identity_immutable_v2()
    returns trigger language plpgsql as $checkout_identity_guard$
    begin
      if tg_op = 'DELETE'
        or (to_jsonb(new) - array['state','cancelled_at'])
          <> (to_jsonb(old) - array['state','cancelled_at'])
        or old.state <> 'awaiting-payment'
        or new.state <> 'cancelled'
        or new.cancelled_at is null then
        raise exception 'platform checkout identity is immutable' using errcode = '55000';
      end if;
      return new;
    end;
    $checkout_identity_guard$;
    create trigger fuma_platform_checkout_identity_immutable_v2
      before update or delete on fuma_platform_checkout_candidates_v2
      for each row execute function fuma_platform_checkout_identity_immutable_v2();

    create function fuma_platform_checkout_obligation_guard_v2()
    returns trigger language plpgsql as $checkout_obligation_guard$
    begin
      if tg_op = 'DELETE'
        or new.checkout_id <> old.checkout_id
        or new.kind <> old.kind
        or new.reference is distinct from old.reference
          and old.reference is not null
        or new.amount_minor <> old.amount_minor
        or new.currency <> old.currency
        or new.created_at <> old.created_at
        or (old.state = 'callback-verified' and new.state <> old.state) then
        raise exception 'platform checkout obligation identity is immutable' using errcode = '55000';
      end if;
      return new;
    end;
    $checkout_obligation_guard$;
    create trigger fuma_platform_checkout_obligation_guard_v2
      before update or delete on fuma_platform_checkout_obligations_v2
      for each row execute function fuma_platform_checkout_obligation_guard_v2();
  `,
}

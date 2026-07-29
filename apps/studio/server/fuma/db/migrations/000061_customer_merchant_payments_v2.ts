import type { HostedMigration } from '../migrationPolicy'

/** Conductor-finalized additive FUMA-058 customer merchant-payment authority. */
export const customerMerchantPaymentsV2Migration: HostedMigration = {
  id: '000061_customer_merchant_payments_v2',
  description: 'Candidate durable isolated customer merchant payments authority',
  sql: `
do $$
declare legacy_rows boolean := false;
begin
  if to_regclass('fuma_customer_merchant_accounts') is not null then
    execute 'select exists(select 1 from fuma_customer_merchant_accounts) or exists(select 1 from fuma_publication_memberships) or exists(select 1 from fuma_customer_payments)'
      into legacy_rows;
  end if;
  if legacy_rows then
    raise exception 'FUMA-058 v2 requires an explicit reviewed legacy customer-payment conversion';
  end if;
end $$;

create table if not exists fuma_customer_merchant_credentials_v2 (
  credential_id text primary key,
  platform_id text not null,
  organization_id text not null,
  workspace_id text not null,
  site_id text not null,
  owner_key text not null,
  owner_generation bigint not null check (owner_generation > 0),
  version integer not null check (version > 0),
  envelope_json jsonb not null,
  state text not null check (state in ('active','rekey-required','detached')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, version)
);
create unique index if not exists fuma_customer_merchant_one_active_v2
  on fuma_customer_merchant_credentials_v2(platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation)
  where state = 'active';

create table if not exists fuma_customer_membership_purchases_v2 (
  purchase_id text primary key,
  platform_id text not null,
  organization_id text not null,
  workspace_id text not null,
  site_id text not null,
  owner_key text not null,
  owner_generation bigint not null check (owner_generation > 0),
  member_id text not null,
  credential_id text not null references fuma_customer_merchant_credentials_v2(credential_id) on delete restrict,
  credential_version integer not null check (credential_version > 0),
  renewal_confirmation_id text null,
  metadata_json jsonb not null,
  reference text null,
  authorization_url text null,
  state text not null check (state in ('prepared','initialized','settled','failed')),
  created_at timestamptz not null,
  settled_at timestamptz null,
  check ((reference is null and authorization_url is null and state = 'prepared') or
         (reference is not null and state in ('initialized','settled','failed')))
);
create unique index if not exists fuma_customer_purchase_reference_v2
  on fuma_customer_membership_purchases_v2(credential_id, reference) where reference is not null;
create unique index if not exists fuma_customer_mobile_confirmation_v2
  on fuma_customer_membership_purchases_v2(site_id, member_id, renewal_confirmation_id)
  where renewal_confirmation_id is not null;

create table if not exists fuma_publication_memberships_v2 (
  membership_id text primary key,
  platform_id text not null,
  organization_id text not null,
  workspace_id text not null,
  site_id text not null,
  owner_key text not null,
  owner_generation bigint not null check (owner_generation > 0),
  member_id text not null,
  tier_id text not null,
  access_from timestamptz not null,
  access_until timestamptz not null,
  grace_until timestamptz not null,
  renewal text not null check (renewal in ('supported-card-recurring','manual-mobile-money')),
  state text not null check (state in ('active','grace','expired')),
  provider_reference text not null,
  provider_transaction_id text not null,
  credential_id text not null references fuma_customer_merchant_credentials_v2(credential_id) on delete restrict,
  credential_version integer not null check (credential_version > 0),
  revision bigint not null check (revision > 0),
  updated_at timestamptz not null,
  unique (platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, member_id, tier_id)
);

create table if not exists fuma_customer_payment_transactions_v2 (
  transaction_id bigserial primary key,
  purchase_id text not null unique references fuma_customer_membership_purchases_v2(purchase_id) on delete restrict,
  membership_id text not null references fuma_publication_memberships_v2(membership_id) on delete restrict,
  credential_id text not null references fuma_customer_merchant_credentials_v2(credential_id) on delete restrict,
  provider_reference text not null,
  provider_transaction_id text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency = 'KES'),
  channel text not null check (channel in ('card','mobile_money')),
  mobile_provider text null check (mobile_provider in ('safaricom','airtel')),
  verified_at timestamptz not null,
  unique (credential_id, provider_transaction_id),
  unique (credential_id, provider_reference),
  check ((channel = 'mobile_money' and mobile_provider is not null) or
         (channel = 'card' and mobile_provider is null))
);

create table if not exists fuma_customer_card_authorizations_v2 (
  membership_id text primary key references fuma_publication_memberships_v2(membership_id) on delete restrict,
  credential_id text not null references fuma_customer_merchant_credentials_v2(credential_id) on delete restrict,
  credential_version integer not null check (credential_version > 0),
  envelope_json jsonb not null,
  source_metadata_json jsonb not null,
  customer_code text null,
  state text not null check (state in ('active','revoked','rekey-required')),
  updated_at timestamptz not null
);

create table if not exists fuma_customer_membership_reminders_v2 (
  reminder_id text primary key,
  membership_id text not null references fuma_publication_memberships_v2(membership_id) on delete restrict,
  period_access_until timestamptz not null,
  kind text not null check (kind in ('renewal-due','grace-started','expired')),
  due_at timestamptz not null,
  payload_json jsonb not null,
  created_at timestamptz not null,
  delivered_at timestamptz null,
  unique (membership_id, period_access_until, kind)
);

create table if not exists fuma_customer_credential_transfer_choices_v2 (
  transfer_id text primary key,
  site_id text not null,
  source_scope_json jsonb not null,
  destination_scope_json jsonb not null,
  choice text not null check (choice in ('rekey','detach')),
  credential_id text null references fuma_customer_merchant_credentials_v2(credential_id) on delete restrict,
  credential_version integer null check (credential_version is null or credential_version > 0),
  recorded_at timestamptz not null,
  applied_fence bigint null check (applied_fence is null or applied_fence > 0),
  apply_receipt_json jsonb null,
  compensated_fence bigint null check (compensated_fence is null or compensated_fence > 0),
  compensation_receipt_json jsonb null,
  check ((applied_fence is null and apply_receipt_json is null) or
         (applied_fence is not null and apply_receipt_json is not null)),
  check ((compensated_fence is null and compensation_receipt_json is null) or
         (compensated_fence is not null and compensation_receipt_json is not null))
);
`,
}

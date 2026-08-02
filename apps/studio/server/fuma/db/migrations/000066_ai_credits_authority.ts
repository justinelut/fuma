import type { HostedMigration } from '../migrationPolicy'

/** Conductor-finalized additive FUMA-064 AI credit and BYOK authority. */
export const aiCreditsAuthorityMigration: HostedMigration = Object.freeze({
  id: '000066_ai_credits_authority',
  description: 'Add fenced AI credit ledger reservations settlement and encrypted BYOK authority',
  sql: `
create table fuma_ai_credit_accounts_v2 (
  account_id text primary key, platform_id text not null, organization_id text not null,
  workspace_id text not null, site_id text not null, owner_key text not null,
  owner_generation bigint not null check (owner_generation > 0), balance_micros bigint not null default 0 check (balance_micros >= 0),
  reserved_micros bigint not null default 0 check (reserved_micros >= 0), spent_micros bigint not null default 0 check (spent_micros >= 0),
  budget_micros bigint not null check (budget_micros >= 0), version bigint not null check (version > 0), updated_at timestamptz not null
);
create unique index fuma_ai_credit_accounts_scope_v2 on fuma_ai_credit_accounts_v2(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation);
create table fuma_ai_credit_lots_v2 (
  lot_id text primary key, account_id text not null references fuma_ai_credit_accounts_v2(account_id) on delete restrict,
  kind text not null check (kind in ('grant','purchase')), amount_micros bigint not null check (amount_micros > 0),
  remaining_micros bigint not null check (remaining_micros >= 0 and remaining_micros <= amount_micros), expires_at timestamptz null,
  evidence_id text not null, idempotency_key text not null unique, created_at timestamptz not null
);
create table fuma_ai_byok_metadata_v2 (
  credential_id text primary key, platform_id text not null, organization_id text not null, workspace_id text not null, site_id text not null,
  owner_key text not null, owner_generation bigint not null check (owner_generation > 0), provider_id text not null,
  envelope_json jsonb not null, state text not null check (state in ('active','rekey-required','detached')),
  version bigint not null check (version > 0), idempotency_key text not null unique, created_at timestamptz not null, updated_at timestamptz not null
);
create table fuma_ai_credit_reservations_v2 (
  reservation_id text primary key, idempotency_key text not null unique, account_id text not null references fuma_ai_credit_accounts_v2(account_id) on delete restrict,
  scope_json jsonb not null, mode text not null check (mode in ('platform','byok')), byok_credential_id text null references fuma_ai_byok_metadata_v2(credential_id) on delete restrict,
  quote_json jsonb not null, reserved_micros bigint not null check (reserved_micros >= 0),
  state text not null check (state in ('reserved','settled','released','refunded','expired')), version bigint not null check (version > 0),
  expires_at timestamptz not null, created_at timestamptz not null, resolved_at timestamptz null
);
create index fuma_ai_credit_reservations_expiry_v2 on fuma_ai_credit_reservations_v2(expires_at) where state='reserved';
create table fuma_ai_credit_settlements_v2 (
  settlement_id text primary key, reservation_id text not null unique references fuma_ai_credit_reservations_v2(reservation_id) on delete restrict,
  idempotency_key text not null unique, input_tokens bigint not null check (input_tokens >= 0), output_tokens bigint not null check (output_tokens >= 0),
  provider_cost_micros bigint not null check (provider_cost_micros >= 0), markup_micros bigint not null check (markup_micros >= 0),
  charged_micros bigint not null check (charged_micros >= 0), refunded_micros bigint not null default 0 check (refunded_micros >= 0),
  quote_binding_sha256 text not null check (quote_binding_sha256 ~ '^[a-f0-9]{64}$'), created_at timestamptz not null
);
create table fuma_ai_byok_transfer_choices_v2 (
  transfer_id text primary key, credential_id text null, choice text not null check (choice in ('rekey','detach')),
  destination_scope_json jsonb not null, rekeyed_envelope_json jsonb null, source_credential_json jsonb null, applied_fence bigint null, apply_receipt_json jsonb null,
  compensated_fence bigint null, compensation_receipt_json jsonb null, recorded_at timestamptz not null
);
`,
})

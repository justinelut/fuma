import type { HostedMigration } from '../migrationPolicy'

export const paystackReconciliationMigration: HostedMigration = {
  id: '000045_paystack_reconciliation',
  description: 'Add exact Paystack initialization and durable reconciliation claims',
  sql: `
create table fuma_paystack_initializations (
  scope text not null check (scope in ('platform_billing', 'customer_merchant')),
  reference text not null check (reference ~ '^[A-Za-z0-9._-]{16,100}$'),
  purpose text not null check (purpose ~ '^[a-z][a-z0-9-]{2,63}$'),
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 9007199254740991),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  metadata_sha256 text not null check (metadata_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null,
  primary key (scope, reference)
);

create table fuma_paystack_reconciliations (
  scope text not null check (scope in ('platform_billing', 'customer_merchant')),
  reference text not null check (reference ~ '^[A-Za-z0-9._-]{16,100}$'),
  purpose text not null check (purpose ~ '^[a-z][a-z0-9-]{2,63}$'),
  provider_transaction_id text not null,
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 9007199254740991),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  metadata_sha256 text not null check (metadata_sha256 ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('pending', 'applying', 'settled')),
  claim_id text null,
  claim_expires_at timestamptz null,
  attempt_count integer not null check (attempt_count > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  reconciled_at timestamptz null,
  primary key (scope, reference, purpose),
  unique (scope, provider_transaction_id),
  foreign key (scope, reference) references fuma_paystack_initializations (scope, reference),
  check (
    (state = 'applying' and claim_id is not null and claim_expires_at is not null and reconciled_at is null)
    or (state = 'pending' and claim_id is null and claim_expires_at is null and reconciled_at is null)
    or (state = 'settled' and claim_id is null and claim_expires_at is null and reconciled_at is not null)
  )
);

create index fuma_paystack_reconciliations_pending_idx
  on fuma_paystack_reconciliations (scope, state, updated_at, reference);
`,
}

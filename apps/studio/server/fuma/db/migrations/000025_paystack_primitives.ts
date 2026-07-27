import type { HostedMigration } from '../migrationPolicy'
export const paystackPrimitivesMigration:HostedMigration={id:'000025_paystack_primitives',description:'Add scope-isolated Paystack events and settlement ledger',sql:`
create table fuma_paystack_events (scope text not null check(scope in ('platform_billing','customer_merchant')), event_id text not null, raw_sha256 text not null check(raw_sha256 ~ '^[a-f0-9]{64}$'), received_at timestamptz not null, reduced_at timestamptz null, primary key(scope,event_id));
create table fuma_paystack_settlements (scope text not null check(scope in ('platform_billing','customer_merchant')), reference text not null, purpose text not null, provider_transaction_id text not null, amount_minor bigint not null check(amount_minor>0), currency char(3) not null, settled_at timestamptz not null, primary key(scope,reference,purpose), unique(scope,provider_transaction_id));
`}

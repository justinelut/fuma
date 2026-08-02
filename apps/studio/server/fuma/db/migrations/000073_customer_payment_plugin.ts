import type { HostedMigration } from '../migrationPolicy'

export const customerPaymentPluginMigration: HostedMigration = Object.freeze({
  id: '000073_customer_payment_plugin',
  description: 'Add reviewed customer-payment plugin obligations, receipts, and refunds',
  sql: `
    create unique index fuma_artifact_installation_payment_binding_v2
      on fuma_artifact_installations_v2(
        platform_id,owner_key,owner_generation,installation_id,artifact_id,content_hash_sha256
      );

    create table fuma_customer_plugin_payments_v1 (
      payment_id text primary key,
      platform_id text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      owner_key text not null,
      owner_generation bigint not null check (owner_generation>0),
      installation_id text not null,
      artifact_id text not null,
      content_hash_sha256 text not null check (content_hash_sha256 ~ '^[a-f0-9]{64}$'),
      review_submission_id text not null,
      review_decision_id text not null,
      review_signature_key_id text not null,
      credential_id text not null references fuma_customer_merchant_credentials_v2(credential_id) on delete restrict,
      credential_version integer not null check (credential_version>0),
      purpose text not null check (purpose in ('deposit','donation','checkout')),
      amount_minor bigint not null check (amount_minor between 100 and 100000000),
      currency char(3) not null check (currency='KES'),
      payer_email_sha256 text not null check (payer_email_sha256 ~ '^[a-f0-9]{64}$'),
      metadata_json jsonb not null check (jsonb_typeof(metadata_json)='object'),
      reference text null,
      authorization_url text null,
      state text not null check (state in ('prepared','initialized','settled','refunded')),
      created_at timestamptz not null,
      settled_at timestamptz null,
      refunded_at timestamptz null,
      unique (credential_id,reference),
      foreign key (
        platform_id,owner_key,owner_generation,installation_id,artifact_id,content_hash_sha256
      ) references fuma_artifact_installations_v2(
        platform_id,owner_key,owner_generation,installation_id,artifact_id,content_hash_sha256
      ) on update cascade on delete restrict,
      check ((state='prepared' and reference is null and authorization_url is null and settled_at is null and refunded_at is null)
        or (state='initialized' and reference is not null and authorization_url is not null and settled_at is null and refunded_at is null)
        or (state='settled' and reference is not null and authorization_url is not null and settled_at is not null and refunded_at is null)
        or (state='refunded' and reference is not null and authorization_url is not null and settled_at is not null and refunded_at is not null))
    );

    create table fuma_customer_plugin_receipts_v1 (
      receipt_id text primary key,
      payment_id text not null unique references fuma_customer_plugin_payments_v1(payment_id) on delete restrict,
      provider_reference_sha256 text not null check (provider_reference_sha256 ~ '^[a-f0-9]{64}$'),
      provider_transaction_sha256 text not null unique check (provider_transaction_sha256 ~ '^[a-f0-9]{64}$'),
      receipt_json jsonb not null check (jsonb_typeof(receipt_json)='object'),
      settled_at timestamptz not null
    );

    create function fuma_customer_plugin_receipt_immutable_v1() returns trigger language plpgsql as $customer_plugin_receipt_immutable$
    begin raise exception 'Customer plugin payment receipts are append-only'; end;
    $customer_plugin_receipt_immutable$;
    create trigger fuma_customer_plugin_receipt_immutable_v1 before update or delete on fuma_customer_plugin_receipts_v1
      for each row execute function fuma_customer_plugin_receipt_immutable_v1();

    create table fuma_customer_plugin_refunds_v1 (
      refund_id text primary key,
      receipt_id text not null unique references fuma_customer_plugin_receipts_v1(receipt_id) on delete restrict,
      payment_id text not null references fuma_customer_plugin_payments_v1(payment_id) on delete restrict,
      request_id text not null,
      reason_sha256 text not null check (reason_sha256 ~ '^[a-f0-9]{64}$'),
      amount_minor bigint not null check (amount_minor between 100 and 100000000),
      currency char(3) not null check (currency='KES'),
      provider_refund_sha256 text null check (provider_refund_sha256 is null or provider_refund_sha256 ~ '^[a-f0-9]{64}$'),
      state text not null check (state in ('prepared','refunded')),
      record_json jsonb not null check (jsonb_typeof(record_json)='object'),
      created_at timestamptz not null,
      refunded_at timestamptz null,
      check ((state='prepared' and provider_refund_sha256 is null and refunded_at is null)
        or (state='refunded' and provider_refund_sha256 is not null and refunded_at is not null))
    );

    create index fuma_customer_plugin_payment_scope_v1 on fuma_customer_plugin_payments_v1
      (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,installation_id,state);
    create index fuma_customer_plugin_refund_state_v1 on fuma_customer_plugin_refunds_v1(state,created_at);
  `,
})

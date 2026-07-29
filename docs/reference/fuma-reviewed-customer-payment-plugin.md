# Reviewed customer-payment plugin (FUMA-069)

Status: **Closed.** The first-party `fuma.customer-payments@1.0.0` plugin is reviewed, exact-installed, and executable only through the existing QuickJS plugin sandbox and shared FUMA-058 customer-merchant authority.

## Package and grants

The source package is `packages/fuma-governance-launch/plugins/customer-payments`. Its strict manifest requests exactly:

```text
cms.routes
modules.register
payments.customer.create
payments.customer.refund
```

It declares no network hosts. The server entrypoint exposes authenticated `/checkout`, `/receipt`, and `/refund` plugin routes through `api.payments.customer`. Its module pack contributes the exact paid blocks `fuma.customer-payments.deposit`, `.donation`, and `.checkout`; module rendering remains inside the QuickJS module-pack VM and escapes authored labels.

The SDK and worker protocol use strict TypeBox contracts. `payments.customer.create` authorizes initialization and receipt reconciliation; `payments.customer.refund` separately authorizes full refunds. The accepted RPC targets are:

```text
payments.customer.create
payments.customer.receipt
payments.customer.refund
```

Payloads cannot select platform, organization, workspace, site, owner key/generation, artifact, installation, review, or credential. Those values are derived out of band by the host binding.

## Shared authority boundary

`CustomerMerchantPluginPaymentService` extends the established hosted customer-payment composition. The three plugin purpose adapters (`fuma-plugin-deposit`, `fuma-plugin-donation`, and `fuma-plugin-checkout`) reuse the existing customer-merchant credential repository and cipher, `CustomerMerchantTransportFactory`, `ScopedPaystackTransport`, `PaystackPurposeRegistry`, ledger, webhook verification, and duplicate-event reduction. The plugin and generic host own none of those authorities and receive no provider keys, encrypted credential envelopes, raw webhook bodies/signatures, provider transaction IDs, or ledger access.

`ReviewedCustomerPaymentPluginBinding` revalidates every call against the current approved FUMA-068 signature and revocation state, exact artifact bytes/version/package, exact reviewed grants, active FUMA-067 installation, null artifact secret, owner generation, and exact HTTPS site origin. Unload and release replacement remove the binding. A retained crash-recovery binding is safe because every operation repeats live review/install checks. Transfer and owner-generation drift therefore invalidate stale authority; credential transfer remains inherited from FUMA-058.

Refund execution is an injected `CustomerMerchantRefundTransportFactory` owned by the customer-payment composition. Missing provider refund support fails closed. Exact refund replays return the immutable completed result; a changed request ID or reason is a conflict and cannot trigger another provider refund.

## Durable records

Additive migration `000073_customer_payment_plugin` persists exact artifact/install/review-qualified obligations, append-only settlement receipts, and replay-safe full refunds:

```text
fuma_customer_plugin_payments_v1
fuma_customer_plugin_receipts_v1
fuma_customer_plugin_refunds_v1
```

Its immutable SHA-256 is `393a785bfed74ef9e6f3545d8fb65ec7a76c6351573874c9d09650b825d6f9a6`. The receipt trigger rejects update and delete. PostgreSQL advisory serialization and uniqueness constraints converge concurrent obligation, settlement, and refund contenders. Public receipts expose only SHA-256 fingerprints for provider references/transactions; refund output exposes only the provider refund fingerprint.

## Acceptance evidence

- Real package bytes pass the FUMA-068 scanners, ephemeral-test Ed25519 review/signature verification, exact FUMA-067 install, Bun worker, QuickJS plugin VM, host dispatch, and module-pack VM.
- The deterministic demo initializes and settles deposit, donation, and checkout through one shared ledger, completes one full refund, deduplicates a webhook, and proves secret/ciphertext redaction.
- Negative acceptance rejects payload scope injection at RPC parsing, missing grants inside QuickJS, revoked review, non-HTTPS host binding, and conflicting refund replay.
- Native PostgreSQL 16 contention acceptance proves `8` concurrent prepares/settlements/refunds converge to `1/1/1`, receipts are append-only, foreign scope is denied, and cleanup leaves zero matching schemas and roles.
- Hosted migration audit is `73/73` declared/runnable with no sentinel; the next canonical ID is `000074_release_followup`.

No live provider call, charge, refund, production migration, deployment, protected signing/scanning, or traffic mutation was performed. The review signature used only an ephemeral test key.

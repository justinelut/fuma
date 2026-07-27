# Fuma platform webhook reconciliation

FUMA-056 consumes only the `platform_billing` Paystack route. The shared webhook boundary retains its fixed public path, 1 MiB body ceiling, non-oracular `202` response, and exact credential-scoped transport. The platform handler delegates the original raw bytes and signature to `ScopedPaystackTransport.ingestWebhook` before any local JSON parse. Customer-merchant deliveries continue through their separate transport and ledger.

## Durable event authority

Signed events are reduced to bounded metadata in `fuma_billing_events`: event identity, provider order, type, exact reference when present, receive time, and SHA-256 of the signed bytes. Raw webhook JSON, customer codes, authorization codes, payer identity, provider credentials, and transfer state are not persisted in the event ledger. Unknown or reference-free events remain durable as `unknown` and cannot activate contracts.

Reduction uses one globally ordered PostgreSQL head, row locking, a leased claim, attempt count, and safe error code. A live claim blocks later events rather than skipping ahead. Expired claims are recoverable. Each accepted known event creates an idempotent `fuma.billing-reconcile` durable-job trigger under protected platform organization authority; startup recovery re-enqueues stored events. Redis is only a ready notification—the PostgreSQL event and job rows remain authoritative.

Subscription create, non-renewal, and disable events update a monotonic reference-bound reduction only when the `(provider_sequence, event_id)` tuple advances. Stale reordered events are retained/reduced without rolling state backward, and equal provider sequences use the same event-ID tie break as the global reducer.

## Exact payment settlement

A `charge.success` event never settles from labels alone. Reconciliation loads exactly one local checkout obligation and reconstructs its strict FUMA-055 metadata. `ScopedPaystackTransport.verify` must confirm the initialized reference, platform purpose, scope, metadata hash, integer amount, KES currency, provider success, and allowed channel. A provider transaction ID is immutable and unique across obligations.

Setup and recurring obligations settle independently. Partial settlement records evidence but creates no organization contract or handoff. Once any obligation is settled, a database trigger denies cancellation through the older checkout path. When every exact checkout obligation is settled in one PostgreSQL transaction:

- a public-plan checkout creates one `active` organization contract and no transfer handoff;
- a private-offer checkout updates its exact FUMA-054 candidate to `paid-transfer-pending`, creates one organization contract, and inserts one pending `fuma_paid_handoff_outbox` command;
- current organization/workspace/site/profile authority is revalidated;
- duplicate and reordered deliveries converge through unique checkout, contract, transaction, and outbox identities.

The handoff outbox does not mutate site ownership. FUMA-074 remains the sole transfer authority. A later transfer failure therefore leaves verified payment, settled obligations, the activated contract, and the same pending handoff identity available for retry.

## Migration ownership

The worker exports an additive migration candidate. The conductor assigns its final hosted ID and checksum only after native PostgreSQL acceptance. Historical migrations `000027_checkout`, `000028_billing_reconciliation`, and finalized FUMA-055 migration `000058_platform_checkout_authority` remain immutable.

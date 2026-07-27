# Fuma entitlement enforcement and self-service

FUMA-057 turns immutable FUMA-054/FUMA-056 entitlement evidence into the one hosted write-admission authority. It does not delete, hide, or rewrite customer content when an allowance is exhausted, downgraded, expired, past due, or cancelled.

## Activation authority

Quota state is synchronized only from one of these sources:

1. the sole protected `platform-internal` grant for `fuma-platform`;
2. an `active` or `paid-transfer-pending` organization contract produced by verified platform settlement, resolved back to its exact immutable public price book or accepted private offer;
3. an active grandfathered entitlement assignment and immutable snapshot.

Checkout labels, authorization URLs, awaiting-payment candidates, request payload coordinates, provider metadata, and meter values cannot activate quota state. Verified public/private contracts are materialized into immutable entitlement snapshots before quota binding. Source identity and quota evidence are then copied into append-only quota entitlement snapshots.

## Final migration and hosted composition

The conductor-finalized additive migration is `000060_quota_self_service`; its canonical source and registry checksum is `af8a6667a5a2bc2275e2c48f07679a8547193c0a1d9bacf5f1424be523c429e7`. The ticket-local migration bridge re-exports this finalized migration, the hosted manifest ends at `000060`, and the next available ID is `000061`.

The hosted API constructs one `createQuotaRuntime({ db })`, mounts its scoped routes at the trusted hosted boundary, and injects its campaign authority into the publication API graph. Durable worker composition independently constructs the same PostgreSQL-backed authority, injects campaign enforcement into worker publication, and registers `fuma.billing-dunning` plus `fuma.quota-usage-collection` exactly once. Both jobs require protected organization-job context; continuous collection additionally requires platform organization authority, null repository scope, and no site authority.

## Quota vocabulary, forecast, and trusted collection

The authority covers all 14 explicit classes:

- sites, pages, CMS items, members;
- storage and bandwidth bytes;
- email recipients per day and per month;
- build/publish and plugin-compute minutes;
- AI credits and release-retention bytes;
- collaborators and custom domains.

`POST /quotas/forecast` accepts only strict TypeBox setup/import workload assumptions and collaborators. Organization authority comes from the trusted scoped route context, never from a client-supplied organization coordinate. `QuotaUsageCollector` maps FUMA-052 logical workload measurements into the complete vocabulary and rounds measured compute milliseconds upward to minutes.

`PostgresQuotaUsageAuthority` continuously enumerates only protected grants, verified active or paid-transfer-pending contracts, and active grandfathered evidence. It derives current sites, publication pages/CMS items, publication members, and `auth_members` collaborators from canonical tables; current gauge classes from latest immutable meter evidence; monthly consumptive classes from the current UTC month; and daily email recipients from the current UTC day. It emits a complete deterministic 14-class observation and writes it idempotently. Meter evidence determines usage only and remains independent of entitlement activation.

Continuous observations require a full strict TypeBox envelope, are immutable and idempotent, and can lower current-count usage after deletion. Day and monthly classes use explicit UTC window keys; current-count classes use the persistent current window. Durable replay keys are versioned as `fuma.quota-usage-collection:v1:<observedAt>`.

## Admission and notices

`PostgresQuotaRepository` serializes every organization with a transaction advisory lock. A reservation can contain multiple distinct classes, and capacity is checked for every item before any reservation or balance row is written. This makes campaign day/month admission atomic and prevents concurrent oversubscription.

Reservations have immutable idempotency identity and exact child items. Settlement reconciles every item once and denies actual use above the reservation. Release is exact and idempotent. Notice evidence is deduplicated at 50, 75, 90, and 100 percent for the entitlement snapshot, quota class, and window.

Approved active top-ups, overages, grants, promotions, and grace adjustments extend the effective limit only during their evidence window. Expired or revoked adjustments stop admitting new writes even if preserved actual usage is now above the contractual limit.

## Campaigns

`PublicationCampaignService` reserves both recipient windows before claiming a campaign for OCI submission. A successful campaign settles against recipients actually attempted; suppressed recipients are not charged. Failed batches retain the immutable reservation for durable retry, and cancellation releases it. Both scoped HTTP sends and `publication.newsletter-send` jobs pass through the same service hook, and the centralized campaign authority is composed in both API and worker publication roots.

## Dunning and recovery

`fuma.billing-dunning` runs only under the protected organization job context. Customer accounts transition `past-due -> grace -> cancelled` with append-only transition and deduplicated notice evidence. Grace lasts seven days. Cancelled accounts deny new quota writes while preserving read/export and self-service access. A verified payment against the current exact contract restores `current` and write admission. Internal grants never create dunning accounts.

## Self-service boundary

The trusted hosted route set is:

- `GET /quotas/self-service` for current limits, active adjustments, used/reserved/remaining quantities, threshold notices, and customer account data;
- `GET /quotas/self-service/export` for downloadable usage evidence;
- `POST /quotas/forecast` for trusted setup/import forecasting;
- `POST /quotas/top-up-requests` for audited customer requests;
- `POST /billing/cancellation` for customer cancellation intent.

Customer projections include contracts, invoices, transactions, receipts, account/grace state, audited adjustments, cancellation, and the existing checkout surface. `HostedStaffShell` mounts checkout only through the customer-only slot of `QuotaSelfServiceRouteContent`.

The server returns `billing: null` for the protected internal grant. The React entitlement gate renders usage but never mounts customer checkout for that response. No provider identity, dunning control, cancellation control, invoice data, grace UI, or shadow-cost field is present in the internal surface. Internal shadow cost remains admin-host-only work for FUMA-071.

## Preservation invariant

Every enforcement error sets `preserveExisting = true`. Quota and billing cancellation paths mutate only commercial control rows; they do not delete or change organization, workspace, site, release, publication, member, media, or export data. Reads and exports remain available after exhaustion, downgrade, adjustment expiry, grace expiry, or cancellation.

## Native acceptance and final validation

Native ARM64 PostgreSQL acceptance applied finalized `000060` in a disposable schema and passed **1 test, 33 assertions**. It proved verified customer/protected/grandfathered eligibility, canonical site/page/CMS/member/collaborator counts, storage/bandwidth/email day/month/build/plugin/AI/retention/domain meter mapping, a complete 14-class observation, concurrent hard-limit denial, notice thresholds, adjustment expiry, campaign settlement, dunning/cancellation/recovery, and protected billing/provider/shadow-cost redaction. Final cleanup found **0** `fuma_quota_%` schemas.

Additional evidence:

- focused FUMA-057/commercial/startup/UI/migration gate: **38 pass, 1 expected optional PostgreSQL skip, 0 fail, 344 assertions**;
- direct protected/customer UI gate: **3 pass, 0 fail, 22 assertions**;
- complete Studio architecture suite: **847 pass, 0 fail, 3,900 assertions**;
- authoritative aggregate: Studio/root **7,701 pass, 23 optional skips, 150,564 assertions**; Web **89/510**; Control **4/15**; Governance **56/343**; total **7,850 pass, 23 skips, 0 fail, 151,432 assertions**;
- both Studio typechecks, full repository lint, frozen install, and full workspace production build passed;
- root `bun.lock` remained byte-stable at SHA-256 `e9688c20f69e32aa0df7cea681b5c4971ef5a7d272d3e644bc96486384c4c1b9`, with only the approved tracked `vendor/pixel-art-icons/bun.lock` exception.

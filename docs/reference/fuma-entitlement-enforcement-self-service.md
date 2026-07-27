# Fuma entitlement enforcement and self-service

FUMA-057 turns immutable FUMA-054/FUMA-056 entitlement evidence into the one hosted write-admission authority. It does not delete, hide, or rewrite customer content when an allowance is exhausted, downgraded, expired, past due, or cancelled.

## Activation authority

Quota state is synchronized only from one of these sources:

1. the sole protected `platform-internal` grant for `fuma-platform`;
2. an `active` or `paid-transfer-pending` organization contract produced by verified platform settlement, resolved back to its exact immutable public price book or accepted private offer;
3. an active grandfathered entitlement assignment and immutable snapshot.

Checkout labels, authorization URLs, awaiting-payment candidates, request payload coordinates, and provider metadata cannot activate quota state. Verified public/private contracts are materialized into immutable entitlement snapshots before quota binding. Source identity and quota evidence are then copied into append-only quota entitlement snapshots.

## Quota vocabulary and collection

The authority covers all 14 explicit classes:

- sites, pages, CMS items, members;
- storage and bandwidth bytes;
- email recipients per day and per month;
- build/publish and plugin-compute minutes;
- AI credits and release-retention bytes;
- collaborators and custom domains.

`QuotaUsageCollector` maps trusted FUMA-052 logical workload measurements into the complete vocabulary for setup/import forecasts. Continuous observations require a full strict TypeBox envelope, are immutable and idempotent, and can lower current-count usage after deletion. Day and monthly classes use explicit UTC window keys; current-count classes use the persistent current window.

## Admission and notices

`PostgresQuotaRepository` serializes every organization with a transaction advisory lock. A reservation can contain multiple distinct classes, and capacity is checked for every item before any reservation or balance row is written. This makes campaign day/month admission atomic and prevents concurrent oversubscription.

Reservations have immutable idempotency identity and exact child items. Settlement reconciles every item once and denies actual use above the reservation. Release is exact and idempotent. Notice evidence is deduplicated at 50, 75, 90, and 100 percent for the entitlement snapshot, quota class, and window.

Approved active top-ups, overages, grants, promotions, and grace adjustments extend the effective limit only during their evidence window. Expired or revoked adjustments stop admitting new writes even if preserved actual usage is now above the contractual limit.

## Campaigns

`PublicationCampaignService` reserves both recipient windows before claiming a campaign for OCI submission. A successful campaign settles against recipients actually attempted; suppressed recipients are not charged. Failed batches retain the immutable reservation for durable retry, and cancellation releases it. Both scoped HTTP sends and `publication.newsletter-send` jobs pass through the same service hook.

## Dunning and recovery

`fuma.billing-dunning` runs only under the protected organization job context. Customer accounts transition `past-due -> grace -> cancelled` with append-only transition and deduplicated notice evidence. Grace lasts seven days. Cancelled accounts deny new quota writes while preserving read/export and self-service access. A verified payment against the current exact contract restores `current` and write admission. Internal grants never create dunning accounts.

## Self-service boundary

Scoped settings routes expose:

- current limits, active adjustments, used/reserved/remaining quantities, and threshold notices;
- a downloadable usage export;
- customer contracts, invoices, transactions, receipts, account/grace state, audited adjustments, cancellation intent, plan checkout, and top-up requests.

The server returns `billing: null` for the protected internal grant. The React gate renders usage only and never mounts customer checkout for that response. No provider identity, dunning control, cancellation control, invoice data, grace UI, or shadow-cost field is present in the internal surface. Internal shadow cost remains admin-host-only work for FUMA-071.

## Preservation invariant

Every enforcement error sets `preserveExisting = true`. Quota and billing cancellation paths mutate only commercial control rows; they do not delete or change organization, workspace, site, release, publication, member, media, or export data. Reads and exports remain available after exhaustion, downgrade, adjustment expiry, grace expiry, or cancellation.

## Native acceptance demo

The optional PostgreSQL test `quotaPostgresAcceptance.test.ts` applies the additive worker migration in a disposable schema and demonstrates:

1. verified public and protected internal activation;
2. concurrent hard-limit denial with 50/75/90/100 notice evidence;
3. an approved grant that restores capacity, then expires;
4. atomic campaign reservation and actual settlement;
5. grace, cancellation, preserved self-service data, verified-payment recovery;
6. complete internal usage with billing/provider/shadow-cost redaction.

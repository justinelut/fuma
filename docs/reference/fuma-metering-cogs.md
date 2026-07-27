# FUMA-052 resource metering and COGS reconciliation

Fuma records two immutable values for every workload: the customer-facing **logical** unit and the measured **physical** unit that drives capacity and COGS. Logical usage is never accepted without physical evidence. Physical amplification remains visible (for example, one logical publish can consume build time, weighted queue time, release bytes, variants, backups, and bandwidth). Internal workloads use the same physical path with `internalWorkload: true`; they have no customer revenue but retain an explicit internal shadow-cost subtotal.

## Meter and provider authority

`server/fuma/metering/contracts.ts` is the strict TypeBox authority. It defines 18 closed meters and maps every FUMA-052 workload class: sites, pages, CMS items, members, source/variant/release/local-backup/offsite storage, origin bandwidth, OCI email recipients and bytes, custom hostnames, build/publish and queue time, plugin compute, AI credits, and release retention.

Each meter has one explicit cost owner: Oracle for hosted storage/compute, OCI Email for newsletter delivery, Cloudflare for origin bandwidth/custom hostnames, or internal for control-plane/entity/AI/queue costs. `costBaseline.ts` provides complete versioned, nonzero, expiring planning assumptions across all four authorities. These values are launch assumptions in minor-USD micros, not provider invoice claims; stale, missing, zero, duplicated, or provider-substituted inputs fail closed. Refresh and version them before expiry.

## Atomic usage lifecycle

Reservations, settlements, releases, and adjustments are append-only. Attribution (`organizationId`, optional workspace/site, meter, internal flag), logical/physical units, cost version, and cost are immutable. PostgreSQL settlement/release locks the parent reservation, rechecks duplicate idempotency after that lock, sums prior consumption in the same transaction, and inserts only if both logical and physical remainder permit it. This prevents concurrent over-settlement and makes same-key replay return the winning immutable entry. A release consumes unused authority; it cannot make a reservation negative.

Trusted subsystem adapters use `MeteringCollector`, whose strict discriminated union expands each workload into meter entries. Callers cannot add tenant or provider fields outside that contract.

## Provider snapshots and reconciliation

Provider snapshots are append-only, unique by provider/period/meter, bound to the provider that owns the meter, observed no earlier than period close, and tied to a SHA-256 source reference. A period is incomplete until all 18 meter totals exist. Reconciliation:

1. loads immutable settlement/adjustment physical usage for the half-open period;
2. calculates variable tenant and internal shadow cost using the recorded catalog version;
3. requires provider totals to cover variable evidence plus the current fixed cost;
4. allocates fixed/shared/provider variance by deterministic physical weight;
5. places costs with no usage group under `fuma:unallocated`;
6. persists per-meter tenant, internal-shadow, unallocated, provider, and delta evidence;
7. requires `provider = tenant + unallocated` for a balanced result.

Allocation rows and reconciliation receipts use deterministic idempotency keys and immutable evidence hashes. Replaying the same period must match exactly.

## Durable job authority

`fuma.meter-reconcile` accepts only `{ periodStart, periodEnd }`. Provider totals and tenant evidence remain server-owned. The handler requires an organization-scoped claimed job for the protected platform organization, rejects site/repository authority and job-coordinate substitution, validates durable results through strict TypeBox before replay, records reconciliation evidence, and commits one durable result keyed by the exact period.

## Operations and evidence

Focused tests cover strict contracts, all workload mappings, amplification, internal shadow cost, fixed/shared and unallocated allocation, concurrent reservation consumption, durable replay/authority, migration controls, architecture boundaries, and a deterministic mixed demo. `meteringPostgresAcceptance.test.ts` is opt-in through `FUMA_TEST_POSTGRES_URL`; it creates an isolated schema, applies `000024` plus `000055`, exercises production repositories, and drops the schema in `finally`.

No provider network call, production migration, or billing mutation is performed by this module or its tests.

## Conductor steps

This ticket intentionally does not edit central composition or immutable migration manifests. The conductor must:

1. import and append `000055_metering_reconciliation_control` in the hosted migration registry after the current finalized prefix;
2. compute the SQL SHA-256 with `hostedMigrationChecksum`, add the checksum to the central immutable map, and finalize only after live PostgreSQL acceptance;
3. compose `createHostedMeteringRuntime` into the trusted worker graph and register its `fuma.meter-reconcile` handler through the existing scoped job boundary;
4. seed the complete `HOSTED_COST_BASELINE_V1` inputs idempotently (or newer approved versions) before enabling collection/reconciliation;
5. connect trusted storage, publish, edge, email, hostname, plugin, AI, entity-count, and retention producers to `MeteringCollector` without caller-owned tenant coordinates;
6. schedule one protected-organization reconciliation per closed provider period and ingest exact Oracle/OCI/Cloudflare/internal snapshots before enqueue;
7. run the focused test files, node/app typechecks, architecture/module-size gates, scoped lint, and opt-in PostgreSQL acceptance before tracker closure.

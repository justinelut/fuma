# FUMA-060 Cloudflare for SaaS hostnames

FUMA-060 owns the concrete Cloudflare-for-SaaS adapter and reconciliation authority built on FUMA-059 domain contracts. Fuma operates the platform Cloudflare account and least-privileged token. A normal customer keeps its registrar and authoritative DNS, receives exact records, and needs neither a Cloudflare account nor a Cloudflare token. Customer-facing prevalidation evidence therefore states `customerAccountRequired: false`, `customerTokenRequired: false`, and `authoritativeDnsRetainedByCustomer: true`.

## CNAME-first customer onboarding

The default launch path is a `www` or other subdomain. For `www.customer.example`, prevalidation creates the provider custom hostname through the injected platform transport and returns:

1. a routing `CNAME` from `www.customer.example` to `customers.trimly.co.ke`;
2. Cloudflare's exact ownership `TXT` record;
3. Cloudflare's exact certificate-validation `TXT` record.

Provider-supplied records are strictly validated, normalized to canonical lowercase hostnames, deduplicated only when their values agree, and persisted as public instructions. No authorization header, token, platform credential reference, provider error body, or secret-shaped field enters the binding or route response. The production adapter accepts an injected `CloudflareHttpClient`; constructors, tests, and fakes perform no live calls.

## Reconciliation lifecycle

The durable binding lifecycle is `prevalidating`/`awaiting-dns`/`awaiting-tls`/`ready`/`active`, with explicit `failed`, `rolling-back`, `detached`, `deleting`, and `deleted` recovery states. Domain desired, observed, and certificate transitions remain delegated to the exact FUMA-059 domain scope.

- **Prevalidation** creates or reads one idempotent provider hostname, stores exact records, and moves the domain to validation.
- **Polling and events** map ownership, provider, and TLS observations into the binding. Monotonic decimal event sequences discard duplicates and stale events. Provider IDs and hostnames must match the scoped binding.
- **Cutover** is explicit. It fails until ownership, provider status, and TLS are all active. Public routing is allowed only when desired routing, observed routing, and certificate state are all active.
- **Diagnostics** compare exact observed records with the generated instructions and report missing routing, ownership, and TLS validation records plus provider/TLS health.
- **Rollback** first persists `rolling-back`, transitions the domain to detached/revoked, purges the hostname, then persists `detached`. A partial purge failure is safely resumable.
- **Deletion** first persists `deleting`, removes the provider hostname, transitions the domain to deleted/revoked, purges, and finally persists `deleted`. Provider and purge retries retain stable idempotency identities.

Every durable operation has a scoped operation ID, SHA-256 evidence, optimistic version, and reconcile fence. Exact retries converge; changed evidence, stale fences, crossed tenant authority, foreign events, and ambiguous repository results fail closed. Operation receipts and metering receipts are append-only in the candidate PostgreSQL authority.

## Routes and reconciliation job

`routes.ts` declares, but does not centrally mount, scoped read, prevalidate, reconcile, cutover, rollback, diagnose, and delete endpoints. Reads require `site.settings.read`; mutations require `site.settings.write`. Responses are strict JSON with `cache-control: no-store`; unknown errors and provider failures are redacted.

`jobHandlers.ts` declares `fuma.cloudflare-reconcile`. Its payload contains only `domainId` and retry identity. Platform, organization, workspace, site, owner generation, and profile are derived from trusted claimed site-job context, never payload fields. Durable replay validates the complete resulting authority before returning evidence.

A customer domain settings UI consumes these declarations to display exact records, provider/TLS state, diagnostics, supported actions, and apex alternatives. It must never render credential inputs for the customer-DNS launch path or activate a route before the active-state guard passes.

## Hostname metering and baseline

The official planning baseline is dated **2026-07-23**: Free/Pro/Business include 100 custom hostnames, PAYG has a finite **50,000** hostname maximum, and each additional hostname costs **US$0.10**. `CloudflareHostnameMeteringReconciler` compares active provider authority with the custom-hostname usage ledger and writes one immutable reconciliation receipt containing observed count, ledger count, delta, and calculated baseline cost. Counts outside the finite provider maximum fail closed. Actual provider invoices and approved quotes supersede planning assumptions.

## Apex and Enterprise policy

Fuma makes no universal apex or BYOIP promise. Capability detection offers CNAME-first `www`, provider-supported ALIAS, ANAME, CNAME flattening, or registrar redirect alternatives. Managed apex support remains blocked unless all four gates are true: Enterprise capability, an **actual quote**, approved **security/cost review**, and an approved **margin gate**. Missing any gate returns the alternatives and quote requirements rather than attempting provider mutation.

## Finalized persistence and Conductor integration

Hosted migration `000064_cloudflare_hostname_authority_v2` is centrally registered with checksum `7c7618b311d6034f9e30da6c45627de1420e8abfcb76108f408a4bafbf577271`. It adds current binding authority, immutable operation evidence, and immutable hostname-meter reconciliation. Native PostgreSQL 16 accepted the dependency-safe `000062` → `000064` chain without provider or DNS/TLS mutation.

The conductor-owned commercial-edge manifest exports `PostgresCloudflareStateRepository`, `CloudflareForSaasApiAdapter`, the FUMA-059 `DomainServiceCloudflareTransitionPort`, scoped route declarations, and `fuma.cloudflare-reconcile`. Provider credentials remain protected platform inputs; no customer credential enters a route, response, job payload, log, or UI declaration. Public custom-host routing remains guarded by active ownership and TLS state with no fallback/default tenant.

Actual provider mounting, authenticated event ingress, and scheduled polling require deployment-specific protected credential and network composition. They were intentionally not executed during repository acceptance. Apex/BYOIP stays disabled until Enterprise capability, an actual Cloudflare quote, security/cost approval, and margin approval are recorded.

Focused unit, security, fault, concurrency, demo, and architecture acceptance passed **23 tests, 113 assertions, 0 failures** using injected deterministic fakes only. No provider request was made.

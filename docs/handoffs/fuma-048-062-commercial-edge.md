# FUMA-048–062 commercial edge central integration handoff

This coding phase is authored in isolated FUMA domain modules. It intentionally did not edit shared startup/router composition, the hosted migration index, global job catalogs, Studio navigation, public-Web routing, root scripts, deployment manifests, or documentation catalogs. The primary integrator owns those hotspots after reconciling the Publication and Public Web handoffs.

## Authored ticket boundaries

| Ticket | Production authority | Durable schema |
|---|---|---|
| FUMA-048 | `server/fuma/releases/` | `000011_releases.ts` (already finalized before this phase) |
| FUMA-049 | `server/fuma/publishing/workerPublisher.ts` | `000021_publishing.ts` |
| FUMA-050 | `server/fuma/freeHosts/service.ts` | `000022_free_hosts.ts` |
| FUMA-051 | `server/fuma/edgeDelivery/service.ts` | `000023_edge_delivery.ts` |
| FUMA-052 | `server/fuma/metering/service.ts` | `000024_metering.ts` |
| FUMA-053 | `server/fuma/paystack/transport.ts` | `000025_paystack_primitives.ts` |
| FUMA-054 | `server/fuma/entitlements/service.ts` | `000026_entitlements.ts` |
| FUMA-055 | `server/fuma/checkout/service.ts` | `000027_checkout.ts` |
| FUMA-056 | `server/fuma/billing/reconciler.ts` | `000028_billing_reconciliation.ts` |
| FUMA-057 | `server/fuma/quotas/service.ts` | `000029_quota_enforcement.ts` |
| FUMA-058 | `server/fuma/customerPayments/service.ts` | `000030_customer_payments.ts` |
| FUMA-059 | `server/fuma/domains/service.ts`, `domains/credentialCipher.ts` | `000031_domains.ts` |
| FUMA-060 | `server/fuma/cloudflare/reconciler.ts` | `000032_cloudflare_saas.ts` |
| FUMA-061 | `server/fuma/registrar/service.ts` | `000033_registrar.ts` |
| FUMA-062 | `server/fuma/domainOperations/service.ts` | `000034_domain_operations.ts` |

`server/fuma/commercialEdgePhase/composition.ts` is the isolated descriptor/barrel. `migrations.ts` owns the ordered migration list and authored checksums. `providerFakes.ts` owns deterministic Paystack, registrar purchase/renewal, DNS, and scoped domain-cipher fakes; the Cloudflare fake remains beside its adapter contract.

The FUMA-049 retry seam is deliberately exact: queue/build replay accepts only the same snapshot and job fence; finalization replay accepts only the same validated immutable manifest; a durable manifest is revalidated and matched to release, owner, site, and snapshot before activation. This closes the crash interval between release finalization and durable-result recording without allowing identity replacement.

FUMA-061 purchase and renewal both require a fresh exact KES quote, entitlement, step-up, idempotent provider operation, lookup after an ambiguous timeout, and one repository receipt. Renewal is bound to registration hostname, quote version, prior expiry, amount, currency, and period.

## Tests and architecture evidence authored

- `src/__tests__/fuma/commercialEdge.unit.test.ts`
- `src/__tests__/fuma/commercialEdge.integration.test.ts`
- `src/__tests__/fuma/commercialEdge.acceptance.test.ts`
- `src/__tests__/fuma/commercialEdge.security.test.ts`
- `src/__tests__/fuma/commercialEdge.concurrency.test.ts`
- `src/__tests__/fuma/commercialEdge.fault.test.ts`
- `src/__tests__/fuma/commercialEdge.demo.test.ts`
- `src/__tests__/fuma/releaseService.test.ts` (exact retry coverage)
- `src/__tests__/architecture/fuma-commercial-edge.test.ts`
- `tests/e2e/fuma-commercial-edge.e2e.ts`

Browser acceptance is authored only against the mandatory public endpoints `https://5174.blyss.co.ke` and `https://3002.blyss.co.ke`. It is not acceptance evidence until the primary integrator mounts the surfaces and executes it.

## Required central integrations

### 1. Hosted migration stream

In `server/fuma/db/migrations/index.ts`, first apply the existing FUMA-028–047 handoff for `000013`–`000020`, then import and append `000021`–`000034` in numeric order. Copy checksum values from `server/fuma/commercialEdgePhase/migrations.ts`; do not infer, reorder, or rewrite historical migrations. The final sequence must be one contiguous hosted PostgreSQL stream through `000034_domain_operations`. Do not add SQLite mirrors.

### 2. Durable jobs

Register the capability-owned kinds from `COMMERCIAL_EDGE_JOB_KINDS` through the existing FUMA-009 worker/scheduler registry, never a profile switch:

- `fuma.publish-release`
- `fuma.edge-purge`, `fuma.edge-warm`, `fuma.edge-rollback`
- `fuma.meter-reconcile`
- `fuma.billing-reconcile`, `fuma.billing-dunning`
- `fuma.cloudflare-reconcile`
- `fuma.registrar-purchase`, `fuma.registrar-renew`
- `fuma.domain-transfer`

Each handler must derive exact authority from the committed job record, retain the FUMA-009 claim fence, and use durable effect/idempotency keys. `publishWorkerRegistration(...)` provides the FUMA-049 handler seam. Do not place tenant coordinates, credentials, provider references, or auth codes in ready-queue payloads.

### 3. Production repositories and provider composition

Bind the authored service ports to PostgreSQL repositories over the new tables. Repository lookup and mutation must repeat exact organization/workspace/site/owner authority where the domain owns those coordinates; never use the memory repositories outside tests. Preserve row locking/idempotency for quota admission, payment reduction, checkout, billing handoff, registrar operations, and domain transfer fences.

Construct four disjoint credential authorities:

- `platform_billing` Paystack transport for Instatic setup/recurring obligations;
- `customer_merchant` Paystack transport for Publication membership revenue;
- `fuma-platform` domain/provider automation;
- exact-organization `customer-automation` envelopes.

Provider origins and credentials are required configuration. There is no default provider host, no credential fallback, and no scope inference. Do not mount a fake if configuration is absent; leave the capability unavailable and fail closed.

### 4. Hosted/public HTTP boundaries

Mount thin handlers through the existing hosted scoped boundary and public host authority. Required behavior:

- free/custom host lookup resolves one exact host and exact tenant coordinate; unknown, malformed, reserved, suspended, or inactive-release hosts return 404/421 with no default tenant;
- edge delivery receives server-derived host/site/release/member/access authority, not caller tenant fields;
- Paystack webhook handlers retain raw bytes, select an explicit credential scope before verification, verify HMAC-SHA512 before JSON parsing, store unknown signed events, and return non-oracular envelopes;
- callbacks never settle a transaction from labels/query state; enqueue exact reconciliation;
- domain/provider endpoints project DNS records and redacted state only, never ciphertext, auth codes, credentials, provider customer IDs, costs, margins, private offers, internal grants, or transfer state.

The public Web edge probe expected by the authored E2E is `GET /__fuma/edge-probe`; it must use the incoming public host authority and must not contain a fallback site.

### 5. Transfer registry

Append the two ordered contributions from `COMMERCIAL_EDGE_TRANSFER_STEPS` to the existing FUMA-023/024 transfer registry:

1. `customer-merchant-credentials` at order 610, requiring explicit `rekey` or `detach`;
2. `domain-outcome` at order 620, requiring `retain-with-source`, `move-with-site`, or `detach-and-manual`.

Both steps revalidate current owner/fence before apply, persist receipts, and implement resume/compensation. Customer authoritative DNS remains with the customer unless the explicit domain outcome says otherwise. Never silently move provider credentials or registrar auth-code state.

### 6. Studio surfaces

Compose capability/permission-owned routes, not profile-ID branches:

- `/admin/settings/usage`: pooled usage, reservations, quota notices, top-ups, and export-preserving exhaustion state;
- `/admin/settings/billing`: public/private contract, separate setup and recurring obligations, receipts, dunning/grace/cancellation;
- `/admin/settings/domains` and `/admin/settings/domains/new`: desired/observed/TLS status, exact CNAME/TXT instructions, diagnostics, registrar quotes, transfers, and customer-DNS ownership language;
- `/admin/publication/payments`: customer-merchant membership tiers, supported-card recurrence capability, Safaricom/Airtel prepaid manual renewal, grace/expiry, rekey/detach.

Internal users must not receive billing, provider, invoice, dunning, or shadow-cost UI. Do not display Daraja as available. Never render ciphertext, credential inputs for customer-DNS Cloudflare SaaS, provider IDs, margin/COGS, private offers, or transfer secrets.

### 7. Edge and release activation

Keep FUMA-048 lifecycle authority separate from FUMA-049 rendering/object writes. The publish worker may activate only after exact manifest finalization and durable evidence. Edge pointer rollback must compare the expected active release atomically, purge only the exact host/site/release namespace, and retain old immutable releases according to retention roots. Member holes are private/member-keyed; request holes are no-store; immutable public assets alone receive one-year immutable caching.

### 8. Documentation catalogs

After hotspot conflict resolution:

- link `docs/reference/fuma-commercial-edge.md` from `docs/README.md`;
- add `fuma-commercial-edge.test.ts` and its FUMA-048–062 guarantees to `docs/reference/architecture-tests.md`;
- reconcile the commercial E2E into the authoritative E2E feature matrix;
- retain `docs/reference/fuma-immutable-releases.md` as the FUMA-048 source of truth.

## Files intentionally not edited

- `apps/studio/server/fuma/db/migrations/index.ts`;
- central hosted router/startup and job registry;
- root package scripts and lockfile;
- Studio global navigation/router/shared settings shell;
- Public Web global routing/deployment composition;
- `docs/README.md` and `docs/reference/architecture-tests.md`.

## Validation ownership

Per the coding-only instruction, this phase ran no test, typecheck, build, lint, Playwright, Docker, migration checksum, or other validation command. No runtime/browser acceptance is claimed. The primary integrator must run focused phase tests, migration checksum policy, architecture gates, aggregate Studio/Web checks, and Blyss-host Playwright only after completing the central registrations above.

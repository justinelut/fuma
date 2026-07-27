# Fuma commercial edge phase (FUMA-048–062)

This phase builds on the immutable release authority documented in `fuma-immutable-releases.md`. Its isolated composition root is `server/fuma/commercialEdgePhase/composition.ts`; central mounting is intentionally deferred to the primary integration handoff.

## Ticket inventory and demo scenarios
- **048 Immutable releases:** existing `releases/` contracts, manifest verification, exact owner/generation repository, active pointer and retention roots; demo rejects mutation and foreign activation.
- **049 Worker publish:** `publishing/workerPublisher.ts` claims an exact immutable snapshot, renders semantic artifacts, writes release-local content hashes, finalizes, and activates only at the last boundary. Fault/retry demo leaves the old pointer active and reuses durable manifest evidence.
- **050 Free hosts:** [`freeHosts/`](fuma-free-hosts.md) durably allocates normalized, IDN-safe, reserved-safe `<tenant>.fuma.co.ke`; the production Host boundary resolves exact active immutable releases, and the deterministic demo serves two exact hosts with no fallback.
- **051 Edge:** `edgeDelivery/service.ts` keys by host/site/release/path/access, isolates member holes, emits ETags, bounded HTML policy, immutable asset policy, targeted purge/warm and pointer rollback.
- **052 Metering/COGS:** [`metering/service.ts`](../../apps/studio/server/fuma/metering/service.ts) records logical+physical reservation/settlement, immutable attribution, amplification classes, internal shadow cost, provider reconciliation and fail-closed stale/missing cost inputs. See [resource metering and COGS reconciliation](fuma-metering-cogs.md).
- **053 Paystack primitives:** `paystack/transport.ts` requires explicit scope, verifies raw HMAC-SHA512 before parse, exact server-side amount/currency/reference, registered purposes, isolated idempotent ledgers and redacted summaries.
- **054 Plans/entitlements:** `entitlements/service.ts` requires finite quotas, KES monthly/annual price books, one non-transferable internal grant, complete costs, >=70% margin, exact immutable offers and awaiting-payment candidates. Acceptance does not activate or hand off.
- **055 Checkout:** `checkout/service.ts` separates setup from recurring consideration, binds destination/version, deduplicates clicks and denies internal grants/provider paths.
- **056 Reconciliation:** `billing/reconciler.ts` stores unknown/signed events, verifies exact obligations, activates only after all obligations settle, enters `paid-transfer-pending`, and emits one handoff without changing ownership.
- **057 Quotas/self-service:** `quotas/service.ts` serializes admission and campaign reservations, emits 50/75/90/100 notices, preserves existing data, and removes billing/provider/shadow-cost UI for internal users.
- **058 Paid Publication:** `customerPayments/service.ts` settles only through customer merchant scope; card recurrence is capability-bound, Safaricom/Airtel are prepaid manual renewal, grace/expiry and rekey/detach are explicit, Daraja is rejected.
- **059 Domain authority:** `domains/service.ts` defines normalized desired/observed/TLS invariants, immutable transition evidence, metering, and AES-256-GCM envelope ownership; plaintext is never persisted or projected.
- **060 Cloudflare SaaS:** `cloudflare/reconciler.ts` returns exact customer DNS records without requiring an account/token, prevalidates, cuts over only with active TLS, rolls back/purges and blocks universal apex unless all Enterprise quote/security/cost/margin gates pass.
- **061 Registrar:** `registrar/service.ts` uses expiring exact KES quotes, fresh step-up, contacts, idempotent purchase/renew, reconciliation after ambiguous timeout and one receipt.
- **062 Customer DNS/transfers:** `domainOperations/service.ts` diagnoses exact records, keeps authoritative DNS with customers, fences encrypted auth-code transfer state, resumes/rolls back safely and records an explicit site-transfer domain outcome.

## Security and economics invariants
No provider scope is inferred. Public projections never contain private offers, Paystack/provider IDs, margin/COGS, internal grants, payment state, transfer state, ciphertext, credentials, or auth codes. Unknown hosts, purposes, costs, channels, records and provider states fail closed. Internal work is quota-controlled and physically metered even though revenue is zero.

## Migrations
Forward-only migrations `000021`–`000034` and exact SHA-256 values live in `commercialEdgePhase/migrations.ts`. They follow concurrent Publication migrations `000013`–`000020`; see the handoff before central registration.

## Code and evidence map

The isolated production composition is `apps/studio/server/fuma/commercialEdgePhase/composition.ts`. It exports the ticket services without mounting global routes, and declares the job kinds, payment-purpose scopes, transfer contributions, and no-default-host policy consumed by central composition. Provider doubles live in `commercialEdgePhase/providerFakes.ts`; the Cloudflare SaaS fake lives beside `cloudflare/reconciler.ts` so it implements the same adapter contract.

Forward-only hosted schemas are `server/fuma/db/migrations/000021_publishing.ts` through `000034_domain_operations.ts`. Their ordered list and authored checksums are in `commercialEdgePhase/migrations.ts`. The migration stream is intentionally not registered in the shared index by this phase; follow `docs/handoffs/fuma-048-062-commercial-edge.md` after reconciling the earlier Publication migration handoff.

Focused evidence is split across unit, integration, acceptance-inventory, security, concurrency, fault, deterministic-demo, architecture, and Blyss-host Playwright files named `commercialEdge.*`. These files are authored evidence definitions, not executed evidence.

## Retry and reconciliation guarantees

Publishing replay is bound to the same source snapshot, release, stable owner key, site, job ID, and fence. A retry may observe an existing queued/building/ready release only when those immutable coordinates match. Finalization replay revalidates the complete object inventory and exact manifest. Durable worker results are treated as untrusted and revalidated before activation, closing the crash interval between finalization and durable-result recording.

Registrar purchase and renewal use exact expiring KES quotes. Both require entitlement and fresh step-up, use stable idempotency keys, query the provider after ambiguous timeouts, and persist one receipt. Renewal additionally binds registration hostname, previous expiry, quote, amount, currency, and period. An unresolved provider timeout remains ambiguous and cannot be treated as success or retried as a new purchase.

## Central integration

Shared migration registration, durable job handlers, PostgreSQL adapters, hosted/public routes, transfer-step registration, Studio settings surfaces, public-Web edge probing, deployment configuration, and documentation indexes remain central integration work. They must not introduce default tenants, inferred provider scope, fake production providers, caller-owned tenant authority, Zod, plaintext secrets, or credential-bearing public projections. See the phase handoff for the exact list.

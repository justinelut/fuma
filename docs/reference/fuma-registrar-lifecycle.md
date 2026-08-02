# Fuma registrar lifecycle

FUMA-061 adds an isolated registrar lifecycle for Fuma-managed domains. It defines strict contracts, exact-site workflow authority, durable PostgreSQL repository and job seams, deterministic test fakes, and a settings UI declaration. It does **not** select or integrate a production registrar, buy a domain, register global routes/jobs, or finalize a central migration. Those remain conductor/provider integration responsibilities.

## Authority and contracts

Every operation is bound to the complete `DomainScope`: platform, organization, workspace, site, owner key, owner generation, owner state/transfer fence, and profile. Provider calls additionally require one explicit matching `fuma-platform` `DomainCredentialAuthority` and credential ID. Customer-automation credentials, inferred credentials, impersonated staff, caller-supplied tenant authority, and cross-scope quote/receipt reads fail closed.

HTTP and provider boundaries use strict TypeBox schemas with `additionalProperties: false`. Registrar money is an integer number of minor units and the only accepted currency is `KES`; floating-point major-unit prices and alternate currencies are not accepted.

## Quote and confirmation lifecycle

1. `POST /settings/domains/registrar/search` normalizes the hostname through the domain contract, checks availability, requests an exact 1–10 year quote, and stores that quote under the exact owner scope.
2. A quote binds hostname, provider, availability, registration and renewal minor units, `KES`, period, provider quote reference, terms hash, and expiry.
3. Purchase confirmation must exactly equal `PURCHASE <hostname>` and repeat the quote ID, hostname, registration amount, currency, and terms hash. Renewal confirmation must exactly equal `RENEW <hostname>` and additionally repeat registration ID, previous expiry, renewal amount, and period.
4. Entitlement and a fresh purpose-bound step-up proof are required before the first provider mutation. An exact duplicate command returns its already persisted receipt without consuming step-up or invoking the provider again. Reusing a request ID with changed evidence is a conflict.
5. Provider mutations use stable scope-derived idempotency keys. Purchase is unique per exact scoped quote; renewal is unique per registration and previous expiry.

A missing, malformed, or expired quote returns `stale-quote`. Any mismatch in hostname, amount, currency, terms, period, confirmation text, or renewal previous expiry returns `changed-quote` (a wire value outside the strict contract, such as `USD`, is rejected at validation before workflow execution).

## Ambiguous outcomes and receipts

A provider exception is never treated as failure or success by assumption. The workflow immediately performs lookup with the same credential authority and idempotency key:

- a strict matching provider result completes the operation;
- a missing or malformed result marks the operation `ambiguous` and returns a retryable unavailable response;
- reconciliation jobs use the persisted operation and exact idempotency key; they never create a new purchase identity;
- timeout-after-commit therefore resolves to one receipt, while an unresolved timeout-before-commit remains ambiguous.

Purchase completion atomically stores one registration, one immutable purchase receipt, one pending DNS handoff, and the succeeded operation. Renewal completion locks the registration and atomically stores one immutable renewal receipt against its exact previous expiry, advances the registration expiry, and succeeds the operation. Database uniqueness plus advisory locks prevent competing confirmations from producing a second receipt. Receipt update/delete triggers reject mutation.

## Managed DNS handoff

After purchase persistence, `DomainServiceRegistrarOnboarding` creates a `fuma-registered` domain through the existing domain authority. The handoff contains exact scope, platform credential authority and credential ID, domain and registration IDs, hostname, and creation time. It names no DNS vendor and does not directly mutate DNS or TLS.

Receipt persistence precedes onboarding. If the process or domain service fails after purchase completion, the pending handoff remains durable. Replaying the exact confirmation or purchase reconciliation resumes that handoff, marks it completed, and returns the original receipt without another provider purchase.

## Local composition seams

- `registrar/runtime.ts` returns scoped route and job declarations; it does not mutate conductor-owned registries.
- `registrar/jobs.ts` exposes `fuma.registrar-purchase` and `fuma.registrar-renew` handlers with durable result commits.
- Hosted migration `000065_registrar_lifecycle_authority` is additive, centrally registered, and checksum-finalized as `dc0c88c44440871af1d02bd4d0ee0143dec54219b55bfef380643e0144c2b340`.
- `src/admin/fuma/registrar` provides a local settings declaration and explicit review/confirmation surface; central route placement remains conductor-owned.
- `DeterministicFakeRegistrarProvider` is network-free and models timeout-before-commit and timeout-after-commit. It is test/demo evidence, not a production provider.

## Focused validation

The focused suites are:

- `registrarLifecycle.unit.test.ts`: exact quote, KES minor units, duplicate confirmation, renewal, receipts, and handoff;
- `registrarLifecycle.security.test.ts`: strict contracts, entitlement, quote changes, currency, scope, and credential authority;
- `registrarLifecycle.fault.test.ts`: stale quote, both timeout boundaries, malformed provider result, resumable DNS handoff, and renewal reconciliation;
- `registrarLifecycle.concurrency.test.ts`: duplicate delivery and competing purchase/renewal identities;
- `registrarLifecycle.demo.test.ts`: deterministic end-to-end quote → purchase → renewal → DNS handoff evidence;
- `architecture/fuma-registrar-lifecycle.test.ts`: dependency, authority, idempotency, migration-isolation, and composition gates;
- `registrarLifecyclePostgresAcceptance.test.ts`: optional live PostgreSQL persistence, exact-state/fence isolation, immutable receipts, renewal, duplicate replay, and completed handoff. Set `FUMA_TEST_POSTGRES_URL` to run it; otherwise Bun reports it skipped.

Final focused acceptance passed **24 tests, 1 optional skip, 130 assertions, 0 failures**. Native PostgreSQL 16 then ran the optional repository suite: **1 test, 13 assertions, 0 failures**, covering duplicate purchase replay, renewal, exact owner-state/fence isolation, immutable receipts, and completed DNS handoff. No registrar request or purchase occurred.

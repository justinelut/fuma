# FUMA-062 domain operations

FUMA-062 owns customer-retained authoritative-DNS settings, exact DNS/TLS diagnostics, inbound/outbound registrar-transfer state, renewal handoff, safe detachment, and the mandatory `domain-outcome` site-transfer step. It consumes finalized FUMA-059 domain authority, FUMA-060 Cloudflare SaaS prevalidation, FUMA-061 registrar conventions, and FUMA-023 transfer contracts without editing their central registries.

## Customer-retained DNS

`server/fuma/domainOperations/service.ts` accepts only strict FUMA-060 prevalidation evidence with `authoritativeDnsRetainedByCustomer: true`, `customerAccountRequired: false`, and `customerTokenRequired: false`. The durable settings projection repeats the exact CNAME/TXT records, desired/observed launch state, and provider-compatible apex alternatives. CNAME-first `www` is always offered; ALIAS, ANAME, CNAME flattening, and registrar redirect appear only according to explicit provider capability. Universal apex proxying is not promised.

The normal launch path contains no customer Cloudflare account, API token, or credential input. Optional `customer-automation` credentials can be attached after launch using the exact FUMA-059 owner authority. They are never required for manual DNS. A revoked optional credential produces a warning while exact manual DNS remains usable.

Diagnostics compare record type, owner name, purpose, and value exactly, then report missing/wrong records plus TLS pending/failure. Diagnostics do not mutate customer DNS. The deterministic demo fixes the fake DNS observer only after inspecting the exact remediation.

## Registrar transfer and renewal ownership

Inbound transfer authorization codes enter as `Uint8Array`, are fingerprinted for changed-replay detection, encrypted with non-extractable AES-256-GCM using the complete owner/transfer/domain/direction authority as AAD, and zeroed after sealing/use. Persistence receives ciphertext, key ID, fingerprint, and expiry only. Public projections expose expiry, never ciphertext, plaintext, provider reference, or request hash.

Both directions are fenced and resumable:

- registrar locks persist `awaiting-unlock` without submitting;
- expired inbound codes fail closed as `expired-auth-code` and remove encrypted state;
- inbound submission resolves timeout-after-commit by lookup under the same idempotency key;
- outbound authorization is encrypted and durably persisted before an injected one-time protected delivery; interrupted delivery resumes under the same idempotency identity and the code is never projected;
- provider completion must show `fuma` ownership inbound or `external` ownership outbound;
- completion hands renewal to `fuma-managed` inbound and `customer-managed` outbound;
- rollback persists `rolling-back` before provider cancellation, removes auth-code state, and converges on `rolled-back`;
- automatic rollback after completed ownership change is forbidden;
- DNS detachment is forbidden while a registrar transfer is active.

No production provider is selected and no live registrar, DNS, or TLS call is made. `RegistrarTransferProvider` is an injected protected-network seam; focused evidence uses only `DeterministicRegistrarTransferProvider`.

## Explicit site-transfer domain outcome

Every site transfer must record exactly one choice per domain:

- `retain-with-source` keeps domain authority at the source;
- `move-with-site` rebinds domain settings to the exact new owner generation;
- `detach-and-manual` detaches routing and returns to customer-managed manual operation.

`createDomainOutcomeTransferStep(...)` contributes mandatory step ID `domain-outcome` at order **620**. It validates the immutable FUMA-023 manifest, exact owner/fence, and one explicit choice. Apply, verify, and compensate use durable receipts. Compensation restores the exact source settings. Customer authoritative DNS remains customer-owned in every outcome. Customer automation credentials are **never moved**: move and detach clear only the settings association, and the receipt records `automationCredentialMoved: false`.

The ticket does not edit the central transfer registry. The conductor must append the returned step to complete transfer composition after the existing order-610 customer-merchant and order-615 AI BYOK steps.

## Persistence and composition

Hosted migration `000067_domain_operations_authority` is additive, centrally registered, and checksum-finalized as `6cfe60d80f884bcb6c9887c118296894c6ea514a29acac4c0c022dc456f1556f`. It creates exact-scope settings, fenced registrar transfers, domain choices/receipts, and immutable evidence. PostgreSQL authority is `PostgresDomainOperationsRepository`; `MemoryDomainOperationsRepository` is deterministic test/demo authority only.

`createHostedDomainOperationsRuntime(...)` returns the PostgreSQL repository, service, scoped route declarations, strict `fuma.domain-transfer` durable-job handler (payload contains only operation ID, action, and bounded retry attempt), and domain transfer step. It mounts nothing globally. Conductor-owned integration points are:

1. retain canonical migration `000067_domain_operations_authority` and its finalized checksum;
2. mount the returned exact-site routes under `site.settings.read/write`;
3. register `fuma.domain-transfer` through the existing durable worker registry;
4. append the mandatory order-620 step to the FUMA-023 registry;
5. place the app-local `DomainOperationsSurface` in `/admin/settings/domains` without importing another app or a shared UI package;
6. provide protected registrar/auth-code key/provider/DNS-observer/detachment adapters. Absence of protected configuration leaves capability unavailable; never mount a fake.

## Focused acceptance

The ticket-local suites cover onboarding/diagnostics, strict contracts and redaction, registrar locks and expiry, revoked optional credentials, inbound/outbound ownership and renewal handoff, timeout reconciliation, duplicate serialization, rollback and safe detachment, owner-generation drift, transfer-step resume/verify/compensation, architecture boundaries, and the requested deterministic demo. Browser acceptance is not required for this unmounted local surface; no localhost or browser claim is made.

Final conductor evidence: hosted migration `000067_domain_operations_authority` is registered at checksum `6cfe60d80f884bcb6c9887c118296894c6ea514a29acac4c0c022dc456f1556f`; ticket-focused acceptance passed **22 tests / 97 assertions**, native PostgreSQL passed **1 test / 7 assertions**, and the closing repository aggregate passed **8,123 tests with 29 expected skips and 0 failures**.

# FUMA-073 opt-in expert discovery

Status: **closure-ready: production-complete, mounted on existing hosted authorities, and accepted through the required public Studio host**.

`apps/studio/server/fuma/expertDiscovery/` owns approved expert releases, explicit opt-in, bounded PII-free ranking, mediated inquiries, reviewed-plugin evidence, expert ownership transfer, and immediate invalidation. It reuses the existing Better Auth-derived `FumaRequestContext`, exact organization/workspace/site repository scope, FUMA-072 moderation authority, FUMA-068 plugin review authority, FUMA-074 transfer authority, and tenant object storage. It creates no identity, session, onboarding, credential, moderation, review, transfer, or app-to-app UI authority.

## Lifecycle

1. A release is bound to one exact active source site and Website/Publication support metadata. A fresh direct internal reviewer must differ from the submitter. The expert and site-owner attribution consents are independently revalidated before the existing `fuma_expert_public_releases`, `fuma_expert_attribution_consents`, and `fuma_expert_profiles` tables are written.
2. Approval starts opted out. A current direct organization manager may opt in or out with a public-revision fence. `unavailable`, opt-out, or current FUMA-072 expert suspension removes the record before ranking.
3. Search accepts only closed TypeBox filters and a limit of 1–50. Ranking is deterministic: available first, then newest public revision, then stable expert ID. Results use only `PublicExpertSchema`; tenant IDs, recipients, consent actors, fingerprints, inquiry bodies, and internal ranks are absent.
4. App-authenticated Website and Publication sessions may submit an inquiry only when that profile is approved for the expert. Each receipt is fenced to the independently approved expert-attribution consent version, not to an unrelated visibility/plugin revision. The UTF-8 message is encrypted with non-extractable AES-256-GCM using the complete tenant scope, expert, inquiry, and source profile as AAD. Only an immutable object key, sender fingerprint digest, consent revision, state, and timestamp enter PostgreSQL. Plaintext is never returned.
5. Plugin links require current FUMA-068 reviewed authority and retain only publisher organization plus a verification digest. Transfers require current FUMA-074 authority, a fresh direct session, exact destination scope, and a revision fence; the destination profile is always opted out pending review.
6. Approval acquires independent transaction-scoped PostgreSQL locks for the public ID and slug before writing release, consent, and profile rows; plugin-link persistence uses the same rollback-signaling transaction pattern for its revision fence. A concurrent collision therefore cannot commit duplicate marketplace identity or orphan release, consent, or plugin rows. If encrypted inquiry custody succeeds but receipt persistence conflicts or fails, the exact tenant-scoped ciphertext object is removed before the request fails, preventing untracked inquiry objects. Approval, visibility, moderation, plugin-link, and transfer changes publish an invalidation event. Search also checks moderation synchronously, so invalidation failure cannot make a suspended expert eligible.

## Persistence and production composition

Hosted migration `000037_operations_experts_transfer` already owns expert releases, attribution consents, profiles, inquiries, and plugin links. FUMA-073 adds no migration and does not modify the migration index or candidate `000078_next_source_portability_authority`.

`createHostedExpertDiscoveryRuntime(...)` composes the PostgreSQL repository with current Better Auth sessions and memberships, exact tenant owner generations, FUMA-072 immutable moderation transitions, FUMA-068 signed plugin reviews, FUMA-074 completed transfer proposals, tenant object storage, a non-extractable AES-256-GCM inquiry key, abuse-window enforcement, and PostgreSQL invalidation events. Its routes are mounted in the one existing Fuma scoped boundary and its console contribution is registered in FUMA-071 composition.

Approval bodies contain release and consent evidence but no source tenant scope or caller authority. The source is the trusted route/repository scope. Transfer bodies contain only transfer identity and revision; the destination scope is resolved from the completed transfer proposal and current owner generation. This keeps both commands compatible with the scoped middleware's caller-authority rejection.

The Studio CSS-Module surface is mounted at the exact scoped `/internal/experts` route for Website and Publication contexts. Public expert projection remains private-cluster, strict-TypeBox, `no-store`, and dynamically rendered by Public Web; it synchronously rechecks current consent version, availability, organization state, and the latest FUMA-072 moderation event before returning an expert or sitemap material.

## Focused validation

```sh
bun test apps/studio/src/__tests__/fuma/expertDiscovery.test.ts \
  apps/studio/src/__tests__/fuma/expertDiscoveryPostgres.test.ts \
  apps/studio/src/__tests__/fuma/expertDiscoveryPostgresAcceptance.test.ts \
  apps/studio/src/__tests__/fuma/expertDiscoveryProduction.test.ts \
  apps/studio/src/__tests__/fuma/expertInquiryVault.test.ts \
  apps/studio/src/__tests__/admin/fumaExpertDiscovery.test.tsx \
  apps/studio/src/__tests__/architecture/fuma-expert-discovery.test.ts
FUMA_TEST_POSTGRES_URL=postgres://... bun test \
  apps/studio/src/__tests__/fuma/expertDiscoveryPostgresAcceptance.test.ts
bunx tsc -p apps/studio/tsconfig.node.json --noEmit
bunx tsc -p apps/studio/tsconfig.app.json --noEmit
```

The native acceptance case is intentionally skipped when `FUMA_TEST_POSTGRES_URL` is absent. It creates and removes a disposable schema and proves eight-way contention for public IDs, slugs, revision-fenced plugin links, and inquiry identities against migration `000037_operations_experts_transfer`.

## 2026-07-31 closure acceptance

Acceptance ran natively on Linux ARM64 (`aarch64`) with PostgreSQL only. The E2E multi-page preview build completed from `apps/studio` with 2,193 modules transformed:

```sh
E2E_PREVIEW_BUILD=1 bun run scripts/vite.ts build
```

The preview was launched from `apps/studio` with `E2E_PREVIEW_BUILD=1`. The required public response at `https://5174.blyss.co.ke/tests/e2e/fixtures/fuma-expert-discovery-harness.html` returned the `FUMA expert discovery harness` document, and its emitted `/assets/fuma-expert-discovery-harness-C06RYf4z.js` returned HTTP 200 with `content-type: text/javascript`. Loopback was used only to establish process liveness; it is not browser, TLS, proxy, hydration, or public-host evidence.

Focused Chromium acceptance used only the approved HTTPS Studio host:

```sh
E2E_ADMIN_BASE_URL=https://5174.blyss.co.ke \
E2E_PUBLIC_BASE_URL=https://3002.blyss.co.ke \
E2E_VITE_MODE=preview E2E_REUSE_SERVER=1 \
bunx playwright test tests/e2e/fuma-expert-discovery.e2e.ts \
  --project=e2e --no-deps
```

Result: **1 passed**. The browser hydrated the production-authority surface, loaded a strict-TypeBox management record, opted out with immediate hide, opted back in, queued a mediated inquiry without exposing a recipient, linked current reviewed-plugin evidence, transferred ownership through the current authority, and left the destination opted out. All observed API requests remained on `https://5174.blyss.co.ke` under the exact organization/workspace/site expert prefix. Browser command bodies omitted `sourceScope`, `destinationScope`, and `actorId`. At a 320 × 900 viewport, document width did not exceed viewport width. Captured page errors and console errors were empty.

Focused service, repository, production-authority, encrypted-vault, Studio UI, architecture, native PostgreSQL contention, and migration-order validation ran with:

```sh
FUMA_TEST_POSTGRES_URL=postgres://postgres:postgres@127.0.0.1:5433/postgres \
bun test \
  apps/studio/src/__tests__/fuma/expertDiscovery.test.ts \
  apps/studio/src/__tests__/fuma/expertDiscoveryPostgres.test.ts \
  apps/studio/src/__tests__/fuma/expertDiscoveryPostgresAcceptance.test.ts \
  apps/studio/src/__tests__/fuma/expertDiscoveryProduction.test.ts \
  apps/studio/src/__tests__/fuma/expertInquiryVault.test.ts \
  apps/studio/src/__tests__/admin/fumaExpertDiscovery.test.tsx \
  apps/studio/src/__tests__/architecture/fuma-expert-discovery.test.ts \
  apps/studio/src/__tests__/architecture/postgresql-migrations.test.ts
```

Result: **18 passed, 0 failed, 138 assertions**. Native PostgreSQL output confirmed eight-way contention, unique public identity, revision fencing, and converged plugin/inquiry identity. Ticket-scoped ESLint passed. `tsconfig.app.json` and the complete `tests/e2e/tsconfig.json` passed with `--noEmit`; direct TypeScript diagnostics on the FUMA-073 runtime, contracts, client, route content, harness, and Playwright spec were empty.

The hosted migration manifest remains unchanged by FUMA-073: 78 manifest entries, 77 runnable entries, `000077_public_handoff_authority` last runnable, `000078_next_source_portability_authority` in the protected checksum-sentinel slot, and isolated `000079_public_marketing_analytics` unindexed. FUMA-073 is objectively ready for formal tracker closure, subject only to the primary agent's aggregate repository validation.

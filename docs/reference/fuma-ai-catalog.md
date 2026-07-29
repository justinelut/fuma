# Fuma AI provider/model catalog (FUMA-063)

FUMA-063 adds a platform-owned provider/model policy catalog under `apps/studio/server/fuma/aiCatalog`. It extends the existing native AI implementation in `apps/studio/server/ai`; it does not add a second runner, conversation store, provider driver, chat endpoint, browser bridge, or provider transport. FUMA-064/065/066 and SITE-008 are intentionally outside this boundary.

## Authority and boundaries

`AiCatalogService` is the only policy mutation surface. Administration requires a validated immutable FUMA request context for the configured platform, a non-impersonated staff actor, and the protected `platform.settings.write` permission (`platform.settings.read` for the administrative projection). Customer roles, site capabilities, caller IDs, and an internal-console hostname cannot synthesize that permission.

All untrusted commands, refresh snapshots, audiences, quotes, repository rows, and projections use strict TypeBox objects with `additionalProperties: false`. The service owns validation and policy; `AiCatalogRepository` owns persistence. `MemoryAiCatalogRepository` is deterministic test/demo authority. `PostgresAiCatalogRepository` is the durable platform authority. A refresh source is an injected `AiCatalogRefreshSource`; FUMA-063 itself performs no network or provider call.

Provider credential authority is deliberately separate from catalog data. Repositories may retain only `credentialAuthorityId`, an opaque reference to the existing credential authority. Customer/public projections never contain it. The platform-admin projection exposes only `credentialConfigured: boolean`; no ciphertext, plaintext, API key, object key, or provider error body crosses the projection.

## Catalog lifecycle

1. A provider is created disabled, with a staleness threshold and no current refresh.
2. A strict refresh snapshot supplies a monotonically increasing source sequence, observation timestamp, and unique models with explicit capabilities, context window, input/output micro-prices, and markup basis points.
3. Refresh history is append-only. A lower/equal sequence is recorded as `rejected-stale` and cannot replace current data. Discovery/validation failures are recorded with a bounded generic error code and no upstream message.
4. New model controls start `enabled=false`, `included=false`, `visibility=platform`. Refreshes replace immutable model versions but preserve independent controls.
5. A protected platform administrator explicitly enables the provider and selected models. Provider and model switches take effect on the next projection/quote without deployment.
6. Enabled providers must have a current applied, non-future refresh no older than `staleAfterSeconds`. Staleness fails the whole enabled catalog closed; disabling the affected provider is the emergency kill switch.

Optimistic versions fence provider controls, model controls, and profile defaults. Defaults are profile-specific and resolve `site -> workspace -> organization -> platform`. A default must be enabled, customer-visible, allowed for the profile, and backed by a fresh enabled provider. A later kill switch makes an otherwise stored default ineligible rather than bypassing control state.

## Visibility and exact pricing

Visibility is an allow-list:

- `public`: models marked `public` only;
- `customer`: `public` and `customer`;
- authorized platform-admin projection: all three levels, including `platform`; caller-supplied `platform-admin` audiences are rejected.

Every audience carries the trusted platform and a gap-free organization/workspace/site ancestry. Non-public audiences require an exact site ancestry. The same gate is used for listing and quoting.

Money is integer micro-units throughout. For non-negative integer token counts:

```text
providerCostMicros = ceil((inputTokens * inputMicrosPerMillion
                          + outputTokens * outputMicrosPerMillion) / 1,000,000)
markupMicros       = ceil(providerCostMicros * markupBasisPoints / 10,000)
chargeMicros       = included ? 0 : providerCostMicros + markupMicros
```

The implementation uses `bigint` intermediates and rejects a result above `Number.MAX_SAFE_INTEGER`; it never rounds through binary floating point or silently substitutes zero for unknown/stale pricing. Included models retain provider-cost and markup evidence while charging zero.

## Deterministic acceptance demo

`runAiCatalogDemo()` uses only memory fixtures. It discovers two models, explicitly enables one paid customer model, keeps the other disabled, selects the paid model as the Website platform default, quotes one million input plus one million output tokens as `3,750,000` micros, and proves both customer/admin projections omit the credential authority. The focused demo test prints one stable `[FUMA-063 demo]` line.

## Finalized PostgreSQL authority and dependent-runtime handoff

The additive catalog authority is finalized and centrally registered as `server/fuma/db/migrations/000063_ai_catalog_authority.ts` with SHA-256 checksum `218a40b70d8774a4774bc9b0b5c9b5ffe002b8b793ba87c067e88f7a92682ec8`. It adds v2 provider controls, immutable refresh/model-version history, independent model controls, scoped defaults, constraints, and indexes while leaving historical `000035_ai_governance` immutable. The complete hosted manifest contains 63 finalized/runnable migrations and the next ID is `000064`.

`PostgresAiCatalogRepository` is the durable implementation behind the same service/repository contracts used by memory fixtures. Native PostgreSQL acceptance fixed and proves two persistence details that must not regress: replay comparison canonicalizes sorted object keys, and JSON arrays/objects are written through `${JSON.stringify(value)}::text::jsonb` so PostgreSQL stores actual JSONB values rather than JSON strings. The finalized migration was applied with `000061` and `000062` on a blank disposable PostgreSQL 16 schema; the combined FUMA-058/FUMA-063 live acceptances passed 2 tests and 14 expectations.

The catalog module exports the strict service, memory repository, PostgreSQL repository, and deterministic demo for trusted central consumers. FUMA-064/065/066 and SITE-008 must feed only catalog-approved provider/model selection and quote policy into the existing native AI/MCP architecture. They must not create another runner, conversation store, provider driver, browser bridge, credential authority, or transport. No provider network call, credential mutation, or production administration was executed by FUMA-063.

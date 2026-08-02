# Fuma AI credits and BYOK (FUMA-064)

FUMA-064 adds `apps/studio/server/fuma/aiCredits` as the commercial policy boundary around the finalized FUMA-063 catalog and the existing native AI runtime. It does **not** add a runner, conversation store, provider driver, browser bridge, MCP runtime, generic credential store, or provider transport. No code in this boundary makes a provider network call or transmits a key.

## Grants, purchases, balances, and expiry

A credit account is bound to the exact platform, organization, workspace, site, owner key, and monotonic owner generation. It tracks exact integer-micro `balanceMicros`, `reservedMicros`, `spentMicros`, `budgetMicros`, and an optimistic version. Scope or generation substitution fails closed.

Grants and purchases are separate immutable lots. Each lot records its kind, amount, remaining amount, optional expiry, evidence ID, idempotency key, and creation time. Replaying the same command returns the original account even after wall-clock movement; reusing an identity or idempotency key with changed commercial evidence is rejected. Expired unspent lots are zeroed and removed from the account balance by the protected expiry job.

Customer availability is the lower of:

- unexpired remaining lot value minus active reservations; and
- budget minus spent value minus active reservations.

Balance exhaustion and budget exhaustion are distinct policy failures. A reservation cannot use a lot that expires before the reservation itself, preventing expiry from removing its collateral while a turn remains live.

## Atomic, catalog-bound reservations

Every non-replayed reservation requires:

1. the caller's exact current account version;
2. exact account/catalog audience ancestry;
3. an expiry in the future and no more than 24 hours away;
4. a fresh enabled FUMA-063 catalog quote; and
5. active exact-scope BYOK metadata when mode is `byok`.

The full quote, turn mode, and opaque BYOK credential selector are canonically SHA-256 bound into the reservation. The PostgreSQL repository locks the account row, verifies lots that remain valid through the reservation expiry, checks the budget, inserts the reservation, and increments reserved balance and account version in one transaction. The memory repository serializes the same account fence for deterministic concurrency tests. Concurrent commands at one version admit at most one distinct reservation; identical commands replay one reservation.

Included catalog models reserve zero. BYOK turns also reserve zero because the customer pays the provider, but they still require an enabled catalog model and active matching credential metadata. Platform-paid turns can reserve through the trusted FUMA-057 quota adapter.

## Actual settlement, release, refund, and expiry

Settlement obtains a fresh catalog quote using actual input/output tokens. It records actual provider cost, markup, customer charge, token counts, and the original quote binding. Included and BYOK turns charge zero while retaining provider-cost evidence. If actual customer charge exceeds the fenced reservation, settlement fails and leaves the reservation intact.

A successful platform settlement locks reservation, account, and still-valid lots; consumes earliest-expiring lots first; releases the full reserved amount; and increments reservation/account versions atomically. A replay with identical terminal evidence returns the original settlement and does not repeat quota, meter, or audit effects. When injected, FUMA-057 quota settlement and FUMA-052 logical/provider-cost metering run only after durable settlement.

Release and expiry return reserved value without charging. Refund marks the settlement refunded, restores account balance/spend, and distributes restored value only into available lot headroom, so no lot can exceed its immutable amount. Release, settlement, refund, expiry, duplicate replay, and stale versions have explicit outcomes.

`fuma.ai-credit-expiry` is an organization-only protected job. It rejects site/repository scope, cross-organization substitution, malformed payloads, and malformed durable replay evidence. It expires due reservations and unspent lots. The result is durable and replay-safe.

## Deterministic fixture turns

`runAiCreditDemo()` performs no network call or production mutation and proves the following fixture turns:

| Turn | Reservation | Settlement evidence |
|---|---:|---|
| Included model | `0` micros | Actual provider cost retained; customer charge `0` |
| Paid platform model | Catalog estimate | Actual-token provider cost + markup charged; then refunded |
| Exhausted request | Denied | No partial reservation |
| BYOK paid catalog model | `0` micros | Actual provider cost retained; customer charge `0` |
| Expired reservation | Released by job semantics | Reserved amount returns to availability |

The demo serializes only customer views, audit facts, and tool context. Its evidence confirms native credential references, envelope fields, key IDs, owner keys, and plaintext metadata are absent.

## BYOK custody and secret absence

BYOK records do not contain API keys. Plaintext exists only during attach/decrypt frames and contains:

- provider ID;
- display label; and
- an opaque credential ID owned by the existing native `server/ai/credentials` authority.

`AesGcmAiByokMetadataCipher` requires a non-extractable 256-bit AES-GCM key with encrypt/decrypt usages. A 96-bit IV is generated per encryption. Additional authenticated data binds credential ID and owner generation, and a canonical SHA-256 fingerprint detects metadata drift. Wrong keys, changed generation, changed AAD, malformed envelopes, and authentication failures fail closed without returning plaintext. Hosted web startup requires an independent canonical base64url `FUMA_AI_BYOK_METADATA_KEY`, imports it as non-extractable, and persists only a SHA-256-derived opaque key ID.

The durable credential row contains scope, provider, state/version/timestamps, and an encrypted envelope (`keyId`, algorithm, IV, ciphertext, fingerprint). Customer views expose only credential ID, provider, display label, state, version, timestamps, and whether the metadata key is current. Audit facts, route errors, logs, tool contexts, and demo evidence omit envelope bytes, key IDs, native credential references, owner keys, and plaintext. Idempotent attach compares the metadata fingerprint and returns the stored envelope; changed plaintext under the same key is rejected.

## Transfer rekey or detach

Ownership transfer requires an explicit durable choice:

- `rekey` requires a higher owner generation, different owner key, and newly encrypted metadata with a fingerprint different from the source; or
- `detach` requires a null replacement envelope and leaves the destination credential detached.

`ai-credit-byok-rekey-detach` is saga-fenced and receipt-bound at central transfer order **615**, after customer-merchant credentials (`610`) and before the reserved domain-outcome step (`620`). Apply, verify, replay, and compensate reject transfer/manifest ancestry mismatch, canonical receipt drift, and stale fences. Compensation restores the exact source scope, state, version, and envelope. Memory and PostgreSQL transfer repositories share the same one-account-per-owner-scope and canonical JSONB replay invariants.

## Persistence and composition

`PostgresAiCreditRepository` is the durable authority. `MemoryAiCreditRepository`, the deterministic cipher, and fixture catalog exist only for unit, fault, security, concurrency, and demo acceptance.

Hosted migration `000066_ai_credits_authority` is additive, centrally registered, and checksum-finalized as `9de088d429ae82927f92145d191851f99dd98a92f5c852a0a64f0e6a43796517`. It defines account, lot, reservation, settlement, encrypted BYOK metadata, expiry-index, and transfer-choice authority. The conductor-owned native-AI composition manifest registers it beside `000063_ai_catalog_authority`, declares `fuma.ai-credit-expiry`, the `ai-credits` scoped route group, and the collision-free BYOK transfer step without introducing a second AI runtime.

`createHostedAiCreditRuntime` returns the PostgreSQL repository/service, trusted scoped routes, protected expiry job declaration, transfer repository, and transfer step. Native chat integration reserves immediately before the existing provider driver call, settles from its terminal token event, and releases on abort/error; this module must not be copied into a second AI runtime.

Native PostgreSQL 16 accepted migration `000066` and the live repository suite with **1 test, 15 assertions, 0 failures** and zero leftover test schemas. The live run proved fenced reservation concurrency, actual settlement/refund, expiry, encrypted BYOK persistence, canonical JSONB replay, and rekey/detach compensation.

## Focused verification

The FUMA-064 test matrix is intentionally isolated:

- `aiCredits.unit.test.ts`: grants, purchases, expiry collateral, actual settlement/refund, budgets, included and BYOK turns;
- `aiCredits.security.test.ts`: non-extractable AES-GCM, AAD, encrypted metadata, secret-free projections, scope denial, rekey/detach/compensation;
- `aiCredits.fault.test.ts`: injected persistence failures, quota compensation, catalog errors/repricing, changed replay evidence;
- `aiCredits.concurrency.test.ts`: account-version admission and duplicate reserve/settle races;
- `aiCredits.jobs.test.ts`: protected expiry authority and durable replay;
- `aiCredits.demo.test.ts`: deterministic included/exhausted/BYOK/refund/expiry evidence;
- `architecture/fuma-ai-credits.test.ts`: strict contracts, no provider transport/second runtime, finalized migration/checksum, secret-free structures;
- `aiCreditsPostgresAcceptance.test.ts`: optional live PostgreSQL durability and concurrency when `FUMA_TEST_POSTGRES_URL` is set.

Run these files directly with `bun test`, and run ESLint only over `server/fuma/aiCredits` plus the listed test files. The PostgreSQL case skips explicitly when no live test URL is configured.

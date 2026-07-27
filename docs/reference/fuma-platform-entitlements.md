# FUMA-054 platform plans and entitlements

FUMA-054 establishes the hosted commercial authority between FUMA-052 cost evidence and later checkout/billing enforcement. It publishes finite KES plans, creates versioned private offers, protects the platform-internal grant, records immutable entitlement evidence, and produces only an `awaiting-payment` contract candidate. It does **not** initialize Paystack, activate a contract, or enter `paid-transfer-pending`.

## Contracts and public projection

`apps/studio/server/fuma/entitlements/contracts.ts` is the strict TypeBox authority. Every boundary rejects extra fields and models all 14 finite quota classes. Recurring and one-time setup forecasts each contain exactly the 18 physical FUMA-052 meters. Published price books require one matching monthly/annual pair per plan ID with identical profile, quotas, workload assumptions, feature keys, and checkout metadata.

`economics.ts` is the only public-pricing projection builder. It validates every output item with `PublicPricingPlanSchema`; the stored `public_json` contains only `{ items: PublicPricingPlan[] }`. Workload assumptions, provider/source evidence, fixed and variable cost, margin, discounts, custom terms, internal grants, and private offers remain server-only.

Fuma-funded starter/trial plans are capped at 100 email recipients per day and 3,000 per month. All plan and offer quotas remain positive finite integers; there is no unlimited sentinel.

## Cost and margin gates

Every plan and offer forecast reads a complete, current 18-meter cost snapshot from the FUMA-052 catalog. Each line records immutable version and source evidence. Selection precedence is:

1. actual invoice;
2. provider quote;
3. published planning baseline;

Within a source class, current effective date and version determine the winner. Missing, stale, zero-authority, unsafe FX, or malformed assumptions fail closed. A derived SHA-256 identifies the complete selected model.

Launch publication/issuance requires variable COGS at or below 30% of net revenue and gross margin at or above 70%. Setup cost is calculated separately from recurring cost; a setup fee may be zero only when its complete forecast is also zero. No recurring margin can conceal setup cost.

## Internal grant and evaluator

The one `platform-internal` grant is bound to canonical organization `fuma-platform`. It is non-transferable, has no provider customer ID, requires shadow-cost accounting, and is returned first by the evaluator. Its decision sets `billingAllowed=false` and `providerAllowed=false`; physical workload is still metered by FUMA-052.

Other organizations resolve through the latest current immutable entitlement snapshot. No snapshot means no entitlement. Grandfathered The Lawyer assignment requires a complete literal FUMA-076 inventory receipt observed before the assignment becomes effective.

## Private-offer lifecycle

A draft binds exact organization, workspace, site, cadence, KES amount, setup fee, quotas, recurring/setup assumptions, renewal policy, discount window, replacement identity, terms hash, and acceptance window.

- Proposal validates the current provisional destination and computes recurring/setup evidence.
- Issue revalidates the destination, recomputes the current model, rejects changed economics, and freezes one version.
- Withdrawal and expiry are terminal; expiry cannot happen before the immutable deadline.
- Replacement requires the exact withdrawn predecessor.
- Acceptance revalidates the exact destination and atomically transitions the issued offer while inserting one idempotent `awaiting-payment` candidate.

The candidate has unsettled setup/recurring obligations, `activatedAt=null`, and `paidTransferPending=false`. FUMA-055 and FUMA-056 own later provider initialization and settlement transitions.

## Persistence and migration handoff

`PostgresEntitlementRepository` and `PostgresOfferDestinationAuthority` are the production authorities. They use row/advisory locks for the singleton grant and offer acceptance, canonical immutable replay comparison, exact active organization/workspace/site checks, and database constraints/triggers. `runtime.ts` composes them with `PostgresProviderCostCatalog`; memory storage is test-only.

`entitlements/migration.ts` exports an **unregistered candidate** for the conductor to finalize as the next hosted migration. It adds immutable price-book/offer evidence, candidate destination/snapshot fields, general assignments, immutable entitlement snapshots, grandfathered evidence, and exact offer lifecycle triggers. It contains no destructive DDL/DML. The worker intentionally does not modify the central migration index.

## Evidence

Focused acceptance:

```sh
bun test \
  apps/studio/src/__tests__/fuma/entitlements.test.ts \
  apps/studio/src/__tests__/architecture/fuma-entitlements.test.ts
```

Optional production-repository acceptance creates and always drops a disposable PostgreSQL schema:

```sh
FUMA_TEST_POSTGRES_URL=postgres://... \
  bun test apps/studio/src/__tests__/fuma/entitlementsPostgresAcceptance.test.ts
```

The suite covers hostile extra fields, public/private separation, pair/version immutability, missing/stale costs, invoice/quote/baseline precedence, margin and variable-COGS limits, starter email caps, protected grant concurrency, setup separation, destination substitution, issue/withdraw/replace/expire/accept lifecycle, one concurrent candidate, non-activation, allowance identity, grandfathering/FUMA-076 gating, evaluator behavior, and a deterministic demo.

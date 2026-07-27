# Fuma Repository Scoping

This reference defines the implemented FUMA-025 repository-scope authority and its use by the FUMA-026 runtime-boundary factories, while keeping legacy self-host selection separate.

`FumaRepositoryScope` is the immutable hosted site authority passed below request/job authorization. It binds exact tenant ancestry to the current stable owner key; it does not replace the explicit historical site selector used by the one-site self-host composition.

---

## TL;DR

- Legacy self-host code passes `SELF_HOST_SITE_ID` (`'default'`) explicitly to historical repositories. That constant selects preserved one-site data; it is not hosted tenant authority.
- Hosted site-owned repository authority is represented by one exact `FumaRepositoryScope`, produced by `deriveFumaRepositoryScope` in `apps/studio/server/fuma/tenancy/repositoryScope.ts`. FUMA-026 now derives and injects it through the HTTP and durable-job boundary factories and consumes it through `PostgresScopedSiteRepository`.
- Scope contains `platformId`, `organizationId`, `workspaceId`, `siteId`, stable `ownerKey`, owner generation/state, and the active transfer fence. It is strict, detached, and deeply frozen.
- `PostgresFumaRepositoryScopeOwnerKeyAuthority` resolves the owner record with all four coordinates. Missing, malformed, inconsistent, or failed authority produces one non-enumerating denial.
- Hosted workspace and site repositories carry organization/workspace predicates through transactions, reads, lists, counts, and writes. Bare `workspaceId` or `siteId` lookup is not an accepted authority pattern.
- `FUMA_REPOSITORY_SCOPE_COVERAGE` is the canonical 36-class scoping-obligation and coverage-policy registry for every site-owned table-row/object class in the FUMA-024 inventory. Its exhaustiveness does not assert that the corresponding legacy repositories have been converted.
- FUMA-026 implements production-shaped HTTP, cache-key, object-key, plugin-call, and durable-job factories around this scope. Those factories are not yet registered by the central Studio router or a hosted product composition root.
- Physical workspace IDs remain globally unique under `000005_workspaces`; FUMA-025's production-shaped collision proof therefore uses distinct parent workspace IDs and equal child site IDs/slugs, which `fuma_sites` stores under its composite key. Supporting equal workspace IDs across organizations would require a later additive migration.

## Two scoping domains

| Domain | Selector | Meaning |
|---|---|---|
| Legacy self-host | `SELF_HOST_SITE_ID` from `apps/studio/server/selfHost.ts` | Stable explicit ID for the existing installation's single historical site. Callers pass it into legacy repository functions such as `getDraftSite(db, siteId)`; no owner-key or hosted ancestry is inferred. |
| Hosted Fuma | `FumaRepositoryScope` from `apps/studio/server/fuma/tenancy/repositoryScope.ts` | Exact server-derived `platform → organization → workspace → site` ancestry plus stable owner-key state. It is the authority value for site-owned hosted repository/service operations. |

Keeping `SELF_HOST_SITE_ID = 'default'` is not a singleton lookup fallback. `apps/studio/server/selfHost.ts` names it as the legacy composition scope so existing rows are selected explicitly without renaming or rewriting stored data. Hosted code must not translate `'default'`, a route site ID, or the first row in a tenant table into `FumaRepositoryScope`.

The architecture gate in `apps/studio/src/__tests__/architecture/fuma-repository-scoping.test.ts` rejects default-site SQL and unqualified `limit 1` tenant selection. It does not ban the explicit self-host constant.

## Exact hosted scope

The strict TypeBox-derived union in `apps/studio/server/fuma/tenancy/repositoryScope.ts` has two valid branches:

```ts
type FumaRepositoryScope = Readonly<{
  platformId: string
  organizationId: string
  workspaceId: string
  siteId: string
  ownerKey: string
  generation: number
  state: 'active' | 'transferring'
  transferFence: null | number
}>
```

An active owner has `transferFence: null`; a transferring owner has a positive fence. Both branches reject additional properties. The derived value and its nested coordinate are detached and deeply frozen.

The implemented bound-site repository-authority API is:

```ts
deriveFumaRepositoryScope(
  input: DeriveFumaRepositoryScopeInput,
): Promise<FumaRepositoryScope>
```

It accepts only an immutable FUMA-021 request snapshot or site-job snapshot plus the server-owned owner-key authority. It does not accept route parameters, headers, request bodies, job payloads, or standalone IDs. Organization-only jobs are denied before owner lookup rather than receiving an invented site.

The binding flow is:

```text
frozen trusted request or site-job context
  → validate exact repeated ancestry
  → load owner key by platform + organization + workspace + site
  → validate owner record and exact coordinate equality
  → bind generation/state/transfer fence
  → validate strict FumaRepositoryScope
  → return detached frozen scope
```

The resulting value is the one bound repository authority to pass down a site-owned call chain. Do not split it back into caller-controlled arguments or derive a second scope inside lower repository layers. `PostgresScopedSiteRepository.forScope(scope)` consumes it through a frozen API whose operations accept no tenant coordinates. Each operation enters an organization/workspace-bound transaction and revalidates the exact owner key, generation, active state, null transfer fields, and site ancestry with `SELECT ... FOR SHARE` before reading or mutating. The FUMA-026 factories described below perform the implemented transport/job handoff.

## Owner-key authority

`PostgresFumaRepositoryScopeOwnerKeyAuthority` in `apps/studio/server/fuma/tenancy/ownerKeyAuthority.ts`:

- rejects a non-PostgreSQL `DbClient`;
- exposes only `loadOwnerKey(coordinate)`;
- queries `fuma_tenant_owner_keys` with equality predicates for `platform_id`, `organization_id`, `workspace_id`, and `site_id`;
- maps PostgreSQL numeric representations only when they are positive safe integers; and
- returns the complete owner record for validation by `deriveFumaRepositoryScope`.

The owner key is stable while ancestry may move under the transfer saga. `generation`, `state`, and `transferFence` let downstream work detect stale ownership authority. The resolver intentionally collapses absent rows, malformed records, coordinate mismatch, adapter failures, and invalid state/fence shape to:

```text
FumaRepositoryScopeResolutionError
code: denied
message: Repository scope authority denied.
```

This prevents owner-key resolution from becoming a tenant-existence oracle.

## Workspace and site predicates

The hosted lifecycle repositories already demonstrate the required predicate shape:

| Repository | Transaction scope | Required predicates |
|---|---|---|
| `apps/studio/server/fuma/workspaces/repository.ts` | `transaction(organizationId, work)` takes an organization advisory lock. | `getById` uses organization + workspace; list uses organization; update uses organization + workspace and rejects a record from another organization. |
| `apps/studio/server/fuma/sites/repository.ts` | `transaction(organizationId, workspaceId, work)` takes an organization/workspace advisory lock. | workspace status uses organization + workspace; `getById` uses organization + workspace + site; list/count use organization + workspace; update uses all three site coordinates. |

The lifecycle repositories enforce the predicate shape, and `apps/studio/server/fuma/sites/scopedRepository.ts` is the production scope consumer. It binds one active `FumaRepositoryScope`, exposes no tenant-coordinate parameters, keeps slug lookup and count constrained to that exact site, rejects stale transfer generations inside the transaction, and passes the same frozen authority into rollback-capable callbacks. The 36-class registry remains an obligation ledger rather than a claim that every legacy resource repository has already been converted.

The FUMA-025 architecture gate rejects bare `getById(workspaceId)` and `getById(siteId)` shapes. It also scans workspace/site transaction and list/search/count methods for missing scope parameters and checks `fuma_workspaces`/`fuma_sites` SQL for the matching ownership predicates.

Permission approval and exact repository selection solve different problems. A FUMA-020 permission decision authorizes an action; `FumaRepositoryScope` prevents a lower-level ID from substituting a different tenant after that decision.

## 36-class coverage registry

`FUMA_REPOSITORY_SCOPE_COVERAGE` in `apps/studio/server/fuma/tenancy/repositoryScopeCoverage.ts` contains exactly the persisted site-owned table-row and object classes projected by `TENANT_RESOURCE_INVENTORY`:

| Family | Classes |
|---|---:|
| `site` | 3 |
| `content` | 4 |
| `media` | 7 |
| `publish` | 2 |
| `plugins` | 6 |
| `ai-mcp` | 4 |
| `objects` | 10 |
| **Total** | **36** |

The module compares the sorted registry IDs with the FUMA-024 inventory at load time. `apps/studio/src/__tests__/architecture/fuma-repository-scoping.test.ts` independently requires exactly one exported canonical coverage registry and verifies that every required class occurs once.

The registry is an exhaustive scoping-obligation and coverage-policy contract. Exhaustive means that every FUMA-024 site-owned persisted table-row/object class is named exactly once; it does not mean that 36 production repositories exist or that all legacy repositories have been converted.

Before a later domain implementation for any class is used in hosted runtime, that class must be registered here and the implementation must accept and consume the exact bound `FumaRepositoryScope` throughout its repository/service call chain. If the FUMA-024 inventory gains a site-owned persisted class, the registry must gain the matching obligation before that class is used. A registry entry alone is never evidence of implementation, production wiring, migration execution, or live PostgreSQL behavior.

## FUMA-026 boundary factories

The FUMA-025 repository layer remains below transport composition. FUMA-026 supplies the implemented consumers of its exact scope:

1. `createFumaScopedRouteBoundary` and `createFumaScopedRouteBoundaryFactory` in `apps/studio/server/fuma/context/middleware.ts` derive one active scope from frozen FUMA-021 request authority and pass it to a declared descendant handler.
2. `createPostgresFumaScopedRouteBoundaryFactory` in `apps/studio/server/fuma/context/composition.ts` constructs the PostgreSQL owner-key authority for that HTTP flow.
3. `createFumaScopedKeyFactory` and `createFumaScopedObjectKeyFactory` bind cache/pub-sub/lock and object names to the active scope without accepting replacement tenant coordinates.
4. `bindFumaHostedPluginCalls` revalidates scope and granted plugin authority before dispatch.
5. `FumaJobScopeBoundary` and `createFumaJobWorkerComponentFactory` derive site-job scope, wrap repositories, and keep organization jobs site-capability-free.

These are production-shaped factories, not central registration. No central `apps/studio/server/router.ts` or hosted product composition root currently mounts the scoped HTTP descendants or hosted plugin runtime. FUMA-027 can consume the factories for hosted editor persistence without re-deriving authority from routes, payloads, or process globals.

## Known physical schema limitation

The logical authority contract treats workspace and site IDs as lower-level identifiers that may collide across organizations. The physical hosted workspace schema is stricter today:

- `apps/studio/server/fuma/db/migrations/000005_workspaces.ts` defines `fuma_workspaces.id text primary key`;
- `apps/studio/server/fuma/db/migrations/000006_sites.ts` later adds `unique (organization_id, id)`, but does not remove the global workspace primary key; and
- `fuma_workspace_membership_overrides.workspace_id` references the global workspace ID alone.

Therefore two organizations cannot persist equal workspace IDs in the current hosted schema, although equal site IDs can be qualified by the composite site key. The collision fixtures in `apps/studio/src/__tests__/fuma/repositoryScope.test.ts` and `apps/studio/src/__tests__/fuma/trustedJobContext.test.ts` use synthetic authority records to prove cross-organization substitution is denied. They are not migration tests and do not demonstrate live PostgreSQL coexistence of colliding workspace IDs.

This physical parent-key constraint does not block FUMA-025's scoped-record acceptance: two valid distinct workspaces can store equal `fuma_sites.id` and slug values because the site table keys them by organization and workspace. The focused bound-repository matrix exercises those collisions and proves read, update, soft-delete/archive, slug search, exact count, stale-transfer denial, and rollback isolation through one API. Equal physical workspace IDs across organizations are a separate future requirement; if adopted, they require an additive hosted migration and coordinated foreign-key updates. No destructive rewrite of committed migration `000005_workspaces` is permitted.

## Forbidden patterns

- Treating `SELF_HOST_SITE_ID` as hosted authority or removing it by rewriting historical self-host rows.
- Looking up hosted data by bare `workspaceId`, `siteId`, slug, owner key, or first/default tenant row.
- Constructing `FumaRepositoryScope` from route/body/header/job-payload fields.
- Accepting an organization-only job in a site-owned repository.
- Omitting organization/workspace predicates from a transaction, list, search, count, update, or delete.
- Treating the 36-class coverage registry or the FUMA-026 factories as evidence of central runtime mounting, all-class conversion, or live PostgreSQL acceptance.
- Claiming physical cross-organization workspace-ID collision support while `fuma_workspaces.id` remains globally unique.

## Evidence boundary

Primary acceptance on 2026-07-25:

- consolidated FUMA-025 scope/workspace/site/bootstrap/architecture suite: **98 passed, 0 failed, 579 assertions**;
- affected router/rendering regressions after explicit self-host site propagation: **58 passed, 0 failed, 217 assertions**;
- root build: all three shared package typechecks plus Studio TypeScript and the **2,046-module** Vite bundle passed;
- root lint and `git diff --check`: passed; and
- final full `bun test`: **7,026 passed, 8 environment skips, 25 historical unrelated failures, 145,260 assertions across 7,059 tests**. No FUMA-025 test failed.

The repository-scope owner-authority tests use recording/fake `DbClient` implementations and the collision matrix uses the production repository interfaces with an in-memory transactional implementation. No live PostgreSQL FUMA-025 acceptance is claimed; the environment-gated PostgreSQL suites remained skipped. The evidence does not claim hosted migration execution or owner-key backfill.

## Related

- `docs/reference/fuma-request-context.md` — immutable FUMA-021 request/job authority consumed by scope derivation.
- `docs/reference/fuma-tenant-keys.md` — FUMA-024 owner-key records and the canonical site-owned resource inventory.
- `docs/reference/fuma-permissions.md` — authorization decisions that precede persistence scoping.
- `docs/reference/fuma-runtime-boundary-scoping.md` — implemented FUMA-026 boundary factories, security checks, acceptance, and central-mount non-claims.
- Source-of-truth files: `apps/studio/server/fuma/tenancy/repositoryScope.ts`, `apps/studio/server/fuma/tenancy/ownerKeyAuthority.ts`, `apps/studio/server/fuma/tenancy/repositoryScopeCoverage.ts`, `apps/studio/server/fuma/sites/scopedRepository.ts`
- Focused tests: `apps/studio/src/__tests__/fuma/repositoryScope.test.ts`, `apps/studio/src/__tests__/fuma/repositoryScopeOwnerAuthority.test.ts`, `apps/studio/src/__tests__/fuma/scopedSiteRepository.test.ts`
- Gate test: `apps/studio/src/__tests__/architecture/fuma-repository-scoping.test.ts`

# Fuma Runtime Boundary Scoping

This reference defines the implemented FUMA-026 authority binding between trusted hosted context and HTTP handlers, coordination keys, object prefixes, plugin calls, and durable-job handlers.

FUMA-026 carries one server-derived `FumaRepositoryScope` across runtime boundaries without accepting tenant authority from request bodies, plugin payloads, or job payloads. It provides production-shaped factories and deterministic acceptance coverage; it does not mount a hosted runtime or convert the existing editor persistence layer to multi-site operation.

---

## TL;DR

- `createFumaScopedRouteBoundary` in `apps/studio/server/fuma/context/middleware.ts` derives trusted request context and one frozen `FumaRepositoryScope` before dispatching a declared site-scoped descendant route.
- `createFumaScopedRouteBoundaryFactory` captures trusted HTTP dependencies; `createPostgresFumaScopedRouteBoundaryFactory` in `apps/studio/server/fuma/context/composition.ts` additionally constructs the PostgreSQL owner-key authority. Neither factory registers routes in the central server router.
- `createFumaScopedKeyFactory` in `apps/studio/server/fuma/runtime/scopedKeys.ts` binds cache, pub/sub, and lock resources to exact platform, organization, workspace, site, owner key, owner generation, active profile, granted capability, and caller-supplied key version.
- `createFumaScopedObjectKeyFactory` in `apps/studio/server/fuma/objectStorage/scopedKeys.ts` narrows the same frozen repository authority to the established organization/workspace/site object prefix and accepts no tenant-coordinate arguments afterward.
- `bindFumaHostedPluginCalls` in `apps/studio/server/fuma/plugins/callBoundary.ts` snapshots operator-approved plugin `grantedPermissions` separately from profile capabilities, checks both target requirements on every call, recursively rejects normalized authority claims, and re-derives the current owner scope before dispatch. `createLegacySelfHostPluginCallBoundary` remains a separate identity-preserving pass-through.
- `FumaJobScopeBoundary` in `apps/studio/server/fuma/jobs/integration.ts` gives site jobs a bound scope and guarded site repository. Organization jobs receive `repositoryScope: null` and `siteRepository: null`.
- HTTP handlers, coordination factories, and object factories reject a transferring repository scope rather than treating a structurally valid scope as active authority.
- Site repository access is claim-guarded before and after authority derivation and before every bound repository or transaction operation. Guards validate the current durable record's running status and exact claimant as well as fence, attempt, expiry, cancellation, and owner authority. Stale, expired, cancelled, reclaimed, cross-tenant, or transfer-stale work fails closed.
- Focused deterministic tests demonstrate isolation across HTTP, coordination/object keys, plugins, and jobs. They do not use live Redis, MinIO, or PostgreSQL.
- FUMA-027 owns multi-site editor persistence and hosted editor integration. FUMA-026 does not claim that legacy editor repositories are converted or that the central runtime mounts these boundaries.

## One authority chain

The source authority remains the FUMA-021 context and FUMA-025 repository scope:

```text
trusted request or claimed durable job
  → derive Fuma request/site-job context
  → derive exact FumaRepositoryScope from server-owned owner-key authority
  → bind boundary-specific capability
      HTTP handler input
      cache/pub-sub/lease key factory
      object-prefix factory
      hosted plugin dispatcher
      guarded site-job repository
```

`FumaRepositoryScope` comes from `apps/studio/server/fuma/tenancy/repositoryScope.ts`. It carries exact platform, organization, workspace, and site ancestry plus stable `ownerKey`, owner `generation`, transfer state, and transfer fence. FUMA-026 consumers validate or derive that frozen value; they do not reconstruct it from route descendants, resource strings, plugin payloads, or durable-job payloads.

All boundary-specific resolution errors collapse malformed or substituted authority to a non-enumerating denial. The exact transport response varies by boundary: the HTTP boundary returns the same `404 Resource not found.` envelope for repository-scope denial, while key, plugin, and job APIs throw their typed `denied` errors.

## HTTP repository-scope derivation and factories

`createFumaScopedRouteBoundary` owns the hosted site prefix:

```text
/api/fuma/organizations/<organizationId>/workspaces/<workspaceId>/sites/<siteId>
```

Product modules declare only descendant method/path/permission records. Before a handler runs, `apps/studio/server/fuma/context/middleware.ts`:

1. parses and validates the route ancestry and descendant parameters;
2. rejects undeclared descendants and ambiguous route declarations;
3. checks mutation origin for non-`GET` requests;
4. rejects caller headers or JSON body fields that claim actor, tenant, owner, profile, permission, capability, correlation, or job authority;
5. calls `deriveFumaRequestContext` with server-owned authority ports and the route's required permission;
6. calls `deriveFumaRepositoryScope` with the frozen request context and server-owned owner-key authority;
7. requires the resulting repository scope to be active rather than transferring; and
8. invokes the handler with one frozen `{ request, context, repositoryScope, params }` object.

The handler receives descendant `params` separately from `repositoryScope`. A `:rowId` or similar route parameter can select a resource inside the already-bound site, but it cannot replace organization/workspace/site authority.

There are two composition levels:

| Factory | Captured authority | What callers provide |
|---|---|---|
| `createFumaScopedRouteBoundaryFactory` in `apps/studio/server/fuma/context/middleware.ts` | request-context ports, owner-key authority, mutation-origin policy, optional registry, request-ID generator | declared descendant routes |
| `createPostgresFumaScopedRouteBoundaryFactory` in `apps/studio/server/fuma/context/composition.ts` | the same dependencies plus `PostgresFumaRepositoryScopeOwnerKeyAuthority` constructed from `DbClient` | declared descendant routes |

The PostgreSQL factory is production-shaped composition, not runtime registration. No central `apps/studio/server/router.ts` or Fuma web composition root currently calls it. Each product surface must eventually mount only the descendants it owns rather than creating an unrestricted catch-all.

## Versioned cache, pub/sub, and lease keys

`createFumaScopedKeyFactory` accepts only a deeply frozen trusted request or site-job context, the matching frozen active repository scope, one capability present in the context, and a positive integer key version. Organization jobs and transferring scopes are rejected because site coordination requires active site authority.

The immutable authority fingerprint covers:

```text
platformId
organizationId
workspaceId
siteId
ownerKey
owner generation
profileId
capabilityId
key version
```

The logical key shape in `apps/studio/server/fuma/runtime/scopedKeys.ts` is:

```text
fuma-scope:v1:<sha256-authority-fingerprint>:g<generation>:v<version>:<kind>:<base64url-resource>
```

`<kind>` is `cache`, `pubsub`, or `lock`. Resource strings are canonical relative paths: no leading/trailing slash, backslash, percent encoding, control characters, `.`/`..`, empty segments, or unsafe characters.

The logical factory composes with `FumaRedisKeyspace` in `apps/studio/server/fuma/redis/keyspace.ts`:

| Use | Logical value | Deployment-physical result |
|---|---|---|
| Cache | `keys.cache(resource)` | `fuma:v1:<namespace>:cache:<base64url-logical-key>` |
| Pub/sub | `keys.pubsub(resource)` | `fuma:v1:<namespace>:pubsub:<base64url-logical-key>` |
| Lease | `keys.lock(resource)` passed to `keyspace.lease(...)` | `fuma:v1:<namespace>:leases:<base64url-logical-key>:owner` plus `:fence` |

The explicit key version invalidates a product key format or data contract. Owner generation invalidates authority after ownership changes. Profile and capability identity prevent two equally named resources with different runtime authority from sharing cache, channel, or lock state. The deployment namespace remains an independent outer separation layer.

The returned key strings are opaque runtime keys. Do not parse the fingerprint to recover authority and do not pass raw route IDs directly to `FumaRedisKeyspace` for tenant work.

## Bound object prefixes

`createFumaScopedObjectKeyFactory` in `apps/studio/server/fuma/objectStorage/scopedKeys.ts` validates a deeply frozen active `FumaRepositoryScope`, rejects transferring authority, narrows it to the established `ObjectTenantScope`, and returns a factory with no tenant-coordinate parameters:

```text
organizations/<organizationId>/workspaces/<workspaceId>/sites/<siteId>/objects/
```

The returned `physicalKey(logicalKey)` always appends to that prefix. `logicalKey(physicalKey)` accepts only a key under the same prefix, so a foreign tenant key cannot be rebound by trimming an arbitrary path. Canonical logical-key validation remains in `apps/studio/server/fuma/objectStorage/keyPolicy.ts`.

The physical object layout intentionally uses organization/workspace/site ancestry rather than owner key or generation. Ownership transfer and authorization policy changes operate on exact prefixes through the FUMA-024 transfer contracts; callers still need the current bound repository authority before receiving a prefix factory.

## Hosted plugin calls and legacy self-host separation

`bindFumaHostedPluginCalls` accepts a plugin ID, trusted request or site-job context, owner-key authority, operator-approved plugin `grantedPermissions`, an allowlisted requirement table, and separate persistence/RPC dispatchers. Initial binding:

- rejects organization-only job context;
- derives an active repository scope;
- snapshots the active profile ID, granted context capabilities, and plugin `grantedPermissions`; and
- freezes the plugin authority passed out-of-band to dispatchers.

Each `call(...)` in `apps/studio/server/fuma/plugins/callBoundary.ts` then:

1. validates `{ kind, target, payload }` with TypeBox;
2. recursively walks arrays and objects and rejects caller authority selectors after normalizing key case and punctuation, so nested or spelling-varied claims cannot bypass the boundary;
3. finds the exact `kind:target` requirement;
4. checks every required profile capability and plugin permission against their independent immutable grant snapshots;
5. re-derives current repository scope from server-owned owner-key authority;
6. requires current active state and exact equality with the bound scope, including owner generation and transfer fence; and
7. dispatches a deeply frozen call with authority separate from payload.

This is plugin-permission, capability, and scope revalidation at the call boundary: both requirement sets are checked for every call, and owner scope is refreshed for every call. A plugin grant or permission/profile change creates a new boundary; the implementation does not mutate an already-bound grant snapshot.

Legacy self-host plugins remain deliberately separate. `createLegacySelfHostPluginCallBoundary` forwards the exact input object to the existing dispatcher and returns its exact result. It does not invent `FumaRepositoryScope`, owner keys, hosted capabilities, or hosted payload rules. This preserves self-host behavior without treating `SELF_HOST_SITE_ID` or legacy plugin permission state as hosted tenant authority.

## Site and organization job contexts

`FumaJobScopeBoundary` converts the neutral FUMA-009 worker context into one of two explicit authority shapes:

| Job context | `repositoryScope` | `siteRepository` |
|---|---|---|
| Site job | derived `FumaRepositoryScope` | `BoundSiteRepository` for that scope |
| Organization job | `null` | `null` |

The job payload never participates in context, owner-key, or repository selection. `deriveFumaJobContext` uses the claimed durable job record and server-owned authority; site jobs then pass through `deriveFumaRepositoryScope`. Actorless organization jobs remain valid for organization-level work but cannot acquire a site repository capability.

`scopeFumaJobHandlers` wraps authority-consuming handlers into the neutral worker handler map. `createFumaJobWorkerComponentFactory` refuses to mount executable handlers unless trusted job authority and server-owned owner-key/site-repository dependencies are available. With a database dependency, it constructs `PostgresFumaRepositoryScopeOwnerKeyAuthority` and `PostgresScopedSiteRepository`.

### Claim guards

The guard in `apps/studio/server/fuma/jobs/integration.ts`, backed by the worker's current durable-claim lookup, requires all of the following:

- the current durable record still exists and its status is `running`;
- durable job fence equals the worker fence;
- durable attempt count equals the worker attempt number;
- the current record's `claimedBy` exactly matches the worker claimant captured by the claim;
- claim expiry parses and remains in the future; and
- `cancellationRequested()` is false.

It runs before context derivation, after job-context derivation, after repository-scope derivation, before creating the bound result, before every site repository operation, at transaction entry, before the transaction callback, and before every operation on the transaction wrapper. A repository handle captured before cancellation, claim expiry, reclaim, or ownership transfer therefore does not remain an unchecked capability.

## Cross-boundary isolation demonstration

The FUMA-026 acceptance surfaces use colliding or shared resource identifiers to show that authority, not a bare child ID, controls selection:

| Boundary | Demonstrated isolation |
|---|---|
| HTTP — `apps/studio/src/__tests__/fuma/httpRepositoryScopeBoundary.test.ts` | caller tenant/owner claims are rejected before authentication or owner lookup; missing owner authority uses the same denial; a handler sees one frozen server-derived scope |
| Coordination/object — `apps/studio/src/__tests__/fuma/scopedKeys.test.ts` | equal resources under different organization/owner/generation/profile/capability/version authority produce different logical and physical Redis keys; foreign object prefixes are rejected |
| Plugin — `apps/studio/src/__tests__/fuma/pluginCallBoundary.test.ts` | unknown, ungranted, caller-substituted, transferring, or generation-stale calls never reach persistence/RPC dispatchers |
| Jobs — `apps/studio/src/__tests__/fuma/jobScopeBoundary.test.ts` | cross-tenant owner substitution and active transfer fail before handler entry; stale claims and stale repository handles fail; organization jobs receive no site capability |
| Integrated chain — `apps/studio/src/__tests__/fuma/runtimeBoundaryIntegration.test.ts` | equal two-site operations traverse HTTP → explicitly granted plugin dispatch → scoped coordination/object keys → claimed site job, preserve same-site key equality across plugin/job stages, and remain distinct across organizations |

These are deterministic focused suites, including one in-process end-to-end boundary chain, not a deployed hosted runtime. Together they demonstrate the same rule at every implemented boundary: matching workspace/site/resource text cannot substitute organization, owner generation, profile, capability, plugin grant, or claim authority. `apps/studio/src/__tests__/architecture/fuma-runtime-boundary-scoping.test.ts` additionally audits the actual source chain and mutates each boundary to prove the cross-boundary safeguards fail the gate when removed.

## FUMA-027 handoff

FUMA-026 supplies the authority-binding primitives that FUMA-027 can consume when making editor persistence multi-site. FUMA-027 owns:

- mounting hosted editor surfaces under canonical scoped context;
- threading bound site authority through the current editor persistence APIs and server repositories;
- converting the relevant FUMA-025 coverage obligations into real hosted resource implementations;
- proving drafts, media, design state, publishing, plugins, and editor reloads cannot cross sites; and
- preserving the self-hosted Website behavior documented in `docs/reference/fuma-website-parity.md` without treating legacy one-site selection as hosted scope.

FUMA-027 must reuse these boundaries rather than deriving tenant scope from admin URLs, current-site globals, payload IDs, Redis resource names, or object paths.

## Evidence and non-claims

Implemented source and focused tests establish factory shapes, fail-closed validation, deterministic key separation, bound prefixes, plugin dispatch authority, and durable-job claim guards. They do **not** establish:

- live Redis cache, pub/sub, or lease behavior for FUMA-026 keys;
- live MinIO/S3 object operations through a FUMA-026-mounted route;
- live PostgreSQL HTTP or durable-job scope derivation;
- central registration of `createPostgresFumaScopedRouteBoundaryFactory` in the Studio server router;
- a mounted hosted plugin runtime using `bindFumaHostedPluginCalls`;
- complete conversion of the 36 FUMA-025 site-owned resource classes;
- hosted multi-site editor persistence or cross-site editor E2E acceptance; or
- a deployed cross-boundary end-to-end runtime.

The PostgreSQL, Redis, and object-storage adapters exist elsewhere, but the FUMA-026 tests use fake, recording, or deterministic in-memory authority/transport implementations. No live Redis, MinIO, or PostgreSQL acceptance is claimed here.

The dedicated gate `apps/studio/src/__tests__/architecture/fuma-runtime-boundary-scoping.test.ts` audits the production HTTP, runtime-key, object-key, plugin, job, and bound-site-repository sources. Its hostile mutations prove that recursive normalized claim rejection, active-scope checks, frozen/versioned keys, plugin `grantedPermissions`, scoped dispatch, current status/claimant validation, organization-job separation, handler wrapping, and owner revalidation cannot be removed silently.

Final acceptance evidence (2026-07-25):

- consolidated request-context, HTTP, coordination/object-key, plugin, durable-job, integration, and architecture suite: **60 passed, 0 failed, 547 assertions** across 10 files;
- durable future-expiry regression subset: **22 passed, 0 failed, 120 assertions**, including null, malformed, expired, wrong-worker, wrong-fence, completed, and renewed same-fence claims;
- independent pinned `gpt-5.6-sol` security re-audit: **READY**;
- root build: passed all three shared-package typechecks and Studio `tsc -b` plus Vite with **2,046 modules transformed**;
- root lint and `git diff --check`: passed;
- architecture catalog: **106** real gates with the FUMA-026 gate cataloged;
- full repository suite after correcting the legacy dialect scanner to preserve the ratified PostgreSQL-only `server/fuma/` boundary: **7,059 passed, 8 environment skips, 25 historical unrelated failures, 145,563 assertions across 7,092 tests**.

The full-suite failures remain the established unrelated plugin-worker, canvas-control, module-size, CSS-token, circular-dependency, and bundle-size baseline. FUMA-026 introduced no full-suite failure. The environment-gated Redis, MinIO, and PostgreSQL suites remained skipped, so this evidence does not claim live-provider or deployed browser acceptance.

## Forbidden patterns

- Constructing `FumaRepositoryScope` from route descendants, request headers/body, plugin payloads, job payloads, Redis resources, or object paths.
- Passing raw tenant/resource IDs to deployment-level Redis keyspace methods for hosted tenant work.
- Omitting profile, capability, owner generation, or explicit version from a site-scoped cache/pub-sub/lease authority.
- Creating object keys from caller-provided physical prefixes or accepting a foreign prefix in `logicalKey(...)`.
- Dispatching a hosted plugin call without recursive normalized claim rejection, required plugin `grantedPermissions`, target capability checks, and current-scope re-derivation.
- Sending hosted authority inside plugin payloads instead of out-of-band dispatcher authority.
- Wrapping legacy self-host plugin calls in invented hosted scope.
- Giving organization jobs a site scope/repository or allowing site work after claim expiry, cancellation, status/claimant change, stale fence, or ownership change.
- Claiming central runtime mounting, live-provider acceptance, 36-class conversion, or multi-site editor persistence from the focused FUMA-026 tests.

## Related

- `docs/reference/fuma-request-context.md` — trusted FUMA-021 request and durable-job context authority.
- `docs/reference/fuma-repository-scoping.md` — FUMA-025 exact repository scope and coverage obligations.
- `docs/reference/fuma-redis-coordination.md` — deployment-level Redis keyspace and coordination semantics.
- `docs/reference/fuma-object-storage.md` — canonical object key policy and immutable object operations.
- `docs/reference/fuma-durable-jobs.md` — durable claims, fences, effects, and worker/scheduler integration.
- `docs/reference/fuma-website-parity.md` — current Website editor baseline and FUMA-027 multi-site persistence boundary.
- Source-of-truth files: `apps/studio/server/fuma/context/middleware.ts`, `apps/studio/server/fuma/context/composition.ts`, `apps/studio/server/fuma/runtime/scopedKeys.ts`, `apps/studio/server/fuma/objectStorage/scopedKeys.ts`, `apps/studio/server/fuma/plugins/callBoundary.ts`, `apps/studio/server/fuma/jobs/integration.ts`
- Focused tests: `apps/studio/src/__tests__/fuma/httpRepositoryScopeBoundary.test.ts`, `apps/studio/src/__tests__/fuma/scopedKeys.test.ts`, `apps/studio/src/__tests__/fuma/pluginCallBoundary.test.ts`, `apps/studio/src/__tests__/fuma/jobScopeBoundary.test.ts`
- Gate test: `apps/studio/src/__tests__/architecture/fuma-runtime-boundary-scoping.test.ts`

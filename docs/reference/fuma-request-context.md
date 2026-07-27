# Fuma Request and Job Context

This reference defines how hosted request and durable-job authority becomes an immutable Fuma context.

The context layer validates untrusted selectors, joins them to server-owned authority, resolves profile capabilities and permissions, and emits a detached snapshot for downstream code. Its source of truth is `apps/studio/server/fuma/context/`.

---

## TL;DR

- `apps/studio/server/fuma/context/requestContext.ts` derives staff request authority from a same-origin hosted session plus an exact server-side site lookup.
- `apps/studio/server/fuma/context/jobContext.ts` derives internal-job authority from a validated persisted `FumaJobRecord` plus `FumaJobContextAuthority`; job payload and HTTP headers are never authority.
- Site jobs recompose the registered profile, capability overrides, registered job contribution, and FUMA-020 permissions before execution.
- Organization-only jobs use an explicit organization context. They have no workspace, site, profile, or capability fields.
- Missing records, cross-tenant substitutions, disabled job capabilities, and denied required permissions produce the same closed denial.
- Contexts are detached, deeply frozen snapshots. Callers retain mutable ownership of their input objects.

## Public surface

Import the server context API through its barrel:

```ts
import {
  deriveFumaJobContext,
  deriveFumaRequestContext,
  type FumaJobContext,
  type FumaRequestContext,
} from './server/fuma/context'
```

`apps/studio/server/fuma/context/index.ts` exports the contracts, request resolver, and job resolver. Files inside `apps/studio/server/fuma/context/` use relative imports; consumers use the barrel.

## Trusted derivation

### Staff requests

`deriveFumaRequestContext` in `apps/studio/server/fuma/context/requestContext.ts` follows this order:

```text
same-origin hosted session
  → untrusted route-scope validation
  → exact server-side site authorization lookup
  → profile/capability composition
  → FUMA-020 layered permission resolution
  → detached frozen FumaRequestContext
```

Route parameters select a candidate resource; they do not prove actor, ancestry, profile, capabilities, or permissions. Tenant authority headers are rejected, the request body is not read, and the request ID comes from the server-side generator.

### Scoped HTTP boundary

`createFumaScopedRouteBoundary` in `apps/studio/server/fuma/context/middleware.ts` owns the complete `/api/fuma/organizations/:organizationId/workspaces/:workspaceId/sites/:siteId` prefix and declaratively dispatches descendants. Its mutation-Origin policy is a mandatory injected composition dependency; `POST`, `PUT`, `PATCH`, and `DELETE` requests must pass it before session lookup, body parsing, or handler work. Missing or foreign origins return `403 { error: 'Origin not allowed.' }`; `GET` does not invoke the policy.

After Origin validation, the boundary rejects caller authority in headers or at any depth of a JSON body before trusted context derivation. Reserved claims include actor/session/job correlation, role assignments, protected-owner invariants, scopes, profile/capability/permission authority, and request IDs; a generic `x-request-id` is ignored and replaced by the server-generated ID, while `x-fuma-request-id` is denied as an authority claim. The boundary parses a clone through `readValidatedBody`, so inspection never consumes the handler's request body. Path/authority/header/body substitutions and denied required permissions collapse to the same non-leaking `404`, while a genuinely absent hosted session remains `401`. `createFumaScopedRouteBoundary` then derives an active `FumaRepositoryScope` with server-owned owner-key authority. Handlers receive the original request, frozen descendant params, detached frozen context, and frozen repository scope together; every response receives the server-generated request ID.

### Internal jobs

`deriveFumaJobContext` in `apps/studio/server/fuma/context/jobContext.ts` follows this order:

```text
persisted FumaJobRecord validation
  → active durable-claim validation
  → trusted lookup by job ID + organization ID + site ID + job kind
  → exact authority binding
  → capability/job contribution + permission resolution
  → detached frozen FumaJobContext
```

The lookup receives this bounded selector:

```ts
type FumaJobAuthorityLookupInput = Readonly<{
  jobId: string
  organizationId: string
  siteId: string | null
  jobKind: string
}>
```

It does not receive `payload`. A payload object containing actor IDs, tenant IDs, profile IDs, capabilities, permissions, or request IDs has no effect on derivation. `FumaJobRecordSchema` in `apps/studio/server/fuma/jobs/contracts.ts` validates the persisted record before any authority lookup.

A site job is accepted only when all of these facts agree:

1. The durable record is a canonical `running` claim: non-blank worker, positive canonical fence, attempt within its maximum, no completion timestamp, and `claimExpiresAt` strictly later than the injected trusted clock.
2. The durable record's organization and site match the authoritative organization and site.
3. Platform, organization, workspace, site, profile, capability, and permission records repeat the same exact ancestry.
4. Every lifecycle layer and the assigned profile are active.
5. The registry-composed profile contains exactly one job contribution whose ID or handler ID matches the persisted job kind.
6. The composed contribution's required permission is allowed by `resolveLayeredPermissions` in `apps/studio/server/fuma/permissions/resolver.ts`.

A capability override that removes the job contribution makes the job unavailable and derivation denies it. The payload cannot restore the capability or substitute another permission.

## Organization-only jobs

A durable record with `siteId: null` cannot receive a fabricated site. Its result is the `kind: 'organization'` branch of `FumaJobContext`:

```ts
type FumaOrganizationJobContext = Readonly<{
  kind: 'organization'
  scope: {
    platform: FumaPlatformContextScope
    organization: FumaOrganizationContextScope
  }
  // actor, source, requestId, originatingRequestId, permissions,
  // and requiredPermission are also present.
}>
```

The trusted authority binds the persisted job kind to one organization-scoped permission. `resolvePermission` evaluates that permission and the remaining organization permission catalog from server-owned role assignments and overrides. The branch has no `workspace`, `site`, `profile`, or `capabilities` property. Code requiring site authority must narrow `context.kind === 'site'` and deny the organization branch.

`FumaTrustedContext` wraps request and job snapshots with a top-level `kind: 'request' | 'job'` discriminator when one consumer accepts both sources. `FumaJobContext` independently discriminates site and organization jobs through `kind: 'site' | 'organization'`.

## Correlation semantics

Internal execution IDs come only from the persisted job ID and current durable fence:

```text
requestId = <jobId>:request:<fence>
runId     = <jobId>:run:<fence>
source.correlationId = requestId
```

The same durable claim produces the same IDs; a reclaimed job with a new fence produces a new request/run pair. `actor.jobId` and `source.jobId` retain the durable job ID.

`originatingRequestId` is separate. It is accepted only from the trusted authority lookup and may be `null`; a similarly named payload field is ignored. This separation prevents an enqueueing request from controlling the worker's internal correlation ID while retaining a validated request-to-job link for FUMA-022 audit recording.

## Threat model and uniform denial

The hostile inputs are:

- route parameters and tenant-related request headers;
- request bodies;
- durable job payload JSON and malformed, incomplete, over-attempted, non-canonical, or expired durable claims;
- lower-level IDs that collide across organizations;
- stale, incomplete, or cross-tenant authority joins;
- disabled capability contributions and missing permissions.

Request derivation reserves `401` for a genuinely absent hosted session and collapses tenant existence/authorization failures to the same `404` response through `FumaRequestContextResolutionError`. The scoped HTTP boundary separately rejects a missing or foreign mutation Origin with `403` before authentication, so the Origin response cannot reveal tenant existence.

Job derivation exposes one `FumaJobContextResolutionError` shape for malformed or inactive durable claims, missing authority, lookup failure, cross-tenant records, unavailable job contributions, and denied permissions:

```text
code: denied
message: Internal job authority denied.
```

Workers log operational detail at the trusted boundary without putting tenant-existence distinctions into job-visible errors. Neither resolver falls back to payload, headers, profile defaults, or singleton tenant records after denial.

## Immutable snapshots

`freezeFumaRequestContext` in `apps/studio/server/fuma/context/contracts.ts` and job-context freezing in `apps/studio/server/fuma/context/jobContext.ts` validate, clone, and recursively freeze the final snapshot. Inputs supplied by authenticators, repositories, and authority adapters are not frozen or reused. Mutation after derivation cannot alter the context.

## Downstream boundaries

### FUMA-022 audit handoff

The context exposes the actor, exact/bounded scope, deterministic internal correlation, durable job ID/run ID, and trusted `originatingRequestId` needed by FUMA-022. This module does not write audit events. Audit persistence must consume the frozen context and must not reconstruct actor or tenant authority from request headers or job payload.

### FUMA-025 repository scoping

The context is authorization evidence, not a replacement for scoped persistence. `deriveFumaRepositoryScope` in `apps/studio/server/fuma/tenancy/repositoryScope.ts` accepts only a frozen trusted request or site-job snapshot, resolves the stable owner key by exact platform/organization/workspace/site coordinates, and returns one detached frozen `FumaRepositoryScope`. Organization-only jobs are denied rather than receiving an invented site. Missing, malformed, cross-tenant, or failed owner authority collapses to one non-enumerating denial.

The scope carries every hosted repository predicate plus owner generation/state/transfer fence. It is distinct from legacy self-host `SELF_HOST_SITE_ID`, which remains an explicit selector for preserved one-site data. FUMA-026 binds this scope through production-shaped HTTP, cache-key, object-key, plugin-call, and durable-job factories documented in `docs/reference/fuma-runtime-boundary-scoping.md`. The central Studio router and hosted product composition root do not mount those factories yet. See `docs/reference/fuma-repository-scoping.md` for the 36-class coverage registry, workspace/site transaction predicates, evidence limits, and the current physical workspace-ID collision limitation.

### Boundary composition

Worker handler registration, command dispatch, audit event writes, and repository adapters remain outside `apps/studio/server/fuma/context/`. `FumaJobScopeBoundary` and `createFumaJobWorkerComponentFactory` in `apps/studio/server/fuma/jobs/integration.ts` wrap declared handlers with trusted context and repository scope, but the central hosted product composition remains deferred. Any mounted command explicitly narrows organization versus site context; it never uses payload claims, synthesizes a site for organization work, or bypasses a denied required permission.

## Forbidden patterns

- Mounting a mutating scoped HTTP route without an injected product-host Origin policy.
- Reading actor, tenant, profile, capability, permission, or request-ID authority from request headers or JSON bodies.
- Letting body inspection consume the request before a handler receives it.
- Reading actor, tenant, profile, capability, permission, correlation, or required-permission claims from `FumaJobRecord.payload`.
- Passing the job payload into `FumaJobContextAuthority.loadTrustedJobAuthority`.
- Deriving worker authority from a claim whose canonical fence/attempt/worker fields are incomplete or whose lease has expired at the trusted clock.
- Looking up a site by `siteId` without also binding its organization and workspace ownership.
- Treating a registered job kind as executable after its contributing capability is revoked.
- Inventing workspace/site/profile values for `siteId: null` jobs.
- Reusing an enqueueing request ID as the worker's internal request ID.
- Passing an organization context to a site-scoped repository or command.
- Mutating or extending a frozen context after derivation.

## Related

- `docs/reference/fuma-stable-context.md` — hosted URL selection and the untrusted route boundary.
- `docs/reference/fuma-repository-scoping.md` — exact FUMA-025 persistence scope consumed by the FUMA-026 boundary factories.
- `docs/reference/fuma-runtime-boundary-scoping.md` — implemented HTTP, key, object, plugin, and job factories plus central-mount non-claims.
- `docs/reference/fuma-permissions.md` — FUMA-020 permission catalogs and resolver precedence.
- `docs/reference/fuma-durable-jobs.md` — PostgreSQL job authority, claims, fences, and Redis readiness.
- `docs/reference/fuma-platform-architecture.md` — tenant ancestry and hosted topology policy.
- Source-of-truth context files: `apps/studio/server/fuma/context/`
- Persisted job contract: `apps/studio/server/fuma/jobs/contracts.ts`
- Focused tests: `apps/studio/src/__tests__/fuma/requestContextResolution.test.ts`, `apps/studio/src/__tests__/fuma/trustedJobContext.test.ts`

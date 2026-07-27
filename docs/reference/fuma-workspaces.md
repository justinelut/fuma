# Fuma Workspace HTTP Boundary

This reference defines the injectable HTTP boundary for organization-owned workspace lifecycle routes.

The source of truth is `server/fuma/workspaces/handlers.ts`. It parses the organization and workspace scope from the URL, resolves an authenticated actor through a trusted callback, applies a caller-supplied mutation Origin policy, and delegates authorization-aware operations through `AuthorizedWorkspaceServicePort`.

---

## TL;DR

- `createWorkspaceHandlerBoundary` owns `/api/fuma/organizations/:organizationId/workspaces` and its item/action routes.
- Actor identity comes only from the injected `resolveActor(request)` callback. Request bodies and ad hoc actor headers are never identity sources.
- The URL owns `organizationId` and `workspaceId`; bodies cannot override either value.
- The injected `AuthorizedWorkspaceServicePort` receives the actor on every call and is responsible for membership/capability authorization before delegating to domain services.
- POST and PATCH requests pass the injected `allowsMutationOrigin(request)` policy before actor resolution or service work.
- Route params, request bodies, actor context, and success envelopes are validated with TypeBox. JSON bodies use `readValidatedBody`; the handler never calls `request.json()`.
- The boundary is intentionally not mounted in `server/router.ts`. FUMA-021 now supplies immutable site-scoped HTTP context and the mandatory injected mutation-Origin pattern; a production workspace adapter still requires FUMA-025 scoped repository/service authority before central mounting.

## Route surface

All successful responses use `application/json` and `cache-control: no-store`.

| Method | Path | Body | Success |
|---|---|---|---|
| `GET` | `/api/fuma/organizations/:organizationId/workspaces` | none | `200 { workspaces }` |
| `POST` | `/api/fuma/organizations/:organizationId/workspaces` | `{ id, slug, name, isDefault? }` | `201 { workspace }` |
| `GET` | `/api/fuma/organizations/:organizationId/workspaces/:workspaceId` | none | `200 { workspace }` |
| `PATCH` | `/api/fuma/organizations/:organizationId/workspaces/:workspaceId` | a non-empty subset of `{ slug, name, isDefault }` | `200 { workspace }` |
| `POST` | `/api/fuma/organizations/:organizationId/workspaces/:workspaceId/set-default` | absent or `{}` | `200 { workspace }` |
| `POST` | `/api/fuma/organizations/:organizationId/workspaces/:workspaceId/archive` | absent or `{}` | `200 { workspace }` |
| `POST` | `/api/fuma/organizations/:organizationId/workspaces/:workspaceId/restore` | absent or `{}` | `200 { workspace }` |

Unsupported methods return a `405` JSON error envelope and an `Allow` header. Paths under the owned workspace prefix that do not match this surface return a `404` JSON error envelope. Requests outside the prefix return `null` so a composition root can continue routing.

## Boundary shape

`server/fuma/workspaces/handlers.ts` exports the injectable contract:

```ts
const boundary = createWorkspaceHandlerBoundary({
  service: authorizedWorkspaceService,
  resolveActor: trustedRequestContext.resolveWorkspaceActor,
  allowsMutationOrigin: sameOriginPolicy.allows,
})

const response = await boundary.handle(request)
```

The names in this example represent composition-root dependencies, not repository singletons. No concrete composition root exists in this module.

`resolveActor` returns `unknown` so the boundary must validate it against `WorkspaceHandlerActorSchema`. A missing actor produces `401 { error: 'Authentication required' }`; a malformed value from the trusted resolver is an internal integration failure. The actor shape contains only the trusted `userId`. Organization authorization remains a service concern because authentication alone does not grant access to every organization.

`allowsMutationOrigin` is mandatory and belongs to the caller. The boundary does not invent a product host or read global configuration. A false result produces `403 { error: 'Origin not allowed' }` before body parsing or service delegation. GET requests do not invoke this mutation policy.

## Exact scope

The path is the sole tenant-scope authority:

- create bodies cannot contain `organizationId`;
- update bodies cannot contain `organizationId` or `workspaceId`;
- action bodies cannot contain actor or scope fields;
- service inputs receive the path-derived organization and item identifiers;
- every returned workspace is checked against the requested organization;
- item responses are also checked against the requested workspace ID.

A service response outside that exact scope is treated as an internal error rather than serialized. This prevents a buggy service adapter from leaking a workspace from another organization.

The structural `AuthorizedWorkspaceServicePort` deliberately differs from the domain-only `WorkspaceService` in `server/fuma/workspaces/service.ts`: each port method also receives `WorkspaceHandlerActor`. A composition adapter must authorize that actor for the exact organization/workspace operation, then delegate the validated domain input to `WorkspaceService`. Do not adapt by discarding the actor without an authorization check.

## Validation and errors

Request bodies use the exported boundary schemas:

- `WorkspaceCreateRequestBodySchema` excludes path scope and actor identity;
- `WorkspaceUpdateRequestBodySchema` requires at least one mutable field;
- `WorkspaceActionRequestBodySchema` accepts only an empty object when a body is present.

The boundary constructs the full domain inputs from validated bodies plus validated path params. Success data is validated against `WorkspaceRecordSchema` before serialization. Failures always use `{ error: string }`.

`WorkspaceDomainError` maps invalid input to `400`, missing or organization-mismatched records to `404`, and conflicts/lifecycle guards to `409`. An authorization-aware adapter can throw `WorkspaceHandlerError` with `400`, `401`, `403`, `404`, or `409`. Unknown failures and invalid service responses are logged with the `[fuma-workspaces]` prefix and return a non-diagnostic `500` envelope.

## Composition seam

`server/fuma/workspaces/index.ts` exports contracts, repository, service, access policy, membership overrides, handlers, and schema manifest as the workspace module API. `server/fuma/workspaces/handlers.ts` does not import or modify `server/router.ts`.

The current boundary remains unmounted. FUMA-021 provides the immutable context contracts, trusted session derivation, exact-ancestry checks, and injected Origin-policy pattern. Production mounting still requires a scoped composition adapter that supplies:

1. a trusted session/request-context projection of `{ userId }`;
2. the product-host mutation Origin policy;
3. an authorization-aware `AuthorizedWorkspaceServicePort` backed by FUMA-025-scoped repository/service operations;
4. the boundary's nullable `handle(request)` result in the central router.

Mounting the handler earlier with actor IDs copied from headers or request JSON would bypass that ownership boundary.

## Forbidden patterns

- Reading actor/user IDs from the workspace request body or an ad hoc request header.
- Letting a create/update/action body override path-derived organization or workspace scope.
- Passing authenticated actors to the domain service without organization/workspace authorization.
- Calling `request.json()` instead of `readValidatedBody`.
- Returning unchecked service records or cross-organization list entries.
- Hard-coding an Origin in the handler instead of injecting the host policy.
- Mounting this boundary in `server/router.ts` before the FUMA-021 immutable request context exists.
- Returning plain text, provider-specific failures, or any shape other than `{ error: string }` on errors.

## Related

- `docs/reference/fuma-platform-architecture.md` — tenant hierarchy and request-context boundaries.
- `docs/reference/fuma-organizations.md` — organization policy and membership authority.
- `docs/reference/typebox-patterns.md` — TypeBox HTTP boundary patterns.
- Source-of-truth handler: `server/fuma/workspaces/handlers.ts`
- Workspace module barrel: `server/fuma/workspaces/index.ts`
- Domain service: `server/fuma/workspaces/service.ts`
- Access policy: `server/fuma/workspaces/accessPolicy.ts`
- Contract tests: `src/__tests__/fuma/workspaceHandlers.test.ts`

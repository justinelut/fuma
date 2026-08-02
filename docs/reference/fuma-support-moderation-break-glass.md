# Fuma support, moderation, and break-glass authority

The FUMA-072 authority provides bounded support impersonation, immutable moderation evidence, and isolated protected-owner recovery inside the existing hosted Studio boundary.

`apps/studio/server/fuma/supportOperations/` is the source of truth. It reuses Better Auth identity and sessions, the canonical scoped request context, tenant object storage, the audit service, and OCI Email Delivery rather than creating parallel authorities.

---

## TL;DR

- A current non-owner internal administrator with a fresh five-minute step-up may start one support session for one exact tenant and one current customer target.
- Better Auth creates and restores the impersonated identity. Its canonical `auth_sessions.expires_at` is tightened to the requested lifetime, which cannot exceed 30 minutes.
- The Studio shell displays a persistent impersonation warning; the support workspace displays the immutable reason and exact expiry.
- Support cannot target the protected owner, another internal staff account, an inactive account, or the actor. Nesting and authority elevation are denied.
- `/support/actions` records authorization evidence only. Product mutations still run through their ordinary target-authorized APIs.
- Moderation is an append-only `opened -> suspended/resolved` and `suspended -> appealed/resolved` lineage. User suspension delegates to Better Auth ban/unban.
- Protected-owner recovery is separate from impersonation and ordinary APIs. It requires a requester, exactly two distinct current approvers, and a separate executor.
- Production password-reset delivery uses the existing OCI Email Delivery configuration. The fake inbox is selected only outside production.
- Migration `000076_support_operations_authority` owns the durable tables, locks, constraints, and append-only triggers.

## Runtime shape

Production composition lives in `apps/studio/server/index.ts`:

```text
one hosted scoped API boundary
  -> support-only route authorization overlay
  -> SupportOperationsService
     -> PostgresSupportOperationsRepository
     -> PostgresSupportAuthorityResolver
     -> BetterAuthSupportImpersonationAuthority
     -> PostgresModerationMutationAuthority
     -> BetterAuthOwnerRecoveryAuthority
     -> ObjectStorageSupportEvidenceAuthority
     -> AuditService
```

`apps/studio/server/fuma/context/middleware.ts` permits a server-owned route declaration to provide a route-local `FumaSiteAuthorizationAuthority`. FUMA-072 supplies `PostgresSupportRouteAuthorizationAuthority`; all ordinary scoped routes continue using `PostgresFumaSiteAuthorizationAuthority` unchanged.

The overlay grants only a synthetic route-local `site.read` viewer assignment when either:

- the exact Better Auth session belongs to a current `auth_staff_profiles` account whose global Better Auth role contains `admin`, whose account is active, and whose email is not the protected-owner email; or
- the exact unexpired Better Auth session is a bounded impersonation of a non-staff, non-protected target.

This lets internal support staff reach an exact managed customer site without making them customer members or granting protected-owner authority. `SupportOperationsService` still revalidates direct internal capabilities, the originating staff session, the target's current permission, scope, owner generation, and operation-specific exclusions. Revoking the staff authority stops support actions; the bounded impersonated identity can still reach the end-session path to restore the original identity.

## Support session lifecycle

The canonical flow is:

1. Select an active organization/workspace/site from the trusted Studio catalog.
2. Submit `supportSessionId`, target user, reason, duration, and immutable evidence reference.
3. `SupportOperationsService.beginSupport` requires a direct non-owner internal staff session and a step-up no older than five minutes.
4. `ObjectStorageSupportEvidenceAuthority` verifies the exact tenant object key, SHA-256, and `application/json` metadata.
5. PostgreSQL serializes creation by exact tenant and staff actor. Only one active support session can exist for that actor and scope.
6. Better Auth performs impersonation and returns cookie mutations. `server/auth/hosted/auth.ts` tightens the created canonical session to the exact support expiry before returning it.
7. `HostedStaffShell.tsx` displays the persistent warning whenever `currentSession.session.impersonatedBy` is present.
8. The impersonated identity ends support through Better Auth. The response restores the originating staff cookie and appends end evidence.

The session lifetime is at most 30 minutes. Expired, ended, wrong-generation, nested, self, protected-owner, staff-target, inactive-target, stale-step-up, and second-active-session requests fail closed.

## Support actions do not tunnel mutations

`POST /support/actions` accepts a bounded operation ID, target capability, and strict TypeBox JSON input. `SupportOperationsService.authorizeSupportAction`:

- correlates the exact Better Auth impersonation to the support evidence;
- revalidates the originating staff account and exact original staff session;
- revalidates the target's current exact-site capability;
- rejects `internal.*`, `platform.*`, `support.*`, `owner.*`, `protected-owner.*`, `break-glass.*`, and `moderation.*` namespaces;
- stores only the input hash and immutable authorization evidence.

It does not execute an arbitrary payload or call a generic mutation port. The normal product API remains responsible for validating and applying the requested target-authorized mutation.

## Moderation lineage

`SupportOperationsService.recordModeration` requires direct internal moderation authority and fresh step-up. Evidence is exact-tenant, immutable, and linked by `priorEvidenceId`:

```text
none/resolved -> opened
opened        -> suspended | resolved
suspended     -> appealed  | resolved
appealed      -> suspended | resolved
```

The moderation, suspension, and appeal queues expose only the latest event for each subject. Pagination uses evidence IDs inside the exact tenant and owner generation. User `suspended` and `resolved` events delegate to Better Auth ban and unban; other subject kinds retain the immutable overlay for their owning domain authority to consume.

## Isolated protected-owner recovery

Break glass is not a support action and cannot be called through an ordinary product mutation API. The flow is:

1. A direct, stepped-up, non-owner internal requester opens a request for the current protected owner. The request expires in at most 15 minutes.
2. Two different direct non-owner staff accounts approve from two exact current Better Auth sessions. Neither may be the requester or target.
3. A separate direct non-owner executor submits the execution.
4. Execution revalidates the target, request expiry, both approvers, their exact recorded session IDs, and their five-minute step-up evidence.
5. `BetterAuthOwnerRecoveryAuthority` revokes the protected owner's Better Auth sessions and requests a password reset once under a durable idempotency key.

Production hosted auth uses `apps/studio/server/auth/hosted/ociDelivery.ts`, which accepts only HTTPS reset/verification URLs on the configured product host and submits through the existing `OciEmailDeliveryAdapter`. Non-production composition uses `createHostedAuthFakeInbox`; source-only tests do not claim an external provider delivery receipt.

## Persistence

`apps/studio/server/fuma/db/migrations/000076_support_operations_authority.ts` creates:

```text
fuma_support_sessions_v2
fuma_support_session_ends_v2
fuma_support_actions_v2
fuma_moderation_evidence_v2
fuma_break_glass_requests_v2
fuma_break_glass_approvals_v2
fuma_break_glass_executions_v2
fuma_support_operation_effects_v2
fuma_support_operation_locks_v2
```

The eight evidence tables reject both update and delete through 16 triggers. Advisory transaction locks serialize active support creation, moderation heads, and approvals. Durable lock rows serialize external effects. The finalized migration checksum is:

```text
bafa690ed6e28b161036b235d55c098534e61af929c31824f35a6541ae5ce60e
```

FUMA-WEB-013 now follows this migration as canonical `000077_public_handoff_authority`; the next slot is `000078_release_followup`.

## Studio surface

The Studio-local, Tailwind-free implementation is under:

```text
apps/studio/src/admin/fuma/supportOperations/
apps/studio/src/admin/preauth/HostedStaffShell.tsx
```

The route is:

```text
/admin/organizations/:organizationId/workspaces/:workspaceId/sites/:siteId/internal/support
```

The target is accepted only when the exact active site exists in the trusted accessible catalog. `SupportOperationsHttpClient` validates every response with strict TypeBox schemas. CSS is local to `SupportOperationsRouteContent.module.css`; no shared application UI or app-to-app import is introduced.

## Forbidden patterns

- Do not create another identity, session, impersonation, or protected-owner credential store.
- Do not grant `support.access`, protected-owner, or broad customer membership to internal support actors to enter these routes.
- Do not move the support-only route overlay onto ordinary scoped routes.
- Do not accept actor, tenant, owner, permission, session, or impersonator authority from headers or request bodies.
- Do not execute arbitrary JSON through `/support/actions`.
- Do not permit nested impersonation, staff targets, protected targets, self targets, or expired support sessions.
- Do not update or delete evidence rows; append a linked transition or end record.
- Do not reduce recovery to one approver, reuse requester/approver/executor identities, or skip exact-session revalidation.
- Do not use the fake inbox in production or claim external OCI delivery without provider evidence.
- Do not add Zod, Tailwind to Studio, app-to-app imports, or another scoped API boundary.

## Verification

Run the focused gates:

```sh
bun test apps/studio/src/__tests__/fuma/supportOperations.test.ts \
  apps/studio/src/__tests__/fuma/hostedAuthOciDelivery.test.ts \
  apps/studio/src/__tests__/admin/fumaSupportOperations.test.tsx \
  apps/studio/src/__tests__/architecture/fuma-support-operations.test.ts
```

Run migration assertions without PostgreSQL, or set `FUMA_TEST_POSTGRES_URL` to a dedicated native PostgreSQL database for isolated-schema concurrency, route-overlay, immutability, and cleanup acceptance:

```sh
bun test apps/studio/src/__tests__/fuma/supportOperationsPostgresAcceptance.test.ts
```

## Related

- [`fuma-hosted-staff-auth.md`](fuma-hosted-staff-auth.md) — Better Auth session and host-only cookie composition
- [`fuma-hosted-staff-security.md`](fuma-hosted-staff-security.md) — browser auth and protected administrator operations
- [`fuma-request-context.md`](fuma-request-context.md) — trusted scoped request derivation
- [`fuma-object-storage.md`](fuma-object-storage.md) — exact tenant immutable evidence objects
- [`fuma-audit-history.md`](fuma-audit-history.md) — append-only audit recording and listings
- Source of truth: `apps/studio/server/fuma/supportOperations/`
- Hosted composition: `apps/studio/server/index.ts`
- Migration: `apps/studio/server/fuma/db/migrations/000076_support_operations_authority.ts`
- Architecture gate: `apps/studio/src/__tests__/architecture/fuma-support-operations.test.ts`
- Native PostgreSQL gate: `apps/studio/src/__tests__/fuma/supportOperationsPostgresAcceptance.test.ts`

# Fuma hosted staff authentication

Same-origin staff identity routes and pre-authentication UI for the Fuma product host.

## TL;DR

Fuma mounts an allowlisted Better Auth surface only on `https://app.trimly.co.ke`. Staff sessions use the host-only `__Host-fuma_staff` cookie with `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, and no `Domain`. The existing self-hosted Instatic authentication path remains selected unless hosted mode is enabled.

## Boundaries

The canonical server configuration remains in `server/auth/hosted/auth.ts`. `server/auth/hosted/routes.ts` is the HTTP security boundary: it checks the exact URL origin and `Host`, requires the product origin for mutating requests, and exposes only signup, login, logout, session, verification, and password-reset endpoints.

`server/auth/hosted/runtime.ts` composes the PostgreSQL adapter and route boundary. `server/router.ts` mounts that boundary before the current CMS routes only when `FUMA_HOSTED=true` initialized it in `server/index.ts`. Organization, admin, and MFA plugin endpoints are not reachable through this surface.

The browser contract lives in `src/core/fuma/auth/`. `src/admin/preauth/HostedStaffPreAuth.tsx` implements signup, verification resend, login, reset request, and reset completion. `src/admin/preauth/HostedStaffShell.tsx` is the authenticated shell. Server-selected `window.__fumaHostedStaffAuth` chooses this flow without probing or replacing the existing self-hosted boot path.

## Cookie and request policy

The session cookie is named `__Host-fuma_staff` in production. Better Auth's automatic secure-name prefix is disabled because Fuma supplies the complete `__Host-` name; the required security attributes are still explicit on every session-cookie write and deletion. Responses are rejected if Better Auth emits a staff cookie with a `Domain`, a missing required attribute, or an unexpected policy.

The boundary returns `404` for customer hosts, `trimly.co.ke`, mismatched `Host` values, and deferred Better Auth endpoints. Mutating requests without the exact product `Origin` return `403`. Session and login response bodies remove bearer-token fields; the cookie remains the only browser credential.

## Identity safety

Signup, verification resend, and password-reset request responses do not reveal whether an identity exists. Signup requires email verification before a staff session is issued. Password reset revokes existing sessions. The FUMA-011 SHA-256 token-at-rest adapter remains below this route boundary.

`server/auth/hosted/fakeInbox.ts` is a deterministic, process-local delivery seam for tests and demos; it has no HTTP endpoint. Tenant/system email provider delivery is owned by the later email-delivery tasks.

## Verification

`src/__tests__/fuma/hostedStaffAuth.test.ts` covers the complete signup → fake-inbox verification → reload → reset → login → logout flow, exact cookie attributes, hostile-origin and host denial, enumeration-safe responses, session revocation, token-body omission, and no cookies on customer or marketing hosts.

`src/__tests__/server/staticAdmin.test.ts` verifies hosted shell selection and confirms that hosted HTML does not start the self-hosted setup/session preflight.

## Related

- [`fuma-staff-identity.md`](fuma-staff-identity.md)
- [`fuma-configuration.md`](fuma-configuration.md)
- [`fuma-platform-architecture.md`](fuma-platform-architecture.md)

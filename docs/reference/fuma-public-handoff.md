# Secure public-to-app handoff

FUMA-WEB-013 owns the transition from anonymous `trimly.co.ke` acquisition pages to authenticated customer work on `app.trimly.co.ke`. The implementation is in `apps/studio/server/fuma/publicHandoff`; it does not import Web UI, control-surface UI, or shared application UI.

## Boundary and flow

1. Web validates the closed `PublicHandoffRequestSchema` and sends it without visitor cookies to `POST /_fuma/private/public/v1/handoff`.
2. The existing private projection boundary enforces the exact internal Host, `fuma-public-web` audience, bearer credential, UUID request ID, no Cookie, no forwarded authorization, JSON content type, body limit, and no query. It returns only an opaque 256-bit intent, opaque correlation, and expiry.
3. `GET https://app.trimly.co.ke/resume?intent=…&correlation=…` validates the exact query. An existing app relying session may authorize the intent; otherwise the only redirect target is `https://auth.trimly.co.ke/handoff/authorize` with the two opaque values.
4. The auth host owns sign-up/sign-in, email verification, password reset, and TOTP continuation through its host-only `__Host-fuma_auth` cookie. It reuses canonical Better Auth users, credentials, and sessions but does not create `auth_staff_profiles` for customer sign-ups. The handoff boundary delegates only the explicit non-admin identity allowlist; Better Auth admin and organization endpoints are not mounted. Production verification/reset mail reuses OCI Email Delivery with exact `auth.trimly.co.ke` HTTPS links.
5. Auth consumes the intent once and redirects only to the fixed app `/resume` callback with a short-lived, app-audience auth code and state. The code records the exact originating Better Auth session; impersonated sessions are rejected. The browser sees a confirmation/cancellation page before exchange.
6. App exchanges the code once. The product re-resolves current profile, effective pricing plan/version, approved retained template release, or approved mediated expert authority. Only after successful re-resolution does it create an app relying session capped at 12 hours and at the originating Better Auth session expiry, then sets `__Host-fuma_app` with `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, and no `Domain`. Better Auth session deletion or a current account ban immediately invalidates and cascades the relying session.

Cancellation exists on both auth and app confirmation surfaces. It is same-origin POST-only, validates the closed TypeBox cancellation union, consumes the presented intent/code, and redirects only to the fixed marketing origin.

## Storage and security invariants

Migration `000077_public_handoff_authority` is additive and PostgreSQL-only, with canonical checksum `fb257b84c2e44b65212ef5227845c50524887248fb10732a6ec46a4b7dd53015`. It stores SHA-256 digests of intent, auth-code, and app-session bearer values; raw bearer values are returned once and never persisted. Intents and codes fix `audience='fuma-app'` and `callback_path='/resume'`, have independent expiries, bind codes and relying sessions to the exact Better Auth session by foreign key, and permit only one consumed or cancelled terminal state. Row locks serialize authorization, exchange, and cancellation. The append-only event table records opaque digests, event kind, closed public source, internal user ID when applicable, and timestamp—never email, password, arbitrary URL, referrer, payment, tenant, member, or staff/admin claims.

The public request is a strict closed union. Additional redirect, email, invitation, organization, user, admin-audience, or caller-attribution properties fail validation. Public and auth cookies do not authenticate the app host; member and admin cookies are separate realms. Exact Host checks prevent app routes on auth, admin, marketing, tenant, or attacker hosts.

## Failure behavior

Tampered, malformed, duplicate, expired, cancelled, replayed, revoked-identity-session, banned-account, impersonated-session, stale-authority, withdrawn-template, unavailable-plan, invalid-profile, and unapproved-expert transitions fail closed. User-facing errors do not distinguish token existence and do not reflect attacker input. Responses are `no-store`, deny framing and referrers, and restrict forms to the same origin.

## Focused validation

The focused ticket/OCI/migration selection passes **25 tests, 1 expected no-URL skip, 0 failures, 110 assertions**. The affected Studio projection/router/auth/security/architecture selection passes **204 tests, 4 expected optional skips, 0 failures, 921 assertions**. Native PostgreSQL 16 passes **2 tests / 25 assertions**, including eight-way intent/code/session contention, hash-only storage, two append-only mutation rejections, current-ban denial, exact Better Auth session revocation, and cleanup `role=0 schemas=0`. The complete isolated Web suite passes **95 tests / 557 assertions**. Strict Studio and Web TypeScript, warning-free changed-file lint, module-load smoke, Studio build (2,171 modules), Web build (31 pages/routes and unchanged 152,821 B acquisition budgets), migration manifest/checksum/next slot, diff, and lock gates pass. No external OCI message or browser acceptance is claimed. Any future browser acceptance must use `https://3002.blyss.co.ke` for public Web and `https://5174.blyss.co.ke` for Studio/app behavior; loopback results are not acceptance evidence.

## 2026-07-31 partial paid-handoff checkpoint

A strict TypeBox paid-handoff slice now projects explicit `en-KE`, KES, and `Africa/Nairobi` review facts; revalidates paid contract, destination, quota, policy, metering, source/destination identity, and outbox state; delegates all six asset choices to their existing registered owners; uses deterministic notification/audit keys; and narrows exact pending→delivered and failed→pending transitions. Focused service evidence passes 3 tests / 17 assertions, and strict Studio TypeScript/build/lint pass.

This partial checkpoint is superseded by the completed FUMA-074 implementation in `docs/reference/fuma-paid-handoff.md`. The canonical hosted `TransferService`, customer/admin Studio route and UX, native PostgreSQL contention/recovery acceptance, and approved-host managed-site/offer/payment/failure/recovery demonstration are now complete. FUMA-074 and Task 21 are conductor-closed at the latest tracker checkpoint.

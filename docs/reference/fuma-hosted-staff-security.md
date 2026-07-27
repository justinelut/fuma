# Fuma hosted staff security client contract

The browser contract for Fuma staff MFA, self-session management, and bounded administrator security actions.

`src/core/fuma/auth/client.ts` is the source of truth for browser request shapes and TypeBox-validated response envelopes. It calls the same-origin `/api/auth` surface through `apiRequest`; the server policy remains in `server/auth/hosted/routes.ts`.

---

## TL;DR

- Every success response is validated by a specific TypeBox schema inside `apiRequest`; the client does not use raw `fetch`, `res.json()`, or Zod.
- Password login returns either an authenticated result or an MFA challenge. The authenticated path confirms the cookie by calling `/get-session`.
- TOTP and recovery-code completion validate their token-free response, then call `/get-session` rather than consuming a bearer token.
- MFA setup returns a TOTP URI and one-time backup codes. Disable and recovery-code rotation require the current password.
- Self-session listing exposes opaque revocation handles; revoke-one sends the selected handle, while revoke-others and sign-out send no request body.
- Admin list, ban, and unban use the Better Auth admin envelopes. The server boundary owns fresh-session and protected-owner enforcement.
- `src/__tests__/fuma/hostedStaffAuthClient.test.ts` deterministically locks request methods, bodies, body omission, response envelopes, and token-leak rejection.

## Public shape

External callers import through `src/core/fuma/auth/index.ts`. The existing pre-authentication and security UI consumes these groups:

| Flow | Client functions | Result |
|---|---|---|
| Session | `getHostedStaffSession`, `logoutHostedStaff` | Cookie-backed session or `null`; logout is `void` |
| Signup and password | `signUpHostedStaff`, `loginHostedStaff`, `resendHostedStaffVerification`, `requestHostedStaffPasswordReset`, `resetHostedStaffPassword` | Validated user, login discriminant, or `void` |
| MFA challenge | `verifyHostedStaffTotp`, `verifyHostedStaffRecoveryCode` | Confirmed `HostedStaffSession` |
| MFA lifecycle | `beginHostedStaffTotp`, `disableHostedStaffTotp`, `regenerateHostedStaffRecoveryCodes` | Setup data, `void`, or new recovery codes |
| Self sessions | `listHostedStaffSessions`, `revokeHostedStaffSession`, `revokeOtherHostedStaffSessions` | Device-session list or `void` |
| Staff admin | `listHostedStaffUsers`, `setHostedStaffBan` | Staff list or updated user |

The names and return discriminants are consumed by `src/admin/preauth/HostedStaffPreAuth.tsx` and `src/admin/preauth/HostedStaffSecurity.tsx`. Change those consumers with the contract if this surface changes.

## Login and MFA state machine

`loginHostedStaff` validates one of two mutually exclusive `/sign-in/email` envelopes:

```ts
type HostedLoginResult =
  | Readonly<{ kind: 'authenticated'; session: HostedStaffSession }>
  | Readonly<{ kind: 'two-factor'; methods: readonly ('totp' | 'otp')[] }>
```

An MFA-enabled password login returns `{ twoFactorRedirect: true, twoFactorMethods }` and does not trigger `/get-session`; no staff session exists yet. A completed password login returns the token-free Better Auth login envelope, after which the client calls `/get-session` and returns `kind: 'authenticated'`.

`verifyHostedStaffTotp` and `verifyHostedStaffRecoveryCode` serve both challenge completion and reauthentication. Each validates the token-free `{ user }` completion envelope, then confirms and returns the cookie-backed session through `/get-session`. A completion response without a resulting session is an invariant error.

## Endpoint contract

All paths are relative to `/api/auth` and use `credentials: 'include'` through `src/core/http/apiClient.ts`.

| Endpoint | Method and request | Validated success body |
|---|---|---|
| `/get-session` | `GET`, no body | `null` or strict `{ session, user, needsRefresh? }` |
| `/sign-up/email` | `POST { name, email, password, callbackURL }` | strict `{ token: null, user }` |
| `/sign-in/email` | `POST { email, password }` | strict authenticated login or MFA challenge |
| `/two-factor/verify-totp` | `POST { code }` | strict token-free `{ user }` |
| `/two-factor/verify-backup-code` | `POST { code }` | strict token-free `{ user }` |
| `/two-factor/enable` | `POST { password }` | strict `{ totpURI, backupCodes }` |
| `/two-factor/disable` | `POST { password }` | strict `{ status: true }` |
| `/two-factor/generate-backup-codes` | `POST { password }` | strict `{ status: true, backupCodes }` |
| `/list-sessions` | `GET`, no body | strict device-session array |
| `/revoke-session` | `POST { token }` | strict `{ status: true }` |
| `/revoke-other-sessions` | `POST`, no body | strict `{ status: true }` |
| `/admin/list-users?limit=100` | `GET`, no body | strict `{ users, total }` |
| `/admin/ban-user` | `POST { userId, banReason }` | strict `{ user }` |
| `/admin/unban-user` | `POST { userId }` | strict `{ user }` |
| `/sign-out` | `POST`, no body | strict `{ success: true }` |
| `/send-verification-email` | `POST { email, callbackURL }` | strict `{ status: true }` |
| `/request-password-reset` | `POST { email, redirectTo }` | strict `{ status: true, message }` |
| `/reset-password` | `POST { token, newPassword }` | strict `{ status: true }` |

Better Auth user output remains extensible for configured user fields. Security-sensitive outer envelopes and the cookie-backed session record reject additional properties so a bearer `token` cannot silently reappear.

## Token and request-body rules

`server/auth/hosted/routes.ts` removes top-level tokens from successful sign-in and MFA-completion bodies and removes the nested session token from `/get-session`. `src/core/fuma/auth/client.ts` models the sanitized bodies, not Better Auth's unsanitized server-side return types. The client rejects a leaked token instead of ignoring it.

`HostedStaffDeviceSession.token` is different: `/list-sessions` intentionally returns an opaque revocation handle produced by the token-at-rest adapter. The UI sends that handle only to `/revoke-session`; it is not used as a browser credential. The host-only, HttpOnly session cookie remains the browser credential.

Cookie-authenticated operations with no endpoint payload omit the body entirely. In particular, `/revoke-other-sessions` and `/sign-out` do not send `{}`, a cookie token, or a session token. `apiRequest` therefore does not add `Content-Type` for those calls.

## Sensitive-operation ownership

The browser client expresses intent but does not authorize it. `server/auth/hosted/routes.ts` and Better Auth enforce:

- an authoritative current session for session and MFA mutations;
- a fresh staff session for admitted administrator mutations;
- protected-owner denial for ban and account-wide revocation paths;
- same-origin mutation requests and exact product-host routing;
- ban-triggered session revocation.

A `step_up_required` error is an HTTP error envelope handled by `apiRequest`; it is not a success variant in any client response schema.

## Forbidden patterns

- Do not call hosted auth with raw `fetch` or parse a response with `res.json()`.
- Do not introduce Zod into `src/core/fuma/auth/`; TypeBox schemas are the contract.
- Do not accept a top-level login/MFA token or a nested `/get-session` token.
- Do not read a session from an MFA completion body; confirm it through `/get-session`.
- Do not send request bodies to cookie-only revoke-others or sign-out endpoints.
- Do not treat a listed device-session revocation handle as a bearer credential.
- Do not move fresh-session, protected-owner, or role authorization decisions into the browser.

## Verification

Run the deterministic client contract gate:

```sh
bun test src/__tests__/fuma/hostedStaffAuthClient.test.ts
```

The test injects a scripted `FetchLike`; it does not start a server, use the network, depend on time, or inspect cookies unavailable to browser JavaScript. Server-side security behavior remains covered by the hosted auth integration and security-probe tests named in `docs/reference/fuma-hosted-staff-auth.md`.

## Related

- [`fuma-hosted-staff-auth.md`](fuma-hosted-staff-auth.md) — route mounting, cookie policy, and pre-authentication lifecycle
- [`fuma-staff-identity.md`](fuma-staff-identity.md) — hosted identity persistence and token-at-rest handling
- [`typebox-patterns.md`](typebox-patterns.md) — the required HTTP boundary-validation pattern
- Source of truth: `src/core/fuma/auth/client.ts`
- Server policy: `server/auth/hosted/routes.ts`
- Client contract gate: `src/__tests__/fuma/hostedStaffAuthClient.test.ts`

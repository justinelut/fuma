# Site-member identity realm

FUMA-038 introduces site-member authentication as a realm independent from Better Auth staff. Member identities are keyed by the exact platform, organization, workspace, site, owner key/generation, and Publication profile. A matching email address does not link the records.

## Public endpoints

The trusted public-host authority mounts these HTTPS-only, same-origin endpoints under `/_fuma/member-auth`:

- `POST /register` — enumeration-safe registration with versioned consent provenance.
- `POST /login` — generic invalid-credential response and scoped rate limits.
- `GET /session` — resolves only the member cookie for the current exact site scope.
- `POST /reauthenticate` — password verification plus session rotation.
- `POST /logout` and `POST /revoke-all` — immediate revocation.

The member cookie is `__Host-fuma_member_session` with `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, and no `Domain`. Raw tokens use the `fmm1_` realm prefix and only an HMAC-SHA-256 digest is stored. Sessions have a 30-day absolute limit and 24-hour idle limit. Member principals expose only member permissions and an empty `staffRoles` tuple; they are never accepted by Better Auth or staff authorization.

## Imports and consent

`POST /api/fuma/organizations/:organizationId/workspaces/:workspaceId/sites/:siteId/publication/member-imports` is a staff-only, `publication.members.write` endpoint on the control host. It accepts only a strict `MemberImportCommandSchema`; the caller cannot submit actor, scope, role, session, proof, password, token, or secret claims. The server derives exact owner-generation and Publication profile scope from the scoped authority, resolves the Better Auth cookie again, requires the same non-impersonated staff user/session to be less than five minutes old, and constructs the purpose-bound reauthentication proof itself.

`MemberImportService` accepts strict TypeBox records only. Imported entries cannot contain passwords, sessions, tokens, secrets, or roles, and begin in `activation-required` state without credentials. Every import requires a trusted staff proof with purpose `member-import`, the exact target scope, and a maximum ten-minute reauthentication window. Receipt, identities, and append-only consent events commit atomically and imports are idempotent by import ID plus source hash.

Login throttling applies both to the source IP and the IP/email tuple, preventing email rotation from bypassing enumeration controls. Member password reauthentication has an independent scoped limit. Session resolution fails closed if the idle-expiry touch loses a revocation race.

## Operations

Hosted deployments must set `FUMA_MEMBER_AUTH_SECRET` to at least 32 characters. It must differ from `BETTER_AUTH_SECRET`/the staff auth secret. Migration `000042_member_identity_realm` is additive and checksum-finalized; the concurrently-added `000043` remains the unapplied checksum-sentinel suffix.

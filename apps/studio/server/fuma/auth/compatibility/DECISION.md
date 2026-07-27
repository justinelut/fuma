# FUMA-010 Better Auth compatibility decision
# FUMA-010 Better Auth compatibility decision

This record covers only the isolated compatibility spike in `server/fuma/auth/compatibility/`; it does not migrate identities, add hosted auth schema migrations, or mount Better Auth routes.

---

## TL;DR

- **Decision:** accept Better Auth 1.6.25 with `@better-auth/drizzle-adapter` 1.6.25, Drizzle ORM 0.45.2, and postgres.js 3.4.9 as the FUMA-011 implementation candidate, conditional on the adapter and gates in this directory.
- `server/auth/hosted/auth.ts` maps every core and plugin model to an explicit `auth_*` table and enables organization, admin, and two-factor plugins; FUMA-010 probes import this adopted boundary.
- Existing `server/auth/tokens.ts` remains the password authority: Better Auth calls its Bun Argon2id hash and verify functions.
- Better Auth stores session bearer tokens verbatim by default. `server/auth/hosted/sessionTokenAdapter.ts` is therefore mandatory: it stores SHA-256 only, hashes every token predicate, restores raw tokens only to the request that created or already presented one, and exposes hashes from list operations as non-replayable revoke handles.
- Cookies are host-only by omission: raw `Set-Cookie` tests require `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` in the hosted shape and reject every `Domain` attribute.
- PostgreSQL evidence remains an executable opt-in gate and is **pending** without `FUMA_AUTH_COMPAT_POSTGRES_URL`; skipped output is not reported as proof. The ARM64 gate passed on the current Linux ARM64 Bun host and still skips honestly on non-ARM64 hosts.

## Exact compatibility matrix

| Package | Exact pin | Registry/repository result | Platform declaration |
|---|---:|---|---|
| `better-auth` | `1.6.25` | official `better-auth/better-auth`, `packages/better-auth` | no `os`/`cpu` restriction |
| `@better-auth/drizzle-adapter` | `1.6.25` | official `better-auth/better-auth`, `packages/drizzle-adapter` | no `os`/`cpu` restriction |
| `drizzle-orm` | `0.45.2` | official `drizzle-team/drizzle-orm` | no `os`/`cpu` restriction |
| `postgres` | `3.4.9` | official `porsager/postgres` | no `os`/`cpu` restriction; Node engine `>=12` |
| `auth` CLI | `1.6.25` | official `better-auth/better-auth`, `packages/cli` | no `os`/`cpu` restriction |

The registry identities and integrity values are executable constants in `server/fuma/auth/compatibility/versions.ts` and are locked by `bun.lock`. The generic-looking `auth` name was treated as a supply-chain risk and accepted only after registry metadata resolved to the official Better Auth CLI repository and the official docs named `auth@latest`. The similarly plausible `@better-auth/cli` package was rejected because its current registry release is stale at 1.4.21.

## Adopted schema review

FUMA-011 promoted the reviewed generated base to `server/auth/hosted/schema.ts` and made the deliberate production additions required by the migration manifest: PostgreSQL timezone-aware timestamps, normalized-email and credential uniqueness, one-to-one staff profiles, durable legacy identity links, and readable relation aliases. The eight Better Auth logical models remain `auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications`, `auth_organizations`, `auth_members`, `auth_invitations`, and `auth_two_factors`.

`server/fuma/auth/compatibility/schemaGenerationConfig.ts` remains generation evidence for the Better Auth logical model graph. Generated output is reviewed against the adopted schema; it must not overwrite the lifecycle/link tables or FUMA-011 constraints. `server/fuma/auth/compatibility/postgresGateSchema.ts` remains temporary-schema FUMA-010 test DDL only, not a hosted migration.

## Evidence matrix

| Requirement | Evidence | Status |
|---|---|---|
| Bun package load and option construction | default compatibility test imports all four runtime packages and initializes all plugins | verified on the current Bun-supported host |
| Custom `auth_*` models | generated schema plus logical-schema assertions | verified |
| Existing Argon2id hooks | password hook assertions and persisted `$argon2id$` credential hash | verified |
| Organization/admin/2FA plugins | plugin IDs, generated fields, and endpoint-surface assertions | verified |
| Host-only cookies | raw `Set-Cookie` assertions, including absence of `Domain` | verified |
| Session token at rest | in-memory lifecycle test proves cookie token differs from persisted 64-character SHA-256 and survives auth reconstruction/revocation | verified |
| PostgreSQL create/login/restart/revoke | `FUMA_AUTH_COMPAT_POSTGRES_URL` temporary-schema gate | pending unless the opt-in test runs |
| PostgreSQL token/password rows | same live gate reads `auth_sessions.token` and `auth_accounts.password` | pending unless the opt-in test runs |
| ARM64 runtime load | architecture-specific import, Argon2id, and session-hash gate | verified on the current Linux ARM64 host with Bun 1.3.14; skips rather than fabricates evidence elsewhere |
| Package ARM64 declarations | registry metadata has no `os`/`cpu` exclusions | verified as metadata, not runtime proof |

Run only the focused gate:

```sh
bun test server/fuma/auth/compatibility/compatibility.test.ts
FUMA_AUTH_COMPAT_POSTGRES_URL=postgres://… bun test server/fuma/auth/compatibility/compatibility.test.ts
```

The current ARM64 result is runtime evidence, not an inference from package metadata or cross-building. On non-ARM64 hosts the architecture-specific assertion skips and must not be reported as a new ARM64 run.

## Scope boundary

- No imports from this directory are added to `server/index.ts` or `server/fuma/runtime/*`.
- No identity rows are migrated.
- No production auth route is mounted.
- No hosted migration is added or changed.
- Redis, MinIO, runtime roots, and the docs index remain untouched.
- FUMA-011 owns schema/migration adoption and identity migration; FUMA-012 owns production route mounting and request integration.

## Related

- Existing password/session crypto: `server/auth/tokens.ts`
- Hosted auth config: `server/auth/hosted/auth.ts`
- Token-at-rest adapter: `server/auth/hosted/sessionTokenAdapter.ts`
- Adopted schema and manifest: `server/auth/hosted/schema.ts`, `server/auth/hosted/schemaManifest.ts`
- FUMA-011 identity reference: `docs/reference/fuma-staff-identity.md`
- Focused gate: `server/fuma/auth/compatibility/compatibility.test.ts`
- Hosted migration boundary: `server/fuma/db/hostedMigrationRunner.ts`

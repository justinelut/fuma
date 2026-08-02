# Fuma Hosted Staff Identity

This reference describes the unmounted Better Auth staff boundary and additive legacy identity migration delivered by FUMA-011.

Fuma keeps historical Instatic `users` rows intact while creating hosted Better Auth identities, credentials, lifecycle profiles, and durable one-to-one links in the separate hosted PostgreSQL stream.

---

## TL;DR

- Hosted migration `000003_staff_identity` is the next FUMA-006 ID after durable jobs migration `000002`.
- The canonical unmounted adapter and Drizzle schema live under `server/auth/hosted/`; no auth route or UI is mounted by FUMA-011.
- Eligible legacy staff are non-deleted `users` whose role is not `member`. Publication/site members remain a separate realm and receive no staff identity.
- Migrated auth user IDs and credential `account_id` values preserve the legacy user ID. `auth_legacy_identity_links` enforces one legacy user to one auth user in both directions.
- Existing `password_hash` values are copied byte-for-byte into credential accounts. Better Auth continues to verify them through `server/auth/tokens.ts` Argon2id callbacks.
- Every auth user receives exactly one `auth_staff_profiles` row: `legacy` during backfill or `native` through the Better Auth user-create lifecycle hook.

## Schema and uniqueness

`server/auth/hosted/schemaManifest.ts` is the application manifest. It names the eight Better Auth tables plus:

- `auth_staff_profiles` — one lifecycle profile per hosted staff user;
- `auth_legacy_identity_links` — stable legacy-user/auth-user mapping.

Migration SQL is owned by `server/fuma/db/migrations/000003_staff_identity.ts` and its immutable checksum is in `server/fuma/db/migrations/index.ts`. It adds all tables and indexes without changing historical migrations or legacy rows.

Identity uniqueness is enforced at PostgreSQL boundaries:

- `auth_users.id` is primary and `lower(auth_users.email)` is unique;
- `(provider_id, account_id)` is unique;
- a user has at most one `credential` account;
- both sides of `auth_legacy_identity_links` are unique;
- a staff profile is primary-keyed by auth user ID.

A duplicate normalized email, credential identity, or link aborts the enclosing migration/backfill transaction rather than selecting an arbitrary winner.

## PostgreSQL upgrade lifecycle

The migration backfills legacy staff already present when `000003` runs. The same idempotent SQL is exposed by `backfillLegacyStaffIdentities` in `server/auth/hosted/legacyIdentity.ts`.

In-place PostgreSQL upgrades run the transaction-aware identity reconciler before the migration commits. A completed migration cannot omit an eligible legacy staff link.

Backfill validates all eligible rows after insertion. Each must resolve to:

```text
legacy users.id
  = auth_legacy_identity_links.legacy_user_id
  = auth_legacy_identity_links.auth_user_id
  = auth_users.id
  = auth_accounts.user_id (provider_id = credential)
  = auth_staff_profiles.user_id
```

The credential password must remain identical to `users.password_hash`. Legacy member and soft-deleted rows remain untouched and are not promoted into the staff realm.

## Native lifecycle

`createPostgresHostedAuth` wires Better Auth's `databaseHooks.user.create.after` hook to an idempotent `auth_staff_profiles(source = 'native')` insert. The lifecycle dependency is mandatory when constructing the lower-level in-memory boundary, making profile creation explicit in tests and future composition.

FUMA-011 does not mount `auth.handler`, replace current CMS auth, add MFA UI, or invalidate old sessions. Those cutover responsibilities remain with FUMA-012 and FUMA-013.

## Rollback and evidence

The FUMA-006 runner executes schema SQL, backfill validation, and the immutable history receipt in one transaction under its advisory lock. Any schema, uniqueness, hash, or link failure leaves neither migration `000003` history nor partial auth schema effects.

Run focused deterministic evidence:

```sh
bun test src/__tests__/fuma/staffIdentityMigration.test.ts
bun test src/__tests__/fuma/hostedMigrationsTransition.test.ts
bun test server/fuma/auth/compatibility/compatibility.test.ts
```

The first suite demonstrates seeded legacy login with the fixture's existing Argon2id password, unchanged stored hash, duplicate rejection, lifecycle profile creation, and simulated transactional rollback. Its live PostgreSQL test is opt-in and skipped honestly when the URL is absent:

```sh
FUMA_TEST_POSTGRES_URL=postgres://... \
  bun test src/__tests__/fuma/staffIdentityMigration.test.ts
```

The live gate executes distinct fresh and legacy-upgrade schemas, verifies all staff links and exact hashes, excludes the member realm, logs in with the existing password through the isolated Better Auth boundary, and checks native profile creation and normalized-email rejection.

## Related

- `docs/reference/fuma-hosted-migrations-transition.md` — hosted PostgreSQL stream and identity sequencing.
- `server/auth/hosted/auth.ts` — unmounted Better Auth configuration and lifecycle hook.
- `server/auth/hosted/schema.ts` — adopted Drizzle schema.
- `server/auth/hosted/legacyIdentity.ts` — idempotent backfill and validation.
- `server/fuma/db/migrations/000003_staff_identity.ts` — additive PostgreSQL migration.
- `src/__tests__/fuma/staffIdentityMigration.test.ts` — focused acceptance and demo evidence.

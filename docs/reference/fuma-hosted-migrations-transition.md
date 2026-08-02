# Fuma Hosted PostgreSQL Migrations

Fuma uses one additive, forward-only PostgreSQL migration stream. Legacy transition tooling is not a supported install, deployment, development, test, or recovery path.

## Hosted migration stream

Hosted migrations live under `apps/studio/server/fuma/db/migrations/`, separately from immutable historical migration evidence retained for auditability.

Each migration has a six-digit increasing ID, additive PostgreSQL SQL, and an immutable SHA-256 entry in `apps/studio/server/fuma/db/migrations/index.ts`. A trailing all-zero checksum marks authored but unapplied work: sentinels form one contiguous suffix, and the runner plans or applies only the checksum-finalized prefix.

Generate the next ID with:

```sh
bun run fuma:migrate -- --next="add capability"
```

The runner validates the complete source manifest before touching PostgreSQL. It rejects destructive SQL, duplicate or reordered IDs, edited checksums, deleted applied history, and non-contiguous history. Application holds a PostgreSQL transaction-scoped advisory lock; schema SQL and the history receipt commit atomically.

Inspect without applying SQL:

```sh
DATABASE_URL=postgres://... bun run fuma:migrate -- --dry-run
```

Apply pending migrations:

```sh
DATABASE_URL=postgres://... bun run fuma:migrate
```

Reports contain migration IDs only and never include database URLs, row content, or credentials.

## Staff identity reconciliation

Hosted migration `000003_staff_identity` creates the Better Auth schema, lifecycle profiles, and durable legacy identity links. It backfills eligible staff already present during an in-place PostgreSQL upgrade without changing the historical user row or Argon2id password hash.

The backfill is idempotent and runs in the migration transaction. Completion requires every eligible staff identity to resolve to exactly one auth user, credential, profile, and legacy link. See [fuma-staff-identity.md](fuma-staff-identity.md).

## Startup contract

Hosted startup requires a PostgreSQL `DATABASE_URL`. Missing, malformed, or non-PostgreSQL URLs fail before migrations or HTTP startup. Operators restore an existing site from a PostgreSQL dump as documented in [deployment/backup-restore.md](../deployment/backup-restore.md); there is no file-database cutover workflow.

## Focused acceptance

Deterministic migration tests validate policy, checksums, ordering, concurrent application, and startup refusal. Live acceptance uses a dedicated PostgreSQL URL:

```sh
FUMA_TEST_POSTGRES_URL=postgres://... \
  bun test src/__tests__/fuma/hostedMigrationsTransition.test.ts
```

The test database must be disposable and isolated from production.

## Related

- [database-dialects.md](database-dialects.md) — PostgreSQL architecture
- [fuma-staff-identity.md](fuma-staff-identity.md) — identity backfill
- [../deployment/backup-restore.md](../deployment/backup-restore.md) — PostgreSQL backup and restore
- `apps/studio/server/fuma/db/migrations/` — hosted migration stream

# Fuma Hosted Migrations and Legacy Transition

FUMA-006 establishes the PostgreSQL-only hosted migration stream and the one-time inherited SQLite transition path. It does not add tenant domain tables or job infrastructure.

## Hosted migration stream

Hosted migrations live under `apps/studio/server/fuma/db/migrations/`, separately from the immutable historical files `apps/studio/server/db/migrations-pg.ts` and `apps/studio/server/db/migrations-sqlite.ts`.

Each hosted migration has a six-digit increasing ID, additive SQL, and an immutable SHA-256 entry in `apps/studio/server/fuma/db/migrations/index.ts`. A trailing all-zero checksum marks authored but unapplied work: sentinels must be one contiguous suffix, and the runner plans/applies only the checksum-finalized prefix. Finalizing any migration after a sentinel fails closed, so acceptance proceeds strictly in source order. The runnable prefix includes FUMA-048's `000011_releases` immediately after `000010_editor_resources`; later additive migrations may follow it, and every earlier checksum remains unchanged. Generate the next ID with:

```sh
bun run fuma:migrate -- --next="add import receipt"
```

The runner validates the complete source manifest before touching PostgreSQL. It rejects destructive SQL, duplicate or reordered IDs, edited checksums, deleted applied history, and non-contiguous history. Application holds a PostgreSQL transaction-scoped advisory lock; the migration SQL and history receipt commit atomically. Concurrent starters serialize and the later starter observes the first starter's receipt.

Inspect without creating a history table or applying SQL:

```sh
DATABASE_URL=postgres://... bun run fuma:migrate -- --dry-run
```

Apply pending migrations:

```sh
DATABASE_URL=postgres://... bun run fuma:migrate
```

Reports contain migration IDs only. They never include database URLs, paths, row content, or credentials.

## SQLite to PostgreSQL transition

The transition utility exports every inherited application table except `schema_migrations`. It preserves primary keys, JSON content, binary ciphertext/assets, media metadata and references, user/auth links, timestamps, and nullable cyclic references. Tables and rows have deterministic ordering and SHA-256 hashes; the artifact itself has a source fingerprint and hash validated through TypeBox.

Export an offline artifact with owner-only permissions:

```sh
bun run fuma:transition -- --source=/srv/instatic/instatic.db --export=./legacy-transition.json
```

Preview the import without writing destination schema or rows:

```sh
DATABASE_URL=postgres://... bun run fuma:transition -- \
  --import=./legacy-transition.json --dry-run
```

Run an export and import directly, or import a prior artifact:

```sh
DATABASE_URL=postgres://... bun run fuma:transition -- --source=/srv/instatic/instatic.db
DATABASE_URL=postgres://... bun run fuma:transition -- --import=./legacy-transition.json
```

The utility first applies the immutable historical PostgreSQL stream, then the separate hosted stream. Data copy is resumable per table. Every table receipt binds the source fingerprint, table count, row count, and content hash. A repeated completed import performs validation and reports all tables as resumed with no duplicate writes.

Nullable foreign-key cycles are inserted with deferred values, then restored after all rows exist. Completion is recorded only after exact destination counts and content hashes match and every exported foreign-key relationship has zero orphans. Extra destination rows, altered content, missing auth/media/content links, a changed resume artifact, or inconsistent receipts fail closed.

Artifact and command reports are secret-safe: hashes, IDs, counts, and table names only. Keep the source SQLite database and uploads backup until the completed receipt has been independently verified.

## Staff identity reconciliation

Hosted migration `000003_staff_identity` creates the unmounted Better Auth schema, lifecycle profiles, and durable legacy identity links. It backfills eligible legacy staff already present during an in-place PostgreSQL upgrade without changing the historical `users` row or its Argon2id `password_hash`.

Transition imports apply the hosted stream before copying SQLite rows because migration `000001` owns import receipts. After row restoration and count/hash/foreign-key validation, `importLegacySqliteToPostgres` therefore runs the same idempotent identity backfill inside the completion transaction. The completion receipt is not written unless every non-deleted, non-member legacy user has exactly one auth user, credential, profile, and link with the original password hash. Completed resumes revalidate the same invariant.

See `docs/reference/fuma-staff-identity.md` for the table manifest, eligibility rule, lifecycle hook, uniqueness policy, and focused acceptance commands.

## Hosted startup cutover guard

Set `FUMA_HOSTED=true` only for the hosted composition. Hosted startup rejects every SQLite `DATABASE_URL` before opening it. When `FUMA_LEGACY_SQLITE_PATH` is configured, startup also requires a completed validated import receipt in PostgreSQL; this prevents selecting an empty PostgreSQL database while silently abandoning a real SQLite installation.

The failure includes the actionable path without interpolating secrets or local paths:

```sh
bun run fuma:transition -- --source="$FUMA_LEGACY_SQLITE_PATH" --target="$DATABASE_URL"
```

Self-hosted startup remains unchanged unless `FUMA_HOSTED=true` is explicitly set.

## Focused acceptance

The deterministic unit/demo suite uses the branded FUMA-002 source and exercises policy, checksums, concurrent application, artifact hashes, mismatch failures, and startup refusal:

```sh
bun test src/__tests__/fuma/hostedMigrationsTransition.test.ts
```

The same file contains an opt-in PostgreSQL acceptance demo. It creates the historical and hosted schemas inside an isolated rollback transaction, imports the branded fixture, verifies preserved IDs/auth/content links plus counts/hashes/foreign keys, repeats the import to prove safe resume, and verifies the startup guard:

```sh
FUMA_TEST_POSTGRES_URL=postgres://... \
  bun test src/__tests__/fuma/hostedMigrationsTransition.test.ts
```

SQLite is accepted only as transition input. Hosted acceptance is PostgreSQL-only.

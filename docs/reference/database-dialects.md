# PostgreSQL Database Architecture

How Instatic uses PostgreSQL across local development, tests, production, and hosted deployments.

Instatic supports **PostgreSQL only**. Every environment supplies a PostgreSQL `DATABASE_URL`; repositories share one `DbClient` contract and migrations use PostgreSQL-native schema types and transactional behavior.

---

## TL;DR

- **Database:** PostgreSQL through `Bun.sql` and `server/db/postgres.ts`.
- **Local URL:** `postgres://instatic:instatic@127.0.0.1:5433/instatic`.
- **Repositories:** parameterized SQL through the tagged-template `DbClient`; never concatenate values.
- **JSON:** JSON columns end in `_json` and use PostgreSQL `jsonb`.
- **Migrations:** add forward-only PostgreSQL migrations to `server/db/migrations-pg.ts`; hosted Fuma migrations remain in their separate PostgreSQL stream.
- **Tests:** use a dedicated PostgreSQL database or isolated schemas, never production data.

## Runtime contract

`DATABASE_URL` must use `postgres://` or `postgresql://`. The canonical local value is:

```env
DATABASE_URL=postgres://instatic:instatic@127.0.0.1:5433/instatic
```

Production credentials must come from the deployment environment or secret manager. Do not commit them and do not point tests at a production database.

`server/db/client.ts` defines the shared query result and transaction interface. `server/db/postgres.ts` implements it with `Bun.sql`, normalizes returned timestamps to ISO strings, parses string-valued `_json` columns defensively, and reports affected rows from PostgreSQL's command result.

## Repository rules

### Bind every value

Prefer the tagged-template API:

```ts
const { rows } = await db<{ id: string }>`
  select id from users where email = ${email}
`
```

Interpolations are PostgreSQL parameters. Use `db.unsafe()` only when a trusted static SQL fragment such as a shared column list must be inserted; values still remain bound parameters.

### Name JSON columns with `_json`

JSON payload columns use `jsonb` and end in `_json`:

```sql
metadata_json jsonb not null default '{}'
```

Pass objects directly through the tagged template and validate persisted JSON with TypeBox when it crosses into application code.

### Use transactions for atomic writes

```ts
await db.transaction(async (tx) => {
  await tx`update data_rows set status = 'published' where id = ${rowId}`
  await tx`insert into audit_events (id, action) values (${eventId}, 'row.publish')`
})
```

An exception rolls the transaction back. Recurring multi-instance jobs use PostgreSQL advisory locks so only one scheduler instance performs a tick.

## Migrations

Add application schema changes to `server/db/migrations-pg.ts` with a new, ordered, immutable ID. Use PostgreSQL-native types such as `jsonb`, `timestamptz`, `bigint`, `boolean`, and `bytea`. Migrations run idempotently at boot and applied IDs are recorded in the migration history table.

For hosted Fuma schema, use the separate forward-only stream under `server/fuma/db/migrations/`. Do not edit applied migration text or checksums. Historical migration files may remain in the repository as immutable audit evidence; they are not a supported runtime or authoring target.

### Migration example

```ts
{
  id: '0042-add-subscribers',
  label: 'Add subscribers table',
  sql: `
    create table subscribers (
      id text primary key,
      email text not null unique,
      metadata_json jsonb not null default '{}',
      created_at timestamptz not null default current_timestamp
    );
  `,
}
```

Run the focused migration and JSON-column gates after changing persisted shape, followed by the repository-required test, build, and lint checks.

## Local development and tests

Use the canonical local connection for development:

```sh
DATABASE_URL=postgres://instatic:instatic@127.0.0.1:5433/instatic bun run dev
```

Tests that touch persistence must use a dedicated test database or isolated PostgreSQL schemas. Set the test URL explicitly, keep it separate from production, and let each suite clean up only resources it created.

## Backup and recovery

Use PostgreSQL logical dumps (`pg_dump`) and restore with `pg_restore` or `psql`, depending on dump format. Back up `UPLOADS_DIR` separately. The complete operator procedure is in [deployment/backup-restore.md](../deployment/backup-restore.md).

## Forbidden patterns

| Pattern | Use instead |
|---|---|
| File-backed or in-memory databases | A dedicated PostgreSQL database/schema |
| String-concatenated query values | Tagged-template parameters |
| JSON text columns without `_json` | PostgreSQL `jsonb` with an `_json` suffix |
| Editing an applied migration | Add a new forward-only migration |
| Tests sharing production credentials | An isolated PostgreSQL test URL |
| Assuming one application instance | PostgreSQL transactions and advisory locks |

## Related

- [docs/architecture.md](../architecture.md) — system overview
- [docs/server.md](../server.md) — server boot and repository flow
- [docs/deployment/backup-restore.md](../deployment/backup-restore.md) — PostgreSQL backup and restore
- `server/db/client.ts` — query/transaction interface
- `server/db/postgres.ts` — PostgreSQL adapter
- `server/db/migrations-pg.ts` — application migrations
- `server/fuma/db/migrations/` — hosted PostgreSQL migrations

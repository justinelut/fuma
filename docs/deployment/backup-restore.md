# Backup And Restore

A complete Instatic backup contains a PostgreSQL dump and a separate copy of uploaded files. Test restoration regularly; an untested backup is not a recovery plan.

---

## TL;DR

| Data | Backup | Restore |
|---|---|---|
| PostgreSQL | `pg_dump --format=custom` | `pg_restore --clean --if-exists` into an empty or approved target |
| Uploads | Filesystem/volume snapshot or archive of `UPLOADS_DIR` | Restore to the same configured path |

Managed Railway and Render deployments should enable provider backups or point-in-time recovery and keep periodic independent `pg_dump` files for provider-independent recovery.

## Before you begin

- Record the application version and PostgreSQL major version.
- Confirm the target database and uploads path; never guess when destructive restore commands are involved.
- Keep database credentials out of command history where possible by using a protected environment file or `PGPASSFILE`.
- Quiesce writes or schedule a maintenance window for a full-site restore.

## Self-hosted PostgreSQL backup

Create a backup directory and load the production environment:

```sh
mkdir -p backups
set -a
. ./.env
set +a
```

Create a compressed custom-format dump from the PostgreSQL service in `compose.prod.yml`:

```sh
docker compose -f compose.prod.yml exec -T postgres \
  pg_dump --format=custom --no-owner --no-privileges \
  -U "$POSTGRES_USER" "$POSTGRES_DB" \
  > "backups/instatic-$(date +%F).dump"
```

Back up the uploads volume with your host snapshot or backup agent. If you use an archive, ensure it captures the complete path mounted as `UPLOADS_DIR`, including media, fonts, plugin packages, and `published/` artefacts.

Verify the dump is readable:

```sh
docker compose -f compose.prod.yml exec -T postgres \
  pg_restore --list < "backups/instatic-$(date +%F).dump" > /dev/null
```

## Self-hosted PostgreSQL restore

Restoring replaces database state and may replace uploaded files. Take a safety backup first and perform the operation during a maintenance window.

Start only PostgreSQL, then restore the selected dump:

```sh
set -a
. ./.env
set +a

docker compose -f compose.prod.yml up -d postgres

docker compose -f compose.prod.yml exec -T postgres \
  pg_restore --clean --if-exists --no-owner --no-privileges \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  < backups/instatic-YYYY-MM-DD.dump
```

Restore the matching uploads backup to the configured uploads volume/path, then start the production stack:

```sh
docker compose -f compose.prod.yml up -d
```

Check `/health`, sign in, verify representative content/media, and confirm the migration history before reopening writes.

## External PostgreSQL

For a direct Bun or generic image deployment, run PostgreSQL client tools from a trusted administration host:

```sh
pg_dump --format=custom --no-owner --no-privileges \
  --dbname="$DATABASE_URL" --file="backups/instatic-$(date +%F).dump"

pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname="$RESTORE_DATABASE_URL" backups/instatic-YYYY-MM-DD.dump
```

Use a separate `RESTORE_DATABASE_URL` and verify it before running `pg_restore`. Restore uploads independently.

## Railway and Render

- **Railway:** enable the managed PostgreSQL backup/PITR features available to the selected plan. Export independent dumps using the database's external connection only from a secured administration environment. Back up the app volume mounted at `UPLOADS_DIR` separately.
- **Render:** enable managed PostgreSQL backups for the selected plan. Use Render's internal connection for the app and a restricted external connection for administrative dumps. Back up the persistent app disk containing `UPLOADS_DIR` separately.

Provider snapshots do not include the app's upload volume unless the provider explicitly says they do.

## Recovery validation

At least periodically, restore into an isolated PostgreSQL database and verify:

1. `pg_restore` completes without ignored errors.
2. The app starts and `/health` succeeds.
3. An owner can authenticate.
4. Representative pages, posts, media, plugins, and audit records exist.
5. Published routes and uploaded assets resolve.
6. The restore uses the expected migration history and application version.

Destroy only the isolated recovery environment after evidence is recorded.

## Related

- [deployment/README.md](README.md) — deployment overview
- [railway.md](railway.md) — managed Railway PostgreSQL
- [render.md](render.md) — managed Render PostgreSQL
- [vps.md](vps.md) — `compose.prod.yml` volumes and operations
- `compose.prod.yml` — production PostgreSQL and uploads volumes

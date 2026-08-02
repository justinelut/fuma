# Railway Deployment

Railway runs the published Instatic image with a managed Railway PostgreSQL service and a persistent app volume for uploads.

---

## TL;DR

| Service | Purpose | Persistent data |
|---|---|---|
| App | Instatic image | `/app/storage/uploads` |
| Postgres | Railway managed PostgreSQL | Railway database volume/backups |

Use the internal PostgreSQL service URL:

```txt
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

## App service

Create the app from the published image, attach a volume at `/app/storage`, expose the configured port, and set `/health` as the health check.

```txt
Image=ghcr.io/corebunch/instatic:latest
PORT=8080
DATABASE_URL=${{Postgres.DATABASE_URL}}
UPLOADS_DIR=/app/storage/uploads
STATIC_DIR=/app/dist
INSTATIC_SECRET_KEY=${{secret(43, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/")}}=
PUBLIC_ORIGIN=https://${{RAILWAY_PUBLIC_DOMAIN}}
RAILWAY_RUN_UID=0
```

The `Postgres` prefix is the database service name. Update the expression if you rename that service. Use the internal `DATABASE_URL` for app traffic; reserve `DATABASE_PUBLIC_URL` for restricted external administration such as an off-platform dump.

Railway volumes mount as `root`, so the template sets `RAILWAY_RUN_UID=0` to permit writes below `/app/storage`. The app volume stores uploads, fonts, plugin packages, and published artefacts, not the database.

## Managed PostgreSQL

Add Railway's PostgreSQL service to the same project. Keep it on the private project network and enable the backup or point-in-time recovery features required by your recovery objectives. The app runs migrations at startup; do not add a separate migration command.

## Domains and proxy settings

Railway terminates HTTPS. `PUBLIC_ORIGIN=https://${{RAILWAY_PUBLIC_DOMAIN}}` gives the CSRF check the browser-visible origin. Append custom domains as comma-separated origins. `TRUSTED_PROXY_CIDRS` is optional and affects only client-IP attribution; never trust `0.0.0.0/0`.

## Backups

Back up both stores:

- Railway managed PostgreSQL through provider backups/PITR plus periodic independent `pg_dump` files when provider-independent recovery is required.
- The app volume mounted at `/app/storage`, especially `/app/storage/uploads`.

See [backup-restore.md](backup-restore.md).

## Updates

Enable Railway Image Auto Updates if desired. Use `:latest` to follow stable releases automatically or pin a semver image tag for controlled upgrades. Configure a maintenance window and verify database/upload backups before moving versions.

## Troubleshooting

| Symptom | Check |
|---|---|
| App cannot connect | `DATABASE_URL` must reference the managed PostgreSQL service's internal URL. |
| Health check fails | App `PORT` and Railway target port must match; health path is `/health`. |
| Uploads disappear | A volume must be mounted at `/app/storage` and `UPLOADS_DIR` must be below it. |
| Writes fail with `EACCES` | Set `RAILWAY_RUN_UID=0` for the root-owned volume. |
| Login/setup reports invalid origin | Ensure `PUBLIC_ORIGIN` matches the exact Railway/custom-domain origin. |
| Encrypted credentials or MFA fail | Ensure `INSTATIC_SECRET_KEY` exists and has not changed. |

## Related

- [deployment/README.md](README.md) — deployment overview
- [backup-restore.md](backup-restore.md) — PostgreSQL and uploads recovery
- Railway docs: [PostgreSQL](https://docs.railway.com/databases/postgresql/), [volumes](https://docs.railway.com/volumes/reference), [health checks](https://docs.railway.com/reference/healthchecks)

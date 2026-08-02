# Generic Production Image

This guide covers running the production image outside the bundled VPS stack. The image requires PostgreSQL and persistent upload storage.

---

## Runtime requirements

- `DATABASE_URL` points to PostgreSQL (`postgres://` or `postgresql://`).
- `UPLOADS_DIR` is mounted on persistent storage.
- `STATIC_DIR=/app/dist`.
- `INSTATIC_SECRET_KEY` is stable and secret.
- `PUBLIC_ORIGIN` matches the browser-visible origin when HTTPS terminates upstream.

Example external database configuration:

```txt
DATABASE_URL=postgres://user:password@database.internal:5432/instatic
UPLOADS_DIR=/app/storage/uploads
```

## Published image

GHCR is the canonical registry:

```sh
docker pull ghcr.io/corebunch/instatic:latest
docker pull ghcr.io/corebunch/instatic:<version>
```

Pin a release tag for controlled production updates.

## Run with external PostgreSQL

```sh
docker volume create instatic-storage

docker run -d \
  --name instatic \
  -p 3001:3001 \
  -e PORT=3001 \
  -e DATABASE_URL="postgres://user:password@database.internal:5432/instatic" \
  -e STATIC_DIR=/app/dist \
  -e UPLOADS_DIR=/app/storage/uploads \
  -e INSTATIC_SECRET_KEY="replace-with-output-of-openssl-rand" \
  -v instatic-storage:/app/storage \
  --restart unless-stopped \
  ghcr.io/corebunch/instatic:<version>
```

The PostgreSQL service owns database durability. The app volume remains required for media, fonts, plugin packs, and published artefacts.

## Railway

Create the app from the published image, add managed Railway PostgreSQL, attach an app volume at `/app/storage`, and set:

```txt
PORT=8080
DATABASE_URL=${{Postgres.DATABASE_URL}}
UPLOADS_DIR=/app/storage/uploads
STATIC_DIR=/app/dist
PUBLIC_ORIGIN=https://${{RAILWAY_PUBLIC_DOMAIN}}
RAILWAY_RUN_UID=0
```

See [railway.md](railway.md) for the full managed-PostgreSQL contract.

## Render

Use the supported Blueprint:

```txt
docs/deployment/render/postgres/render.yaml
```

It provisions managed Render PostgreSQL and a persistent app disk for uploads. See [render.md](render.md).

## Required variables

| Variable | Required | Value |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection URL |
| `UPLOADS_DIR` | Yes for durable media | Persistent upload directory |
| `STATIC_DIR` | Yes in the image | `/app/dist` |
| `PORT` | Platform-dependent | HTTP listen port; default `3001` |
| `INSTATIC_SECRET_KEY` | Yes for reversible secrets | Stable output of `openssl rand -base64 32` |
| `PUBLIC_ORIGIN` | Behind an HTTPS proxy | Comma-separated browser origins |
| `TRUSTED_PROXY_CIDRS` | Optional | Actual proxy CIDRs for client-IP attribution only |

## Health check

```sh
curl http://localhost:3001/health
```

Expected shape:

```json
{"status":"ok","ts":1234567890}
```

## Related

- [deployment/README.md](README.md) — deployment overview
- [railway.md](railway.md) — Railway managed PostgreSQL
- [render.md](render.md) — Render managed PostgreSQL
- [vps.md](vps.md) — `compose.prod.yml` production stack
- [backup-restore.md](backup-restore.md) — PostgreSQL and uploads recovery
- `Dockerfile` — production image definition

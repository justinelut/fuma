# Deployment

This index maps the supported PostgreSQL deployment targets to their runtime variables, storage, and operating guides.

Instatic runs as one Bun server backed by PostgreSQL. Database migrations run automatically at startup. Production self-hosting uses `compose.prod.yml`; Railway and Render use their managed PostgreSQL services.

---

## TL;DR

| Target | Database | Persistent app storage | Guide |
|---|---|---|---|
| Railway | Managed Railway PostgreSQL | App volume mounted for uploads | [railway.md](railway.md) |
| Render | Managed Render PostgreSQL | App disk mounted for uploads | [render.md](render.md) |
| VPS | PostgreSQL service in `compose.prod.yml` | `postgres_data` and `uploads` volumes | [vps.md](vps.md) |
| Generic image host | External or managed PostgreSQL | Persistent `UPLOADS_DIR` | [docker-image.md](docker-image.md) |
| VPS HTTPS | Same PostgreSQL stack plus Caddy | Database, uploads, and certificate volumes | [tls-caddy.md](tls-caddy.md) |

Back up PostgreSQL and uploaded media independently. See [backup-restore.md](backup-restore.md).

## Runtime contract

```txt
PORT                 HTTP port for the Bun server
DATABASE_URL         postgres://... or postgresql://...
UPLOADS_DIR          media, fonts, plugin packs, and published artefacts
STATIC_DIR           built admin SPA directory (`/app/dist` in the image)
INSTATIC_SECRET_KEY  stable base64 key for encrypted provider/plugin/MFA secrets
PUBLIC_ORIGIN        public CSRF origin(s), comma-separated
TRUSTED_PROXY_CIDRS  optional proxy CIDRs for client-IP attribution only
```

The canonical local development URL is:

```txt
postgres://instatic:instatic@127.0.0.1:5433/instatic
```

Production must use deployment-specific credentials. Generate `INSTATIC_SECRET_KEY` with `openssl rand -base64 32` and store it outside source control.

## Production Compose stack

`compose.prod.yml` is the supported production stack. Copy the production environment example, set strong secrets, and start the stack:

```sh
cp .env.production.example .env
INSTATIC_IMAGE=ghcr.io/corebunch/instatic:latest docker compose -f compose.prod.yml up -d
```

Pin a release tag instead of `latest` when upgrades need explicit approval. Add `compose.tls.yml` only when Caddy should terminate TLS; add `compose.build.yml` only for a deliberate source build.

## Persistence

PostgreSQL data and `UPLOADS_DIR` are both durable data:

- PostgreSQL stores content, configuration, users, sessions, audit history, and migration state.
- `UPLOADS_DIR` stores media, fonts, plugin packages, and published static artefacts.

Replacing the application container must not replace either store.

## Docs inventory

| File | Role |
|---|---|
| [railway.md](railway.md) | Railway app plus managed PostgreSQL |
| [render.md](render.md) | Render Blueprint plus managed PostgreSQL |
| [vps.md](vps.md) | `compose.prod.yml` on a VPS and direct Bun operation |
| [docker-image.md](docker-image.md) | Generic image with external PostgreSQL |
| [tls-caddy.md](tls-caddy.md) | Caddy TLS overlay for the production stack |
| [backup-restore.md](backup-restore.md) | PostgreSQL dumps/restores and uploads backup |
| [release-workflow.md](release-workflow.md) | Maintainer image publication |
| [self-host-smoke-harness.md](self-host-smoke-harness.md) | PostgreSQL release-candidate smoke contract |

## Related

- `.env.production.example` — production variable template
- `compose.prod.yml` — supported production stack
- `docs/deployment/render/postgres/render.yaml` — Render managed-PostgreSQL Blueprint
- `apps/studio/server/config.ts` — runtime environment parsing

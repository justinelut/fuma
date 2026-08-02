# VPS Deployment

This guide runs Instatic's PostgreSQL production stack on one VPS.

`compose.prod.yml` is the supported production stack. It runs the app and PostgreSQL with durable database and upload volumes. Add `compose.tls.yml` for Caddy HTTPS or `compose.build.yml` only when building from source.

---

## Prerequisites

Install a container runtime with Compose support, point a domain at the VPS when using TLS, and open only the ports your deployment needs. Before adding provider credentials, plugin secrets, or MFA, create a stable `INSTATIC_SECRET_KEY`.

## Install from a release bundle

1. Download and unpack `instatic-<version>-release-bundle.tar.gz`.
2. Copy the production environment template.
3. Set strong database and encryption secrets.
4. Start `compose.prod.yml`.

```sh
cp .env.production.example .env
openssl rand -hex 24       # use as POSTGRES_PASSWORD
openssl rand -base64 32    # use as INSTATIC_SECRET_KEY

INSTATIC_IMAGE=ghcr.io/corebunch/instatic:<version> \
  docker compose -f compose.prod.yml up -d
```

The production stack sets the app connection to its PostgreSQL service and persists:

| Volume | Contents |
|---|---|
| `postgres_data` | PostgreSQL data directory |
| `uploads` | Media, fonts, plugin packages, and published artefacts |

Open `http://server-ip:3001/admin` for a plain-HTTP installation. The first visit creates the site and owner account.

## Source build

From a checkout:

```sh
git clone https://github.com/CoreBunch/Instatic.git
cd instatic
cp .env.production.example .env
# Set POSTGRES_PASSWORD and INSTATIC_SECRET_KEY.
docker compose -f compose.prod.yml -f compose.build.yml up -d --build
```

For normal releases, prefer the published image and omit `compose.build.yml`.

## HTTPS

Set the public domain values in `.env`:

```env
DOMAIN=cms.example.com
LETSENCRYPT_EMAIL=ops@example.com
PUBLIC_ORIGIN=https://cms.example.com
```

Start the production stack with the TLS overlay:

```sh
docker compose -f compose.prod.yml -f compose.tls.yml up -d
```

See [tls-caddy.md](tls-caddy.md) for certificate and proxy details.

## Operations

```sh
# Status and logs
docker compose -f compose.prod.yml ps
docker compose -f compose.prod.yml logs -f app
docker compose -f compose.prod.yml logs -f postgres

# Update a published-image install
docker compose -f compose.prod.yml pull app
docker compose -f compose.prod.yml up -d
```

Back up PostgreSQL and uploads before upgrades. `docker compose down` keeps named volumes; `docker compose down -v` deletes the database and uploads and must be used only for an intentional wipe.

## Direct Bun install

A direct host install still requires PostgreSQL. Use the canonical local URL for development or replace it with the protected production connection string:

```sh
bun install
bun run build
DATABASE_URL=postgres://instatic:instatic@127.0.0.1:5433/instatic \
  STATIC_DIR=./apps/studio/dist \
  UPLOADS_DIR=./uploads \
  INSTATIC_SECRET_KEY=replace-with-a-stable-secret \
  PORT=3001 \
  bun apps/studio/server/index.ts
```

Run the process under a supervisor and put an HTTPS reverse proxy in front. Set `PUBLIC_ORIGIN` to the browser-visible HTTPS origin. Set `TRUSTED_PROXY_CIDRS` only to actual proxy source ranges.

## Data safety

The database and uploads form one recoverable site state. Follow [backup-restore.md](backup-restore.md) for `pg_dump`, `pg_restore`, provider backups, and upload-volume recovery.

## Related

- [deployment/README.md](README.md) — deployment overview
- [tls-caddy.md](tls-caddy.md) — HTTPS overlay
- [backup-restore.md](backup-restore.md) — PostgreSQL backup and restore
- `compose.prod.yml` — supported production stack
- `compose.tls.yml` — optional Caddy overlay
- `compose.build.yml` — optional source-build overlay

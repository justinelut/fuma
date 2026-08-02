# HTTPS via Caddy (`compose.tls.yml`)

`compose.tls.yml` adds Caddy TLS termination to the PostgreSQL production stack in `compose.prod.yml`.

---

## TL;DR

Set the domain variables and start the production stack with the TLS overlay:

```sh
docker compose -f compose.prod.yml -f compose.tls.yml up -d
```

Add `compose.build.yml` and `--build` only for a deliberate source build.

## Prerequisites

1. A domain whose A/AAAA records point to the server.
2. Public ports 80 and 443.
3. `Caddyfile`, `compose.prod.yml`, and `compose.tls.yml` in the install directory.
4. A configured PostgreSQL password and stable `INSTATIC_SECRET_KEY` in `.env`.

## Configuration

```env
DOMAIN=cms.example.com
LETSENCRYPT_EMAIL=ops@example.com
PUBLIC_ORIGIN=https://cms.example.com
```

Caddy provisions and renews the certificate, reverse-proxies to `app:3001`, and stores certificate state in the `caddy_data` volume. The app's direct host port is removed by the overlay, so only Caddy is public.

`PUBLIC_ORIGIN` must match the browser-visible HTTPS origin for CSRF checks. `TRUSTED_PROXY_CIDRS` controls forwarded client-IP attribution only; restrict it to the actual internal proxy network.

## Verification

```sh
curl -I https://cms.example.com/health
curl -I http://cms.example.com/
```

The health request should return 200 over HTTPS and plain HTTP should redirect to HTTPS. If issuance fails, inspect:

```sh
docker compose -f compose.prod.yml -f compose.tls.yml logs caddy
```

Check DNS propagation, firewall access to ports 80/443, and Let's Encrypt rate limits.

## Reload after Caddyfile changes

```sh
docker compose -f compose.prod.yml -f compose.tls.yml \
  exec caddy caddy reload --config /etc/caddy/Caddyfile
```

## Remove the TLS overlay

To return to direct plain HTTP while preserving PostgreSQL, uploads, and certificate volumes:

```sh
docker compose -f compose.prod.yml -f compose.tls.yml down
docker compose -f compose.prod.yml up -d
```

## Related

- [deployment/README.md](README.md) — deployment overview
- [vps.md](vps.md) — production stack
- [backup-restore.md](backup-restore.md) — PostgreSQL and upload backups
- `compose.prod.yml` — production stack
- `compose.tls.yml` — Caddy overlay
- `Caddyfile` — proxy and security headers

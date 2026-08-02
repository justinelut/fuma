# Fuma Configuration

This reference describes the validated hosted configuration and immutable product metadata in `server/fuma/config.ts`.

`readFumaConfig` is the fail-closed boundary for Fuma environment values. It is separate from the current self-hosted `readServerConfig` in `server/config.ts`, and shares the PostgreSQL-only runtime contract.

---

## TL;DR

- `FumaConfigSchema` and its nested TypeBox schemas are the source of truth for hosted configuration.
- Local mode needs no environment file, remains PostgreSQL-only, and uses only localhost/fake provider values.
- `NODE_ENV` and `FUMA_ENV` must both be `production` for production mode; either one alone is rejected.
- Production requires every configuration class explicitly and accepts only the reserved product/marketing hosts.
- Product metadata fixes `app.trimly.co.ke`, deferred `trimly.co.ke`, and `en-KE` / `KES` / `Africa/Nairobi`.
- Staff cookies are host-only because their configuration has no `domain` property. A boolean cannot assert host-only semantics.
- `summarizeFumaConfig` revalidates its input and returns only non-secret capability/policy facts.
- `.env.fuma.example` contains no deployment credentials or identities. Copy it to an ignored environment file before supplying secrets.

## Configuration boundary

The source of truth is `server/fuma/config.ts`:

```ts
const config = readFumaConfig(process.env)
const safeSummary = summarizeFumaConfig(config)
```

`readFumaConfig` reads individual strings from the untyped environment, constructs a candidate, validates it through `FumaConfigSchema`, and only then enforces cross-field invariants. Invalid values raise `FumaConfigurationError`; its `path` identifies an environment variable or configuration class while its message never includes the rejected value.

`summarizeFumaConfig` accepts an untrusted input, validates it through `FumaConfigSchema`, constructs the allowlisted summary, and validates that through `FumaConfigSummarySchema`. It does not serialize arbitrary fields from the source object.

FUMA-003 does not add a Fuma process root or call providers. Role-specific boot belongs outside this module, while Redis, MinIO, OCI, Paystack, and Cloudflare adapters remain owned by later tasks.

## Product metadata

`FUMA_PRODUCT_METADATA` is validated by `FumaProductMetadataSchema` and encodes:

| Surface | Value | Status |
|---|---|---|
| Product | `app.trimly.co.ke` | active product host |
| Marketing | `trimly.co.ke` | `deferred` |
| Locale | `en-KE` | Kenya launch default |
| Currency | `KES` | integer minor-unit currency |
| Display time zone | `Africa/Nairobi` | persisted timestamps remain UTC |

The marketing value reserves product metadata only. No marketing route, application, or process is implemented.

## Environment mode and production classes

`FUMA_ENV` accepts only `local` or `production`. Its absence means local only when `NODE_ENV` is not `production`. Production is accepted only when both `NODE_ENV=production` and `FUMA_ENV=production` are explicit: a missing or non-production value on either side is rejected before local defaults or provider configuration can be considered. `.env.fuma.example` sets both variables.

With `FUMA_ENV=production`, every class below must be explicit. Empty, missing, or non-string values stop configuration loading before runtime composition:

| Class | Variables |
|---|---|
| Reserved hosts | `FUMA_PRODUCT_HOST`, `FUMA_MARKETING_HOST` |
| Runtime role | `FUMA_ROLE` |
| PostgreSQL | `DATABASE_URL` |
| Redis | `FUMA_REDIS_URL` |
| MinIO | `FUMA_MINIO_ENDPOINT`, `FUMA_MINIO_ACCESS_KEY_ID`, `FUMA_MINIO_SECRET_ACCESS_KEY`, `FUMA_MINIO_BUCKET` |
| OCI Email Delivery | `FUMA_OCI_EMAIL_REGION`, `FUMA_OCI_EMAIL_TENANCY_ID`, `FUMA_OCI_EMAIL_USER_ID`, `FUMA_OCI_EMAIL_FINGERPRINT`, `FUMA_OCI_EMAIL_PRIVATE_KEY_PEM`, `FUMA_OCI_EMAIL_COMPARTMENT_ID`, `FUMA_OCI_EMAIL_APPROVED_SENDER`, `FUMA_OCI_EVENT_VERIFICATION_SECRET` |
| Publication unsubscribe signing | `FUMA_PUBLICATION_UNSUBSCRIBE_SIGNING_SECRET` |
| Paystack platform billing | `FUMA_PAYSTACK_PLATFORM_PUBLIC_KEY`, `FUMA_PAYSTACK_PLATFORM_SECRET_KEY` |
| Paystack customer merchant | `FUMA_PAYSTACK_CUSTOMER_PUBLIC_KEY`, `FUMA_PAYSTACK_CUSTOMER_SECRET_KEY` |
| Fuma-owned Cloudflare | `FUMA_CLOUDFLARE_ACCOUNT_ID`, `FUMA_CLOUDFLARE_ZONE_ID`, `FUMA_CLOUDFLARE_API_TOKEN` |
| Kenya locale | `FUMA_LOCALE`, `FUMA_CURRENCY`, `FUMA_TIME_ZONE` |
| Protected owner | `FUMA_PROTECTED_OWNER_EMAIL` |
| Staff cookie policy | `FUMA_COOKIE_SECURE`, `FUMA_COOKIE_HTTP_ONLY`, `FUMA_COOKIE_SAME_SITE` |

Production roles are limited to `web`, `worker`, and `scheduler`. This is configuration validation only; `server/fuma/config.ts` does not select services or create role composition roots.

Hosted Studio web and production durable workers additionally require `FUMA_OBJECT_ACCESS_SIGNING_SECRET` (at least 32 bytes) when composing MinIO-backed revision and release storage. It must be independent from `FUMA_MINIO_SECRET_ACCESS_KEY`; `.env.fuma.example` leaves both blank. Each process fails before accepting requests or jobs when this signing authority is absent.

Hosted Studio web additionally requires `FUMA_AI_BYOK_METADATA_KEY`, one canonical unpadded base64url encoding of exactly 32 random bytes. Startup imports it as a non-extractable AES-GCM key for the existing FUMA-064 service before activating hosted MCP. It must be independent from staff auth, object signing, MinIO, and provider credentials; only its SHA-256-derived opaque key ID is persisted with encrypted metadata.

## Security invariants

Production loading rejects:

- a missing or non-production `FUMA_ENV` under `NODE_ENV=production`, or a missing/non-production `NODE_ENV` under `FUMA_ENV=production`;
- product/marketing host swaps, aliases, collisions, malformed hostnames, or any value other than the reserved pair;
- a database URL that is not PostgreSQL, has no host, has no database path, or contains a fragment;
- a Redis URL that is not `redis:`/`rediss:`, has no host, or contains a fragment;
- a MinIO endpoint that is not an HTTP(S) origin, including credentials, path, query, or fragment data;
- any production staff cookie policy other than `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/` with no `Domain`;
- any credential value shared between `platform_billing` and `customer_merchant` Paystack scopes;
- non-Kenya locale, currency, or display time-zone values.

Local mode also rejects either production reserved host. This prevents a real product host from being served with fake providers or an insecure local cookie even when `NODE_ENV` was mis-set outside production.

### Host-only cookie semantics

`staffCookie` contains `name`, `secure`, `httpOnly`, `sameSite`, and `path`. Its schema explicitly makes `domain` impossible, and `readFumaConfig` never emits it. The production `__Host-fuma_staff` name additionally requires browser-enforced `Secure`, `Path=/`, and no `Domain` when a later auth task serializes the cookie.

There is deliberately no `hostOnly` boolean and no `FUMA_COOKIE_HOST_ONLY` switch: either could claim host-only scope while a serializer still sends `Domain`. `FUMA_COOKIE_DOMAIN` and `FUMA_COOKIE_HOST_ONLY` are rejected when present so stale or misleading deployment configuration cannot be silently ignored.

## Safe summaries and errors

Do not log `FumaConfig`. Log only `summarizeFumaConfig(config)`. The summary omits database/Redis/MinIO URLs, all provider credentials and identifiers, OCI sender/private-key/compartment/event-verification data, Publication unsubscribe signing authority, Paystack keys, Cloudflare identifiers/tokens, and protected-owner identity. Cookie scope is reported as `staffCookieDomain: 'omitted'` plus `staffCookiePath: '/'`, not as a host-only boolean.

Configuration errors may include variable names and public policy labels, but never raw environment values. `.env.fuma.example` leaves every deployment-specific URL, identifier, identity, and credential blank and contains no realistic key or private-key placeholder.

## Local defaults

With no variables, `readFumaConfig({})` returns a local `web` configuration using:

- `app.localhost` and `marketing.localhost`;
- PostgreSQL, Redis, and MinIO endpoints on `127.0.0.1`;
- visibly fake provider and payment values;
- `owner@localhost.invalid`;
- `en-KE`, `KES`, and `Africa/Nairobi`;
- an HttpOnly, SameSite=Lax, Path=/ cookie with no Domain and `Secure=false` for plain localhost HTTP.

Local defaults are test/development input only. Production never inherits them.

## Forbidden patterns

- Keep `readFumaConfig` use behind explicit hosted/role composition guards so self-host startup never constructs hosted providers.
- Do not add role-specific startup, provider clients, routes, persistence schema, migrations, or dependency packages to this configuration module.
- Do not put credentials, identities, deployment URLs, or realistic credential-shaped placeholders in `.env.fuma.example`.
- Do not include raw configuration values in errors or summaries.
- Do not add a cookie `domain` field or a boolean that claims host-only behavior.
- Do not merge Paystack scopes or infer a scope from a route or transaction.

## Related

- `docs/reference/fuma-platform-architecture.md` — hosted topology and task boundaries.
- `docs/reference/fuma-test-fixtures.md` — deterministic Fuma test scaffolding.
- `server/fuma/config.ts` — TypeBox schemas, parser, invariants, and safe summary.
- `.env.fuma.example` — tracked production variable inventory without deployment values.
- `src/__tests__/fuma/fumaConfig.test.ts` — FUMA-003 behavior and failure gates.
- `server/config.ts` — unchanged self-hosted configuration boundary.

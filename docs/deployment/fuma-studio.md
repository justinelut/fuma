# Fuma Studio deployment runbook

Studio is the private runtime: the admin, the editor, auth, and the app host. Deploying it is what makes login, dashboards and key management work. The public Web at the apex is already deployed and is unaffected by this.

## Hosts

| Host | Served by |
|---|---|
| `trimly.co.ke`, `www.trimly.co.ke` | public Web (already deployed) |
| `app.trimly.co.ke` | Studio — customer product |
| `auth.trimly.co.ke` | Studio — identity |
| `admin.trimly.co.ke` | Studio — internal console |

Studio's IngressRoute claims only the three Studio hosts, so it cannot take the apex from the public Web. The deploy smoke test asserts the apex still returns the public Web footer.

## What gets deployed

`infra/fuma-phase-13-18/k3s/studio-production.template.yaml` renders 16 resources into the existing `fuma` namespace:

- **PostgreSQL** — single-replica StatefulSet, 20 GiB volume
- **Redis** — coordination
- **MinIO** — object storage, 50 GiB volume, plus an idempotent bucket-init Job
- **`fuma-migrate`** — a Job that runs hosted migrations and must complete before the web rollout
- **`fuma-studio`**, **`fuma-worker`**, **`fuma-scheduler`** — the three runtime roles from one image
- Traefik security-headers middleware and the Studio IngressRoute

The runtime image is built by `.github/workflows/fuma-studio-release.yml` natively on ARM64 and published as `ghcr.io/<owner>/fuma-runtime`.

## One secret holds all configuration

Create a single repository secret named **`FUMA_ENV_SECRET`** containing one `KEY=value` per line. The deploy stages it to disk, turns it into the `fuma-secrets` Kubernetes Secret with `--from-env-file`, then deletes the staged file. Every workload reads it through `envFrom`.

The deploy **fails fast** if any of these are missing, rather than letting a pod crash-loop:

```text
DATABASE_URL
FUMA_REDIS_URL
FUMA_ROLE
FUMA_MINIO_ENDPOINT
FUMA_MINIO_BUCKET
FUMA_MINIO_ACCESS_KEY_ID
FUMA_MINIO_SECRET_ACCESS_KEY
FUMA_PROTECTED_OWNER_EMAIL
FUMA_PUBLICATION_UNSUBSCRIBE_SIGNING_SECRET
POSTGRES_USER
POSTGRES_PASSWORD
```

In-cluster values, since Postgres, Redis and MinIO run beside Studio:

```text
DATABASE_URL=postgres://<POSTGRES_USER>:<POSTGRES_PASSWORD>@postgres.fuma.svc.cluster.local:5432/fuma
FUMA_REDIS_URL=redis://redis.fuma.svc.cluster.local:6379
FUMA_MINIO_ENDPOINT=http://minio.fuma.svc.cluster.local:9000
FUMA_MINIO_BUCKET=fuma
FUMA_ROLE=web
```

`FUMA_ENV=production`, `FUMA_HOSTED=true` and `FUMA_DEPLOYMENT_ROOT_DOMAIN` are injected by the workflow, so do not set them by hand. `FUMA_COOKIE_DOMAIN` and `FUMA_COOKIE_HOST_ONLY` must never be set — Fuma staff cookies are host-only and config rejects those keys outright.

## Provider keys you add when ready

These are read from configuration, so add them to `FUMA_ENV_SECRET` (or as the separate repository secrets noted) whenever you have them:

| Purpose | Keys |
|---|---|
| Payments | `FUMA_PAYSTACK_PLATFORM_SECRET_KEY`, `FUMA_PAYSTACK_PLATFORM_PUBLIC_KEY`, `FUMA_PAYSTACK_CUSTOMER_SECRET_KEY`, `FUMA_PAYSTACK_CUSTOMER_PUBLIC_KEY`, `FUMA_PAYSTACK_PROVIDER_URL` |
| Email | `FUMA_OCI_EMAIL_*` (region, tenancy, user, fingerprint, private key PEM, compartment, approved sender) and `FUMA_OCI_EVENT_VERIFICATION_SECRET` |
| Domains | `FUMA_CLOUDFLARE_ACCOUNT_ID`, `FUMA_CLOUDFLARE_ZONE_ID`, `FUMA_CLOUDFLARE_API_TOKEN` |
| Locale | `FUMA_CURRENCY`, `FUMA_LOCALE`, `FUMA_TIME_ZONE` |

Separate repository secrets, injected only when present so they stay inert until set:

| Purpose | Secret |
|---|---|
| Error reporting | `SENTRY_DSN` |
| Google sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |

Google sign-in activates automatically once both Google values exist: the hosted auth options add the provider only when both are non-blank, pin the callback to `https://auth.<root>/api/auth/callback/google`, and restrict account linking to matching verified emails.

Paystack keys are read from configuration rather than an admin form, so they belong in `FUMA_ENV_SECRET`. AI provider keys are different — those are per-tenant BYOK through the existing AI credits authority and are entered in the app, not here.

## Deploy order

1. Run **Fuma Studio release** and note the 7-character tag it prints.
2. Ensure `FUMA_ENV_SECRET` exists with at least the required keys.
3. Run **Fuma Studio deploy** with that tag.

The deploy waits for Postgres, Redis and MinIO, then blocks on the migration Job before rolling out the web role. On failure it dumps pod state, describe output, recent events and current plus previous logs rather than timing out silently. It clears pods stuck in image-pull backoff so they retry against the freshly written pull secret.

## What is not automated

- **DNS.** `app`, `auth` and `admin` records must point at the server before TLS can be issued. No DNS record is created or modified by this workflow.
- **The owner account.** `FUMA_PROTECTED_OWNER_EMAIL` names the protected owner; first-run sign-in still happens through the deployed auth host.
- **Backups.** Postgres and MinIO carry durable volumes, but no scheduled backup is included here.
- **The `ghcr-secret` lifetime.** It is minted from the deploy run's `GITHUB_TOKEN`, so it expires. Every deploy refreshes it; a cold pull long after the last deploy can fail until the next one. Making `fuma-runtime` public, or supplying a read-only registry token, removes that caveat.

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

### Already configured

These are cluster-internal or policy values, generated and set during setup. Postgres, Redis and MinIO run beside Studio, so their addresses are in-cluster service names and their credentials are self-contained:

```text
FUMA_ROLE=web
DATABASE_URL=postgres://fuma:<generated>@postgres.fuma.svc.cluster.local:5432/fuma
POSTGRES_USER=fuma
POSTGRES_PASSWORD=<generated>
FUMA_REDIS_URL=redis://redis.fuma.svc.cluster.local:6379
FUMA_MINIO_ENDPOINT=http://minio.fuma.svc.cluster.local:9000
FUMA_MINIO_BUCKET=fuma
FUMA_MINIO_ACCESS_KEY_ID=<generated>
FUMA_MINIO_SECRET_ACCESS_KEY=<generated>
FUMA_PUBLICATION_UNSUBSCRIBE_SIGNING_SECRET=<generated>
FUMA_PROTECTED_OWNER_EMAIL=justinequartz@gmail.com
FUMA_CURRENCY=KES
FUMA_LOCALE=en-KE
FUMA_TIME_ZONE=Africa/Nairobi
FUMA_COOKIE_SECURE=true
FUMA_COOKIE_HTTP_ONLY=true
FUMA_COOKIE_SAME_SITE=lax
FUMA_PAYSTACK_PROVIDER_URL=https://api.paystack.co
```

Change `FUMA_PROTECTED_OWNER_EMAIL` if the protected owner should be a different address.

`FUMA_ENV=production`, `FUMA_HOSTED=true` and `FUMA_DEPLOYMENT_ROOT_DOMAIN` are injected by the workflow, so do not set them by hand. `FUMA_COOKIE_DOMAIN` and `FUMA_COOKIE_HOST_ONLY` must never be set — Fuma staff cookies are host-only and config rejects those keys outright.

### Still required before Studio can boot

Fuma validates fourteen configuration classes **fail-closed** at startup, so the runtime refuses to start until every one is present. Fifteen values remain, and all are real provider credentials that cannot be generated:

| Class | Keys |
|---|---|
| OCI Email Delivery | `FUMA_OCI_EMAIL_REGION`, `FUMA_OCI_EMAIL_TENANCY_ID`, `FUMA_OCI_EMAIL_USER_ID`, `FUMA_OCI_EMAIL_FINGERPRINT`, `FUMA_OCI_EMAIL_PRIVATE_KEY_PEM`, `FUMA_OCI_EMAIL_COMPARTMENT_ID`, `FUMA_OCI_EMAIL_APPROVED_SENDER`, `FUMA_OCI_EVENT_VERIFICATION_SECRET` |
| Paystack platform billing | `FUMA_PAYSTACK_PLATFORM_PUBLIC_KEY`, `FUMA_PAYSTACK_PLATFORM_SECRET_KEY` |
| Paystack customer merchant | `FUMA_PAYSTACK_CUSTOMER_PUBLIC_KEY`, `FUMA_PAYSTACK_CUSTOMER_SECRET_KEY` |
| Fuma-owned Cloudflare | `FUMA_CLOUDFLARE_ACCOUNT_ID`, `FUMA_CLOUDFLARE_ZONE_ID`, `FUMA_CLOUDFLARE_API_TOKEN` |

Add them to `FUMA_ENV_SECRET` alongside the existing lines. The deploy checks all fourteen classes **before** contacting the cluster and prints the exact missing keys grouped by class, so a missing credential never becomes a crash-looping pod.

## Provider keys and optional integrations

Separate repository secrets, injected only when present so they stay inert until set:

| Purpose | Secret |
|---|---|
| Error reporting | `SENTRY_DSN` |
| Google sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |

Google sign-in activates automatically once both Google values exist: the hosted auth options add the provider only when both are non-blank, pin the callback to `https://auth.<root>/api/auth/callback/google`, and restrict account linking to matching verified emails.

Paystack, OCI Email and Cloudflare are read from configuration rather than an admin form, so they belong in `FUMA_ENV_SECRET` as listed above. AI provider keys are different — those are per-tenant BYOK through the existing AI credits authority and are entered in the app, not here.

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

# Oracle ARM64 k3s and Traefik runbook

Status: **configuration authored; no cloud purchase, host mutation, Kubernetes apply, DNS change, TLS operation, or smoke was performed.** Versions are pinned in `infra/fuma-phase-13-18/oracle/versions.env`; `oracle/host-baseline.yaml` records the non-executable ARM64/firewall/storage/SSH baseline. Image digests, Oracle resource IDs, Cloudflare ranges and the Oracle Linux image OCID remain external approvals.

## Preconditions

- Approved Oracle tenancy, compartment, ARM64 shape, reserved public IP, block volume, VCN/subnets/security lists and off-host backup bucket.
- Current quota and cost approval. A single-node shape is not high availability; process replicas only reduce process-level interruptions.
- Fuma-owned Cloudflare zone/token with minimum DNS/cache/origin-certificate scope, approved apex review, WAF/origin allowlist and no customer credential requirement.
- Immutable GHCR runtime/public/control/ops digests from one source SHA, SBOM/provenance/scan policy, finalized hosted migration checksums and signed paired manifest.
- Separately recoverable Kubernetes/bootstrap, database, object-store, backup-encryption, signing and provider secrets. No value belongs in Git or shell history.

## Host preparation (operator procedure, not executed)

1. Record Oracle resource IDs, image OCID, shape, boot/block volume encryption, region/AD, VCN rules and quote in signed evidence.
2. Permit inbound 443 only through the approved Cloudflare origin ranges. Restrict SSH to the break-glass administration network; prefer serial console and short-lived keys. Deny public database, Redis, MinIO, metrics, k3s API and node ports.
3. Patch Oracle Linux, configure automatic security updates, time sync, audit logs, disk alerts and a non-root operator. Disable password SSH and root login.
4. Install exactly `K3S_VERSION`; bind API/etcd to private interfaces, encrypt secrets at rest, store the token outside the node, disable bundled ingress if installing the pinned Traefik chart, and preserve a fresh-node reconstruction record.
5. Install the pinned Traefik chart with `traefik-values.yaml`, then approved KEDA and monitoring versions. Dashboard and HTTP ingress remain disabled.
6. Create secrets through the approved secret channel. Never materialize them from this repository. Apply namespace-scoped policy before workloads.

## Declarative order

1. Finalize image digests and migration checksums; render a candidate overlay. Reject any tag, placeholder, mixed SHA or plaintext Secret.
2. Apply namespace/service accounts/default deny, provider-specific egress overlay, workloads/services, exact routes, autoscaling and observability.
3. Run the suspended migration Job only after database backup, advisory-lock and manifest review. Any migration failure halts rollout.
4. Bring up runtime worker/scheduler/web, public web and control contribution. Scheduler remains one replica with its coordination fence.
5. Verify exact `trimly.co.ke`, `www`, `auth`, `app`, `admin`, two allocated tenant hosts and one verified custom host. Unknown/unallocated/reserved tenant hosts must fail closed.
6. Verify identity routes only on auth, customer product only on app, internal console only on admin, and distinct host-only cookies with no `Domain` attribute.
7. Verify public web cannot forward visitor credentials to the private runtime and can fail/roll back independently while product and tenant serving continue.

## Cloudflare/origin policy

Cloudflare publishes canonical/apex and exact product records only after the signed canary gate. The origin accepts Cloudflare source ranges and origin-authenticated TLS; direct origin, unknown host and arbitrary `X-Forwarded-Host` fail. `www` redirects to the apex. Wildcard tenant TLS does not allocate a tenant: allocation still resolves from server authority. Custom-host routes are generated only from verified domain records.

## Drain and upgrade

Cordon/drain is honest: on one node it interrupts node-local service despite multiple pods. Quiesce scheduler claims, allow web readiness to fail before termination, wait for worker lease handoff, verify backup freshness, then upgrade one pinned component at a time. Do not claim PDB/node spread as host HA. If health or host isolation fails, restore the prior digest/config; schema rollback is not attempted after a forward migration—use compatible application rollback or restore according to the migration decision.

## Required evidence

Firewall/origin intent, exact-host matrix, cookie headers, route isolation, non-root/read-only/capability posture, network policy reachability, persistence, process drain, scheduler uniqueness, image digests/SBOM/provenance, migration report, Blyss/public-host smoke, current backup and restore drill. All output must be redacted and signed by named owners.

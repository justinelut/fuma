# Fuma migration, backup, restore, smoke, and DR runbook

No migration, backup, restore, destruction, Docker, Kubernetes or cloud command was executed while authoring this runbook. `infra/fuma-phase-13-18/k3s/operations.yaml` ships suspended templates and cannot be promoted with placeholder digests.

## Objectives

- PostgreSQL and MinIO/config backup at least every six hours; signed production RPO is no greater than six hours.
- Monthly isolated restore drill; signed launch RTO target is no greater than two hours until measured evidence approves a different target.
- Off-host encrypted retention: daily 35 days, monthly 13 months, subject to legal/financial retention policy. Encryption keys are separately recoverable and never co-located only with ciphertext.
- Restore verifies tenant/release/media counts and hashes plus public/product/admin/tenant/custom-host behavior.

## Pre-deploy backup and migration gate

1. Validate paired source SHA, lock hash, runtime/public digests, SBOM/provenance, migration high-water mark and smoke-evidence identity. Mixed manifests halt.
2. Confirm latest encrypted PostgreSQL, object-store and configuration backups and independent key-recovery test.
3. Run migration planning against immutable history. Historical checksum mismatch, destructive SQL, non-contiguous order, unavailable lock or failed dry-run halts.
4. Start exactly one migration Job under advisory lock. Capture migration IDs/checksums/counts/timing and the database backup identity. Do not promote on partial/failure.
5. Run runtime/web/worker/scheduler health plus exact-host and cookie isolation. Browser/routing/TLS acceptance must use approved public HTTPS endpoints, never loopback.

## Backup content and integrity

PostgreSQL backup includes schema, rows, extensions and migration history. Object backup includes MinIO version/object metadata, release manifests and media. Configuration backup contains non-secret declarative config and encrypted secret envelopes; key custody is separate. The signed manifest includes source cluster, start/end times, object/count hashes, encryption key ID, storage destination, retention class and software versions. Logs include none of the values.

## Isolated restore drill

1. Create a dedicated ephemeral verification namespace/account with no production egress or callback routes.
2. Restore database first, then objects/config, using a separately recovered key. Never point restore tooling at production endpoints.
3. Verify migration high-water mark, organization/workspace/site/owner generations, releases, media, plugin artifacts/installations, AI ledgers, domain/payment/email evidence and audit chain counts/hashes.
4. Start the exact paired digest and serve restored fixture routes on an approved isolated HTTPS hostname. Compare canonical product/public/tenant responses and immutable release hashes.
5. Record observed RPO/RTO, discrepancies and signed result. Destroying the ephemeral environment is a separately approved operation and is not automated from this repository.

## Failure and rollback

- **Migration failure:** halt; do not reverse schema. Keep old service on compatible schema where proven or restore the pre-migration backup under incident command.
- **Runtime canary failure:** route no additional cohort; restore previous runtime digest if compatible.
- **Public-web canary failure:** independently restore prior web digest/cache dataset; product and tenant services stay unchanged.
- **Mixed manifest or host smoke failure:** no promotion.
- **Backup stale/key unavailable/restore mismatch:** launch and deploy halt.
- **Single process loss:** readiness removes it; worker lease and scheduler fences prevent duplicate authority.
- **Node loss:** this topology is not HA. Rebuild a fresh approved node and restore within measured RTO.

## Smoke matrix

Check `/health/live` and `/health/ready`, background queue claims, one immutable release, media range/head, public projection validation, apex/www, auth/app/admin, two tenant hosts, verified custom host, unknown host denial, no default tenant, no parent-domain cookie, email fixture render, fake provider payment verification, AI reservation/refund, reviewed plugin signature/install, public-web private BFF timeout/degradation and independent rollback. Live money, email, DNS and AI provider calls require separate test-account approval.

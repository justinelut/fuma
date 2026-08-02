# FUMA native ARM64 paired release runbook

This runbook covers the repository-owned FUMA-078 supply-chain policy for the hosted runtime, public-Web, and site-runtime images. “Paired release” remains the downstream release-envelope name: one immutable manifest binds the product runtime/public-Web pair together with the independently deployable tenant site-runtime from the same source identity. This workflow does not deploy, run migrations, mutate DNS/TLS or Kubernetes, purchase infrastructure, or alter the preserved legacy self-host image.

## Repository contract

- Workflow: `.github/workflows/fuma-paired-release.yml`, manual dispatch only.
- Native policy: every job uses `ubuntu-24.04-arm`, verifies `RUNNER_ARCH=ARM64` and `uname -m=aarch64`, and accepts only `linux/arm64`. There is no amd64 matrix, QEMU, or emulation policy.
- Legacy self-host source: root `Dockerfile`, unchanged and independently released as `ghcr.io/corebunch/instatic`.
- Hosted runtime: `infra/fuma-phase-13-18/docker/runtime.Dockerfile`, non-root `bun`, explicit `web`, `worker`, `scheduler`, `migration`, and CI-only `email-compatibility` commands.
- Public Web: `infra/fuma-phase-13-18/docker/public-web.Dockerfile`, non-root `10001:10001`, standalone Next server on port 3002.
- Site runtime: `infra/fuma-phase-13-18/docker/site-runtime.Dockerfile`, non-root `10002:10002`, standalone Next server on port 3003.
- Exact dependency identity: every source copies root `package.json`, root `bun.lock`, and every workspace package manifest before `bun install --frozen-lockfile`. App/package-local lockfiles are forbidden.
- Manifest: schema v4 in `packages/fuma-governance-launch/src/contracts.ts` and `infra/fuma-phase-13-18/release/paired-release.template.json`.
- Tooling: `packages/fuma-governance-launch/tooling/pairedRelease.ts` creates exact bytes and a checksum sidecar with create-only hard links and verifies the complete retained evidence set.

Accepted image identities are digest-only:

```text
ghcr.io/corebunch/fuma-runtime@sha256:<64 lowercase hex>
ghcr.io/corebunch/fuma-web@sha256:<64 lowercase hex>
ghcr.io/corebunch/fuma-site-runtime@sha256:<64 lowercase hex>
```

The three digest values must be pairwise distinct. Each image source claim must equal the manifest source SHA. The manifest binds the exact root-lock hash, finalized hosted migration tail, one ARM64 OCI index per image, one create-only ARM64 smoke receipt per image, published-digest Trivy SARIF, published-image SPDX, SLSA provenance, Cosign verification JSON, and a non-promoting publication plan. Placeholders, mutable tags, mixed SHA, wrong lock/migration identity, unrelated/duplicate OCI descriptors, non-ARM64 architecture, digest reuse, evidence tampering, and manifest tampering fail closed.

## Runtime and smoke commands

The runtime entrypoint accepts:

```text
fuma-runtime web
fuma-runtime worker
fuma-runtime scheduler
fuma-runtime migration [arguments]
fuma-runtime email-compatibility
```

`runtime-smoke.sh` boots all three service roles, verifies their role-specific readiness ownership, executes the migration probe, and checks the ARM64 email renderer. `public-web-smoke.sh` requires a 200 response. `site-runtime-smoke.sh` requires the standalone process to answer and deny a direct-origin request with 404. All scripts inspect source/lock/migration labels, architecture, and non-root user before booting. They refuse existing output paths and clean up only containers created by that invocation. These HTTP probes are container liveness checks, not browser, TLS, proxy, routing, or public-host acceptance.

## Required protected GitHub policy

Before dispatch, a repository owner must verify all of the following outside this repository:

1. The selected ref is protected. The workflow rejects an unprotected ref or a `release_ref` different from `github.sha`.
2. Environment `fuma-release-supply-chain` has required reviewers and prevents unreviewed publication.
3. Repository variables `FUMA_BUN_IMAGE_DIGEST` and `FUMA_NODE_IMAGE_DIGEST` are non-placeholder immutable digest references with native ARM64 support.
4. The protected environment grants package write and OIDC only to the publish job.
5. GitHub-hosted `ubuntu-24.04-arm` capacity is available; changing the runner or introducing emulation is not an equivalent acceptance path.

Repository YAML cannot prove these settings. Missing reviewer, runner, variable, registry, or OIDC evidence blocks publication and closure.

## Protected gate order

A successful protected run must:

1. Check out the exact SHA without persisted credentials, hash the unchanged root lock, and derive the finalized hosted migration tail from the registered migration index.
2. Run bounded governance typecheck/tests, the deterministic repository demo, and shell syntax checks.
3. Natively build and boot all three ARM64 images plus the unpublished compatibility target.
4. Block on HIGH/CRITICAL prepublication findings and retain prepublication SPDX receipts.
5. Enter the protected environment only after preflight and architecture gate success.
6. Refuse existing source-SHA tags, then publish all three SHA-tagged ARM64 images with BuildKit SBOM/provenance enabled.
7. Resolve immutable digest references, retain raw OCI indexes, and reject any runnable platform other than exactly one `linux/arm64` descriptor (attestation descriptors may be `unknown/unknown`).
8. Pull and boot all three published digests natively, producing exactly `arm64.json` in each smoke directory.
9. Scan each published digest with blocking Trivy policy and bind each SARIF receipt to source SHA, image digest, and `linux/arm64`.
10. Generate fresh SPDX from each published digest and retain SLSA provenance covering each runnable ARM64 manifest digest and source SHA.
11. Sign and verify only the scanned immutable image digests.
12. Record a plan with state `registry-published-unpromoted`, orphan any partial publication, retain last-known-good digests, and perform no deletion or deployment mutation.
13. Assemble and fully verify the create-only paired manifest/checksum, prove byte tamper and mixed-SHA rejection, then sign and verify the exact manifest bytes.
14. Upload the retained artifact. Upload is evidence retention, not promotion or deployment.

Any partial image publication is a non-promotable orphan. Registry deletion is a separate high-risk administrative action and is not encoded here.

## Offline retained-evidence verification

From a clean checkout of the same source SHA, with the protected artifact under `supply/`:

```sh
bun packages/fuma-governance-launch/tooling/pairedRelease.ts \
  --verify=supply/paired-release.json --evidence=full \
  --runtime-index=supply/runtime.index.json \
  --web-index=supply/web.index.json \
  --site-runtime-index=supply/site-runtime.index.json \
  --runtime-scan=supply/runtime.trivy.sarif \
  --web-scan=supply/web.trivy.sarif \
  --site-runtime-scan=supply/site-runtime.trivy.sarif \
  --runtime-sbom=supply/runtime.spdx.json \
  --web-sbom=supply/web.spdx.json \
  --site-runtime-sbom=supply/site-runtime.spdx.json \
  --runtime-provenance=supply/runtime.provenance.json \
  --web-provenance=supply/web.provenance.json \
  --site-runtime-provenance=supply/site-runtime.provenance.json \
  --runtime-signature-verification=supply/runtime.signature-verification.json \
  --web-signature-verification=supply/web.signature-verification.json \
  --site-runtime-signature-verification=supply/site-runtime.signature-verification.json \
  --runtime-smoke-dir=supply/runtime-smoke \
  --web-smoke-dir=supply/web-smoke \
  --site-runtime-smoke-dir=supply/site-runtime-smoke \
  --publication-plan=supply/publication-plan.json
```

The result must contain `verified:true` and `evidenceVerified:true`. A bare `--verify` checks strict shape, canonical manifest hash, and checksum sidecar only; it is not protected acceptance. Independently verify the retained Sigstore bundle and all three image signatures against the exact workflow OIDC identity.

## Deterministic repository demo

The repository-only demo performs no network request, container action, signing, publication, deployment, or external mutation:

```sh
bun --cwd=packages/fuma-governance-launch run release:demo
```

It creates one deterministic in-memory schema-v4 manifest and proves mixed-SHA, reused digest, wrong architecture, and field-tamper rejection. Its `externalEvidence:false` result is intentionally not protected acceptance.

## Repository evidence versus protected evidence

Repository validation can prove source structure, strict contracts, canonical hashing, exact-lock policy, create-only output behavior, cleanup ownership, native-runner policy text, workflow gate ordering, and deterministic rejection paths. It cannot prove that images built or booted, that GHCR accepted immutable bytes, that scans/SBOM/provenance/signatures exist for published digests, that GitHub environment protection is configured, or that any release deployed.

FUMA-078 protected acceptance therefore still requires a successful reviewed workflow run and retained real evidence: run URL/ID/conclusion; exact source SHA/root-lock hash/migration tail; three immutable image digests and OCI indexes; three ARM64 smoke receipts; three blocking scan receipts; three SPDX documents; three SLSA provenance records; three image signature verification records; non-promoting publication plan; paired manifest/checksum/signature bundle; and reviewer confirmation. Do not close the ticket from repository tests or this runbook alone.

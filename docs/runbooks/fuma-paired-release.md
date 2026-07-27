# FUMA paired multi-architecture release runbook

This runbook covers the repository-owned FUMA-078 workflow that builds and gates paired hosted runtime/public-web images. It does not deploy either image, mutate DNS/TLS or Kubernetes, run migrations, purchase infrastructure, or alter the preserved self-host `ghcr.io/corebunch/instatic` release path.

## Release contract

- Workflow: `.github/workflows/fuma-paired-release.yml` (`workflow_dispatch` only).
- Runtime image: `infra/fuma-phase-13-18/docker/runtime.Dockerfile`, non-root `bun`, explicit `web`, `worker`, `scheduler`, and `migration` commands.
- Email compatibility target: the same source/lock identity with the exact development graph needed by the architecture probe; it runs non-root and is never published.
- Public web image: `infra/fuma-phase-13-18/docker/public-web.Dockerfile`, non-root numeric UID/GID `10001:10001`, Next standalone server only.
- Manifest tool: `packages/fuma-governance-launch/tooling/pairedRelease.ts`; schema version 3 binds the exact OCI indexes, published-digest Trivy SARIF, published-image SPDX documents, BuildKit SLSA provenance, cosign verification JSON, paired smoke receipts, and a non-promoting publication plan.
- Published identities are accepted only as `ghcr.io/corebunch/fuma-runtime@sha256:<digest>` and `ghcr.io/corebunch/fuma-web@sha256:<digest>`. Mutable tags never enter the paired manifest.
- Both images, both architecture evidence sets, the root `bun.lock`, and the finalized hosted migration high-water mark must bind the same source SHA.

The root package contract is exactly Bun `1.3.14`, workspaces `apps/*` and `packages/*`, one root `bun.lock`, and no app/package-local lockfiles. Every workspace manifest is copied before each frozen container install.

## Required GitHub policy

Do not dispatch until all of these repository settings exist:

1. The selected branch or tag is protected. Both preflight and publication fail closed when `github.ref_protected` is false.
2. Environment `fuma-release-supply-chain` is protected with required reviewers and prevents unreviewed publication. The workflow receives `packages: write` and `id-token: write` only in that environment-bound publish job.
3. Repository variables `FUMA_BUN_IMAGE_DIGEST` and `FUMA_NODE_IMAGE_DIGEST` are complete immutable image references ending in `@sha256:<64 lowercase hex>`; tags without digests are rejected.
4. The dispatcher can name the exact 40-character commit checked out by the protected ref. `release_ref` must equal `github.sha`; branch names, tags, prefixes, uppercase hashes, placeholders, and a different commit are rejected.

Environment protection is a GitHub repository setting and cannot be proven by this YAML alone. Treat a missing reviewer rule as a publication blocker.

## Dispatch and gate order

Dispatch **Fuma paired multi-architecture release** from the protected ref and enter its exact commit SHA as `release_ref`. The workflow then:

1. checks out that exact SHA without persisted credentials;
2. verifies root Bun/workspace/lock identity and computes the lock hash and finalized hosted migration high-water mark;
3. runs only the governance typecheck/tests and shell syntax gate;
4. independently builds and boots `linux/amd64` and `linux/arm64` runtime roles, migration command, email renderer, and Next standalone server;
5. records architecture-specific, create-only smoke JSON binding source SHA, lock hash, migration high-water mark, image identity, platform, non-root state, and response/log hashes;
6. blocks on HIGH/CRITICAL Trivy findings and emits per-architecture SPDX JSON;
7. only after both architecture jobs pass and after refusing pre-existing source-SHA tags, publishes SHA-tagged manifest lists and immediately records their immutable digest references;
8. records raw OCI indexes, allows only the exact two runnable platforms plus BuildKit attestation descriptors, boots both published digest architectures, scans both published digests, and validates both SARIF reports;
9. generates fresh SPDX JSON from each published immutable digest and extracts BuildKit SLSA provenance whose subjects cover both runnable platform-manifest digests and whose source is the release SHA;
10. keyless-signs and verifies only those scanned immutable image digests, retaining exact cosign verification JSON;
11. records a hash-bound plan that is explicitly unpromoted, performs no deployment or registry deletion, treats a partial pair as a non-promotable orphan, and retains last-known-good digests for later rollback authority;
12. assembles a staged, fsynced, create-only paired manifest and checksum sidecar, performs full retained-evidence verification, and proves tamper and mixed-SHA rejection; and
13. keyless-signs and verifies the exact paired-manifest bytes before uploading the retained workflow artifact.

A SHA tag is a registry discovery handle, not promotion authority. Only the digest references inside a verified paired manifest are admissible downstream.

## Evidence and offline verification

The artifact `paired-release-<source-sha>` contains the manifest, checksum sidecar, immutable digest files, source claims, both architecture smoke directories, scan reports, SBOM/provenance records, signature bundle, and prepublication architecture evidence. Smoke directories must contain exactly `amd64.json` and `arm64.json`; extra files, wrong platform names, repeated/missing roles, different image identities, mixed source/lock/migration values, or placeholder hashes fail verification.

After downloading an artifact into a clean checkout of the same source, run full evidence verification (paths below are relative to the downloaded artifact root):

```sh
bun packages/fuma-governance-launch/tooling/pairedRelease.ts \
  --verify=supply/paired-release.json --evidence=full \
  --runtime-index=supply/runtime.index.json --web-index=supply/web.index.json \
  --runtime-scan=supply/runtime.trivy.sarif --web-scan=supply/web.trivy.sarif \
  --runtime-sbom=supply/runtime.spdx.json --web-sbom=supply/web.spdx.json \
  --runtime-provenance=supply/runtime.provenance.json --web-provenance=supply/web.provenance.json \
  --runtime-signature-verification=supply/runtime.signature-verification.json \
  --web-signature-verification=supply/web.signature-verification.json \
  --runtime-smoke-dir=supply/runtime-smoke --web-smoke-dir=supply/web-smoke \
  --publication-plan=supply/publication-plan.json
```

The result must report both `verified: true` and `evidenceVerified: true`. A bare `--verify` checks only strict manifest shape, canonical manifest hash, and its checksum sidecar; it deliberately reports `evidenceVerified: false` and is not full acceptance. Full mode reparses every gate schema, cross-binds provenance to both runnable OCI platform descriptors, checks exact source/image/platform/smoke identity, and compares every retained file hash. Sigstore verification remains independently required using the retained bundle and expected GitHub Actions OIDC workflow identity.

## Failure and cleanup

- Smoke scripts refuse to overwrite an existing evidence path before invoking a container engine.
- They remove only container IDs successfully created by that invocation. A name collision is never adopted or deleted.
- Evidence is written to a same-directory exclusive temporary file and hard-linked to the final absent path; failure or a final-path race removes only the temporary file.
- Manifest and checksum creation stage bytes in same-directory private temporary directories, fsync each staged file, and hard-link create-only into the final path. If checksum publication fails after a new manifest link, only that newly-owned manifest is removed; an existing checksum is preserved. Temporary staging directories are always removed.
- Architecture failure prevents the publish job. Scan, attestation, signature, manifest, or signature-verification failure prevents a promotable paired artifact.
- If one immutable image digest was pushed before a later publish-stage failure, it is an unpaired orphan, not a release. Do not deploy it and do not synthesize evidence. Registry deletion, if desired, is a separate explicitly approved administrative action.
- Re-run only after diagnosing the failed gate. Existing evidence/output paths must be moved to a new review location or removed deliberately; tooling never overwrites them.

## Static validation versus external acceptance

Repository validation can prove workflow syntax, policy ordering, strict contracts, non-overwrite behavior, cleanup ownership, and rejection paths. It cannot prove that GitHub environment protection is configured or that real images boot, publish, scan, attest, sign, or verify. Those claims require a successful protected workflow and retained external evidence. The workflow performs no deployment; FUMA-079/FUMA-080 own infrastructure and promotion.

## Related

- `packages/fuma-governance-launch/tests/architecture/supply-chain.architecture.test.ts`
- `packages/fuma-governance-launch/tests/integration/supply-chain.integration.test.ts`
- `packages/fuma-governance-launch/tests/integration/paired-release-tooling.integration.test.ts`
- `docs/reference/fuma-governance-launch-phase.md`
- `docs/deployment/self-host-smoke-harness.md` — separate preserved Instatic self-host parity harness

## Externally approved acceptance sequence — not executed in this bounded phase

A repository owner must first verify the protected environment/reviewer rule and set non-placeholder immutable `FUMA_BUN_IMAGE_DIGEST` and `FUMA_NODE_IMAGE_DIGEST` repository variables. With renewed approval for Docker/buildx/QEMU, GHCR writes, network vulnerability scans, keyless signing, and GitHub secret use, execute from a clean checkout:

```sh
SOURCE_SHA=$(git rev-parse HEAD)
printf '%s\n' "$SOURCE_SHA" | grep -Eq '^[a-f0-9]{40}$'
gh workflow run fuma-paired-release.yml --ref <protected-branch> -f release_ref="$SOURCE_SHA"
gh run list --workflow fuma-paired-release.yml --branch <protected-branch> --limit 1
gh run watch <run-id> --exit-status
gh run download <run-id> --name "paired-release-$SOURCE_SHA" --dir .tmp/fuma-078-acceptance
```

Then, from the same source checkout, place the downloaded `supply/` directory at `.tmp/fuma-078-acceptance/supply` (the artifact normally already has that shape) and run the full verification command from the preceding section with each `supply/` prefix replaced by `.tmp/fuma-078-acceptance/supply/`. Independently verify the manifest bundle and both image signatures:

```sh
IDENTITY='^https://github\.com/corebunch/instatic/\.github/workflows/fuma-paired-release\.yml@refs/(heads|tags)/.+'
cosign verify-blob \
  --bundle .tmp/fuma-078-acceptance/supply/paired-release.sigstore.json \
  --certificate-identity-regexp "$IDENTITY" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  .tmp/fuma-078-acceptance/supply/paired-release.json
for image in "$(cat .tmp/fuma-078-acceptance/supply/runtime.digest)" "$(cat .tmp/fuma-078-acceptance/supply/web.digest)"; do
  cosign verify --certificate-identity-regexp "$IDENTITY" \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com "$image"
done
```

Retain: the protected workflow URL/run ID and conclusion; exact source SHA and root-lock hash; both immutable index digests; raw OCI indexes; amd64 and ARM64 runtime/public-web smoke JSON; published-digest Trivy SARIF; published-image SPDX; BuildKit SLSA provenance; image signature verification JSON; the non-promoting publication plan; paired manifest/checksum/signature bundle; and logs showing every gate succeeded. The ARM64 smoke records must show `linux/arm64`, non-root runtime identities, all runtime roles, migration probe, email renderer `arm64`, and public-web HTTP liveness. Do not close FUMA-078 from repository tests, a partial workflow, mutable tags, prepublication evidence, or a bare manifest verification; closure requires this real retained evidence and reviewer confirmation.

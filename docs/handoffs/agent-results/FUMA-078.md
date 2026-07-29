# FUMA-078 agent result

## Result

Repository-safe FUMA-078 implementation is complete on `orchestrator/24-arm64-delivery-fuma078` from base `55e260c15b345791d9f07f7eef4d56122aa78a73`. The local commit SHA is reported by the orchestrator result because a commit cannot embed its own final SHA.

This result defines policy and deterministic repository verification only. It is **not** protected image-build, publication, signing, scanning, deployment, or promotion evidence.

## Implemented repository policy

- Preserved the root legacy self-host `Dockerfile` byte-for-byte; expected SHA-256 remains `afaec1fe3304c95fa159035c0e9e7c2fc680383658948f9a354a5339f455dd39`.
- Preserved root `bun.lock`; expected SHA-256 remains `e9688c20f69e32aa0df7cea681b5c4971ef5a7d272d3e644bc96486384c4c1b9`.
- Added separate hosted image source `site-runtime.Dockerfile` beside the existing runtime and public-Web sources. All three copy the exact root lock and every workspace manifest before frozen install.
- Kept runtime role commands explicit: `web`, `worker`, `scheduler`, `migration`, and unpublished `email-compatibility` probe.
- Enforced non-root identities: runtime `bun`, public Web `10001:10001`, site runtime `10002:10002`.
- Converted smoke policy to native `linux/arm64` only and added site-runtime boot plus direct-origin-denial evidence. Evidence paths are create-only and cleanup owns only containers created by that invocation.
- Upgraded the immutable manifest to schema v4. It binds one source SHA, exact root-lock hash, hosted migration tail, three pairwise-distinct digest-only image identities, three matching source claims, exactly `linux/arm64`, and per-image OCI index/Trivy/SPDX/SLSA/Cosign/smoke evidence plus the non-promoting publication plan.
- Rejects placeholders, mutable tags, mixed SHA, digest reuse, non-ARM64/extra architecture descriptors, lock/migration/smoke identity mismatch, malformed protected evidence, destructive/promoting plans, retained-evidence tamper, checksum tamper, and canonical-manifest tamper.
- Replaced the workflow policy with native `ubuntu-24.04-arm` jobs that verify `RUNNER_ARCH=ARM64` and `uname -m=aarch64`; no amd64 matrix, QEMU, or emulation policy remains.
- Kept publication behind protected-ref and `fuma-release-supply-chain` environment gates. Repository policy requires blocking scans, published-image SPDX, SLSA provenance, digest signatures, full retained-evidence verification, paired-manifest signature, non-overwrite, non-promotion, and partial-publication orphan behavior.
- Added deterministic `release:demo`, which performs no network or external mutation and proves mixed-SHA, reused-digest, wrong-architecture, and tamper rejection.
- Updated the release template, blocked launch placeholder, phase inventory/requirement wording, and runbook. No migration, shared tracker, or counter file was edited.

## Focused repository evidence

Executed without Docker, buildx, QEMU, emulation, registry access, signing, scanning, deployment, or external mutation:

1. Governance package TypeScript: `tsc --noEmit -p tsconfig.json` — passed using the already-installed package-local dependency tree via a temporary removed symlink; no install or lock change.
2. Focused tests:
   - `tests/integration/supply-chain.integration.test.ts`
   - `tests/integration/paired-release-tooling.integration.test.ts`
   - `tests/architecture/supply-chain.architecture.test.ts`
   - `tests/integration/launch.integration.test.ts`
   - `tests/fault/failure-matrix.fault.test.ts`
   - Result: **22 passed, 0 failed, 164 assertions**.
3. Deterministic demo: passed with `externalEvidence:false`, `architecture:"linux/arm64"`, `imageCount:3`, and all four rejection flags true. Deterministic manifest hash: `8430b74e7370b1c33b04d53cf9d5dd5738ca6a6e0554fac6be840a6ef9d10c50`.
4. Shell syntax: `bash -n` passed for runtime entrypoint and all three smoke scripts.
5. Workflow YAML: parsed successfully with the locally available Python YAML parser.
6. Static forbidden-policy search: no amd64, QEMU, emulation, Kubernetes deploy, or Helm upgrade command remains in the FUMA-078 workflow. Rejection fixtures intentionally contain `linux/amd64` only as invalid input.
7. Safety diff: root `Dockerfile`, `bun.lock`, hosted migrations, and `docs/handoffs/fuma-tracker-closure-audit.md` remain untouched.

The root aggregate suite, root full build, and root full lint were intentionally not run per assignment.

## Protected evidence not produced

The following remains external and was neither executed nor claimed:

- native ARM64 container builds or boots;
- GHCR login, push, immutable digest resolution, or publication;
- real Trivy scans or SPDX generation from published images;
- real BuildKit/SLSA provenance extraction;
- Cosign image or manifest signing/verification;
- protected branch/environment/reviewer configuration verification;
- retained protected workflow artifact or reviewer approval;
- migration execution, deployment, promotion, rollback, DNS/TLS, Kubernetes, or provider mutation.

FUMA-078 protected acceptance and formal tracker closure must remain blocked until an authorized reviewed workflow run retains all real evidence listed in `docs/runbooks/fuma-paired-release.md`.

## Integration notes

- Downstream consumers must accept paired manifest schema v4 and the new `siteRuntimeImage` plus per-image evidence fields. The package launch/fault tests already consume v4.
- The workflow derives `migrationHighWaterMark` from the final registered hosted migration at the exact release SHA; no migration source or registry was changed here.
- FUMA-079 or later remains the only promotion/deployment authority. A source-SHA tag is discovery metadata, not promotion authority; downstream workloads must consume verified digest references.
- Protected GitHub settings and immutable ARM64 base-image variables cannot be proven from repository source and must be reviewed before dispatch.
- The conductor may cherry-pick the reported local commit. No push, amend, reset, clean, shared tracker update, or lock update occurred.

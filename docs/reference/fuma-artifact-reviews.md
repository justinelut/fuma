# Fuma artifact review and marketplace authority

Status: **Closed — FUMA-068 (2026-07-30).** Plugin and component-pack submissions, artifact-specific scans, reviewer decisions, Ed25519 signatures, revocations, customer discovery, explicit-grant installation, public plugin projection, and the bounded unmounted FUMA-071 review contribution now use one production-composed authority over FUMA-067 immutable releases.

## Authority boundary

```text
apps/studio/server/fuma/artifactReviews/
├── contracts.ts             strict TypeBox evidence, diff, scan, signature, decision, revocation and marketplace contracts
├── scanners.ts              canonical plugin-package and SITE-007 component-release scanners
├── signing.ts               Ed25519 signing/verification port and unavailable protected-signing implementation
├── service.ts               submit/diff/scan/decide/verify/revoke/list/install authority
├── postgres.ts              append-only PostgreSQL repository
├── runtime.ts               hosted composition over FUMA-067
├── routes.ts                scoped customer marketplace reads/installs
├── consoleContribution.ts   bounded, unmounted FUMA-071 contribution metadata
└── index.ts                 one bounded export surface
```

A submission binds the exact FUMA-067 artifact ID, kind, package, semantic version, SHA-256 and verified stored bytes. The service computes permission, dependency and schema diffs server-side against only a same-kind, same-package baseline. Review evidence includes provenance, SPDX license, accessibility, runtime compatibility, dependencies, schemas and strict public display metadata.

The plugin scanner reuses the existing plugin package parser, TypeBox manifest validator, safe archive-path checks, entrypoint checks and QuickJS sandbox static scan. It additionally binds manifest ID, exact version and permissions to the immutable release. The component-pack scanner reuses `validateComponentPackRelease()` from FUMA-SITE-007, so FUMA-068 does not create a second component validation or signing authority. Deterministic evidence scanning binds every report and finding to submission, artifact kind and content hash.

Approval requires all reports to be clean, reviewer/submitter separation and an Ed25519 signature over the exact decision/submission/artifact/hash/reviewer/result/reason/time payload. Rejection is unsigned. Verification recomputes scan report hashes and signature payloads before listing or install. Revocation is append-only and immediately removes listing/install eligibility. Protected signing is deliberately unavailable in default hosted composition until an authorized signer is injected; this fails closed and no protected signing or external scanning was performed during implementation.

Private owner/site declarative components remain separate from marketplace distribution. Immediate private use is allowed only for JSON-only `component-declarative` content with exact owner/site scope, no persisted executable JSX, no dynamic tenant Server import and no server/network/payment/provider/secret/worker/schedule authority.

## Customer marketplace

The existing authenticated Fuma scoped API boundary mounts exactly:

```text
GET  /api/fuma/organizations/:organizationId/workspaces/:workspaceId/sites/:siteId/marketplace/artifacts
POST /api/fuma/organizations/:organizationId/workspaces/:workspaceId/sites/:siteId/marketplace/artifacts/:artifactId/install
```

Permissions are `plugins.read` and `plugins.install`. The install route accepts no tenant coordinates. Platform, organization, workspace, site, owner key and owner generation come only from the active authenticated `repositoryScope`; direct staff authority without impersonation is required. Explicit grants must exactly equal the reviewed release permissions, without omissions or escalation, before installation delegates to `ArtifactInstallationAuthority.install()`.

`apps/control-surfaces/app/marketplace` uses an app-local strict TypeBox mirror over same-host HTTP. It lists both reviewed plugins and component packs, discloses signature key, provenance, license, accessibility, runtime compatibility and permissions, and requires every permission checkbox before install. `app/api/fuma/[...path]` is a strict host/path/method-limited proxy to the established private `runtime-web` service. Missing, malformed, unsigned, invalid or revoked review authority leaves installation disabled. There are no app-to-app imports or shared UI packages.

The existing public plugin projection now reads current clean, signed and unrevoked `fuma_artifact_review_*_v2` evidence and review-bound public metadata. It no longer reads the legacy `fuma_plugin_artifacts`/`fuma_plugin_reviews` marketplace tables.

## PostgreSQL migration

Canonical hosted migration:

```text
000071_artifact_review_marketplace
168275b6e4f9861ca4b931bec3e8118c5ac23506219d2f632912a4acff905f41
```

It adds submissions, scan reports, findings, one decision per submission and one revocation per approved decision over `fuma_artifact_releases_v2`. Release kind/package/version/hash, baseline, report and decision bindings are guarded in PostgreSQL. Approved rows require signature coordinates, rejected rows forbid them, submitters cannot review or revoke their own release, and missing/rejected scans cannot be approved. All five evidence tables reject update/delete. The hosted manifest and runnable prefix are **71/71**; the next ID is `000072_release_followup`.

Native PostgreSQL 16 acceptance used a disposable least-privilege role and isolated `fuma_reviews_%` schema, persisted one rejected package with a critical finding plus one clean signed approval, rejected evidence mutation and unsigned approval, verified revocation, and left zero test schemas and zero disposable roles.

## Verification

Focused service acceptance passes **4 tests, 17 assertions** across malformed plugin/SITE-007 packs, mutation, self-approval, unreviewed install, permission escalation, bad signature, fail→fix→approve→sign→install→revoke and private declarative policy. Architecture acceptance passes **6 tests, 35 assertions**. Native PostgreSQL passes **1 test, 13 assertions**. Control marketplace acceptance passes as part of **5 tests, 24 assertions**.

The closing repository aggregate passes **8,244 tests, 32 expected skips, 0 failures and 153,151 assertions**. Full frozen install, lint and production build pass. The root lock remains `e9688c20f69e32aa0df7cea681b5c4971ef5a7d272d3e644bc96486384c4c1b9`; the approved vendor lock is the only second tracked lock. No production migration/deployment, provider mutation, purchase, DNS/TLS change, protected signing/scanning, Docker, QEMU, emulation, commit or push occurred.

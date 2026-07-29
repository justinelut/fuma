# Fuma artifact installations

Status: **Closed — FUMA-067 (2026-07-29); FUMA-068 review consumer closed (2026-07-30).** Immutable plugin/component-pack release storage, exact-version installations, isolated mutable state, quotas, crash containment, and generation-fenced transfer are production-composed. FUMA-068 now owns the single hash-bound review, scanning, signing, publication, installation gate and security-revocation authority documented in [`fuma-artifact-reviews.md`](fuma-artifact-reviews.md).

## Production boundary

```text
apps/studio/server/fuma/artifacts/
├── contracts.ts    strict TypeBox artifact, installation, state, quota, crash, and transfer contracts
├── service.ts      immutable release and generation-fenced installation authority
├── postgres.ts     PostgreSQL repository and atomic mutation fences
├── objectStore.ts  existing tenant object-storage adapter
├── runtime.ts      production composition over the existing plugin worker
└── index.ts        bounded public exports
```

`apps/studio/server/index.ts` creates one hosted artifact runtime. There is no second plugin worker, scheduler, object store, transfer system, component registry, or marketplace authority. The runtime reuses the existing MinIO authority and dispatches plugin schedules through the existing native `runScheduleInWorker` seam.

## Immutable artifacts and exact installations

A release is either `plugin` or `component-pack`, has one exact package/version/content-hash identity, and binds immutable object coordinates, MIME, bytes, permissions, provenance, and artifact metadata. Reusing immutable coordinates with different bytes or metadata fails closed. Exact package bytes may be shared by installations, but installation state is never shared.

Every installation carries platform, organization, workspace, site, owner key, and owner generation plus the exact artifact version. Settings, secrets, schedules, storage usage, call windows, crash evidence, and quotas are generation-qualified child state. Replacement and rollback produce exact-version evidence rather than mutating artifact bytes.

Execution policy is closed:

- plugins may own the existing sandbox worker, schedules, encrypted secrets, call/storage quotas, and contained crash state;
- declarative or restricted-client component packs may be installed and release-pinned but can never acquire backend workers, schedules, secrets, or plugin crash authority;
- private component creation remains distinct from marketplace distribution, and FUMA-067 performs no review, scan, signature, listing, or revocation decision.

## Concurrency, quota, crash, and transfer fences

PostgreSQL mutations preserve these invariants:

- schedule count and insertion serialize under the installation row lock;
- a first call-window write rejects excess units before inserting;
- crash evidence insertion rolls back if the containment update loses its generation fence;
- ownership movement rolls back if the transfer receipt loses its fence;
- transfer advances owner generation and cascades schedule, storage, call, and crash attachment state atomically;
- secret-bearing plugin installations require re-encryption evidence before transfer completes;
- immutable crash occurrence evidence is not rewritten except for its exact generation-advancing ownership attachment.

Persisted JSON is compared recursively in canonical key order because PostgreSQL `jsonb` reorders object keys. Bun SQL string bindings use explicit `::text::jsonb` conversion. These are repository correctness requirements, not incidental implementation details.

## Migration

Canonical hosted migration:

```text
000070_artifact_installation_authority
96c9471345d70bc6cb6636f9f1581859ddc4acb03efe52c3f273da8ed1f2afc8
```

The finalized hosted registry is **70/70 runnable**, with `000070_artifact_installation_authority` as its high-water mark and `000071_release_followup` as the next ID.

Native ticket acceptance applies `000070` against its exact finalized organization/site/owner prerequisites and exercises the production PostgreSQL repository. A separate fresh-prefix attempt exposed a pre-existing collision: historical migrations `000015_publication_workflows` and `000048_publication_scheduling_access` both create `fuma_publication_schedules`. FUMA-067 does not rewrite immutable historical migrations; the full-prefix defect is assigned to migration/deployment hardening, normally FUMA-080.

## Verification

Focused authority, architecture/object-store, and native PostgreSQL tests prove shared immutable bytes with isolated installation state, plugin/component execution separation, quota fences, crash containment, exact rollback, transfer/rekey, metadata-drift rejection, and zero leftover `fuma_artifacts_%` schemas. The closing integrated SITE/FUMA gate passed **114 tests, 391 assertions, 0 failures**. Strict Studio TypeScript, repository lint/build, frozen install, migration checksum audit, and the authoritative aggregate also passed. Full checkpoint totals are recorded in [`../handoffs/fuma-tracker-closure-audit.md`](../handoffs/fuma-tracker-closure-audit.md).

# Fuma durable release publishing

This reference defines FUMA-049: the production `fuma.publish-release` worker that consumes an immutable hosted editor snapshot, renders semantic HTML/CSS, writes release-local content-addressed objects, finalizes the FUMA-048 manifest, and changes the active pointer only at the final atomic boundary.

## Code map

```text
apps/studio/server/fuma/publishing/
├── workerPublisher.ts   — strict TypeBox job/effect contracts and atomic sequence
├── postgresAdapters.ts  — exact immutable snapshot + attempt/progress authority
├── semanticRenderer.ts  — module/template semantic HTML and CSS renderer
├── composition.ts       — PostgreSQL, MinIO, releases, renderer, and handler graph
└── index.ts             — server barrel

apps/studio/server/fuma/publication/workerComposition.ts
apps/studio/server/fuma/db/migrations/000021_publishing.ts
apps/studio/src/__tests__/fuma/commercialEdge.fault.test.ts
apps/studio/src/__tests__/fuma/publishReleaseRegistration.test.ts
apps/studio/src/__tests__/fuma/publishReleasePostgresAcceptance.test.ts
```

FUMA-048 remains the sole release lifecycle, verification, retention-root, and active-pointer authority. FUMA-049 does not update release rows or pointers directly.

## Exact authority and immutable source

The ready queue carries only a job ID. `FumaJobScopeBoundary` derives current site/profile/owner authority from the claimed PostgreSQL job and current owner key; payload fields never derive tenant scope.

The strict publish payload contains only:

- `releaseId`;
- `sourceSnapshotId` (an immutable accepted editor mutation ID);
- `sourceSnapshotHashSha256` (SHA-256 of canonical editor-document JSON);
- `auditCorrelationId`.

`PostgresPublishSnapshotAuthority` repeats platform/organization/workspace/site/owner/generation/profile predicates, requires active non-transferring ownership, loads exactly one immutable accepted mutation, validates `EditorSiteDocumentSchema`, recomputes its canonical hash, and rejects drift.

`PostgresPublishAttemptAuthority` validates the current running FUMA-009 `(jobId, fence)` against `fuma_jobs`. The first execution stores one `fuma_publish_attempts` row. Its deterministic `attemptId` hashes platform, organization, workspace, site, stable owner key, owner generation, profile, release, source ID/hash, job, original build fence, and audit correlation. The row additionally stores the release/source/owner/site/job/fence coordinates explicitly. Reuse is accepted only when all coordinates and the deterministic identity match.

A reclaimed FUMA-009 attempt has a newer execution fence. The adapter verifies that current fence against the running job, then returns the original persisted build claim. Thus FUMA-048 keeps one immutable `(jobId, originalFence)` release claim while the durable job safely retries under a newer fenced execution. Stale or substituted fences fail closed.

## Render, write, finalize, activate

The worker sequence is:

1. validate the strict TypeBox payload and trusted execution claim;
2. idempotently queue the exact release and claim the exact durable attempt;
3. claim and hash-check the immutable source snapshot;
4. semantically compose templates and modules through Instatic's publisher;
5. emit deterministic HTML and external CSS artifacts;
6. derive every object key with `releaseObjectKey(releaseId, sha256(bytes))`;
7. create-only PUT each artifact under `publish/releases/<release>/objects/<hash>`;
8. on retry, accept an existing object only after exact hash, byte-count, and MIME verification;
9. create and finalize the exact manifest through `ReleaseService.finalize`;
10. persist and re-read a strict durable manifest effect;
11. revalidate cancellation and inject the last pre-activation fault boundary;
12. call `ReleaseService.activate`, which re-verifies every byte and atomically swaps the pointer/root transaction;
13. persist and re-read a strict durable activation effect.

There is no mutable staging namespace and no overwrite. The release-local immutable objects are staging until the PostgreSQL active pointer changes.

## Recovery and untrusted results

Two FUMA-009 effects are durable and idempotent per job:

- `fuma.publish-release:manifest:v1` binds release, source ID/hash, owner, site, generation, original job/fence, and the complete validated manifest;
- `fuma.publish-release:activation:v1` binds the same authority, manifest hash, and resulting pointer version.

Every read and every race-returned effect is treated as untrusted input: it passes strict TypeBox validation, complete manifest hash/reference/key revalidation, and exact-coordinate comparison before use.

Crash recovery covers both critical intervals:

- **finalized before manifest effect:** a retry observes the FUMA-048 ready release under the same original build claim, revalidates its exact manifest and all objects, then records the missing effect;
- **activated before activation effect:** a retry replays `ReleaseService.activate`; the already-active exact release returns the existing pointer without increasing its version, then records the missing effect.

All injected failures before activation leave the old pointer unchanged. Cancellation is checked during rendering/upload and immediately before activation.

## Production composition

The production worker composition merges `publishWorkerRegistration(...)` into the trusted FUMA-009 scoped handler map alongside Publication handlers. It does not register FUMA-050 free-host or FUMA-051 edge handlers.

Production requires `FUMA_OBJECT_ACCESS_SIGNING_SECRET` with at least 32 bytes. It is independent from MinIO credentials and is never placed in a job payload. `.env.fuma.example` documents the variable. MinIO remains create-only immutable storage; PostgreSQL remains the attempt/effect/release authority.

## Focused acceptance

```sh
bun test src/__tests__/fuma/commercialEdge.fault.test.ts \
  src/__tests__/fuma/publishReleaseRegistration.test.ts

FUMA_TEST_POSTGRES_URL=postgres://... \
  bun test src/__tests__/fuma/publishReleasePostgresAcceptance.test.ts

bunx eslint server/fuma/publishing \
  server/fuma/publication/workerComposition.ts \
  src/__tests__/fuma/commercialEdge.fault.test.ts \
  src/__tests__/fuma/publishReleaseRegistration.test.ts \
  src/__tests__/fuma/publishReleasePostgresAcceptance.test.ts --no-cache
```

The PostgreSQL gate creates and drops one isolated schema, applies the unchanged FUMA-009, FUMA-012, FUMA-048, and `000021_publishing` SQL bodies, uses production snapshot/attempt/release adapters, activates an old release, faults before new activation, proves the old pointer remains, advances the real durable-job execution fence, retries, proves one pointer switch, and proves a further replay does not increment the pointer.

## Forbidden patterns

- Deriving owner/site/profile/generation from publish payload fields.
- Reusing a release or effect under another source, owner generation, job, or original build fence.
- Trusting durable JSON because it came from the effects table.
- Overwriting existing release objects or accepting only HEAD metadata without exact integrity checks.
- Finalizing from renderer output without FUMA-048 complete inventory/reference verification.
- Activating before the manifest durable effect exists.
- Updating the active pointer outside `ReleaseService.activate`.
- Importing worker, renderer, or object-writer ownership into FUMA-048.
- Mounting FUMA-050/FUMA-051 routing or cache ownership in publishing composition.

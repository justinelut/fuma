# Fuma Immutable Releases

This reference defines the FUMA-048 immutable release manifest, lifecycle, repository, active-pointer, and retention-root boundary.

A hosted release is a checksummed manifest over immutable FUMA-008 objects. The lifecycle validates every declared object and reference before a release becomes ready, then changes one exact-site active pointer transactionally without invoking the renderer or worker publisher.

---

## TL;DR

- Source of truth: `apps/studio/server/fuma/releases/`.
- Hosted schema: additive PostgreSQL migration `apps/studio/server/fuma/db/migrations/000011_releases.ts`.
- States are `queued → building → ready → active`; `queued` or `building` may become `failed`, and replacing the active pointer demotes the previous active release to `ready`.
- Objects use `publish/releases/<releaseId>/objects/<sha256>` under the exact FUMA-008 site namespace. The same bytes in different releases have different immutable identities.
- Finalization requires an exact object inventory plus matching metadata, bytes, SHA-256, MIME, byte count, and complete in-manifest references.
- Every repository transaction revalidates current platform/organization/workspace/site ancestry, stable owner key, generation, active state, and null transfer fields.
- Activation updates release states, one exact-site pointer, and the reserved `active` retention root in one PostgreSQL transaction.
- Active or manually retained releases cannot be deleted. Object garbage collection is not part of this boundary.
- FUMA-048 does not render, write release objects, enqueue publishing jobs, mount public routing, or activate renderer output. Those integrations are outside `apps/studio/server/fuma/releases/service.ts`.

## Code map

```text
apps/studio/server/fuma/releases/
├── composition.ts  — production PostgreSQL repository + immutable object authority graph
├── contracts.ts    — strict TypeBox schemas and lifecycle-shape validation
├── keyPolicy.ts    — content-addressed release object/manifest logical keys
├── manifest.ts     — canonical ordering, hashes, references, semantic validation
├── repository.ts   — exact-scope PostgreSQL transactions, pointer and root storage
├── service.ts      — lifecycle transitions, object verification, activation, retention
└── index.ts        — public server barrel

apps/studio/server/fuma/db/migrations/000011_releases.ts
apps/studio/src/__tests__/helpers/fuma/releaseFixture.ts
apps/studio/src/__tests__/fuma/releaseManifest.test.ts
apps/studio/src/__tests__/fuma/releaseRepository.test.ts
apps/studio/src/__tests__/fuma/releaseService.test.ts
apps/studio/src/__tests__/fuma/releaseMigration.test.ts
apps/studio/src/__tests__/architecture/fuma-release-boundaries.test.ts
```

## Lifecycle

| Current | Allowed next | Required evidence |
|---|---|---|
| `queued` | `building` | One durable build claim containing FUMA-009 job ID and positive fence. |
| `queued` | `failed` | Structured failure; claim must remain null. |
| `building` | `ready` | Same job/fence claim, immutable manifest, exact object/reference verification. |
| `building` | `failed` | Same job/fence claim and structured failure. |
| `ready` | `active` | Re-verification immediately before the atomic active-pointer transaction. |
| `active` | `ready` | Internal part of switching the pointer to another verified release. |
| `failed` | none | Terminal record; retry creates a new release identity. |

`ReleaseRecordSchema` in `contracts.ts` rejects additional properties and validates that claim, manifest, failure, and timestamps match the state. `fuma_releases_state_shape` mirrors the lifecycle in PostgreSQL. The `fuma_releases_enforce_immutability` trigger rejects illegal state changes, identity mutation, manifest replacement, non-monotonic versions, and deletion of an active release.

The service accepts no organization/workspace/site/owner authority in command bodies. It receives one `FumaRepositoryScope` out of band and binds commands containing only release-domain fields.

## Manifest and object identities

`createReleaseManifest(...)` canonicalizes artifacts by absolute logical path and references lexicographically. Every artifact contains:

```ts
type ReleaseArtifact = Readonly<{
  logicalPath: string
  kind: 'html' | 'css' | 'javascript' | 'asset'
  objectKey: string
  contentHashSha256: string
  sizeBytes: number
  mimeType: string
  references: readonly string[]
}>
```

The key is derived, never accepted as caller authority:

```ts
releaseObjectKey(releaseId, contentHashSha256)
// publish/releases/<releaseId>/objects/<contentHashSha256>
```

`artifactsHashSha256` covers every canonical artifact descriptor. `manifestHashSha256` covers the release ID, stable owner key, site ID, source snapshot hash, artifact list, aggregate counts, and timestamp. `assertReleaseManifest(...)` recomputes both hashes and rejects reordered/duplicate paths, noncanonical keys, count/byte drift, and references to absent logical paths.

The manifest binds stable `ownerKey` and `siteId`, not mutable organization/workspace ancestry or owner generation. FUMA-024 moves the stable owner key and increments generation during transfer; persisted release rows follow ancestry through the qualified owner foreign key's `ON UPDATE CASCADE`. Every operation still requires the new current generation, so stale pre-transfer callers are denied while the same immutable release remains attached to the site.

## Complete verification

`ReleaseService.finalize(...)` performs verification outside the database lock, then reopens a transaction and compares the release version and build claim before committing `ready`. `ReleaseService.activate(...)` re-verifies immediately before activation.

Verification is fail-closed:

1. Revalidate the manifest contract, hashes, canonical object identities, aggregates, and references.
2. List `publish/releases/<releaseId>/objects` through `TenantObjectStorage.list`.
3. Compare the sorted listed key set with the complete unique manifest key set. Missing and undeclared objects both fail.
4. For every object, read `head` and `get` through FUMA-008.
5. Compare logical key, MIME, byte count, metadata SHA-256, actual byte count, and actual byte SHA-256.
6. Re-read the release under exact scope and require the original version/job fence before writing `ready`.

The service never calls `put`, multipart upload, or object deletion. FUMA-008 remains the immutable byte authority; the publishing writer is deliberately absent from this lifecycle boundary.

## Exact authority and concurrency

`PostgresReleaseRepository.forScope(scope)` binds one active scope. Every transaction:

1. takes an owner-key-qualified PostgreSQL advisory transaction lock;
2. queries `fuma_tenant_owner_keys` with platform, owner key, organization, workspace, site, generation, active state, and null transfer ID/lock/fence;
3. denies if exactly one current authority row is not present; and
4. exposes a transaction API whose methods accept release/root IDs but no replacement tenant coordinates.

Every release, pointer, and retention query repeats platform, owner key, organization, workspace, and site predicates. Release updates and deletion also compare the expected monotonic version. The advisory lock serializes first activation where no pointer row exists as well as later pointer swaps.

Finalization intentionally does not hold a database transaction while fetching object bytes. Competing finalizers may verify concurrently, but only one can commit the expected release version. The other receives `concurrent-update`; it cannot replace the manifest.

## Active pointer and retention roots

`fuma_release_active_pointers` has one row per stable owner key and an additional unique exact-site coordinate. Its release foreign key contains platform, owner, organization, workspace, site, and release ID.

Activation transaction steps are:

```text
lock current owner authority
  → lock target release + active pointer
  → demote previous active release to ready
  → remove reserved previous active root
  → promote verified target to active
  → insert/update pointer with version + 1
  → insert reserved active root for target
  → commit all or roll back all
```

`fuma_release_retention_roots` supports:

- `active` — reserved root maintained only by activation;
- `manual` — named rollback/retention window created for a ready or active release.

Foreign keys use `ON DELETE RESTRICT`. The service additionally rejects active deletion, queued/building deletion, and deletion while any root exists. Removing the reserved `active` root through the manual API is forbidden.

## Self-host and migration boundary

`000011_releases` belongs only to the hosted PostgreSQL stream. It creates new `fuma_*` tables, indexes, function, and trigger. It does not alter `apps/studio/server/db/migrations-pg.ts`, historical rows, or the self-host publisher in `apps/studio/server/publish/`.

The finalized checksum is recorded in `apps/studio/server/fuma/db/migrations/index.ts`. Any schema change uses a new additive hosted migration.

## Focused acceptance

```sh
bun test apps/studio/src/__tests__/fuma/releaseManifest.test.ts \
  apps/studio/src/__tests__/fuma/releaseRepository.test.ts \
  apps/studio/src/__tests__/fuma/releasePostgresAcceptance.test.ts \
  apps/studio/src/__tests__/fuma/releaseService.test.ts \
  apps/studio/src/__tests__/fuma/releaseMigration.test.ts \
  apps/studio/src/__tests__/architecture/fuma-release-boundaries.test.ts
```

`releasePostgresAcceptance.test.ts` is an opt-in production-repository gate. With
`FUMA_TEST_POSTGRES_URL` set to a dedicated test database, it creates and drops
one isolated schema, applies the unchanged `000011_releases` body there, runs the
production composition through queue/build/finalize/activate replay, and proves
that PostgreSQL rejects manifest mutation while stale generation and foreign-site
activation fail closed. It never runs against `DATABASE_URL` implicitly.

The deterministic demo fixture validates a complete release, corrupts an immutable object behind its metadata, rejects re-verification, and denies activation through a foreign site's bound repository.

## Forbidden patterns

- Accepting tenant coordinates, owner keys, generation, or transfer fences from release command payloads.
- Looking up a release by bare release ID or site ID.
- Writing an object key that is not `releaseObjectKey(releaseId, contentHash)`.
- Marking a release ready from object HEAD checks without byte/hash and exact inventory verification.
- Reusing a release ID with another source snapshot or replacing a finalized manifest.
- Activating without re-verification or updating the pointer outside the release transaction.
- Removing the active root directly, deleting active/retained releases, or deleting release objects from the lifecycle service.
- Importing the semantic renderer, self-host publisher, or FUMA-009 worker service into `apps/studio/server/fuma/releases/service.ts`.
- Rewriting historical migrations or adding a non-PostgreSQL mirror for hosted releases.

## Related

- `docs/reference/fuma-publish-release.md` — durable snapshot claim, semantic rendering, immutable writes, recovery, and atomic activation.
- `docs/reference/fuma-object-storage.md` — immutable tenant object bytes and integrity metadata.
- `docs/reference/fuma-durable-jobs.md` — durable job IDs, claims, and fences referenced by build claims.
- `docs/reference/fuma-tenant-keys.md` — stable owner keys, generation, transfer, and publish-release object ownership.
- `docs/reference/fuma-repository-scoping.md` — exact hosted scope derivation and lower-layer authority rules.
- `docs/reference/fuma-hosted-migrations-transition.md` — additive PostgreSQL migration and checksum policy.
- `docs/features/publisher.md` — existing semantic renderer and self-host publishing pipeline.
- Source-of-truth files: `apps/studio/server/fuma/releases/`, `apps/studio/server/fuma/db/migrations/000011_releases.ts`.
- Gate test: `apps/studio/src/__tests__/architecture/fuma-release-boundaries.test.ts`.

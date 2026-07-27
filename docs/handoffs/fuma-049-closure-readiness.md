# FUMA-049 closure readiness handoff

Status: implementation and ticket-owned acceptance are closure-ready. This handoff does not edit the central tracker and does not claim FUMA-050/FUMA-051 work.

## Completed acceptance

- Production `fuma.publish-release` is registered through the existing trusted FUMA-009 scoped worker map in `server/fuma/publication/workerComposition.ts`.
- `PostgresPublishSnapshotAuthority` claims one accepted editor mutation under exact platform/organization/workspace/site/owner/generation/profile authority and recomputes its canonical SHA-256.
- `PostgresPublishAttemptAuthority` persists one release/source/owner/site/job/original-fence/audit claim, validates each current running FUMA-009 fence, and returns only the original immutable FUMA-048 build claim on retry.
- `CoreSemanticReleaseRenderer` composes modules/templates and emits deterministic HTML plus external CSS.
- All bytes use release-local `releaseObjectKey(releaseId, sha256)` identities and create-only FUMA-008 writes. Existing retry objects require exact hash/size/MIME equality.
- Finalization goes only through FUMA-048, durable manifest evidence precedes activation, and activation remains the last boundary through FUMA-048's atomic pointer/root transaction.
- Strict TypeBox durable manifest and activation effects reject malformed or coordinate-substituted stored JSON.
- Recovery covers process loss after finalization and after activation. All pre-activation injected faults retain the old pointer.
- `000021_publishing` and FUMA-048 migration/service code were not rewritten.
- No FUMA-050 free-host or FUMA-051 edge ownership was added.

## Executed evidence

Focused deterministic and registration suite:

```text
14 pass, 0 fail, 33 expectations
```

Disposable PostgreSQL 16 production-adapter acceptance:

```text
1 pass, 0 fail, 7 expectations
[FUMA-049 PostgreSQL demo] fault served release-old; retry switched once to release-new; replay pointer stable
```

The live gate applied unchanged FUMA-009, FUMA-012, FUMA-048, and `000021_publishing` SQL into an isolated schema; exercised production PostgreSQL snapshot/attempt/release adapters; advanced the real running job fence from 9 to 10; and dropped the schema afterward.

Focused lint:

```text
server/fuma/publishing
server/fuma/publication/workerComposition.ts
commercialEdge.fault.test.ts
publishReleaseRegistration.test.ts
publishReleasePostgresAcceptance.test.ts
0 errors
```

Studio node typecheck:

```text
FUMA-049-owned TypeScript diagnostics: 0
Pre-existing diagnostics total: 0
```

Related focused release/commercial suite produced 74 passes. One included FUMA-048 migration test failed because concurrent FUMA-033 work registered `000040_publication_universal_content` while that test still hard-codes `000040_release_followup`; FUMA-049 did not edit that migration or test. FUMA-048 service, repository, manifest, live PostgreSQL, release architecture, commercial migration checksum, and commercial architecture gates all passed.

## Operational configuration

Production workers require an independent `FUMA_OBJECT_ACCESS_SIGNING_SECRET` of at least 32 bytes in addition to MinIO credentials. `.env.fuma.example` and `docs/reference/fuma-configuration.md` document it. No credentials or production resources were changed.

## Remaining outside this ticket

- FUMA-050 free-host public serving composition.
- FUMA-051 cache, purge, warm, rollback, and dynamic-hole ownership.
- Tracker closure by the primary integrator.
- Root aggregate test/build/lint, intentionally not run by this ticket owner.

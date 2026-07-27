# Publication scheduling and public access

FUMA-036 adds a durable, exact-scope authority for scheduled publish/unpublish and preview-token use. It composes the FUMA-034 lifecycle/metadata authority, FUMA-035 approval-ready scheduled content, FUMA-039 member evaluator, and FUMA-009 trusted durable jobs. It does not create a second content authority: `data_rows` and `fuma_publication_metadata_authority` remain authoritative for lifecycle and visibility.

## Time and schedule model

A schedule stores an absolute RFC 3339 instant in PostgreSQL `timestamptz` plus an IANA timezone used only for human display. `formatPublicationSchedule` formats the same instant with an explicit UTC offset, including both sides of a DST fallback. Local wall-clock strings are never due-claim authority.

`fuma_publication_schedules` is qualified by platform, organization, workspace, site, stable owner key, owner generation, and profile. Publish schedules must reference a content version already in `scheduled` state whose `scheduledAt` exactly matches `dueAt`. Unpublish schedules must reference a currently published version. Active `(content, action)` schedules are unique.

Claims are PostgreSQL compare-and-swap updates over `due_at <= trusted_now`. A pending row or an expired claim advances `claim_fence`; completion requires the same worker and fence. The content transition remains versioned and idempotent. A target already reached at exactly `expectedWorkflowVersion + 1` completes the schedule; a later or incompatible revision supersedes it rather than mutating newer content.

The durable payload is only `{ scheduleId }`. The worker boundary derives site, current active owner generation, trusted profile, and job actor from FUMA-009 job authority. Durable effect key `publication-schedule:<scheduleId>` prevents duplicate external acknowledgement. The job idempotency key includes the complete trusted scope and schedule ID.

## Restart and late-worker recovery

Creating a schedule commits its PostgreSQL authority before enqueueing its durable job. A transient job enqueue failure does not discard the accepted schedule. On startup or reconciliation, call `PublicationSchedulingService.recover(scope)` for every trusted active Publication scope. It finds due pending schedules and expired claims, then idempotently enqueues them. Durable worker reconciliation separately recovers expired job claims. Late workers use the actual trusted current instant and apply a still-current schedule once.

Recommended deterministic shutdown/startup order:

1. Drain public/admin request acceptance.
2. Drain durable workers and scheduler through the existing runtime lifecycle.
3. Stop processes only after drain handles settle.
4. On startup, rebuild the durable ready queue, enumerate trusted active Publication scopes, and call `recover` before declaring schedule recovery ready.

## Preview tokens

Preview issuance returns `tokenId.secret` once. PostgreSQL stores only SHA-256 of the complete token, never plaintext or the random secret. Token use locks the exact-scope row, compares the digest in constant time, rejects expired or revoked rows, and atomically records `last_used_at`/`use_count`. Revocation is monotonic. Tokens are content-bound, expire within 30 days, and cannot cross site, owner generation, or profile.

A valid token selects preview mode; it does not invent audience membership. Preview output remains safe semantic title/excerpt HTML with `noindex,nofollow`. Arbitrary document HTML is never interpolated.

## Public access boundary

The public body contains only `contentId`, `requestedPath`, and optional `previewToken`. It cannot choose tenancy, owner generation, profile, member identity, canonical origin, or evaluation time. `PublicationPublicAccessAdapter` requires central composition to supply:

- a server-derived `PublicationRepositoryScope`;
- the member identity resolved from the isolated member session, or `null`;
- the configured credential-free HTTPS public origin.

`PublicationSchedulingService.resolve` delegates the resulting trusted evaluation to `PublicationMemberAccessService.evaluate`. FUMA-034 visibility remains exact: `public`, `member`, `paid`, or required segment IDs. Anonymous or ineligible requests receive the existing redacted restricted decision (`Restricted content`, empty description, null HTML); private title, excerpt, social data, and document content do not leak.

## Candidate migration and central integration

Candidate migration `000048_publication_scheduling_access` is intentionally not registered or checksum-finalized by this ticket. The primary integrator must:

1. Import and append `publicationSchedulingAccessMigration` in `server/fuma/db/migrations/index.ts`, calculate its checksum with `hostedMigrationChecksum`, and update the shared finalized registry/sentinel.
2. In `createFumaPublicationServiceGraph`, construct `PostgresPublicationSchedulingRepository` and `PublicationSchedulingService` with the existing domain store, editorial service, member-access service, durable job service, and trusted clock.
3. Append `createPublicationSchedulingScopedRoutes(scheduling)` to the central scoped route declarations.
4. Merge `createPublicationSchedulingJobHandlers(scheduling)` into the trusted worker handler map.
5. Mount `PublicationPublicAccessAdapter` only behind the central public projection/member-session boundary; derive scope, identity, and origin server-side.
6. Invoke bounded `scheduling.recover(scope)` during trusted startup reconciliation for active Publication scopes.

No `PublicationWorkspace` change is required: schedule creation can follow the existing approved → scheduled workflow, while preview/public resolution belongs at server boundaries. A future Studio surface may call the additive scoped routes and must use a local CSS Module and accessible labelled controls.

## Verification

Focused fake-clock tests cover DST fallback offsets, non-DST display, duplicate claims, late publish/unpublish, stale supersession, restart recovery, enqueue idempotency, digest-only storage, use/revoke/expiry, wrong-scope denial, private metadata leak prevention, FUMA-039 segment changes, and a deterministic public/member/segment serve-once transcript. Separate gates cover TypeBox-only contracts, authority-free public/job payloads, exact PostgreSQL query predicates, claim fences, additive migration policy, trusted job binding, and central-ready adapters.

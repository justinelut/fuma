# Fuma Publication authoring and delivery phase

FUMA-028 through FUMA-047 turn the Publication preset into a scoped editorial and email product. FUMA-028 and FUMA-032 remain the sequenced-draft and shell foundations. FUMA-041 and FUMA-042 remain the pinned React Email compatibility and data-only rendering foundations. This phase composes those boundaries rather than replacing them.

## Ticket boundaries

| Ticket | Production boundary |
|---|---|
| FUMA-028 | Existing profile-qualified monotonic draft CAS and replay receipts. |
| FUMA-029 | Redis-backed advisory presence. Redis loss means “nobody visible,” never edit authority. |
| FUMA-030 | Durable ordered operation reconciliation with explicit `rebase-required`; operations are atomic and prototype-safe. |
| FUMA-031 | Immutable revisions/checkpoints; restore creates a new revision and never edits history. |
| FUMA-032 | Existing Publication shell, ordered navigation, collapsed Editor/Design, and permission-first child mounting. |
| FUMA-033 | Universal-store post/page rows, visual document data, stable imports, scoped Publication identity/settings, current staff-author relations, tag rows/relations, qualified slugs, and featured-media references. |
| FUMA-034 | Lifecycle, canonical/SEO/social metadata, redirects, and content access decisions. |
| FUMA-035 | Versioned editorial transitions and durable scheduled publish jobs. |
| FUMA-036 | Scheduled publish/unpublish, preview tokens, and public/member/paid/segment access resolution. |
| FUMA-037 | Dynamic Publication templates, loops, and canonical archives. |
| FUMA-038 | Separate member identity/session/consent realm and import boundary. |
| FUMA-039 | Publication member accounts, consent, segments, grants, access states, export, and deletion. |
| FUMA-040 | Privacy-aware minimized Publication analytics, retention, and summaries. |
| FUMA-041 | Existing exact React Email/Bun/platform compatibility decision. |
| FUMA-042 | Existing allowlisted deterministic EmailDocument renderer. |
| FUMA-043 | Field-level platform → organization → workspace → site → newsletter email settings inheritance with provenance. |
| FUMA-044 | Newsletter profiles, audience composition, CAS drafts, and immutable composer versions. |
| FUMA-045 | Server-owned audience preview fixtures, OCI test send, immutable version comparison, and rate limits. |
| FUMA-046 | Immutable audience/render/settings campaign snapshots, hashes/size, scheduling/cancellation, progress, and per-recipient idempotent OCI submission. |
| FUMA-047 | Suppression, one-click unsubscribe, replay-safe provider events, domain health, and privacy-aware engagement/deliverability. |

## Authority and storage

Every durable repository call binds platform, stable owner key, owner generation, assigned profile, and the complete organization/workspace/site ancestry. PostgreSQL owner authority is reloaded inside each transaction and must still be active, transfer-free, and generation-equal. Route bodies contain no tenant, profile, actor, role, or session authority. The scoped request context supplies all of it.

Migrations `000013`–`000020` retain their finalized SHA-256 values unchanged. Additive FUMA-033 migration `000040_publication_universal_content` and FUMA-031 migration `000041_publication_revisions` are appended and checksum-finalized in both `server/fuma/publication/migrations.ts` and the canonical hosted migration stream in `server/fuma/db/migrations/index.ts`. Migration `000041` is finalized at SHA-256 `7ea67a5fd66af9c8be2515a1b303baf2831363fe9b1a23437d97c47cb47966cc`; later concurrently-added registry entries remain untouched.

## FUMA-033 universal Publication content

Publication posts, pages, tags, visual documents, and Publication identity/settings use the existing `data_tables`/`data_rows` universal store. `PostgresPublicationUniversalStore` creates deterministic owner-key/profile-qualified physical table and row IDs while preserving the contract's logical `contentId`, `tagId`, and `publicationId` across import and ownership-generation changes. `fuma_tenant_resource_owners` supplies the current site-owner relation for each physical universal row. The finalized additive migration `000040_publication_universal_content` adds only normalized `data_row_relations`; immutable migrations `000001`–`000039` and rollback-era `fuma_publication_content`/`fuma_publication_tags` remain untouched and are no longer FUMA-033 read/write authority.

Every transaction reloads exact platform/organization/workspace/site ancestry, stable owner key, current generation, active transfer-free state, and assigned profile. Universal-row queries also require the current owner sidecar and trusted `publicationProfileId`. Author relations target current non-banned organization staff not denied at the active workspace. Tag relations target current scoped tag rows; one normalized relation may be primary. Featured media must have a current scoped `media.asset` owner mapping. Route bodies cannot choose any of this authority.

The scoped API provides list/get/save/delete/import content, current authors, tag list/save, and nullable Publication identity/settings get/save. Imports use strict TypeBox contracts, preserve logical IDs and visual documents, reject duplicate IDs, and apply atomically under optimistic versions. Exact mutation permissions are `publication.posts.write`, `publication.tags.write`, and `site.settings.write`; matching reads use their exact read permissions.

Studio loads content, current authors, tags, and templates as one collection with visible loading, failure, and empty states. Editorial controls author co-relations, tag relations and primary tag, structured visual-document JSON, optimistic save/delete, and checkpoints. The Tags surface authors tags directly, and Settings handles both a fresh Publication identity empty state and monotonic identity updates. All styling remains in `PublicationWorkspace.module.css`.

## FUMA-034 lifecycle, metadata, and presentation authority

Publication content now carries the complete lifecycle and delivery metadata contract. The core lifecycle states are `draft`, `scheduled`, `published`, `unpublished`, and `archived`; the later editorial `in-review` and `approved` states remain available for FUMA-035 composition. Every transition is compare-and-swap versioned. Scheduling requires a future timestamp, non-scheduled transitions cannot smuggle one, publishing records the publication time, and stale or closed edges fail without changing the universal row.

Strict TypeBox metadata covers SEO title/description, HTTPS canonical URL, Open Graph, social card fields, direct one-hop 301/308 redirects, featured media, and the closed visibility union `public | member | paid | segment`. Collection-wide validation rejects duplicate content paths, duplicate canonical URLs, canonical/redirect collisions, duplicate redirect sources, self redirects, and redirect chains. Public/member/paid/segment access decisions are data-only and deterministic.

Universal `data_rows` remain the content authority. Additive migration `000044_publication_lifecycle_metadata` adds an exact platform/organization/workspace/site/owner-generation/profile-qualified metadata index, direct redirect registry, immutable lifecycle transition ledger, and immutable metadata/lifecycle revision snapshots. The universal-row write, normalized index, redirects, and revision append happen in one PostgreSQL transaction under a scope advisory lock after current active, transfer-free owner generation and assigned profile are reloaded. Migrations `000001`–`000043` are unchanged; concurrently registered later entries remain in place.

The scoped Studio API exposes a read-authorized presentation decision endpoint. Its request contains only mode, HTTPS origin, requested path, and semantic audience facts; scope, profile, actor, and session authority still come from the request context. Public decisions return render, direct redirect, denied, or unavailable semantics with canonical/robots/SEO/social data. Preview decisions always use `noindex,nofollow`, report whether the selected audience would be denied, and render only escaped title/excerpt semantic HTML. Arbitrary visual-document HTML is never interpolated. Studio exposes labelled CSS-Module panels for metadata, lifecycle, audience inspection, and a keyboard-focusable sandboxed preview.

## Collaboration

### Advisory site-room presence (FUMA-029)

Hosted Studio upgrades `/api/fuma/organizations/:organizationId/workspaces/:workspaceId/sites/:siteId/publication/presence/socket/:resourceKind/:resourceId` only after the shared Fuma scoped boundary authenticates the same-origin staff session, resolves `publication.posts.read`, reloads exact site membership, and derives the current stable owner key/generation. The client cannot submit profile, owner, generation, actor, role, or permission authority. Every 10-second update re-runs that authority resolution; a site, profile, membership, transfer fence, or owner-generation change closes the socket.

Room identity includes platform, organization, workspace, site, stable owner key, owner generation, trusted profile, resource kind, and resource ID. Each browser tab receives a stable random tab ID for its mount; the server hashes that with the authenticated session ID, so reconnects preserve a tab identity while parallel tabs remain distinct. TypeBox bounds update/snapshot shapes, Bun caps inbound frames at 4 KiB and outbound backpressure at 64 KiB, and Redis applies 30 updates per 10 seconds per scoped tab.

Heartbeats live for 30 seconds in Redis. Clean leave removes the member immediately; crashes disappear at TTL; Redis pub/sub invalidates every process-local room for fan-out. Redis presence/list/pub-sub failures remain fail-open as absence, while the rate limiter fails closed. Presence contains no write decision and is never consulted by draft save, collaboration reconciliation, workflow, or any other durable mutation authority. Redis loss therefore means “nobody visible,” not “allowed to edit.”

Presence payloads are bounded, short-lived Redis values keyed by owner generation, profile, kind, and resource. Collaboration operations use one durable head and an immutable operation ledger. A stale sequence receives the authoritative document and operations since its base. A matching batch either commits every operation and increments the head once or rolls back entirely. `__proto__`, `prototype`, and `constructor` paths are rejected.

FUMA-030 now carries accepted acknowledgements and same-stream fan-out over a separate write-reauthorized collaboration socket. Reconnect sends the last authoritative sequence, receives the document plus ordered ledger suffix, and replays pending mutation IDs unchanged. Seeded randomized add/move/rename/style tests, concurrent stale/retry cases, transport duplicate/out-of-order/reconnect tests, and a final-tree ledger replay comparison are executed. See [Publication collaboration reconciliation](fuma-publication-collaboration.md).

## Immutable revisions, checkpoints, retention, and restore

FUMA-031 adds a separate `PostgresPublicationRevisionRepository` over the collaboration head; universal Publication content and FUMA-030 collaboration remain the only content/edit authorities. Every repository transaction reloads the active transfer-free owner key at the expected generation and joins the site's current assigned profile. Route and job payloads cannot choose platform, ancestry, owner, generation, profile, actor, role, or session authority.

Revision documents are canonical JSON stored as immutable, SHA-256-addressed `application/json` objects below the exact FUMA-008 tenant prefix and owner-generation/profile path. Append-only revision entries contain parent/head sequence, actor, reason, optional checkpoint name, checksum, size, retention timestamp, and immutable audit events. Named checkpoints, publish revisions, and restore revisions retain their snapshot references; periodic revisions have bounded retention. Expiry removes only a non-head periodic snapshot reference and preserves immutable revision/audit metadata. GC first claims inventory rows only when no snapshot reference exists, marks them `deleting` under lock, deletes the object, and then removes inventory; a referenced or newly claimed snapshot cannot be collected.

The `publication.revision-periodic`, `publication.revision-retention`, and `publication.revision-gc` durable handlers derive current site/profile/actor authority from the trusted job context. Periodic capture reads the current collaborative document inside the repository rather than accepting document or tenant authority in the payload. Structural comparison reports deterministic JSON-pointer additions, removals, and changes. Restore requires the expected revision head and an available source reference, locks the collaborative and revision heads, updates the durable collaborative document with compare-and-swap, and appends a new protected `restore` revision whose parent is the former head. It never rewrites the source or intermediate history.

Studio exposes named checkpoint creation, retained/expired history, labelled from/to comparison controls, a keyboard-focusable diff region, and an explicit two-step “Review restore” → “Restore as new head” flow. It uses the existing `Button` primitive and `PublicationWorkspace.module.css`; no native browser confirmation or new styling system is introduced.

## Editorial and audience

Workflow edges are closed: draft → review/archive, review → draft/approved, approved → draft/scheduled/published, scheduled → approved/published, published → archived, archived → draft. Scheduling requires a timestamp and emits `publication.publish-due` with an owner-generation-qualified idempotency key.

Reader members and reader accounts are separate records. A member may have no account. Segment rules are a closed TypeBox union and campaign audiences exclude blocked/unsubscribed members before snapshotting. Access grants are resource-specific and time-bounded.

## Email and campaigns

Email settings override individual fields, retaining scope/version provenance. Required sender, reply-to, physical-address, brand, and footer values must all resolve before preview or send.

A newsletter version embeds the FUMA-042 `EmailDocument`; tenant JSX, JavaScript, raw HTML, and arbitrary components remain impossible. Versions are append-only by `(newsletter, ordinal)`. Test-send and launch campaigns accept only an adapter whose literal kind is `oci-email-delivery`.

Campaign creation freezes sorted member IDs, rendered HTML/plaintext, subject, and resolved sender settings into one SHA-256-addressed snapshot. Later member, segment, composer, or settings edits cannot change it. Submission checks suppression immediately before OCI and enforces the configured approved sender. OCI requests use Signature v1 over request-target, host, date, body digest, content type, and content length. Provider events are append-only by provider event ID; bounce and complaint events atomically reconcile delivery state and durable suppression. Unsubscribe tokens are consumed atomically once.

The production graph registers strict `publication.publish-due` and `publication.newsletter-send` handlers under trusted PostgreSQL job authority. Payloads cannot choose tenancy or profile; the handler binds the current owner generation and trusted job profile, validates workflow version or campaign snapshot checksum, and records a durable effect result.

## Frontend and APIs

`src/admin/fuma/publication/` supplies a complete-ancestry HTTP client and CSS-Module workspace surfaces with scoped collection loading, errors, empty states, and tag authoring. `PublicationRouteContent` selects surfaces from active route/capability contributions and exact permission decisions; it never branches on profile ID. Shared page/design editor ownership remains in `HostedProfileEditorSurface`.

`createHostedFumaScopedApi` appends editor and Publication declarations into the single `/api/fuma` boundary. The separately injected `/_fuma/publication` public boundary verifies signed unsubscribe tokens and raw OCI event signatures, derives event scope from server-owned provider-message delivery records, applies Redis fail-closed rate limits, and never accepts body tenant authority. The hosted service graph owns PostgreSQL, Redis, durable jobs, OCI delivery, cryptographic IDs/hashes, and lifecycle closure. Self-host startup does not construct it.

## FUMA-035 editorial workflow and scheduled readiness

Editorial roles (`author`, `editor`, `managing-editor`), content assignments, review requests, decisions, inbox notifications, and workflow history are exact platform/organization/workspace/site/owner-generation/profile records. Every PostgreSQL operation reloads active transfer-free owner authority. Assignment and review mutations additionally recheck active role rows inside their transaction, while review creation and decisions lock the current metadata workflow version so a role revocation or content edit cannot race an authorization decision.

Review decisions are revision-specific. Authors cannot review their own content, only the assigned active editor may decide a pending request, and stale revisions cannot be approved or rejected. Change requests and rejections require a non-empty immutable decision note. Every role, assignment, review, and decision mutation appends both `fuma_publication_workflow_history` and `fuma_audit_history` in the same transaction; the workflow history table rejects update and delete through a PostgreSQL trigger. Assignment/review/decision notifications are durable, recipient-scoped, individually acknowledged, and returned through hard-bounded inbox queries.

Scheduling and direct publication consult `PublicationWorkflowService.scheduledReadiness` for approval of the current content revision before a lifecycle transition can enqueue work. Scheduled jobs retain the owner-generation-qualified idempotency key and exact resulting workflow version; the trusted job context still supplies scope, profile, and actor authority. Approval of an earlier revision never makes a later edit ready.

The scoped API uses strict TypeBox request and response contracts. Read, role/assignment, review request/change request, and approve/reject operations use `publication.workflow.read`, `publication.workflow.assign`, `publication.workflow.review`, and `publication.workflow.approve` respectively. Change, reject, and approve have separate routes whose path supplies the decision; request bodies cannot select a stronger action. History and inbox responses are capped at 500 records, content paths use the shared bounded Publication ID schema, and caller bodies cannot carry tenancy, profile, actor, role, or session authority.

Studio threads those four exact capability decisions independently. `EditorialWorkflowPanel` uses the shared `Button` primitive and a local CSS Module to expose labelled role, assignment, review, decision-note, readiness, inbox, notification, and immutable-history regions. Read denial performs no inbox request; action controls remain disabled unless their matching permission is allowed.

## Tests and demo

Focused files cover collaboration, tags, editorial workflow, audience/analytics, email authoring, campaign delivery, public unsubscribe/provider ingress, PostgreSQL query shape, fault injection, security, HTTP client decoding, React surfaces, hostile architecture checks, config secret classes, and Blyss HTTPS Playwright acceptance. `publicationPhaseDemo.test.ts` emits a deterministic campaign/send/deliverability transcript.

### Executed FUMA-035 closure evidence — 2026-07-26

- Focused editorial behavior, stale/self/unauthorized denial, scheduled readiness/durable jobs, PostgreSQL query shape and rollback injection, strict route/client boundaries, Studio accessibility, security, lifecycle regressions, and hostile architecture coverage: **33 passed, 0 failed, 232 assertions**.
- Studio node and app TypeScript project checks passed with no diagnostics after concurrent FUMA-039 edits settled. Scoped ESLint over all FUMA-035 implementation/tests and bounded routes passed with no findings. Scoped diff whitespace validation passed.
- Additive migration `000046_editorial_workflow` has checksum candidate `11a2c6f4fb4ad620a92d5e0473bc623c5e2e8460e177a5e9270dfc52c21c27d7`. This ticket intentionally does not edit the shared migration registry/checksum/sentinel or tracker audit; primary integration owns those updates.
- The deterministic demo assigned `post-1` to `author-1`, requested review of revision 1, recorded the immutable change note “Add the launch date and source,” saved revision 2, approved `review-2`, and scheduled resulting workflow revision 3. Its review path was `content-assigned → review-requested → changes-requested → review-requested → approved`; the durable job payload was `{ contentId: "post-1", workflowVersion: 3 }` with idempotency key `publication:owner-key:1:post-1:3`.
- Browser/E2E was not required for this service/repository/Studio-unit ticket and was not run; no localhost, loopback, proxy, TLS, hydration, or public-host browser acceptance is claimed.

### Executed FUMA-034 closure evidence — 2026-07-26

- Focused lifecycle/metadata/access, universal-store, PostgreSQL query-shape, revision-adjacent, security, HTTP client, Studio accessibility, migration-policy, and architecture coverage: **73 passed, 1 unrelated optional live-PostgreSQL skip, 0 failed, 422 assertions**.
- Additive hosted migration `000044_publication_lifecycle_metadata` is checksum-finalized at SHA-256 `fa352e5abdc480422c3d514b7d48b4105f361cbda05204a699d7e7665e5355fe`. The hosted migration manifest test proves finalized `000001`–`000043` still match their declared hashes; concurrent `000045_paystack_reconciliation` remains registered after `000044`.
- Studio node and app TypeScript project checks passed with no diagnostics. Scoped ESLint over FUMA-034 implementation/tests passed with no findings. Scoped diff whitespace validation passed.
- The deterministic demo moved `post-1` through `draft → scheduled → published` to workflow revision 3. It resolved canonical `https://news.example.test/kenya-launch`, SEO title `Kenya launch SEO`, Open Graph title `Kenya launch`, social title `Kenya launch social`, anonymous access `deny`, member access `render`, and robots `index,follow`.
- Browser E2E was not required for this repository/service/Studio-unit ticket and was not run; no localhost, loopback, proxy, TLS, hydration, or public-host browser acceptance is claimed. A live PostgreSQL URL and local PostgreSQL binaries were unavailable, so PostgreSQL evidence is deterministic migration-policy and transaction/query-shape coverage rather than a live server run.

### Executed FUMA-033 closure evidence — 2026-07-26

- Focused universal CRUD/import/isolation/permission/demo, PostgreSQL query-shape, Studio loading/error/empty/tag authoring, security, route-content, and hostile architecture coverage: **41 passed, 0 failed, 200 assertions**.
- Hosted migration transition and tenant-key policy: **20 passed, 1 optional live-PostgreSQL skip, 0 failed, 97 assertions**. Migration `000040_publication_universal_content` is additive and finalized at SHA-256 `002244022f0c0a799cf0a2e8b3601736225ef97fd03cef6c3c6dc2112161d233` without changing prior checksums.
- Studio TypeScript project check: passed with no diagnostics. Scoped ESLint over FUMA-033 implementation/tests: passed with no findings. Scoped `git diff --check`: passed.
- The deterministic repository demo emitted one universal post row with stable ID `demo-post`, its visual document, co-author relations `author-a`/`author-b`, tag relations `tag-news`/`tag-kenya`, and primary tag `tag-news`.
- Browser/E2E was not needed for this repository/storage ticket and was not run; no localhost or loopback browser evidence is claimed.

### Executed FUMA-031 closure evidence — 2026-07-26

- Focused revision/checkpoint/retention/object-snapshot/diff/restore demo, durable-job, collaboration/security/fault, migration architecture, and React accessibility coverage: **51 passed, 1 optional live-PostgreSQL skip, 0 failed, 355 assertions**.
- Additive hosted migration `000041_publication_revisions` is checksum-finalized at SHA-256 `7ea67a5fd66af9c8be2515a1b303baf2831363fe9b1a23437d97c47cb47966cc`; finalized migrations through `000040` were not edited and concurrent `000042`/`000043` registry entries were preserved.
- Studio node and app TypeScript project checks passed with no diagnostics. Scoped ESLint over implementation/tests passed with zero warnings; scoped `git diff --check` passed.
- The deterministic demo emitted checkpoint `revision-checkpoint`, destructive head `revision-destructive`, diff entries `added:/newSetting`, `changed:/sections/0/text`, `removed:/sections/1`, and `changed:/title`, then appended restore head `revision-restored` with parent `revision-destructive`. History remained `[revision-checkpoint, revision-destructive, revision-restored]`, and the deleted `pricing` section returned exactly.
- Browser E2E was not required for this repository/storage/UI-unit ticket and was not run; no localhost, loopback, proxy, TLS, hydration, or public-host browser acceptance is claimed.

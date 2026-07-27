# Fuma tracker closure audit

Date: 2026-04-24

## Decision policy

This audit compares every active tracker item from task 16 through task 84, plus task 86, with the exact `Deliver`, `Verify`, and `Demo` requirements in `docs/plans/fuma-execution-backlog.md`.

A ticket closes only when all required behavior is represented by executed repository, build, or Blyss HTTPS evidence. Authored tests, manifests, runbooks, provider doubles, or fail-closed placeholders do not establish an unexecuted runtime, browser, infrastructure, provider, customer, legal, signature, or production acceptance criterion. Provider fakes are accepted where the backlog allows them, but they do not replace missing central composition or an explicitly operational demo.

The `authored-unvalidated` labels in the governance handoff files and the coding-only validation notes in phase references are superseded only with respect to commands that were subsequently executed. They do not erase unresolved integration or external approvals recorded by those files.

## Authoritative executed evidence

- Aggregate tests: 7,421 pass, 8 optional skips, 0 fail (7,429 total).
- Studio/root: 7,324 pass, 8 skip, 0 fail.
- Public Web: 53 pass, 0 fail; typecheck, lint, build passed; 31 generated routes/pages.
- Publication: 64 behavior/integration tests and 511 assertions; 23 architecture tests and 129 assertions; React Email 9 pass and 1 expected architecture skip; Studio app/server TypeScript passed.
- Commercial: 88 pass, 1 expected live-PostgreSQL skip, 0 fail, 373 assertions; node/app/E2E TypeScript passed.
- Governance: 40 pass, 0 fail, 177 assertions; governance typecheck passed.
- Control surfaces: 4 pass, 0 fail, 15 assertions; typecheck/build passed with 8 routes.
- Task 86: 10 pass, 0 fail, 59 assertions.
- Hosted migration policy: 14 pass and 1 live-PostgreSQL skip. Migrations are indexed contiguously through `000039_launch_evidence_privacy` with finalized checksums.
- Prior Blyss HTTPS evidence: control at `https://5174.blyss.co.ke` 4 pass; public/Lawyer at `https://3002.blyss.co.ke` 20 pass.
- Final aggregate build, lint, `git diff --check`, and frozen install passed. Root `bun.lock` remained byte-stable at SHA-256 `e9688c20f69e32aa0df7cea681b5c4971ef5a7d272d3e644bc96486384c4c1b9`.

## Closure decisions

### Public Web

| Tracker | Ticket | Decision | Concrete missing acceptance |
|---:|---|---|---|
| 16 | FUMA-WEB-006 | Keep open | The BFF/redaction tests pass, but the runtime authority catalog has no real product/pricing/template/showcase/expert/plugin registrations; the required successful private-runtime envelope demo is absent. |
| 17 | FUMA-WEB-007 | Keep open | Acquisition pages and Blyss journeys pass, but the journey stops at public `/start`; no executed safe app-host transition or complete measured visual/performance budget matrix exists. |
| 18 | FUMA-WEB-008 | Keep open | The validated editorial pipeline passes static fixtures, but the required preview → publish → search → slug change → canonical redirect/feed lifecycle demo was not executed. |
| 48 | FUMA-WEB-009 | Keep open | No real billing projection is registered and no publish/switch/withdraw price-book mutation with app-side re-resolution was demonstrated. |
| 41 | FUMA-WEB-010 | Keep open | No authority-backed approved template, immutable browser preview, withdrawal mutation, or product onboarding handoff was executed. |
| 65 | FUMA-WEB-011 | Keep open | Real expert/showcase/plugin authorities, moderation invalidation, purge events, opt-out, transfer, and revocation are not centrally composed or demonstrated. |
| 66 | FUMA-WEB-012 | Keep open | Public pages prove safe unavailable states, not an authority-backed Kenyan expert/plugin browse, mediated inquiry, withdrawal race, and sitemap removal demo. |
| 67 | FUMA-WEB-013 | Keep open | The public intent boundary is tested, but the central issuer, app resume, auth code exchange, cancellation, authority re-resolution, and app-host-only session flow are not mounted or demonstrated. |
| 68 | FUMA-WEB-014 | Keep open | Legal approval and central contact routing are absent; no real contact/status degradation integration and policy approval demo exists. |
| 69 | FUMA-WEB-015 | Keep open | No complete crawler/schema/sitemap acceptance or authority-backed withdrawn-expert removal and indexation approval was executed. |
| 70 | FUMA-WEB-016 | Keep open | No persistent central collector, retention/deletion job, dedupe/reorder authority, complete funnel join, dashboard, or provider-blockage demo exists. |
| 79 | FUMA-WEB-017 | Keep open | No paired production digest deployment, real multi-arch/SBOM/provenance evidence, DNS/TLS/direct-origin matrix, canary abort, or independent rollback was executed. |
| 83 | FUMA-WEB-018 | Keep open | The gate is explicitly unsigned and ABORT; required approvals, host matrix, DNS/TLS, crawler/indexation, accessibility/performance sign-off, backup/restore, canary, rollback, owners, and signatures are absent. |

### Publication and email

| Tracker | Ticket | Decision | Concrete evidence or missing acceptance |
|---:|---|---|---|
| 19 | FUMA-028 | **Close** | Executed draft concurrency, PostgreSQL query-shape, coordinator, scoped-route, migration, replay, stale-conflict, and deterministic resolution evidence covers the ticket. |
| 20 | FUMA-029 | Keep open | Redis advisory presence exists, but site-room WebSocket lifecycle/fan-out, reconnect/tab behavior, payload rate limiting, and the two-collaborator crash/TTL demo are absent. |
| 21 | FUMA-030 | Keep open | Atomic reconciliation/rebase tests pass, but transport fan-out/acks, reconnect catch-up, randomized convergence, and the concurrent edit/reconnect tree-comparison demo are absent. |
| 22 | FUMA-031 | Keep open | Immutable checkpoint/restore exists, but periodic revisions, object snapshots/GC, revision diff UI, broader conflicts, and destructive-edit compare/restore demo are absent. |
| 23 | FUMA-032 | Keep open | Shell architecture tests pass, but the required executed Blyss Publication shell acceptance/demo is absent. |
| 24 | FUMA-033 | Keep open | The implementation uses a separate Publication table and JSON relation IDs rather than the required universal data store/current relation model; complete CRUD/import/demo evidence is absent. |
| 25 | FUMA-034 | **Close** | Strict lifecycle/SEO/Open Graph/social/canonical/redirect/access authority, immutable metadata revisions, safe semantic preview, denied-audience coverage, migration `000044`, and deterministic lifecycle→decision demo are executed and documented. |
| 26 | FUMA-035 | Keep open | Editorial role rules, assignments, review requests, approve/reject notes, inbox/notifications, and full approval demo are absent. |
| 27 | FUMA-036 | Keep open | Scheduled unpublish, preview-token lifecycle, audience resolvers/leak checks, timezone/DST and restart recovery demo are absent. |
| 28 | FUMA-037 | Keep open | Author/tag/date/collection templates, loops, archives, pagination, access-aware queries, and shared-template archive demo are absent. |
| 29 | FUMA-038 | Keep open | Separate member records exist, but member authentication/session/reauth/consent and same-email dual-realm threat/demo evidence is absent. |
| 30 | FUMA-039 | Keep open | Dynamic segments/grants exist, but explicit segments, full access states, consent/profile/export/delete/enumeration controls, and independent member access demo are incomplete. |
| 31 | FUMA-040 | Keep open | Append-only analytics exist, but retention/deletion, bot/consent/opt-out/identifier policy and privacy-filtered public/member metrics demo are incomplete. |
| 32 | FUMA-043 | Keep open | Hierarchical settings exist, but the typed namespaced variable catalog, reset/unknown/secret matrix, cross-site denial, and full override demo are absent. |
| 33 | FUMA-044 | Keep open | Newsletter/composer basics exist, but sender ownership, content linkage, autosave conflicts, audience estimates, verification gates, and two-newsletter demo are incomplete. |
| 34 | FUMA-045 | Keep open | Preview/version/test-send basics exist, but audience fixture contexts, version comparison, permission/rate/secrecy/a11y coverage, and full demo are absent. |
| 35 | FUMA-046 | Keep open | Immutable snapshots/idempotent OCI submission exist, but explicit hash/progress/cancel/size/partial-batch/deferred-provider coverage and scheduled exactly-once demo are incomplete. |
| 36 | FUMA-047 | Keep open | Unsubscribe and OCI event handling exist, but suppression levels, full provider state/log reconciliation, sender-domain health, first-party consent/retention metrics, and full demo are incomplete. |

`FUMA-042` is repository-verifiable and its executed renderer tests cover its acceptance, but it is not represented by an open item in this 89-task tracker. `FUMA-041` is likewise absent from this tracker and remains blocked by the skipped second-architecture compatibility run.

### Commercial edge

| Tracker | Ticket | Decision | Concrete missing acceptance |
|---:|---|---|---|
| 37 | FUMA-048 | Keep open | Immutable release tests pass, but the required production PostgreSQL repository acceptance was skipped. |
| 38 | FUMA-049 | Keep open | Worker sequencing exists, but durable worker registration, production adapters, live migration evidence, and fail/serve-old/retry/atomic-switch demo are absent. |
| 39 | FUMA-050 | Keep open | Free-host policy exists, but production host serving composition and executed two-host/no-fallback browser demo are absent. |
| 40 | FUMA-051 | Keep open | Edge policy exists, but production cache/ports, registered jobs, full conditional/load rollback matrix, and E2E demo are absent. |
| 42 | FUMA-052 | Keep open | Metering policy exists, but durable collectors/reconcile jobs and concurrent replay/provider-total/amplification demo are absent. |
| 43 | FUMA-053 | Keep open | Paystack boundary tests pass with valid fakes, but no durable ledger/mounted webhook scope and complete dual-scope settlement demo exists. |
| 44 | FUMA-054 | Keep open | Entitlement policy exists, but durable repository/integrated price-book/offer lifecycle and required issue/accept/block demos are absent. |
| 45 | FUMA-055 | Keep open | Checkout policy exists, but no durable repository, handlers/UI, complete stale/error matrix, or fake checkout demo exists. |
| 46 | FUMA-056 | Keep open | Reconciliation logic exists, but no mounted raw webhook, durable handler/repository, or out-of-order/partial/replay/handoff demo exists. |
| 47 | FUMA-057 | Keep open | Quota policy exists, but no durable collectors, dunning integration, self-service surface acceptance, or free/grant/payment recovery demo exists. |
| 49 | FUMA-058 | Keep open | Customer-payment policy exists, but no merchant routes/webhooks/durable adapter/registered transfer step and complete card/mobile-money demo exists. |
| 50 | FUMA-059 | Keep open | Domain encryption/state policy exists, but no production credential repository/composition and complete rotation/retry demo exists. |
| 51 | FUMA-060 | Keep open | Cloudflare fake-policy tests pass, but no mounted reconcile job/UI/routing and prevalidate/TLS/cutover/diagnose/rollback demo exists. |
| 52 | FUMA-061 | Keep open | Registrar policy tests pass, but no durable repository/jobs/UI and no search/quote/double-confirm/single-receipt demo exists. |
| 53 | FUMA-062 | Keep open | Customer-DNS/transfer policy exists, but no durable composition, registered domain-outcome saga step, settings UI, or diagnose/fix/transfer demo exists. |

### Governance, infrastructure, hardening, and launch

| Tracker | Ticket | Decision | Concrete missing acceptance |
|---:|---|---|---|
| 54 | FUMA-063 | Keep open | No mounted catalog administration or enable/disable demo; approved live catalog/pricing/credential authority is absent. |
| 55 | FUMA-064 | Keep open | No integrated durable ledger/UI/expiry job/transfer registration or included/exhausted/BYOK demo; KMS custody is absent. |
| 56 | FUMA-065 | Keep open | No mounted AI runtime/stores/editor bridge/jobs/audit or two-site concurrent edit with mid-turn revocation demo exists. |
| 57 | FUMA-066 | Keep open | No connector UI/live bridge/runtime/audit/settlement/transfer integration or two-site revoke/publish demo exists. |
| 58 | FUMA-067 | Keep open | No integrated repositories/object storage/workers/schedules/transfer steps or install-twice/crash/transfer demo exists. |
| 59 | FUMA-068 | Keep open | No real scanner/reviewer/signing custody/publication or approve/sign/install/revoke lifecycle demo exists. |
| 60 | FUMA-069 | Keep open | No reviewed/signed artifact and complete sandbox payment-purpose E2E with receipts/refunds/transfer evidence exists. |
| 61 | FUMA-070 | Keep open | No mounted editor AI install binding and complete disclosure/confirmation/secret-handoff/fake-payment demo exists. |
| 62 | FUMA-071 | Keep open | The bounded console shell does not deliver the full searchable/action domain integrations or provisional-client/offer/pending-handoff demo. |
| 63 | FUMA-072 | Keep open | No integrated support UI/banner, abuse/appeal queues, evidence flow, or executed support and dual-approval break-glass rehearsal exists. |
| 64 | FUMA-073 | Keep open | No complete management/console/transfer/cache flow or two-profile inquiry/plugin-link/transfer/hide demo exists. |
| 71 | FUMA-074 | Keep open | No registered saga/customer-admin orchestration or managed-site/offer/payment/failure/recovery demo exists. |
| 72 | FUMA-075 | Keep open | Full Ghost Admin API/CSV/media/settings/newsletter/resume/reauth behavior and actual import-twice/rollback integration demo are incomplete. |
| 73 | FUMA-076 | Keep open | The complete real Lawyer inventory/customer export/provider reconciliation/OCI state and sanitized import/report demo are absent. |
| 74 | FUMA-077 | Keep open | The complete customer estate and full visual/a11y/responsive/access parity plus template/token mutation demo are absent. |
| 75 | FUMA-078 | Keep open | No protected GHCR multi-arch build/boot/publish, real digests, scan, SBOM/provenance/signature, or paired ARM64 demo exists. |
| 76 | FUMA-079 | Keep open | No Oracle capacity/host/k3s/Cloudflare/DNS/TLS/staging/session/tenant/drain deployment evidence exists. |
| 77 | FUMA-080 | Keep open | No production-like migration, encrypted off-host backup, restore/RPO-RTO, failed-canary rollback, or fresh-stack rebuild demo exists. |
| 78 | FUMA-081 | Keep open | No measured ARM64 load/fault scaling, fired alerts, service recovery, signed DR drill, or named on-call evidence exists. |
| 80 | FUMA-082 | Keep open | Security tests pass, but no completed scoped export/deletion receipt and no legal retention/DPA/consent/abuse approval exists. |
| 81 | FUMA-083 | Keep open | No real ARM64 workload measurement or current reconciled Oracle/OCI/Cloudflare cost evidence proving launch margin exists. |
| 82 | FUMA-084 | Keep open | Pilot checklist remains false/unsigned: no real migration, contract, OCI mail, customer parity, provider reconciliation, pilot, rollback, or restored-state signatures. |
| 84 | FUMA-085 | Keep open | `launch-gate.json` remains blocked with decision ABORT and no approvals; production bootstrap, routing, canary, provider/economic approvals, rollback, communications, ownership, and six signatures are absent. |

### Cross-surface styling task

| Tracker | Ticket | Decision | Concrete evidence |
|---:|---|---|---|
| 86 | Tailwind/shadcn infrastructure | **Close** | `apps/web` and `apps/control-surfaces` use exact app-local Tailwind 4.3.3 and shadcn 4.14.1 pins, local configs/components/theme CSS, no shared UI package, and architecture tests preserve legacy Studio CSS Modules/current primitives. Focused evidence: 10 pass, 59 assertions; control typecheck/build and frozen install passed. |

## Result

- Newly eligible active tracker items: **19 and 86**.
- Active implementation/acceptance items kept open: **68**.
- Principal blocker classes: missing central runtime/job/route/transfer composition; incomplete required demos; skipped live PostgreSQL or second-architecture checks; absent real authority projections; external provider/customer/legal approvals; production infrastructure/DNS/TLS/canary/rollback; current economics/capacity evidence; and named signatures.
- Unified launch remains **ABORT / unsigned / non-promotable**.

## Coding batch 1 follow-up — 2026-07-26

The following earlier keep-open decisions are superseded by completed implementation and primary-agent validation:

- **Task 16 / FUMA-WEB-006 — Close.** Six concrete PostgreSQL-backed public authority registrations now compose product facts, pricing, templates, showcases, experts, and plugins behind the private audience-bound boundary. Strict TypeBox envelopes, stable IDs, bounded filters/pagination, dataset versions/ETags, credential rejection, redaction, safe failures, and successful private-runtime/BFF envelope demos passed. Combined Studio projection gate: 28 pass; isolated Web BFF/authority/architecture gate: 16 pass.
- **Task 20 / FUMA-029 — Close.** Trusted WebSocket upgrade authorization, owner-generation-qualified Redis rooms, bounded heartbeats, join/update/leave/fan-out, reconnect/tab identity, TTL expiry, rate/backpressure limits, wrong-scope denial, and advisory Redis-loss behavior are implemented. Combined focused presence/client/context/Redis/architecture evidence passed; aggregate architecture confirmed presence cannot grant edit authority.
- **Task 23 / FUMA-032 — Close.** Permission-first capability-owned Publication shell routing, exact-scope writes, accessible disclosure/direct links, skip-link/main focus, responsive CSS Modules, loading/error/empty/unavailable states, editor/viewer behavior, and hostile architecture gates passed. Blyss HTTPS acceptance at `https://5174.blyss.co.ke` and `https://3002.blyss.co.ke`: 2 passed.
- **Task 37 / FUMA-048 — Close.** Durable PostgreSQL composition, immutable lifecycle/replay/fences/pointer/retention behavior, JSONB persistence, canonical manifest hashing, and mutation/stale/foreign denial passed. The previously skipped acceptance was executed against an isolated disposable PostgreSQL 16 database: 1 pass, 0 fail, 12 assertions; the database container was removed afterward.

Primary integration found and fixed three release-path defects: HTML/CSS MIME detection rejected valid immutable artifacts; Bun SQL JSONB parameters were double-encoded without an explicit text-to-jsonb boundary and normalized read; and JSONB object-key reordering invalidated insertion-order-dependent manifest hashes. Focused regressions cover each fix.

Final batch validation:

- Aggregate tests: Studio/root 7,349 pass, 9 optional skips, 0 fail; Web 53 pass; Control 4 pass; Governance 40 pass. Total: **7,446 pass, 9 optional skips, 0 fail**.
- Aggregate production build passed: Studio 2,064 modules, Web 31 generated pages/routes, Control 8 routes, and all package/governance typechecks.
- Aggregate lint passed.
- `git diff --check` passed.
- Frozen install passed; root lock remained byte-stable at SHA-256 `e9688c20f69e32aa0df7cea681b5c4971ef5a7d272d3e644bc96486384c4c1b9`.
- No production deployment, DNS/TLS mutation, purchase, signing, secret operation, or production migration occurred. Unified launch remains ABORT / unsigned / non-promotable.

After these closures, **64 implementation/acceptance tracker items remain open**.

## Coding batch 2 follow-up — 2026-07-26

The following earlier keep-open decisions are superseded by completed implementation, ticket-agent acceptance, and primary-agent integration validation:

- **Task 17 / FUMA-WEB-007 — Close.** The six core acquisition routes now use truthful Kenya-first reviewed claims, semantic responsive page contracts, explicit contrast/focus/forced-colors/reduced-motion gates, and a bounded handoff layer that does not assume FUMA-WEB-013 authentication authority. Build-enforced budgets measured 152,821 B gzip JavaScript per acquisition route, 0 B images, and 0 B local fonts. Isolated Web evidence: 67 pass, 349 assertions, typecheck/build passed; Blyss HTTPS functional acceptance reported 18 pass and committed visual acceptance 12 pass through `https://3002.blyss.co.ke`.
- **Task 21 / FUMA-030 — Close.** Strict TypeBox collaboration operations, authoritative heads, immutable operation/mutation ledgers, replay receipts, atomic batches, explicit rebase responses, accepted acknowledgement/fan-out, reconnect catch-up, transport multiplexing with presence, and browser reconnect/retry coordination are implemented. Focused evidence includes randomized convergence across 80 add/move/rename/style batches and socket wrong-scope/replay behavior.
- **Task 24 / FUMA-033 — Close.** Publication posts, pages, settings, and tags now use `data_tables`/`data_rows` with current normalized author/tag relations, stable IDs, scoped authors, strict atomic import, CRUD/delete, complete ancestry/owner-generation/profile authority, and Studio loading/error/empty/tag-authoring states. Additive migration `000040_publication_universal_content` remains immutable at checksum `002244022f0c0a799cf0a2e8b3601736225ef97fd03cef6c3c6dc2112161d233`. Primary integration replaced raw JSON SQL predicates with deterministic physical IDs, exact owner-sidecar joins, and transaction row locks plus TypeScript optimistic-version comparison; the JSON egress architecture gate and universal-content regressions pass.
- **Task 38 / FUMA-049 — Close.** The durable `fuma.publish-release` worker now binds exact immutable source/release/owner/site/generation/job/fence authority, performs semantic rendering into release-local content-addressed objects, revalidates the exact manifest, activates only at the final boundary, persists idempotent effects, and recovers around finalization/activation faults. Production snapshot/attempt/release adapters and central durable handler registration are composed. Disposable PostgreSQL acceptance for FUMA-049 and the retained FUMA-048 regression passed 2 tests and 19 assertions: fault retained `release-old`, retry switched once to `release-new`, replay kept the pointer stable; the container was removed.
- **Task 91 / coding batch 2 coordination — Close.** Exactly four complete-ticket agents ran in parallel for FUMA-WEB-007, FUMA-030, FUMA-033, and FUMA-049. Primary integration resolved both aggregate blockers without raising architecture limits or adding allowlists: publication service ports moved to `servicePorts.ts`, leaving `services.ts` at 664 lines under the 700-line ceiling; and forbidden JSON extraction outside `server/db/jsonExtract.ts` was reduced to zero.

Final batch validation:

- Focused architecture/content regression gate: **21 pass, 0 fail, 76 assertions**.
- Studio node and app TypeScript checks passed; scoped changed-file lint passed.
- Aggregate tests: Studio/root 7,377 pass, 10 optional skips, 0 fail; Web 67 pass; Control 4 pass; Governance 40 pass. Total: **7,488 pass, 10 optional skips, 0 fail**.
- Aggregate production build passed, including Web budget enforcement at 152,821 B gzip JavaScript per acquisition route, 0 B images, and 0 B fonts.
- Aggregate lint and `git diff --check` passed.
- Frozen install passed; the sole root `bun.lock` remained byte-stable at SHA-256 `e9688c20f69e32aa0df7cea681b5c4971ef5a7d272d3e644bc96486384c4c1b9`; no nested lockfile exists.
- No production deployment, DNS/TLS mutation, purchase, signing, secret operation, or irreversible external action occurred. Unified launch remains **ABORT / unsigned / non-promotable**.

After these closures, **60 implementation/acceptance tracker items remain open**.


## Coding batch 3 follow-up — 2026-07-26

The following earlier keep-open decisions are superseded by completed implementation, ticket-agent acceptance, and primary-agent integration validation:

- **Task 18 / FUMA-WEB-008 — Close.** The public Web now has a strict TypeBox Git Markdown/MDX compiler for docs, blog, guides, and changelog content; draft/scheduled eligibility; authors/categories/versions; explicit safe-component declarations; accessible TOCs and code blocks; direct canonical redirects; deterministic generated search and RSS/Atom feeds; review gates; and exclusion of internal/security material. Hostile tests cover malformed and colliding metadata, leakage, unsafe components, broken/noncanonical links, redirect chains, deterministic output, code, and accessibility. The committed lifecycle receipt executes preview → publish → search → slug change → direct canonical redirect/feed replacement. Web evidence: 72 pass, 387 assertions; 10 generated search records; typecheck/build passed with 31 generated pages and unchanged 152,821 B gzip acquisition-route JS, 0 B images, and 0 B fonts.
- **Task 22 / FUMA-031 — Close.** Periodic immutable revisions, named protected checkpoints, tenant/generation/profile-qualified content-addressed object snapshots, bounded retention, unreferenced-only GC with reachability recheck, structural comparison, CAS restore-as-new-head, immutable audit/history, current owner authority, trusted jobs, and accessible Studio review/restore controls are implemented. The deterministic demo checkpoints, applies destructive shared edits/deletion, compares the exact JSON-pointer diff, and restores into a new child head while retaining all three history entries. Additive migration `000041_publication_revisions` is finalized at `7ea67a5fd66af9c8be2515a1b303baf2831363fe9b1a23437d97c47cb47966cc`.
- **Task 29 / FUMA-038 — Close.** Site-member identities and sessions now form a separate realm from Better Auth staff, with strict TypeBox contracts, exact platform/organization/workspace/site/owner-generation/profile scope, HMAC-digested realm-prefixed tokens, secure host-only cookies, idle/absolute expiry, rotation/revocation, fail-closed races, enumeration and reauthentication limits, append-only consent provenance, and atomic idempotent imports requiring fresh exact non-impersonated staff authority. The same-email demo proves independent staff/member cookies, tokens, secrets, roles, sessions, and permissions and rejects every cross-realm substitution. Additive migration `000042_member_identity_realm` is finalized at `638536b3172e3242741e8d587a0ef35f0d86012629f29bf89584913fa12208e0`.
- **Task 39 / FUMA-050 — Close.** Durable free-host allocation and exact-Host routing now normalize safe `<tenant>.fuma.co.ke` labels, permanently reject required and reviewed operational names, serialize collisions, bind current owner generation and monotonic state, map only to validated active immutable release pointers, preserve canonical redirect path/query, suspend safely, and fail malformed/unknown/reserved/stale/fenced hosts closed without a default tenant. Central Host routing runs before legacy self-host fallback. The deterministic two-release demo serves each exact tenant host and no fallback; disposable PostgreSQL 16 acceptance additionally proved active resolution, suspension denial, transfer-fence denial, and stale-generation denial: 1 pass, 5 assertions. Additive migration `000043_free_host_authority` is finalized at `d41fda99a82a0e260d386c3feababfda65cb67b4972f88a24c33f3e555bb375b`; the container was removed.
- **Task 92 / coding batch 3 coordination — Close.** The initial exactly-four-agent invocation encountered a transient response-stream failure; the full batch was retried as exactly four parallel complete-ticket agents with no dependency edges, preserving partial edits. Primary integration extracted member dispatch into a dedicated boundary so grandfathered `server/router.ts` shrank to 751 lines, finalized `000043` after live PostgreSQL acceptance, and advanced the migration high-water sentinel to `000044`.

Final batch validation:

- Combined focused Studio gate: **88 pass, 1 optional unrelated live-PostgreSQL skip, 0 fail, 1,441 assertions**; FUMA-050 disposable PostgreSQL acceptance separately passed **1/1** with 5 assertions.
- Public Web: **72 pass, 0 fail, 387 assertions**; typecheck and production build passed.
- Studio node and app TypeScript checks passed.
- Aggregate tests: Studio/root 7,412 pass, 11 optional skips, 0 fail; Web 72 pass; Control 4 pass; Governance 40 pass. Total: **7,528 pass, 11 optional skips, 0 fail**.
- Aggregate production build and aggregate lint passed; `git diff --check` passed.
- Frozen install passed; the sole root `bun.lock` remained byte-stable at SHA-256 `e9688c20f69e32aa0df7cea681b5c4971ef5a7d272d3e644bc96486384c4c1b9`; no nested lockfile exists.
- No production migration/deployment, DNS/TLS mutation, purchase, signing, secret operation, commit, push, or irreversible external action occurred. Unified launch remains **ABORT / unsigned / non-promotable**.

After these closures, **56 implementation/acceptance tracker items remain open**.

## Coding batch 4 follow-up — 2026-07-26

This primary-agent follow-up supersedes the earlier FUMA-034 and FUMA-053 decisions only. The exactly-four-stage batch authored complete phases for FUMA-034, FUMA-053, FUMA-078, and FUMA-041/FUMA-042. The FUMA-041 amd64 and FUMA-078 container/publish stages were deliberately stopped after the user prohibited further long-running Docker, buildx, and QEMU work; they remain acceptance-blocked and were not restarted.

- **Task 25 / FUMA-034 — Close.** Draft, scheduled, published, unpublished, and archived lifecycle states; SEO, Open Graph, social, canonical, redirect, and public/member/paid/segment access metadata; strict TypeBox contracts; exact-scope PostgreSQL authority; immutable revision integration; semantic preview/access decisions; Studio metadata controls; and the scheduled→published lifecycle demo are implemented. Migration `000044_publication_lifecycle_metadata` is finalized at `fa352e5abdc480422c3d514b7d48b4105f361cbda05204a699d7e7665e5355fe`. Focused evidence passed 21 behavior/architecture/regression tests, and the authoritative aggregate passed.
- **Task 43 / FUMA-053 — Close.** Strict credential-scoped Paystack contracts and purpose registration, platform/customer scope isolation, exact integer amount/currency/reference verification, signature-before-parse raw webhook handling, durable idempotent initialization/event/settlement reconciliation, claim release/retry, central bounded routing, and redaction are implemented. Migration `000045_paystack_reconciliation` is finalized at `eb45811cd1e00907c36ac4a3ee6a113731712220b56c8bb406ff90a021f817d8`. Existing PostgreSQL on port 5433 provided disposable-schema acceptance: 1 pass, 16 assertions, with cleanup. Focused in-memory evidence passed 9 tests. Primary integration removed the `transport.ts` ↔ `memoryLedger.ts` cycle without changing the public phase export; the tsconfig-aware 2,998-file cycle gate and all focused Paystack tests pass.
- **FUMA-042 renderer phase — repository acceptance retained.** Official exact package pins/API loading, unsupported-version/host rejection, committed HTML/plaintext snapshots, client-safe markup, Bun CLI rendering, native Linux ARM64, executable matrix definition, and preview CLI build/serve all pass. This ticket is not represented by an active tracker item.
- **FUMA-041 — not closed.** The Linux amd64 compatibility matrix remains the one explicit skipped email test. Completing it requires the stopped container/QEMU path and therefore needs renewed user approval or a separately accepted bounded replacement.
- **Task 75 / FUMA-078 — Keep open.** Repository supply-chain contracts, paired digest-only manifests, mixed-SHA rejection, non-root role commands, Dockerfiles/smoke scripts, and CI scan/SBOM/provenance/signing gates pass static validation. No local amd64/ARM64 image build/boot matrix, protected GHCR publication, digest scans, generated published-image SBOM/provenance, signing, or paired ARM64 runtime/public-web demo was executed.
- **Task 93 / coding batch 4 coordination — Close.** Exactly four complete-ticket/phase stages were launched. Primary integration preserved their authored work, stopped only the user-rejected Docker/buildx/QEMU processes, repaired the publication module-size breach by extracting `universalContentCodec.ts` (`universalContentStore.ts` is 621 lines), advanced the next migration sentinel to `000046`, corrected FUMA-078 CI preflight commands, removed the Paystack import cycle, and recorded the two explicit acceptance blockers rather than over-claiming closure.

Final batch validation:

- Focused repaired integration gate: **55 pass, 1 unrelated optional live-PostgreSQL skip, 0 fail, 281 assertions**; FUMA-053 PostgreSQL acceptance separately passed **1/1** with 16 assertions.
- Paystack/cycle/preference regression gate after aggregate diagnosis: **22 pass, 0 fail, 82 assertions**; the aggregate-only preference spy failure did not reproduce and no unrelated production code was changed.
- Aggregate tests: Studio/root **7,438 pass, 12 optional skips, 0 fail**; Web **72 pass**; Control **4 pass**; Governance **47 pass**. Total: **7,561 pass, 12 optional skips, 0 fail**. The only batch-related skip is the explicitly blocked FUMA-041 Linux amd64 matrix.
- Aggregate production build passed for all packages, Studio, Web, and Control; Web retained 31 generated pages/routes and the 152,821 B gzip acquisition-route budget.
- Aggregate lint passed after replacing a literal double-space SHA-sidecar regex with its equivalent `{2}` form; the governance package then passed all **47** tests and 239 assertions.
- `git diff --check` and frozen install passed. Root `bun.lock` remained at SHA-256 `e9688c20f69e32aa0df7cea681b5c4971ef5a7d272d3e644bc96486384c4c1b9`; no nested workspace lockfile was introduced (the tracked vendored Pixelarticons lockfile is pre-existing).
- Source-computed migration checksums exactly match the finalized registry values for `000044` and `000045`; the next hosted migration ID is `000046`.
- No prohibited Docker/buildx/email-matrix process remained running. No production migration/deployment, GHCR publication, DNS/TLS mutation, purchase, signing, secret operation, commit, push, or irreversible external action occurred.

After these closures, **54 implementation/acceptance tracker items remain open**. Unified launch remains **ABORT / unsigned / non-promotable**.

## Coding batch 5 follow-up — 2026-07-26

This follow-up supersedes the earlier FUMA-035 and FUMA-039 keep-open decisions. Exactly four complete-ticket/phase stages were started for FUMA-035, FUMA-039, FUMA-041/FUMA-042 continuation, and FUMA-078 continuation. Their foreground response streams were canceled, but bounded authored work was preserved and primary integration completed without restarting Docker, buildx, QEMU, or container/emulation workloads.

- **Task 26 / FUMA-035 — Close.** Exact-scope editorial role and content assignments, review requests, required changes/rejection/approval notes, self-approval/stale-revision/unauthorized-reviewer denial, scheduled-readiness integration, immutable workflow history, append-only audit, bounded inbox/notifications, central HTTP composition, accessible CSS Modules Studio controls, and the deterministic author → changes → revised content → approval → scheduled-job demo are implemented. Focused evidence passed **7 tests, 0 fail, 93 assertions**. Additive migration `000046_editorial_workflow` passed disposable PostgreSQL acceptance and is finalized at `11a2c6f4fb4ad620a92d5e0473bc623c5e2e8460e177a5e9270dfc52c21c27d7`.
- **Task 30 / FUMA-039 — Close.** Realm-bound member accounts/profile, append-only newsletter-consent provenance, explicit and dynamic segments with deterministic recalculation, complimentary/manual/paid access, active/grace/expired/revoked evaluation, exact content-presentation integration, export/deletion, session revocation, identity/profile erasure rules, enumeration-sensitive rate limiting, exact tenant/scope denial, bounded central routes, accessible CSS Modules Studio controls, and the deterministic segment/access demo are implemented. Focused evidence passed **12 tests, 0 fail, 65 assertions** under a hard timeout. Additive migration `000047_member_accounts_access` passed disposable PostgreSQL acceptance and is finalized at `f6ec6be3ce04e68aa1c9d26c29f080d324f9814b0001ae0aef09f814f0c16a2d`.
- **Combined live PostgreSQL acceptance.** Existing PostgreSQL on port 5433 was used only for a disposable schema. The exact-scope workflow/member authority installed; workflow history immutability, exact realm/member pairing, and consent append-only enforcement passed **1/1**; final `pg_namespace` verification found **0** `fuma_workflow_member_%` schemas.
- **FUMA-042 renderer continuation — repository acceptance retained.** Exact official pins/API loading, unsupported-version/host rejection, deterministic HTML/plaintext snapshots, safe client markup, Bun CLI/native Linux ARM64 rendering, executable matrix declaration, preview build/serve, hostile schemas/URLs/styles/prototypes/cycles/reflection/fuzzing, and a separate trusted-JSX boundary passed **18 tests**, with the one FUMA-041 amd64 gate explicitly skipped.
- **FUMA-041 — not closed.** Linux amd64 compatibility remains the explicit skipped matrix test. Docker/QEMU was not run because renewed approval was not provided.
- **Task 75 / FUMA-078 — Keep open.** Governance/static supply-chain evidence now passes **51 tests, 269 assertions** and package typecheck, including paired-release non-overwrite/cleanup, exact two-architecture enforcement, architecture/image-label evidence binding, smoke cleanup/evidence behavior, and workflow contracts. Image build/boot, protected GHCR publication, published-digest scans, generated published-image SBOM/provenance, signing, and the paired ARM64 runtime/public-web demo remain unexecuted.
- **Task 94 / coding batch 5 coordination — Close.** Primary integration finalized migrations `000046`/`000047`, advanced the next migration ID to `000048_release_followup`, extracted cohesive email/campaign contracts so `contracts.ts` remains at 695 lines, preserved direct-import parser compatibility, repaired the four new workflow permissions with least-privilege persona policy, and reconciled all deterministic FUMA-020 fixtures without weakening production authorization.

Final batch validation:

- FUMA-020 permission reconciliation: **18 pass, 0 fail, 777 assertions**.
- Studio node and app TypeScript checks passed; scoped and aggregate lint passed.
- Aggregate tests: Studio/root **7,459 pass, 13 optional skips, 0 fail**; Web **72 pass**; Control **4 pass**; Governance **51 pass**. Total: **7,586 pass, 13 optional skips, 0 fail**. The batch-related skip remains FUMA-041 Linux amd64.
- Aggregate production build passed for all packages, Studio, Web, and Control. Web retained 31 generated pages/routes and the 152,821 B gzip acquisition-route budget.
- `git diff --check` and frozen install passed. The sole workspace root `bun.lock` remains SHA-256 `e9688c20f69e32aa0df7cea681b5c4971ef5a7d272d3e644bc96486384c4c1b9`; no nested workspace lockfile was introduced (the tracked vendored Pixelarticons lock remains the approved exception).
- Source-computed checksums for migrations `000046` and `000047` exactly match their immutable registry entries; the complete hosted migration manifest passes and the next ID is `000048_release_followup`.
- No prohibited Docker/buildx/QEMU/email-matrix process remained. No production migration/deployment, GHCR publication, DNS/TLS mutation, purchase, signing, secret operation, commit, push, or irreversible external action occurred.

After closing FUMA-035 and FUMA-039, **52 implementation/acceptance tracker items remain open**. Unified launch remains **ABORT / unsigned / non-promotable**.

## Coding batch 6 follow-up — 2026-07-27

This follow-up supersedes the earlier FUMA-036 and FUMA-043 keep-open decisions. Exactly four complete-ticket/phase agents ran in parallel for FUMA-036, FUMA-043, the bounded FUMA-041 continuation, and the bounded FUMA-078 continuation. Primary integration mounted the new Publication services, routes, worker, and startup recovery; finalized two additive migrations only after live PostgreSQL acceptance; and did not run the explicitly prohibited Docker, buildx, QEMU, emulation, publication, signing, or scan workloads.

- **Task 27 / FUMA-036 — Close.** Absolute-instant publishing and scheduled unpublishing, IANA timezone display, lease/fence-qualified due claims, idempotent completion, stale supersession, late execution, bounded missed-schedule recovery, authority-free durable job payloads, digest-only preview tokens, private redaction, and FUMA-039/FUMA-034-backed public/member/paid/segment resolution are implemented. The central Publication graph exposes the scheduling and public-access boundaries, central workers register `publication.schedule-due`, and hosted startup runs trusted database-derived recovery. Focused tests explicitly prove DST/non-DST formatting, restart recovery with duplicate schedulers applying once, late unpublish, token revocation/expiry, private non-leakage, and deterministic public/member/segment serving without cross-audience reuse. Additive migration `000048_publication_scheduling_access` passed live PostgreSQL repository acceptance and is finalized at `91166384501f41690876ada85ddb06b8ea5c842ce1f469e72e3a80414862ecf3`. Closure is limited to the ticket-owned scheduler and preview/public resolver authority: it does **not** claim that `FreeHostPublicRouter` dynamically gates immutable artifacts; FUMA-051 owns that later edge-hole/cache composition.
- **Task 32 / FUMA-043 — Close.** Platform → organization → workspace → site → newsletter inheritance, immutable current-head version chains, explicit override provenance, reset-to-inherited behavior, required-field completeness, strict typed variable namespaces, mode-specific authorization, unknown/missing/secret/type/scope denial, personal/secret diagnostic redaction, exact site/owner-generation/profile authority, bounded central routes, and an accessible CSS Modules Studio contribution are implemented. Matrix tests cover every level and all required denial cases; the deterministic demo resolves one sender/theme override per level and exposes final provenance without secrets. Additive migration `000049_email_settings_versions` passed live production-repository JSONB append/current-head acceptance and is finalized at `e3280afa67913e9132a1e4ddabff1f77db3ad95c63223cdabc65db4abe7ad8b7`. The standalone `EmailSettingsSurface` uses Studio's app-local `Button` primitive and passes accessibility/architecture gates, but this closure does **not** claim it replaces the legacy `PublicationWorkspace` settings panel; newsletter composer composition remains FUMA-044's owned seam.
- **Combined live PostgreSQL acceptance.** Existing PostgreSQL on port 5433 was used only through a disposable schema. Both migrations installed; schedule constraints, digest-only token storage, immutable email versions, trusted active-scope discovery, fenced claim/completion, and production email JSONB persistence/current-head reads passed **1 test, 10 assertions**. Cleanup ran in `finally`; final `pg_namespace` verification found **0** `fuma_schedule_email_%` schemas.
- **FUMA-041 — not closed.** Native receipt validation, exact package/lock/integrity/API/CLI checks, per-file and aggregate hashes, target/host equality, atomic receipt creation, native-only matrix deadlines, exact test-count verification, and native GitHub runner contracts now pass **21 tests, 467 assertions**, with the real Linux amd64 matrix remaining the one explicit skip. No amd64 result was fabricated. The bounded unblock command remains `FUMA_EMAIL_RECEIPT_PATH=.tmp/fuma-email-compatibility-linux-amd64.json timeout 21m bun run apps/studio/scripts/fuma-email-compatibility-matrix.ts amd64` on a real native Linux x64 host; Docker/QEMU is not authorized.
- **Task 75 / FUMA-078 — Keep open.** Paired manifest schema v3, OCI index binding, published-digest Trivy receipts, published-image SPDX receipts, BuildKit SLSA provenance, Cosign verification JSON, exact paired smoke evidence, rollback-safe non-promoting plans, full retained-evidence verification, and atomic create-only publication semantics pass **52 governance tests, 295 assertions** and package typecheck. No real protected image build/publication, scan, SBOM/provenance, signing, or paired runtime smoke evidence was executed, so the ticket remains non-promotable.
- **Task 95 / coding batch 6 coordination — Close.** Exactly four parallel complete-ticket/phase agents were used. Primary integration corrected Bun/PostgreSQL JSONB casting, repaired schedule scope discovery against the real `fuma_sites` authority shape, registered central routes/jobs/recovery, reconciled the new surface with Studio's required Button primitive, and retained explicit boundaries instead of over-claiming free-host or composer integration.

Final batch validation:

- Combined FUMA-036/FUMA-043 focused, architecture, module-size, and cycle gate: **67 pass, 0 fail, 319 assertions**; live PostgreSQL acceptance separately passed **1/1**, 10 assertions.
- FUMA-041/FUMA-042 focused gate: **21 pass, 1 explicit Linux amd64 skip, 0 fail, 467 assertions**.
- Governance package: **52 pass, 0 fail, 295 assertions**; typecheck passed.
- The first authoritative aggregate identified one valid BTN-3 violation in the standalone FUMA-043 surface. It was corrected by adopting Studio's existing app-local `Button` primitive and narrowing a contradictory candidate test that had incorrectly treated app-local `@ui` as a forbidden shared UI package. The focused Button/FUMA-043 architecture rerun passed **7/7**, 56 assertions; app typecheck and scoped lint passed.
- Final aggregate tests: Studio/root **7,517 pass, 14 optional/blocker skips, 0 fail**; Web **72 pass**; Control **4 pass**; Governance **52 pass**. Total: **7,645 pass, 14 skips, 0 fail**.
- Aggregate production build passed for all packages, Studio, Web, and Control; aggregate lint passed; frozen install passed.
- `git diff --check` passed. Root `bun.lock` remained byte-stable at SHA-256 `e9688c20f69e32aa0df7cea681b5c4971ef5a7d272d3e644bc96486384c4c1b9`; the only second lock is the approved tracked `vendor/pixel-art-icons/bun.lock` exception.
- Source-computed migration checksums exactly match finalized registry values for `000048` and `000049`; the next migration ID is `000050_release_followup`.
- No prohibited Docker/buildx/QEMU/email-matrix process remained. No production deployment, GHCR publication, DNS/TLS mutation, purchase, signing, secret operation, commit, push, or irreversible external action occurred.

After closing FUMA-036 and FUMA-043, **50 implementation/acceptance tracker items remain open**. Unified launch remains **ABORT / unsigned / non-promotable**.

## Coding batch 7 follow-up — 2026-07-27

This follow-up closes FUMA-037, FUMA-040, and FUMA-044 after dependency-ordered implementation, central composition, live PostgreSQL acceptance, and authoritative aggregate validation. Exactly four complete-ticket/phase agents ran in parallel for those three tickets and the bounded FUMA-041 continuation. Primary integration preserved exact host and tenant authority, tightened the original paid-loop implementation to exact publication/post/tag grants, and did not run Docker, buildx, QEMU, emulation, protected publication, signing, scans, deployment, or production/external operations.

- **Task 28 / FUMA-037 — Close.** Reusable post/page/author/tag/date/collection templates, bounded dynamic loops, canonical archives/pagination, explicit empty states, trusted public audience derivation, exact active owner-generation/profile fences, and one-statement batched author/tag projection are implemented. Dynamic routes are centrally composed, the Design workspace mounts the app-local CSS Modules editor, and host-authorized extensions execute only after exact active free-host authority. Paid visibility requires a current FUMA-039 member grant for the exact publication, post, or tag; a generic paid flag cannot broaden access. The query uses dialect-aware `jsonField()` extraction, positional `placeholder()` binding, and one `db.unsafe()` statement without raw repository JSON operators or N+1 calls. Additive migration `000050_dynamic_publication_templates` passed production-repository PostgreSQL acceptance and is finalized at `3e3b3c2fe969eddca1063f62a63ada426949623a8110ca23caa5483b1ee1c34b`.
- **Task 31 / FUMA-040 — Close.** Strict minimized analytics contracts, privacy policy, exact-scope repository/service/routes, public host boundary, retention jobs, dashboard/client, and deterministic reporting are implemented. The public boundary accepts only its owned POST route after exact host resolution, derives consent from `__Host-fuma_analytics_consent`, derives GPC/DNT/bot state from trusted request headers, accepts no caller tenant authority, and stores only permitted aggregate dimensions. The central Publication graph and durable handler map mount the feature while preserving older isolated fixtures. Additive migration `000051_publication_privacy_analytics` passed idempotent append, stable report, minimization, and retention-purge PostgreSQL acceptance and is finalized at `a6deae4ed574da8ec0065f92883bcf2a77738d011d2a93b15a8e41a21fbb208e`.
- **Task 33 / FUMA-044 — Close.** Exact-scope newsletter profiles, audience selection, inherited FUMA-043 settings, composer drafts with compare-and-swap, immutable receipts, bounded routes, app-local client/workspace, accessible CSS Modules surface, and deterministic segmented composition are implemented. The Newsletters workspace mounts the new composer while retaining legacy campaign/deliverability capabilities owned by later tickets. Newsletter-level email settings now recognize both the new exact-scope composer table and upgraded legacy newsletter table with complete ancestry. Additive migration `000052_publication_newsletter_composer` passed production PostgreSQL profile/draft CAS, receipt immutability, sender verification, and hierarchical-settings integration and is finalized at `8df028670e3e18fc6bc165805bb0793e1dc2ce13253fc729fb666e3fad15cd61`.
- **Combined live PostgreSQL acceptance.** Existing PostgreSQL on port 5433 was used only through disposable schemas. FUMA-037/FUMA-040 passed **1 test, 9 assertions** for JSON persistence, active-target uniqueness, dynamic reads, minimized/idempotent aggregates, stable reports, and retention purge. FUMA-043/FUMA-044 passed **1 test, 10 assertions** for composer CAS, immutable receipts, sender verification, and exact newsletter-level inheritance across the upgrade fixture. Cleanup ran in `finally`; final schema verification found **0** `fuma_dynamic_analytics_%` or `fuma_newsletter_%` schemas.
- **FUMA-041 — not closed.** The bounded continuation found and repaired a replay weakness: native receipts now bind every counted test file, renderer source, contract, and `DECISION.md`, and changed-source receipts are rejected. The focused FUMA-041/FUMA-042 gate passes **21 tests, 1 explicit Linux amd64 skip, 0 failures, 470 assertions**. The unresolved acceptance requirement remains real native Linux amd64 execution; no x64 result was fabricated and Docker/QEMU remains unauthorized.
- **Task 96 / coding batch 7 coordination — Close.** Exactly four parallel complete-ticket/phase agents were used. Primary integration mounted all three service graphs, scoped routes, retention jobs, public-host boundaries, and Studio surfaces; added trusted member audience derivation; corrected per-resource premium authorization; finalized migrations only after live acceptance; and repaired the two deterministic aggregate issues without weakening architecture gates.

Final batch validation:

- Integrated FUMA-037/FUMA-040/FUMA-044 behavior, UI, architecture, and demo gate passed **45 tests, 0 failures, 279 assertions**; central Publication/free-host/migration regression passed **39 tests, 0 failures, 1,111 assertions**; free-host regression passed **9 tests, 0 failures, 844 assertions**.
- The first authoritative aggregate exposed three older isolated job-handler fixtures that omitted the newly integrated analytics graph and ten forbidden raw PostgreSQL JSON extraction operators. The handler merge now safely defaults only for isolated legacy fixtures while production always supplies analytics. The dynamic loop query was rewritten through approved `jsonField()` fragments and positional placeholders; the JSON egress gate passes **3/3**, and the complete repair gate passes **20/20**, 140 assertions. Live PostgreSQL revalidation of the rewritten query passes **1/1**, 9 assertions.
- Studio node and app typechecks passed; focused and full lint passed. The hosted migration manifest/release test passed.
- Final aggregate tests: Studio/root **7,556 pass, 16 optional/blocker skips, 0 fail, 149,530 assertions**; Web **72 pass**; Control **4 pass**; Governance **52 pass**. Total: **7,684 pass, 16 skips, 0 fail**.
- Aggregate production build passed for all packages, Studio, Web, and Control; frozen install passed; `git diff --check` passed.
- Root `bun.lock` remains byte-stable at SHA-256 `e9688c20f69e32aa0df7cea681b5c4971ef5a7d272d3e644bc96486384c4c1b9`; the only second lock is the approved tracked `vendor/pixel-art-icons/bun.lock` exception.
- Source-computed checksums for all **52** hosted migrations exactly match the immutable registry; the final migration is `000052_publication_newsletter_composer`, and the next migration ID is `000053_release_followup`.
- No prohibited or stale buildx/QEMU/Playwright/Vite/Next/test/build/lint process remained. No production deployment, GHCR publication, DNS/TLS mutation, purchase, signing, secret operation, commit, push, or irreversible external action occurred during validation.

After closing FUMA-037, FUMA-040, and FUMA-044, **47 implementation/acceptance tracker items remain open**. FUMA-041 and task 75/FUMA-078 remain externally blocked. Unified launch remains **ABORT / unsigned / non-promotable**.

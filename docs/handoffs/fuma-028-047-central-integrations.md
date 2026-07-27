# FUMA-028–047 central integration handoff

Status: **authored complete; validation intentionally not run**.

## Completed registrations

1. **Hosted migrations:** additive migrations `000013`–`000020` are imported in numeric order after `000012_editor_draft_sequences` in `apps/studio/server/fuma/db/migrations/index.ts`. Their finalized checksums are registered unchanged.
2. **Shared barrels:** core and admin Fuma barrels export Publication contracts and Studio composition.
3. **Single scoped boundary:** `createHostedFumaScopedApi` appends Publication declarations to editor declarations in one `createBoundary` call. It still returns before constructing hosted dependencies when hosted auth is absent.
4. **Live hosted graph:** `server/fuma/publication/runtime.ts` composes PostgreSQL storage, Redis coordination/rate limits, durable job enqueueing, cryptographic IDs/SHA-256, OCI Email Delivery with Signature v1, approved-sender enforcement, signed unsubscribe links, and lifecycle closure.
5. **Durable handlers:** strict TypeBox handlers for `publication.publish-due` and `publication.newsletter-send` bind current owner generation and `jobContext.profile.id`, validate exact workflow version/snapshot checksum, and use durable effect receipts. The production worker role mounts `durable-job-worker`; the production scheduler role mounts `durable-job-scheduler`, while local role-control composition remains unchanged. PostgreSQL job authority reloads active server-owned site authority from persisted job selectors, never payload tenancy.
6. **Studio route content:** `PublicationRouteContent` resolves active route/capability contributions and exact permission decisions without profile-ID branches. Publication owns posts, tags, members, newsletters, analytics, and Publication settings; existing shared editor ownership remains for pages/design. Scoped list APIs provide loading/error/empty states and tag authoring.
7. **Public endpoints:** the central router injects `/_fuma/publication/unsubscribe` and `/_fuma/publication/oci-events` before CMS/published fallbacks. The boundary verifies signed tokens or raw provider-event signatures, derives event scope from server-owned provider message records, applies Redis fail-closed limits, and returns non-oracular unsubscribe envelopes. The authenticated scoped unsubscribe proof is not reused as the public route.
8. **Config:** strict TypeBox configuration now requires OCI compartment authority, provider-event verification authority, and Publication unsubscribe signing authority in production. Config summaries omit these values.
9. **Catalogs:** docs index, architecture-test catalog, and E2E feature matrix include the Publication phase. Browser URLs remain exclusively `https://5174.blyss.co.ke` and `https://3002.blyss.co.ke`.

## Preserved boundaries

- FUMA-027 and migrations `000001`–`000012` were not rewritten.
- FUMA-041/042 remain the pinned React Email compatibility and data-only `EmailDocument` renderer. No tenant JSX, JavaScript, raw HTML, arbitrary component loading, or dynamic code loading was introduced.
- TypeBox is the only boundary schema system; no Zod, SMTP, alternate provider, caller tenant authority, or profile-ID branch was introduced.
- Every Publication PostgreSQL operation remains owner-key, generation, profile, and full ancestry qualified with active transfer-free authority refresh.

## Validation record

No tests, typecheck, build, lint, Playwright, Docker, diagnostics, migration runner, Graphify CLI, or other validation command was executed because the phase instruction explicitly prohibited running anything. Authored tests and architecture gates therefore represent code coverage intent, not executed evidence.

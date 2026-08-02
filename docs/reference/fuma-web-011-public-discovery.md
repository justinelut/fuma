# FUMA-WEB-011 public discovery projections

Status: **implemented; ticket-owner validation pending aggregate conductor review**.

FUMA-WEB-011 projects four moderation-sensitive public datasets—experts, showcases, reviewed plugins, and reviewed component packs—through the existing private public-projection boundary. It creates no marketplace, review/signing, ranking, inquiry, moderation, cache, identity, installation, transfer, or public API authority.

## Canonical authority reuse

- `ApprovedExpertsProjectionSource` and `ApprovedShowcasesProjectionSource` synchronously read FUMA-073 expert releases and profiles. Eligibility requires an approved non-withdrawn release, current independent expert and site-owner attribution consents, explicit opt-in, available status, no profile or current FUMA-072 suspension, an active customer organization, and the exact current tenant owner generation with no transfer ID, lock, or fence.
- Expert ranking remains FUMA-073-owned: available first, then current public revision, then stable expert identity. FUMA-WEB-011 adds only bounded public filter/search/pagination over that approved order.
- Showcase records exist only inside the approved expert display document and require reciprocal expert/showcase public-ID attribution. Ambiguous duplicate showcase identities fail the complete projection closed.
- `ApprovedReviewedArtifactsProjectionSource` reads only the current clean, signed, non-revoked FUMA-068 decision for an exact immutable FUMA-067 plugin or component-pack release. The current unique active publisher organization must match review-bound public metadata. Current FUMA-072 package suspension removes the release.
- Plugin and component-pack projections are separate resources and retain the literal `artifactKind` distinction. Private SITE-008 releases/drafts/source, installations, usage, tenant scope, and AI/MCP state are never selected.

All four adapters return content-addressed dataset versions and dataset-bound cursors through the existing `paginatePublicDiscovery` helper. Public records use strict TypeBox schemas from `@fuma/public-contracts`; unknown fields fail closed.

## Immediate invalidation and tombstones

The four resources have `cacheTtlMs: 0` and `cache-control: no-store` in Studio and Web. Every list, search, exact-slug detail read, and dynamic discovery sitemap therefore re-reads current canonical authority; Web has no retained or editorial fallback.

FUMA-073 visibility/moderation/transfer operations and FUMA-068 approve/revoke operations already publish the canonical PostgreSQL `fuma_public_projection` notification. FUMA-WEB-011 does not create a second event or cache authority. Projection removal is synchronous and does not depend on notification delivery: opt-out, unavailable state, suspension, consent revocation, release withdrawal, transfer fencing, publisher loss, or review revocation is excluded by the next SQL read. The notification remains the advisory edge/HTML purge signal.

Exact detail pages call `readPublicItem(resource, slug)`, which sends an authority-filtered `slug` plus `limit=1`; they never scan a retained list. An absent record calls Next `notFound()`, returning the generic 404/noindex tombstone. `app/sitemap.ts` is dynamic and bounded, so the next discovery sitemap regeneration omits the same record.

## Public Web routes

```text
/experts                 /experts/:slug
/showcase                /showcase/:slug
/plugins                 /plugins/:slug
/components              /components/:slug
/api/public/v1/:resource
```

Browse routes accept only bounded contract-compatible filters, search text, and cursors. Expert inquiry presentation transfers only the stable public expert ID to the existing mediated contact/handoff paths; no recipient enters HTML or RSC data. Plugin pages disclose public permission labels and review evidence but cannot install. Component pages explicitly distinguish client-side component packs from backend plugins and cannot install, execute, or reveal source.

The same-origin BFF constructs private requests from scratch with only its service token, fixed audience, and request ID. Visitor cookies and authorization are discarded. Successful discovery responses, 304 responses, safe errors, page rendering, detail reads, and sitemap generation do not enable stale fallback.

## Excluded data

Strict contracts and focused hostile tests reject email/recipient data, member or paid state, organization/workspace/site/owner coordinates, internal database IDs, submitter/reviewer identities, inquiry content, transfer state, payment state, private offers, provider data, COGS/margins, credentials, source code, installation/usage state, and arbitrary extra fields.

## Focused validation

Ticket-owned validation commands are:

```sh
bun test apps/studio/server/fuma/publicProjections/registeredAuthorities.test.ts \
  apps/studio/server/fuma/publicProjections/boundary.test.ts \
  apps/studio/server/fuma/publicProjections/adapters/validatedDomainAdapter.test.ts

cd apps/web
bun test tests/fuma-web-011-discovery.test.ts tests/public-projection-bff.test.ts \
  tests/public-web-authority.test.ts tests/public-web-seo.test.ts
bun run typecheck
bun run lint
bun run build
E2E_PUBLIC_BASE_URL=https://3002.blyss.co.ke \
  bunx playwright test e2e/fuma-web-011-discovery.e2e.ts --config playwright.config.ts
```

Browser acceptance is valid only through `https://3002.blyss.co.ke`. A loopback request may establish process liveness but is not browser, routing, hydration, TLS, proxy, or public-host evidence. FUMA-WEB-011 adds no migration, does not edit migration ordering, uses PostgreSQL only, and adds no dependency or lockfile change.

## 2026-07-31 ticket validation

- Focused Studio projection/adapter tests: **16 passed, 0 failed, 111 assertions**.
- Focused Web discovery/BFF/authority/SEO tests: **32 passed, 0 failed, 260 assertions**.
- Focused public-projection/pricing architecture tests: **16 passed, 0 failed, 43 assertions**.
- Public-contract TypeScript, ticket-scoped Studio production TypeScript, complete Web typecheck, complete Web ESLint, and the Web production build passed. The build emitted **38 pages**, including dynamic `/components`, `/components/[slug]`, `/experts`, `/showcase`, `/plugins`, their detail routes, the private BFF, and the dynamic discovery sitemap; acquisition bundles remained **153,171 B gzip JavaScript, 0 B images, 0 B fonts**.
- Focused Chromium Playwright through only `https://3002.blyss.co.ke`: **1 passed**. It exercised successful expert/showcase/plugin/component searches and detail pages, distinct plugin/component evidence, BFF `no-store` and no-cookie responses, forbidden-field absence, 320 px no-overflow, and the withdrawn expert 404/noindex tombstone.
- Native architecture was `aarch64`; no Docker, buildx, QEMU, emulation, SQLite, migration edit, provider call, protected signing, deployment, commit, or push occurred. Both ticket-owned acceptance processes were stopped and ports 3002/3991 were released.
- The complete Studio server typecheck remains an aggregate-wave blocker outside this ticket: diagnostics are currently confined to parallel FUMA-087/FUMA-088 `aiCapabilityDashboard` files and pre-existing/open `nextSource/projection.ts`. The ticket-scoped Studio production graph passes strict TypeScript independently.

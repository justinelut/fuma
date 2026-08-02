# WEB-DESIGN-019 — Component-pack detail redesign

## Result

Replaced the `/component-packs/[slug]` redirect with a complete authority-backed component-pack release dossier. The approved state now presents one coherent pack release through its exact identity, published classification, permission boundary, four cryptographic review bindings, review classifications, and a deliberately non-installing handoff. Missing, malformed, withdrawn, revoked, or otherwise unavailable records still fail closed through the shared noindexed 404.

The legacy route remains a canonical alias of `/components/[slug]`; it does not create a second catalog, retain a second record, or compete as a second indexed URL.

## Changed files

- `apps/web/app/component-packs/[slug]/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-019.md`

No shared component, global style, public contract, authority implementation, test, generated asset, dependency, lockfile, tracker, index route, canonical `/components/[slug]` route, or other file was edited.

## Design direction

- **Subject:** one current reviewed component-pack release inside the closed Fuma product.
- **Audience:** builders evaluating a reusable presentation pack who need exact release evidence and authority boundaries, not a promotional marketplace card.
- **Page job:** make it possible to understand what public authority exists for this exact pack release before entering authenticated Fuma.
- **Signature:** a **coherent-pack release binding**. The page keeps publisher, exact version, content digest, permission labels, signature key, signed-payload digest, and provenance digest on one continuous record. It reads as a pack-level case file, not as a detail page for one invented component.
- **Information architecture:** canonical breadcrumb and current signed-review thesis → exact release coordinate → coherent pack binding → published classification → permission and execution boundary → four-part review evidence → stable public-ID handoff.
- **Typography:** inherited Fuma display, body, and mono roles. Display type carries the release thesis; mono is reserved for coordinates, hashes, version, IDs, and evidence labels.
- **Layout:** restrained asymmetric dossier grids, ruled definition lists, one shared rim-lit release binding, and full-width section rhythm. It introduces no parallel design system.
- **Palette/effects:** semantic global roles only: background, card, border, line, muted foreground, live state, and existing shared `fuma-pool`/`fuma-rimlit` treatments. The route adds no raw color, local gradient, shadow, glow, or inline effect.
- **Aesthetic risk:** the long evidence values remain visible at full fidelity and form the visual spine rather than being hidden behind disclosure controls or reduced to badges. This is specific to a signed multi-component pack release and avoids generic marketplace-card or broadsheet styling.
- **Self-critique applied:** an early generic “artifact facts” direction would have been nearly interchangeable with the plugin detail. The final composition instead centers release coherence and explicit client-side pack limitations; permission evidence remains present but does not become the page’s entire identity.
- **Closed positioning:** Fuma is the owned product, review boundary, authenticated catalog, and installation authority. No self-hosting, open-source, deployment, infrastructure, database-ownership, alternate-platform, or licensing-tier language was added.

## Authority and content integrity

Every record-specific value comes from the strict current `PublicComponent` projection returned by the exact authority-filtered `readPublicItem('components', slug)` read:

- stable public ID and exact projected slug;
- literal component-pack artifact kind;
- authority name and summary;
- exact version;
- verified publisher name;
- review timestamp;
- public categories and the authoritative empty-category state;
- public permission labels and the authoritative zero-label state;
- content SHA-256, signature key ID, signed-payload SHA-256, and provenance SHA-256;
- SPDX licence, accessibility review classification, and minimum runtime version.

The page does **not** invent or infer pack contents, component names, component count, variants, typed parameters, slots, preview media, screenshots, source, repository, dependencies, compatibility beyond the published minimum runtime, install count, usage, tenants, customers, score, ranking, rating, review prose, testimonial, reviewer identity, findings, or endorsement. `imageUrl` is intentionally not rendered because the public contract supplies no associated alt-text authority; no placeholder art or fabricated pack preview is substituted.

Generic execution-boundary copy is grounded in the closed artifact authority: component packs cannot own backend workers, schedules, or secrets. The route does not imply that an empty permission-label array bypasses review, release, revocation, or installation checks.

## Approved and unavailable states

### Current approved record

- One authority-derived H1 anchors the complete pack dossier.
- Release identity, categories, permissions, hashes, classifications, and stable public ID remain visibly attached to the same exact release.
- Empty category and permission arrays receive explicit semantic `role="status"` states instead of blank regions, inferred defaults, or stale substitutes.
- Long IDs and hashes remain untruncated and wrap safely.

### Missing, malformed, withdrawn, revoked, or authority-unavailable record

- Metadata performs the exact same current authority-filtered read as rendering.
- Missing metadata is generic, `noindex, nofollow`, and canonicalized to `/components`; it does not echo an unvalidated slug or disclose whether a prior record existed.
- Rendering calls `notFound()` for every absent/non-current result, preserving a real 404 response through the shared noindexed missing page.
- No dossier body or artifact JSON-LD is emitted after authority removal.
- Web retains no stale fallback and never scans a cached list for a matching slug.
- A route-local custom tombstone would require a third owned file and could create divergent disclosure behavior. The implementation therefore preserves the existing indistinguishable global missing boundary rather than returning a designed `200` substitute.

## Exact slug, canonical identity, SEO, and schema

- Route remains `dynamic = 'force-dynamic'`.
- Both metadata and rendering call `readPublicItem('components', slug)`, which validates the bounded slug, requests authority filtering with `slug` plus `limit=1`, and requires exact returned-slug equality.
- Approved metadata uses the projected `item.slug` and canonical `/components/${item.slug}` identity. The `/component-packs/[slug]` path is an alternate entrance to the same record, not a second indexed catalog.
- Approved breadcrumbs likewise resolve to `/components` and `/components/${item.slug}`.
- The page emits only the repository’s validated `BreadcrumbList` JSON-LD through `breadcrumbStructuredData(...)` and the safe `jsonLd(...)` serializer.
- It intentionally does not fabricate Product, SoftwareApplication, offer, rating, review, aggregate-rating, or component-inventory schema because no approved public schema authority exists for those claims.
- Missing authority retains generic noindex metadata and the shared noindexed 404.

## Permissions and stable handoff

Permission labels remain release-specific evidence. A non-empty array is rendered as a semantic list exactly as projected. A zero-length array is described only as “no permission labels are published for this exact release”; it is not treated as a review waiver or universal statement about every component pack.

The stable projected public ID is visible in the release identity and handoff sections. The public page cannot install a pack or select an active site. `PublicHandoffRequestSchema` currently defines no component-pack source, no install-component kind, and no component/pack ID field. The route therefore uses only the existing bounded `/start?kind=sign_in&source=product` intent and explicitly states that it carries no pack ID, version, grant, tenant coordinate, site scope, or install command.

This is deliberately fail-closed: authenticated Fuma selects site scope and independently re-resolves the current reviewed catalog authority before any installation decision. The route does not misuse the plugin source or smuggle unsupported fields into the query. A true version-bound component-pack install handoff would require a separately reviewed contract and authority change outside this ticket.

## Accessibility and semantics

- One H1 establishes the pack record; H2/H3 order follows the dossier hierarchy.
- Every major section has an explicit accessible heading relationship; the release identity is a labelled `aside`.
- Identity, evidence, execution limits, classifications, and handoff responsibilities use definition lists; categories and permissions use semantic lists.
- Review time uses `<time dateTime={item.reviewedAt}>` and deterministic `en-KE` UTC formatting.
- Long public IDs and evidence values use wrapping mono text without horizontal-scroll dependence at 320 px.
- Permission and category empty states announce with `role="status"`.
- The authority-derived permission count includes screen-reader context.
- The release CTA targets one unique in-page section ID, and the canonical directory action is explicit.
- Shared focus-visible, forced-color, and reduced-motion behavior remains inherited. The route adds no client island, custom focus treatment, autoplay, hidden hydration content, or interaction dependency.

## Security and privacy

- The route reads only the strict PII-free public projection and imports no Studio/server authority.
- No visitor cookie, authorization, tenant coordinate, owner identity, private source, install state, or usage datum is rendered or forwarded.
- No authority values are inserted into raw HTML. The only `dangerouslySetInnerHTML` use is the established safe JSON-LD serializer over a schema-validated breadcrumb object.
- Missing records reveal no previous name, publisher, version, category, permission, evidence, or moderation/revocation history.
- The handoff adds no public install authority and carries no item-specific query parameter.

## Focused validation evidence

Validation followed the ticket restriction: route diagnostics, route-scoped ESLint, route whitespace validation, and source audits only. No test suite, full typecheck, full lint, build, server, browser/E2E run, or snapshot was executed.

- Language-service diagnostics for `apps/web/app/component-packs/[slug]/page.tsx` — **PASS**, `No diagnostics` after the final accessible-heading correction.
- `bunx eslint 'app/component-packs/[slug]/page.tsx'` from `apps/web` — **PASS**, exit status 0 with no output.
- Direct trailing-whitespace and final-newline audit over both assigned files — **PASS**, exit status 0 with `Whitespace and final-newline audit: PASS`. The paths are untracked in the shared worktree, so this direct check avoids presenting a no-op `git diff --check` as evidence.
- Forbidden-style/private-data/positioning audit — **PASS**, zero matches for raw hex; `rgb`/`rgba`; `hsl`/`hsla`; `oklch`; inline styles; arbitrary shadows; local white/black palette utilities; gradients; fabricated social-proof schema keys; private authority coordinates/identities; and self-host/open-source/infrastructure/deployment/database language.
- Authority/SEO source audit — **PASS**, 22 required marker matches confirmed both exact `readPublicItem('components', slug)` reads, `force-dynamic`, `notFound()`, approved canonical projected slugs, generic missing metadata, all four cryptographic evidence fields, permission labels and statuses, stable public ID, schema-validated breadcrumbs, safe JSON-LD, and the bounded `source=product` handoff.

## Acceptance boundary

Per ticket scope, no server, browser, E2E process, or screenshot was started. This handoff does not claim Blyss HTTPS visual, responsive, routing, hydration, TLS, proxy, runtime accessibility, or browser acceptance. Any later browser acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.

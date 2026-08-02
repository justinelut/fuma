# WEB-DESIGN-017 — Component detail redesign

## Result

Redesigned `/components/[slug]` as a reviewed component-release folio rather than a generic detail card. The current state now keeps artifact identity, exact release coordinate, published categories, declared permission labels, full signature/provenance evidence, review classifications, and the bounded Fuma handoff in one continuous record. Missing, withdrawn, revoked, malformed, or otherwise unavailable authority continues to fail closed through the generic noindexed 404 path.

## Changed files

- `apps/web/app/components/[slug]/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-017.md`

No shared component, global style, public contract, test, generated asset, lockfile, tracker, index route, or other file was edited for this ticket.

## Design direction

- **Page job:** let a builder establish exactly which current component-pack release they are reviewing, inspect the authority attached to it, and understand what the public-to-Fuma transition does not carry.
- **Audience:** Fuma builders evaluating reusable presentation releases through exact evidence rather than popularity, promotional framing, or implied product controls.
- **Signature:** a continuous **release coordinate folio**. The stable public ID and exact version form a prominent, wrapping coordinate that recurs at the bounded handoff. Human-readable identity remains beside it, while permission and evidence ledgers stay bound to the same release.
- **Information architecture:** current-review thesis and canonical breadcrumb → artifact identity rail → exact release coordinate and public scope → declared permission state → byte-bound review evidence → bounded identity-only Fuma handoff.
- **Visual system:** the route inherits Fuma’s approved display/body/mono roles, measured display scale, section rhythm, semantic line and surface roles, signal interaction role, and live-state role. It introduces no raw color, local effect, gradient, shadow, glow, inline style, or fabricated product UI.
- **Aesthetic risk and restraint:** the long, authority-derived release coordinate is the sole expressive element. No image is rendered because the projection does not provide public alt-text authority; no placeholder artwork or interface mockup substitutes for it.
- **Closed positioning:** Fuma remains the owner and installation authority. The route adds no self-hosting, open-source, deployment, infrastructure, database-ownership, or alternate-platform positioning.

The mandated `frontend-design` skill was applied after reviewing the measured Fuma reference, homepage composition, global token roles, the current component index/detail routes, analogous template/plugin/showcase detail records, public projection tests, handoff contract, and adjacent design handoffs. The initial generic-card direction was rejected because it could fit any marketplace artifact. The revised release-coordinate folio is specific to the component pack’s core decision: reusable presentation must still resolve to one exact reviewed payload.

## Authority and content integrity

Every release-specific value comes from the strict current `PublicComponent` projection returned by `readPublicItem('components', slug)`:

- stable public ID, exact slug, artifact kind, name, summary, categories, exact version, verified publisher, and review timestamp;
- the complete published permission-label array, including an explicit authoritative zero-label state;
- content SHA-256, signature key ID, signed-payload SHA-256, and provenance SHA-256;
- SPDX licence value, accessibility standard, and minimum runtime version.

The route does not invent component counts, parameter schemas, slots, variants, screenshots, package coordinates, source links, reviewer identities, findings, scores, installs, usage, tenants, ratings, testimonials, rankings, prices, endorsements, or compatibility guarantees. Review evidence is described as metadata, not endorsement. Private source and private authority coordinates remain absent.

## Current and unavailable states

### Current reviewed release

- The authority-backed H1, summary, kind, publisher, version, stable ID, timestamp, categories, permissions, and evidence render as one semantic record.
- Permission labels are shown verbatim when present. A zero-length array renders a complete `role="status"` state and is not described as a grant, missing field, or general guarantee about every component pack.
- Empty categories render an explicit authoritative absence instead of stale tags or filler.
- Long identifiers and hashes wrap at narrow widths rather than requiring horizontal scrolling.

### Missing, withdrawn, revoked, malformed, or unavailable release

- Metadata performs the same exact authority-filtered `readPublicItem('components', slug)` read and passes `!item` to `publicMetadata`, preserving noindex/nofollow on absence.
- Rendering performs the same exact-slug read and calls `notFound()` for every absent/non-current result.
- No release body or artifact schema is emitted after authority removal. The generic unavailable copy does not reveal whether absence came from withdrawal, revocation, malformed data, invalid slug, or authority failure.
- The route retains no stale fallback and never list-scans for a matching slug.

## SEO, schema, and canonical identity

- The route remains `dynamic = 'force-dynamic'`.
- Current metadata remains projection-derived and canonical at the exact requested `/components/${slug}` path.
- Current breadcrumbs use the exact projected `item.slug` and now emit only shared, schema-validated `BreadcrumbList` JSON-LD through `breadcrumbStructuredData(...)` and the safe `jsonLd(...)` serializer.
- Product, SoftwareApplication, offer, review, rating, and testimonial schema are intentionally absent because no approved component-specific structured-data authority exists.
- Missing authority retains noindex metadata and the global noindexed 404 representation.

## Permission and handoff boundary

The page treats `permissionLabels` as release metadata rather than inferred capability. It does not repeat the component index’s broad claim that packs require no grants; instead it reports only the exact array supplied for this release. The public page cannot grant authority.

The stable public ID and exact version remain visible as `{id}@{version}` at both the release record and handoff. The public contract has no `component` handoff source, component-install intent, or `componentId` handoff field. The route therefore uses the existing bounded identity request `/start?kind=sign_in&source=product` and explicitly states that it carries no component coordinate, site scope, permission grant, or install command. A focused schema check confirmed that this sign-in request is accepted while an added `componentId` is rejected. Selection and current-authority resolution remain inside Fuma rather than being fabricated in public UI.

## Accessibility and security

- One authority-backed H1 labels the opening section; H2/H3 order follows the release-record hierarchy.
- Every major section has an explicit `aria-labelledby` relationship; artifact identity is a labelled `aside`.
- Identity, evidence, and review classifications use definition lists; categories and nonzero permissions use semantic lists.
- The review timestamp uses `<time dateTime={item.reviewedAt}>` with deterministic `en-KE` UTC formatting.
- The zero-permission state uses `role="status"`; the numeric permission count includes screen-reader context.
- Seven static IDs were audited as unique. The in-page evidence CTA targets the visible review-evidence heading.
- Long IDs and SHA-256 values use wrapping mono text, and layout grids retain `minmax(0, …)` content tracks.
- Shared CTA focus treatment and the global reduced-motion override remain intact. No client island, local motion rule, raw effect, or new public execution surface was added.
- Exact authority reads continue to reject invalid slugs and do not forward visitor credentials or expose Studio/private imports.

## Focused validation evidence

Validation followed the ticket restriction. No full test suite, root typecheck, full lint, build, server, browser/E2E run, or snapshot was executed.

- Language-service diagnostics for `apps/web/app/components/[slug]/page.tsx` — **PASS**, `No diagnostics`.
- `bunx eslint 'app/components/[slug]/page.tsx'` from `apps/web` — **PASS**, exit status 0 with no output.
- `git diff --check -- 'app/components/[slug]/page.tsx'` from `apps/web` — **PASS**, exit status 0 with no output.
- Forbidden style/positioning source audit — **PASS**: no raw hex, RGB/HSL/OKLCH values, gradients, shadows, inline styles, local white/black palette utilities, self-host/open-source/infrastructure/deployment/database-ownership language.
- Required authority/SEO source audit — **PASS**: all 19 checked contracts were present, including `force-dynamic`, both exact component reads, `notFound()`, noindex-on-absence, exact canonical construction, validated breadcrumb JSON-LD, stable ID/version, permissions, all seven review-evidence fields, bounded product sign-in, and the private-source boundary statement.
- Semantic source audit — **PASS**: seven unique static IDs and all ten required landmark/heading/aside/definition-list/list/time/status/label marker classes were present.
- Public handoff schema smoke check — **PASS**: `{ kind: 'sign_in', source: 'product' }` passed `PublicHandoffRequestSchema`; the same request with `componentId` failed closed.
- `bun test tests/fuma-web-011-discovery.test.ts` — **PARTIAL / EXTERNAL BLOCKER**: four cases passed. The fifth case reached and passed its detail-route dynamic/exact-slug/noindex/private-import assertions, then failed on an unrelated source assertion against the concurrently changed, out-of-scope `apps/web/app/components/page.tsx`: the test requires lowercase `client-side presentation`, while that file currently contains uppercase `Client-side presentation`. This ticket did not edit the index route, per the two-file ownership restriction. Output: 4 pass, 1 fail, 113 assertions.

## Acceptance boundary

Per ticket scope, no server, browser, E2E process, or screenshot was started. This handoff does not claim Blyss HTTPS visual, responsive, routing, hydration, TLS, proxy, runtime accessibility, or browser acceptance. Any later user-facing acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.

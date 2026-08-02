# WEB-DESIGN-015 — Plugin detail redesign

## Result

Redesigned the complete `/plugins/[slug]` route as an exact-release review dossier. The approved state now gives artifact identity, requested permissions, signature/provenance evidence, review limits, and the authenticated install boundary one continuous information hierarchy. Missing, malformed, withdrawn, revoked, or otherwise absent authority still fails closed through the generic noindexed 404 path.

## Changed files

- `apps/web/app/plugins/[slug]/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-015.md`

No shared component, global style, public contract, authority, test, generated asset, lockfile, tracker, or other route was edited.

## Design direction

- **Page job:** let a site owner inspect what one current plugin release is, what authority it requests, and what Fuma reviewed before entering the authenticated product to make an install decision.
- **Audience:** builders evaluating backend extensions inside the closed Fuma product, especially those who need to understand security evidence rather than marketplace promotion.
- **Signature:** a continuous **review dossier**. The artifact identity rail leads into a ruled permission ledger, then a hash-bound evidence spine, then a deliberately separate install-intent boundary. This treats review metadata like a signed case file instead of placing it in generic feature cards.
- **Information architecture:** canonical breadcrumb and current-review thesis → exact public artifact identity → bounded published scope → explicit permission ledger → package/signature/provenance evidence → non-installing public handoff.
- **Visual system:** the route inherits the approved Fuma display/body/mono roles, measured display scale, section rhythm, semantic line/surface hierarchy, signal interaction role, and live-state token. It adds no page-local palette, raw color, gradient, shadow, glow, inline effect, or fabricated product UI.
- **Aesthetic risk and restraint:** the large authority-derived permission count and full-length evidence spine are the single expressive device. Optional `imageUrl` is not presented because the public plugin contract has no corresponding alt-text authority; no invented package artwork or placeholder was substituted.
- **Closed positioning:** copy treats Fuma as the product and installation authority. It introduces no self-hosting, open-source, deployment, infrastructure, database-ownership, or alternate-platform positioning.

## Authority and content integrity

Every plugin-specific fact comes from the strict current `PublicPlugin` projection:

- stable public ID, exact slug, artifact kind, name, summary, categories, version, verified publisher, and review timestamp;
- permission labels and the authoritative zero-permission-label state;
- package content SHA-256, signature key ID, signed-payload SHA-256, and provenance SHA-256;
- SPDX license, accessibility review classification, and minimum runtime version.

The page does not invent a package ID, artifact ID, submission or decision ID, reviewer identity, scan count, finding, source repository, install count, rating, testimonial, ranking, compatibility guarantee, endorsement, future-version claim, or security guarantee. It states only what the authority docs establish: public projection requires a current clean signed unrevoked review; authenticated installation separately revalidates review/revocation/release and requires explicit complete permission grants in active site scope.

The review evidence is explicitly described as metadata rather than endorsement. A different payload is described as a different review, matching the content-hash and signature binding rather than implying a review follows a mutable plugin name.

## Approved and unavailable states

### Current approved record

- The authority-derived H1, summary, publisher, version, stable public ID, timestamp, categories, permissions, and evidence render as a single semantic dossier.
- A zero-length permission-label array renders a complete `role="status"` state and does not imply that review or release validation can be skipped.
- Empty categories render an explicit authoritative absence rather than stale tags or filler.

### Missing, withdrawn, revoked, malformed, or unavailable record

- Metadata uses `readPublicItem('plugins', slug)` and passes `!item` to `publicMetadata`, preserving `noindex, nofollow` for absence.
- Rendering performs the same exact authority-filtered slug read and calls `notFound()` for every absent/non-current result.
- No detail body or artifact JSON-LD is emitted after authority removal, and the generic unavailable copy does not distinguish withdrawal, revocation, malformed data, or an authority outage.
- Web retains no stale fallback and never list-scans for a matching slug.

## SEO, schema, and canonical identity

- The route remains `dynamic = 'force-dynamic'`.
- Approved metadata remains authority-derived and canonical at `/plugins/${slug}`; approved breadcrumb links use the exact projected `item.slug`.
- The page emits only shared, schema-validated `BreadcrumbList` JSON-LD through `breadcrumbStructuredData(...)` and the safe `jsonLd(...)` serializer.
- It intentionally does not fabricate Product, SoftwareApplication, offer, rating, review, or testimonial schema because the repository defines no approved plugin structured-data authority for those claims.
- Missing authority retains noindex metadata and the global noindexed 404 representation.

## Safe install and stable-ID boundary

The stable projected public ID is visible in both the artifact identity and install-intent sections so the reviewed record is unambiguous. The public-to-app transition uses the existing closed request `/start?kind=sign_in&source=plugin`.

This is intentionally narrower than an install command. `PublicHandoffRequestSchema` currently permits `plugin` as a source but has no `install_plugin` union member and no `pluginId` field; additional fields fail closed. The route therefore does **not** smuggle the stable ID, site coordinates, permissions, or an install command into the query. Copy says exactly what the handoff does: establish a bounded sign-in intent, after which the authenticated Fuma marketplace selects active site scope and independently re-resolves current signed authority before any explicit grant/install action. Adding a true version-bound plugin install intent would require a contract and authority change outside this ticket’s two-file ownership.

## Accessibility and semantics

- One authority-backed H1 labels the page; H2/H3 order follows the dossier hierarchy.
- Every major section has an explicit `aria-labelledby` relationship; the artifact identity is a labelled `aside`.
- Identity, evidence, review classifications, and install responsibilities use definition lists; categories and permissions use semantic lists.
- The review timestamp uses `<time dateTime={item.reviewedAt}>`.
- Long IDs and SHA-256 values use wrapping mono text so 320 px layouts do not depend on horizontal scrolling.
- The authority-derived permission count includes screen-reader context, and the zero-permission state announces through `role="status"`.
- The in-page action targets a unique section anchor; shared CTA focus behavior remains intact.
- Motion is limited to the existing global entrance treatment and inherits the repository reduced-motion override. No client island or interaction dependency was added.

## Focused validation evidence

Validation followed the ticket restriction: language-service diagnostics, route-scoped ESLint, whitespace validation, and source audits only. No full test suite, typecheck, build, server, browser/E2E run, or snapshot was executed.

- Language-service diagnostics for `apps/web/app/plugins/[slug]/page.tsx` — **PASS**, `No diagnostics` after the final copy refinement.
- `bunx eslint 'app/plugins/[slug]/page.tsx'` from `apps/web` — **PASS**, exit status 0 with no output after the final refinement.
- `git diff --check -- 'app/plugins/[slug]/page.tsx'` from `apps/web` — **PASS**, exit status 0 with no output after the final refinement.
- Forbidden-style/private-data/positioning audit — **PASS**, zero matches for raw hex; `rgb`/`rgba`; `hsl`/`hsla`; `oklch`; local gradients; inline styles; arbitrary shadows; local white/black color utilities; fabricated social-proof schema keys; private authority coordinates/identities; and self-host/open-source/infrastructure/deployment/database language.
- Authority/SEO source audit — **PASS**, source contains both exact `readPublicItem('plugins', slug)` reads, `force-dynamic`, `notFound()`, `publicMetadata(..., !item)`, exact slug canonicals, stable public ID, all seven review-evidence fields, permission labels, bounded `source=plugin` sign-in, schema-validated breadcrumbs, and safe JSON-LD.
- Semantic source audit — **PASS**, 46 section/heading/aside/definition-list/list/time/status/label markers were found and manually reviewed for one-H1 hierarchy, unique IDs, and labelled landmarks.

## Acceptance boundary

Per ticket scope, no browser process or screenshot was started. This handoff does not claim Blyss HTTPS visual, responsive, routing, hydration, TLS, proxy, runtime accessibility, or browser acceptance. Any later browser acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.

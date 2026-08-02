# WEB-DESIGN-016 — Components index redesign

## Result

Redesigned the complete `/components` route as a premium component-library parts bench. The page now connects the exact reviewed release to the compositional surface it exposes—typed parameters, named slots, variants, bindings, canonical structure, styles, tokens, and responsive behavior—without reducing reusable building pieces to a generic marketplace card grid.

## Changed files

- `apps/web/app/components/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-016.md`

No shared component, global style, public contract, authority implementation, generated asset, lockfile, tracker, test, detail route, or other page was edited.

## Design direction

- **Page job:** help a Fuma builder understand what reviewed component packs are, browse current releases by compositional fit, and inspect exact release evidence before selecting one.
- **Audience:** builders looking for reusable presentation pieces inside Fuma, not backend extensions or popularity-ranked marketplace products.
- **Signature:** a continuous **parts bench**. A release receipt introduces what review attaches to; a ruled composition-anatomy panel then traces typed inputs through variation, structure, and presentation; the directory continues that grammar as wide release records with identity, declared authority, and evidence physically attached.
- **Information architecture:** reviewed-release thesis → component-pack composition contract → searchable current parts bench → ownership and product-boundary comparison → documentation close.
- **Visual system:** the route inherits the approved Fuma display/body/mono roles, measured display scale, shared section rhythm, semantic line and surface hierarchy, signal interaction role, and existing neutral rim/glow treatments. It adds no page-local palette, raw colour, arbitrary shadow, gradient, inline effect, or new global class.
- **Aesthetic risk and restraint:** the contract diagram treats a reusable component as a compositional system rather than a thumbnail. It is explicitly labelled as the reviewed component-pack contract, uses only documented concepts, and is not presented as product UI. The remaining page is deliberately quiet and ruled.
- **Closed positioning:** Fuma is the product, library, review boundary, and install destination. The page introduces no self-hosting, open-source, infrastructure, deployment, database-ownership, or alternate-platform positioning.

## Authority and factual integrity

Every release-specific value comes from the strict current `PublicComponent` projection returned by `readPublicData('components', ...)`:

- stable public ID and canonical slug;
- component-pack artifact kind;
- name, summary, and categories;
- exact version and verified publisher name;
- declared permission labels;
- review timestamp;
- SPDX licence, accessibility classification, minimum runtime version, and full content SHA-256.

The surrounding composition anatomy is grounded in the closed component-pack SDK and approved homepage component treatment: typed props, named slots, variants, loops, conditions, bindings, a canonical node tree, styles, tokens, responsive rules, and reduced-motion-aware animation. The nine parameter labels are the documented Fuma set already used by the approved `CapabilityBento`: string, number, boolean, colour, image, URL, rich text, enum, and slot.

The page does not invent components, pack coordinates, authors, reviewers, review scores, install counts, downloads, ratings, popularity, rankings, testimonials, prices, compatibility guarantees, source repositories, or customer usage. `imageUrl` is intentionally not rendered because the component projection does not provide an authoritative alt-text field; no placeholder, fake preview, or fabricated UI substitutes for it.

## Preserved and strengthened route contracts

- Canonical metadata remains `/components` through `publicMetadata(...)`, now describing exact releases, permissions, and evidence.
- The route remains `dynamic = 'force-dynamic'`.
- Category, search, and cursor values remain bounded by the existing allow-list validators before reaching the authority read.
- Search and category filters remain server-rendered GET controls with shareable URLs.
- Category options now come from the current authority-projected facets rather than an invented taxonomy.
- `CursorPagination` preserves both valid active filters and the authority-issued next cursor.
- Authority failure and authoritative empty results are distinct:
  - `data === null` renders `AuthorityUnavailable` and refuses cached or unverified substitution;
  - a valid zero-result envelope renders a complete status state;
  - filtered emptiness offers a canonical filter reset;
  - unfiltered emptiness states that the library remains empty until current authority supplies a release.
- Declared permission labels remain visible for every result. A zero-label release gets an explicit status rather than an omitted column or an inference about its code.
- Categories also have an explicit authoritative absence state.
- Every listing exposes exact version, verified publisher, current review time, licence, accessibility classification, minimum runtime, and full integrity hash.
- Complete-release links remain canonical `/components/{slug}` routes.
- The focused source-contract phrase `client-side presentation` remains present and truthfully distinguishes packs from plugins.

## Product and ownership boundaries

The final comparison separates three documented concepts without conflating them:

- reviewed component packs are distributable client-side presentation releases;
- private site components remain owner-bound and are not made public by the directory;
- plugins follow a separate backend sandbox and permission-review path.

The route does not expose private components, source drafts, site relationships, usage data, tenant identities, or private authority coordinates. It does not imply that public discovery installs or executes a pack. Copy states that Fuma revalidates review, signature, and revocation authority before installation.

## Accessibility and semantics

- One H1 establishes the page thesis; H2/H3/H4 hierarchy follows the release receipt, composition anatomy, directory, per-release evidence, boundary, and close.
- Every major section and each nested release evidence/authority section has an explicit accessible label.
- The review receipt and ownership comparison use definition lists.
- The composition path is a real ordered sequence and therefore uses an ordered list; its layer position is included in accessible text.
- Parameter types, categories, permission labels, and composition records use semantic lists.
- The directory filter is a labelled GET search form with visible labels, native controls, bounded search length, authority-backed category options, and a 44 px minimum target.
- Each result is a labelled `article`; review timestamps use `<time dateTime={item.reviewedAt}>` and deterministic UTC `en-KE` formatting.
- Empty and no-permission states use status semantics; authority failure remains the shared polite status component.
- Long SHA-256 values wrap at narrow widths instead of forcing horizontal scrolling.
- Existing global keyboard focus and reduced-motion behavior remain in force; the route adds no client island or interaction dependency.

## Focused validation evidence

Validation respected the ticket boundary: one focused authority suite, route diagnostics, route-scoped ESLint, whitespace validation, and source audits. No aggregate test suite, full typecheck, full lint, build, server, browser/E2E run, or snapshot was executed.

- Language-service diagnostics for `apps/web/app/components/page.tsx` — **PASS**, `No diagnostics` after the final source-contract fix.
- `bunx eslint app/components/page.tsx` from `apps/web` — **PASS**, exit status 0 with no output.
- `git diff --check -- app/components/page.tsx` from `apps/web` — **PASS**, exit status 0 with no output.
- `bun test tests/fuma-web-011-discovery.test.ts` from `apps/web` — **PASS**, 5 tests, 113 assertions, 0 failures. The suite verifies strict PII-free projection envelopes, no-store/credential stripping, exact authority slug behavior, malformed/removed-record fail-closed handling, dynamic route boundaries, public-data imports, and the component/plugin distinction.
- Local visual-value audit — **PASS**, zero matches in the assigned page for raw hex, `rgb`/`rgba`, `hsl`/`hsla`, `oklch`, authored gradients, inline styles, or arbitrary shadow values.
- Private-data/positioning/social-proof audit — **PASS**, zero matches for private authority identities/coordinates, fabricated rating/review/testimonial/count fields, and self-hosting/open-source/infrastructure/deployment/database-ownership language.
- Required-contract source audit — **PASS**, confirmed exact `readPublicData('components', ...)`, `force-dynamic`, canonical metadata, bounded category/query/cursor handling, facet categories, distinct unavailable and valid-empty states, permissions, evidence, timestamp, full SHA-256, filter-preserving `CursorPagination`, search/status roles, and the required `client-side presentation` distinction.
- Semantic source audit — **PASS**, 35 section/heading/aside/article/definition-list/list/time/search/status/label markers were found and manually reviewed for hierarchy, unique IDs, and labelled regions.

The focused discovery suite initially exposed a case-sensitive source-contract mismatch (`Client-side presentation` versus required `client-side presentation`). The copy was corrected and the complete focused suite then passed.

## Acceptance boundary

Per ticket scope, no server, browser, E2E run, or screenshot was started. This handoff therefore does not claim Blyss HTTPS visual, responsive, routing, hydration, TLS, proxy, runtime accessibility, or browser acceptance. Any later browser acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.

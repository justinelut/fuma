# WEB-DESIGN-014 — Plugins index redesign

## Result

Redesigned the complete `/plugins` route as a premium review ledger centered on capability requests and release-specific evidence. The page now lets a visitor compare what each current plugin release requests, who published it, when it was reviewed, and which integrity, compatibility, accessibility, and licence facts belong to that exact release—without turning the directory into a generic marketplace grid.

## Changed files

- `apps/web/app/plugins/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-014.md`

No shared component, global style, contract, test, product capture, generated asset, lockfile, tracker, or other route was edited.

## Design direction

- **Page job:** help a visitor inspect current reviewed plugin releases and their permission boundaries before choosing an extension.
- **Audience:** Fuma customers and builders evaluating backend extensions through current authority evidence rather than popularity or promotional signals.
- **Signature:** a continuous **review ledger**. Every authority-backed result is a wide, ruled record combining release identity, verified publisher, summary, categories, permission labels, review date, licence, accessibility standard, minimum runtime, and full package integrity hash. Evidence remains attached to capability instead of being buried behind a marketplace card.
- **Information architecture:** authority thesis and review scope → searchable current review ledger → real Plugins workspace proof → sandbox/permission boundary → SDK capability surface → documentation close.
- **Visual system:** inherits Fuma’s approved display/body/mono roles, measured type scale, section rhythm, semantic surface and line hierarchy, signal interaction role, and shared ambient/product-capture treatments. It introduces no local palette, raw color, arbitrary effect, inline style, or new global class.
- **Aesthetic risk and restraint:** the dense, three-column release receipt is the sole expressive device. Generic fact-strip and card-marketplace patterns were removed. The rest of the page uses disciplined rules, definitions, semantic lists, and one real full-width Studio capture.
- **Closed positioning:** Fuma is presented as the owned product and review/installation boundary. Copy does not imply open source, self-hosting, infrastructure ownership, deployment control, database ownership, or licence tiers.

## Authority and content integrity

Every plugin-specific value comes directly from the current `PublicPlugin` projection returned by `readPublicData('plugins', ...)`:

- stable public ID and slug
- name and summary
- exact version
- verified publisher name
- categories
- permission labels
- review timestamp
- SPDX licence value
- accessibility standard
- minimum runtime version
- full SHA-256 package integrity hash

The page does not infer or invent downloads, installs, ratings, rankings, badges, reviews, testimonials, prices, publisher URLs, customer counts, popularity, recommendation status, or endorsement. The hero and directory copy explicitly distinguish review metadata from a score or endorsement.

The real authority-backed `/product/plugins.webp` Studio capture remains the only product image. It uses the shared `ProductShot` treatment with descriptive alt text and a caption that identifies it as the real Fuma Plugins workspace; no fabricated UI was introduced.

## Preserved and strengthened contracts

- Canonical metadata remains `/plugins` through `publicMetadata(...)`, with a more specific directory description.
- Route remains `dynamic = 'force-dynamic'`.
- Query inputs remain bounded by the existing category, search, and cursor validators before reaching `readPublicData('plugins', ...)`.
- Search, category filtering, and cursor pagination remain GET-based, shareable, and server-rendered.
- Category choices now come from the authority-projected facet list rather than invented taxonomy.
- `CursorPagination` preserves both active filters and the authority-issued next cursor.
- Authority failure and authoritative emptiness are now distinct:
  - a null authority read renders `AuthorityUnavailable` and explicitly refuses cached/unverified substitution;
  - a valid zero-result response renders a complete status state, with a filter-reset action only when filters are active;
  - an unfiltered valid empty directory explains that nothing is listed until the authority supplies a current reviewed release.
- Permission labels are visible on every directory result. A release with no labels renders the exact no-runtime-permissions state rather than an empty panel.
- Review evidence is visible in the directory: reviewed date, licence, accessibility standard, minimum runtime, and full integrity hash.
- Result links remain canonical `/plugins/{slug}` routes, where complete detail evidence continues to be available.
- The existing source-contract phrase `Backend extensions` remains present for focused discovery coverage.
- Sandbox statements remain aligned with implemented plugin boundaries: per-plugin QuickJS-WASM worker, no host filesystem or environment access, no network until an explicit host grant, and separate `editor.code` approval for editor/admin-window code.

## Accessibility and semantic review

- One H1 establishes the page thesis; subsequent review, directory, workspace, boundary, capability, and close sections follow an ordered H2/H3/H4 hierarchy.
- Every major section and every nested permission/evidence section has an explicit accessible label.
- The review-scope callout is a labelled `aside` with a definition list.
- Filters use a labelled GET search form, visible labels, native input/select controls, bounded search length, and an explicit submit action.
- The authority-unavailable and valid-empty states announce through status semantics without conflating failure and absence.
- Each release is a labelled `article`; categories, permissions, capabilities, and denial boundaries use semantic lists or definition lists.
- Review timestamps use `<time dateTime={item.reviewedAt}>` and format deterministically in UTC with `en-KE`.
- Full integrity hashes can wrap without creating horizontal overflow.
- The product screenshot has authority-specific alt text and a visible caption.
- Keyboard focus, contrast roles, and reduced-motion handling remain inherited from the global Fuma system; this server route adds no client runtime or page-local focus/motion override.

## Focused validation evidence

Validation followed the ticket restriction: diagnostics, ticket-scoped ESLint, whitespace validation, and source audits only. No aggregate test, typecheck, lint, build, server, browser/E2E run, or snapshot was executed.

- Language-service diagnostics for `apps/web/app/plugins/page.tsx` — **PASS**, `No diagnostics`.
- `bunx eslint app/plugins/page.tsx` from `apps/web` — **PASS**, exit status 0 with no output.
- `git diff --check -- apps/web/app/plugins/page.tsx` — **PASS**, exit status 0 with no output.
- Local visual-value audit — **PASS**, zero matches for raw hex, `rgb`/`rgba`, `hsl`/`hsla`, `oklch`, inline styles, arbitrary shadows, or local white/black palette utilities.
- Closed-positioning audit — **PASS**, zero matches for open-source, self-hosting, infrastructure, deployment, database-ownership, or licence-tier language.
- Unsupported-authority-field audit — **PASS**, zero matches for item-level downloads, installs, ratings, stars, badges, reviews, testimonials, prices, publisher URLs, aggregate ratings, review counts, or customer counts.
- Required-contract source audit — **PASS**, confirmed `readPublicData('plugins', ...)`, `force-dynamic`, canonical `publicMetadata`, bounded `searchParams` handling, category/query/cursor preservation, `CursorPagination`, `AuthorityUnavailable`, explicit valid-empty status, `permissionLabels`, `reviewEvidence`, `reviewedAt`, `contentHashSha256`, labelled semantic landmarks, search/status roles, H1, time elements, and the real `ProductShot`.

## Acceptance boundary

Per ticket scope, no server, browser, E2E run, or screenshot was started. This handoff therefore does not claim Blyss HTTPS visual, responsive, routing, hydration, TLS, proxy, or browser acceptance. Any later browser acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.

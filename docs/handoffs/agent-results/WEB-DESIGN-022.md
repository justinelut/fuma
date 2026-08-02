# WEB-DESIGN-022 — Guides index redesign

## Result

Replaced the shared generic editorial index at `/guides` with a complete guided-learning surface. The route now presents every eligible Fuma guide as a practical outcome, an honest sequence of content-derived checkpoints, and an attached review record. It is deliberately distinct from Docs: Guides reveal the work in order, while the closing handoff sends readers to Docs for direct product reference.

## Changed files

- `apps/web/app/guides/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-022.md`

No editorial source, compiler, shared component, global style, design token, generated index, contract, test, dependency, lockfile, authority, or other route was edited.

## Design direction

- **Subject:** reviewed Fuma guides that help a builder complete one practical publishing outcome.
- **Audience:** builders who want a route through real work rather than a reference catalogue.
- **Page job:** expose the outcome, sequence, effort, and review record of each currently eligible guide before the reader opens it.
- **Signature:** a **reviewed route ledger**. Every guide carries a numbered vertical checkpoint rail built from its real H2 section headings, followed by version, owner, and next-review evidence. The sequence is meaningful because it mirrors the authored guide; guides themselves are not falsely numbered into a curriculum.
- **Information architecture:** guided-learning thesis and search → outcome/route/review reading key → eligible published paths → direct Docs distinction and handoff.
- **Typography:** inherited Fuma display, body, and mono roles. Display type carries outcomes; mono is reserved for collection labels, categories, and review coordinates.
- **Layout:** one full-width editorial field with asymmetric three-part guide rows: classification, outcome, then checkpoint/review rail. It avoids generic card grids and keeps the authored progression visible at desktop and mobile widths.
- **Palette and effects:** existing semantic background, foreground, muted, line, control, signal, and diagram roles only. The page adds no raw color, local gradient, shadow, glow, inline style, or parallel effect vocabulary. The shared `fuma-bloom` and `fuma-rise` treatments remain the approved global Fuma effects and inherit reduced-motion behavior.
- **Aesthetic risk:** the route outline—not artwork, card chrome, or a fabricated product mockup—is the principal visual object. This makes editorial structure itself the page identity.
- **Self-critique applied:** the interrupted version labelled entries “Path 01”, “Path 02”, and so on, but the loader sorts by publication date rather than a curriculum authority. Those invented cross-guide sequence numbers were removed. Numbering now appears only on real authored checkpoints where order carries information.
- **Closed positioning:** Fuma is the product, editorial owner, and review boundary throughout. No self-hosting, open-source, alternate-platform, infrastructure, database-ownership, or deployment positioning was introduced.

## Real content and eligibility

The page reads the existing strict Git editorial pipeline through `readEditorial()` and filters only `entry.meta.collection === 'guides'`. It does not define a second content list, fixture, fallback guide, or route-specific eligibility rule.

Every record-specific value is derived from an eligible `EditorialEntry`:

- title, description, author, category, version, review owner, update date, and next-review date;
- canonical route from `entry.canonicalPath`, not a locally reconstructed slug path;
- reading time calculated from the actual reviewed body;
- checkpoints from the actual depth-two heading records and their authored order.

The shared compiler remains the authority for strict frontmatter, public audience, draft and future-publication exclusion, current review dates, safe markup/components, canonical paths, redirects, and deterministic publication-date ordering. The page does not claim or infer difficulty, duration beyond body-derived reading time, prerequisites, completion state, popularity, rating, recommendation, or curriculum order.

The only currently eligible guide, `Plan a small business website`, therefore exposes its real reviewed progression: `Name the outcome`, `Build the minimum path`, and `Check the result`. No generic learning cards or invented guide material were added.

## Empty and failure states

- When no guide is eligible, the page renders a labelled `role="status"` state and explicitly refuses to substitute draft, future, or filler material.
- If an otherwise eligible guide has no published H2 sections, its checkpoint region renders an honest `role="status"` message instead of a blank rail or invented steps. The guide remains visible; the page does not impose an unauthorized secondary eligibility filter.
- Compiler rejection and overdue-review behavior remain fail closed in the shared editorial authority. This route does not catch those failures and expose stale content.
- The subject summary is rendered only when eligible category values exist.

## Links, search, and SEO

- Guide links use each entry’s validated canonical path.
- The search form retains the existing bounded `/search?q=…` route and `maxLength={100}`. Its label and placeholder say “Search public resources” because that endpoint searches all eligible editorial collections; the page does not falsely present it as a guides-only authority.
- The final `/docs` link is explicit and accurately distinguishes sequenced walkthroughs from reviewed, versioned reference.
- Route metadata remains canonical at `/guides` through `publicMetadata`, with the shared `en-KE`/`x-default`, Open Graph, social-card, feed-discovery, and indexable website contracts.
- No unsupported structured data, rating, course schema, or learning-duration claim was added.

## Accessibility and semantics

- `PageMain` retains the single main landmark supplied by the site shell.
- The page has one H1, followed by labelled H2 sections; guide titles are H3s within the published-paths section.
- The guide collection and each real checkpoint route are ordered lists. Each entry is an article labelled by its guide title.
- Checkpoint/review information is a labelled aside, and metadata uses definition lists rather than visual-only text groupings.
- Updated and review dates use semantic `<time dateTime>` values with deterministic `en-KE` display formatting.
- The page-level and per-guide empty states use `role="status"`; the collection empty state additionally retains `aria-live="polite"`.
- Search controls, guide actions, and the Docs action have at least 44 px (`min-h-11`) mobile target height.
- Form input has an explicit label; the decorative checkpoint numbers are hidden from assistive technology while their ordered-list position remains semantic.
- Shared focus-visible, forced-colors, reduced-motion, text-wrap, and responsive section behavior remain inherited. No client island, hydration-dependent content, pointer-only interaction, or motion-required meaning was added.

## Focused validation evidence

Validation followed the ticket restriction: source diagnostics, route-scoped ESLint, and focused source audits only. No aggregate test, full typecheck, full lint, build, server, browser/E2E run, screenshot, or snapshot was executed.

- Language-service diagnostics for `apps/web/app/guides/page.tsx` — **PASS**, `No diagnostics`.
- `bunx eslint app/guides/page.tsx` from `apps/web` — **PASS**, exit status 0 with no output.
- Focused semantic/eligibility/whitespace audit — **PASS**, 15 required markers confirmed: shared eligible loader, guides collection filter, canonical path, real H2 derivation, both status boundaries, ordered route, article/aside relationships, semantic dates, canonical metadata, 44 px controls, and Docs link. It also confirmed one H1, no cross-guide `position` numbering, a final newline, and no trailing whitespace.
- Forbidden-style/content-positioning audit — **PASS**, zero matches for raw hex/RGB/HSL/OKLCH colors, local gradients, shadow utilities, inline styles, local white/black palette utilities, fabricated ratings/testimonials/social proof, and self-host/open-source/deployment/database/infrastructure language.

## Acceptance boundary

Per ticket scope, no server, browser, E2E process, or screenshot was started. This handoff does not claim Blyss HTTPS visual, responsive, routing, hydration, TLS, proxy, runtime accessibility, or browser acceptance. Any later browser acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.

# WEB-DESIGN-020 — Documentation index redesign

## Result

Replaced the generic `/docs` editorial-card index with a complete Fuma reference library. The route now orients readers through the current eligible documentation set, provides global resource search, groups exact published references by their authority-provided category, and exposes each entry’s real review record and compiled heading structure before the reader opens it.

The page remains a closed Fuma product surface. It does not introduce origin-story, open-source, self-hosting, infrastructure, deployment, database-ownership, or alternate-platform positioning.

## Changed files

- `apps/web/app/docs/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-020.md`

No shared component, global style, editorial source, compiler, contract, generated search artifact, test, dependency, lockfile, tracker, or other route was edited.

## Design direction

- **Subject:** the current reviewed Fuma product reference library.
- **Audience:** builders who need to find the exact product reference or jump directly to a known section.
- **Single job:** make a small but authoritative documentation collection legible as a maintained reference system rather than a promotional content feed.
- **Signature:** a continuous **reference ledger**. Every document occupies one ruled record with its canonical title and description, version/update/review ownership, and a linked mini table of contents compiled from the document’s real headings. Category rails remain attached to the records they index.
- **Information architecture:** product-reference thesis and current library register → real resource search → sticky topic rail → category-grouped reference ledger → review standard.
- **Typography:** the approved Plus Jakarta Sans display, Inter body, and JetBrains Mono evidence roles are inherited from the Fuma design system. Display type carries orientation; mono remains reserved for labels, counts, dates, and versions.
- **Layout:** the approved 1280 px section shell and measured section rhythm frame an asymmetric index rail and one continuous library surface. Desktop column labels make the ledger scannable; mobile collapses every record into the same semantic reading order.
- **Palette and effects:** semantic global roles only: background, card, surface inset, border/line, input, primary, signal, foreground, and muted foreground. No raw color, page-local palette, gradient, shadow, glow, inline style, or fabricated product image was added.
- **Aesthetic risk:** compiled document headings are promoted into a visible contents rail beside every record. This spends the page’s expressive budget on a real reference-library artifact instead of artwork, cover placeholders, badges, or generic card effects.
- **Self-critique revision:** a conventional featured-document card plus archive grid was rejected because it made three equally reviewed references look like a marketing feed. The final ledger removes arbitrary feature status and lets category, review provenance, and true document structure create hierarchy.

## Frontend-design skill application

The mandatory frontend-design guidance was applied directly:

- The page is grounded in one concrete subject and one reader task.
- The hero is a reference-library thesis, not a generic metric-led marketing headline.
- Structural labels encode real facts: topic groups come from editorial categories; counts come from eligible entries; review fields come from strict frontmatter; contents links come from compiled headings.
- The signature device is specific to documentation and cannot be swapped unchanged onto a showcase, plugin, template, or pricing route.
- Motion is limited to the shared restrained headline entrance; the page adds no client island or scattered animation.
- Empty copy is directional and explicit rather than atmospheric.
- Decorative numbering, feature cards, faux documentation chrome, fabricated code samples, and invented screenshots were omitted.

## Eligibility and content integrity

The route calls `readEditorial()` without draft inclusion and then restricts the result to `entry.meta.collection === 'docs'`. Eligibility remains owned by the established compiler, which:

- excludes drafts;
- excludes entries scheduled after the current editorial clock;
- rejects overdue review records;
- validates strict public-audience frontmatter;
- validates approved MDX components and safe links;
- sorts the resulting public entries deterministically.

The page does not read source files directly, recreate eligibility rules, accept a visitor-provided clock, expose previews, or fall back to generated/stale entries.

Every record-specific visible value comes from an eligible `EditorialEntry`:

- canonical path;
- title and description;
- category;
- exact version;
- update timestamp;
- next-review timestamp used for the library register;
- accountable review owner;
- compiled section heading text and fragment ID.

Reference and heading links use `entry.canonicalPath` directly. No title, summary, category, owner, version, section, example, article, popularity signal, recommendation, or featured status is invented.

## Reference-library behavior

- The hero library register derives its reference count, topic count, and earliest scheduled review from the current eligible Docs set.
- Topic navigation is generated from real categories and links to stable in-page category sections.
- Each category announces its exact eligible record count.
- Each document links both to its canonical detail route and to every real compiled heading fragment.
- The search form preserves the established `/search?q=...` contract and accurately labels itself as Fuma resource search because that route searches the complete public editorial collection.
- No client filtering or duplicate search index was introduced.

## Empty state

A successful eligible read with zero Docs entries renders a complete `role="status"` state with an H2 and explanatory copy. It states that no documentation is currently published and eligible and explicitly refuses draft or scheduled filler. The empty page retains the hero, zero-valued authority-derived register, search, and review standard; it does not render an empty topic navigation or library shell.

## SEO and route identity

- Shared `publicMetadata(...)` retains the canonical `/docs` identity.
- The metadata title and description remain bounded and Fuma-owned.
- Every document link targets its compiler-provided canonical `/docs/{slug}` path.
- Every section jump adds only the compiler-provided heading fragment to that canonical path.
- No unsupported Article, Product, FAQ, rating, review, offer, or documentation JSON-LD was fabricated.
- The route adds no redirect, alternate identity, query-canonical variation, or indexable preview path.

## Accessibility and semantics

- One H1 establishes the page thesis.
- Major content uses labelled sections with H2 headings; category groups use H3; exact document records use H4, preserving a complete hierarchy.
- The topic rail and per-document contents rails are native labelled `<nav>` landmarks.
- Categories and contents are semantic lists.
- Every document is a semantic `<article>`.
- Version, update, and owner evidence uses a definition list.
- Update and review values use `<time dateTime="...">`.
- The library register is a definition list rather than decorative statistics.
- The search input has an explicit accessible label, a bounded length, and a required state.
- The true empty result is announced with `role="status"`.
- Canonical links remain ordinary server-rendered links; category jumps remain native anchors.
- Shared focus-visible, forced-color, and reduced-motion behavior is inherited unchanged.
- The page adds no client hydration, focus override, autoplay, disclosure dependency, horizontal-scroll requirement, or hidden interaction.

## Focused validation evidence

Validation followed the ticket boundary exactly: route diagnostics, route-scoped ESLint, whitespace validation, and source audits only. No aggregate test, typecheck, build, server, browser/E2E run, or snapshot was executed.

- Language-service diagnostics for `apps/web/app/docs/page.tsx` — **PASS**, `No diagnostics`.
- `bunx eslint 'app/docs/page.tsx'` from `apps/web` — **PASS**, exit status 0 with no output.
- `git diff --check -- apps/web/app/docs/page.tsx` — **PASS**, exit status 0 with no output.
- Forbidden-style/positioning source audit — **PASS**, zero matches for raw hex or color functions, gradients, local shadow utilities, inline styles, local white/black palette utilities, self-hosting, open-source, infrastructure, database, Docker, or deployment language.
- Authority/canonical/empty-state audit — **PASS**, required markers confirm `readEditorial()`, canonical entry paths, compiled heading links, exact version/update/review/owner fields, `role="status"`, and shared canonical metadata.
- Heading audit — **PASS**, exactly one H1 in the route source; the H2/H3/H4 hierarchy and labelled landmarks were manually reviewed.

## Acceptance boundary

Per ticket scope, no server, browser, E2E process, or screenshot was started. This handoff does not claim Blyss HTTPS visual, responsive, routing, hydration, TLS, proxy, runtime accessibility, or browser acceptance. Any later browser acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.

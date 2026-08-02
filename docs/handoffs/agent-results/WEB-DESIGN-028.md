# WEB-DESIGN-028 — Search redesign

## Result

Recomposed `/search` as a whole-page Fuma public-library utility rather than a generic search form followed by cards. The query is now the page’s primary interaction, and returned entries form a ruled relevance ledger whose ordering, links, identity, descriptions, categories, publication dates, and paths all come from the current compiler-approved public editorial corpus.

The route now distinguishes three complete states: a useful initial orientation with no false zero-result message, an explicit no-result response with truthful recovery guidance, and an ordered result response with safe query emphasis. It remains canonically `/search`, noindexed/nofollowed, bounded to 100 input characters, and limited by the existing generated-index contract to 20 matches.

## Changed files

- `apps/web/app/search/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-028.md`

No shared component, global style, compiler, search contract, generated index, editorial source, test, dependency, lockfile, server file, snapshot, or other route was edited.

## Design direction

- **Subject:** the current generated index of Fuma’s eligible public editorial resources.
- **Audience:** a visitor who knows the subject, task, release, or policy they need but not its collection or exact URL.
- **Page job:** accept one bounded query, explain exactly what is searched, return only real eligible resources in meaningful rank order, and give specific direction when no query or no match exists.
- **Signature:** a **query-to-result ledger**. The opening search boundary is treated as the primary artifact; successful results become a continuous ruled sequence labelled `Match 01`, `Match 02`, and so on. Numbering is structural rather than decorative because it exposes the actual search ranking.
- **Information architecture:** Fuma public-library thesis → generated-index scope record → large native search form → initial/query response → ordered source-backed result ledger or explicit no-result recovery.
- **Typography:** inherited Fuma display, body, and mono roles. Display type carries the page and response thesis; body type carries exact descriptions; mono type is limited to scope facts, query labels, ranking, collection, publication data, and canonical paths.
- **Layout:** an asymmetric orientation header resolves into a full-width query boundary and then a quiet two-column response header plus a single continuous result ledger. It is not a card grid, command palette, terminal imitation, or fabricated product surface.
- **Palette and effects:** semantic Fuma roles only (`background`, `card`, `foreground`, `muted-foreground`, `signal`, `signal-soft`, input/control and line roles). The route adds no raw color, local gradient, shadow, glow, inline style, stylesheet, image, or motion effect.
- **Aesthetic risk:** the response uses visible ordinal ranking and exact canonical paths. This is justified for search because order and destination are real information; the rest of the composition remains restrained.
- **Self-critique applied:** a conventional hero plus responsive result-card grid would have been interchangeable with any marketing site and would obscure ranking. Suggested-query chips, popular-page fallbacks, snippets, metrics, and recommendations were omitted because the current authority does not generate them.
- **Closed positioning:** Fuma remains the product and editorial authority throughout. No self-hosting, open-source, infrastructure, deployment, database-ownership, competitor, or alternate-platform positioning was introduced.

The required `frontend-design` skill was applied after reviewing the Fuma homepage, measured public-web design reference, global semantic token/type system, site shell, premium Docs/Blog route patterns, editorial compiler, generated search script and artifact, metadata/robots contracts, focused tests, and current `/search` route. The `graphify` guidance was also reviewed; no `graphify-out/graph.json` exists, so no graph query or rebuild was appropriate for this bounded two-file ticket.

## Search and content integrity

- The request query accepts a string or repeated query values, uses only the first value, and slices it to the existing 100-character boundary before search or rendering.
- The form repeats the same boundary through native `maxLength={100}` and uses GET, `type="search"`, a stable `q` name, explicit label, described input, required state, and submit button.
- `searchEditorial(query)` remains the sole result authority. It filters the committed generated index to paths that are still currently public, applies the compiler’s normalized all-word matching and scoring, limits output to 20, and joins matches back to current public entries.
- The route does not duplicate, loosen, or replace compiler eligibility. Drafts, future entries, overdue review states, internal material, malformed sources, and generated records whose path is no longer current remain unavailable.
- Every rendered result value is real current content: title, description, collection, category, publication date, canonical path, and canonical result link.
- No body excerpt, recommendation, popularity claim, related result, suggestion chip, metric, collection count, or fallback result was invented.
- Result ordinals reflect the actual returned order. The interface truthfully describes ordering as match relevance followed by publication date; the compiler retains its deterministic path tie-break.

## Safe highlighting and request handling

- Highlight terms are normalized with the same lowercasing, whitespace splitting, deduplication, and eight-term cap used by `searchEditorialIndex`.
- Terms are sorted longest-first only for display matching, then regex metacharacters are escaped before construction of the bounded case-insensitive expression.
- Highlighting operates only on React text nodes in the exact title and description. It emits semantic `<mark>` elements with global semantic roles; it never uses HTML injection, string-built markup, or `dangerouslySetInnerHTML`.
- Queries containing markup-like text, regex operators, quotes, or other punctuation remain escaped by React in the input, visible query record, and accessible labels.
- A body-only match remains truthful even if no title/description phrase is marked; the route does not manufacture a snippet to imply why it matched.
- Repeated `q` parameters cannot widen or concatenate the query: only the first value is considered.

## Route states

### Initial or whitespace-only query

- No search call is needed and no misleading `0 results` message is emitted.
- The page explains what the index searches, which eligible collections it includes, and which unpublished states it excludes.
- It explicitly declines to substitute popular pages or guessed recommendations for a missing query.

### Matching query

- The response heading reports the exact match count with correct singular/plural grammar.
- The bounded query remains visible beside the response and in the native search input.
- Results render as a semantic ordered list of labelled articles in the exact order returned by the compiler search contract.
- Every title is a keyboard-operable Next link to the exact compiler canonical path. Exact descriptions, collection/category, machine-readable publication time, and path remain visible.
- Safe `<mark>` emphasis appears only where a normalized query term actually occurs in the exact title or description.

### No-result query

- The response clearly states that no published match exists and that the generated public index returned no result.
- The recovery guidance reflects the actual all-word search contract: remove one or more words or use a broader term.
- A real `/search` link clears the query. No unpublished entry, substitute page, fake recommendation, or guessed query is exposed.

## SEO, accessibility, and semantics

- Static metadata still uses `publicMetadata(..., '/search', true)`, preserving exact `https://fuma.co.ke/search` canonical metadata and `robots: { index: false, follow: false }`.
- Repository crawler policy continues to disallow `/search`, and segmented sitemaps continue to omit it.
- One H1 identifies the utility. State headings use H2, and result titles/no-result recovery use H3 under that state heading.
- The search form is a native GET form and search landmark with an explicit visible label, helper association, browser search input, 100-character client limit, required semantics, and a real submit button. Enter-to-submit and normal form keyboard behavior require no client island.
- The result count/query response owns one polite status region. The no-result explanation deliberately does not add a second competing live region.
- Results use `<ol>`, `<li>`, `<article aria-labelledby>`, headings, links, `<footer>`, and `<time dateTime>` semantics. Ranking labels are readable text; decorative behavior is not required to understand order.
- Initial scope facts use definition lists. The query boundary, result ledger, and empty states remain usable without motion, images, hover, JavaScript hydration, or pointer input.
- Shared focus-visible, forced-color, typography, responsive, and reduced-motion behavior remains inherited from the Fuma global system.

## Security and privacy

- The route reads only the bounded public `q` value and the compiler-owned public editorial projection. It introduces no cookies, session access, analytics payload, external request, mutable authority, or private projection.
- Untrusted query text never enters a URL destination, metadata canonical, raw HTML, inline style, script, or structured data.
- React escapes request text everywhere. Regex metacharacters are escaped before safe display highlighting, and the expression is bounded by both the 100-character request cap and eight-term normalization cap.
- Result destinations come only from compiler-built canonical paths and are passed to typed Next links; the user cannot supply or alter a result URL.
- Search stays noindexed and query-free at the canonical metadata layer, avoiding crawlable query-result variants.

## Focused validation evidence

Validation followed ticket scope. No aggregate test suite, root/full typecheck, root/full lint, build, server, browser/E2E run, screenshot, or snapshot was executed.

- Language-service diagnostics for `apps/web/app/search/page.tsx` — **PASS**, `No diagnostics` after the final accessibility refinement.
- `bunx eslint app/search/page.tsx` from `apps/web` — **PASS**, exit status 0 with no output after the final refinement.
- `bun test tests/public-web-editorial.test.ts tests/public-web-seo.test.ts` from `apps/web` — **PASS**, 23 tests, 0 failures, 124 expectations. These focused suites cover strict public eligibility, draft/future exclusion, deterministic generated search, current-public joins, safe Markdown/MDX, canonical/noindex metadata, robots exclusion, sitemap omission, redirects, feeds, and authority withdrawal.
- `bun run editorial:check` from `apps/web` — **PASS**, 10 deterministic public editorial search records verified.
- Direct no-server React render smoke — **PASS** for initial, matching, and no-result states; real `/docs/safe-components-and-code` result link; semantic `<mark>` output; exact `/search` canonical; noindex/nofollow metadata; and server-side truncation to exactly 100 characters.
- Adversarial no-server render smoke — **PASS** for escaped `<script>(.*)+?</script>` input, regex metacharacters, first-value-only repeated query handling, a real `/docs/publishing` result, and whitespace-only initial behavior. An initial probe incorrectly expected highlighted title text to remain one uninterrupted HTML string; the corrected assertion checks the canonical result link and passed.
- Forbidden-style/positioning source audit — **PASS**, zero route matches for raw hex/RGB/HSL/OKLCH colors, gradients, shadows, glows, inline styles, unsafe HTML injection, local white/black palette utilities, or forbidden self-host/open-source/deployment/infrastructure/database language.
- `git diff --check -- apps/web/app/search/page.tsx` — **PASS**, exit status 0 with no output after the final code refinement.

## Acceptance boundary

Per ticket scope, no server, browser, E2E process, or screenshot was started. This handoff does not claim Blyss HTTPS visual, responsive, routing, hydration, TLS, proxy, runtime accessibility, or browser acceptance. Any later user-facing acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.

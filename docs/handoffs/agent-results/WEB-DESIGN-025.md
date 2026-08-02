# WEB-DESIGN-025 — Blog detail redesign

## Result

Recomposed `/blog/[slug]` as a premium reviewed-essay folio. An eligible essay now opens with its exact public identity and a source-backed publication ledger, preserves the complete compiler-approved prose and table of contents, and closes with a restrained editorial colophon plus truthful next actions. Article-specific content is never invented: title, lede, author, category, dates, reading estimate, body, headings, review record, and any chronological neighbours all derive from the current public compiler entry.

Invalid, malformed, missing, draft, future, and otherwise unavailable entries remain generic noindexed 404s. Compiler-owned aliases still issue permanent canonical redirects only when their target is currently public.

## Changed files

- `apps/web/app/blog/[slug]/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-025.md`

No shared component, global style, editorial source, compiler, contract, generated artifact, test, dependency, lockfile, index route, server file, or other route was edited for this ticket.

## Design direction

- **Subject:** one reviewed Fuma product or publishing essay.
- **Audience:** builders and editorial teams who want thoughtful product context with its authorship and currency visible.
- **Page job:** orient the reader within the exact essay, make the writing comfortable to scan and read, retain safe section navigation, and keep editorial accountability attached through the end.
- **Signature:** a **reviewed essay folio**. The title and real source description lead; a ruled publication record carries author, category, publication/update dates, and reading time; a closing colophon carries version, review owner, and next-review date. This makes review currency part of the reading composition rather than decorative magazine chrome.
- **Information architecture:** canonical breadcrumb → collection/category orientation → title and lede → publication record → complete safe essay and compiler-owned TOC → editorial colophon → journal/guides actions → optional chronological neighbours.
- **Typography:** inherited Fuma display, body, and mono roles. Display type is reserved for the essay thesis and destination titles; body type carries the reading surface; mono is limited to editorial labels and version metadata.
- **Layout:** a restrained asymmetric opening resolves into the established readable article/TOC measure. The closing review record mirrors the opening ledger without turning the route into a generic card archive or a broadsheet imitation.
- **Palette and effects:** semantic global roles only: background/foreground, muted foreground, signal, lines, and controls. The route adds no raw color, local gradient, shadow, glow, inline style, or stylesheet.
- **Aesthetic risk:** editorial review evidence is treated as the essay’s colophon, remaining visible at the natural decision point after reading. All surrounding decoration was removed so the real compiler content remains primary.
- **Self-critique applied:** a conventional centered article hero would have been interchangeable with any publication. The final route gives Fuma’s reviewed-publication model one clear visual role while keeping the body quiet. Route-owned IDs use uppercase characters so they cannot collide with the compiler’s lowercase heading IDs.
- **Closed positioning:** Fuma remains the owned product and editorial authority. No self-hosting, open-source, infrastructure, database, or deployment positioning was introduced.

The required `frontend-design` skill was applied after reviewing the blog route and corpus, Fuma visual contract, global semantic roles and type system, hardened Docs/Guides details, editorial compiler, safe renderer, metadata helper, and structured-data schema.

## Content and publication integrity

Every essay-specific value comes from the exact current-public `EditorialEntry`:

- title, description, exact slug/canonical path, author, and category;
- publication/update/review timestamps, version, review owner, and real body-derived reading estimate;
- complete compiler-approved Markdown/MDX blocks and compiler-generated heading IDs;
- optional newer/earlier essay records from the compiler’s deterministic current-public ordering.

The route does not summarize, rewrite, reorder, or manufacture essay claims. `EditorialContent` remains the only body renderer, retaining validated paragraphs, headings, lists, blockquotes, declared callouts, escaped keyboard-scrollable code, safe links, and the labelled “On this page” navigation. Chronological navigation is omitted when no real neighbour exists; the current corpus has one eligible blog essay, so no synthetic recommendation is shown.

`generateStaticParams()` reads the public compiler projection and includes only eligible blog slugs. It cannot expose the scheduled draft fixture.

## Route states and failure behavior

### Exact currently public essay

- A route-local slug predicate mirrors the `EditorialFrontmatterSchema` slug contract: 1–96 lowercase alphanumeric/hyphen characters with alphanumeric ends.
- `getEditorial('blog', slug)` resolves only an exact entry from `readEditorial(false)`, which excludes drafts and future publication dates.
- The exact entry supplies metadata, breadcrumb, H1, publication record, safe body/TOC, colophon, schema, and any chronological links.

### Public canonical alias

- If exact public lookup misses, `resolveEditorialRedirect('/blog/<slug>')` is called only for a schema-valid slug.
- The compiler rejects collisions/chains and filters aliases to currently public targets before returning its redirect map.
- A resolved alias is passed to `permanentRedirect()`; the route never renders duplicate content at the old address.
- The current blog corpus declares no redirect, so no fixture or route exception was fabricated solely to produce runtime evidence. The focused editorial suite validates the redirect lifecycle and public-target filtering.

### Invalid, missing, draft, future, or otherwise unavailable essay

- Invalid slug shapes never enter editorial lookup or redirect resolution.
- All unresolved states call `notFound()` rather than returning a designed `200` substitute.
- Metadata is generic, `noindex, nofollow`, and canonicalized to `/blog`; it never reflects the requested segment or reveals why an entry is unavailable.
- Missing content emits no essay body, breadcrumb schema, or article schema.
- No preview lookup, draft fallback, stale cache, normalized guess, or list substitute is used.

## SEO and structured data

- Published metadata uses `editorialMetadata(entry, entry.canonicalPath, ...)`, preserving the exact compiler canonical, article Open Graph shape, publication/modification timestamps, author, and category.
- Unavailable metadata uses the same helper with the safe `/blog` canonical and noindex behavior.
- Eligible pages emit schema-validated Article JSON-LD through `articleStructuredData(entry)` and the safe `jsonLd(...)` serializer. The Article schema’s blog subtype is `BlogPosting`.
- `Breadcrumbs` emits schema-validated `BreadcrumbList` data for Home → Blog → exact canonical essay.
- No rating, review, testimonial, offer, recommendation, or unsupported structured-data claim was added.

## Accessibility and semantics

- One source-backed H1 labels the outer essay article; compiler headings retain their validated H2/H3 order.
- Publication and review evidence use labelled asides/sections and definition lists, with machine-readable `<time dateTime>` values.
- The body region has an explicit accessible label; the shared TOC remains a labelled navigation landmark with exact fragment links.
- Code remains escaped inside keyboard-focusable `<pre>` content with a language-derived accessible label.
- Chronological links, when present, live in a labelled navigation landmark and expose readable direction/title/action text independently of the decorative arrow.
- The opening and colophon collapse to one column before the large breakpoint. No fixed-width body, client island, autoplay, or interaction dependency was introduced.
- Shared focus-visible, forced-color, sticky-header, smooth-scroll, and reduced-motion behavior remains inherited.

## Focused validation evidence

Validation followed the ticket restriction. No aggregate test suite, root/full typecheck, full build, full lint, server, browser/E2E run, screenshot, or snapshot was executed.

- Language-service diagnostics for `apps/web/app/blog/[slug]/page.tsx` — **PASS**, `No diagnostics`.
- `bunx eslint 'app/blog/[slug]/page.tsx'` from `apps/web` — **PASS**, exit status 0 with no output.
- `bun test tests/public-web-editorial.test.ts tests/public-web-seo.test.ts` from `apps/web` — **PASS**, 23 tests, 0 failures, 124 expectations. This covers strict publication eligibility, draft/future exclusion, redirect ownership, safe Markdown/MDX components and escaping, accessible TOC/code, missing noindex metadata, Article schema, safe JSON-LD, feeds, and canonical metadata.
- `bun test tests/public-web-architecture.test.ts` from `apps/web` — **PASS**, 4 tests, 0 failures, 17 expectations.
- `bun run editorial:check` from `apps/web` — **PASS**, 10 deterministic public editorial search records verified.
- Direct no-server route smoke against `ownership-and-craft` — **PASS**. It verified the exact sole public blog static param, real H1/description/body headings, publication record, “On this page” navigation, editorial colophon, and `BlogPosting` JSON-LD. It also verified `missing-essay`, the real `editorial-preview-workflow` scheduled draft, and malformed `INVALID` each produce canonical `/blog`, `noindex, nofollow` metadata and a Next 404 digest.
- `git diff --check -- 'app/blog/[slug]/page.tsx'` from `apps/web` — **PASS**, exit status 0 with no output.
- Forbidden style/positioning/schema source audit — **PASS**, zero route matches for raw hex/RGB/HSL/OKLCH colors, gradients, local shadows/glows, inline styles, local white/black palette utilities, forbidden positioning language, or fabricated rating/review schema.
- Required contract source audit — **PASS**, 29 matches confirmed strict slug validation, exact public lookup, public static params, compiler redirect resolution, permanent redirect/404 boundaries, canonical metadata, Article JSON-LD, safe body renderer, author/category/date/review fields, labelled landmarks, H1, and machine-readable time semantics.

## Acceptance boundary

Per ticket scope, no server, browser, E2E process, or screenshot was started. This handoff does not claim Blyss HTTPS visual, responsive, routing, hydration, TLS, proxy, runtime accessibility, or browser acceptance. Any later user-facing acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.

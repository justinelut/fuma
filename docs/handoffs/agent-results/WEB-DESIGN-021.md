# WEB-DESIGN-021 — Documentation detail redesign

## Result

Completed the full `/docs/[slug]` route as a premium technical-reference folio. A published document now opens with canonical orientation, a visible review ledger, readable compiler-owned prose/code and TOC, then closes with truthful adjacent-reference and index actions. Draft, future, malformed, missing, and redirect states remain closed and publication-safe.

## Changed files

- `apps/web/app/docs/[slug]/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-021.md`

No shared component, compiler, contract, content source, global style, test, generated artifact, lockfile, tracker, or other route was edited.

## Design direction

- **Page job:** let a builder orient within one exact Fuma reference, verify its currency and ownership, scan its structure, read it comfortably, and choose a real next action.
- **Audience:** Fuma builders and editorial teams looking up reviewed product behavior rather than reading a marketing article.
- **Signature:** a restrained **document folio**. The title and description share the opening plane with a ruled “Document record” ledger sourced entirely from frontmatter. This gives the page the character of maintained technical reference without imitating an IDE, terminal, or fabricated product UI.
- **Information architecture:** canonical breadcrumb → collection/category orientation → title and description → review ledger → compiler-owned prose/code plus sticky TOC → adjacent published references and documentation index.
- **Visual system:** the route uses Fuma’s existing display/body/mono typography, section rhythm, semantic line/control/signal roles, and measured reading widths. It adds no page-local palette, raw color, gradient, shadow, glow, inline effect, or custom stylesheet.
- **Restraint:** the metadata ledger is the one expressive device. The reading surface stays quiet and border-led so authored reference material remains primary.
- **Closed positioning:** all copy presents Fuma as the product. It adds no self-hosting, open-source, deployment, infrastructure, or database positioning.

## Editorial and publication integrity

The route continues to use only the strict editorial pipeline:

- `readEditorial()` supplies available route entries, static params, and adjacent references, so only current public entries can appear.
- Exact `entry.meta.slug === slug` matching preserves canonical slug identity; the route does not normalize, alias, or guess a requested slug.
- `resolveEditorialRedirect('/docs/${slug}')` handles compiler-approved public redirects only after the exact canonical lookup misses.
- `notFound()` handles every missing, draft, future, malformed, or otherwise unavailable detail without substituting content.
- `EditorialContent` remains the only body renderer. The route does not reinterpret MDX or inject HTML; the compiler-approved block model continues to escape code, constrain links/components, and produce heading IDs and TOC links.
- Adjacent actions come only from the current public docs array. No relationship, workflow step, or article is fabricated.
- `generateStaticParams()` contains only publication-eligible docs and therefore cannot expose draft or future slugs through generated paths.

## Available, redirect, and missing states

### Available

- The exact published entry provides H1, description, category, owner, version, updated/review timestamps, body, headings, and canonical path.
- The review ledger displays only source metadata plus a deterministic reading-time calculation from the real body.
- The shared renderer supplies semantic prose, keyboard-scrollable escaped code, approved callouts, section IDs, and the labelled “On this page” navigation.
- Previous/next references are derived from the compiler’s deterministic current-public ordering and are omitted where no adjacent entry exists.

### Redirect

- A noncanonical path is resolved only through the compiler’s public redirect map.
- `permanentRedirect()` receives the compiler-owned canonical target; `/docs/quick-start` was directly verified to resolve to `/docs/getting-started`.
- Draft/future redirects cannot enter that map because the compiler filters redirect targets to public paths.

### Missing or malformed

- Valid missing paths receive route-specific unavailable metadata with `noindex, nofollow`, then render the global 404 through `notFound()`.
- If an untrusted dynamic segment cannot satisfy the canonical pathname contract, metadata falls back to the safe `/docs` canonical while remaining noindex. No malformed segment is reflected into an unsafe canonical.
- Missing content emits no article body or article JSON-LD.

## SEO and structured data

- Available metadata comes from `editorialMetadata(entry, entry.canonicalPath, ...)`, preserving the exact compiler-owned canonical, article Open Graph fields, author, category, published time, and modified time.
- Missing metadata remains noindex through the same shared helper.
- Available pages emit schema-validated `TechArticle` JSON-LD through `articleStructuredData(entry)` and the safe `jsonLd(...)` serializer.
- `Breadcrumbs` adds schema-validated breadcrumb JSON-LD from Home → Documentation → exact document title/path.
- No rating, review, testimonial, offer, product, or other unsupported schema is introduced.

## Accessibility and semantics

- One source-backed H1 labels the article; compiler headings continue at H2/H3 in validated order.
- The document record is a labelled `aside` using a definition list, with machine-readable `<time dateTime>` values.
- The body section has an accessible label; the existing TOC remains a labelled navigation landmark.
- Code remains escaped inside keyboard-focusable `<pre>` content with a language-derived accessible label.
- Next references sit in a labelled `nav`; link labels and visible direction text remain understandable without decorative arrows.
- Layout collapses to one column before the large breakpoint. No fixed-width content or page-local overflow behavior was added.
- Existing shared focus and reduced-motion behavior remains intact; the route adds no client island or motion dependency.

## Focused validation evidence

Validation respected the ticket restriction: no full test suite, full build, full lint, server, browser/E2E run, or snapshot was executed.

- Language-service diagnostics for `apps/web/app/docs/[slug]/page.tsx` — **PASS**, `No diagnostics`.
- `bun x eslint 'app/docs/[slug]/page.tsx'` from `apps/web` — **PASS**, exit 0 with no output.
- `bun test tests/public-web-editorial.test.ts tests/public-web-seo.test.ts` from `apps/web` — **PASS**, 23 tests, 0 failures, 124 expectations. This covers draft/future exclusion, redirect ownership, safe MDX components, escaped executable-looking code, accessible TOC/code, missing noindex metadata, article schema, and safe JSON-LD.
- `bun test tests/public-web-architecture.test.ts` from `apps/web` — **PASS**, 4 tests, 0 failures, 17 expectations.
- `bun run editorial:check` from `apps/web` — **PASS**, 10 deterministic public editorial search records verified.
- Direct Bun server-render smoke of the changed route — **PASS**. It verified the exact three generated docs params; rendered all three available docs; found the document ledger, TOC, next actions, and JSON-LD; confirmed script-like code remained escaped; confirmed missing metadata noindex; confirmed `/docs/quick-start` redirects to `/docs/getting-started`; and confirmed `/docs/missing` resolves as 404.
- `git diff --check -- 'apps/web/app/docs/[slug]/page.tsx'` — **PASS**, exit 0 with no output.
- Forbidden style/positioning audit — **PASS**, zero route matches for raw hex/rgb/hsl/oklch colors, local gradients, shadows, glows, inline styles, local white/black backgrounds, or self-host/open-source/infrastructure/database/deployment language.

## Acceptance boundary

Per ticket scope, no browser process, E2E run, server, or screenshot was started. This handoff does not claim Blyss HTTPS visual, responsive, routing, hydration, TLS, proxy, runtime accessibility, or browser acceptance. Any later browser acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.

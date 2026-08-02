# WEB-DESIGN-023 — Guide detail redesign

## Result

Recomposed `/guides/[slug]` as a practical field route rather than the shared editorial/Docs article template. An eligible guide now opens with its exact public identity and review record, exposes its real H2 sequence as an ordered route map, renders the complete compiler-approved Markdown/MDX body, and closes with the review receipt plus a clear distinction between outcome-led Guides and lookup-led Fuma Docs.

Invalid, missing, draft, future, and otherwise ineligible entries remain generic noindexed 404s. Compiler-owned aliases still issue permanent canonical redirects only when their target is currently public.

## Changed files

- `apps/web/app/guides/[slug]/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-023.md`

No shared component, global style, compiler, public contract, content source, generated artifact, test, dependency, lockfile, index route, Docs route, server file, or other file was edited for this ticket.

## Design direction

- **Subject:** one reviewed Fuma guide that turns a practical publishing outcome into an ordered path.
- **Audience:** builders who want to complete a concrete piece of work and see the route before committing to the read.
- **Page job:** establish the exact guide, reveal its real checkpoints, preserve the complete instruction body, and keep its review status attached.
- **Signature:** a **field route** derived directly from level-two guide headings. Numbering is structural rather than decorative because source order is the work order. Each checkpoint links to the exact compiled heading in the real guide body.
- **Information architecture:** canonical breadcrumb and guide thesis → public guide record → ordered route map → complete safe instruction body and on-page navigation → review receipt and Guides/Docs decision.
- **Typography:** inherited Fuma display, body, and mono roles. Display type carries title and checkpoint names; mono is reserved for labels, sequence numbers, and version metadata.
- **Layout:** restrained asymmetric Fuma section grids, ruled records, a single ordered checkpoint spine, and a readable compiler-owned article/TOC measure. It does not reproduce the generic card archive or Docs detail composition.
- **Palette/effects:** semantic global roles only: background, primary, muted foreground, signal, line, and control roles. The route adds no raw color, page-local gradient, shadow, glow, inline style, or new effect. Motion is limited to the existing globally reduced `fuma-rise` opening treatment.
- **Aesthetic risk:** the route reveals the complete guide structure before the body rather than hiding it in a conventional sidebar. This is useful specifically because a guide is sequential; all other decoration was removed.
- **Self-critique applied:** an early article-detail direction would have been interchangeable with Docs. The final route gives sequence one deliberate visual role while leaving the source body and review evidence quiet. Route-owned IDs were also made case-distinct from compiler-generated lowercase heading IDs, eliminating collisions for arbitrary eligible guide headings.
- **Closed positioning:** Fuma remains the owned product and editorial authority. No self-hosting, open-source, deployment, infrastructure, database-ownership, or alternate-platform positioning was introduced.

The required `frontend-design` skill was applied after reviewing the Fuma homepage, guide index, shared editorial reference, global semantic roles and measured type system, hardened detail routes, real guide source, editorial compiler, safe renderer, SEO helpers, and structured-data contracts.

## Content and rendering integrity

Every entry-specific value comes from the currently public `EditorialEntry` returned by exact `getEditorial('guides', slug)` resolution:

- title, description, category, author, exact projected slug/canonical path;
- updated and review timestamps, version, owner, and real body-derived reading estimate;
- real H2 headings and their compiler-generated safe fragment IDs;
- complete compiler-approved Markdown/MDX blocks.

The route does not rewrite, summarize, reorder, or manufacture guide instructions. Its checkpoint map filters `entry.headings` to depth two and preserves source order. The instruction body remains rendered by the established `EditorialContent`, retaining validated paragraphs, headings, lists, blockquotes, declared callouts, escaped keyboard-scrollable code, safe links, and the accessible “On this page” navigation.

The route adds no invented completion state, progress persistence, quiz, estimated outcome, product screenshot, testimonial, metric, recommendation, related-guide filler, or synthetic guide step. A valid headingless guide still renders its complete body and record; only the empty route-map section and its jump action are omitted.

## Route states and failure behavior

### Exact currently public guide

- A strict route-local slug predicate mirrors `EditorialFrontmatterSchema` (`1–96` lowercase alphanumeric/hyphen characters with alphanumeric ends).
- `getEditorial('guides', slug)` supplies only entries that pass compiler validation, public audience, non-draft status, publication time, and review eligibility.
- Exact canonical metadata, article schema, breadcrumb schema, guide body, route map, and review receipt render from that one entry.

### Public canonical alias

- If no exact public entry exists, the route asks `resolveEditorialRedirect('/guides/<slug>')` only for a schema-valid slug.
- Compiler redirects are collision/chain validated and filtered to currently public targets.
- A resolved target is passed to `permanentRedirect`, preserving a real permanent canonical response rather than rendering duplicate content.
- The current content corpus declares no guide redirect, so no temporary alias or fabricated fixture was added merely to produce route-specific runtime evidence. The branch is source-verified and the focused compiler suite validates canonical redirect lifecycle behavior.

### Invalid, missing, draft, future, or otherwise unavailable guide

- Invalid slug shapes never reach editorial lookup or redirect resolution.
- All unresolved states call `notFound()` and use the shared noindexed 404 rather than returning a designed `200` substitute.
- Metadata is generic, `noindex, nofollow`, and canonicalized to `/guides`; it never reflects an untrusted request slug or distinguishes why content is absent.
- No article or breadcrumb JSON-LD and no guide body is emitted for an unavailable state.
- No stale cache, preview lookup, list scan, or draft fallback is used.

## SEO and schema

- Published metadata is generated through `editorialMetadata` from the exact entry: title, description, article type, canonical `entry.canonicalPath`, publication/modification timestamps, author, and category.
- Missing metadata uses the same helper with the safe `/guides` canonical and noindex behavior.
- The route emits schema-validated `TechArticle` JSON-LD through `articleStructuredData(entry)` and the repository’s safe `jsonLd` serializer.
- `Breadcrumbs` emits the repository’s validated `BreadcrumbList` schema for Home → Guides → exact canonical guide.
- No Product, HowTo completion claim, rating, review, offer, testimonial, or fabricated social-proof schema was added.

## Accessibility and semantics

- One H1 identifies the exact guide; route and review sections use ordered H2 hierarchy before the compiler-rendered H2/H3 body.
- The checkpoint map is a semantic ordered list whose labels are the real section headings; every link targets the corresponding compiled heading.
- Guide identity and review evidence use definition lists, with deterministic `en-KE` UTC dates in `<time dateTime>` elements.
- The record and instruction regions have explicit accessible labels; the checkpoint section and closing section use `aria-labelledby`.
- Route-owned IDs (`GuideTitle`, `GuideRoute`, `GuideRouteHeading`, `GuideReviewHeading`) contain uppercase characters, while compiler heading IDs are always lowercase. This guarantees no duplicate-ID collision with arbitrary valid Markdown/MDX headings.
- The route-map CTA is omitted when there are no H2 checkpoints, avoiding a dead control.
- Shared focus-visible, forced-color, sticky-header, code-scroll, and reduced-motion behavior remains inherited. No client island, autoplay, hidden hydration content, or interaction dependency was added.

## Security and privacy

- Only the validated public disk editorial compiler and its strict public entry projection are used.
- Unsafe HTML, event handlers, embedded assets, undeclared MDX components, unsafe links, internal markers, malformed heading hierarchy, and unescaped code remain rejected by the existing compiler before rendering.
- No request value is inserted into raw HTML or schema. The only `dangerouslySetInnerHTML` use is the established safe serializer over schema-validated article data.
- Missing responses reveal no prior title, owner, publication state, review state, or redirect target unless the compiler authorizes a current public redirect.

## Focused validation evidence

Validation followed the ticket restriction. No aggregate test suite, root/full typecheck, full lint, build, server, browser/E2E run, screenshot, or snapshot was executed.

- Language-service diagnostics for `apps/web/app/guides/[slug]/page.tsx` — **PASS**, `No diagnostics` after final ID hardening.
- `bunx eslint 'app/guides/[slug]/page.tsx'` from `apps/web` — **PASS**, exit status 0 with no output after the final edit.
- `bun test tests/public-web-editorial.test.ts` from `apps/web` — **PASS**, 9 tests, 0 failures, 47 expectations. This focused suite covers strict public eligibility, draft/future exclusion, safe Markdown/MDX components and escaping, canonical redirects, broken/unsafe links, deterministic output, accessible TOC/callout/code rendering, and the committed editorial lifecycle.
- Real-route server-render smoke using `small-business-site` — **PASS**. It asserted one H1, the route-map landmark, real checkpoint fragment links, unchanged source body text, `TechArticle` schema, and the accessible “On this page” navigation.
- Metadata/state smoke — **PASS**. The exact public slug produced canonical `https://fuma.co.ke/guides/small-business-site` with `index: true, follow: true`; missing and invalid slugs produced canonical `https://fuma.co.ke/guides` with `index: false, follow: false` and terminated with Next’s `NEXT_HTTP_ERROR_FALLBACK;404` digest.
- Forbidden-style/positioning/schema source audit — **PASS**, zero matches for raw hex, RGB/HSL/OKLCH values, gradients, page-local shadows, inline styles, local white/black palette utilities, fabricated social-proof schema, and forbidden self-host/open-source/infrastructure/deployment/database-ownership language.
- Authority/SEO/semantic source audit — **PASS**, 29 required marker matches confirmed strict slug validation, exact guide lookup, public redirect resolution, permanent redirect, 404 boundary, safe metadata, canonical path use, article schema, safe compiled rendering, breadcrumbs, labelled landmarks, one H1 structure, ordered checkpoints, definition lists, and time semantics.
- `git diff --check -- 'apps/web/app/guides/[slug]/page.tsx'` — **PASS**, exit status 0 with no output after the final edit.

## Acceptance boundary

Per ticket scope, no server, browser, E2E process, or screenshot was started. This handoff does not claim Blyss HTTPS visual, responsive, routing, hydration, TLS, proxy, runtime accessibility, or browser acceptance. Any later user-facing acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.

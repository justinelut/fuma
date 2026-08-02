# WEB-DESIGN-027 — Changelog detail redesign

## Result

Recomposed `/changelog/[slug]` as a premium release register rather than the shared generic editorial detail. Every eligible release now opens with its exact version and public identity, carries a ruled publication/review record, exposes real source-authored H2 changes as an ordered ledger, renders the complete compiler-approved body and TOC, and closes with truthful changelog/Docs actions plus adjacent releases only when current public neighbors exist.

Invalid, malformed, missing, draft, future, and otherwise unavailable records remain generic noindexed 404s. Compiler-owned aliases still issue permanent redirects only when their target is currently public.

## Changed files

- `apps/web/app/changelog/[slug]/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-027.md`

No shared component, global style, compiler, public contract, content source, generated artifact, test, dependency, lockfile, index route, server file, snapshot, or other file was edited for this ticket.

## Design direction

- **Subject:** one exact reviewed Fuma release note and the changes it records.
- **Audience:** builders and evaluators checking what Fuma shipped, when it shipped, and where to read the current product reference.
- **Page job:** establish release identity immediately, make its source-authored change structure scannable, preserve the full safe note, and provide only real continuity actions.
- **Signature:** a restrained **release register**. The exact version is treated as the release’s primary artifact, paired with a ruled publication ledger and an ordered change ledger derived only from real level-two headings. Numbering is structural because it preserves source order; it is not decorative.
- **Information architecture:** canonical breadcrumb → category/version/title thesis → release record → source-derived change ledger → complete safe release body and TOC → changelog/Docs actions and optional current-public adjacent releases.
- **Typography:** inherited Fuma display, body, and mono roles. Display type carries the exact version, release title, and source section names; mono is limited to release labels, sequence positions, and version data.
- **Layout:** an asymmetric opening register, border-led definition list, one ordered change spine, then the established readable compiler-owned content/TOC grid. It does not imitate a dashboard, terminal, ticket tracker, or fabricated product UI.
- **Palette and effects:** semantic Fuma roles only (`background`, `primary`, `muted-foreground`, `signal`, and line/control roles). The route adds no raw color, page-local gradient, shadow, glow, inline style, image, or new effect. It adds no motion dependency.
- **Aesthetic risk:** the version receives display-scale prominence rather than being buried in article metadata. This is specific to a release note—the version is the exact record identifier—and the rest of the surface stays quiet and evidence-led.
- **Self-critique applied:** a conventional article hero plus related-card grid would have been interchangeable with Blog or Docs and could encourage invented “related” material. The final design instead uses release-specific record semantics and omits adjacent-release UI unless a real current-public neighbor exists.
- **Closed positioning:** Fuma remains the product and editorial authority throughout. No self-hosting, open-source, deployment, infrastructure, database-ownership, or alternate-platform positioning was introduced.

The required `frontend-design` skill was applied after reviewing the Fuma visual system, shared editorial renderer, strict compiler and metadata contracts, structured-data serializer, real changelog source, and completed Docs/Guides detail patterns. The existing `graphify` guidance was also reviewed; no `graphify-out/graph.json` exists, and no graph rebuild was needed for this bounded two-file implementation.

## Release and content integrity

Every release-specific value comes from the exact currently public `EditorialEntry` returned by guarded `getEditorial('changelog', slug)` resolution:

- title, description, category, exact slug/canonical path, version, author, and owner;
- published and review timestamps;
- real H2 headings and compiler-generated safe fragment IDs;
- complete compiler-approved Markdown/MDX blocks;
- current-public neighboring entries in deterministic publication order.

The route does not rewrite, summarize, reorder, or manufacture release changes. Its change ledger filters `entry.headings` to depth two, preserves source order, and links to those exact compiled sections. `EditorialContent` remains the sole body renderer, retaining validated paragraphs, headings, lists, blockquotes, declared safe callouts, escaped keyboard-scrollable code, safe links, and the accessible “On this page” navigation.

A valid headingless release still renders its exact release record and complete body; only the empty change-ledger section is omitted. The current corpus contains one changelog release, `public-web-foundation` version `0.1.0`, so its real render correctly omits the adjacent-release navigation rather than fabricating another release. The stable “Browse changelog” and “Open Fuma Docs” actions remain available.

## Route states and failure behavior

### Exact currently public release

- `CHANGELOG_SLUG` mirrors the strict frontmatter slug shape: 1–96 lowercase alphanumeric/hyphen characters with alphanumeric ends.
- `getEditorial('changelog', slug)` can return only compiler-valid, public-audience, non-draft, already-published, review-eligible content.
- Exact metadata, canonical breadcrumb, release record, change ledger, safe body/TOC, and article schema all derive from that one entry.
- `generateStaticParams()` includes only currently public changelog entries from `readEditorial()`.

### Public canonical alias

- Exact canonical lookup happens first.
- If it misses, only a schema-valid slug can reach `resolveEditorialRedirect('/changelog/<slug>')`.
- The compiler redirect map is collision/chain validated and contains aliases only for currently public targets.
- A resolved target is passed to `permanentRedirect()`; the route never renders duplicate alias content.
- The current changelog source declares no alias, so no content fixture or fake redirect was added. The redirect branch is source-audited and the focused compiler suite verifies public-only canonical redirect behavior.

### Invalid, missing, draft, future, or otherwise unavailable release

- Invalid slug shapes never enter editorial or redirect lookup.
- Every unresolved state calls `notFound()` and uses the shared 404 instead of returning a designed `200` substitute.
- Missing metadata uses generic “Changelog entry unavailable” copy, `noindex, nofollow`, and the safe `/changelog` canonical. It never reflects an untrusted request slug or reveals whether a record was absent, draft, future, or withdrawn.
- No release body, breadcrumb schema, article JSON-LD, owner, version, or prior publication state is emitted for unavailable content.

## SEO and schema

- Published metadata is generated with `editorialMetadata(entry, entry.canonicalPath, ...)`, preserving exact canonical URL, article Open Graph shape, publication/modification dates, author, category, feeds, and Fuma social metadata.
- Missing metadata uses the same helper with a safe collection canonical and closed robots behavior.
- Published pages emit schema-validated `TechArticle` JSON-LD through `articleStructuredData(entry)` and the repository’s hardened `jsonLd(...)` serializer.
- `Breadcrumbs` emits validated `BreadcrumbList` data for Home → Changelog → exact release.
- No Product, SoftwareApplication, offer, rating, review, testimonial, download, compatibility, or fabricated release schema was introduced.

## Accessibility and semantics

- One H1 identifies the exact release. Route-owned section headings precede the compiler-rendered H2/H3 body in a valid hierarchy.
- The release record is a labelled `aside` containing a definition list; dates use machine-readable `<time dateTime>` markup.
- The source-derived change ledger is a semantic ordered list with an explicit accessible label. Every entry links to the corresponding compiled heading ID.
- Route-owned IDs (`ReleaseTitle`, `ReleaseRecordTitle`, `ChangeLedgerTitle`, `ReleaseContinuityTitle`) contain uppercase characters, while compiler heading IDs are lowercase, preventing collisions with eligible source headings.
- The complete release content region has an accessible label; the shared TOC remains a labelled navigation landmark.
- Adjacent entries, when present, are contained in an “Adjacent releases” navigation landmark and identify direction, exact version, title, and publication date.
- Shared keyboard focus, forced-color, sticky-header offset, code scrolling, and reduced-motion behavior remain inherited. The route adds no client island, hidden hydration content, autoplay, or interaction requirement.

## Security and privacy

- Only the validated public disk editorial compiler and its current-public projection are used.
- Unsafe HTML, handlers, embedded assets, undeclared MDX components, unsafe links, malformed heading hierarchy, internal markers, and unescaped code remain rejected before rendering.
- No request segment is inserted into raw HTML, schema, metadata canonicals, or visible missing-state copy.
- The only `dangerouslySetInnerHTML` use is the established hardened serializer over schema-validated article data.
- Missing responses reveal no previous title, version, owner, publication state, or redirect target unless the compiler authorizes a current-public redirect.

## Focused validation evidence

Validation followed the ticket restriction. No aggregate test suite, root/full typecheck, full lint, build, server, browser/E2E run, screenshot, or snapshot was executed.

- Language-service diagnostics for `apps/web/app/changelog/[slug]/page.tsx` — **PASS**, `No diagnostics`.
- `bunx eslint 'app/changelog/[slug]/page.tsx'` from `apps/web` — **PASS**, exit status 0 with no output.
- `bun test tests/public-web-editorial.test.ts tests/public-web-seo.test.ts` from `apps/web` — **PASS**, 23 tests, 0 failures, 124 expectations. These focused suites cover strict public eligibility, draft/future exclusion, redirects, safe Markdown/MDX and escaping, accessible TOC/code rendering, canonical/noindex metadata, article schema, hardened JSON-LD, feeds, and deterministic public output.
- `bun run editorial:check` from `apps/web` — **PASS**, 10 deterministic public editorial search records verified.
- Direct Bun server-render smoke of `public-web-foundation` — **PASS**. It confirmed the real static param, exact `https://fuma.co.ke/changelog/public-web-foundation` canonical, indexable published metadata, one H1, release record, version `0.1.0`, source-derived change ledger, unchanged source body text, accessible “On this page” TOC, `TechArticle` JSON-LD, and the absence of synthetic data.
- Missing/malformed state smoke for `missing-release` and `INVALID` — **PASS**. Both produced canonical `https://fuma.co.ke/changelog`, `index: false`, `follow: false`, and terminated with Next’s `NEXT_HTTP_ERROR_FALLBACK;404` digest.
- Forbidden-style/positioning source audit — **PASS**, zero route matches for raw hex, RGB/HSL/OKLCH values, gradients, shadows, glows, inline styles, local white/black palette utilities, or forbidden self-host/open-source/deployment/infrastructure/database language.
- Authority/SEO/semantic source audit — **PASS**, 29 marker matches confirmed strict slug validation, exact public lookup, public redirect resolution, permanent redirect, 404 boundary, safe metadata, canonical paths, article schema, safe compiled rendering, breadcrumbs, labelled landmarks, H1, definition list, time semantics, and optional adjacent navigation.
- `git diff --check -- 'apps/web/app/changelog/[slug]/page.tsx'` — **PASS**, exit status 0 with no output.

## Acceptance boundary

Per ticket scope, no server, browser, E2E process, or screenshot was started. This handoff does not claim Blyss HTTPS visual, responsive, routing, hydration, TLS, proxy, runtime accessibility, or browser acceptance. Any later user-facing acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.

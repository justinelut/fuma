# WEB-DESIGN-024 — Blog index redesign

## Result

Recomposed `/blog` as the **Fuma Journal**: a premium, essay-led surface for product judgment and publishing craft rather than the shared editorial card index. The page now presents a restrained journal masthead, real RSS/Atom entry points, the current eligible essay as a ruled editorial record, an argument map derived from its actual level-two headings, a chronological earlier-essay shelf when eligible entries exist, and clear routes to changelog, guides, and documentation for readers seeking a different kind of record.

The current corpus contains one publicly eligible essay, `ownership-and-craft`. The future draft `editorial-preview-workflow` remains absent. No placeholder essay, category, quote, author, date, filter, image, metric, or interface was introduced to make the journal appear fuller.

## Changed files

- `apps/web/app/blog/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-024.md`

No shared component, global style, compiler, contract, content source, generated artifact, test, dependency, lockfile, detail route, server file, or other file was edited.

## Design direction

- **Subject:** Fuma’s long-form thinking about product decisions and publishing craft.
- **Audience:** builders and editorial teams who want the reasoning behind the product, not a stream of announcements.
- **Page job:** establish the journal’s editorial purpose, surface only real eligible essays, show the shape and publication record of each argument, and direct readers to the appropriate Fuma publication when they need a change record, practical route, or exact reference.
- **Signature:** an **argument map** generated from each essay’s real compiler-approved H2 headings. It lets a reader inspect how an essay develops before opening it and gives the journal a thinking-specific identity without inventing pull quotes, tags, or decorative editorial furniture.
- **Information architecture:** Fuma Journal thesis and real feed links → editorial form/current source categories → current eligible essay and argument map → optional chronological earlier essays → changelog/guides/docs reading-mode distinction.
- **Typography:** inherited Fuma display, body, and mono roles. Display type carries the journal thesis and essay titles; body type carries reasoning; mono is limited to publication labels and record metadata.
- **Layout:** asymmetric Fuma section grids and ruled folio records rather than rounded cards or a news grid. The article title and premise occupy the reading plane while the argument and publication ledger sit in the margin.
- **Palette and effects:** semantic global roles only (`background`, `muted-foreground`, `signal`, `line-soft`). The route adds no raw color, arbitrary color alpha, gradient, shadow, glow, local stylesheet, inline style, or motion effect.
- **Aesthetic risk:** the index exposes essay structure as editorial material instead of relying on imagery or conventional cards. This is specific to long-form reasoning and stays useful as the corpus grows.
- **Self-critique applied:** a proposed “latest plus three-column archive” repeated the generic editorial component being replaced. The final design removed cards, fake abundance, and category controls with no destination. Categories are truthful noninteractive context; each essay remains one readable folio.
- **Closed positioning:** Fuma is presented as the product and journal owner. No origin story, open-source, self-hosting, infrastructure, deployment, database-ownership, or alternate-platform claim was introduced.

The required `frontend-design` skill was applied after reviewing the approved Fuma homepage composition, measured web design system, global semantic roles and type scale, public visual/implementation references, current generic blog route, guide index, shared editorial pages, editorial loader/compiler, the real blog sources, and adjacent design handoffs. No `graphify-out` graph existed, so direct source inspection was used rather than a graph query.

## Editorial and eligibility integrity

- `readEditorial()` remains the sole source and therefore preserves compiler validation, public audience, non-draft status, publication time, review window, safe links/components, canonical collision checks, and deterministic newest-first ordering.
- The route filters that already-public projection to `entry.meta.collection === 'blog'`; it never reads drafts, preview content, raw files, generated-search records, or fallback fixtures.
- The lead essay is the first item in compiler order. Earlier essays preserve the remaining compiler order inside a semantic ordered list.
- Every essay link uses `entry.canonicalPath` directly. The route does not reconstruct, normalize, or guess a slug.
- Displayed essay facts come only from `EditorialEntry`: title, description, author, category, canonical path, body-derived reading estimate, published/updated/review dates, version, owner, and actual H2 headings.
- The argument map filters `entry.headings` to depth two and preserves source order. It does not summarize, rename, number, or infer an argument.
- Categories are deduplicated from currently eligible entries and shown only as noninteractive editorial context; there is no fake category filter or unsupported query state.
- RSS and Atom links point to the existing public feed routes, which consume the same eligible compiler projection.

## Empty and sparse states

- With one eligible essay, the page deliberately gives that essay full editorial weight and omits the earlier-essay section rather than manufacturing archive density.
- With zero eligible essays, the journal masthead remains useful, current threads explain when categories appear, and the publication section renders an explicit polite status.
- The empty state states that no reviewed essay is publicly eligible and that drafts/future writing is not substituted. It reveals no draft title, schedule, or preview path.
- A valid essay without H2 headings still renders all publication metadata and its canonical reading action; only the empty argument-map block is omitted.

## SEO and accessibility

- `publicMetadata` provides unique Fuma Journal title/description and the canonical `/blog` route while retaining the shared locale, feed discovery, robots, and social-card policy.
- One H1 identifies the journal. Section H2s establish published thinking, optional earlier essays, and other reading modes; essay titles are H3s within those sections.
- Every essay is a semantic `article` labelled by its source title. Its argument/publication margin is a labelled `aside` and its metadata is a definition list.
- Published, updated, and next-review values use machine-readable `<time dateTime>` elements while retaining `en-KE` human-readable dates.
- Journal feeds and related Fuma publications use labelled navigation landmarks. The earlier archive uses an ordered list; current categories use a labelled list.
- Canonical essay links have descriptive text and at least 44 px target height where they act as primary actions. Shared focus-visible, forced-colour, wrapping, and responsive behavior remains inherited.
- Route-owned essay title IDs begin with uppercase `Essay-`, while compiler heading IDs are lowercase. This avoids collisions with arbitrary eligible source headings.
- No client island, hydration-dependent content, autoplay, hover-only meaning, local animation, or fabricated structured data was added.

## Focused validation evidence

Validation followed the ticket restriction. No aggregate tests, full build, full typecheck, full lint, server, browser/E2E run, screenshot, or snapshot was executed.

- Language-service diagnostics for `apps/web/app/blog/page.tsx` — **PASS**, `No diagnostics`.
- `bunx eslint app/blog/page.tsx` from `apps/web` — **PASS**, exit status 0 with no output.
- `bun test tests/public-web-editorial.test.ts` from `apps/web` — **PASS**, 9 tests, 0 failures, 47 expectations. This verifies strict frontmatter/review rules, draft and future exclusion, public reads/search/feed eligibility, safe MDX, canonical redirects and links, deterministic output, real disk collections, and preview-to-public lifecycle behavior.
- Direct Bun server render of the changed route — **PASS**, 10 assertions. It verified exactly one H1; the real `Why ownership changes the building process` essay; absence of `Editorial preview workflow`; exact `/blog/ownership-and-craft` canonical link; real author, category, and published date; a real argument heading; and both RSS and Atom links.
- Forbidden style/positioning audit — **PASS**, zero matches for raw hex/RGB/HSL/OKLCH colors, gradients, shadows, glows, inline styles, local black/white utilities, and origin/open-source/self-host/infrastructure/deployment/database positioning.
- Authority/SEO/semantic source audit — **PASS**, 29 required marker matches across compiler read/filtering, canonical path use, author/category/publication/update/review metadata, semantic article/headings/time/landmarks, feed links, and explicit empty status.
- `git diff --check -- apps/web/app/blog/page.tsx` — **PASS**, exit status 0 with no output.

## Acceptance boundary

Per ticket scope, no development server, browser, E2E process, screenshot, or snapshot was started. This handoff does not claim Blyss HTTPS visual, responsive, routing, hydration, TLS, proxy, runtime accessibility, or browser acceptance. Any later user-facing acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.

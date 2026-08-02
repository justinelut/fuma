# WEB-DESIGN-008 — Templates index redesign

## Result

Redesigned the complete `/templates` index as a premium, authority-led discovery experience. The route now treats every approved template as an exact release to inspect rather than as an interchangeable marketplace card.

## Changed files

- `apps/web/app/templates/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-008.md`

No shared components, global CSS, tests, generated files, backlog/tracker files, lockfiles, or the `/templates/[slug]` route were edited.

## Design direction

- **Page job:** help a builder find an approved starting structure, understand exactly which immutable release they are inspecting, and continue to its record or isolated preview.
- **Audience:** people building Website or Publication experiences in the closed Fuma product.
- **Signature:** an editorial **release folio**. Each authority-provided capture is shown at meaningful scale in an alternating spread with its exact release ID, accessibility review standard, profile, facets, record link, and isolated-preview link. This replaces the generic repeated three-column card catalogue.
- **Visual system:** inherits the approved Plus Jakarta Sans / Inter / JetBrains Mono roles, measured display scale, section rhythm, semantic surface hierarchy, signal interaction role, rim-lit authentic media treatment, and restrained dark Fuma landing-page composition. No page-local palette or shadow language was introduced.
- **Restraint:** the release folio is the one expressive device. The release trust rail, filter controls, installed-content ledger, and closing choice use typography and rules rather than more cards or decorative effects.
- **Content:** all captures and release facts come from the public template authority. No static marketing screenshot, fabricated HTML interface, customer proof, availability claim, metric, or ranking was added.
- **Positioning:** copy describes Fuma as one closed product. It contains no self-hosting, open-source, infrastructure, deployment, database-ownership, or licence positioning.

## Preserved and strengthened contracts

- Canonical metadata remains `Templates` at `/templates` with the existing SEO description.
- `dynamic = 'force-dynamic'` remains in place.
- Search parameters still pass through `canonicalTemplateFilters`; the public read still uses those filters plus `limit: 24`.
- Every displayed result still passes `exactTemplatePreview` before rendering.
- Profile, capability, industry, and style controls retain their labels, names, defaults, and canonical input patterns.
- Cursor pagination remains at `/templates` and receives the same canonical filters.
- Authority-provided image URL, alt text, intrinsic dimensions, lazy loading, and async decoding remain intact. Web does not copy or transform release media.
- Every preview link still uses the authority-provided exact release root with `target="_blank"`, `rel="noopener noreferrer"`, and screen-reader new-tab context.
- Every item retains an internal `/templates/{slug}` record link and all authority-provided profile/capability/industry/style facets.
- Responsive source contracts retain `sm:grid-cols-2` and `lg:grid-cols-3` in the release fact layout while the overall catalogue becomes an editorial one-column folio.
- The route now distinguishes a projection outage (`AuthorityUnavailable`) from an authoritative zero-match filter result. The empty state directs the visitor to clear filters and explicitly refuses to substitute withdrawn or stale releases.
- One H1 is supplied by the shared `Hero`; section headings remain ordered and labelled. The results list, metadata groups, status states, figures, filters, and pagination retain semantic labels and landmarks.

## Focused validation evidence

Validation followed the ticket restriction: focused TypeScript/LSP, ESLint, diff, and source audits only. No full tests, build, server, E2E run, or snapshot was executed.

- Language-service diagnostics for `apps/web/app/templates/page.tsx` — **PASS**, `No diagnostics` after the final edit.
- `bunx eslint app/templates/page.tsx` from `apps/web` — **PASS**, exit status 0 with no output after the final edit.
- `git diff --check -- apps/web/app/templates/page.tsx` — **PASS**, exit status 0 with no output.
- Forbidden-style source audit for raw hex, `rgb`/`rgba`, `hsl`/`hsla`, `oklch`, inline styles, arbitrary coloured shadows, and local white/black alpha utilities — **PASS**, no matches.
- Positioning audit for self-host/open-source/MIT/database/Docker/deployment/infrastructure/source-code/licence/phone-home/vendor language — **PASS**, no matches.
- Authority source audit — **PASS**: the final page contains `canonicalTemplateFilters`, `exactTemplatePreview`, `readPublicData('templates')`, all four labelled filters, authority image `alt`/`src`, exact `item.previewUrl`, safe external-link attributes, `CursorPagination`, `AuthorityUnavailable`, and the explicit zero-match state.
- Facet source audit — **PASS**: profiles, capabilities, industries, styles, release ID, and authority accessibility standard are all rendered.

## Acceptance boundary

Per ticket scope, no browser server or screenshot was started. Therefore this handoff does not claim Blyss HTTPS visual, responsive, routing, hydration, proxy, or browser acceptance. Any later browser acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.

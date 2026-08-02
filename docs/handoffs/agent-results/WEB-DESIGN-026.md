# WEB-DESIGN-026 — Changelog index redesign

## Result

Recomposed `/changelog` as a whole-page Fuma release ledger rather than the shared editorial archive used by Blog. Eligible releases now appear newest-first on a version-and-date spine, with each compiler-approved change body rendered in place and its category, author, owner, publication date, update date, review date, exact version, and canonical detail link kept attached.

The route contains no release fixtures or promotional filler. The current corpus produces one real public entry: `public-web-foundation`, version `0.1.0`, published 26 July 2026 in the `Web` category. If no entry is eligible, the page renders a direct semantic empty state instead of placeholder releases.

## Changed files

- `apps/web/app/changelog/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-026.md`

No shared component, global style, compiler, content source, generated artifact, test, dependency, lockfile, detail route, server file, or other route was edited for this ticket.

## Design direction

- **Subject:** Fuma’s owned, public record of product releases.
- **Audience:** builders who need to identify what shipped in a specific version and when.
- **Page job:** expose the exact release sequence, preserve the complete approved change note, and provide a permanent route for each release.
- **Signature:** a **release spine**. Version and publication time form the left coordinate; a restrained ruled axis carries chronology; the complete approved change body occupies the reading field. The sequence is meaningful because public entries are already ordered newest-first by the editorial compiler.
- **Information architecture:** release-history thesis and reading key → sticky ledger introduction → ordered releases with exact coordinates and complete change notes → maintenance record and permanent release link.
- **Typography:** inherited Fuma display, body, and mono roles only. Display type identifies the release and title; mono carries version, category, chronology labels, and record labels; body type carries the shipped note.
- **Layout:** an asymmetric editorial ledger with one ordered vertical sequence, not a featured card plus card grid. Mobile collapses the coordinate and content into a natural document flow without hiding metadata.
- **Palette/effects:** semantic Fuma roles only (`background`, `foreground`, `muted`, `signal`, and line roles). The route introduces no raw color, local gradient, shadow, glow, inline style, or page-owned effect. Motion is limited to the existing globally reduced `fuma-rise` H1 treatment.
- **Aesthetic risk:** the full source-approved release note is visible directly inside the chronology instead of being reduced to a generic archive teaser. This is useful specifically for release history: a reader can scan versions and inspect changes without losing chronology.
- **Self-critique applied:** the original shared `EditorialIndex` was visually and structurally interchangeable with Blog. A first route-specific pass also prefixed the source version with a presentational “v” and omitted `reviewAt`; final review removed the prefix and restored the review date so source metadata is represented exactly.
- **Closed positioning:** the page consistently names Fuma as product and editorial authority. No self-hosting, open-source, infrastructure, deployment, database-ownership, or alternate-platform positioning was introduced.

The required `frontend-design` skill was applied after reviewing the existing changelog route, the real changelog source, the public editorial compiler/reader, the shared editorial renderer, the current Fuma global design tokens, and nearby redesigned Fuma editorial surfaces.

## Content and eligibility integrity

All release-specific content comes from `readEditorial()` and is filtered only to `entry.meta.collection === 'changelog'`. `readEditorial()` returns the compiler’s `publicEntries`, retaining its validation and eligibility boundary rather than scanning files or accepting route input locally.

For each eligible entry, the route renders:

- exact `meta.version`, without a display prefix or normalization;
- `publishedAt`, `updatedAt`, and `reviewAt` in deterministic `en-KE` UTC formatting, with source timestamps retained in `dateTime`;
- exact category, author, owner, title, description, and canonical path;
- every compiler-approved body block in source order;
- safe inline code, emphasis, links, lists, quotes, callouts, and keyboard-scrollable code blocks;
- a canonical “Permanent release note” link to the existing detail route.

The route does not invent release names, versions, dates, categories, bullets, metrics, roadmap promises, compatibility claims, or change summaries. Source fragment links inside an index-rendered release are resolved against that entry’s canonical detail path. This preserves their intended target while avoiding duplicate fragment IDs when multiple releases use headings such as “Included” or “Fixed.”

## Empty and growth states

- With eligible entries, the compiler-owned reverse-chronological order is preserved in a semantic ordered list.
- The first eligible entry receives the factual “Latest release” label; later entries receive “Release.” No independent latest-version state is maintained.
- With zero eligible entries, the page renders an H2-led `role="status"` region explaining that eligible notes appear after publication and that no placeholders are shown.
- No category filter, search box, pagination, fake year grouping, or interaction was added for the current corpus. The ordered ledger grows directly from real entries.

## SEO

- `publicMetadata` supplies an indexable canonical `/changelog` URL, Fuma social metadata, locale alternates, and feed discovery using the established public SEO boundary.
- The title and description describe the actual page contract: versioned release notes, dates, categories, and shipped changes.
- Entry links use each compiler-projected `canonicalPath`; no URL is reconstructed from untrusted or duplicated data.
- No Product, SoftwareApplication, rating, review, offer, testimonial, or other fabricated structured data was added.

## Accessibility and semantics

- One H1 identifies the page; the release ledger has its own labelled H2; each release title is an H2 within a semantic `article`.
- Releases are a semantic ordered list because their compiler-owned order carries chronological meaning.
- Each article is connected to its title with `aria-labelledby` using the validated slug.
- Source H2/H3 blocks step down to H3/H4 under the release H2, preserving a valid page-level heading hierarchy.
- Dates use `<time dateTime>`, release maintenance fields use a definition list, and the visual spine is hidden from the accessibility tree.
- External source links retain `noopener noreferrer`; code blocks are keyboard focusable and labelled.
- The canonical release action is a real link with visible shared focus treatment; the page adds no client-only interaction or hidden hydration state.
- The empty state has a labelled heading and status role while remaining useful as static document content.
- Shared reduced-motion, forced-color, focus-visible, typography, and responsive behavior remains inherited.

## Security and privacy

- The route consumes only validated compiler-owned public entries.
- No raw source Markdown, HTML injection, request value, preview entry, internal audience entry, or draft fallback is rendered.
- Body output is built from validated `EditorialBlock` variants. Links have already passed compiler validation, and fragment-only links are anchored to the entry’s canonical public path.
- No analytics call, form, client state, cookie, storage access, or third-party request was introduced.

## Focused validation evidence

Validation followed the ticket restriction. No aggregate test suite, root/full build, root/full lint, server, browser/E2E run, screenshot, or snapshot was executed.

- Language-service diagnostics for `apps/web/app/changelog/page.tsx` — **PASS**, `No diagnostics` after final metadata-preservation fixes.
- `bunx eslint 'app/changelog/page.tsx'` from `apps/web` — **PASS**, exit status 0 with no output after the final edit.
- Real public-compiler smoke via `readEditorial()` from `apps/web` — **PASS**, exit status 0. It returned exactly one eligible changelog entry: slug `public-web-foundation`, version `0.1.0`, publication/update timestamp `2026-07-26T00:00:00Z`, category `Web`, canonical path `/changelog/public-web-foundation`, three body blocks, and the real `Included` heading.
- Required provenance/semantic exact-file audit — **PASS**, 18 markers confirmed for public editorial lookup, collection filtering, metadata, exact version, all three dates, category, author, owner, canonical path, compiler blocks, time/article/ordered-list/H1/H2 semantics, and empty status; exactly one H1 source marker was found.
- Forbidden style/content/schema exact-file audit — **PASS**, zero matches for raw hex/RGB/HSL/OKLCH values, gradients, shadows, inline styles, prohibited positioning language, testimonial/rating schema, hard-coded current version/date/title, or fabricated release content.
- `git diff --check -- 'apps/web/app/changelog/page.tsx'` — **PASS**, exit status 0 with no output after the final edit.

## Acceptance boundary

Per ticket scope, no build, server, browser, E2E process, screenshot, or snapshot was started. This handoff does not claim Blyss HTTPS visual, responsive, routing, hydration, TLS, proxy, or runtime accessibility acceptance. Any later user-facing acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.

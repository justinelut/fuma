# WEB-DESIGN-009 — `/templates/[slug]`

Status: **Implemented; aggregate acceptance pending**
Date: 2026-08-01

## Changed files

- `apps/web/app/templates/[slug]/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-009.md`

No shared components, global CSS, template authority, tests, generated assets, lockfiles, other routes, backlog/tracker files, or configuration were edited. No commit or push was made.

## Result

Recovered and finished the interrupted template-detail redesign as a premium exact-release record. An approved template now has a complete authority-led page: release thesis and actions, full immutable capture, release receipt, authority facets, accessibility evidence, and version-bound product handoff. Missing, malformed, withdrawn, stale, and authority-unavailable reads all fail closed through the same generic noindex 404 and expose neither detail markup nor Product JSON-LD.

## Design direction

- **Page job:** let a Fuma builder inspect one currently approved template release, verify what is bound to it, open the isolated retained preview, or hand the stable template ID to the product.
- **Audience:** Website and Publication builders working inside the closed Fuma product.
- **Signature:** an **exact-release passport** built around the full authority-provided capture. Its release ID, approval date, isolated-preview status, installation recheck, dimensions, and byte size travel together as one factual receipt rather than as marketplace decoration.
- **Composition:** exact-release thesis → full release artifact → release receipt → fit facets and accessibility review → version-bound handoff. The large real capture is the one expressive moment; the rest uses restrained type, rules, and semantic surfaces.
- **Visual system:** inherits the established Plus Jakarta Sans / Inter / JetBrains Mono roles, measured display scale, 1280px section shell, semantic surface and line roles, state-only mint, signal emphasis, rim lighting, and reduced-motion behavior. No page-local palette, arbitrary coloured shadow, fake interface, or new global style was introduced.
- **Artifact fidelity:** Web renders `item.image.url` directly with authority alt text and intrinsic width/height. The final review removed the inherited forced 16:9 `object-cover` crop so every contract-valid image remains complete at its supplied aspect ratio. Web does not copy, optimize, or transform the release asset.
- **Content discipline:** names, summary, image, facets, accessibility standard/checks/notes, release ID, and timestamps come from `PublicTemplate`. Supporting prose describes only documented approval, preview, and installation behavior. No customer proof, ranking, metric, fabricated product UI, or invented template content was added.
- **Positioning:** the page presents one closed, Fuma-owned workflow. It contains no self-hosting, open-source, infrastructure, deployment, database-ownership, or licence positioning.

## Dynamic-state review

### Approved

- `readTemplateDetail(slug)` remains the sole authority read.
- Only `status === 'available'` renders the detail page.
- Canonical metadata uses the authority-returned exact slug, name, and summary.
- Strict `templateStructuredData(item)` emits the approved Product record without offers, ratings, or fabricated fields.
- Preview and image remain bound by the existing `exactTemplatePreview` gate inside `readTemplateDetail`.
- The external preview uses the authority URL; the shared CTA emits `target="_blank"` and `rel="noopener noreferrer"`, while screen-reader text announces the new tab.

### Missing, malformed, withdrawn, stale, and unavailable

- Every non-available result calls `notFound()` before the page can render detail markup or JSON-LD.
- `generateMetadata` returns one generic `Template unavailable` representation with `{ index: false, follow: false }` through `publicMetadata(..., true)`.
- The unavailable canonical points to `/templates`, so an invalid or unapproved slug is not reflected into canonical metadata.
- Metadata intentionally does not distinguish withdrawal history from absence or an authority outage; it is not a state or operational side channel.
- Withdrawn authority tombstones remain internal to the read decision and are never rendered.

## Preserved and strengthened contracts

- `dynamic = 'force-dynamic'` remains unchanged.
- Exact-slug authority is preserved through `readTemplateDetail(slug)`; Web performs no broad list scan and no stale fallback.
- Approved metadata canonicalizes only from `result.item.slug`; all non-approved states are generic and noindex.
- Product JSON-LD uses the existing strict `templateStructuredData` validator and appears only after an approved read.
- Both installation actions use `installTemplateHref(item.id)`, transferring only the stable template ID. No release, artifact, owner, redirect, profile, or raw bytes enter the handoff URL.
- The page explicitly states that Fuma rechecks current approval and the exact retained release before installation.
- Authority image URL, alt, byte size, intrinsic dimensions, eager priority, and async decoding remain intact; the capture is now shown uncropped.
- The approved date is formatted in `en-KE`/UTC and retains its machine-readable ISO value through `<time dateTime={item.approvedAt}>`.
- All profile, capability, industry, and style values render from the authority record in labelled groups.
- Accessibility uses a labelled `<section>`, authority standard, all three strict review checks, and every authority note. The state dot is aria-hidden and the text carries the meaning.
- Heading order is one H1 followed by section H2s; the artifact, receipt, metadata, review, and handoff use semantic `figure`, `figcaption`, `dl`, `dt`, `dd`, `section`, list, and time elements.
- Narrow layouts remain single-column; action rows wrap without forcing horizontal overflow; release IDs use safe wrapping.
- All color usage is through semantic Fuma roles. Mint is used only for the currently approved/reviewed state.

## Focused validation evidence

Validation stayed inside the ticket restriction: focused language diagnostics, ESLint, diff checks, and source audits only. No aggregate test, build, server, E2E, browser, or snapshot command was run.

- Language-service diagnostics for `apps/web/app/templates/[slug]/page.tsx` — **PASS**, `No diagnostics` after the final edit.
- `../../node_modules/.bin/eslint 'app/templates/[slug]/page.tsx'` from `apps/web` — **PASS**, exit status 0 with no output after the final edit.
- `git diff --check -- apps/web/app/templates/'[slug]'/page.tsx` — **PASS**, exit status 0 with no output.
- Final assigned-page diff summary — **210 lines changed: 176 insertions, 34 deletions** relative to the pre-ticket baseline.
- Forbidden-style/positioning audit for raw hex, `rgb`/`rgba`, `hsl`/`hsla`, `oklch`, local white/black utilities, inline styles, self-hosting, open-source, MIT, Docker, database, deployment, infrastructure, source-code, and licence language — **PASS**, no matches.
- Authority-contract audit — **PASS**, source evidence includes `readTemplateDetail(slug)`, the `result.status !== 'available'` → `notFound()` gate, generic unavailable metadata, `templateStructuredData(item)`, direct uncropped authority image fields, exact preview URL, stable-ID-only `installTemplateHref(item.id)`, release ID, machine-readable approval date, labelled accessibility section, authority notes, and announced new-tab behavior.
- Scope check — **PASS** at validation time: only the assigned dynamic page was modified; this handoff is the only additional permitted file.

## Acceptance boundary

Per ticket scope, no server was started and no browser, screenshot, hydration, proxy, TLS, or responsive runtime acceptance was performed. This handoff therefore makes no Blyss HTTPS visual or browser claim. Any later browser acceptance must use `https://3002.blyss.co.ke/templates/<approved-slug>` and must separately exercise a missing slug and a withdrawn fixture under repository policy.

Aggregate public-Web tests, build/typecheck, architecture gates, and final tracker closure remain primary-agent responsibilities.

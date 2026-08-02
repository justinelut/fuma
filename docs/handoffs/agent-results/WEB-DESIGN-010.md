# WEB-DESIGN-010 — Experts index redesign

## Result

Redesigned the complete `/experts` index as a premium, consent-backed expert discovery experience. The route now presents each authority-approved expert or studio as a public record on a continuous consent ledger rather than as an interchangeable directory card.

## Changed files

- `apps/web/app/experts/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-010.md`

No shared component, global style, test, generated file, contract, authority, detail route, backlog, tracker, dependency, or lockfile was edited.

## Design direction

- **Page job:** help someone find an expert or studio through approved public work, understand why that record is visible, and continue to a mediated introduction without mistaking directory order for endorsement.
- **Audience:** people commissioning design, development, studio, or agency work inside the closed Fuma product.
- **Signature:** a continuous **consent ledger**. A semantic signal line connects individually attributed records while each record exposes only authority-projected practice, place, approval timestamp, inquiry state, skills, services, public-work count, summary, and optional profile media. It makes revocable public consent—not card chrome—the organizing idea.
- **Visual system:** inherits the approved Plus Jakarta Sans / Inter / JetBrains Mono roles, measured display scale, section rhythm, semantic surfaces, signal interaction role, state-only live role, and restrained rim lighting. No page-local palette, gradient, inline style, or shadow language was introduced.
- **Composition:** direct thesis hero; three-part public threshold; filterable record ledger; current-authority method; and a closing path into approved work or listing contact. The one-column folio deliberately rejects the generic three-column directory grid.
- **Restraint:** the ledger line and live-state nodes are the single expressive device. Filters, facts, states, and methodology use typography and rules rather than additional cards or decorative interface simulations.
- **Content:** all person/studio names, summaries, locations, types, timestamps, skills, services, media, inquiry states, and connected-work counts come directly from the strict public expert projection. Explanatory copy reflects the documented opt-in, current-consent, moderation, availability, and mediated-inquiry authority. No person, testimonial, rating, price, ranking score, customer proof, or availability claim was invented.
- **Positioning:** copy presents Fuma as one closed, Fuma-owned product and contains no alternate product-origin or infrastructure narrative.

## Preserved and strengthened contracts

- Canonical metadata remains `Experts` at `/experts` with the existing SEO description.
- `dynamic = 'force-dynamic'` remains in place.
- The route still accepts and bounds `expertType`, `skill`, `location`, `query`, and `cursor`; the authority read remains `readPublicData('experts', { ...filters, cursor, limit: 24 })`.
- Expert type remains closed to `designer`, `developer`, `studio`, and `agency`; tag, search, and cursor validation retain the contract-compatible patterns and limits.
- The filter form retains the same labelled names and defaults. Clear-filter links return to canonical `/experts`; cursor pagination receives the same four non-cursor filters and canonical base path.
- The required H1 remains exactly `Find skilled people through approved public work.` for existing discovery acceptance.
- Every expert name remains an internal link to `/experts/{slug}`. No projected private ID is placed in visible text or a URL.
- Optional `imageUrl` is rendered only when supplied by authority, through unoptimized `next/image`; the page does not substitute invented avatars or media.
- Projected skills and services remain separate labelled semantic lists. Approval uses the projected timestamp in a machine-readable `<time>` element. Inquiry language branches only from `mediatedInquiryAvailable`.
- The connected public-work statement derives only from `showcaseIds.length`; the IDs themselves are not rendered.
- A projection outage still uses `AuthorityUnavailable` and now remains distinct from an authoritative zero-match result. The zero-match state offers canonical filter clearing and explicitly refuses opted-out, withdrawn, or stale substitution.
- Directory order is not numbered and no visual index implies ranking. Copy states the documented availability/revision basis and rejects paid or tiered placement.
- The result ledger is a labelled list of articles; each record has ordered headings, labelled metadata, semantic tag lists, optional figure/figcaption, and keyboard-visible internal links. The page retains one H1, ordered section headings, status announcements, and 320 px-safe wrapping/grid behavior.
- The public-threshold section explains current consent, availability/removal, and mediated-introduction checks without importing or reproducing private authority fields.

## Focused validation evidence

Validation followed the ticket restriction: focused language-service diagnostics, route-scoped ESLint, Git whitespace/status checks, and source audits only. No test suite, build, server, browser, E2E run, or snapshot was executed.

- Language-service diagnostics for `apps/web/app/experts/page.tsx` — **PASS**, `No diagnostics` after the final edit.
- `bunx eslint app/experts/page.tsx` from `apps/web` — **PASS**, exit status 0 with no output after the final edit.
- `git diff --check -- app/experts/page.tsx` from `apps/web` — **PASS**, exit status 0 with no whitespace errors.
- Scoped status check — **PASS**: before creating this handoff, the only scoped implementation change reported was `M app/experts/page.tsx`.
- Forbidden-style source audit for raw hex, `rgb`/`rgba`, `hsl`/`hsla`, `oklch`, inline styles, arbitrary shadows, local white/black alpha utilities, and gradients — **PASS**, no matches.
- Product-positioning source audit for disallowed origin, licensing, deployment, and infrastructure language — **PASS**, no matches.
- Private-data source audit for recipient, organization/workspace/site/owner/member coordinates, payment/transfer/internal IDs, inquiry bodies, and source/destination scope — **PASS**, no matches.
- Authority contract source audit — **PASS**: the final route contains `dynamic = 'force-dynamic'`, `readPublicData('experts'`, all five bounded query readers, `limit: 24`, all four labelled filter controls, `AuthorityUnavailable`, the explicit `No public matches` state, authority `imageUrl`, skills, services, approval timestamp, mediated inquiry state, connected showcase count, internal exact-slug links, and `CursorPagination` with canonical filters.
- Existing discovery acceptance compatibility source check — **PASS**: the required H1 text and exact-name internal expert link remain present.

## Acceptance boundary

Per ticket scope, no browser process or screenshot was started. This handoff therefore does not claim public-host visual, responsive, routing, hydration, TLS, proxy, accessibility-runtime, or browser acceptance. Any later browser acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.

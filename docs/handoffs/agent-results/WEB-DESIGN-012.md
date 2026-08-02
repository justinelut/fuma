# WEB-DESIGN-012 — Showcase index redesign

## Result

Recomposed the complete `/showcase` route as a consent-backed public-work folio. Each current authority record now receives a full-width exhibition plate with a large project title, authority-provided media, current approval receipt, exact profile and industry vocabulary, attributed expert-connection count, canonical case-study link, and explicit safe visit to the public work.

## Changed files

- `apps/web/app/showcase/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-012.md`

No shared component, global style, test, generated asset, lockfile, tracker, contract, authority implementation, or other route was edited.

## Design direction

- **Page job:** let visitors evaluate real public work at meaningful scale while making the permission and withdrawal boundary impossible to mistake for endorsement or permanent inventory.
- **Audience:** people considering Fuma, commissioning an approved expert, or evaluating what has been publicly released through the product.
- **Signature:** a continuous **public-work folio**. Every record uses the page width as an exhibition plate: oversized authority title, uncropped authority image, ruled release receipt, summary, public vocabulary, and two explicit paths. This is deliberately not a card grid, logo wall, dashboard, browser mockup, or fabricated interface.
- **Information architecture:** thesis hero → three-part public-approval threshold → canonical filter rail → full-scale authority folio → withdrawal method ledger → submission/expert close.
- **Aesthetic risk:** scale is the only expressive device. The page gives each approved work record the visual weight normally reserved for a hero rather than decorating a dense grid. Everything around it is restrained typography, semantic rules and measured spacing.
- **Design-system application:** follows the measured Fuma display/body/mono type roles, 1280px section shell, semantic surface/line/signal/live roles, restrained 500-weight display hierarchy, and full-width proof logic established by the approved homepage, `PlatformGrid`, and `CapabilityBento`. It introduces no local palette, raw color, shadow, gradient, fabricated product miniature, numbered decoration, or page-specific CSS.
- **Closed positioning:** page copy describes one Fuma-owned public authority and product. It makes no geography-origin, self-hosting, open-source, infrastructure, deployment, database, licence, or customer-ownership claims.

## Authority and content integrity

Every work-specific value comes directly from the current strict `PublicShowcase` projection:

- title, summary and canonical slug
- public profile and industry vocabularies
- authority-provided image URL
- authority-provided HTTPS preview URL
- attributed public expert-connection count derived only from `expertIds.length`
- approval timestamp from `approvedAt`, rendered deterministically in UTC

The page does not invent project names, makers, client identities, logos, industries, descriptions, metrics, awards, testimonials, ratings, outcomes, or UI screenshots. Authority imagery is rendered uncropped with empty alternative text because the contract supplies no descriptive alt-text authority; its figure caption identifies the source without pretending to describe the visual. Image requests use `referrerPolicy="no-referrer"`, lazy behavior inherited from non-priority Next Image, and no image transformation. Public-work visits are user-initiated external anchors with `target="_blank"` and `rel="noopener noreferrer"`.

The threshold copy follows the implemented showcase authority: an approved, unwithdrawn release; current expert and site-owner attribution consents; reciprocal expert/showcase binding; active owner state without a pending transfer; opted-in and available expert state; and no current suspension. The page describes removal on the next current public read rather than suggesting permanence.

## Preserved and strengthened contracts

- Route remains `dynamic = 'force-dynamic'` and reads only `readPublicData('showcases', ...)`.
- Query parsing canonicalizes scalar `profile`, `industry`, `query`, and `cursor` values against the existing bounded vocabularies; arrays, malformed values, and unknown keys do not reach authority or pagination.
- Canonical metadata remains the query-free `/showcase` URL with bounded Fuma title/description and shared social metadata.
- Safe breadcrumb JSON-LD is emitted through the shared checked `breadcrumbStructuredData(...)` builder and `jsonLd(...)` serializer.
- Search, profile and industry inputs retain their existing parameter names; cursor pagination retains all canonical active filters.
- Authority failure and authoritative zero-match results are now distinct designed states. Failure refuses stale substitution; zero matches offers a canonical clear-filter path without inventing examples.
- Every internal record link is canonical `/showcase/{slug}`. Every external preview is the authority-provided HTTPS destination and is isolated from `window.opener`.
- The authority-derived media, public status, approval time, profile/industry vocabulary and expert-connection count remain attached to one semantic article.

## Accessibility and privacy review

- One H1 labels the page; each major section has an H2; each public work article has an authority-backed H3.
- The public folio is an unordered labelled list because authority order is not presented as a meaningful sequence.
- Each article uses a labelled heading, semantic figure/figcaption, definition-list release receipt, `<time dateTime>`, and descriptive internal/external link text.
- Authority imagery is linked with an explicit accessible label; the empty image alt avoids fabricating a visual description absent from authority.
- Filter controls have visible labels, programmatic labels, bounded native patterns where applicable, keyboard-native submission, and a canonical clear action.
- Authority unavailable and empty states are live status regions. Current-state mint is used only for current approved public state.
- External image requests suppress the referrer; external navigation is explicit and opener-safe. No visitor identity, private contact route, authority coordinate, tracking hook, client script, or new storage is introduced.
- Global focus-visible and reduced-motion behavior remain intact; this server route adds no animation or client JavaScript.

## Focused validation evidence

Validation followed the ticket restriction: diagnostics, route-scoped ESLint, whitespace/file-ownership checks, and source audits only. No aggregate test, typecheck, lint, build, server, browser/E2E run, or snapshot was executed.

- Language-service diagnostics for `apps/web/app/showcase/page.tsx` — **PASS**, final result `No diagnostics`.
- `bunx eslint app/showcase/page.tsx` from `apps/web` — **PASS**, final exit status 0 with no output.
- `git diff --check -- apps/web/app/showcase/page.tsx docs/handoffs/agent-results/WEB-DESIGN-012.md` — **PASS**, final exit status 0 with no output.
- Forbidden-style/private-data/positioning audit — **PASS**, zero route-source matches for raw hex; `rgb`/`rgba`; `hsl`/`hsla`; `oklch`; inline styles; arbitrary shadows; local white/black color utilities; restricted geography/hosting/open-source/infrastructure language; private authority coordinates/identities; and fabricated ratings/testimonials.
- Contract and semantic source audit — **PASS**, confirmed canonical metadata, `force-dynamic`, strict showcase authority read, breadcrumb schema serializer, query/profile/industry names, authority-unavailable state, separate empty state, labelled unordered folio, figure/caption/time semantics, no-referrer authority media, safe external relation, withdrawal explanation, and cursor pagination.
- Final file-ownership check — **PASS**, the two ticket paths contain exactly the modified route and new required handoff.

## Acceptance boundary

Per ticket scope, no server, screenshot, browser, Playwright or E2E acceptance was run. This handoff therefore does not claim responsive rendering, image-host behavior, hydration, routing, TLS, proxy, or visual acceptance. Any later browser acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.

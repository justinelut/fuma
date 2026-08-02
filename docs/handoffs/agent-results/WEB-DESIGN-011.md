# WEB-DESIGN-011 — Expert detail redesign

## Result

Redesigned the complete `/experts/[slug]` route as a premium, authority-led expert dossier. The page now makes the expert’s current approved public record, public work linkage, published skills/services vocabulary, and mediated inquiry boundary legible without turning the profile into a generic card, marketplace listing, or invented biography.

## Changed files

- `apps/web/app/experts/[slug]/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-011.md`

No shared component, global style, test, generated asset, lockfile, backlog/tracker file, or other route was edited.

## Design direction

- **Page job:** let a visitor understand exactly what this expert has approved for public display and, when enabled, send a bounded inquiry without receiving or exposing a private contact route.
- **Audience:** visitors evaluating a person, studio, or agency through current public work rather than ratings, paid ranking, or profile-marketing filler.
- **Signature:** a continuous **public work ledger**. The hero’s profile record, ruled skill/service vocabulary, authority-derived linked-work count, approval date, and inquiry boundary read as one consent-backed dossier rather than a collection of profile cards.
- **Information architecture:** canonical breadcrumb and authority thesis → current public-record rail → exact published skills/services → consent-backed work ledger → available or closed inquiry state.
- **Visual system:** inherits the approved Fuma display/body/mono type roles, measured display scale, section rhythm, semantic border hierarchy, signal interaction role, and live-state token. It introduces no page-local palette, raw color, shadow, gradient, or decorative effect.
- **Aesthetic risk and restraint:** the oversized authority-derived linked-work count and record-like ruled layout are the single expressive device. There is no portrait assumption, avatar placeholder, badge cloud, gradient wash, floating card stack, fabricated product UI, or decorative motion.
- **Closed positioning:** copy describes Fuma as the mediator and authority boundary inside one Fuma-owned product. It does not introduce self-hosting, open-source, infrastructure, deployment, database, licence, marketplace, or commission positioning.

## Authority and content integrity

Every profile-specific value is read from the exact current `PublicExpert` projection:

- public name and summary
- expert type and location
- skills and services
- linked public-work count derived only from `showcaseIds.length`
- approval date from `approvedAt`, formatted deterministically in UTC with `en-KE`
- inquiry availability
- stable public expert ID used only by the established mediated form and application handoff

The page does not infer or invent showcase titles, biography, experience, awards, client names, ratings, testimonials, rankings, contacts, response times, availability promises, or endorsements. It intentionally does not reinterpret `imageUrl` as a portrait because the public contract supplies no descriptive alt-text authority for that asset.

The public-work explanation follows the implemented projection contract: reciprocal attribution, current expert and site-owner consent, approval, moderation, availability, ownership, and withdrawal determine continued visibility. The `/showcase` link remains a truthful general browse link; it does not imply an unsupported expert-specific showcase filter.

## Preserved and strengthened contracts

- Route remains `dynamic = 'force-dynamic'`.
- Both metadata and page rendering use `readPublicItem('experts', slug)`, preserving exact authority-filtered slug reads with no list scan or retained fallback.
- Missing, malformed, or withdrawn authority records still call `notFound()`.
- Missing/withdrawn metadata retains the unavailable title/description and passes `!item` to `publicMetadata`, preserving canonical noindex/follow-false tombstone behavior.
- Approved records continue to emit bounded expert JSON-LD, now explicitly through the shared `expertStructuredData(item)` authority and safe `jsonLd(...)` serializer.
- Canonical expert and breadcrumb links remain `/experts/{item.slug}`; directory and showcase links remain canonical public routes.
- Available inquiry still renders `ContactForm kind="expert_inquiry" expertId={item.id}` and preserves the version-bound application handoff query with the same stable public ID.
- Inquiry copy explicitly preserves the privacy boundary: Fuma receives a bounded request, rechecks approval/opt-in/moderation/ownership/availability, and never exposes private recipient/direct-contact details.
- Closed inquiry is a complete designed state with `role="status"`; it does not publish an alternate route around the expert’s choice.
- Empty public skills/services arrays and a zero linked-work count render explicit authoritative absence rather than stale or invented filler.

## Accessibility and semantic review

- One authority-backed H1 labels the profile.
- Sections use ordered H2/H3 hierarchy and explicit `aria-labelledby` relationships.
- The profile ledger is a labelled `aside`; record facts and inquiry boundaries use definition lists.
- Skills and services use semantic lists when values exist.
- The approval timestamp uses `<time dateTime={item.approvedAt}>`.
- The large public-work count includes screen-reader context rather than being hidden as decoration.
- The inquiry jump action targets the labelled inquiry section; all other controls use existing accessible shared CTA and form behavior.
- Focus and reduced-motion behavior remain inherited from the global Fuma system; this server route adds no client animation or page-local focus override.

## Focused validation evidence

Validation followed the ticket restriction: diagnostics, ticket-scoped ESLint, whitespace validation, and source audits only. No aggregate test, typecheck, lint, build, server, browser/E2E run, or snapshot was executed.

- Language-service diagnostics for `apps/web/app/experts/[slug]/page.tsx` — **PASS**, `No diagnostics` after the final refinement.
- `bunx eslint 'app/experts/[slug]/page.tsx'` from `apps/web` — **PASS**, exit status 0 with no output after the final refinement.
- `git diff --check -- 'apps/web/app/experts/[slug]/page.tsx'` — **PASS**, exit status 0 with no output.
- Forbidden-style/private-data/positioning audit — **PASS**, zero matches for raw hex; `rgb`/`rgba`; `hsl`/`hsla`; `oklch`; inline styles; arbitrary shadows; local white/black color utilities; fabricated social-proof schema keys; private authority coordinates/identities; and self-host/open-source/infrastructure/deployment/database/licence language.
- Authority contract audit — **PASS**, source contains both exact `readPublicItem('experts', slug)` calls, `force-dynamic`, `notFound()`, `publicMetadata(..., !item)`, `expertStructuredData`, safe JSON-LD, breadcrumbs, mediated `ContactForm`, stable-ID handoff, canonical `/experts` and `/showcase` links, approval `<time>`, inquiry status, and labelled semantic sections.
- Semantic source audit — **PASS**, 20 heading/section/aside/definition-list/list/time markers were found and manually reviewed for one-H1 hierarchy and labelled landmarks.

## Acceptance boundary

Per ticket scope, no browser server or screenshot was started. This handoff therefore does not claim Blyss HTTPS visual, responsive, routing, hydration, TLS, proxy, or browser acceptance. Any later browser acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.

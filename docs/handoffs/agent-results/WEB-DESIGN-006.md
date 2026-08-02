# WEB-DESIGN-006 — `/about`

Status: **Implemented; focused route validation passed, aggregate acceptance pending**
Date: 2026-08-01

## Changed files

- `apps/web/app/about/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-006.md`

No shared component, global CSS, test, generated asset, lockfile, tracker, package, other route, or product-media file was edited. No commit or push was made.

## Result

Recomposed the complete `/about` route as Fuma’s product lineage and decision record rather than a generic company-values page. The route now explains how lessons from Motion.page and Core Framework converge in one Fuma-owned product, which product decisions follow from that experience, where authority boundaries remain, and why a substantial 0.0.x product is still explicitly pre-1.0.

The prior Kenya-first/Nairobi-origin narrative and `kenya-context` receipt are absent from the route. Fuma is presented as a closed product built and operated by Fuma, with no self-hosting, open-source, deployment, database-ownership, infrastructure-ownership, Docker, PostgreSQL, MIT, Nairobi, Kenya, or Kenyan-origin language.

## Design rationale

- **Subject and audience:** the page is about the product team’s accumulated craft and the choices that shaped Fuma, for professional website builders evaluating both product intent and operating boundaries.
- **Single job:** answer “why does this product exist, and what kind of product is it?” without turning About into a founder biography, a corporate timeline, or a feature catalogue.
- **Visual signature:** a rim-lit lineage rail carries two truthful bodies of prior work—Motion.page and Core Framework—into Fuma. This is the page’s one expressive device; the remaining page uses restrained editorial typography, semantic rules, definition lists, and measured asymmetry.
- **Semantic correction:** the lineage is a convergent set rather than a chronological process, so its final implementation uses an unordered list. Genuine product choices and roadmap statements use definition-list semantics rather than ornamental numbering.
- **No fabricated media:** no team photography or product interface was introduced because no approved About-specific asset exists. The page uses a truthful product-lineage diagram rather than stock imagery, fake product UI, invented customer proof, or decorative dashboard chrome.
- **Narrative:** question-led thesis → product lineage → Fuma-owned fact ledger → team experience → product decisions → governed workflow receipt → pre-1.0 roadmap honesty → Pixelarticons credit → trust-boundary close.
- **System alignment:** the route uses the approved homepage’s full-width `PageMain`, `.section` rhythm, display/lede scale, semantic surface roles, `FactStrip`, `SectionHead`, governed `ClaimList`, global `fuma-bloom`/`fuma-rimlit` effects, and the PlatformGrid/CapabilityBento discipline of showing truthful system structure rather than generic cards.
- **Restraint:** no new palette, local effect, animation runtime, component, CSS rule, arbitrary colour, white/black alpha utility, or route-specific media was added. Signal colour marks the lineage’s Fuma convergence; mint is not used decoratively.

## Content, SEO, and accessibility preserved

- `publicMetadata(..., '/about')` remains the metadata authority and therefore preserves canonical/open-graph/Twitter handling. The description now describes the unified Fuma product without geographic-origin branding.
- Required route links remain present: `/blog`, `/contact`, and `/trust`. The page also provides useful `/changelog` and external Pixelarticons destinations.
- The governed `single-workflow` receipt remains rendered through `ClaimList`; mutable commercial, identity, and marketplace facts are described as authority-owned rather than duplicated on the page.
- Existing README-backed claims are retained: the team lineage, Core Framework integration, 0.0.x stage, shipped capability categories, roadmap direction, and Pixelarticons credit.
- Pre-1.0 honesty is explicit: APIs and workflows can still shift, waiting for 1.0 is presented as reasonable, and roadmap items are not described as shipped.
- The source has one H1, the H1 precedes all H2s, lineage content is a list, product decisions and roadmap items are definition lists, the external credit link has safe `target`/`rel`, decorative rail marks are hidden from assistive technology, and all primary content is server-rendered.
- Required geographic SEO language still owned by shared metadata/route infrastructure was not modified; this ticket removes only About-page origin branding and does not create a second SEO authority.

## Focused validation evidence

Validation followed the ticket’s explicit diagnostics/ESLint/source-audit-only boundary.

- Language-service diagnostics for `apps/web/app/about/page.tsx` — **PASS**, `No diagnostics`.
- `../../node_modules/.bin/eslint app/about/page.tsx` from `apps/web` — **PASS**, exit 0 with no output.
- `git diff --check -- apps/web/app/about/page.tsx` — **PASS**, exit 0.
- Forbidden-source audit — **PASS**, no matches for raw hex, RGB/RGBA/HSL/OKLCH values, local `white`/`black` colour utilities or alpha variants, inline style objects, Nairobi/Kenya/Kenyan branding, self-host/open-source/MIT language, Docker/PostgreSQL, or database/infrastructure-ownership positioning.
- Route-contract source audit — **PASS**, confirmed `/about`, `/blog`, `/contact`, `/trust`, `single-workflow`, exactly one source H1, `0.0.x`, “APIs and workflows can still shift”, and “Built and operated by Fuma”.
- Final scoped diff review — **PASS**; route diff is limited to `apps/web/app/about/page.tsx`, with this handoff as the only required companion artifact.

## Pending primary-agent checks

Not run because this stage explicitly prohibited full tests, builds, servers, browser runs, and snapshots and limited validation to focused diagnostics, ESLint, and source audits:

1. aggregate Web typecheck after all parallel route edits
2. focused/aggregate acquisition contract tests, especially `apps/web/tests/public-web-acquisition-pages.test.tsx` and link/SEO governance checks
3. production build and design-token/policy gates
4. browser acceptance only through `https://3002.blyss.co.ke/about`, including 320 px and desktop containment, 200% zoom, keyboard/focus order, reduced motion, forced colours, no-JavaScript semantics, hydration/console review, and whole-page visual critique
5. cross-route review against the final homepage, Website, Publication, Features, Solutions, Pricing, and shared shell after all concurrent edits settle

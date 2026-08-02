# WEB-DESIGN-005 — Solutions page redesign

## Result

Recomposed the complete `/solutions` route around a single outcome-led decision: whether designed pages or recurring entries set the publishing rhythm. The route now presents Website and Publication as starting orientations inside one Fuma platform, not tiers, editions, or product forks.

## Changed files

- `apps/web/app/solutions/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-005.md`

No shared components, global CSS, tests, generated assets, lockfiles, tracker files, or other routes were edited.

## Design rationale

- **Page job:** help a visitor choose a starting path without forcing them through a feature catalogue.
- **Visual signature:** a decision fork built around the question “What changes most often after launch?” It branches into two large, truthful working surfaces—designed pages and recurring entries—then resolves into a compact comparison guide and the shared platform beneath them.
- **Authentic product proof:** the two branches use only existing captures: `/product/site.webp` and `/product/content.webp`, each in a labelled figure with descriptive alt text and caption.
- **Narrative:** thesis hero → decision fork → shared capability ledger → stack consolidation → low-pressure path close → approved claim receipts.
- **Restraint:** removed the generic six-audience card grid and generic fact strip. The path fork is the sole expressive device; the remainder uses disciplined typography, rules, semantic surfaces, and ordered workflow rows.
- **Positioning:** copy consistently describes one closed Fuma product and avoids self-hosting, infrastructure ownership, open-source, availability, customer-logo, or invented-metric claims.
- **Contracts preserved:** canonical metadata remains `/solutions`; `/website` and `/publication` remain present; approved `single-workflow` and `kenya-context` receipts remain rendered; one H1 precedes all H2s.

## Validation

### Static and focused tests

- `bunx eslint app/solutions/page.tsx` — PASS, no output.
- `bun run typecheck` — PASS; Next route types generated and `tsc --noEmit` completed.
- `bun test tests/public-web-acquisition-pages.test.tsx tests/public-web-links.test.ts` — PASS, 11 tests / 108 expectations / 0 failures. This includes the `/solutions` canonical, required links, claim IDs, one-main/one-H1 heading contract, internal route resolution, Next Link usage, and horizontal containment guard.
- Language-service diagnostics for `apps/web/app/solutions/page.tsx` — PASS, no diagnostics.
- Source policy audit for raw hex, `rgb`/`rgba`, `oklch`, inline styles, local white/black alpha utilities, and arbitrary coloured shadows — PASS, no matches.

### Blyss HTTPS browser checks

Host: `https://3002.blyss.co.ke/solutions`

Measured at 320, 390, 768, 1024, 1440, and 1600 px:

| Width | HTTP | Document overflow | H1 | H2 | Website links | Publication links |
|---:|---:|---:|---:|---:|---:|---:|
| 320 | 200 | 0 px | 1 | 5 | 5 | 5 |
| 390 | 200 | 0 px | 1 | 5 | 5 | 5 |
| 768 | 200 | 0 px | 1 | 5 | 5 | 5 |
| 1024 | 200 | 0 px | 1 | 5 | 5 | 5 |
| 1440 | 200 | 0 px | 1 | 5 | 5 | 5 |
| 1600 | 200 | 0 px | 1 | 5 | 5 | 5 |

A no-JavaScript sweep returned the same complete semantic heading and path-link structure with zero overflow at all widths. A 1440px full-page capture was also reviewed from the Blyss host; hierarchy, path comparison, real product figures, capability ledger, close, and footer rendered coherently.

## Blocker / acceptance limitation

The route produced **zero Playwright `pageerror` events**, but the shared public dev host does not provide a completely clean browser console. At every width it emitted host-level noise unrelated to this route:

1. Cloudflare injects `static.cloudflareinsights.com/beacon.min.js`, while the repository CSP allows scripts only from `self`/`unsafe-inline`, so the injected beacon is blocked.
2. Next development mode reports that CSP blocks its eval-based debugging helper.
3. The Blyss proxy returns 502 for the Next development HMR WebSocket.
4. With JavaScript disabled, the injected development HMR chunk is still reported as a CSP-blocked request.

Resolving those messages requires shared CSP/proxy/runtime configuration outside this ticket’s strict file ownership. The route itself returned 200, had zero page exceptions, loaded its semantic content, and had zero horizontal overflow at all required widths. Full “zero console/request errors” acceptance remains blocked on running the Blyss endpoint against a correctly configured production Web runtime or fixing the shared dev-host CSP/HMR setup.

No commit or push was made.

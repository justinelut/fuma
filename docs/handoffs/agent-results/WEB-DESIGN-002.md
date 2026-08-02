# WEB-DESIGN-002 — Website page redesign

## Status

Implemented; focused route validation passed. Aggregate closure remains with the primary agent. The public Blyss host has a development/CSP console-noise blocker documented below.

## Changed files

- `apps/web/app/website/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-002.md`

No shared component, global style, test, generated asset, tracker, lockfile, or other route file was edited. No commit or push was created.

## Design rationale

The previous route repeated three equal text/image splits and ended in a generic card grid. The new page is a complete Website journey with a deliberate `Shape → Systemise → Structure → Release` sequence. The numbering is functional because these are actual stages, not ornamental section labels.

The route-specific signature is truthful product continuity: the same Atelier Nia site appears first in the real multi-breakpoint Fuma Studio canvas, then as structured content in the real Data workspace, and finally as authentic rendered public output. The product evidence carries the visual weight; typography, hairlines, and asymmetrical editorial grids explain the journey without fabricating product UI.

The new composition preserves:

- Canonical metadata title, description, and `/website` canonical.
- The required create-site handoff and Publication comparison link.
- Existing `/features`, `/templates`, and `/showcase` destinations.
- Governed `clean-output` and `owned-form-data` claims.
- One `main`, one `h1`, ordered semantic headings, labelled figures, real captions, alt text, and meaningful server-rendered content.
- Closed Fuma-owned positioning with no self-hosting, open-source, deployment, infrastructure-ownership, or database-ownership language.
- Existing semantic Tailwind/global theme roles only; no raw colour values, local white/black alpha utilities, coloured arbitrary shadows, or inline colour styles.

Authentic captures used from `apps/web/public/product/`:

- `/product/site.webp`
- `/product/data.webp`
- `/product/built-with-fuma.webp`

## Focused validation

Run from `apps/web` unless noted.

- `bunx eslint app/website/page.tsx` — passed, exit 0.
- `bun run typecheck` — passed; Next route types generated and `tsc --noEmit` completed.
- `bun test tests/public-web-acquisition-pages.test.tsx tests/public-web-governance.test.ts` — passed: 11 tests, 110 assertions, 0 failures. This covers canonical metadata, required links, governed claims, semantic document structure, labelled authentic media, and internal-link governance.
- LSP diagnostics for `apps/web/app/website/page.tsx` — no diagnostics.
- Forbidden source-pattern audit for raw colours, white/black alpha utilities, inline colour declarations, and disallowed positioning language — no matches.
- `file public/product/site.webp public/product/data.webp public/product/built-with-fuma.webp` — confirmed committed WebP captures at 1600×1121, 1600×1000, and 1440×2392.

### Blyss HTTPS browser evidence

Target: `https://3002.blyss.co.ke/website` using native Linux ARM64 Playwright/Chromium.

Forced-loaded-image audit at 320, 390, 768, 1024, 1440, and 1600 px passed at every width:

- HTTP 200.
- Zero document overflow (`body.scrollWidth` and `documentElement.scrollWidth` never exceeded viewport width).
- Zero `pageerror` events.
- Zero same-origin failed responses, excluding the development-only HMR endpoint.
- Exactly one `main`, one `h1`, and eight `h2` elements.
- All three authentic product images loaded with non-zero natural width.
- Required links and canonical were present in the preceding semantic audit.

No-JavaScript checks at 390 and 1440 px passed:

- HTTP 200.
- One semantic `main`.
- Correct `Build the site. Keep the craft.` h1.
- Create-site link remained actionable.
- More than 5,600 characters of meaningful server-rendered page content remained available.

Full-page captures were visually reviewed at 390 and 1440 px from `/tmp/website-loaded-390.png` and `/tmp/website-loaded-1440.png`; they are temporary evidence and were not added to the repository.

## Blocker / environment note

A strict all-console-error audit is blocked by the current public host running Next in development mode behind Blyss/CSP. Every viewport emits the same three environment-level messages:

1. Cloudflare Insights beacon blocked by the site's `script-src` CSP.
2. React development debugging `eval()` blocked by CSP.
3. Next HMR WebSocket handshake returning 502 through Blyss.

These are not caused by `/website`: the route-level audit has zero page exceptions and zero non-HMR same-origin failed responses. Resolving the console noise requires the primary agent or environment owner to validate a production Web process and/or align global CSP/proxy behavior; both are outside this ticket's strict ownership of `apps/web/app/website/page.tsx`.

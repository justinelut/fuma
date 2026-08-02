# WEB-DESIGN-003 — Publication route redesign

## Status

Implemented; aggregate pending.

## Changed files

- `apps/web/app/publication/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-003.md`

No shared component, global CSS, test, generated asset, lockfile, tracker, or other route file was changed.

## Design rationale

The previous route repeated three interchangeable text-and-screenshot capability bands and ended in generic grids. The redesign treats a publication as recurring editorial work rather than a collection of features.

- **Signature:** a four-part editorial-cycle rail—Structure, Draft, Scheduled, Published—ends with “Publish. Repeat.” so the page’s organizing idea is the work returning, not a decorative motif.
- **Hero:** an asymmetric thesis and compact evidence ledger establish audience, workflow states, role authority, and audit accountability without invented statistics.
- **Product evidence:** the committed `content.webp`, `data.webp`, and `users.webp` captures are the only UI shown. Each is rendered through the shared `ProductShot` figure with an explicit authentic-capture caption and descriptive alt text.
- **Composition:** the Collections capture is the primary near-full-width proof; Data and Users support later chapters with different proportions. Typographic ledgers replace generic card grids for publication types, workflow, and evidence links.
- **Positioning:** copy remains closed and Fuma-owned. It avoids self-hosting, infrastructure, open-source, unsupported availability, customer, and invented performance language.
- **Semantics:** one `h1`, ordered workflow steps, definition lists for evidence and audience fit, static internal links, server-rendered meaning, and the existing approved claim receipts are preserved.
- **Theme discipline:** only existing semantic Tailwind/global roles are used. The page contains no raw hex/RGB/OKLCH values, white/black alpha utilities, arbitrary coloured shadows, or inline colour styles.

Canonical metadata remains `https://fuma.co.ke/publication`. Required links and approved `draft-isolation` / `clean-output` claims remain present.

## Focused validation

### Source and type validation

- `bunx eslint app/publication/page.tsx` — **pass**
- `bun run typecheck` (`next typegen && tsc --noEmit`) — **pass**
- LSP diagnostics for `apps/web/app/publication/page.tsx` — **none**
- Forbidden-colour/source grep for raw hex, RGB(A), OKLCH, white/black utilities, and inline colour — **no matches**

### Focused functional tests

Command:

```sh
bun test tests/public-web-acquisition-pages.test.tsx tests/public-web-links.test.ts
```

Result: **11 passed, 0 failed, 108 expectations**. This covers canonical metadata, required route links, approved claims, semantic document structure, labeled real product figures, internal route resolution, Next Link usage, and the existing horizontal-containment guard.

### Blyss HTTPS browser evidence

Host: `https://3002.blyss.co.ke/publication`

Widths checked: **320, 390, 768, 1024, 1440, 1600**.

Hydrated-and-scrolled result at every width:

- HTTP **200**
- exactly one `h1`
- **zero page exceptions**
- **zero horizontal overflow** (`document.scrollWidth === document.clientWidth`; body also contained)
- all three product captures completed with `naturalWidth: 1600`

No-JavaScript result at every width:

- HTTP **200**
- **zero browser errors**
- **zero horizontal overflow**
- one `h1`, eight `h2` elements, three semantic figures
- required start and Website comparison links present
- full page copy remains server-rendered (approximately 5.1k visible-text characters)

The 390 px and 1440 px full-page renders were also reviewed manually from temporary screenshots; typography, section order, responsive stacking, controls, evidence captions, and footer containment remained coherent.

## Blocker / environment note

Strict **zero console errors with JavaScript enabled** cannot be claimed on the current public development host. At all six widths, the host emits the same three route-independent infrastructure errors:

1. Cloudflare injects `static.cloudflareinsights.com/beacon.min.js`, which the site CSP blocks.
2. React development mode reports that CSP disallows `eval()` used by development debugging.
3. the proxied Next development HMR WebSocket at `wss://3002.blyss.co.ke/_next/webpack-hmr` returns HTTP 502.

There are no page exceptions or route-specific console errors, and the hydrated route/image/overflow checks pass. Resolving these remaining console messages requires production-host/proxy/CSP ownership outside the strictly assigned `publication/page.tsx` file. The no-JS six-width sweep has zero console errors.

## Not run

Per ticket scope, no root unfiltered test, build, or lint command was run; no visual snapshot test was added. No commit or push was created.

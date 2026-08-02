# WEB-DESIGN-004 — `/features`

Status: **Implemented; aggregate pending**
Date: 2026-08-01

## Changed files

- `apps/web/app/features/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-004.md`

No shared components, global styles, tests, generated assets, lockfiles, other routes, or tracker files were edited. No commit or push was made.

## Design rationale

The previous route repeated six large alternating capability sections. The replacement tells one product-led build → structure → organise → govern → publish story.

Its content-specific signature is a genuine ordered **working loop**: the hero establishes the five stages, and the page follows that sequence through a product ledger rather than repeating bento cards. The real Pages workspace is the opening visual proof; the real Data workspace anchors the content model; the real dashboard closes the operational loop. Sparse Media, Plugins, and Users captures were deliberately not enlarged into filler. Their claims are expressed as precise typographic ledgers instead.

The page preserves:

- canonical title, description, and `/features` metadata
- required `/website`, `/publication`, and `/start?kind=sign_up&source=solution` links
- existing `/plugins`, `/trust`, `/status`, and `/docs` paths
- approved `single-workflow` and `owned-form-data` claim receipts
- factual module, parameter, content-model, media, plugin-sandbox, permissions, operational dashboard, import, and publishing claims
- one semantic `h1`, ordered `h2` sections, meaningful server-rendered content, and no-JavaScript navigation
- closed Fuma-owned positioning

Only existing semantic theme roles and global utilities are used. Product imagery is limited to authentic committed captures under `apps/web/public/product/`: `site.webp`, `data.webp`, and `dashboard.webp`.

## Focused validation

Run from `apps/web` unless noted.

### Source checks

- `bunx eslint app/features/page.tsx` — **pass**, no output
- `bun run typecheck` — **pass** (`next typegen` and `tsc --noEmit`)
- forbidden-source audit for raw hex, `rgb`/`rgba`, `oklch`, white/black alpha utilities, inline styles, and disallowed self-host/open-source positioning — **pass**, no matches

### Focused tests

```sh
bun test tests/public-web-acquisition-pages.test.tsx tests/public-web-links.test.ts
```

Result: **11 passed, 0 failed, 108 expectations**. This includes the `/features` canonical, required links, approved claims, semantic document structure, internal-link resolution, Next Link routing, and horizontal-containment guard.

### Blyss HTTPS browser acceptance

Host: `https://3002.blyss.co.ke/features`

| Width | HTTP | Main | Overflow | Product images | Page errors | Unknown console errors |
|---:|---:|---:|---:|---:|---:|---:|
| 320 | 200 | 1 | 0 px | 3/3 | 0 | 0 |
| 390 | 200 | 1 | 0 px | 3/3 | 0 | 0 |
| 768 | 200 | 1 | 0 px | 3/3 | 0 | 0 |
| 1024 | 200 | 1 | 0 px | 3/3 | 0 | 0 |
| 1440 | 200 | 1 | 0 px | 3/3 | 0 | 0 |
| 1600 | 200 | 1 | 0 px | 3/3 | 0 | 0 |

Visual review was performed on full-page Blyss captures at 390 and 1440 px. A second sweep forced all lazy captures into view and verified each had a non-zero natural width.

No-JavaScript check at 390 px: **pass** — HTTP 200, expected `h1`, 9 `h2` headings, 9 main links, core narrative present, and 0 px overflow.

## Blocker / environment note

The Blyss endpoint is serving Next development mode behind the public proxy. At every width it emits the same three host-level console errors, unrelated to this route:

1. Cloudflare Insights beacon injection is blocked by the site's `script-src` CSP.
2. React development-mode `eval()` diagnostics are blocked by the same CSP.
3. The proxied `/_next/webpack-hmr` WebSocket handshake returns 502.

There are **zero page exceptions and zero unknown/page-originated console errors**, but literal zero total console errors cannot be claimed on this dev host until the public preview/proxy CSP and HMR configuration is corrected or the endpoint serves a production preview. Those files are outside this ticket's strict ownership.

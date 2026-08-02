# FUMA-WEB-012 — final conductor acceptance

**Conductor:** primary integration pass
**Accepted:** 2026-08-01
**Verdict:** **Code-complete and conductor-closed.** This is repository/public-acceptance closure for FUMA-WEB-012 only. It is not FUMA-WEB-018, protected production, DNS, legal, monitoring, on-call, publication, signing, scanning, or unified-launch approval.

## Delivered system

The public Web now uses one original Fuma hero-to-footer grammar across all 37 completed route families. The homepage mounts one narrow product-canvas island over authentic Fuma captures (`/product/site.webp`, `/product/content.webp`, `/product/dashboard.webp`). The first scene and the surrounding narrative are server-rendered and remain meaningful without JavaScript. Labelled roving tabs support pointer, Arrow keys, Home, and End.

The Motion runtime is deliberately deferred until a person requests a stage change. `motion` remains exact-pinned at `12.43.0`; `framer-motion` is no longer a direct dependency. The deferred panel alone imports `LazyMotion`, `domAnimation`, `useReducedMotion`, and `motion/react-m`, uses layout/opacity/transform transitions, and makes reduced-motion stage changes immediate. The lightweight server/hydration shell renders the initial linked tab panel and a semantic fallback while the interaction chunk loads.

## Closure of the seven review blockers

1. **Dead Motion island:** closed. `home-hero.tsx` mounts `MotionProductCanvasIsland`; `motion-product-canvas.tsx` owns accessible tabs and the SSR panel; `motion-product-panel.tsx` owns the deferred Motion runtime.
2. **Fabricated status:** closed. The static “All services online” state is gone; the shell exposes only neutral `Service status` navigation.
3. **44px mobile targets:** closed across shared buttons, menu trigger/close, consent choices, route actions, product tabs, and mobile header actions. At the narrowest text-zoom state duplicate header auth actions defer to the mobile sheet, which contains both actions.
4. **Token-reference drift:** closed by reconciling the measured display scale, tracking, section-edge padding/effective rhythm, and compact-desktop/44px-mobile target contract in `docs/reference/fuma-web-design-system.md`. Production remains on semantic `globals.css` roles and generated Fuma tokens.
5. **Animation dependency/bundle:** closed. Only `motion` is direct and exact-pinned; the root lock was updated through `bun remove framer-motion`. The Motion runtime is interaction-loaded, native reviewed images avoid a shared image client runtime, desktop disclosure navigation no longer ships Radix navigation-menu code, and the utility mono role uses a native system stack so the authoritative budgets pass.
6. **Unsupported commercial claims:** closed. “One bill”, “no hidden per-seat surprises”, and the mutable availability phrase are absent from production presentation. Pricing copy is authority-bounded.
7. **Dedicated acceptance:** closed with `tests/fuma-web-012-visual-system.test.tsx`, `tests/public-web-accessibility-contracts.test.ts`, and `e2e/fuma-web-012-visual.e2e.ts`. Coverage is functional/source-contract based; there are no screenshots, snapshots, or subjective motion-polish assertions.

## Validation evidence

From `apps/web`:

- focused contract command: **13 passed, 0 failed, 140 assertions**;
- complete Web suite: **126 passed, 0 failed, 836 assertions** across 26 files;
- `bun run typecheck`: passed;
- `bun run lint`: passed;
- `bun run build`: passed, including token currency/editorial generation and **43/43** generated pages;
- final focused Playwright at `https://3002.blyss.co.ke`: **3/3 passed** (keyboard/ARIA/44px targets, reduced-motion panel with zero active narrative animation, meaningful JavaScript-disabled initial scene).

Final public-host matrix:

- widths **320, 390, 768, 1024, 1440, 1600**: HTTP 200, one H1, zero document overflow, zero broken images, zero page errors, zero application console errors;
- CSP present and contains no `unsafe-eval`;
- 320px with **200% text**: zero overflow; mobile sheet opens and Escape closes it;
- forced colors: H1 and product tabs remain visible;
- desktop navigation: hover opens, pointer travel into the panel remains open, native Enter/Space open, Escape closes and restores focus;
- the Blyss/Cloudflare proxy may inject its own analytics beacon; the application CSP intentionally blocks that unapproved external script rather than permitting third-party collection.

Final acquisition transfer measured from browser `encodedBodySize`, including preloaded native images and CSS-initiated fonts:

| Route | JavaScript | Images | Fonts | Limits | Result |
|---|---:|---:|---:|---:|---|
| `/` | 176,215 B | 39,956 B | 75,704 B | 180k / 350k / 100k | Pass |
| `/website` | 176,215 B | 39,956 B | 75,704 B | 180k / 350k / 100k | Pass |
| `/publication` | 176,215 B | 58,024 B | 75,704 B | 180k / 350k / 100k | Pass |
| `/features` | 176,215 B | 39,956 B | 75,704 B | 180k / 350k / 100k | Pass |
| `/solutions` | 176,215 B | 58,024 B | 75,704 B | 180k / 350k / 100k | Pass |
| `/about` | 176,215 B | 39,956 B | 75,704 B | 180k / 350k / 100k | Pass |

Final standalone acceptance process:

- URL: `https://3002.blyss.co.ke`
- PID: `3735298`
- PID file: `/home/ubuntu/workspace/instatic/.tmp/fuma-web-012-web.pid`
- log: `/home/ubuntu/workspace/instatic/.tmp/web-prod.log`

## Boundaries retained

Marketplace presentation does not own ranking, review, moderation, consent, inquiry routing, installation, cache, session, or persistence authority. Experts remain opt-in people/studios; showcases remain approved work; plugins remain reviewed backend extensions; components remain reviewed client presentation releases; component-pack routes remain aliases of the same reviewed component catalog. Missing or withdrawn authority continues to fail closed.

FUMA-WEB-018 and FUMA-085 remain open. No commit, push, protected publication, provider mutation, DNS change, launch declaration, or production approval was performed.

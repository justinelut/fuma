# Fuma public-web visual and Motion direction

Status: **approved roadmap amendment; implementation belongs to FUMA-WEB-012 and acceptance to FUMA-WEB-018**.

Date researched: 2026-07-28.

This direction applies to the independent `apps/web` marketing service: the homepage, Website, Publication, features, solutions, about, pricing, templates, experts, showcases, plugins, components/component packs, editorial surfaces, trust/legal/contact/status pages, and the shared header/footer. It does not change Studio styling, tenant-site styling, authority ownership, or the one-root-lock rule during the current SITE/MCP checkpoint.

## Reference, not reproduction

The current official Framer homepage was reviewed as a product-marketing reference. Its useful structural lessons are:

1. one large, direct hero promise anchored by a real product interface rather than abstract decoration;
2. shipped-work proof immediately after the hero;
3. alternating product demonstrations that explain one capability at a time;
4. a compact platform-evidence area for performance, CMS, SEO, collaboration, hosting and analytics;
5. real community and customer proof;
6. a second high-conviction product CTA before a dense, useful footer.

Fuma must produce an original Kenyan product identity from those principles. It must not reproduce Framer's exact composition, copy, interface chrome, assets, illustrations, branded interactions, spacing values, typeface, colors, or trade dress. Framer screenshots/assets are not Fuma production assets. Only owned Fuma/Instatic product captures, approved customer/showcase media, honest placeholders, and canonical brand tokens may ship.

The reference was analyzed through public official Web content. Repository policy permits Playwright screenshots and browser acceptance only against the matching Blyss HTTPS service, so no third-party Framer Playwright screenshot is accepted as repository evidence.

## Original Fuma system

### Narrative hierarchy

- **Hero:** one outcome-led H1, short supporting copy, one primary and one bounded secondary action, plus an owned Fuma product-canvas demonstration. Do not decorate an empty hero with generic gradient orbs.
- **Proof strip:** approved sites, templates, or customer evidence. If authority-backed evidence is unavailable, show an honest unavailable state rather than invented logos, quotes, or metrics.
- **Product chapters:** large editorial sections for visual building, reusable/private AI-created components, content/publication, publishing/performance, domains, collaboration, and governed extensions. Each chapter uses real interface evidence and a distinct layout instead of repeating identical cards.
- **Platform proof:** compact measurable facts only when backed by approved authority; performance and reliability claims link to evidence.
- **Ecosystem proof:** experts, showcases, plugins and components retain distinct human/artifact/trust semantics.
- **Final CTA:** return to the product canvas and the exact public-to-app handoff; do not invent urgency or social proof.
- **Footer:** dense, accessible, responsive navigation grouped by product, use case, resources, ecosystem, trust/legal, and company; include status and policy links without overwhelming mobile readers.

### Visual craft

- Use `@fuma/brand` and generated `@fuma/design-tokens` as the source of truth. A page may create a route-specific composition, not a parallel palette.
- Use an editorial display scale, disciplined measure, strong alignment, alternating open and dense rhythm, deliberate asymmetry, and product media at meaningful scale.
- Prefer full-width product scenes, typographic transitions, split narratives, comparison bands and evidence rails over a page made entirely of rounded cards.
- Avoid AI-design tropes: aggressive gradient backgrounds, decorative glowing blobs, fake glass, excessive pills, emoji bullets, identical three-card rows, random rounded rectangles, meaningless dashboard charts, invented testimonials/statistics, filler sections, generic stock people, and motion on every element.
- Use real Pixelarticons or approved app-local icons where appropriate; never substitute emoji or copied Framer assets.
- Preserve semantic landmarks, heading order, keyboard order, visible focus, 44 px mobile targets, `text-wrap: balance/pretty` where appropriate, high contrast, zoom resilience, and content without JavaScript.

## Motion for React

The implementation must add the official `motion` package at an exact reviewed version and import React APIs from `motion/react`. The dependency is not currently present and must not be added during the active SITE-002/SITE-007/FUMA-066 checkpoint; its later addition is a conductor-owned, explicit root-lock update.

Use Motion to explain hierarchy and product behavior, not to make the page continuously move:

- orchestrated hero copy/product-canvas entrance;
- interruptible product-canvas state changes;
- restrained reveal/stagger for shipped-work or evidence rails;
- layout/shared-layout transitions for filters, tabs and component previews;
- scroll-linked effects only where they clarify progression and remain compositor-safe;
- exit/overlay transitions where state genuinely leaves the interface.

Implementation rules:

1. keep page structure and primary content server-rendered; Motion lives in narrow client islands;
2. prefer `LazyMotion`/feature loading and tree-shake imports to stay within the existing JavaScript budget;
3. support `useReducedMotion` and CSS `prefers-reduced-motion`; reduced mode removes parallax, continuous movement, large transforms and nonessential stagger while preserving content/state;
4. no hydration-dependent hidden primary content, animation-caused layout shift, scroll hijacking, autoplay audio, pointer-only interaction, or animation required to understand/operate a control;
5. animate transform/opacity where possible, cap long-running work, pause off-screen/hidden activity, and preserve low-end Kenyan mobile performance;
6. simple color/focus transitions may remain CSS; narrative, layout, gesture and scroll animation use `motion/react` rather than a second animation runtime.

## Route-level composition

The homepage establishes the shared standard from hero through footer. Other routes inherit its type, spacing, media treatment, header/footer and motion grammar while varying their narrative:

- Website/Publication/features/solutions use product chapters and concrete workflows;
- pricing/templates use decision clarity rather than spectacle;
- experts/showcases use human and work evidence;
- plugins/components/component packs foreground exact trust tier, publisher, permissions and preview evidence;
- trust/legal/security/status/contact remain calm and readable, with motion limited to state feedback;
- editorial pages privilege reading and navigation over animated decoration.

## Acceptance

FUMA-WEB-012 must implement the shared system and refreshed route compositions. FUMA-WEB-018 must reject launch unless:

- no page is a distinctive Framer copy and all production visual assets are owned/approved;
- hero-to-footer hierarchy is coherent across desktop and mobile without repeated-template monotony;
- every claim, customer, product screenshot, statistic and example has authority/provenance or an honest unavailable state;
- `motion/react` is the sole React narrative/layout animation library, exact-pinned, budgeted, and confined to justified client islands;
- keyboard, screen-reader, forced-colors, 200% zoom, 320 px width, reduced-motion and no-JavaScript content checks pass;
- LCP/CLS/INP and JavaScript/image/font budgets pass on the Kenyan low-end mobile profile;
- Playwright captures deterministic desktop, mobile and reduced-motion baselines only from `https://3002.blyss.co.ke`, with clean console/network evidence and no localhost substitution;
- the homepage, Website, Publication, features, solutions, pricing, templates, experts, showcase, plugins, components/component packs, trust and representative editorial pages receive visual review.

## Sources

- Official Framer homepage, reviewed 2026-07-28: `https://www.framer.com/`
- Official Motion for React quick start, reviewed 2026-07-28: `https://motion.dev/docs/react-quick-start`
- Repository browser policy: `CLAUDE.md`
- Existing Fuma public-web implementation and evidence: `docs/reference/fuma-public-web-implementation.md`

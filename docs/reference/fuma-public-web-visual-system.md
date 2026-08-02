# FUMA-WEB-012 original public visual and Motion system

Status: **implementation-complete; focused conductor acceptance required before tracker closure**.

FUMA-WEB-012 implements the approved Fuma visual direction as an original server-rendered hero-to-footer system. It does not reproduce Framer composition, copy, assets, type, colour, spacing, interface chrome, animation, or trade dress. Production uses canonical `@fuma/brand` and generated `@fuma/design-tokens`, owned Fuma interface illustration, authority-backed public projections, and explicit unavailable states. No customer logo, testimonial, statistic, performance score, provider claim, or product availability is invented.

## Shared composition

- The homepage moves from one direct outcome-led hero into an owned interactive product canvas, an evidence rail, Website/Publication choice, three editorial product chapters, reviewed claim evidence, distinct ecosystem semantics, a product-bound final CTA, and a dense useful footer.
- Website, Publication, features, solutions, about, pricing, templates, experts, showcases, plugins, components/component packs, trust, legal, contact, status, and editorial routes inherit the shared header/footer, typography, spacing, focus, and colour grammar while retaining their own server-rendered meaning.
- Experts remain opted-in people/studios with mediated inquiry; showcases remain approved work; plugins remain reviewed backend extensions; component packs remain reviewed client presentation releases. The public visual layer owns none of their ranking, review, moderation, consent, inquiry routing, installation, cache, session, or persistence authority.
- `/component-packs` and `/component-packs/[slug]` are canonical aliases to the existing reviewed `/components` presentation. They do not create a second catalog.

## Motion boundary

The official `motion` package is exact-pinned at `12.43.0` in `apps/web/package.json` and the single root lockfile. `motion/react` is the only narrative/layout animation runtime. `MotionProductCanvas` is one narrow client boundary whose lightweight tab shell defers a panel using `LazyMotion`, `domAnimation`, layout transitions, and `useReducedMotion` until interaction.

The island is illustrative, not authority. Primary page structure and product narrative remain server-rendered. The initial product-canvas scene is a static linked tab panel in server HTML, so it cannot be hydration-hidden or introduce entrance layout shift. `LazyMotion`, `domAnimation`, layout transitions, and `useReducedMotion` live in a deferred panel loaded only after a person requests another stage; the semantic static panel remains as its loading fallback. Motion is interruptible through labelled keyboard-operable tabs. Reduced motion makes transitions immediate. There is no parallax, scroll hijacking, autoplay, continuous animation, pointer-only operation, animated availability claim, or animation required to understand the workflow.

## Accessibility and performance

The system preserves one H1, ordered headings, landmarks, skip focus, high-contrast focus outlines, 44 px controls, text wrapping, 320 px containment, 200% text resilience, forced colours, reduced motion, and no-JavaScript meaning. Marketplace authority failures remain calm semantic unavailable states. Trust/legal/status routes retain restrained state-only feedback.

The Web production budget remains authoritative. FUMA-WEB-012 must fail if the exact Motion island pushes an acquisition route above the existing JavaScript budget or introduces unapproved image/font bytes. FUMA-WEB-018 later owns the full launch visual baseline and sign-off matrix; it must not reinterpret FUMA-WEB-012 implementation evidence as DNS, legal, monitoring, production, or unified-launch acceptance.

## Focused validation

```sh
bun --cwd=apps/web test \
  tests/fuma-web-012-visual-system.test.tsx \
  tests/public-web-acquisition-pages.test.tsx \
  tests/public-web-accessibility-contracts.test.ts
bun --cwd=apps/web run typecheck
bun --cwd=apps/web run lint
bun --cwd=apps/web run build

E2E_PUBLIC_BASE_URL=https://3002.blyss.co.ke \
  bunx playwright test e2e/fuma-web-012-visual.e2e.ts \
  --config apps/web/playwright.config.ts
```

Browser acceptance is valid only through `https://3002.blyss.co.ke`. Loopback may establish process liveness but is never browser, TLS, proxy, hydration, responsive, accessibility, or visual evidence.

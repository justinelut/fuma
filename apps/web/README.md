# @fuma/web

Independent Next.js public presentation service for Fuma. It owns acquisition copy, reviewed Git content, strict same-origin BFF routes, authority-backed pricing/discovery presentation, opaque app handoff, mediated inquiry UI, trust/legal/status surfaces, SEO, privacy controls, metrics, and public-Web deployment seams.

Mutable product, billing, template, marketplace, identity, contact-routing, and conversion authority remains in Studio domain services. Web imports only bounded shared packages and app-local Tailwind/shadcn source; it has no database, provider, staff session, tenant publisher, Zod, Studio import, parent-domain cookie, or public API host.

## Boundaries

- Browser reads and writes stay same-origin on `fuma.co.ke` or the required acceptance endpoint `https://3002.blyss.co.ke`.
- Private Studio calls are reconstructed server-side with only the Web service credential, audience, and request correlation. Browser credentials are never forwarded.
- Pricing, templates, experts, showcases, and plugins fail closed. Immediate-withdrawal discovery responses are `no-store`; pricing and templates require revalidation and never use stale-while-revalidate.
- Handoffs contain a closed intent plus an opaque short-lived app resume token/correlation. The app and identity owners consume it and establish their own host-only sessions.
- Contact and expert inquiry bodies are strict TypeBox values with replay tokens. Recipient routing never enters public markup.
- Acquisition and Web Vital events use closed route classes and contain no path, referrer, identity, tenant, member, payment, staff, or fingerprint data. Consent is session-only; GPC/DNT suppress collection; optional consent can be withdrawn immediately.

## Authored coverage

App-local unit/integration coverage includes projection schema/cache/redaction behavior, request bounds, hostile submissions, pricing and immutable previews, editorial eligibility, SEO, claims/budgets, host dispatch, deployment, acquisition minimization, metrics, and architecture isolation. Playwright coverage uses only `https://3002.blyss.co.ke` and covers acquisition, hydration, crawler surfaces, safe degradation, accessibility, consent withdrawal, cookies, and integrated launch invariants.

Deployment artifacts are `infra/docker/web.Dockerfile` and `infra/public-web/`. Operations and launch evidence are described in `docs/runbooks/fuma-public-web-operations.md` and `docs/runbooks/fuma-public-web-launch-gate.md`. Central authority registrations and release composition remain listed in `docs/handoffs/public-web-006-018-central-integrations.md`.

## FUMA-WEB-008 editorial pipeline

Reviewed public content lives under `content/public/{docs,guides,blog,changelog,legal}` as Git-owned `.md` or `.mdx`. Every file must provide strict TypeBox frontmatter: title, description, slug, collection, author, category, publication/update/review timestamps, draft state, version, redirect history, declared component allowlist, review owner, and `audience: public`. Unknown fields, duplicate keys, malformed timestamps, overdue review dates, internal plans, security exploit material, unsafe links/markup/components, broken canonical links/fragments, slug/redirect collisions, and redirect chains fail compilation.

The compiler allows only `Callout` and `CodeBlock` MDX components, and only when declared. Markdown fences and `CodeBlock` contents render as escaped, keyboard-scrollable code; executable authored HTML is never rendered. Eligible content is sorted deterministically and drives public routes, canonical permanent redirects, TOCs, RSS, Atom, and `generated/editorial-search.json`. Drafts and future publications are preview-only and do not enter redirects, search, feeds, or sitemaps.

Use `bun run editorial:generate` after content changes and `bun run editorial:check` in focused validation. The production `bun run build` regenerates the index before Next compilation. `tests/public-web-editorial.test.ts` executes the complete preview → publish → search → slug change → canonical redirect/feed lifecycle against the committed expected receipt at `tests/evidence/fuma-web-008-lifecycle.json`, plus malformed metadata, collision, leakage, unsafe component, link, determinism, code-block, and accessibility gates.

## FUMA-WEB-007 validation (2026-07-26)

The production acquisition shell and `/`, `/website`, `/publication`, `/features`, `/solutions`, and `/about` routes are validated as one coherent surface. The claim inventory is evidence-backed and review-bounded; the Kenya context states only configured `en-KE`, `Africa/Nairobi`, and KES defaults and explicitly gates prices on approved authority. Website and Publication are outcome choices over one ownership model, not routing, permission, persistence, or navigation forks.

The public handoff layer accepts only the closed TypeBox intent union, forwards it privately without visitor credentials, validates the strict issuer envelope, and constructs only `https://app.fuma.co.ke/resume` with opaque intent and correlation values. App intent consumption, authentication, app-host session issuance, replay prevention, cancellation, and authority re-resolution remain FUMA-WEB-013-owned. Browser acceptance uses a contract fixture only to prove WEB-007 reaches the app-host boundary; it does not claim an issuer, identity exchange, or session.

Executed app-local evidence:

- `bun test tests` — **67 passed, 0 failed, 349 assertions**;
- `bun run typecheck` and `bun run lint` — passed;
- `bun run build` — passed, generated 31 static pages in the 47-route App Router surface, and enforced all six acquisition budgets at **152,821 B gzip JS, 0 B external image assets, 0 B local fonts** per route/shared output against 180,000/350,000/100,000-byte limits;
- scoped functional Playwright at `https://3002.blyss.co.ke` — **18 passed**, covering both Website/Publication app-boundary journeys at 320 px and 1280 px, hostile handoffs, all-route hydration, keyboard/skip focus, 320 px with 200% text, reduced motion, contrast contracts, provider-safe analytics, safe authority degradation, crawler surfaces, and cookie isolation;
- scoped visual Playwright at `https://3002.blyss.co.ke` — **12 passed** without snapshot updates against committed Linux baselines for all six routes at 320 px and 1280 px.

The app-local production start command now launches the emitted standalone server and copies generated static assets into the traced runtime layout. No Studio, editorial, pricing, template, central issuer/session, tracker, root package, lockfile, or production infrastructure authority was changed.

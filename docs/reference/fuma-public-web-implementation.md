# Fuma public Web implementation

This reference covers FUMA-WEB-006 through FUMA-WEB-018. `apps/web` is an independent Next.js presentation service. It owns acquisition copy, reviewed Git content, same-origin presentation endpoints, metadata, consent UI, and public deployment artifacts. Studio remains the authority for mutable product, pricing, release, expert, showcase, plugin, handoff, contact-routing, and conversion facts.

## Runtime boundaries

Public browsers use only `fuma.co.ke` or the required acceptance endpoint `https://3002.blyss.co.ke`. `/api/public/v1/*`, `/api/handoff`, `/api/contact`, `/api/events`, and `/api/vitals` require exact HTTPS Host/Origin agreement where applicable, bounded JSON, and strict TypeBox values, then construct private requests from scratch. Every submission response is no-store and emits no cookie. Browser cookies and authorization headers are never forwarded. The private origin, projection token, preview token, and metrics token are server-only configuration. There is no public API hostname.

The public app has no identity session. `/start` validates a closed `PublicHandoffRequest`, posts it to the same-origin handoff route, and receives only an app-host URL containing a short-lived opaque intent and correlation. App authentication, app-session establishment, replay prevention, authority re-resolution, cancellation, and resume remain product-owned.

## Git editorial pipeline

`content/public/{docs,guides,blog,changelog,legal}` uses strict frontmatter validated by `EditorialFrontmatterSchema`. Metadata includes collection, author, category, version, publish/update/review dates, owner, redirects, draft state, and an explicit component allowlist. The loader rejects unknown metadata, unsafe markup, unapproved JSX components, duplicate canonical paths, colliding redirects, and internal-plan markers. Public reads exclude drafts and future items; the protected preview path opts in explicitly and is noindex.

Feeds, search, metadata, and content sitemaps all consume the same eligible loader. A slug redirect resolves directly to the current canonical path. Review owners must refresh or withdraw content before `reviewAt`; the launch gate treats overdue policy or claim content as blocking.

## Authority-backed presentation

Pricing shows only currently effective, unexpired KES plans from the strict projection. Missing, malformed, stale, withdrawn, or unavailable pricing suppresses amounts and checkout actions. Promotions are rendered only inside their projected window. The product app re-resolves every plan before checkout.

Templates, experts, showcases, and reviewed plugins use strict public projections. Detail pages search only an approved public page and return a generic noindex 404 when absent. Immediate-withdrawal datasets are requested without a Web fallback. Expert inquiries are mediated; recipient details never enter public HTML. Template installation remains app-owned and references only the stable public template ID.

## SEO and privacy

Metadata emits `en-KE` and `x-default`, canonical URLs, noindex for handoff/search/preview/404 states, feed discovery, segmented content/discovery sitemaps, and app-owned social cards. Structured data is limited to facts present in reviewed content or approved projections; ratings and testimonials are never fabricated.

The baseline page-view event is cookieless and contains a closed route class, timestamp, consent state, and no path, referrer, identity, fingerprint, tenant, member, payment, or staff data. A successful handoff emits only the approved target ID plus opaque authority-issued correlation before navigating to fixed `https://app.fuma.co.ke/resume`. GPC and DNT suppress collection and optional preference UI. Optional consent is held only in `sessionStorage` for the public host, can be withdrawn immediately, and never creates a cookie. Provider blockage cannot prevent rendering. Private analytics retention, deletion, bot reconciliation, and product funnel joins remain server-owned.

Projection requests/failures and bounded Web Vital observations are exposed only through the token-protected internal metrics route. Revision labels are escaped, browser vital payloads are TypeBox-closed, and deployment alerts cover availability, projection failures, latency, LCP/INP regressions, and sustained poor samples.

## Tests authored

- unit/integration: editorial strictness and eligibility, pricing validity/KES math, immutable previews, request host/origin/content-type/body bounds, closed handoff/contact/event/vital contracts, consent/acquisition minimization, projection timeout/304/schema/redaction behavior, and internal metrics;
- architecture: app isolation, forbidden dependency/host/cookie/business fields, no mutable pricing in content, and no-store submission routes including Web Vitals;
- Playwright: mobile/desktop acquisition journeys, tampered handoff, docs/redirect/feed/crawler surfaces, safe authority degradation, policy ownership, cookie isolation, keyboard/zoom/GPC behavior, and consent withdrawal at `https://3002.blyss.co.ke`.

## FUMA-WEB-006 authority closure evidence (2026-07-26)

Hosted Studio startup now passes its PostgreSQL client into `createHostedPublicProjectionRuntime`, which constructs a catalog with exact registrations for all six public resources. Product facts derive from the capability-composed launch registry. Pricing accepts only the strict `public_json.items` document of the currently published effective price book. Expert and showcase reads require an active customer organization, approved non-withdrawn release, both live attribution consents, opt-in, no suspension, and no unresolved moderation suspension. Plugin reads require a clean, signed, non-revoked review and explicitly verified public publisher metadata. Only display-safe columns and nested public metadata are mapped; organization, tenant, internal row IDs, recipient data, raw permissions, credentials, COGS, margins, offers, grants, payment/transfer state, and session material are never emitted.

Every source returns stable public IDs, source-owned filtering, dataset-bound cursors, and a content-addressed dataset version. The private boundary derives deterministic ETags, validates the strict TypeBox envelope, requires the exact private host, service token, `fuma-public-web` audience, and UUID request ID, rejects visitor credentials, and maps malformed/stale cursor input to a safe 400. Authority outages and schema drift remain redacted 503 responses. Templates are registered but return an empty approved dataset until an immutable preview authority exists; no starter-template, tenant, or Web-copy fallback is invented.

Executed evidence:

- `bun test apps/studio/server/fuma/publicProjections/registeredAuthorities.test.ts apps/studio/server/fuma/publicProjections/boundary.test.ts apps/studio/server/fuma/publicProjections/adapters/validatedDomainAdapter.test.ts apps/studio/src/__tests__/server/publicProjectionRouter.test.ts apps/studio/src/__tests__/architecture/fuma-public-projection-boundary.test.ts` — 28 pass, 0 fail; includes the successful private-runtime product envelope demo and malformed/private authority rejection.
- `bun test tests/public-projection-bff.test.ts tests/public-web-authority.test.ts tests/public-web-architecture.test.ts` from `apps/web` — 16 pass, 0 fail; includes successful BFF envelope validation, no visitor credential forwarding, unknown-host denial, and malformed/media-type/extra-field/timeout/429/5xx rejection.
- `bunx tsc -p tsconfig.node.json --noEmit` from `apps/studio` and `bun run typecheck` from `apps/web` — passed.
- targeted ESLint over the changed Studio/Web TypeScript files — passed.
- `bun run build` from `apps/web` — passed; Next generated 31 static pages and retained `/api/public/v1/[resource]` as a dynamic route.

No browser-facing behavior changed, so no browser acceptance was required or claimed. Production DNS/TLS, provider, legal, and launch evidence remains owned by later tickets and the unified launch gate.

## FUMA-WEB-007 repository closure evidence (2026-07-26)

The six core acquisition routes now have deterministic static-render contracts for reviewed claims, evidence paths, required links, unique canonicals, `en-KE`/`x-default`, one main landmark, one H1 followed by H2 sections, labelled responsive illustrations, and profile-neutral outcome selection. Accessibility gates cover WCAG-AA token pairs, semantic high-contrast focus rings, forced colors, reduced motion, keyboard skip focus, every route at 320 px with 200% text, and a consent preference control that remains in document flow after selection. Valid minimized acquisition events acknowledge safely when the private collector is unavailable; invalid/private payloads still fail closed.

`issueHandoff` is dependency-injectable only for deterministic boundary testing. Production behavior remains server-only: it validates the shared closed TypeBox request/envelope, sends only service-owned private headers, rejects expiry/schema drift, and constructs a fixed `https://app.fuma.co.ke/resume?intent=…&correlation=…` URL. The mobile/desktop browser demo intercepts the public handoff response with a strict fixture and proves navigation reaches that app-host layer. It deliberately establishes no identity or session and does not claim WEB-013 issuer, replay, cancellation, auth-code exchange, session-cookie, or app authority behavior.

Executed evidence from `apps/web`:

- `bun test tests`: 67 pass, 0 fail, 349 assertions;
- `bun run typecheck`, `bun run lint`, and `bun run build`: pass;
- the build-generated budget report covers `/`, `/website`, `/publication`, `/features`, `/solutions`, and `/about`, each at 152,821 B gzip first-load JavaScript and 0 B external image assets, with 0 B emitted local fonts, below the enforced 180,000/350,000/100,000-byte limits;
- scoped Playwright against only `https://3002.blyss.co.ke`: 18 functional pass and 12 committed visual-baseline pass at 320 px and 1280 px.

These results satisfy repository-achievable FUMA-WEB-007 acceptance. Central app intent issuance/consumption and sessions remain open under FUMA-WEB-013; production DNS/TLS, low-end field-vital sign-off, legal approval, provider composition, and unified launch signatures remain later launch-gate evidence rather than WEB-007 claims.

## FUMA-WEB-008 repository closure evidence (2026-07-26)

The Git-owned Markdown/MDX compiler now validates closed TypeBox frontmatter and collection placement; draft and scheduled eligibility; authors, categories, versions, review owners/dates; canonical redirect history; and the explicit `Callout`/`CodeBlock` component allowlist. Markdown fences remain text-only code, while MDX `CodeBlock` provenance requires an explicit declaration. Internal plans, ticket markers, confidential operational material, exploit material, executable HTML, unsafe URLs, unpublished public-link targets, broken fragments, noncanonical links, slug/redirect collisions, redirect chains, duplicate headings, and H3-first TOCs fail compilation. Search and feed ordering uses an explicit code-point comparator and remains independent of source enumeration order.

The committed lifecycle receipt at `apps/web/tests/evidence/fuma-web-008-lifecycle.json` was executed at `2026-07-26T12:00:00Z`. It proves `/preview/blog/editorial-lifecycle` is preview-visible but absent from public reads/search/feed; publishing exposes `/blog/editorial-lifecycle` in public reads/search/feed; renaming publishes `/blog/validated-editorial-lifecycle`, removes the old canonical from search/feed, and resolves `/blog/editorial-lifecycle` directly to the new canonical without a chain.

Executed app-local evidence from `apps/web`:

- `bun test tests/public-web-editorial.test.ts tests/public-web-architecture.test.ts tests/public-web-seo.test.ts tests/public-web-accessibility-contracts.test.ts` — **19 passed, 0 failed, 82 assertions**;
- `bun run editorial:check` — verified **10** deterministic public search records;
- `bun run typecheck` — Next route generation and strict TypeScript passed;
- scoped ESLint over the editorial compiler/loader/contracts, renderer/pages, generator, editorial routes/feeds, and focused test — passed with no output;
- `bun run build` — token check, search generation, Next production compile/typecheck, **31 static pages**, dynamic docs/guides/blog/changelog/preview/search/RSS/Atom routes, and budget enforcement passed; measured acquisition routes remained at **152,821 B gzip JavaScript, 0 B images, and 0 B fonts**.

No browser run was needed or claimed: this ticket's deterministic compiler lifecycle, static React accessibility markup, route generation, and production integration are fully exercised by the focused tests and build. Browser acceptance, deployment, and launch-signature concerns remain with their later owning tickets.

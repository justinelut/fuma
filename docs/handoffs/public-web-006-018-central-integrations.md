# Public Web 006–018 central integration handoff

This coding phase intentionally avoided shared hotspots. The primary integrator must apply these exact central changes after all four phase owners finish, resolve conflicts once, and then run aggregate validation.

## Required central integrations

1. **Studio authority composition — completed by FUMA-WEB-006 (2026-07-26):** hosted startup now registers strict server-owned `PublicProjectionAuthority` adapters for `product-facts`, `pricing`, `templates`, `showcases`, `experts`, and `plugins`. Product facts derive from the launch registry; pricing reads only published public price-book JSON; expert/showcase/plugin reads enforce approval, consent, customer-organization, moderation, withdrawal/revocation, and verified-public metadata before mapping. Templates deliberately expose an empty approved dataset until an immutable preview authority exists rather than inventing a fallback. IDs are display-safe, versions are content-addressed, cursors are dataset-bound, and all pages pass the shared strict contracts.
2. **Handoff route:** mount `POST /_fuma/private/public/v1/handoff` behind the same exact private host/service credential boundary. Validate `PublicHandoffRequestSchema`; issue short-lived single-use app-audience intent/correlation; reject admin audience, arbitrary redirects, PII, replay and expiry. Add app `/resume`, auth redirect/code exchange, cancellation, authority re-resolution, and host-only `__Host-fuma_app` composition through the identity owners.
3. **Contact route:** mount `POST /_fuma/private/public/v1/contact` with idempotent replay-token handling, abuse/rate controls, safe routing for general/security/privacy/expert inquiry, header-injection prevention, bounded retention and no recipient leakage.
4. **Acquisition collector:** mount `POST /_fuma/private/public/v1/acquisition-events`; validate `PublicAcquisitionEventSchema`; deduplicate/reorder safely; filter bots/internal traffic; enforce retention/deletion; join opaque correlations to signup/site/publish/paid server-side without exposing identity, tenant, member, payment or staff data to Web.
5. **Moderation invalidation:** connect expert/showcase/plugin opt-out, suspension, transfer and revocation events to immediate projection removal, Next/edge purge, detail tombstone/noindex and discovery sitemap regeneration.
6. **Pricing invalidation:** connect price-book publish/switch/withdraw to dataset versions, ETags, cache purge, and checkout re-resolution. Never place amounts, provider IDs, costs, margins, private offers or setup terms in Web configuration/content.
7. **Root orchestration:** add only the final agreed root aliases for Web unit/type/lint/build/E2E and deployment if still required. Do not create another lockfile or regenerate the root lock without an actual dependency change; this phase added no dependency.
8. **Production composition:** incorporate `infra/public-web/{deployment.yaml,traefik.public-web.yml,alerts.yaml}` into the authoritative Cloudflare/Traefik/Kubernetes environment, replacing `${FUMA_WEB_IMAGE_DIGEST}` through release tooling and preserving wildcard tenant ownership.
9. **Environment/secret authority:** inject projection token/origin, preview token, metrics token and revision from secret management. Add the Web values to the authoritative environment validator without exposing them to `NEXT_PUBLIC_*` or browser bundles.
10. **Documentation catalogs:** after conflict resolution, link `docs/reference/fuma-public-web-implementation.md` and both public-Web runbooks from `docs/README.md`; add the app-local architecture test to the central architecture-test catalog if catalog policy requires it.
11. **Release manifest:** pair immutable Web and product digests in the unified release authority while preserving independent Web rollback. Add SBOM/provenance and multi-architecture attestations.
12. **Aggregate launch evidence:** execute the unsigned checklist in `docs/runbooks/fuma-public-web-launch-gate.md`; attach host/browser/crawler, WCAG, low-end Kenya performance, privacy, pricing/discovery mutation, canary and rollback evidence. Only the unified launch owner may change final decision from ABORT.

## Files still intentionally not edited

- root `package.json` and `bun.lock`;
- Studio migration indexes or historical migration sources;
- `docs/README.md` and `docs/reference/architecture-tests.md`;
- unified release/launch manifests owned by the primary integrator.

## External/authority blockers

Identity/app resume endpoints, contact routing, analytics storage/dashboard/retention jobs, moderation and pricing purge-event wiring owned by FUMA-WEB-011/FUMA-WEB-009, edge/DNS/TLS accounts, image registry digests, monitoring backend, legal approval, and named production owners remain outside this phase. Public pages continue to fail closed when an approved dataset is empty, withdrawn, malformed, or unavailable.

## App-local completion state (2026-07-26 resume)

FUMA-WEB-006 through FUMA-WEB-018 are fully authored within the independent Web ownership boundary. The resume pass read the existing handoff and all current Web sources, retained completed pages, and repaired the unfinished seams rather than reimplementing the phase:

- completed the exported/instrumented projection fetch path, correct 304/ETag handling, must-revalidate pricing/template caches, and no-store moderation datasets;
- centralized exact HTTPS host/origin, JSON content type, body-size, TypeBox, no-store, and no-cookie checks across handoff, contact, acquisition, and Web Vital routes;
- completed mediated expert inquiry presentation, fixed app-only resume construction, opaque correlation telemetry, consent accept/reject/review/withdraw, GPC/DNT suppression, and Web Vital/projection metrics;
- completed noindex/sitemap coverage, field-vital alerts, app-local unit/architecture/Playwright sources, and the phase manifest/reference/runbook documentation;
- replaced an unrelated stale conversion E2E with Website/Publication and tampered-handoff acceptance against `https://3002.blyss.co.ke`.

No Studio imports, Zod, central router/composition edits, root package/lock edits, or mutable pricing/content fallbacks were added. No test, typecheck, build, lint, Playwright, Docker, or validation command was run, as explicitly required for this coding-only phase. The unsigned launch gate remains **ABORT** until the external evidence and signatures exist.

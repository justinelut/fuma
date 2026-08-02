# Fuma tenant runtime architecture

Status: **Accepted and implemented through FUMA-SITE-005 (closed 2026-07-30).** SITE-002 publishes immutable runtime trees; SITE-003 provides the independently buildable exact-host Next runtime; SITE-004 provides semantic first-party/private React rendering and the app-local Tailwind/token bridge; SITE-005 provides persistent member/application state, fenced Bun mutation adapters, route rollout, and bounded legacy compatibility. Production traffic cutover remains owned by infrastructure, pilot, and launch gates.

## Decision

Fuma will operate exactly one horizontally scalable `apps/site-runtime` Next.js App Router application for all hosted tenant subdomains and activated customer domains. A request is resolved only by this chain:

```text
exact normalized Host
  → Studio-owned private host authority
  → exact platform/organization/workspace/site/owner generation
  → active immutable release ID and hash
  → canonical route in that release
  → exact release-bound component registry
  → React Server Component rendering with narrow Client Component islands
```

Unknown, malformed, reserved, inactive, conflicting, or unbound hosts fail closed. There is no generated application per customer, default tenant/site, process-global current tenant, direct-origin tenant selector, or tenant-selected server module.

SITE-001 ratified this application boundary without scaffolding the app or cutting traffic over. SITE-002 subsequently added immutable runtime-tree artifacts, SITE-003 implemented `apps/site-runtime` plus the Studio private resolver, SITE-004 added the exact-version open component registry, semantic React tree walker, private declarative expansion, restricted-client boundary and app-local Tailwind/token bridge, and SITE-005 added persistent exact-realm application state, private Bun mutation fencing, rollout persistence and opaque retained-release compatibility. No production deployment, DNS/TLS mutation or traffic cutover occurred; cutover remains separately gated.

## Preserved authorities

The change replaces only the hosted public rendering layer. It preserves:

- Studio as the Bun platform, editor, host/release/domain authority, worker, scheduler, plugin sandbox, and self-host product;
- the canonical `NodeTree`, Visual Component, template, slot, loop, class/style, breakpoint, condition, media, and binding model;
- immutable release build, verification, activation, retention, and rollback authority;
- the semantic HTML/CSS compiler for static hosted migration routes, portable export, self-host publishing, deterministic reference output, legacy releases, string-render plugins, and emergency no-React rollback;
- PostgreSQL, Redis, object storage, billing, member identity, transactional domain APIs, audit, quota, and provider ownership in Bun services.

`apps/site-runtime` may consume only versioned private TypeBox contracts. It never imports Studio, Web, a shared UI package, repositories, migrations, database clients, provider SDKs, draft state, or platform credentials. It does not become a second backend.

## Application contract

The ratified topology is three independently buildable applications:

```text
apps/studio
apps/web
apps/site-runtime
```

There is one `apps/site-runtime`, never `apps/site-<customer>`, generated tenant apps, or tenant-owned deployment roots. Applications do not import applications. The initial framework-neutral leaf packages remain unchanged; no shared React/UI package is authorized.

The production runtime is Next App Router standalone on Node. Production/deployment acceptance is native Linux ARM64 only, with no Docker/buildx, QEMU, emulation, or amd64 evidence. Bun may be benchmarked against the same deterministic corpus, but Bun does not become the production runtime without a later decision backed by semantic, RSC, streaming, navigation, shutdown, observability, and capacity parity.

Untyped boundaries use strict TypeBox schemas with `additionalProperties: false`. Zod is forbidden.

## Exact host and request state

Host input is normalized before lookup: ASCII lowercase, one optional terminal dot, and an optional valid port may be removed. IDNs, malformed authorities, ambiguous dots, path/user-info characters, unknown hosts, and collisions are denied. The normalized host remains part of all downstream authority.

Every successful resolution carries:

- exact host;
- platform, organization, workspace, and site IDs;
- stable owner key and current owner generation;
- active immutable release ID and release hash;
- canonical route, with query held separately;
- public or exact site-member audience;
- runtime deployment and component-registry versions.

Tenant context is immutable request state. It is never a module singleton, mutable global, environment-selected default, fallback site, or caller-supplied tenant ID.

## Cache contract

A cache identity is valid only when it includes exact host, complete owner/site ancestry, owner generation, release ID and hash, canonical route, canonically sorted query, public/member audience and access fingerprint, runtime deployment version, and component-registry version. Member identities additionally include the exact member ID.

A key produced for one host, owner generation, release, route, audience, deployment, or registry version cannot satisfy another. Cache lookup is checked against the already-resolved request authority. Unqualified path-only, site-only, release-only, process-global, or implicit Next cache keys are forbidden. Publication, activation, transfer, rollback, registry deployment, and member access changes invalidate through qualification/version change rather than unsafe global tenant state.

## Component trust contract

Canonical persisted content remains data. It may reference a namespaced component ID, exact version, strict props/slot schemas, children, classes, styles, rules, tokens, media, and bindings. It never persists JSX/TSX, executable React source, server module paths, dynamic imports, or Tailwind compilation input.

Execution rules are:

| Boundary | Allowed trust | Rule |
|---|---|---|
| Server Component | compiled official Fuma component only | Default for content, layouts, metadata, media, public reads, and listings; no tenant/plugin/community dynamic server import |
| Client Component | official or separately reviewed client component | Narrow island for events, browser APIs, local/application state, optimistic mutation, cart/booking/account controls |
| Declarative tree | official or declarative community pack | Data-only composition of approved exact components; no executable source |
| Legacy string renderer | retained legacy release/plugin compatibility | Bounded sanitized HTML/IIFE/hole path, never promoted into arbitrary React Server Component execution |

A Client Component child does not turn an entire page into a Client Component. Components are release-bound by namespace, ID, exact version, source hash, props/slot schema hashes, and declared capabilities. Missing, incompatible, mutable, revoked, or trust-tier-invalid bindings fail before activation.

## Tailwind and shadcn ownership

Tailwind and shadcn are implementation tools for trusted app source, not persisted tenant data.

- Both are exact-pinned and app-local to `apps/site-runtime` through its runtime manifest/dependency bridge and the root lock authority.
- Studio stays Tailwind-free and keeps its CSS Modules/primitives.
- Utilities in trusted source are complete statically detectable strings; dynamic construction is rejected.
- Persisted arbitrary utility lists never become Tailwind scanner/compiler input.
- Release Core Framework tokens project to tested CSS variables consumed by trusted component source.
- Fuma classes, inline styles, breakpoints, conditions, and sanitized user CSS remain release data and retain their defined cascade.

FUMA-SITE-001 added no dependencies. SITE-003 preserves the approved exact versions (`next` 16.2.9, `react` 19.2.5, `tailwindcss` 4.3.3, and `shadcn` 4.14.1) in `apps/site-runtime/runtime.manifest.json`. `tooling/site-runtime/prepareAppDependencies.ts` creates the ignored app-local dependency bridge from root-approved packages because retaining a new app `package.json` would require a forbidden root-lock rewrite. The root lock remains the single workspace install authority.

## Sessions and dynamic authority

Tenant public requests receive no auth/app/admin staff cookie or route. Site-member identity is a separate exact-site realm. A site-member cookie is `__Host-` prefixed, Secure, HttpOnly, SameSite=Lax, Path=/, host-only, omits `Domain`, and cannot authorize Studio staff/product/admin surfaces.

Dynamic and transactional behavior calls typed Bun domain APIs with the resolved exact scope. Components cannot own inventory, booking, order, payment, refund, access, identity, provider, or database authority. Request-specific output is no-store or explicitly member-qualified; public data is release/version qualified.

## Migration sequence

No database, object, content, lockfile, deployment, DNS, TLS, or traffic migration occurs in FUMA-SITE-001. The dependency-ordered migration is:

1. **SITE-001:** ratify these contracts and hostile gates.
2. **SITE-002:** publish a strict content-addressed runtime-tree/route/component/style artifact beside existing HTML/CSS; retain old releases and atomic activation.
3. **SITE-003:** create the one independently deployable Next application and private TypeBox client; prove native Linux ARM64, exact-host/cache isolation, graceful drain, and independent deployment rollback.
4. **SITE-004/005:** add the trusted registry, semantic parity, dynamic state, and bounded legacy compatibility before route cutover. **Implemented; no production cutover performed.**
5. Shadow-render or compare deterministic routes, then opt in by exact site/route release policy. Never infer cutover from unknown host or missing artifacts.
6. Keep the legacy compiler and retained immutable releases readable throughout rollout and retention windows.

A release is activated only after its host, runtime artifact, component versions, source/schema hashes, assets, and compatibility policy validate as one immutable set. A failed React build or render does not mutate content or advance the active release pointer.

## Rollback

Rollback is layered and non-destructive:

1. Route/site policy may return an affected route to its retained legacy HTML artifact.
2. The active pointer may atomically return to a previously retained immutable release.
3. `apps/site-runtime` may roll back independently to its prior compatible standalone deployment; deployment and registry versions in cache identity prevent mixed-version reuse.
4. Traffic may return to the existing Studio-hosted semantic renderer while the Bun platform, editor, releases, objects, uploads, and database remain unchanged.
5. Repository changes use normal Git reversion. There are no down migrations, destructive SQL, release rewrites, lockfile regeneration, or parallel customer applications.

Rollback must preserve exact-host denial, owner generation, member realm isolation, audit evidence, and retained component artifacts. Emergency fallback is explicit per known host/release; unknown hosts never fall through to legacy or a default site.

## Enforced evidence

The executable authority is:

```text
tooling/site-runtime/contracts.ts
tooling/site-runtime/auditor.ts
tooling/site-runtime/fixtures.ts
tooling/site-runtime/tests/site-runtime.architecture.test.ts
tooling/site-runtime/tests/site-runtime.security.test.ts
tooling/site-runtime/tests/site-runtime.fault.test.ts
tooling/site-runtime/tests/site-runtime.demo.test.ts
```

The strict contracts cover application, authority, compatibility, exact host, immutable route resolution, cache identity, component trust, and site-member cookies. The auditor has one independent hostile fixture for every typed rule and rejects per-customer apps, app imports/shared UI, direct authority, Studio Tailwind, Zod, non-exact/app-external styling, tenant dynamic imports, unqualified cache identity, non-exact components, unknown-host fallback, global/default tenants, unsafe cookies, persisted JSX/utilities, arbitrary Server Components, compatibility removal, non-Node production, and non-native ARM64 policy.

The demo resolves `/colliding-route` on `alpha.trimly.co.ke` and `customer.example` to different exact owner/site/release/hash bindings, produces distinct qualified cache keys, denies an unknown host, and denies using the first host's cache identity for the second resolution.

## Non-claims

This ADR now claims the closed immutable runtime artifacts, one exact-host standalone Next application, Studio private resolution/mutation authority, release-and-rollout-qualified public cache, private member snapshots, persistent optimistic application state, exact-version first-party/private component semantics, app-local Tailwind/token CSS, explicit route rollout, and opaque retained-release legacy compatibility with native ARM64/Blyss HTTPS acceptance. It does **not** claim a production cart/booking authority where no Bun domain service exists, hosted traffic cutover, production capacity, or deployment; unsupported mutations fail closed and infrastructure/launch tickets retain those gates. Browser acceptance used matching Blyss HTTPS service ports only; loopback served solely as low-level process/CDP control and is not public-host evidence.

## Related

- [`fuma-site-application-state.md`](fuma-site-application-state.md) — SITE-005 application context, mutation fencing, rollout, and legacy compatibility.
- [`fuma-tenant-react-runtime-component-marketplace.md`](fuma-tenant-react-runtime-component-marketplace.md) — approved complete SITE stream.
- [`fuma-workspace-public-web-architecture.md`](fuma-workspace-public-web-architecture.md) — workspace, host, identity, and application boundaries.
- [`fuma-immutable-releases.md`](fuma-immutable-releases.md) — immutable release authority.
- [`fuma-edge-delivery.md`](fuma-edge-delivery.md) — current release-qualified edge delivery and legacy hole boundary.

## Final acceptance evidence

The focused SITE-001 architecture/security/fault/demo suite passed **31 tests, 49 assertions, 0 failures**. Conductor integration, full workspace build/typecheck/lint/frozen install, and the closing repository aggregate passed **8,123 tests with 29 expected skips and 0 failures**. No browser acceptance was required or claimed because this ticket ratifies gates and does not deploy or route the future runtime.

## SITE-003 implementation and acceptance

`apps/site-runtime` is a manifestless, independently buildable Next 16.2.9 App Router application with standalone Node output. Its catch-all route accepts only matching `Host`, `X-Fuma-Routed-Host`, and routing-token authority, forwards only the isolated host-scoped site-member cookie, canonicalizes route/query identity, and resolves through `POST /_fuma/private/site-runtime/v1/resolve`. Studio rechecks exact host ownership generation, transfer fence, active immutable release, deployment compatibility, route bytes, audience, and stale activation before returning the strict private response.

Per-document proxy middleware generates a fresh nonce, forwards the nonce-bearing CSP so Next applies it to bootstrap/RSC scripts, and returns the identical policy. The policy retains `strict-dynamic`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `object-src 'none'`, and no `unsafe-eval` or unrestricted external script source.

Native ARM64 Chromium acceptance over `https://3111.blyss.co.ke` and `https://3112.blyss.co.ke` rendered two routes on each of two exact routed hosts. Next client transitions preserved one document and shared-layout state (`data-fuma-navigation-visits` 1→2→3); activating alpha release 2 left beta on release 1. Both document CSPs had distinct nonces matching Next scripts and produced zero captured security/runtime errors. The closing authoritative aggregate passed **8,228 tests, 31 expected skips, 0 failures, and 153,058 assertions**. Full command and migration evidence is recorded in the tracker closure audit.

## SITE-004 component registry and acceptance

Every immutable route artifact now carries its complete transitive exact component registry, JSON-only declarative parameter metadata, style manifest, hash-bound UTF-8 stylesheet bytes, route-scoped public data and only the immutable restricted artifacts needed by that route. Official references use each compiled module's declared semantic version. Owner-private sources include site-created, visual-designer, AI-designer, source-import, team-pack and reviewed-marketplace entries, all exact owner/site scoped.

`apps/site-runtime/lib/component-registry.ts` resolves exact `(namespace, componentId, version)` coordinates and rejects official version drift, owner/site substitution, capability escalation, invalid private trust and missing content-addressed client artifacts. It never imports/evaluates arbitrary tenant Server Components or persisted executable JSX. `components/runtime-tree.tsx` renders body/container/text/image/link/button/list/SVG/video/form primitives, outlets/templates, Visual Components, slots and loops with public-data/parameter bindings, safe internal `next/link`, class/inline-style preservation, hidden-node behavior and fail-closed URL/attribute/rich-markup/SVG/CSS sanitization. Restricted clients remain inert behind one static narrow Client Component and are not dynamically imported.

Tailwind 4 and PostCSS are exact root-lock-provided app-local build dependencies. Release tokens map to CSS variables, complete utility strings remain static, arbitrary persisted utilities are never compiler input, the stylesheet hash is rechecked, and standalone assembly copies `.next/static`/`public` so CSS/client chunks cannot fall through the tenant route. Studio remains Tailwind-free.

The SITE-001/002/003/004 focused gate passes **44 tests, 181 assertions and 0 failures**. Native Linux ARM64 Chromium used only `https://3111.blyss.co.ke` and `https://3112.blyss.co.ke` for browser navigation and `https://3113.blyss.co.ke` for private authority. Alpha and beta each navigated `/menu → /about → /menu` with visits **1→2→3**, one Navigation Timing document, stable document token and no browser errors. Alpha moved `release_alpha_1→release_alpha_2` and token `#713f12→#9a3412`; beta remained on `release_beta_1` and `#713f12`. Every snapshot passed 320px, no horizontal overflow, 200% page scale and reduced motion; CSP nonces remained distinct and attached to Next scripts. Evidence SHA-256: `1c4beead06142b14dd9ad503156087522bc0144f521a1ab6cd0e2b63c3856419`.

The closing authoritative repository aggregate passes **8,244 tests, 32 expected skips, 0 failures and 153,151 assertions**. Frozen install, full lint and production build pass, including standalone static assembly. The root lock remains `e9688c20f69e32aa0df7cea681b5c4971ef5a7d272d3e644bc96486384c4c1b9`; no Motion install, lock mutation, Docker/emulation, production deploy, traffic/DNS/TLS change, commit or push occurred.

## SITE-005 application state and compatibility acceptance

`apps/studio/server/fuma/siteRuntime/application.ts` owns exact member/application projection, five-minute mutation freshness, exact binding/audience/session checks, expected-version fencing, immutable idempotency replay, route policy CAS, shadow semantic comparison, explicit fallback and non-mutating rollback. Migration `000072_site_runtime_application` persists generation-qualified route policies and append-only mutation receipts at checksum `48b68eb8fa97e6f47a9ef97c510adedd975e88ef39425d9b26e3b24db74722da`; hosted/runnable migrations are 72/72 and next is `000073_release_followup`.

The root `ApplicationStateProvider` persists accepted state above page segments, resets foreign realms, serializes optimistic mutations and guards rollback. The exact compiled `application.member-status@1.0.0`, `application.cart-action@1.0.0`, and `application.booking-action@1.0.0` controls are official Client islands limited to `interaction.local-state`. The same-host mutation route forwards only the canonical member token to Bun and is private/no-store. Production defaults to `UnavailableSiteRuntimeMutationAdapter` unless an owning Bun domain adapter is injected; no fake cart/booking database authority was introduced.

Retained legacy documents are owner-generation/release/manifest/hash/size/UTF-8 verified, reject authority-bearing HTML and unsafe IIFEs, and render only in `sandbox="allow-scripts"` without same-origin authority under a no-network/form/base CSP. Rollout policy version qualifies cache identity; member snapshots never enter the shared Redis response cache.

The integrated SITE-001..005 gate passes **88 tests/312 assertions**. Native PostgreSQL acceptance passes **1/14** with zero disposable roles/schemas. Native Linux ARM64 Chromium over matching Blyss HTTPS hosts proves accepted and rolled-back optimistic state, state persistence, shadow parity, foreign-site denial, explicit retained-legacy rollback, opaque sandbox/CSP, unchanged domain version, responsive/reduced-motion/nonce gates and zero browser errors. Transcript SHA-256: `33e10ac4899ba6a4a7b92c58bac8b80c1b1480d81078a817afb5929fa23816e4`. The closing aggregate passes **8,258 tests, 33 expected skips, 0 failures and 153,217 assertions**.

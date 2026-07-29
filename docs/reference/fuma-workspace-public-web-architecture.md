# FUMA Workspace and Public-Web Architecture

This ADR ratifies the repository workspace, public-web, host, session, and data-authority boundaries for FUMA-WEB-001.

The current Git repository becomes the Fuma workspace root. FUMA-WEB-001 records the accepted structure and the gates that protect it; it does not relocate files, alter workspace configuration, scaffold applications, or migrate data.

---

## Status

**Accepted — FUMA-WEB-001; SITE runtime implemented through application state and compatibility on 2026-07-30.** Mechanical workspace conversion belongs to FUMA-WEB-002. FUMA-SITE-003 provides the isolated manifestless `apps/site-runtime` application under the one-root-lock policy; SITE-004 provides exact component parity; SITE-005 provides persistent state, fenced private mutation adapters, and bounded retained-release compatibility. Infrastructure, pilot, and launch gates still own production traffic cutover.

## TL;DR

- Keep this repository as the workspace root. Do not wrap it in another repository, add nested Git repositories, or use submodules.
- The accepted initial layout is `apps/studio` plus `apps/web`; the approved FUMA-SITE extension adds a third independent `apps/site-runtime` Next App Router application for all exact tenant/customer hosts, never one application per customer.
- The initial shared-package set is exactly `packages/brand`, `packages/design-tokens`, and `packages/public-contracts`. Do not extract additional packages without a demonstrated second consumer.
- Use native Bun workspaces, one private root orchestrator, and one root `bun.lock`. Do not add Turborepo or nested lockfiles.
- `fuma.co.ke`, `auth.fuma.co.ke`, `app.fuma.co.ke`, `admin.fuma.co.ke`, tenant subdomains, and customer domains have distinct route, session, and data ownership. There is no public `api.fuma.co.ke`.
- Better Auth is centralized on the auth host. Auth, app, and admin use host-only cookies; app and admin establish separate relying-party sessions that cannot authorize one another.
- `apps/web` is presentation plus a same-origin BFF. Mutable business truth remains in the Bun platform and reaches the public web only through private, versioned, TypeBox-validated public projections.
- Pricing amounts, quotas, availability, promotions, provider identifiers, entitlements, costs, and margins are not hardcoded public-web truth.
- The repository move performs no data migration. It preserves self-host behavior and every historical and hosted migration identity/checksum. Rollback is normal Git reversion.

## Accepted repository layout

The existing repository root remains the Git and Bun workspace root:

```text
<current-repository-root>/
├── apps/
│   ├── studio/                 existing Bun server, React/Vite product, and self-host distribution
│   └── web/                    Next.js App Router public application
├── packages/
│   ├── brand/                  approved names, logos, and public brand assets
│   ├── design-tokens/          framework-neutral color, typography, and spacing values
│   └── public-contracts/       strict TypeBox public schemas and derived types
├── infra/
│   ├── docker/
│   ├── cloudflare/
│   └── k8s/fuma/{base,overlays}/
├── tooling/                    workspace-integrity and affected-application tooling
├── vendor/
├── docs/
├── package.json                private Bun workspace orchestrator
├── bun.lock                    sole workspace install-authority lockfile
└── tsconfig.base.json
```

The tracked `vendor/pixel-art-icons/bun.lock` is preserved historical metadata inside the vendored source snapshot. Workspace commands never install from it; it is the sole exact vendor-artifact exception and does not permit an app, package, or additional vendor lockfile.

`apps/studio` receives the current application through history-preserving `git mv` operations. `apps/web` is a separate application, not a route group inside Studio and not a renderer built on tenant publishing. Applications never import from another application.

The initial `packages/` directory contains exactly three packages:

| Package | Owns | Must not own |
|---|---|---|
| `brand` | Approved public identity assets and metadata | Product behavior, routes, sessions, or business rules |
| `design-tokens` | Framework-neutral primitive values and app-specific CSS generation inputs | Shared admin component CSS or an app-owned React component library |
| `public-contracts` | Strict TypeBox schemas and schema-derived types for public reads, handoff intents, events, pagination, and safe errors | React, Next.js, Bun runtime, database, Redis, MinIO, provider, auth, repository, publisher, or migration dependencies |

`apps/web` owns its own small accessible component library. It does not consume the existing Studio admin components. FUMA-SITE later gives `apps/site-runtime` its own app-local trusted React/Tailwind component registry and reviewed component-pack boundary; it likewise imports no application and creates no shared UI package. Further extraction requires an actual second consumer; the conversion does not create speculative utility, database, auth, UI, server, or domain packages.

### Frontend styling ownership

The existing Instatic interface in `apps/studio` keeps its established CSS Modules, token vocabulary, UI primitives, and Pixelarticons gates. New Fuma-owned React and Next.js surfaces—including the public Web app, future tenant site runtime, hosted dashboards and console screens, authentication, and marketing interfaces—use app-local Tailwind CSS and shadcn/ui source components by default. Responsive behavior is authored with Tailwind utilities rather than a parallel custom responsive framework.

Tailwind, shadcn/ui, their generated components, semantic theme aliases, and supporting dependencies are owned by the application that builds them. They must not enter `packages/brand`, `packages/design-tokens`, or `packages/public-contracts`, and they do not justify a fourth shared package. `packages/design-tokens` remains framework-neutral and supplies namespaced primitive CSS-variable inputs; each Fuma application maps those primitives into its own Tailwind/shadcn semantic variables. Dependencies are exact-pinned, generated component source is reviewed and committed app-locally, Zod remains forbidden, and the single root `bun.lock` remains authoritative.

## Workspace and dependency policy

The workspace uses native Bun workspace support and root scripts. Turborepo, nested package managers, nested lockfiles, and per-app install authorities are forbidden.

The root contract is:

- one private root `package.json` orchestrates workspace commands;
- one root `bun.lock` resolves every workspace dependency;
- no `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, or nested `bun.lock` exists;
- FUMA-WEB-002 retains current dependency versions while relocating the Studio application;
- root developer command wrappers remain available while explicit workspace commands are added;
- workspace dependency names are unique and the dependency graph is acyclic;
- an application may import an allowed shared package, but never another application;
- Next.js code and dependencies stay out of `apps/studio`;
- Studio server, auth, provider, publisher, repository, migration, and admin internals stay out of `apps/web`;
- Zod remains forbidden; public boundaries use TypeBox.

`infra/` owns deployment descriptions for the workspace applications. `tooling/` owns repository-integrity and affected-application scripts. Neither directory becomes a runtime application or an authority for product data.

## Exact host and route ownership

Host dispatch is exact and fails closed. No host may fall through to a default site, default application, or singleton tenant.

| Host | Route owner | Route surface | Browser session | Data authority |
|---|---|---|---|---|
| `fuma.co.ke` | `apps/web` | Public marketing, product, solution, pricing, templates, showcase, experts, reviewed plugins, docs, guides, blog, changelog, company, legal, SEO, feed, and same-origin public BFF routes | No staff, app, admin, member, or tenant session | Git-backed public editorial content plus validated public projections; no mutable business authority |
| `www.fuma.co.ke` | Edge redirect | Permanent redirect to `fuma.co.ke`, preserving path and query | None | None |
| `auth.fuma.co.ke` | Central Better Auth boundary in Studio | Signup, sign-in, verification, MFA, recovery, central account state, logout, global revocation, and relying-party code issuance/exchange entry | Host-only identity cookie | Better Auth identity, credential, verification, MFA, recovery, and central security state |
| `app.fuma.co.ke` | Studio customer product | Organization/workspace/site routes, onboarding, editor, customer mutations, billing self-service, and product WebSocket/API routes | Host-only `__Host-fuma_app` relying session | Customer product and tenant-scoped domain authorities in the Bun platform |
| `admin.fuma.co.ke` | Studio internal console | Fuma-internal operations, moderation, support, break-glass, managed-client commercial setup, and bounded domain-service actions | Host-only `__Host-fuma_admin` relying session | Internal read models and authorized domain-service actions; customer roles never authorize this host |
| `<tenant>.fuma.co.ke` | Runtime/component/application boundary implemented in `apps/site-runtime`; production traffic remains on Studio until infrastructure/pilot/launch cutover gates | Active immutable releases through the current semantic path or gated React runtime, with explicit route shadow/fallback/retained-legacy rollback | No auth/app/admin cookie; the separate host-only site-member realm is exact-site scoped | Exact durable host/release authority, member projection, rollout policies, and immutable replay evidence in Bun/PostgreSQL |
| Activated customer domain | Same implemented `apps/site-runtime` target and pending infrastructure/pilot/launch cutover gates | The same exact release/application surface as the mapped tenant host; React/legacy rollout remains explicit per known host/route | No auth/app/admin cookie; the separate host-only site-member realm is exact-site scoped | The same exact durable host, release, member, rollout, and replay authorities |

Better Auth routes exist only on `auth.fuma.co.ke`. Product routes do not mount on `admin.fuma.co.ke`; console routes do not mount on `app.fuma.co.ke`. Public, tenant, and customer hosts mount neither staff identity nor relying-party routes.

There is no public `api.fuma.co.ke`. Public browser requests remain same-origin to `fuma.co.ke`; the public BFF reaches versioned projection endpoints over private cluster networking. The reserved `api` label prevents it from becoming either a tenant or an accidental public API authority.

### Reserved tenant labels

The mandatory reserved set is:

```text
auth
app
www
api
admin
status
support
mail
```

The allocation authority may add reviewed operational names, but it may not remove or allocate any mandatory name. Unknown, malformed, inactive, reserved, or conflicting tenant/customer hosts fail closed. Case, ports, trailing dots, IDNs, normalization collisions, and activation state are resolved before an exact host selects a release.

## Session and identity boundary

Better Auth is the centralized staff identity authority, not a parent-domain session provider.

1. `auth.fuma.co.ke` authenticates the identity and keeps its identity cookie host-only.
2. Auth issues an opaque, short-lived, single-use code bound to the exact relying-party audience, callback, and state.
3. `app.fuma.co.ke` or `admin.fuma.co.ke` exchanges that code server-side.
4. The relying host creates its own linked session: `__Host-fuma_app` or `__Host-fuma_admin`.
5. App and admin session lifecycles are independent. Neither session authorizes the other host.
6. Central password reset, ban, recovery, and global revocation invalidate all linked relying sessions.

Every identity and relying-session cookie is `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, host-only, and omits `Domain`. No `.fuma.co.ke` or other parent-domain cookie is permitted because tenant sites occupy the wildcard namespace. No staff cookie reaches `fuma.co.ke`, a tenant subdomain, or a customer domain. Browser bearer sessions, session tokens in redirect URLs, arbitrary return URLs, replay, wrong-audience exchange, and cross-host session probing are forbidden.

Public acquisition intent is not a session. A CTA may carry a separate opaque, short-lived intent containing only allowlisted profile, template, plan, and source values. App revalidates that intent and all authority after authentication. A public flow cannot request an admin audience.

Site-member identity remains a distinct realm. It does not reuse Better Auth staff identities, cookies, sessions, or authorization and cannot confer app/admin access.

## Data and public-BFF ownership

`apps/web` owns public presentation, not platform truth. Its Git-backed Markdown/MDX may own reviewed marketing copy, docs, guides, blog posts, changelog entries, legal text, FAQs, and editorial narrative. It does not become a second CMS, authentication system, billing catalog, tenant publisher, or business database.

Mutable facts remain platform-owned and are exported only as explicit public projections:

| Data class | Authority | Public-web access |
|---|---|---|
| Product facts and availability | Bun platform domain owner | Versioned, display-safe projection |
| Published KES plans, quotas, features, promotions, and checkout availability | Platform billing/entitlement authority | Publish-approved pricing projection only |
| Approved templates and immutable preview references | Template/release authority | Approved metadata projection |
| Approved showcases, experts, reviewed plugins, and reviewed component packs | Their platform moderation/marketplace authorities | PII-free approved projections with artifact-kind/trust-tier separation |
| Public handoff intents | Product handoff authority | Opaque allowlisted intent contract |
| Identity, organization, workspace, site, billing, payment, transfer, moderation, and support state | Studio platform authorities | Excluded unless a purpose-built public projection explicitly permits a field |

The public flow is:

```text
public browser
    → same-origin apps/web route or route handler
        → private cluster request with no forwarded visitor credentials
            → Studio-owned versioned public projection
        ← strict packages/public-contracts envelope
    ← validated, redacted presentation response
```

Next.js route handlers are presentation BFFs, not a shadow backend. They do not query platform databases, call providers, inspect staff sessions, mutate customer state, or import Studio authorities. They validate every private response against `packages/public-contracts`, enforce bounded filters/pagination, preserve safe cache/ETag semantics, and fail closed on schema drift or unavailable authority.

Private projections exclude provisional organizations, private custom offers and setup negotiations, internal grants, provider credentials and identifiers, COGS, margins, internal entitlements, grandfathered contracts, payment state, transfer state, staff/auth/admin session material, secrets, and PII unless a later purpose-specific public contract explicitly permits non-sensitive fields.

### No hardcoded pricing truth

`apps/web`, its Markdown/MDX, fixtures used as production content, and shared brand/token packages do not hardcode authoritative:

- KES amounts or billing cadence;
- quotas, feature inclusion, promotions, or checkout availability;
- Paystack/provider plan or price identifiers;
- provider costs, margins, internal entitlements, grandfathered terms, or private offers.

The public pricing UI consumes only the publish-approved projection. Missing, expired, withdrawn, incomplete-cost, margin-rejected, malformed, or unavailable pricing suppresses amounts and purchase CTAs rather than guessing, retaining stale values, or falling back to editorial copy. Checkout and authoritative re-resolution occur on `app.fuma.co.ke`.

## Mechanical move sequence

The accepted sequence is ordered; later steps do not bypass earlier evidence:

1. Validate FUMA-018 through FUMA-024, record clean baseline build/test/lint evidence, and finalize hosted migration checksums.
2. Add workspace boundaries and root orchestration without dependency upgrades.
3. Move current application paths with `git mv` into `apps/studio` and retain root command wrappers.
4. Prove fresh and upgrade SQLite, PostgreSQL, Docker, publishing, and self-host release parity.
5. Add exactly the three bounded shared packages and scaffold `apps/web` with exact dependency pins.
6. Add workspace-aware affected-application CI, paired images, deployment, and rollback evidence.

The move is structural only. It performs no database, object, upload, content, identity, or configuration data migration.

## Self-host and rollback contract

The self-hosted Instatic distribution remains a supported product of `apps/studio`. Relocation must preserve its SQLite/PostgreSQL selection, migrations, image/release contract, ports, environment variables, volumes, uploads, publishing, plugin tooling, startup commands, and upgrade behavior. A workspace conversion is not permission to make hosted-only assumptions in the self-host path.

Repository-conversion rollback uses normal Git reversion of the mechanical move and orchestration changes. It does not use database down migrations, destructive SQL, data rewrites, lockfile regeneration with upgraded dependencies, or a parallel compatibility tree. Existing release tags remain valid.

A public-web rollback is independently deployable and must not interrupt auth, customer product, tenant publishing, or self-host releases.

## Immutable migration baseline

The repository move does not alter migration history:

- `server/db/migrations-pg.ts` and `server/db/migrations-sqlite.ts` remain the immutable paired historical Instatic sources until their paths move mechanically under `apps/studio`.
- Their exact baseline hashes remain guarded by `src/__tests__/architecture/fuma-platform-architecture.test.ts`; parity remains guarded by `src/__tests__/architecture/migration-parity.test.ts`.
- `server/fuma/db/migrations/**` remains the additive, PostgreSQL-only hosted stream until mechanically relocated.
- Applied hosted IDs, source checksums, and migration high-water marks remain unchanged; relocation cannot regenerate, renumber, rewrite, mirror to SQLite, or reapply them.
- `src/__tests__/fuma/hostedMigrationsTransition.test.ts` remains the focused hosted migration/transition evidence before path relocation.
- Existing SQLite is preserved as self-host authority and as an explicit transition source; the workspace move itself neither imports nor cuts over it.

Before FUMA-WEB-002 changes paths, the primary implementation owner must record the current migration hashes/checksums and current command evidence. This ADR does not assert that those commands have passed.

## FUMA-WEB-001 and FUMA-WEB-002 boundary

| Task | Owns | Explicitly does not own |
|---|---|---|
| FUMA-WEB-001 | This ADR, workspace/public-web policy, expected hostile boundary gate, and pre-relocation evidence requirements | Root workspace edits, dependency changes, file moves, app scaffolding, code, migration edits, or data migration |
| FUMA-WEB-002 | Private root Bun workspace metadata/base config, one-lockfile orchestration, mechanical `git mv` into `apps/studio`, preserved root commands, and history/checksum verification | Public-web implementation, new business authorities, migration/data changes, dependency upgrades, speculative packages, or self-host behavior changes |

FUMA-WEB-003 proves self-host parity after the move. FUMA-WEB-004 establishes the three shared packages. FUMA-WEB-005 scaffolds `apps/web`. FUMA-WEB-006 implements the private projection and BFF contract. WEB-002 must not absorb those later responsibilities.

## Enforced gates and evidence

FUMA-WEB-001 is enforced by:

```text
apps/studio/src/__tests__/architecture/fuma-workspace-public-web-architecture.test.ts
apps/studio/src/__tests__/architecture/fuma-workspace-migration-baseline.test.ts
tooling/workspace/auditor.ts
tooling/workspaceMigrationBaseline.ts
```

The FUMA-WEB-001 future-workspace gate exercises one complete valid fixture and an independent hostile fixture for every typed rule. It rejects:

- nested Git repositories/submodules and nested or foreign lockfiles;
- Turborepo or a non-Bun workspace orchestrator;
- any initial shared package outside `brand`, `design-tokens`, and `public-contracts`;
- app-to-app imports, Next.js in Studio, and Studio server/auth/provider/repository/publisher/migration/admin imports in Web;
- React/Next/Bun/database/auth/provider imports in `public-contracts`, and Zod anywhere in the boundary;
- parent-domain/shared cookies, unsafe cookie attributes, app/admin session reuse, and Better Auth routes outside the auth host;
- product routes on admin, console routes on app, or staff routes/cookies on public, tenant, or customer hosts;
- allocation of `auth`, `app`, `www`, `api`, `admin`, `status`, `support`, or `mail` as tenant labels;
- unknown-host fallback, a public `api.fuma.co.ke`, visitor-credential forwarding, or public direct database/provider access;
- hardcoded pricing truth or private pricing/payment/cost fields in public-web content/contracts;
- edits to historical migration content or changes to hosted migration IDs/checksums.

The machine-checked pre-relocation baseline projects canonical hosted IDs/checksums and shares the historical source-hash authority with the existing FUMA-001 gate. It is supplemented by:

```text
apps/studio/src/__tests__/architecture/fuma-platform-architecture.test.ts
apps/studio/src/__tests__/architecture/migration-parity.test.ts
apps/studio/src/__tests__/fuma/hostedMigrationsTransition.test.ts
```

FUMA-SITE-001 must add independent hostile gates for `apps/site-runtime`, exact tenant host/cache isolation, app-local Tailwind, release-bound component versions, and arbitrary server-code rejection before the target owner changes. The primary implementation owner must record the actual current output of the following commands before relocation, then repeat the repository-required checks after implementation:

```sh
bun test
bun run build
bun run lint
```

The evidence record must also include historical migration hashes, hosted migration IDs/source checksums/high-water mark, and representative `git log --follow` results after the move. The post-move history samples belong to FUMA-WEB-002 because no paths move in this task.

### Pre-relocation evidence — 2026-07-25

Primary-agent verification before any workspace move:

- FUMA-WEB-001 focused gates: **78 passed, 0 failed, 167 assertions** across the complete valid fixture, 25 typed rejection rules, all hostile subcase matrices, deterministic ordering, symlink containment, and canonical migration evidence.
- Existing migration integration: **53 passed, 1 environment-gated live-PostgreSQL skip, 0 failed, 235 assertions** across FUMA-001 architecture, PostgreSQL/SQLite parity, and hosted transition history.
- `bun run build`: passed `tsc -b` and the production Vite build with **2,046 modules**; normal output remains `dist/index.html`.
- `bun run lint`: passed.
- Primary full `bun test`: **6,910 passed, 8 environment-gated skips, 25 failed across 6,943 tests**. The failures were recorded rather than hidden: 20 plugin runtime/handler tests, one canvas behavior test, and four pre-existing architecture budgets (seven oversized FUMA server modules, hosted PostgreSQL syntax in current `DbClient` consumers, three pre-auth CSS token aliases, and the existing admin entry chunk). None names or imports a FUMA-WEB-001-owned file; both new gates pass inside the full run. Repository policy permits task-local completion when unrelated parallel work is failing, but FUMA-WEB-002 must repeat and re-triage the full gate after relocation.

Immutable evidence:

- `server/db/migrations-pg.ts`: `428010a428294c6b434956eb5e00aba682b7359107eb4fbf1732d8dac774cf34`.
- `server/db/migrations-sqlite.ts`: `e5ae1d091f5b385ef55e4a8928e5f60e223a6a5094df3132f69f8aa7404ad150`.
- Canonical hosted runnable history remains contiguous through `000009_tenant_keys`; every source checksum equals `HOSTED_MIGRATION_CHECKSUMS`, and the focused baseline rejects content, ID, order, checksum, and high-water substitutions.

## Forbidden patterns

- Wrapping this repository in another repository, using nested Git/submodules, or introducing Turborepo.
- More than one lockfile or an install authority below the root.
- Adding shared packages beyond the exact initial three without a demonstrated second consumer and a separate architecture decision.
- Any app importing another app.
- A public API host, cross-subdomain staff cookie, parent-domain cookie, or Better Auth route outside `auth.fuma.co.ke`.
- App sessions authorizing admin, admin sessions authorizing customer mutations, or staff cookies reaching public/tenant/customer hosts.
- Public Web importing or duplicating Studio repositories, auth, providers, billing, publishing, moderation, migration, or tenant-routing authority.
- Hardcoded authoritative prices, quotas, availability, promotions, provider IDs, costs, or margins in public-web code/content.
- A public-web CMS, tenant-publisher reuse, direct public database access, or a BFF that becomes a shadow backend.
- A default-site/default-host fallback for unknown, malformed, inactive, reserved, or conflicting hosts.
- Data migration, destructive rollback, migration renumbering, or migration checksum changes as part of the workspace conversion.
- Breaking or silently narrowing the self-hosted Instatic release contract.

## Related

- [`fuma-platform-architecture.md`](fuma-platform-architecture.md) — tenant hierarchy, pooled topology, process roles, and immutable migration policy.
- [`fuma-hosted-migrations-transition.md`](fuma-hosted-migrations-transition.md) — hosted migration checksums and SQLite transition evidence.
- [`fuma-hosted-staff-auth.md`](fuma-hosted-staff-auth.md) — current mounted hosted staff boundary that the centralized auth-host architecture must supersede through its owning tasks.
- [`architecture-tests.md`](architecture-tests.md) — catalog of enforced repository architecture gates.
- `package.json`, `apps/studio/package.json`, and root `bun.lock` — current workspace orchestration and dependency authority.
- `apps/studio/server/db/migrations-pg.ts`, `apps/studio/server/db/migrations-sqlite.ts` — relocated immutable historical migration sources.
- `apps/studio/server/fuma/db/migrations/` — relocated additive hosted migration stream.
- Enforced workspace gate: `apps/studio/src/__tests__/architecture/fuma-workspace-public-web-architecture.test.ts`.

### Post-relocation evidence — 2026-07-25

Primary-agent verification after the mechanical `apps/studio` move:

- The repository root is the private Bun workspace/orchestration package; `apps/studio` is `@fuma/studio`. Root commands dispatch with `bun --cwd=apps/studio`, while root-owned lint and workspace tooling retain explicit root dependencies.
- `bun install --frozen-lockfile` passed, and a second frozen lock-only pass left `bun.lock` byte-for-byte unchanged. The lock audit found no upgrades to pre-existing resolutions; workspace re-resolution only downgraded/deduplicated existing ESLint transitive entries. No app-local lockfile was created. The tracked `vendor/pixel-art-icons/bun.lock` predates WEB-002 and remains preserved as non-authoritative metadata in the vendored source snapshot; root `bun.lock` is the sole workspace install authority.
- Focused workspace and migration integration: **131 passed, 1 environment-gated live-PostgreSQL skip, 0 failed, 384 assertions** across the workspace policy, relocation baseline, FUMA-001 platform policy, paired historical migrations, and hosted transition history. The canonical two-gate rerun separately passed **78 tests, 0 failed, 149 assertions**.
- Historical sources now live at `apps/studio/server/db/migrations-pg.ts` and `apps/studio/server/db/migrations-sqlite.ts`; their SHA-256 values remain `428010a428294c6b434956eb5e00aba682b7359107eb4fbf1732d8dac774cf34` and `e5ae1d091f5b385ef55e4a8928e5f60e223a6a5094df3132f69f8aa7404ad150`. Hosted history remains contiguous through `000009_tenant_keys`, with canonical checksums unchanged.
- `bun run lint` passed for `apps/studio` plus root `tooling`.
- The relocated production Vite build passed with **2,046 modules** after Studio declared the already-locked React Compiler Babel peer directly. The complete root `bun run build` dispatches correctly but TypeScript is currently blocked by an unrelated untracked hosted-auth lane at `apps/studio/server/auth/hosted/auth.ts` (`BetterAuthPlugin` incompatibility); WEB-002 did not modify that implementation.
- Final primary `bun test`: **6,897 passed, 6 environment-gated skips, 29 failed across 6,932 tests**. All 34 relocation regressions from the first post-move run were eliminated. The remaining result is the exact 25-failure pre-move baseline plus four failures/errors from the same unrelated untracked Better Auth lane (one FUMA-013 named failure and three module-load errors).
- Root command smoke: `bun run fuma:migrate --next=workspace-smoke` returned `000010_workspace_smoke` without connecting to or mutating a database.
- Git's index records pure renames for representative entrypoints (`server/index.ts -> apps/studio/server/index.ts` and `src/admin/main.tsx -> apps/studio/src/admin/main.tsx`, zero insertions/deletions). Their pre-move histories remain headed by `4d8fbaf9` and `5b84276e`; after this uncommitted move is committed, `git log --follow` resolves those histories through the new paths.

### FUMA-WEB-003 self-host parity gate — 2026-07-25

`apps/studio/src/__tests__/architecture/fuma-self-host-parity.test.ts` is the deterministic post-move authority for the self-host facade. It locks root-to-Studio commands, Docker build/runtime copies and `WORKDIR`, SQLite/PostgreSQL selection, all four Compose layers, durable database/uploads/published/TLS state, healthchecks, immutable relocated historical migration hashes, and release-bundle membership. The relocated Studio build is copied to the stable image static root `/app/dist`; Compose, Railway, Render, and generated install instructions retain that external contract. TLS bundles include the root `Caddyfile` required by `compose.tls.yml`.

The gate is structural and side-effect free: it does not start containers or mutate a database. Existing database migration/integration and publisher tests remain the behavioral evidence for applying historical upgrades and serving published output; this gate prevents the relocation facade from selecting a different database history or placing durable files outside mounted volumes.

`tooling/selfHostSmoke.ts` is the executable release-candidate proof. Its TypeBox-validated `--dry-run` command plan is covered by `tooling/selfHostSmoke.test.ts` without Docker; an explicit operator run consumes an already-built image and release bundle, then exercises isolated SQLite and PostgreSQL Compose projects through health, restart, forced image replacement, persistent DB/upload/published-path markers, and additive `schema_migrations` checks. `docs/deployment/self-host-smoke-harness.md` defines the command and cleanup contract.


Primary-agent acceptance executed the harness against locally built `instatic:fuma-web-003` and `.tmp/release/instatic-0.0.11-fuma-web-003-release-bundle.tar.gz`. Both isolated dialect projects passed health, static/admin serving, restart, forced same-image recreation, and persistence checks with **20 historical migrations per dialect**; database, upload, and published markers survived. The harness then left zero matching containers, volumes, or networks. The final focused gate passed **39 tests, 0 failures, 211 assertions**; root `bun run build` passed TypeScript plus the 2,046-module Vite build, and root lint passed. Live execution also closed three image-only seams that static checks could not prove: Studio-local isolated production dependencies, Better Auth's package-scoped Zod 4 resolution, and explicit `HOST=0.0.0.0` container binding while local defaults remain loopback-only.
FUMA-WEB-003 owns exhaustive Docker/self-host parity; the WEB-002 Docker edits only preserved workspace build/runtime path viability.

### FUMA-WEB-004 bounded shared-package gate — 2026-07-25

`apps/studio/src/__tests__/architecture/fuma-shared-packages.test.ts` independently audits the checked-out workspace rather than delegating to the FUMA-WEB-001 future-workspace auditor. It requires exactly `apps/studio`, `apps/web`, `packages/brand`, `packages/design-tokens`, and `packages/public-contracts`; unique package names; leaf and acyclic manifest/source dependencies; explicit, non-wildcard exports backed by source files; and no app/package-local lockfiles. It also keeps public contracts strict and TypeBox-only, rejects runtime/authority imports and private commercial fields, and keeps brand/token sources free of framework dependencies and JSX.

Focused verification:

```text
bun test apps/studio/src/__tests__/architecture/fuma-shared-packages.test.ts
66 passed, 0 failed, 66 assertions
```

The result includes the real package tree, one valid independent fixture, isolated hostile mutation coverage for all 12 typed rules, and matrices for nested lock formats and symlink bypasses, runtime/authority imports, non-TypeBox dependencies, strict object schemas, private commercial fields, framework dependencies, source-level package coupling, dependency cycles, and wildcard/deep export drift.

Integrated primary-agent evidence: all three workspaces are present in the single root lockfile, a frozen lock-only install is byte-stable, and no nested package lock exists. Studio consumes `@fuma/brand` as the single authority for its existing Fuma product/host/Kenya metadata. Package validation passed **2 brand tests (5 assertions)**, **4 design-token tests (24 assertions)**, strict public-contract typechecking and hostile validation, plus **172 combined shared-package/future-workspace/config tests (664 assertions)**. Root build typechecked all three packages and Studio before completing the **2,046-module** Vite bundle; root lint passed across `apps/studio`, `packages`, and `tooling`.

A final primary `bun test` snapshot passed **6,996 tests**, skipped **8 environment-gated integrations**, and retained the historical **25 unrelated failures** in plugin runtime/handlers, canvas behavior, and pre-existing module/SQL/CSS/bundle budgets. WEB-004's package and integration gates did not fail. The first snapshot exposed two stale workspace-era assertions—root build delegation in the WEB-003 parity gate and FUMA-010's old app-local lock path—which were corrected and then passed **14 tests, 1 environment skip, 0 failures** before the final full run.

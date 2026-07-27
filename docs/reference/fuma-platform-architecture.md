# Fuma Platform Architecture Policy

This reference defines the architecture policy enforced while the current Instatic implementation becomes the Fuma hosted platform.

FUMA-001 is a policy foundation: `src/__tests__/architecture/fuma-platform-architecture.test.ts` rejects architecture drift, while later tasks implement tenancy, profile registries, process roles, and the hosted migration stream. This document does not implement or claim those runtime features.

---

## TL;DR

- Tenant ownership follows `user → organization → workspace → site`; repositories and request paths must not add new singleton/default-site assumptions.
- Website and Publication are capability-composed profile presets, not core modes. Shared routing, permissions, persistence, and navigation never branch on those profile IDs.
- Fuma hosted dev, test, and production acceptance is PostgreSQL-only and pooled by default. Per-site SQLite and dedicated customer infrastructure defaults are forbidden.
- Fuma remains one Bun modular monolith. Web, worker, and scheduler composition roots do not import one another; Kafka, Elasticsearch, service meshes, and microservice frameworks are not part of the platform.
- Drizzle stays under `server/auth/` as the current Better Auth boundary. FUMA-010's unmounted compatibility evidence is isolated under `server/fuma/auth/compatibility/`; no other Fuma path may import Drizzle. Application persistence continues through `server/db/client.ts`.
- Historical `server/db/migrations-pg.ts` and `server/db/migrations-sqlite.ts` are immutable. FUMA-006 provides the separate additive PostgreSQL-only hosted stream and validated SQLite transition path; FUMA-024 adds owner-key, resource-mapping, and resumable evidence sidecars without altering historical tenant tables.
- Existing SQLite installations and data remain import sources and are never discarded. Marketing and future Commerce, Courses, Directory, and Community profiles remain deferred.

## Scope hierarchy

The ownership chain is exactly:

```text
user → organization → workspace → site
```

A user participates through organization membership. An organization owns workspaces; a workspace groups sites; a site owns its profile assignment, capability overrides, content, settings, and integrations. The current production sources still contain inherited singleton behavior in `server/repositories/site.ts` and `server/handlers/cms/setup.ts`; the gate freezes exactly three `id = 'default'` occurrences so the debt can shrink but cannot spread.

FUMA-001 does not add tenant tables, request context, scoped repositories, or switchers. Those runtime changes belong to later backlog tasks. New code must nevertheless preserve the hierarchy and must not infer organization, workspace, or site scope with `id = 'default'` or `LIMIT 1` tenant queries.

## Profiles compose capabilities

Website and Publication are launch presets assembled from capability contributions. Registering either preset is valid. The forbidden shape is a profile-ID decision in shared routing, permission, persistence, repository, access, or navigation code:

```ts
// Forbidden in shared composition code.
if (profileId !== 'publication') return websiteRoutes

const selectedProfile = profileId
return ['website'].includes(selectedProfile) ? websiteRoutes : sharedRoutes
```

The gate parses TypeScript and JavaScript and inspects `if`, `switch`, and conditional-expression conditions. It recognizes equality and inequality comparisons, inline or straightforward locally bound literal-array/`Set` `includes`/`has` checks, and straightforward local aliases assigned from `profileId`, `profile.id`, or `productProfile.id`. It resolves local static string bindings for profile declaration `id` properties, including object shorthand. It does not ban Website or Publication string literals generally, so profile preset registration remains valid.

Shared code resolves registered contributions and capability grants instead. Profile presets provide defaults rather than permanent capability walls, so a capability can be granted across profiles without editing core switches.

No placeholder module, route, table, schema, profile registration, or profile-shaped object is created for Commerce, Courses, Directory, Community, or other future profiles. Public marketing at `fuma.co.ke` is also deferred; this repository does not add a marketing application under FUMA-001.

## Hosted topology

Fuma hosted acceptance uses shared PostgreSQL, pooled cache/coordination, pooled object storage, pooled process capacity, and pooled edge capacity. Dedicated placement can become an explicit separately priced enterprise choice, but it is never the default allocation for a site, customer, or organization.

A dedicated or isolated allocation call is accepted only when its call site is structurally inside positive dedicated-placement and enterprise/paid/opt-in guards. An unrelated comment, constant, or file-wide keyword does not exempt an unconditional call. Conjunctive nested guards are accepted; negative or disjunctive conditions do not establish the required placement facts.

Per-site SQLite files are forbidden in Fuma hosted code. The existing SQLite adapter at `server/db/sqlite.ts` and selector at `server/db/index.ts` remain valid for current installations, local development, tests, and eventual import tooling; their existence does not make SQLite a hosted acceptance target.

The runtime remains one Bun modular monolith. Later process composition may expose web, worker, and scheduler roles, but each role is an independent composition root and cannot import a sibling root. The gate classifies role roots in flat `<role>.ts`, nested `<role>/{bootstrap,index,main}.ts`, `start<Role>.ts`, and explicit `<role>Root.ts`, `<role>CompositionRoot.ts`, or `<role>Bootstrap.ts` forms under `server/fuma/{runtime,process,processes,roles}/`; kebab, dotted, and underscored separators are also recognized, with web/worker/scheduler equivalents. A role root may import shared or domain modules. Static ESM imports/re-exports, dynamic imports with a static module specifier, and direct or member `require` forms are inspected.

The platform does not add Kafka, Elasticsearch, a service mesh, a microservice framework, or a default database/cache/bucket/process/edge allocation per tenant.

## Persistence and migration boundary

Two migration domains are intentionally distinct:

| Domain | Current source | Policy |
|---|---|---|
| Historical Instatic schema | `server/db/migrations-pg.ts`, `server/db/migrations-sqlite.ts` | Immutable paired PostgreSQL/SQLite history, protected by deterministic SHA-256 values in `src/__tests__/architecture/fuma-platform-architecture.test.ts`. |
| Fuma hosted schema | `server/fuma/db/migrations/**` | Separate PostgreSQL-only additive, forward-only stream with immutable source checksums and database history. FUMA-006 owns its runner and transition bookkeeping; tenant domain schema remains owned by later tasks. |

FUMA-006 establishes `fuma_hosted_schema_migrations` plus resumable import receipts as hosted bookkeeping schema. The runner validates immutable source checksums and applied history, rejects destructive SQL, and serializes concurrent application with a PostgreSQL transaction-scoped advisory lock. The transition utility preserves and validates IDs, content, media references, identity links, counts, hashes, and foreign keys before recording completion.

FUMA-024 migration `000009_tenant_keys` adds a stable site owner-key directory, sidecar row/object mappings, and resumable per-class count/hash/FK receipts. It does not alter or rewrite historical Instatic tables. The complete inventory and boundary contracts live in `apps/studio/server/fuma/tenancy/`; see `docs/reference/fuma-tenant-keys.md`.

FUMA-048 migration `000011_releases` follows `000010_editor_resources` and adds immutable hosted release rows, one exact-site active pointer, and retention roots. Release manifests and finalized hashes cannot be overwritten; active releases are deletion-protected. The lifecycle remains separate from renderer/worker activation; see `docs/reference/fuma-immutable-releases.md`.

The gate recognizes canonical and plausible hosted migration locations, including `server/fuma/db/migrations/**`, `server/fuma/migrations/**`, `server/db/migrations-hosted/**`, `server/db/migrations-fuma.ts`, and `server/fuma/db/migrations-sqlite.ts`. Hosted migration text rejects destructive operations such as `DROP`, `TRUNCATE`, row `DELETE`, and table/column renames; a hosted SQLite migration path or parity/mirror declaration is rejected. The two historical migration files are excluded from hosted-path classification and instead protected by their exact hashes.

Existing SQLite data is durable source material: transition tooling must preserve and validate IDs, content, media references, identity links, counts, hashes, and foreign keys before hosted authority changes. A hosted startup path must never silently abandon a SQLite database.

Drizzle is reserved for Better Auth integration under `server/auth/`, plus the unmounted FUMA-010 evidence under `server/fuma/auth/compatibility/`. The TypeScript AST scan catches named/default/side-effect ESM imports, re-exports, `import = require`, dynamic imports with a static module specifier, and direct or member (`module.require`) require calls. Code outside those auth boundaries uses `server/db/client.ts`.

## Gate behavior

`src/__tests__/architecture/fuma-platform-architecture.test.ts` uses AST analysis where syntax matters and text scans where the policy concerns SQL, configuration, dependency names, or paths:

- scans nonzero production/config files under `server/`, `src/`, `scripts/`, configuration/deployment roots, and selected root files;
- ratchets inherited singleton SQL by exact file and occurrence count and exercises qualified/reversed singleton fixtures;
- rejects hosted per-site SQLite, unconditional dedicated/isolated tenant allocation, forbidden distributed infrastructure, and every supported Drizzle import form outside `server/auth/` and `server/fuma/auth/compatibility/`;
- rejects speculative profile paths/tables/registrations and profile-name decisions in shared branch expressions, including straightforward aliases;
- classifies flat, nested-bootstrap, and `start<Role>` web/worker/scheduler roots and rejects sibling-root module references;
- recognizes canonical and plausible hosted migration paths, rejects destructive hosted SQL and hosted SQLite mirrors/parity sources, and preserves immutable historical hashes;
- exercises the hostile auditor bypass corpus directly, along with positive profile-registration, shared/domain import, guarded dedicated placement, and pooled PostgreSQL fixtures.

The ignored local files `docs/plans/fuma-platform-plan.md` and `docs/plans/fuma-execution-backlog.md` may provide execution context in a developer workspace. They are not tracked references and are not required for CI; this file and its gate are the durable FUMA-001 contract.

## Forbidden patterns

- Singleton tenant selection with `id = 'default'` or `FROM organizations|workspaces|sites ... LIMIT 1` outside the documented inherited ledger.
- Per-site/customer SQLite clients or database files in hosted Fuma code.
- Dedicated or isolated database, cache, bucket, process, worker, scheduler, or edge allocation without structural dedicated plus enterprise/paid/opt-in placement guards.
- Kafka, Elasticsearch, Istio/Linkerd/service-mesh configuration, or microservice-framework dependencies.
- Any supported Drizzle module-reference form outside `server/auth/` and `server/fuma/auth/compatibility/`, including side-effect imports.
- Placeholder or registered Commerce, Courses, Directory, or Community profiles or tables.
- Launch-profile equality/inequality, literal collection membership, switch cases, or alias-based decisions in shared routing, permissions, persistence, repositories, access, or navigation.
- A flat, nested-bootstrap, or `start<Role>` web, worker, or scheduler composition root importing a sibling composition root.
- Destructive SQL in a recognized hosted migration path, a hosted SQLite migration source, hosted SQLite parity/mirror declarations, or edits/deletion of historical migration sources.

## Related

- `CLAUDE.md` — agent rules for Fuma architecture, live data, and migration streams.
- `docs/reference/architecture-tests.md` — catalog of architecture gates.
- `docs/reference/fuma-tenant-keys.md` — stable owner-key sidecars, resource inventory, and resumable evidence.
- `docs/reference/database-dialects.md` — current Instatic adapter and historical parity behavior.
- `docs/architecture.md` — current implementation layout; read this for code that exists today.
- Source-of-truth persistence boundary: `server/db/client.ts`
- Historical migration sources: `server/db/migrations-pg.ts`, `server/db/migrations-sqlite.ts`
- Better Auth boundary: `server/auth/`
- FUMA-010 compatibility evidence: `server/fuma/auth/compatibility/`
- Gate test: `src/__tests__/architecture/fuma-platform-architecture.test.ts`

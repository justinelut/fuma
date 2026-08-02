# Instatic Docs

The documentation tree for Instatic. This index tells you what to read, in what order, and where to look for what.

If you're an agent: start at `CLAUDE.md` (repo root) for the rules, then come here for the explanations.
If you're a human contributor: start with [`architecture.md`](architecture.md), then read whichever feature or reference page is closest to what you're changing.

---

## How to read this tree

```text
docs/
├── README.md                   ← this file (start here)
├── CONVENTIONS.md              ← how docs in this repo are written (read before authoring)
│
├── architecture.md             ← system overview (start here for orientation)
├── design.md                   ← visual design system (tokens, surfaces, components)
├── server.md                   ← server-side deep dive
├── editor.md                   ← admin + visual editor deep dive
│
├── features/                   ← "what X is and how it works" (per-feature)
│   ├── plugin-system.md            ← plugin SDK, sandbox, lifecycle, permissions
│   ├── publisher.md                ← page tree → static HTML/CSS pipeline
│   ├── visual-components.md        ← VCs, slots, params, instantiation
│   ├── content-storage.md          ← data_tables + data_rows (the universal store)
│   ├── content-workspace.md        ← Content workspace: collections, entries, body editor
│   ├── auth-and-access.md          ← sessions, MFA, capabilities, roles
│   ├── site-shell.md               ← site config (breakpoints, classes, files, deps)
│   ├── modules.md                  ← module engine + first-party blocks
│   ├── data-workspace.md           ← Data workspace: table schema + field management UI
│   ├── dashboard.md                ← Dashboard workspace + widget registry
│   ├── spotlight.md                ← Cmd+K command palette
│   ├── agent.md                    ← AI agent integration
│   ├── templates.md                ← entry templates + dynamic bindings
│   ├── loops.md                    ← base.loop + loop sources
│   ├── cms-native-forms.md         ← visual form primitives + data_rows submissions
│   ├── media.md                    ← Media workspace + storage adapters
│   ├── audit-log.md                ← audit_events catalog
│   ├── site-transfer.md            ← export / import CMS bundles
│   ├── site-import.md              ← Super Import (static sites → CMS)
│   ├── html-import.md              ← paste / import HTML into the page tree
│   ├── editor-preferences.md       ← catalog-driven editor prefs
│   └── canvas-iframe-per-frame.md  ← per-breakpoint iframe rendering
│
├── reference/                  ← short cookbook pages for primitives + patterns
│   ├── page-tree.md                ← NodeTree<TNode> primitive
│   ├── database-dialects.md        ← PostgreSQL architecture rules
│   ├── typebox-patterns.md         ← boundary validation patterns
│   ├── ui-primitives.md            ← Button/Input/etc. usage cookbook
│   ├── design-tokens.md            ← complete CSS token catalog
│   ├── module-engine.md            ← defining a new module
│   ├── canvas-dnd.md               ← drag-and-drop patterns
│   ├── admin-router.md             ← in-house router usage
│   ├── css-class-registry.md       ← user CSS classes + scoped classes
│   ├── capabilities.md             ← full capability matrix
│   ├── persistence-keys.md         ← localStorage / server prefs catalog
│   ├── error-boundaries.md         ← boundary placements + error reporting
│   ├── architecture-tests.md       ← catalog of every architecture gate
│   ├── fuma-platform-architecture.md ← Fuma hierarchy, profiles, topology, migration policy
│   ├── fuma-workspace-public-web-architecture.md ← Bun workspace, public-web, host/session/data boundaries
│   ├── fuma-workspaces.md            ← organization-scoped workspace HTTP boundary and composition seam
│   ├── fuma-sites.md                 ← owned site lifecycle and exact-ID legacy bootstrap seam
│   ├── fuma-configuration.md          ← hosted env schema, product metadata, safe summaries
│   ├── fuma-profiles.md               ← Website/Publication capability composition registry
│   ├── fuma-permissions.md            ← permission catalog, persona matrices, and resolver precedence
│   ├── fuma-profile-composition.md    ← resolved onboarding/navigation UI and resume seams
│   ├── fuma-stable-context.md         ← hosted scoped URLs, context authority, switchers, FUMA-021 seam
│   ├── fuma-request-context.md        ← trusted request/internal-job derivation and immutable authority snapshots
│   ├── fuma-repository-scoping.md     ← exact hosted repository scope, owner-key authority, and FUMA-026 handoff
│   ├── fuma-runtime-boundary-scoping.md ← hosted HTTP, keys, objects, plugins, and job scope binding
│   ├── fuma-editor-multisite.md       ← site-keyed editor sessions, scoped persistence, and profile surfaces
│   ├── fuma-publication-shell.md      ← Publication direct routes, collapsed Design, editor/viewer behavior
│   ├── fuma-publication-authoring-delivery.md ← Publication collaboration, editorial, audience, newsletters, and OCI delivery
│   ├── fuma-publication-scheduling-access.md ← Durable publish/unpublish, preview tokens, recovery, and public audience gates
│   ├── fuma-public-web-scaffold.md     ← independent Next app and standalone runtime foundation
│   ├── fuma-public-projections.md      ← private Studio projections, strict contracts, and same-origin Next BFF
│   ├── fuma-public-handoff.md          ← opaque public intent, Better Auth resume, and app relying session
│   ├── fuma-public-marketing-analytics.md ← cookieless public acquisition, opaque funnels, and isolated retention authority
│   ├── fuma-audit-history.md          ← append-only hosted audit contracts, scoped listings, and read-only UI
│   ├── fuma-runtime-roles.md          ← web/worker/scheduler lifecycle and health contracts
│   ├── fuma-hosted-migrations-transition.md ← hosted PostgreSQL migration stream
│   ├── fuma-redis-coordination.md     ← namespaced Redis cache, limits, pub/sub, presence, leases
│   ├── fuma-object-storage.md         ← tenant-prefixed immutable MinIO object contracts
│   ├── fuma-durable-jobs.md           ← PostgreSQL job authority and Redis ready coordination
│   ├── fuma-transfer-saga.md          ← durable site ownership transfer, resume, and compensation
│   ├── fuma-tenant-keys.md            ← stable owner keys, resource inventory, and resumable evidence
│   ├── fuma-object-ownership-transfer.md ← manifest-gated object authorization policy transfer
│   ├── fuma-immutable-releases.md       ← immutable manifests, lifecycle, active pointer, retention roots
│   ├── fuma-artifact-installations.md   ← immutable plugin/component-pack releases and scoped installations
│   ├── fuma-artifact-reviews.md         ← scans, signed review, revocation, marketplace and install gate
│   ├── fuma-customer-payments.md        ← customer-merchant credentials, transport, ledger, webhooks, and transfer
│   ├── fuma-reviewed-customer-payment-plugin.md ← reviewed QuickJS payment blocks over shared merchant authority
│   ├── fuma-ai-confirmed-payment-setup.md ← fixed AI proposal, explicit confirmation, secure credential handoff, and preview
│   ├── fuma-tenant-runtime-architecture.md ← exact-host Next runtime and semantic component registry
│   ├── fuma-site-application-state.md ← member/application state, mutation fencing, rollout, and legacy compatibility
│   ├── fuma-component-catalog.md     ← private/reviewed component authoring, AI/MCP tools, installs, usage, and upgrades
│   ├── fuma-support-moderation-break-glass.md ← bounded impersonation, immutable moderation, owner recovery
│   ├── fuma-nextjs-source-import.md  ← GitHub/Next.js import, AI adaptation, full source export, and exit contract
│   ├── fuma-ai-backend-capability-boundary.md ← no-direct-DB AI rule, reviewed functions, dashboard, Ghost/agency scope
│   ├── fuma-launch-capability-packs.md ← Publishing, general, Events, Hospitality, Bookings, AI/design boundaries
│   ├── fuma-publish-release.md          ← durable semantic publishing, exact retries, atomic activation
│   ├── fuma-free-hosts.md               ← exact free-host allocation, active-release Host routing, fail-closed serving
│   ├── fuma-staff-identity.md         ← additive hosted auth links and preserved staff credentials
│   ├── fuma-hosted-staff-auth.md      ← same-origin staff routes, host-only sessions, pre-auth UI
│   ├── fuma-hosted-staff-security.md  ← MFA, session, admin, response-envelope client contract
│   ├── fuma-email-documents.md        ← allowlisted data-only tenant email renderer
│   ├── fuma-test-fixtures.md          ← deterministic tenant/provider/DB test scaffolding
│   ├── editor-history.md           ← patch-based undo/redo history
│   ├── react-compiler.md           ← memoization rule, three exceptions, gates
│   └── use-async-resource.md       ← canonical async load hook; when to use vs. not
│
├── deployment/                 ← operator docs (running the thing)
└── e2e/                        ← browser test protocols (agent-run + Playwright automation)
```

Three categories, three voices:

- **Top-level docs** are long-lived references that describe the system as it currently is.
- **Feature docs** describe one first-class capability — its architecture, lifecycle, file layout.
- **Reference docs** are short, focused cookbooks for primitives and patterns reused across features.

---

## Where to look first

### "I want to understand the system"

1. [`architecture.md`](architecture.md) — the 10-minute orientation. Process layout, layer responsibilities, request lifecycle, publishing pipeline, plugin sandbox, where everything lives.
2. [`design.md`](design.md) — what the editor looks like and why. Tokens, surface system, UI primitives.
3. [`server.md`](server.md) and [`editor.md`](editor.md) — the two deep dives. Pick whichever side you're touching.

### "I want to add a feature"

1. Skim [`architecture.md`](architecture.md) → "Where things live — decision table".
2. Read the feature doc closest to what you're adding (e.g. [`features/plugin-system.md`](features/plugin-system.md) for a plugin SDK extension).
3. Read the relevant reference doc(s) for the primitives you'll touch ([`reference/page-tree.md`](reference/page-tree.md), [`reference/database-dialects.md`](reference/database-dialects.md), [`reference/typebox-patterns.md`](reference/typebox-patterns.md)).
4. Make the change. Verify with `bun test && bun run build && bun run lint`.

### "I want to change the visual design"

1. [`design.md`](design.md) — the principles, tokens, surface systems.
2. `src/styles/globals.css` — the actual tokens.
3. `src/ui/components/` — the actual primitives.
4. If you're adding a new token or surface pattern, update `design.md` in the same change.

### "I want to add a new HTTP endpoint"

1. [`server.md`](server.md) → "Adding a new endpoint".
2. [`reference/typebox-patterns.md`](reference/typebox-patterns.md) for body validation.
3. [`reference/database-dialects.md`](reference/database-dialects.md) if persistence is involved.

### "I want to mutate the page tree"

1. [`reference/page-tree.md`](reference/page-tree.md) — the `NodeTree` primitive and `mutateActiveTree`.
2. [`editor.md`](editor.md) → "Editor store" for how mutations are wired up.

### "I want to write a plugin"

1. [`features/plugin-system.md`](features/plugin-system.md) — the SDK surface, lifecycle, sandbox rules.
2. `examples/plugins/template/` — working example.
3. `src/core/plugin-sdk/capabilities.ts` — permission catalog (source of truth).

### "I want to deploy / operate the CMS"

1. `README.md` (repo root) — install, run, basic commands.
2. [`deployment/README.md`](deployment/README.md) — platform and generic deployment targets.
3. [`deployment/backup-restore.md`](deployment/backup-restore.md) — backing up production data.

---

## Doc index

### Top-level

| Doc                         | What it covers                                                          |
|-----------------------------|-------------------------------------------------------------------------|
| [architecture.md](architecture.md) | System overview: process, folders, request lifecycle, data model, validation, decision tables |
| [design.md](design.md)      | Visual design system: principles, tokens, surface systems, UI primitives, forbidden patterns |
| [server.md](server.md)      | Server deep dive: boot sequence, router, handlers, auth, DB adapter, publishing, plugin runtime |
| [editor.md](editor.md)      | Admin + editor deep dive: routing, workspaces, editor store, canvas, sidebars, spotlight |
| [CONVENTIONS.md](CONVENTIONS.md) | How docs in this repo are structured and written (read before authoring) |

### Features

| Doc                                                              | What it covers                                                       |
|------------------------------------------------------------------|----------------------------------------------------------------------|
| [features/plugin-system.md](features/plugin-system.md)           | The plugin system end-to-end: package shape, lifecycle, sandbox, SDK, permissions, CLI |
| [features/publisher.md](features/publisher.md)                   | The page-tree-to-HTML/CSS renderer + server-side publishing wrappers |
| [features/visual-components.md](features/visual-components.md)   | VCs, slots, params, instantiation, recursion guard                   |
| [features/content-storage.md](features/content-storage.md)       | `data_tables` + `data_rows` — the universal content store           |
| [features/content-workspace.md](features/content-workspace.md)   | Content workspace UI: collections, entries, body editor, settings panel |
| [features/data-workspace.md](features/data-workspace.md)         | Data workspace UI: DataInspector, field management, DataGrid        |
| [features/auth-and-access.md](features/auth-and-access.md)       | Sessions, MFA, step-up, lockout, CSRF, capabilities                  |
| [features/site-shell.md](features/site-shell.md)                 | The persisted site config (breakpoints, classes, files, deps)        |
| [features/modules.md](features/modules.md)                       | Module engine, defining first-party blocks                          |
| [features/dashboard.md](features/dashboard.md)                   | Dashboard workspace, widgets, grid, customize mode                  |
| [features/spotlight.md](features/spotlight.md)                   | Cmd+K command palette                                                |
| [features/agent.md](features/agent.md)                           | AI agent integration and provider-agnostic runtime                   |
| [features/mcp-connectors.md](features/mcp-connectors.md)         | Instatic as an MCP server — external AI clients drive the CMS over MCP |
| [features/templates.md](features/templates.md)                   | Entry templates + dynamic bindings + token interpolation             |
| [features/loops.md](features/loops.md)                           | `base.loop` + loop entity sources                                    |
| [features/cms-native-forms.md](features/cms-native-forms.md)     | Visual form primitives and secure public submissions                 |
| [features/media.md](features/media.md)                           | Media workspace, upload pipeline, storage adapters                  |
| [features/audit-log.md](features/audit-log.md)                   | Audit event catalog + recording new actions                         |
| [features/site-transfer.md](features/site-transfer.md)           | Export / import CMS bundle (JSON round-trip between instances)      |
| [features/site-import.md](features/site-import.md)               | Super Import — static-site files / ZIP → pages, style rules, media |
| [features/html-import.md](features/html-import.md)               | HTML string → `PageNode` fragment (paste HTML, AI `insertHtml` tool) |
| [features/editor-preferences.md](features/editor-preferences.md) | Catalog-driven local UI preferences for the editor                   |
| [features/canvas-iframe-per-frame.md](features/canvas-iframe-per-frame.md) | Per-breakpoint iframe rendering in the visual editor canvas |

### Reference

| Doc                                                              | What it answers                                                  |
|------------------------------------------------------------------|------------------------------------------------------------------|
| [reference/page-tree.md](reference/page-tree.md)                 | The `NodeTree<TNode>` primitive — mutations, store routing      |
| [reference/database-dialects.md](reference/database-dialects.md) | PostgreSQL architecture, migrations, and repository cookbook                    |
| [reference/typebox-patterns.md](reference/typebox-patterns.md)   | Validating every untyped boundary with TypeBox                  |
| [reference/ui-primitives.md](reference/ui-primitives.md)         | Full UI primitive catalog with "when to use"                    |
| [reference/design-tokens.md](reference/design-tokens.md)         | Complete CSS custom property catalog                            |
| [reference/module-engine.md](reference/module-engine.md)         | "How do I define a new module?"                                 |
| [reference/canvas-dnd.md](reference/canvas-dnd.md)               | Drag-and-drop / drop zones / insert location                    |
| [reference/admin-router.md](reference/admin-router.md)           | In-house router primitives                                      |
| [reference/css-class-registry.md](reference/css-class-registry.md) | User-defined CSS classes + scoped classes                     |
| [reference/capabilities.md](reference/capabilities.md)           | Full capability matrix + how to add one                         |
| [reference/persistence-keys.md](reference/persistence-keys.md)   | All localStorage / sessionStorage / server-prefs keys           |
| [reference/error-boundaries.md](reference/error-boundaries.md)   | `<ErrorBoundary>` placements + reporting                        |
| [reference/architecture-tests.md](reference/architecture-tests.md) | Catalog of every architecture gate test                       |
| [reference/fuma-platform-architecture.md](reference/fuma-platform-architecture.md) | Fuma hierarchy, capability profiles, pooled topology, and migration boundaries |
| [reference/fuma-workspace-public-web-architecture.md](reference/fuma-workspace-public-web-architecture.md) | Bun workspace layout plus public-web host, session, data, move, and rollback boundaries |
| [reference/fuma-organizations.md](reference/fuma-organizations.md) | Organization creation, protected membership mutation, hooks, limits, and placement policy |
| [reference/fuma-workspaces.md](reference/fuma-workspaces.md) | Organization-scoped workspace HTTP routes, trusted actor injection, and the FUMA-021 composition seam |
| [reference/fuma-sites.md](reference/fuma-sites.md) | Owned site lifecycle, registry assignments, and exact-ID legacy bootstrap |
| [reference/fuma-permissions.md](reference/fuma-permissions.md) | Permission catalog, launch-persona matrices, precedence, and authorization boundaries |
| [reference/fuma-profile-composition.md](reference/fuma-profile-composition.md) | Resolved profile onboarding/navigation UI, durable resume, and mounting boundaries |
| [reference/fuma-website-parity.md](reference/fuma-website-parity.md) | Website launch-to-editor parity matrix, extension stability, and FUMA-027 boundary |
| [reference/fuma-stable-context.md](reference/fuma-stable-context.md) | Hosted scoped URLs, context authority, switchers, and the FUMA-021 trust boundary |
| [reference/fuma-request-context.md](reference/fuma-request-context.md) | Trusted staff request and internal-job context derivation, correlation, and immutable snapshots |
| [reference/fuma-repository-scoping.md](reference/fuma-repository-scoping.md) | Exact hosted repository scope, owner-key authority, 36-class coverage, and FUMA-026 handoff |
| [reference/fuma-runtime-boundary-scoping.md](reference/fuma-runtime-boundary-scoping.md) | Hosted HTTP, coordination/object keys, plugin calls, and durable-job scope binding |
| [reference/fuma-editor-multisite.md](reference/fuma-editor-multisite.md) | Site-keyed editor sessions, scoped PostgreSQL persistence, capability surfaces, and two-tab isolation |
| [reference/fuma-editor-draft-concurrency.md](reference/fuma-editor-draft-concurrency.md) | Monotonic draft sequences, atomic mutation batches, duplicate suppression, and visible conflict reconciliation |
| [reference/fuma-publication-collaboration.md](reference/fuma-publication-collaboration.md) | Ordered operation ledger, atomic reconciliation, accepted fan-out, explicit rebase, and reconnect catch-up |
| [reference/fuma-publication-shell.md](reference/fuma-publication-shell.md) | Publication subtitle/navigation, collapsed Design disclosure, direct-route permission guards, and editor/viewer behavior |
| [reference/fuma-public-web-scaffold.md](reference/fuma-public-web-scaffold.md) | Independent Next App Router scaffold, app-local Tailwind/shadcn, generated tokens, and standalone ARM64 runtime |
| [reference/fuma-public-projections.md](reference/fuma-public-projections.md) | Studio-owned anonymous projections, strict envelopes, private-cluster Next client, and same-origin BFF |
| [reference/fuma-public-handoff.md](reference/fuma-public-handoff.md) | Opaque public intent issuance, centralized Better Auth resume, single-use exchange, and app-host relying sessions |
| [reference/fuma-public-marketing-analytics.md](reference/fuma-public-marketing-analytics.md) | Cookieless baseline collection, consent-gated optional events, opaque conversion funnels, retention, and isolated `000079` persistence |
| [reference/fuma-public-web-seo.md](reference/fuma-public-web-seo.md) | Canonical metadata, strict JSON-LD, segmented sitemaps, eligible feeds, and immutable social cards |
| [reference/fuma-metering-cogs.md](reference/fuma-metering-cogs.md) | Immutable logical/physical usage, complete cost inputs, reservations, settlement, and provider reconciliation |
| [reference/fuma-platform-entitlements.md](reference/fuma-platform-entitlements.md) | Finite KES plans, complete economics gates, private-offer lifecycle, internal grant, and immutable entitlement snapshots |
| [reference/fuma-public-templates.md](reference/fuma-public-templates.md) | Approved immutable template releases, isolated previews, withdrawal tombstones, filters, and install handoff |
| [reference/fuma-public-trust-surfaces.md](reference/fuma-public-trust-surfaces.md) | Public trust/legal/contact/status surfaces, strict routing boundaries, and explicit production approval blockers |
| [reference/fuma-audit-history.md](reference/fuma-audit-history.md) | Append-only hosted audit schema, trusted recording, exact-scope listings, and read-only UI |
| [reference/fuma-transfer-saga.md](reference/fuma-transfer-saga.md) | Durable fenced site ownership transfer, resume, compensation, and claim-level worker contracts |
| [reference/fuma-tenant-keys.md](reference/fuma-tenant-keys.md) | Stable owner keys, complete table/object inventory, and resumable count/hash/FK evidence |
| [reference/fuma-object-ownership-transfer.md](reference/fuma-object-ownership-transfer.md) | Manifest-gated exact-prefix object authorization transfer and composed job registrations |
| [reference/fuma-immutable-releases.md](reference/fuma-immutable-releases.md) | Immutable release manifests, exact object verification, active pointer, and retention roots |
| [reference/fuma-expert-discovery.md](reference/fuma-expert-discovery.md) | Opt-in approved expert discovery, mediated encrypted inquiries, reviewed plugins, transfer fencing, moderation, and public projection |
| [reference/fuma-publish-release.md](reference/fuma-publish-release.md) | Durable snapshot claim, semantic rendering, immutable writes, fenced recovery, and atomic activation |
| [reference/fuma-configuration.md](reference/fuma-configuration.md) | Hosted environment schema, product metadata, and secret-safe summaries |
| [reference/fuma-hosted-staff-auth.md](reference/fuma-hosted-staff-auth.md) | Same-origin staff routes, host-only sessions, and pre-authentication UI |
| [reference/fuma-hosted-staff-security.md](reference/fuma-hosted-staff-security.md) | Hosted staff MFA, self-session, admin, and browser response contracts |
| [reference/fuma-support-moderation-break-glass.md](reference/fuma-support-moderation-break-glass.md) | Bounded Better Auth support impersonation, immutable moderation, and isolated owner recovery |
| [reference/fuma-test-fixtures.md](reference/fuma-test-fixtures.md) | Deterministic Fuma tenant/profile, provider, PostgreSQL, and transition-source test fixtures |
| [reference/editor-history.md](reference/editor-history.md)       | Patch-based undo/redo history: `HistoryEntry`, `mutate*` helpers, coalescing |
| [reference/react-compiler.md](reference/react-compiler.md)       | React Compiler memoization rule, three exceptions, enforcement gates |
| [reference/use-async-resource.md](reference/use-async-resource.md) | `useAsyncResource` — canonical single-resource async load hook; when to use and when not to |

### Operations

| Folder                              | Contents                                                          |
|-------------------------------------|-------------------------------------------------------------------|
| [deployment/](deployment/)          | Platform deploys, VPS/Docker installs, TLS, backup, releases      |
| [runbooks/fuma-paired-release.md](runbooks/fuma-paired-release.md) | Protected paired-image publication gates, evidence, and failure handling |
| [e2e/](e2e/)                        | Browser E2E protocols: agent-run audits and Playwright automation docs |

---

## Conventions in one paragraph

Every doc has the shape: **one-line scope statement → TL;DR → body sections → Related**. Every claim about code anchors to a real file path. Every invariant links to the gate test (in `src/__tests__/architecture/`) that enforces it. No history, no aspiration, no marketing copy — describe what the system is, not what it could be or what it used to be. If a doc is over ~600 lines, it's doing too much; split it. The full rules are in [CONVENTIONS.md](CONVENTIONS.md).

---

## Source-of-truth pointers

Quick map from "where do I look for X?" to the canonical file:

| Concept                          | Source of truth                                          |
|----------------------------------|----------------------------------------------------------|
| Agent rules and constraints      | `CLAUDE.md` (repo root)                                  |
| Design tokens                    | `src/styles/globals.css`                                 |
| UI primitives                    | `src/ui/components/`                                     |
| Page tree shape                  | `src/core/page-tree/treeSchema.ts`                       |
| Editor store                     | `src/admin/pages/site/store/`                            |
| Server router                    | `server/router.ts`                                       |
| CMS API handlers                 | `server/handlers/cms/`                                   |
| Repositories                     | `server/repositories/`                                   |
| DB adapter interface             | `server/db/client.ts`                                    |
| DB adapters                      | `server/db/postgres.ts`            |
| Migrations                       | `server/db/migrations-pg.ts` |
| Plugin SDK                       | `src/core/plugin-sdk/`                                   |
| Plugin permission catalog        | `src/core/plugin-sdk/capabilities.ts`                    |
| Plugin manifest parser           | `src/core/plugins/manifest.ts`                           |
| Plugin worker + sandbox host     | `server/plugins/pluginWorker.ts`, `server/plugins/host/workerPool.ts`, `server/plugins/quickjs/vm.ts`, `server/plugins/modulePackVm.ts` |
| Publisher                        | `src/core/publisher/`                                    |
| CSS value sanitiser              | `src/core/css-sanitize/sanitiseCssValue.ts`              |
| TypeBox helpers                  | `src/core/utils/typeboxHelpers.ts`                       |
| Error message extraction         | `src/core/utils/errorMessage.ts`                         |
| Architecture gate tests          | `src/__tests__/architecture/*.test.ts`                   |

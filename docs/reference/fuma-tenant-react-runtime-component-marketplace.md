# Fuma tenant React runtime and component marketplace

Status: **approved roadmap amendment; FUMA-SITE-001..005, FUMA-SITE-007..008, FUMA-067, and FUMA-068 closed; implementation pending FUMA-SITE-006**.

This reference defines the target hosted tenant-rendering architecture approved on 2026-07-28. [`fuma-tenant-runtime-architecture.md`](fuma-tenant-runtime-architecture.md) is the authoritative application/host/cache/component trust, migration, and rollback ADR; [`fuma-site-application-state.md`](fuma-site-application-state.md) records SITE-005. Immutable React release artifacts, the exact-host `apps/site-runtime`, first-party/private semantic React registry, app-local Tailwind/token bridge, persistent member/application state, fenced Bun mutation seam, bounded retained-release compatibility, component-pack policy, production artifact/install authority, and unified review/signing/revocation marketplace authority are implemented. AI/MCP component tools, the Lawyer source-component pilot, production routing, and capacity remain open. The existing semantic HTML publisher remains the production renderer until those dependency-ordered gates close.

## Decision

Fuma will add one horizontally scalable multi-tenant Next.js App Router application for hosted tenant and activated customer-domain websites. It will consume the existing exact host authority and immutable releases, interpret the canonical page/Visual Component tree through a versioned React component registry, and call Bun-owned APIs for dynamic or transactional behavior.

The decision preserves:

- the canonical `NodeTree` page and Visual Component model;
- the existing React visual editor and AI agent;
- Bun platform web/worker/scheduler roles;
- PostgreSQL, Redis, MinIO, Better Auth staff identity, and the separate site-member realm;
- domains, releases, activation, retention, rollback, quotas, billing, transfers, jobs, audit, and plugin sandbox authorities;
- the semantic HTML compiler as static/export/reference/legacy compatibility.

It rejects:

- one generated or deployed Next application per customer;
- arbitrary JSX or Tailwind utilities persisted as the canonical page model;
- arbitrary tenant/plugin React server code in the shared Next process;
- app-to-app imports, direct Next database/provider access, or a shared UI package;
- rebuilding routing, hydration, prefetching, RSC, and deployment coordination as a custom Bun framework;
- introducing Tailwind into legacy Studio admin/editor code.

## Application and host boundary

The future workspace adds an application, not another shared package:

```text
apps/studio        Bun platform, React/Vite editor, self-host product, authorities
apps/web           Next public acquisition and trust site for trimly.co.ke
apps/site-runtime  Next multi-tenant hosted website renderer
```

All three applications remain independently buildable and never import another application. `apps/site-runtime` uses app-local exact-pinned Tailwind/shadcn source and TypeBox-validated private contracts. Studio retains CSS Modules and current primitives. The initial three leaf packages remain unchanged unless a later task proves and gates a separate non-UI contract consumer.

Target host flow:

```text
exact tenant/customer Host
  -> Studio-owned host authority
  -> exact owner/site/active immutable release
  -> immutable runtime tree + route/component/style manifest
  -> apps/site-runtime React server rendering
```

Unknown, malformed, reserved, inactive, or conflicting hosts fail closed. There is no process-global current tenant and no default-site fallback. Cache identity includes exact host, owner/site, owner generation, release ID/hash, route, canonical query, public/member scope, and runtime deployment/component-registry version.

## Navigation and rendering

Internal tenant links resolve existing `cms:page:*` references and same-tenant paths through Next `<Link>`, preserving shared layouts and enabling prefetching, streaming, and client transitions. External URLs, downloads, non-HTTP schemes, and new-window links remain safe ordinary anchors.

Server Components are the default for content, layout, media, listings, metadata, and public data. Client Components are narrow boundaries for state, events, browser APIs, carts, booking controls, account UI, filters, and optimistic mutations. A page does not become a client component because one child is interactive.

The current HTML compiler remains available for:

- simple static hosted routes during migration;
- self-hosted publishing and portable export;
- legacy releases and string-render plugin modules;
- deterministic reference/conformance output;
- emergency rollback and no-React artifacts.

## Tailwind ownership

Tailwind is the preferred implementation language for trusted Fuma React components because it gives human and AI authors a bounded, reviewable responsive vocabulary. It is not the persisted site styling model, and the component registry is an open exact-version index rather than a closed catalog.

```text
trusted/validated component source -> static TSX/Tailwind classes
site theme                         -> release-bound CSS variables from Core Framework tokens
visual-editor changes              -> existing class/style/breakpoint/condition rules
advanced author CSS                -> existing sanitized stylesheet boundary
```

Rules:

1. Tailwind and shadcn are exact-pinned and app-local to `apps/site-runtime`.
2. Studio remains Tailwind-free.
3. Utility classes must occur as complete statically detectable strings; dynamic construction such as `bg-${color}-500` is rejected.
4. Arbitrary classes stored in PostgreSQL do not become runtime compilation input.
5. AI/designer-generated React/Tailwind source compiles only in an isolated draft/build boundary; validated immutable CSS/client artifacts, not arbitrary source strings, enter a release.
6. Semantic utilities map to tenant release CSS variables; tenant identity is data, not a new app build.
7. Tailwind and Fuma CSS use a fixed tested cascade with user rules last where policy permits.
8. Client bundle, CSS, hydration, accessibility, security, and responsive budgets are gated.

## Component registry and private authoring

A release node continues to store stable data such as `moduleId`, props, children, classes, inline styles, overrides, and bindings. It never stores executable JSX. The runtime resolves an exact release-bound registry entry:

```text
module namespace + component ID + exact version
  -> TypeBox props/slot contract
  -> official/trusted component, private declarative tree, or validated restricted client artifact
  -> declared capabilities/data bindings/assets
```

Registry sources include official Fuma components, private site-created components, AI-created components, designer-created components, source imports, team packs, and reviewed marketplace packs. AI and designers may create new components, versions, variants, props, slots, loops, conditions, bindings, styles, tokens, responsive behavior, animations, and interactions. The registry indexes those immutable definitions; it does not limit authors to pre-existing catalog entries.

Private component creation and marketplace distribution are separate lifecycle decisions:

- valid declarative private components may be created, edited, versioned, release-pinned, and used immediately by their owning site/team without marketplace approval;
- generated React/Tailwind source remains an isolated draft until TypeScript/build/static-Tailwind/accessibility/security/budget validation, explicit permission disclosure, and owner confirmation produce an immutable exact-version restricted-client artifact;
- server code or provider/network/payment/secret authority requires stronger dependency/provenance/license/security review and explicit promotion; arbitrary tenant React Server Components are never dynamically imported into the shared Next process.

Missing, incompatible, owner-mismatched, revoked-for-security, or invalid components fail closed before activation. Active immutable releases retain every referenced component version and artifact root. Restriction follows execution authority and distribution risk, not visual creativity.

## Marketplace taxonomy

The product distinguishes:

- **component**: one visual or interactive block, including a private site/team component;
- **component pack**: related components from one publisher or owning team;
- **template**: code-free page/layout tree composed from installed components;
- **plugin**: backend routes, jobs, integrations, storage, or sandboxed capabilities;
- **theme**: tokens and style presets.

A component never becomes the transaction authority for inventory, reservations, orders, payments, refunds, access, or identity. It consumes typed Bun domain APIs or an explicitly reviewed plugin capability.

### Trust tiers

**Official Fuma components** are compiled into the tenant runtime, may use reviewed Server/Client Component boundaries, and carry compatibility, accessibility, performance, and maintenance guarantees.

**Private declarative components and packs** contain canonical trees, approved component IDs, typed props, named slots, loops, conditions, classes, rules, tokens, bindings, responsive behavior, animations, interactions, and templates but no arbitrary executable React/server code. Site owners, teammates, designers, and the existing AI agent may create and use these immediately within owner/site scope. Marketplace review is not a prerequisite for private use.

**Private generated client components** contain owned React/Tailwind source and explicit dependencies/capabilities. Source is drafted and previewed in isolation; only artifacts that pass TypeScript/build/static-Tailwind/accessibility/security/CSP/network/bundle checks and receive owner confirmation become immutable exact versions, executed through the restricted Client Component/sandbox boundary. Private confirmation does not grant server, payment, provider, secret, or unrestricted network authority.

**Reviewed distributable declarative packs** may be listed in the marketplace after namespace, provenance/license, compatibility, accessibility, responsive/visual, integrity, and publisher checks. Review for distribution remains distinct from the owner's ability to use a private version.

**Trusted or privileged coded packs** require hash-bound source and build provenance, exact dependencies, deeper permission and dependency review, signing, compatibility evidence, and either promotion into a trusted runtime build or an approved restricted client sandbox. Arbitrary community React Server Components are never dynamically imported from tenant storage.

Every installed private or distributable component is namespaced, immutable, exact-versioned, TypeBox-validated with `additionalProperties: false`, integrity-bound, permission-declared, bundle-budgeted, and cross-tenant tested. Distribution and privileged promotion add the applicable publisher, provenance/license, signature, scan, and review requirements; those controls do not become a closed design catalog.

Installs pin exact versions. Upgrades show permission, dependency, schema, affected-node, visual, and compatibility differences and create rollback evidence. Uninstall is blocked while page trees, Visual Components, templates, or retained releases reference the pack. Marketplace withdrawal blocks new marketplace installs while owner-private definitions and retained releases remain valid; critical security revocation blocks new publishing and follows an audited fallback/remediation path.

Existing FUMA-067 artifact/install ownership and FUMA-068 review/signing/revocation authority extend to `component-pack`; no second signing or marketplace authority is created. Public projections and pages distinguish components from backend plugins.

## Existing AI integration

Fuma does **not** create a second AI runtime. FUMA-SITE-008 extends the current native site agent, conversation persistence, provider/model routing, image handling, browser tool bridge, and `executeAgentTool` mutation path.

The existing agent continues to edit canonical pages, nodes, Visual Components, props, slots, variants, classes, rules, content, bindings, and tokens. It may originate new private components instead of being limited to catalog selection. It receives authoring and reviewed-catalog tools such as:

```text
site_create_component
site_edit_component
site_create_component_variant
site_preview_component
site_validate_component_source
site_confirm_component_artifact
site_search_components
site_get_component
site_install_component
site_insert_component
site_upgrade_component
site_list_component_usage
```

The model receives descriptions, TypeBox props, slot contracts, examples, data-source requirements, permissions, compatibility, accessibility notes, and installed versions—not secrets. It may generate declarative trees immediately; generated React/Tailwind source stays in isolated draft/preview/build storage until validation, permission disclosure, and owner confirmation bind an immutable restricted-client artifact. Installation, new permissions, executable-artifact confirmation, paid artifacts, provider credentials, privilege promotion, and publishing require their explicit actor confirmation or step-up and secure UI handoff. Ordinary site prompts never deploy arbitrary JSX or acquire server/payment/secret authority.

## Existing MCP integration

Fuma does **not** create a parallel MCP authority. FUMA-SITE-008 extends FUMA-066's existing hashed, expiring, revocable, site-scoped MCP connectors and live bridge with the same owner-bound authoring, validation, catalog, preview, install, insert, and upgrade contracts used by the native agent.

MCP component operations require explicit connector capabilities such as read, create-declarative, create-source-draft, mutate, install, confirm-executable-artifact, or publish, plus exact actor/organization/workspace/site/owner-generation context, rate/credit metering, audit, and the existing explicit publish/step-up boundary. Read-only connectors may inspect but cannot author, install, mutate, confirm, upgrade, or publish. Revocation takes effect mid-session; no token or connector can select another tenant, bypass source validation or owner confirmation, grant itself privileged capabilities, inject arbitrary server code, or expose component/publisher secrets.

## Initial official catalog

The launch catalog should prioritize quality and shared data contracts:

- layout: section, container, stack, grid, columns;
- navigation: navbar, mobile menu, breadcrumbs, pagination, footer;
- marketing: hero, feature grid, testimonials, logo cloud, FAQ, CTA, pricing/comparison;
- content/publication: article header/body, author card, tags, related posts, table of contents, blog feed;
- media: gallery, carousel, video, audio, lightbox;
- forms: contact, newsletter signup, search, upload;
- members: sign-in, account menu, subscription status, gated-content notice;
- commerce foundations: product card/grid/gallery, variants, price, add-to-cart, cart drawer, checkout handoff.

Restaurant menus, church events, course catalogs, and real-estate listings should prefer declarative data-bound packs. Hotel booking and other transactional experiences require a server-owned booking capability in addition to presentation components.

## FUMA-SITE execution order

```text
SITE-001 architecture and hostile gates
  +-> SITE-002 immutable runtime release artifact
  |     -> SITE-003 multi-tenant Next runtime
  |           -> SITE-004 first-party React/Tailwind registry
  |                 -> SITE-005 dynamic state and legacy compatibility
  |                       -> SITE-006 Lawyer source-component pilot
  +-> SITE-007 component-pack SDK and trust model
        -> amended FUMA-067 artifact/install authority
        -> amended FUMA-068 review/signing/revocation
              -> SITE-008 catalog/editor + existing AI/MCP integration
```

FUMA-SITE-006 also depends on FUMA-076 and SITE-007. Deployment, routing, observability, capacity, beta, and launch tasks consume the SITE results through amended dependencies.

## Model routing

The hard renderer, immutable release, tenancy/cache, component registry, marketplace contract, security, plugin compatibility, AI tool-authority, and MCP capability work in FUMA-SITE-001..008 is assigned to **Claude Opus 5**. Public visual marketplace pages may use the designated visual/content model only after Opus-owned contracts and projections are complete. The primary conductor retains central migrations, composition, aggregate validation, tracker closure, and integration.

## Acceptance and non-claims

No SITE task closes from this document. Before React tenant cutover, acceptance requires semantic parity for first-party modules, templates, Visual Components, slots, loops, dynamic bindings, classes/styles, media, CSP, sanitization, page references, member access, plugin compatibility, exact host isolation, release rollback, internal client transitions, accessibility, SEO, and native Linux ARM64 capacity.

The repository now proves canonical tree/editor/release/host seams, immutable runtime trees, one exact-host Next runtime, nonce-safe hydration and client transitions, exact first-party/private component semantics, persistent exact-realm application state, strict optimistic mutation fencing, route shadow/cutover/rollback controls, opaque retained-release compatibility, component-pack policy, and isolated immutable artifact installations. It does not invent cart or booking storage where no Bun domain authority exists: unsupported hosted mutations fail closed until an owning adapter is injected. Lawyer source-component reuse, AI/MCP component authoring tools, production cutover, and launch capacity remain task-owned gates, not assumptions.

# AI backend capability boundary and dashboard

## Decision

AI-generated, imported, tenant-authored, plugin-UI, and exported frontend code must never receive or construct direct database authority. It cannot import a database/ORM client, submit SQL, choose tables or columns, read connection strings, receive database credentials, access environment/provider secrets, open arbitrary internal network connections, or execute tenant-controlled server code beside the database.

Site AI and authorized MCP connectors are orchestrators over reviewed server-owned capabilities. They use the same implementations and cannot mint grants, widen scope, confirm their own protected action, bypass metering, or create a backend merely because generated presentation code expects one.

This is a structural security boundary, not a prompt instruction. Prompt text such as “do not access the database” is insufficient.

## FUMA-086 implementation status

Implemented on 2026-07-31. The first production capability is `site.component-usage.insert@1.0.0`, a bounded mutation available to the Website profile through both `site-ai` and `mcp`. It requires `site.structure.edit` plus the channel grant (`ai.tools.write` or `component.mutate`), accepts at most 64 KiB, emits at most 128 KiB, is limited to 60 requests/minute, carries a ten-second abort signal, and does not require owner confirmation because inserting a non-protected declarative component is not an executable, credential, payment, or publication effect.

The existing native `site_insert_component` tool is the sole integration point. Site AI and MCP already share that TypeBox tool registry; the tool delegates insertion to one `PostgresAiBackendCapabilityRuntime`, one reviewed registry definition, and the existing `ComponentCatalogService`. No parallel AI runtime, MCP runtime, repository, identity flow, UI package, app import, or generic database proxy was added.

Production authority is resolved only from a current started outer operation:

- Site AI: conversation binding, running turn job, mutating `fuma_site_ai_tool_receipts` row, actor/session, credit reservation, exact input hash, and current active owner generation.
- MCP: connector binding, active session, started `fuma_mcp_tool_receipts_v2` row, `component.mutate`, actor/session, credit reservation, exact input hash, and current active owner generation.

Caller input cannot contain tenant coordinates, authority flags, SQL, connection data, filters, or credentials. Strict validation and the 64 KiB bound run before a transaction is opened. Inside PostgreSQL, a per-capability/site/actor advisory transaction lock serializes admission. The immutable component audit `operation_id` prevents duplicate domain execution for a shared outer receipt, current owner state/revocation is rechecked, the existing component service persists the usage and immutable audit, and the existing metering collector records an idempotent canonical AI usage event. Returned receipts contain only the reviewed capability/version/channel, operation and outer-receipt identity, deterministic input/output hashes, timestamp, and metered/audited flags; tenant scope, owner key/generation, session, reservation, credentials, and internal authority are omitted.

### Persistence and concurrency acceptance

`aiBackendCapabilityPostgresAcceptance.test.ts` runs only when `FUMA_TEST_POSTGRES_URL` is set and uses a disposable `fuma_backend_capability_%` schema on native PostgreSQL. It applies only the prerequisite authority migrations `000068`, `000069`, and `000075`, seeds current owner authority, and proves:

- eight Site AI receipt contenders converge to one claim and seven in-flight outcomes;
- changed input cannot reuse the Site AI outer receipt;
- eight concurrent MCP capability executions over one valid outer receipt converge under the reviewed boundary to one mutation and seven immutable-operation denials;
- Site AI and MCP invoke the same reviewed capability and persist exactly two usage records, two successful insertion audit records, two minimized terminal outer outputs, and two metering calls;
- hostile SQL/scope-shaped input is rejected before transaction/query contact;
- current owner transfer/revocation denies before domain mutation;
- component usage and audit update/delete protection remains enforced;
- the disposable schema is dropped in `finally`, with a zero-leftover assertion.

No FUMA-086 migration is needed: durable outer receipts come from the Site AI/MCP authorities, mutation/audit persistence comes from component-catalog migration `000075`, and metering uses the canonical ledger. Hosted migration serialization therefore remains 77 runnable migrations ending at `000077_public_handoff_authority`, 78 indexed entries ending at the all-zero-checksum `000078_next_source_portability_authority` sentinel, with `000079_public_marketing_analytics` isolated and unindexed.

Browser acceptance is not applicable to this backend/security-boundary ticket: it adds no route, page, component, or visual interaction. The contract demo is the focused Site AI/MCP PostgreSQL acceptance above. Any future dashboard/browser work belongs to FUMA-087 and must use the Blyss HTTPS host policy.

### Primary tracker reconciliation

Do not edit the shared tracker from a ticket worktree. The primary conductor can replace the FUMA-086 open line with:

> **FUMA-086 — Closed (2026-07-31).** Direct database/SQL/ORM/credential/secret/generated-server/internal-network authority is structurally denied for AI-generated, imported, tenant, plugin-UI, and exported frontend source. `site.component-usage.insert@1.0.0` is the first strict-TypeBox reviewed capability, shared by the existing Site AI and MCP tool registry with server-derived actor/tenant/profile/owner-generation/reservation/exact-receipt authority, bounded input/output, advisory-lock and immutable-operation idempotency, current revocation checks, canonical metering/audit, and minimized receipts. Focused adversarial/architecture tests and native PostgreSQL persistence/concurrency acceptance pass; no migration or browser surface was required, and protected `77/78/79` migration ordering is unchanged.

## Required call path

```text
AI-built/imported frontend
  -> versioned public adapter or existing Site AI/MCP tool
  -> strict TypeBox input validation
  -> server-derived actor + organization + workspace + site + profile
  -> owner-generation/capability/grant/revocation/rate checks
  -> reviewed domain service/repository
  -> bounded transaction and idempotency key
  -> minimized strict TypeBox output
  -> immutable receipt + audit + metering
```

The frontend may supply business inputs defined by a capability schema. It never supplies tenant scope, SQL, table/column names, credentials, internal authority flags, metering acceptance, owner generation, impersonation status, or audit outcome.

## Capability contract

Every AI-visible backend function must declare and enforce:

- stable ID and exact version;
- strict TypeBox input and output schemas with `additionalProperties: false`;
- allowed Website/Publication profiles and explicit site grants;
- required staff/member permission and data classification;
- read/mutate/confirm capability class;
- server-derived tenant and owner-generation scope;
- bounded pagination, filtering, payload size, execution time, and result cardinality;
- deterministic idempotency/replay semantics for mutations;
- rate, quota, and metering policy;
- immutable audit/operation receipt fields;
- owner-confirmation requirements for executable, credential, payment, publication, or other protected effects;
- revocation, deprecation, compatibility, health, and rollback behavior;
- replaceable standalone-export adapter mapping;
- explicit unavailable/blocked behavior when no reviewed authority exists.

A capability must not be a generic query proxy, arbitrary RPC tunnel, raw repository wrapper, unrestricted webhook, database console, dynamic code executor, or caller-selected provider request.

## Security acceptance

Architecture and adversarial tests must prove denial before database or provider contact for:

- SQL/ORM/database imports and connection strings;
- environment, filesystem, process, secret, and provider SDK access;
- arbitrary Server Actions, route handlers, middleware, or generated server modules;
- caller-supplied tenant IDs that differ from immutable request authority;
- cross-tenant object IDs and confused-deputy requests;
- prompt/repository/README instructions attempting to widen capability;
- revoked, stale, wrong-profile, wrong-generation, impersonated, ambiguous, or unmetered operations;
- replay with changed inputs, diagnostic IDs, patch hashes, or confirmation ancestry;
- unbounded filters, pagination, fan-out, exports, error bodies, or timing-sensitive existence leakage;
- credential, PII, internal ID, stack, SQL, and provider-error leakage in outputs.

Database access remains inside reviewed repositories/domain services. Existing PostgreSQL row predicates, append-only evidence, Better Auth authority, member realm separation, audit, metering, tenant object storage, Site AI receipts, and MCP operation receipts remain canonical.

## Capability coverage direction

The initial reusable capability inventory targets AI-built frontends for:

- Publication and blogging: posts, pages, authors, tags, collections, SEO/social/canonical metadata, redirects, navigation, search, pagination, members, newsletters, subscriptions/access, podcasts/audio feeds, and media;
- Website, agency, and landing pages: services, team profiles, portfolios/showcases, case studies, testimonials, reusable sections, forms, lead/contact capture, media, and privacy-preserving conversion events;
- shared operations: publication/release status, immutable publish requests, bounded content/media reads, forms, and reviewed email/access workflows.

The existing universal content model, Publication/Ghost importer, editor, publisher, media, forms, member/access, email, AI/MCP, and plugin authorities are reused. Missing mappings are platform gaps and remain blocked; they do not justify direct database access or a generated shadow backend.

Ecommerce catalogs, carts, orders, inventory, checkout, and a commerce profile are deferred. Paystack remains unchanged. Existing reviewed subscription/payment setup can be referenced only through its current owner-confirmed authority.

## Protected dashboard (FUMA-087, implemented)

The implemented dashboard is a control and evidence surface over the capability registry, not a database browser or second AI runtime. Its production and acceptance contract is recorded in `docs/reference/fuma-ai-backend-capability-dashboard.md`.

### Customer site view

Reached through the existing organization/workspace/site selection and onboarding shell, it shows:

- capabilities available to the selected site/profile;
- schema/version and human-readable purpose;
- enabled, unavailable, deprecated, revoked, or degraded state;
- Site AI, MCP, imported-source, runtime, and export-adapter availability;
- required permission and confirmation class;
- current grants, rate/spend limits, recent usage, and blocked reasons;
- recent redacted receipts and audit links;
- safe grant/revoke controls where existing permissions allow them.

### Protected platform view

Composed into the existing FUMA-071 platform console, it adds:

- registry health and version adoption;
- tenant-safe aggregate usage/failure/metering views;
- schema drift, deprecation, revocation, and incident controls;
- unresolved frontend interaction and adapter-coverage gaps;
- no raw SQL, arbitrary execution, credentials, provider secrets, unrestricted logs, or cross-tenant payloads.

Support impersonation cannot grant protected capability authority. Break-glass/support actions retain FUMA-072 separation, approval, reason, expiry, audit, and customer-visible safeguards.

## Existing onboarding and identity

No parallel onboarding or identity flow is permitted. Capability defaults come from existing profile composition and starter onboarding. Every dashboard route and mutation reuses Better Auth staff sessions, separate member identity where applicable, immutable Fuma request scope, organization/workspace/site permissions, and current owner generation.

## Export behavior

Standalone Next.js exports receive typed, replaceable adapter interfaces and documentation, never hosted database credentials or private Fuma imports. Hosted adapters call documented bounded capability endpoints. Owners may replace those adapters in another backend after export without reconstructing presentation code. Secret, session, member-password, database, internal-service, GitHub, payment, and provider credentials are never exported.

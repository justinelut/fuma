# FUMA-088 provider-neutral backend capability contract

## Decision

AI-built, imported, hosted-runtime, MCP, and standalone-export frontends use reviewed versioned capabilities. They do not receive SQL, table/column selection, arbitrary predicates, tenant coordinates, credentials, provider SDKs, direct repositories, generated server code, or unrestricted network authority. FUMA-088 extends the FUMA-086 registry by composing strict TypeBox definitions over existing Publication authorities; it creates no storage, migration, backend generator, application import, or payment path.

Every active definition is `1.0.0`, is available through the same reviewed implementation to `site-ai`, `mcp`, `imported-runtime`, and `export-adapter`, and declares exact permission/grant, data classification, bounds, timeout, metering, audit receipt, confirmation, and replacement adapter metadata. Caller input is validated before trusted authority resolution. Scope is always reconstructed from the current outer receipt's platform/organization/workspace/site/owner-generation/profile authority.

## Coverage matrix

| Function family | Capability | State | Canonical authority / blocking diagnostic |
|---|---|---:|---|
| Publishing/blog/content list | `publication.content.list@1.0.0` | Active | `PublicationDomainStore` |
| Publishing/blog/content read | `publication.content.get@1.0.0` | Active | `PublicationDomainStore` |
| Draft + SEO/social/canonical/redirects | `publication.content.save-draft@1.0.0` | Active | `PublicationEditorialService`; bounded text document projection |
| Publish/schedule | `publication.content.request-publication@1.0.0` | Active, owner-confirmed | `PublicationEditorialService` workflow transition |
| Authors/tags | `publication.taxonomy.list@1.0.0` | Active | `PublicationDomainStore`; author email omitted |
| Publication identity | `publication.settings.get@1.0.0` | Active | `PublicationIdentityService` |
| Newsletter inventory | `publication.newsletter.list@1.0.0` | Active | `PublicationDomainStore`; no recipient/provider data |
| Member/subscription access | `publication.access.evaluate@1.0.0` | Active | `PublicationMemberAccessService`; member subject derived from server actor |
| Privacy conversion report | `publication.analytics.report@1.0.0` | Active | `PublicationPrivacyAnalyticsService`; aggregate totals only |
| Media inventory/upload | — | Blocked | `CAPABILITY_AUTHORITY_UNSCOPED`: existing media repository has no reviewed hosted owner-generation adapter |
| Member registration/session | — | Blocked | `CAPABILITY_CHANNEL_FORBIDDEN`: passwords and sessions cannot transit Site AI/MCP |
| Newsletter subscribe/unsubscribe | — | Blocked | `CAPABILITY_SUBJECT_AUTHORITY_REQUIRED`: requires current member or one-click provenance |
| Paid subscription initialization | — | Blocked | `CAPABILITY_OWNER_MEMBER_CONFIRMATION_REQUIRED`: existing payer authority remains canonical; Paystack unchanged |
| Podcast/audio feed | — | Blocked | `CAPABILITY_AUTHORITY_MISSING`: no reviewed podcast feed authority |
| Forms and lead capture | — | Blocked | `CAPABILITY_BROWSER_CHALLENGE_REQUIRED`: canonical origin/challenge/honeypot/rate flow cannot be bypassed |
| Navigation | — | Blocked | `CAPABILITY_AUTHORITY_MISSING`: editor snapshots are not durable owner-generation authority |
| Search | — | Blocked | `CAPABILITY_AUTHORITY_UNSCOPED`: existing cross-table search is not a hosted scoped adapter |
| Agency portfolio/team/services/testimonials/case study | — | Blocked | `CAPABILITY_AUTHORITY_UNSCOPED`: universal rows exist, but a generic hosted collection adapter is not reviewed |
| Landing sections/conversion mutation | — | Blocked | `CAPABILITY_CHANNEL_FORBIDDEN`: editor mutation and visitor consent context cannot be forged by AI |
| Ecommerce/catalog/cart/order/inventory/checkout | — | Deferred | `CAPABILITY_DEFERRED_ECOMMERCE`; no commerce profile and no Paystack change |

A blocker is a contract result, not permission to fall back to direct database access. Unblocking a row requires a separately reviewed canonical owner-generation authority and focused tests.

## Adapter contract

`ProviderNeutralPublicationAuthority` is the hosted adapter consumed by registry definitions. `CanonicalProviderNeutralPublicationAdapter` delegates to the already-composed Publication store/services and owns no repository. `ProviderNeutralPublicationExportAdapter` is the standalone replacement seam: it has one typed method per capability, including a separate confirmation token argument for protected publication. Exported presentation code can replace this interface with another backend without importing private Fuma modules or receiving hosted credentials.

The content projection deliberately excludes arbitrary visual documents. It accepts only `{ format: "plain-text" | "markdown" | "html", value }` with a 256 KiB bound. Existing nonmatching canonical documents are reported with `body: null`; they are never executed, stringified into prompts, or widened with `Unknown`. Publication author email, member/account IDs, tenant scope, sessions, owner keys, provider errors, and internal evidence are omitted from outputs.

## Site AI and MCP parity

Both channels resolve the same capability ID/version in `ReviewedBackendCapabilityRegistry`; only the trusted outer authority differs. The registry applies the same schema, permission, profile, grant, owner-generation, impersonation, confirmation, size, timeout, receipt, audit, and metering checks. FUMA-088 does not add a second AI or MCP runtime. The focused parity fixture invokes `publication.content.list@1.0.0` once through each channel and requires byte-equivalent business output plus distinct minimized receipts.

## Acceptance

Focused acceptance consists of:

- strict-schema registration for all nine active definitions;
- Site AI/MCP parity and minimized output/receipt assertions;
- canonical draft/SEO adapter delegation and owner-confirmed publication transition;
- adversarial rejection of SQL, tables, scope, connection strings, arbitrary predicates, and caller-selected member identity before authority contact;
- deterministic blockers for every non-reviewed requested family;
- an optional native ARM64 PostgreSQL demo that uses the existing owner-generation-scoped `PostgresPublicationDomainStore`, creates only its disposable prerequisite fixture tables, returns a bounded empty content page, proves no capability table was created, and removes the schema;
- architecture gates proving no direct DB/ORM/provider/app/UI dependency and unchanged 77 runnable / 78 indexed / isolated 79 migration serialization.

No browser surface is added, so browser/Playwright acceptance is not applicable. Any future UI belongs to FUMA-087 and must use the Blyss HTTPS host policy.

## Executed acceptance — 2026-07-31

- Focused strict-contract, all-active-adapter, Site AI/MCP parity, metadata preservation, confirmation, adversarial, coverage-matrix, export-seam, migration-order, and architecture acceptance: **10 passed, 0 failed, 142 assertions**.
- Native Linux ARM64 PostgreSQL acceptance: **1 passed, 0 failed, 6 assertions**. The deterministic transcript reported `capability=publication.content.list rows=0 canonical_tables=4 new_tables=0`; the test and an independent follow-up query both reported zero leftover `fuma_provider_neutral_088_%` schemas.
- Strict TypeScript over the three FUMA-088 production modules, scoped ESLint over all implementation/test files, and scoped `git diff --check`: passed with no findings. The shared Studio node typecheck currently remains blocked only by concurrent FUMA-074/FUMA-077/FUMA-087 files; it reports no FUMA-088 diagnostic.
- No browser surface was added, so no browser, routing, hydration, proxy, or TLS acceptance is claimed. No migration, SQLite, Docker, QEMU, provider call, Paystack change, commit, reset, clean, amend, push, or shared tracker edit occurred.

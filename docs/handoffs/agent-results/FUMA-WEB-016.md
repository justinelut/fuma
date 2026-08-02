# FUMA-WEB-016 acceptance handoff

## Disposition

**KEEP OPEN.** The isolated repository implementation is complete and independently revalidated, including native PostgreSQL contention and cleanup. Production persistence and central mounting remain deliberately unavailable until protected migration `000078_next_source_portability_authority` is accepted and finalized, after which additive candidate `000079_public_marketing_analytics` may be registered and applied in source order. Neither migration was modified, registered, finalized, or applied by this acceptance pass.

## Verified implementation

- First-party cookieless `page_view` collection with only closed route/campaign classes, UTC time, and consent state; no visitor identity, cookies, durable browser storage, path, URL, query, referrer, IP, user agent, tenant, member, staff, payment, or provider field.
- Optional `cta_selected` and `handoff_started` requests only after the current host-local `sessionStorage` preference explicitly authorizes them; absent, malformed, obsolete, essential-only, withdrawn, GPC, and DNT states fail closed.
- Bot and internal traffic suppression at the public boundary and central collector.
- Exact private Web-service authority with no forwarded browser cookie, authorization, IP, user agent, or arbitrary headers.
- SHA-256-only opaque funnel joins across handoff, signup, site, publish, and paid stages; exact event idempotency, reordered-arrival tolerance, and authoritative chronology enforcement.
- Thirty-day raw/hash retention, 400-day aggregate retention, empty strict retention payload, and server-owned clock/cutoffs.
- Aggregate-only TypeBox report contracts, bounded same-origin HTTP client, and accessible aggregate dashboard.
- Strict runtime gate: `createHostedPublicMarketingAnalyticsRuntime` returns unavailable without exact sentinel `000079_public_marketing_analytics:applied`; there is no process-memory production fallback.

## Primary validation — 2026-08-01

- Studio service, private boundary, strict contracts, dashboard, migration isolation, and architecture: **16 tests / 109 assertions**, all passed.
- Public Web consent/storage/CSP/minimized-forwarding contracts: **2 tests / 13 assertions**, all passed.
- Native PostgreSQL disposable-schema acceptance: **1 test / 6 assertions**, passed. Eight concurrent handoff writes converged to one event plus seven replays; the reordered five-stage hash-only funnel reported `1/1/1/1/1`; retention deleted `5/5`; the schema cleanup assertion passed.
- Combined focused result: **19 tests / 128 assertions**, zero failures.
- Web `next typegen && tsc --noEmit`: passed.
- Scoped Studio and Web ESLint: passed with zero warnings/errors.
- Read-only serialization checks preserve **78 manifests / 77 runnable**, `000077_public_handoff_authority` as the last runnable migration, `000078_next_source_portability_authority` as the sole indexed sentinel, and `000079_public_marketing_analytics` isolated/unindexed.
- `git diff --check`: passed.

No browser, provider, deployment, DNS/TLS, production secret, production migration, protected approval, commit, push, reset, clean, or launch evidence is claimed.

## Remaining closure blocker

After `000078` is genuinely accepted, the exclusive migration/composition integrator must register/finalize/apply `000079`, provide the exact applied-schema sentinel and private Web service credential, mount the collector and authenticated report/dashboard, inject the minimized post-commit stage sink into the existing signup/site/publish/verified-paid authorities, and durably schedule retention. Until then FUMA-WEB-016 and its dependents remain open; tests and an isolated candidate migration are not production persistence evidence.

# FUMA-087 protected AI backend-capability dashboard

## Decision

FUMA-087 is a protected control-and-evidence projection over the reviewed FUMA-086 registry and its canonical Site AI, MCP, component-audit, and metering receipts. It adds no capability execution path, database console, generic query surface, identity realm, onboarding flow, credential store, AI/MCP runtime, shared UI package, app-to-app import, or migration.

The customer surface is reached at the selected site’s existing `/admin/settings/capabilities` route inside the organization/workspace/site shell. The protected inventory is reached through the existing internal console composition at `/internal/ai-capabilities`. Both HTTP APIs remain under the canonical scoped Fuma boundary, derive tenant, actor, profile, owner key, and owner generation server-side, reject caller authority fields at the shared middleware, and return private no-store strict-TypeBox envelopes.

## Customer projection

The selected site sees exact capability ID/version/purpose, required permission and confirmation class, input/output/rate/result/timeout limits, channel availability, current Site AI and redacted MCP grants, registry/deprecation/health state, canonical AI-credit usage and spend, recent minimized receipts with audit/metering status, and explicit imported-runtime/export-adapter gaps. Receipt projections never return prompts, tool inputs/outputs, hashes other than the reviewed receipt identity, connector tokens, session/reservation/owner keys, tenant coordinates, credentials, SQL, provider errors, or stored payloads.

MCP revocation is the only ticket-local mutation. It requires the existing `ai.providers.manage` permission, a direct non-impersonated current staff session, the exact active owner generation, and connector ownership by the current actor. The dashboard delegates to `McpService.revoke`; it does not write MCP tables. Creating/granting connectors remains in the existing MCP settings workflow because returning a bearer token from this evidence surface would turn it into a credential workflow. Site AI grants remain permission-derived and cannot be minted by the dashboard.

## Protected inventory

The platform projection reuses FUMA-072’s protected internal route authorization, then independently requires a direct non-impersonated staff actor. It reports registry health, current-version adoption, drifted receipt counts, tenant-safe aggregate success/failure/audit/metering/credit/spend totals, active/revoked MCP grant counts, recent metadata-only evidence, and unresolved channel/adapter gaps. It never returns tenant IDs or cross-tenant payloads.

Deprecation, bulk revocation, and incident controls are shown fail-closed. Registry deprecation requires a reviewed release; per-tenant revocation remains in the exact owner workflow; incidents remain in FUMA-072 support/break-glass authority. The dashboard does not create a mutable shadow registry or allow support impersonation to inherit protected authority.

## Pagination and health

`limit` is strict and bounded to 1–50. Cursors are opaque base64url offsets bound to a maximum of 10,000; malformed, negative, or out-of-range cursors fail closed. Read queries select only known receipt sources and use bounded `limit + 1` windows. Health is degraded when canonical attempts fail, successful receipts lack immutable component audit or metering evidence, or stored receipt envelopes drift from the strict FUMA-086 receipt contract.

## Protected route reference

All routes are mounted once under `/api/fuma/organizations/:organizationId/workspaces/:workspaceId/sites/:siteId` by the existing hosted scoped API:

| Method | Relative path | Authority | Result |
|---|---|---|---|
| `GET` | `/ai/backend-capabilities?limit=1..50&cursor=…` | direct current staff, active exact site, `site.read` | selected-site inventory, grants, limits, usage, health, minimized receipts, gaps |
| `POST` | `/ai/backend-capabilities/revocations` | direct current staff, active exact site, `ai.providers.manage` | exact actor-owned MCP connector revocation result |
| `GET` | `/internal/ai-capabilities?limit=1..50&cursor=…` | FUMA-072 protected-route overlay plus direct non-impersonated staff | tenant-safe registry/adoption/aggregate/evidence/gap inventory |

The shared middleware rejects caller authority headers. The service independently checks that the staff-session source and actor identities match, the request context and repository coordinates match, the profile matches the selected site, the owner scope is active, and no impersonator is present. All responses are strict TypeBox envelopes with `Cache-Control: private, no-store`.

The customer receipt shape contains only receipt identity, reviewed capability/version/channel, operation identity, outcome, audit identity/status, metering status, and occurrence time. The protected aggregate omits organization, workspace, site, owner, actor, session, connector, reservation, prompt, input/output, hash, credential, SQL, and provider-error fields. Spend and credit totals join only exact strict receipt identities to canonical `ai_credits` ledger entries; self-described receipt flags are not trusted as metering evidence.

## Operator behavior

- **Grant:** unavailable here. Site AI remains permission-derived and MCP credentials remain in the existing MCP settings workflow.
- **Revoke:** an eligible customer control delegates to `McpService.revoke`, which fences connector version, closes sessions, and appends canonical MCP audit evidence.
- **Deprecate:** displayed as blocked until a reviewed registry release changes the exact capability version.
- **Bulk revoke:** displayed as blocked; per-owner revocation remains tenant-scoped.
- **Incident/break glass:** displayed as blocked into FUMA-072’s separately approved, reasoned, expiring, audited workflow.
- **Unsupported interaction:** displayed as an explicit blocked imported-runtime or export-adapter gap; no generated server or database fallback is attempted.

## Persistence and migration invariants

FUMA-087 creates no tables and no migration. Hosted migration serialization remains 78 manifest entries / 77 runnable, `000077_public_handoff_authority` last runnable, `000078_next_source_portability_authority` the all-zero sentinel, and `000079_public_marketing_analytics` isolated and unindexed. PostgreSQL is the only supported database.

## Browser acceptance

Focused customer and protected-inventory browser acceptance must run through `https://5174.blyss.co.ke`, cover wide and 320 px layouts, keyboard-visible controls, loading/error/empty/degraded/revoked states, exact same-origin scoped requests, authority-field omission, and zero page/console errors. Loopback requests are process-liveness diagnostics only.

## Proposed tracker closure text

> **FUMA-087 — Closed (2026-07-31).** The existing organization/workspace/site shell now exposes a protected AI backend-capability customer view, and the FUMA-071 console composition includes a protected tenant-safe inventory. Both consume FUMA-086 metadata and canonical PostgreSQL receipts to show exact versions, grants/revocations, bounded limits/spend, health/deprecation, minimized audit/metering evidence, and explicit unavailable adapter gaps. MCP revocation delegates to the canonical MCP service; grant creation, registry deprecation, bulk revocation, and incidents fail closed into their existing credential/release/owner/FUMA-072 authorities. Strict TypeBox, server-derived current owner/actor scope, support-impersonation denial, secret minimization, bounded pagination, accessibility/responsive browser acceptance through the Blyss HTTPS Studio host, and unchanged `77/78/79` migration serialization are verified.

# Fuma scoped and metered MCP (FUMA-066)

Status: **Closed — FUMA-066 (2026-07-29).** Canonical persistence, native-runtime extension, real hosted startup activation, scoped UI, live PostgreSQL, and aggregate validation are complete.

FUMA-066 extends the existing `apps/studio/server/ai/mcp` server, Streamable HTTP transport, native `AiTool` registry, `executeAiTool` dispatcher, live editor bridge, and explicit `site_publish` tool. It does not add a second MCP server, SDK instance, tool catalog, browser dispatcher, provider runtime, or publishing implementation. The hosted authority lives in `server/fuma/mcp`; `server/ai/mcp/authority.ts` is only the optional native integration interface. Legacy/self-host MCP requests omit it and retain their current behavior.

## Connector and session authority

A hosted connector binds one staff actor to exact platform, organization, workspace, site, owner key, owner generation, and Website/Publication profile ancestry. Its secret is 32 cryptographically random bytes, shown once, and persisted only through the existing `ai_mcp_connectors.token_hash` SHA-256 hash. The site binding contains no second token column. Expiry, revocation, transfer state, version, explicit connector capabilities, delegated native tool capabilities, and read/mutate/publish rates are strict TypeBox values with `additionalProperties: false`.

Each HTTP request resolves the bearer hash through the hosted repository and opens or refreshes a bounded session. Tool listing, tool dispatch, live-browser dispatch, result commit, and publish callback revalidate the connector, session, actor, exact scope, owner generation, expiry, state, version, and live site authority. A closed, expired, revoked, transferred, wrong-site, or foreign session fails closed. Live editor bridges are keyed by `(actor, site, workspace kind)` rather than actor alone, so two concurrent sites cannot replace or receive each other's bridge.

## Capability surface

FUMA-066 executes three explicit grants: `site.read`, `site.mutate`, and `site.publish`. Native `CoreCapability` filtering remains in place as a second, narrower tool gate. `site_publish` also requires a per-operation confirmation plus step-up receipt verified by a trusted port; the connector grant itself is never sufficient.

The same connector capability enum reserves the exact extension points required by FUMA-SITE-008: `component.read`, `component.create-source`, `component.install`, `component.mutate`, `component.confirm`, and `component.publish`. FUMA-066 registers no component tools. SITE-008 must extend the existing native registry and this authority rather than create another MCP runtime.

## Rates, credits, receipts, and audit

Read, mutate, and publish each have a request-per-minute limit and maximum input/output token reservation. PostgreSQL admission uses one atomic upsert fence. Every tool request derives a stable operation identity from the JSON-RPC ID or explicit `Idempotency-Key`; the durable receipt binds session, connector, tool, capability, canonical input SHA-256, and FUMA-064 reservation ID. Identical terminal retries replay the canonical native `AiToolOutput`; changed evidence conflicts and in-flight duplicates fail.

`createMcpCreditAuthority` calls the finalized FUMA-064 `AiCreditService`: it locates the exact account/model/mode, reserves before native dispatch, settles actual bounded input/output use only after a successful revalidated result, and releases on tool error, bridge closure, abort, or revocation. Audit facts are durable and contain only scoped IDs, outcomes, reason codes, and timestamps—never plaintext tokens, token hashes, tool inputs/results, prompts, credentials, or provider secrets.

## Publish and transfer

Hosted publishing is a callback on the existing `site_publish` tool. The conductor binds that callback to the exact-site native publisher. The authority verifies `site.publish`, current session/live authority, confirmation ID, step-up receipt, and confirmation timestamp before dispatch, then revalidates again in the publish callback and before result settlement.

Transfer step `mcp-connector-rescope-revoke` is ordered at 617, after AI BYOK (615) and before reserved domain outcome order 620. An explicit choice either re-scopes the connector to a different owner key with a higher generation or revokes it. Both choices revoke every active session immediately. Apply, verify, replay, and compensation are saga-fenced; compensation restores the exact source connector while old sessions remain closed and require fresh authentication.

## Finalized persistence and composition

Canonical additive migration `000069_mcp_connector_authority` is registered with immutable checksum `4b92c690302ae47184663870b86a7d4179b89eeac097307b9e5589b82cea819d`. It creates the connector bindings, sessions, replay receipts, usage windows, append-only audit facts, and transfer choices. Because exact owner generation participates in the MCP foreign key, the migration first adds the missing generation-qualified unique owner-key authority; native PostgreSQL acceptance validates that constraint and the audit update/delete trigger.

`createHostedMcpRuntime` composes one `PostgresMcpRepository`, `McpService`, FUMA-064 credit adapter/account locator, current owner/site/actor live authority, scoped route declarations, exact HTTPS product-host `McpNativeHttpAuthority`, required existing-publisher callback, and order-617 transfer step. `createHostedMcpProductionRuntime` now constructs that graph in `server/index.ts` over the real PostgreSQL AI catalog/credit service, an independent non-extractable BYOK metadata key, operation-bound fresh-staff HMAC confirmation authority, and the publication runtime's existing durable `fuma.publish-release` queue. Startup passes its routes to `createHostedFumaScopedApi` and its native authority to the existing `server/router.ts` `/_instatic/mcp` handler; no second server, SDK, AI driver, queue, or publisher exists.

The Tailwind-free `McpScopedConnectorPanel` is mounted in the exact-site hosted settings surface. Its app-local client calls `/api/fuma/organizations/:organization/workspaces/:workspace/sites/:site/ai/mcp/connectors`, validates every response with TypeBox, and displays the plaintext token once. Self-hosted legacy connector behavior remains separate and unchanged.

## Focused acceptance

- `mcp.behavior.test.ts`: exact sessions, rate limits, FUMA-064 lifecycle, replay, failure release, publish step-up.
- `mcp.security.test.ts`: wrong site, foreign sessions, revocation, owner/live authority changes, secret absence.
- `mcp.fault.test.ts`: persistence failure and concurrent atomic admission.
- `mcp.integration.test.ts`: existing Streamable HTTP/native tool/live bridge with exact-site routing and mid-turn revoke.
- `mcp.transfer.test.ts`: rescope/revoke saga replay and compensation.
- `mcp.demo.test.ts`: connect two sites, revoke one token, publish only through the permitted connector.
- `mcpPostgresAcceptance.test.ts`: optional native PostgreSQL schema/repository acceptance when `FUMA_TEST_POSTGRES_URL` is set.
- `architecture/fuma-mcp-runtime.test.ts`: one runtime, TypeBox, canonical `000069`, exact-host production composition, SITE-008 capability seam, and Tailwind-free scoped Studio UI.

Integrated focused acceptance passed **22 tests, 1 expected optional PostgreSQL skip, 0 failures, and 116 assertions**. Native PostgreSQL 16.14 acceptance then passed **1 test, 0 failures, and 5 assertions** and verified zero leftover `fuma_mcp_%` schemas. No provider, external, protected publication, deployment, or production call occurred.

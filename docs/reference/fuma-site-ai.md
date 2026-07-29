# Fuma scoped site AI (FUMA-065)

FUMA-065 adds a hosted scope authority around the existing native AI implementation in `apps/studio/server/ai`. It does not add a chat runner, message/history store, provider driver, provider transport, browser bridge, MCP authority, or credential authority. `server/ai/conversations/store.ts` remains the sole conversation-content authority; `server/fuma/siteAi` stores only bindings to native conversation IDs, snapshot hashes, turn jobs, tool retry receipts, and secret-free audit facts.

## Trusted ancestry

A site-AI authority binds the effective actor and staff session, editor session, platform, organization, workspace, site, owner key, owner generation, Website/Publication profile, and composed capability set. `createSiteAiAuthoritySnapshot` accepts only an immutable server-derived `FumaRequestContext` plus an active `EditorSiteSessionIdentity`; every repeated coordinate and profile must match. Request bodies, tenant headers, snapshots, model output, and tool input cannot create authority.

Conversation bindings are actor/session/editor-session specific. Snapshot bindings carry only a SHA-256 digest and monotonic sequence; raw page context remains in the native per-turn browser snapshot and is never copied into this metadata authority. A turn job binds the conversation, snapshot, actor, full owner ancestry, authority revision, provider/model, capability, credit reservation, attempt, usage, and terminal state.

The live authority port is consulted at provider admission, every native persistence write, tool dispatch, browser-tool result, and usage settlement. A revoked actor, removed capability, changed profile, transferred owner key/generation, archived scope, or mismatched job fails closed. Terminal cleanup does not require still-live actor authority, allowing a revoked turn to release its reservation and record a failed job.

## Native runtime extension

The existing provider-agnostic runtime exposes one optional `AiRuntimeExecutionAuthority` hook:

- `runner.ts` revalidates before the existing driver, records terminal usage, and closes/releases the job;
- `execTool.ts` revalidates and claims a receipt before server or browser dispatch, then records the canonical result;
- `toolLoop.ts` supplies the provider tool-call ID as the idempotency identity;
- `persister.ts` revalidates before assistant/tool/usage writes;
- the existing chat handler passes the same optional authority into its existing persister.

Legacy/self-hosted turns omit the hook and retain their prior behavior. `bindNativeSiteAiTurn` attaches the hosted guard to the existing `AiStreamRequest`; it does not wrap or replace the runner.

A completed tool call with the same `(jobId, toolCallId, toolName, inputHash, mutates)` replays its stored canonical output without executing the tool again. Changed retry evidence conflicts, and an already-started call fails as in-flight. This prevents provider retries from duplicating editor mutations. Tool inputs/results are not copied into audit or logs; audit facts contain only scoped IDs, outcomes, reason codes, and timestamps.

## Catalog, credits, jobs, and audit

`createSiteAiCatalogAuthority` admits only a fresh enabled FUMA-063 catalog provider/model for the exact customer ancestry/profile. `createSiteAiCreditAuthority` maps each job to a stable FUMA-064 reservation, settles actual native prompt/completion tokens, and releases on abort/error. The adapter accepts opaque account/BYOK selectors only from its trusted account locator and never projects credential material.

Turn jobs and tool receipts are durable repository contracts. Audit actions cover conversation/snapshot binding, turn start/success/failure/denial, and tool start/completion/failure. Facts are strictly TypeBox-validated and contain no prompt, message, snapshot payload, provider key, native credential reference, BYOK envelope, or secret metadata.

## Persistence authority

Hosted migration `000068_site_ai_scope_authority` is additive, centrally registered, and checksum-finalized as `0c0368622abc603c03cd46e2c37107c2efc61c38f1bb3335539efcffa1e77bd5`. It adds:

- `fuma_site_ai_conversation_bindings` (FK to native `ai_conversations`);
- `fuma_site_ai_snapshot_bindings`;
- `fuma_site_ai_turn_jobs`;
- `fuma_site_ai_tool_receipts`;
- `fuma_site_ai_audit_facts`.

It does not alter `ai_conversations`/`ai_messages` or store message content. `PostgresSiteAiRepository` is the hosted metadata authority; the native conversation/message tables remain authoritative for content.

## Adversarial and demo evidence

Focused tests inject foreign organization/workspace/site/owner/generation/profile/actor/session/editor-session/conversation/snapshot IDs, revoke access and write capability after provider admission, inject repository faults, race two site turns, and retry a completed write tool. The deterministic demo edits Site B while Site A is revoked mid-turn; Site A receives zero writes, Site B receives one write, and retrying Site B's tool does not execute a second mutation. No external provider, browser, deployment, or production operation is used.

Focused validation:

```sh
bun test apps/studio/src/__tests__/fuma/siteAi.unit.test.ts \
  apps/studio/src/__tests__/fuma/siteAi.security.test.ts \
  apps/studio/src/__tests__/fuma/siteAi.fault.test.ts \
  apps/studio/src/__tests__/fuma/siteAi.integration.test.ts \
  apps/studio/src/__tests__/fuma/siteAi.adversarial.e2e.test.ts \
  apps/studio/src/__tests__/fuma/siteAi.demo.test.ts \
  apps/studio/src/__tests__/architecture/fuma-site-ai.test.ts
bunx eslint apps/studio/server/fuma/siteAi apps/studio/server/ai/runtime/types.ts \
  apps/studio/server/ai/runtime/runner.ts apps/studio/server/ai/runtime/persister.ts \
  apps/studio/server/ai/drivers/types.ts apps/studio/server/ai/drivers/http/execTool.ts \
  apps/studio/server/ai/drivers/http/toolLoop.ts apps/studio/server/ai/handlers/chat.ts \
  apps/studio/src/__tests__/fuma/siteAi*.ts \
  apps/studio/src/__tests__/architecture/fuma-site-ai.test.ts
```

## Conductor seams

1. After native conversation creation, derive current trusted request/editor authority and call `bindConversation`.
2. Hash the validated site snapshot, call `bindSnapshot`, then call `beginTurn` immediately before the native driver.
3. Attach the returned authority to `toolContextBase` and the existing conversation persister context.
4. Compose `createSiteAiCatalogAuthority` and `createSiteAiCreditAuthority` from finalized FUMA-063/064 services.
5. Instantiate `PostgresSiteAiRepository` against finalized migration `000068_site_ai_scope_authority`.
6. Later FUMA-SITE-008 adds component tools through the existing native tool registry; it must reuse this same authority hook and receipt boundary.

Final conductor evidence: hosted migration `000068_site_ai_scope_authority` is registered at checksum `0c0368622abc603c03cd46e2c37107c2efc61c38f1bb3335539efcffa1e77bd5`; ticket-focused acceptance passed **15 tests / 81 assertions**, native-AI regression acceptance passed **28 tests / 85 assertions**, native PostgreSQL passed **1 test / 6 assertions**, and the closing repository aggregate passed **8,123 tests with 29 expected skips and 0 failures**.

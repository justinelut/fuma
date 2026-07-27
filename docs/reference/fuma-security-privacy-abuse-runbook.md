# Fuma security, privacy, and abuse incident runbook

## Scope

Covers tenant IDOR, CSRF/session realm leakage, webhook replay, SSRF/upload/zip bomb, plugin sandbox/signature, AI prompt/tool abuse, MCP token misuse, payment scope, expert inquiry abuse, support impersonation, protected-owner recovery and privacy export/delete.

## Immediate containment

1. Open immutable incident evidence with a non-PII correlation ID. Never paste cookies, credentials, raw webhooks, prompts, inquiry bodies or payment references into chat/logs/tickets.
2. Revoke the narrowest authority: session, MCP hash, BYOK envelope, plugin signature/installation, inquiry channel or provider key. Kill switches must not require deployment for AI models or reviewed releases.
3. Suspend affected site/profile/plugin projection and purge bounded caches. Do not suspend unrelated tenants.
4. Preserve encrypted evidence under retention/legal-hold policy. Ordinary support APIs cannot invoke break glass.
5. For payment/email/domain/provider events, use the provider verification channel and hashed references; never trust labels or forwarded status.

## Support and break glass

Support requires admin host, internal capability, recent step-up, reason, visible banner, non-protected target, no nesting and at most 30 minutes. It grants no authority above the target. Protected owner recovery is a separate isolated workflow with two distinct current approvers, immutable evidence and expiry; neither approver may act through impersonation. Every action is audited and evidence cannot be edited after creation.

## Privacy requests

Authenticate the subject, resolve every indexed record, generate a hash/count export, then delete customer data through idempotent jobs. Retain only declared legal-hold or unexpired financial records, list each exception and purge caches/objects/search projections. Verify backups follow expiry policy rather than silently rewriting immutable backup history. A completion receipt contains no plaintext subject data.

## Required adversarial gates

Cross-tenant IDs/owner generation, CSRF and wrong host/audience, cookie parent-domain, auth-code replay, webhook replay/signature/raw-body handling, SSRF and redirects, archive size/path/count/ratio, upload MIME/SVG, QuickJS escape/deadline/memory/network permission, unsigned/revoked plugin, AI silent write/secret exfiltration/arbitrary amount, MCP revoke/expiry/publish step-up, payment credential scope, inquiry spam/header injection, support nesting/protected target, break-glass ordinary API, export/delete completeness and telemetry redaction.

## Recovery and disclosure

Rotate only affected secrets through approved custody, restore least authority, reconcile ledgers/imports/transfers, invalidate public projections and run independent review. Legal/privacy owners decide notification timelines. Record root cause, affected scope, evidence hashes, rollback/restore, customer communication, follow-up owner and due date. No production recovery action is automated by this source-only phase.

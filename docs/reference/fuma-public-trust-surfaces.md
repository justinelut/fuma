# Fuma public trust, policy, contact, and status surfaces

FUMA-WEB-014 owns the public Web trust centre, current website notices, policy history, security/privacy/abuse/general contact presentation, strict contact route, and status presentation. It does not approve legal text, operate a delivery provider, establish an SLA, monitor production, or declare launch readiness.

## Public routes

- `/trust` inventories repository-backed boundaries and states that launch approvals remain separate.
- `/legal` is the canonical policy index and exposes the pending exact-byte policy-set digest without inventing an approver.
- `/legal/privacy`, `/legal/terms`, `/legal/cookies`, and `/legal/acceptable-use` show current version `2026-07-26`, effective date, review role, and review due date. Their slugs are generated from the validated legal collection at build time, so standalone delivery does not depend on untraced runtime content files; unknown slugs fail closed.
- `/legal/history` truthfully records that these are initial versions and no superseded public text exists yet.
- `/security` and `/.well-known/security.txt` provide human and machine-readable disclosure entry points without exposing a private recipient.
- `/security`, `/privacy-request`, and `/contact` use the same bounded form with route-specific safety wording. General and abuse requests remain distinct categories.
- `/status` renders fresh strict authority data or a claim-free unavailable state. A separate history link appears only when a safe HTTPS URL is configured.

The public policies are repository-published website notices. Independent legal/privacy approval remains pending and the pages say so. They make no certification, compliance, provider, uptime, incident, SLA, delivery, response-time, or launch claim.

## Contact boundary

`POST /api/contact` requires the exact public HTTPS origin, JSON, an 8 KiB body limit, strict TypeBox fields with `additionalProperties: false`, consent version `2026-07-26`, a 16–128 character replay token, a canonical form-start timestamp, and an empty honeypot. It rejects too-fast and stale forms, unsafe name/email control characters, extra fields, malformed expert IDs, and oversized messages.

Before forwarding, the process:

1. canonicalizes the name and email;
2. makes identical accepted-token retries idempotent and rejects token/body collisions;
3. rate-limits a SHA-256 key derived from process salt, limited request-address input, and reply address;
4. keeps rate attempts for ten minutes and accepted replay fingerprints for at most 24 hours in process memory;
5. forwards only the strict minimized routing payload to the existing private server bridge.

Every response is no-store, sets no cookie, does not echo submitted text or expose a recipient, and includes defensive response headers. `202` means accepted for routing, not delivered. Private-route failure returns `503`; local rate exhaustion returns `429`. Process-local controls are defence in depth, not durable distributed enforcement.

## Status boundary

The server reads `FUMA_STATUS_SUMMARY_URL`; the browser never receives that URL or a credential. The configured URL must be HTTPS and credential, query, and hash free. Fetches are no-store, reject redirects, time out, cap responses at 8 KiB, and accept only the strict `operational | degraded | outage` TypeBox object. Responses older than five minutes or more than one minute in the future fail closed.

`FUMA_PUBLIC_STATUS_PAGE_URL` is optional and independently HTTPS-validated. If configuration, transport, status code, size, JSON, schema, or freshness fails, `/status` says current status is unavailable and makes no operational, provider, uptime, or incident claim. It never reuses stale status.

## Policy publication and deterministic demo

`lib/legal-policy-history.ts` validates strict immutable version records. `publishPolicyVersion` requires a later effective date/version, marks the former current version historical, and retains its complete content. The production history currently has no superseded version; the deterministic fixture publishes privacy `2026-07-27` over `2026-07-26` and proves the prior text remains.

`content/public/legal/approval-manifest.json` records the exact SHA-256 of each current policy source and a sorted aggregate policy-set digest. `lib/legal-policy-approval.ts` re-hashes source bytes, re-parses the version metadata, requires the complete sorted four-policy set, rejects partial approval claims, and permits `approved` only when named legal, privacy, and trust-and-safety records all bind that same aggregate digest. The current manifest is explicitly `pending` with an empty approval list.

`tests/evidence/fuma-web-014-trust.json` is a deterministic source fixture, not production evidence or approval. Its test demonstrates:

- a bounded contact request returns `202`, an identical replay returns `202`, and the private forwarder is called once;
- a new privacy version preserves the prior complete text while legal approval stays `pending`;
- a failed status authority produces `unavailable` with no operational or provider claim.

## Integrated conductor state and remaining limitations

The conductor now shares `ContactRequestSchema` through `@fuma/public-contracts`, mounts authenticated `POST /_fuma/private/public/v1/contact`, revalidates the 8 KiB strict body, applies a central Redis aggregate limit, and forwards only through an explicitly configured dedicated HTTPS sink. The sink requires a private token, forbids credentials/query/hash/redirects, uses a bounded timeout, and fails closed when absent. Focused Web/Studio tests cover validation, local replay behavior, central limiting, unavailable routing, header injection, no PII reflection, and strict forwarding. Blyss HTTPS browser acceptance passed the template/trust routes at 320 px with labelled contact regions, keyboard skip focus, semantic status output, and no runtime errors. No real contact submission or external sink request was executed.

The remaining blockers before FUMA-WEB-014 tracker closure are:

1. Add cross-replica durable replay/idempotency at the private delivery boundary and approve routing, retention/deletion, audit/redaction, escalation, and delivery behavior. The existing Web replay cache is process-local and is not represented as distributed production evidence.
2. Configure an approved server-owned status summary and optional public history URL; provide real freshness, degradation, cache, incident, monitoring, and on-call evidence. No provider is selected or mutated here.
3. Obtain named legal/privacy/trust-and-safety approval for the exact current policy bytes and preserve every future superseded text in public immutable history.
4. Complete production secret injection, owner catalogs, and integrated launch evidence. Browser acceptance of the fail-closed surfaces is complete, but no live approved contact/status authority was fabricated.

This ticket does not deploy, scan a provider, purchase a service, send external contact, mutate a provider, edit migration registries/checksums, or change the unsigned launch decision.

## 2026-07-31 durable trust-authority checkpoint

The private contact boundary now supports strict metadata-only receipts bound to the exact replay token, request SHA-256, contact kind, retention version, accepted time, and deletion time. A lease-based repository contract distinguishes exact replay, mutation conflict, in-progress routing, release, and completion; the private boundary independently rechecks receipt/request identity. The status boundary now has an authenticated provider-neutral HTTPS authority with strict 8 KiB, freshness, incident coherence, no-store, timeout, and redirect-denial gates. Focused Studio authority evidence passes 16 tests / 72 assertions; Web trust/contact/status/legal evidence passes 24 tests / 175 assertions; Web typecheck and production build pass.

WEB-014 remains open. No accepted migration in the current 77/77 runnable prefix owns `fuma_public_contact_routing_receipts_v2`, so the PostgreSQL receipt adapter is not production-runnable and no cross-replica native acceptance is claimed. The legal approval manifest remains pending, and no protected production incident/on-call source or named approval exists. These facts must not be fabricated or inferred from deterministic fixtures.

## 2026-07-31 recovered implementation acceptance

The repository-owned production seam is complete without changing the concurrent migration order. Additive candidate `000080_public_trust_authority` owns `fuma_public_contact_routing_receipts_v2`; its exact source checksum is `9d3fbbe099e0c43816b677e78cbea9ba41d393bdc574dcb4d66ec85fd0fbde74`. The table contains metadata only, fences routing with leases, permits one `routing -> accepted` transition, makes accepted identity immutable, rejects deletion before `delete_after`, and permits retention deletion after expiry. It stores no name, email, message, request body, or provider response. The candidate intentionally remains outside the shared registry while FUMA-077's `000078` sentinel and isolated FUMA-WEB-016 `000079` are under concurrent conductor ownership; registering it early would change migration order.

Native PostgreSQL acceptance used two repository instances against one isolated schema. Eight contenders produced one sink delivery, later eight-way exact replay produced no second delivery, changed-body replay conflicted, raw contact content remained absent, identity mutation and early deletion failed, one expired receipt was deleted, and cleanup left no schema. Focused evidence after the recovery is:

- public Web trust/contact/status/legal/submission/architecture: **24 tests, 180 assertions, 0 failures**;
- Studio contact/status/private-boundary/architecture: **16 tests, 85 assertions, 0 failures**;
- native PostgreSQL candidate/authority: **2 tests, 20 assertions, 0 failures**;
- strict Web typecheck and changed-file ESLint: pass;
- public Web production build: pass, **38 generated pages**, acquisition routes at **153,171 B gzip JavaScript**, **0 B images**, **0 B fonts**;
- Blyss browser acceptance at `https://3002.blyss.co.ke`: **2 tests passed**, covering all trust routes at 320 px and 1280 px, `/contact` at 320 px with 200% text, no horizontal document overflow, labelled controls, skip-link focus, semantic status output, canonical `security.txt`, safe unavailable states, and zero runtime errors.

The public status card now presents a validated degradation incident and on-call coverage semantically when authority data is current. Missing or invalid authority remains claim-free. The contact form explicitly constrains CSS Grid intrinsic widths, so controls and actions reflow at the ticket's 320 px/200% acceptance size. No contact request or provider call was made during browser acceptance.

### Conductor serialization and formal closure

After accepted `000078` and `000079` ordering is final, the conductor must import/register `publicTrustAuthorityMigration` as `000080_public_trust_authority`, bind the checksum above in the shared migration manifest, and rerun the native test. This section is the exact migration handoff; the shared registry is deliberately untouched here.

Formal tracker closure is still not objective from repository evidence alone. `approval-manifest.json` remains `pending` with no named legal, privacy, or trust-and-safety approval; no protected production status/incident source, fired monitoring evidence, or named on-call acknowledgement was supplied; and no production secret injection or external contact sink acceptance was performed. Those approvals and production observations must be supplied by their real owners and bound to the exact policy/status bytes. They must not be inferred from unit fixtures, the native receipt test, or Blyss fail-closed browser acceptance.

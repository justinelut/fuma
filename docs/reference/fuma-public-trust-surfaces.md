# Fuma public trust, policy, contact, and status surfaces

FUMA-WEB-014 owns the public Web trust centre, current website notices, policy history, security/privacy/abuse/general contact presentation, strict contact route, and status presentation. It does not approve legal text, operate a delivery provider, establish an SLA, monitor production, or declare launch readiness.

## Public routes

- `/trust` inventories repository-backed boundaries and states that launch approvals remain separate.
- `/legal/privacy`, `/legal/terms`, `/legal/cookies`, and `/legal/acceptable-use` show current version `2026-07-26`, effective date, review role, and review due date.
- `/legal/history` truthfully records that these are initial versions and no superseded public text exists yet.
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

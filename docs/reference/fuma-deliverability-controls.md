# FUMA-047 deliverability controls

FUMA-047 extends the immutable OCI campaign boundary with three independent authorities: scoped suppression, OCI delivery-log reconciliation, and Fuma-owned first-party engagement. The implementation is TypeBox-only and remains within the Studio Publication domain.

## Suppression and unsubscribe

`ScopedEmailSuppression` supports `global`, `site`, and `newsletter` levels. A newsletter level requires exactly one newsletter ID; global/site levels forbid one. Campaign submission checks both legacy and scoped suppression immediately before each recipient’s OCI request. One-click unsubscribe consumes its signed token once, updates member state, and automatically records newsletter-level suppression when a newsletter was named or site-level suppression otherwise. OCI hard-bounce, complaint, and unsubscribe logs automatically record global suppression after replay-safe reconciliation.

Public unsubscribe remains non-oracular, HMAC-signed, fail-closed rate limited, and supports RFC one-click headers emitted by campaign delivery. Invalid, expired, replayed, or tampered tokens do not reveal member state.

## OCI reconciliation

The OCI event contract accepts only `accepted`, `relayed`, `delivered`, `deferred`, `bounced`, `complained`, and `unsubscribed`. Open/click are impossible in that schema. Raw bytes are signature-verified before JSON parsing, scope is derived from the server-owned provider-message delivery, and event IDs are append-only/idempotent. Reordered logs use terminal precedence: complaint cannot regress, bounce/suppression cannot regress to accepted/deferred/relayed, `relayed` maps to delivered, and `unsubscribed` maps to suppressed. Diagnostics count distinct provider messages so replay/log fan-out cannot create rates above 100%.

Public OCI ingress is limited to 600 requests/minute per source and rejects empty, oversized, or invalidly signed payloads. Unsubscribe is limited to 20/minute. First-party engagement is separately limited to 300/minute.

## Sender and domain health

A domain record contains approved sender addresses plus current SPF, DKIM, and DMARC states and bounded diagnostics. `productionReady` is derived and must be true only when all three controls are verified and at least one sender belongs to the exact domain. Hosted campaign composition checks the exact resolved sender before snapshot persistence; unverified or unapproved production senders fail closed.

The analytics workspace displays approved domain readiness, SPF/DKIM/DMARC state, and diagnostics through app-local Publication UI and permission-scoped routes. Mutation requires `publication.newsletters.send`; diagnostics require `publication.analytics.read`.

## First-party engagement privacy

Engagement uses a domain-separated HMAC token and `/_fuma/publication/engagement`, not OCI events. Events contain only campaign/member IDs, `open` or `click`, an optional SHA-256 target hash, timestamps, and expiry—never a raw destination URL. Recording requires current explicit opt-in and is fenced again in the PostgreSQL insert so an opt-out racing collection wins. Consent versions are contiguous, opt-out is immediate, and retention is bounded to 1–400 days. Expired events are purged before diagnostics.

Authenticated consent/opt-out requires `publication.members.write`; aggregate engagement diagnostics require `publication.analytics.read`. The Studio surface labels these metrics as first-party and separate from provider-confirmed delivery.

## Persistence and acceptance

Candidate migration `000054_publication_deliverability_control` is additive and intentionally unregistered in the worker branch. It creates a complete append-only OCI log table, safely backfills historical OCI events, and adds scoped suppressions, sender-domain health, engagement consents, and engagement events. The conductor owns registration and checksum finalization.

Focused acceptance covers replay, tamper, reorder, one-click scope, suppression at send, unverified sender denial, engagement consent/opt-out/retention, open/click schema separation, rate boundaries, domain health, and a deterministic demo. Optional live PostgreSQL acceptance applies the candidate in a disposable schema and proves suppression queries, domain persistence, consent compare-and-set, final opt-out fencing, summaries, and purge.

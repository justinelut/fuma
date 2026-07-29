# Fuma site application state and legacy compatibility

Status: **Implemented and closed by FUMA-SITE-005 on 2026-07-30.** This reference covers the repository runtime boundary only; production traffic cutover remains gated by infrastructure, pilot, and launch tickets.

## Authority flow

Interactive tenant behavior preserves one backend authority chain:

```text
official Client control
  -> persistent ApplicationStateProvider
  -> same-host POST /__fuma/runtime/v1/mutations
  -> isolated Next private client
  -> Bun POST /_fuma/private/site-runtime/v1/mutate
  -> exact active host/release/member re-resolution
  -> injected Bun domain mutation adapter
  -> immutable replay receipt
```

`apps/site-runtime` never imports Studio, a database client, provider SDK, shared UI package, or tenant Server Component. Every untyped boundary is a strict TypeBox contract with `additionalProperties: false`; the independent Next contract uses self-contained timestamp patterns and does not depend on process-global TypeBox format registration.

## Exact application context

Each resolved route carries an immutable application context containing:

- exact host, platform/organization/workspace/site ancestry, owner key and generation;
- active release ID/hash, route/query, runtime deployment, component registry, and rollout policy version;
- public or exact member audience plus access fingerprint;
- canonical site-member identity/session projection;
- versioned cart, booking, and account snapshot;
- explicit public, private, or no-store cache policy.

The canonical site-member cookie is `__Host-fuma_member_session`: Secure, HttpOnly, SameSite=Lax, Path=/, host-only, and forwarded alone. Public route responses may use the release-qualified shared cache. Member/application snapshots and mutation responses bypass it and are `private, no-store` with `Vary: Cookie`.

## Persistent Client state

`ApplicationStateProvider` lives above page segments in the root layout. It accepts newer server snapshots for the same exact realm while preserving newer accepted state across Next client transitions. Host, site, owner generation, member ID, or member session changes reset the state.

Mutations are serialized and optimistic. A request advances an expected version locally, then either accepts the strictly validated Bun snapshot or performs a guarded rollback. An older failure cannot overwrite newer accepted state. Official `application.member-status@1.0.0`, `application.cart-action@1.0.0`, and `application.booking-action@1.0.0` controls are compiled Client components bound to exactly `interaction.local-state`; registry metadata cannot add browser, server, network, payment, secret, or provider authority.

## Mutation fencing and production adapters

`SiteRuntimeApplicationAuthority` re-resolves the active host/release/member before every mutation. It enforces a five-minute freshness window, expected state version, exact binding and audience equality, canonical member session, idempotency request hash, immutable identical replay, and changed-replay denial. PostgreSQL receipts bind the response to host/site/owner generation/member/release and reject update/delete.

The generic mutation seam deliberately does not invent cart or booking storage. `createHostedSiteRuntimeAuthority()` accepts an injected `SiteRuntimeMutationAdapter`; without a concrete Bun domain authority it uses `UnavailableSiteRuntimeMutationAdapter` and returns a bounded unsupported response. FUMA-058 payment services remain their own authority and are not repackaged as cart/booking snapshot storage. A future domain adapter must consume the full idempotent operation and remain safe if execution succeeds while receipt persistence races.

## Route rollout and legacy compatibility

Per-route policy is versioned and compare-and-set persisted. It selects React or an exact retained legacy release, optionally shadow-compares semantic hashes, permits fallback only when explicitly configured, and rolls back without changing the active release or transactional application data. Rollout policy version is part of cache identity.

The PostgreSQL legacy reader rechecks owner generation, transfer fences, retained ready/active release state, manifest/snapshot/route artifacts, semantic HTML and script bytes, size limits, SHA-256, and strict UTF-8. It rejects embedded scripts, base/iframe/object/embed, `http-equiv`, inline handlers, `javascript:`, hash drift, `eval`, `Function`, dynamic import, WebSocket, and EventSource.

Accepted legacy HTML and separately verified IIFEs render only in:

```html
<iframe sandbox="allow-scripts" referrerpolicy="no-referrer">
```

`allow-same-origin` is never granted. The frame document uses `default-src 'none'`, `connect-src 'none'`, `form-action 'none'`, `base-uri 'none'`, and `frame-ancestors 'none'`. The parent nonce/`strict-dynamic` CSP permits only same-origin frames.

## Persistence

Hosted migration `000072_site_runtime_application` adds:

- `fuma_site_runtime_route_policies_v2` for exact generation-qualified route policy CAS;
- `fuma_site_runtime_mutation_receipts_v2` for immutable member/idempotency evidence.

Canonical checksum: `48b68eb8fa97e6f47a9ef97c510adedd975e88ef39425d9b26e3b24db74722da`. Hosted/runnable prefix: **72/72**. Next ID: `000073_release_followup`. The migration is additive and has no destructive down path.

## Acceptance evidence

The integrated SITE-001..005 gate passes **88 tests, 312 assertions, 0 failures**. Native PostgreSQL 16 acceptance passes **1 test, 14 assertions**, including policy CAS, retained-release FK, receipt dedupe/immutability, and zero disposable schemas/roles.

Native Linux ARM64 Chromium used only `https://3111.blyss.co.ke` and `https://3112.blyss.co.ke` for browser navigation, with the matching private service at `https://3113.blyss.co.ke`. Evidence proves authenticated/public realm isolation, accepted cart state `0→1`, settled optimistic rollback, state persistence across `/menu → /about`, shadow parity, explicit React-to-retained-legacy rollback, opaque `allow-scripts` sandbox/CSP, unchanged domain version, foreign-site `404`, one-document client navigation, responsive/reduced-motion/CSP nonce gates, and zero captured browser security/runtime errors. Transcript SHA-256: `33e10ac4899ba6a4a7b92c58bac8b80c1b1480d81078a817afb5929fa23816e4`.

The closing aggregate passes **8,258 tests, 33 expected optional skips, 0 failures, and 153,217 assertions**. Frozen install, full lint/build, strict TypeScript, diff/lock/migration audits, native cleanup, and standalone route emission pass. No production migration, deployment, traffic/DNS/TLS change, provider mutation, purchase, protected signing/scanning, Docker/emulation, commit, or push occurred.

## Related

- [`fuma-tenant-runtime-architecture.md`](fuma-tenant-runtime-architecture.md)
- [`fuma-tenant-react-runtime-component-marketplace.md`](fuma-tenant-react-runtime-component-marketplace.md)
- [`fuma-immutable-releases.md`](fuma-immutable-releases.md)
- [`fuma-edge-delivery.md`](fuma-edge-delivery.md)

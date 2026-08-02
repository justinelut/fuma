# FUMA-059 domain contracts and credential ownership

FUMA-059 defines the authority boundary consumed by later domain automation. It does not create DNS records, mutate TLS, call Cloudflare or a registrar, search or purchase domains, mount HTTP routes, or register workers. FUMA-060–062 retain those responsibilities.

## Host identity and state

`server/fuma/domains/contracts.ts` is the strict TypeBox boundary. Every persisted host is normalized through Node's UTS-46/IDNA conversion, stored as lowercase ASCII A-label identity, and accompanied by a stable NFC Unicode display form. Input containing a scheme, credentials, path, query, fragment, wildcard, port, IP literal, empty label, overlong label, or unstable IDN round trip fails closed.

A domain has three independent state machines:

- desired: `detached -> validating -> active`, with explicit suspension, detachment, and terminal deletion;
- observed: DNS and TLS evidence from `unknown` through `dns-pending`, `dns-valid`, `tls-pending`, `active`, degradation, detachment, and terminal deletion;
- certificate: `none`, provisioning, active, expiring, expired, failed, or revoked.

Cross-machine invariants prevent active routing without desired activation and an active certificate, active certificates without DNS evidence, suspended/detached records remaining observed active, and deleted records retaining routing, TLS, or credential bindings. Every accepted transition increments the optimistic version and operation fence and appends immutable actor, reason, operation, timestamp, old/new state, and SHA-256 evidence. Exact retries converge; changed replay or stale fences fail.

## Credential ownership

`fuma-platform` credentials are owned by the Fuma platform authority and have no tenant coordinates. They are mandatory for `fuma-registered` records. `customer-automation` is an optional future scope bound to the complete organization/workspace/site/owner-generation/profile authority of a `customer-dns` record. It does not imply launch support or customer DNS mutation.

Secrets enter only the internal credential command boundary as `Uint8Array`. `AesGcmDomainSecretCipher` uses a non-extractable AES-256-GCM key, a unique 96-bit IV, and the complete credential authority as authenticated additional data. Persistence receives only a versioned ciphertext envelope. Scope and organization are derived from that authority rather than duplicated in the envelope, so they cannot diverge. Decryption requires the exact authority, active credential version and fence, and an internal provider-port operation. Plaintext is zeroed after use and is never returned by a repository, public projection, redacted projection, log, audit value, plugin, tenant, or AI contract.

Rotation is append-only evidence: credential version and fence increase, the prior fingerprint is retained for reconciliation, and stale concurrent rotation is denied. Revocation is terminal. Redacted output contains lifecycle metadata and the literal `[REDACTED]`, never ciphertext or plaintext.

## Entitlement and metering ports

`DomainCommercialAuthority` is a narrow admission/commit/release interface. `DomainCommercialIntegration` resolves FUMA-054 entitlement, reserves and settles one FUMA-057 `customDomains` unit, and writes one FUMA-052 `custom_hostnames` logical/physical adjustment. Platform-internal domains retain finite quota enforcement and `internalWorkload: true` shadow-cost attribution. A failed insert releases admission; deterministic idempotency keys make retries converge.

## Deterministic evidence

`server/fuma/domains/fakes.ts` provides a fake clock, non-extractable deterministic AES key authority, deterministic IV source, and metadata-only read provider-port fake. These fakes perform no external mutation and never persist plaintext. Focused unit, integration, security, fault, and architecture tests cover IDN normalization, strict schemas, all state ledgers and cross-state invariants, scope isolation, rotation/revocation, retry identity, concurrent fences, entitlement/metering attribution, redaction, and forbidden imports.

## Finalized migration and conductor integration

The committed `000031_domains` migration predates these strict contracts and remains immutable. The additive v2 authority is finalized and centrally registered as `000062_domain_contract_authority_v2` with SHA-256 checksum `275de598666587dbf9ce82d10da38e19709859b2e50dcf0f4c9a5fda56d380c7`. It adds exact-scope domain records, append-only credential versions with fenced heads, immutable transitions, and idempotent operation receipts. It contains no plaintext secret column and no destructive SQL. The SQL body was applied successfully with finalized `000061` and `000063` on a blank disposable native PostgreSQL 16 schema.

Conductor integration preserves the ticket boundary:

1. `DomainService`, strict contracts, production AES-256-GCM credential cipher, commercial authority integration, deterministic provider/key/clock fakes, and the finalized migration are exported as trusted server-local authorities.
2. The deterministic serialized `MemoryDomainRepository` and no-op commercial authority live in `domains/memory.ts`, keeping the production service below the 700-line module ceiling without weakening the architecture gate.
3. Structured `DomainCredentialAuthority` is the only cipher binding used by downstream commercial-edge fakes; obsolete unstructured scope signatures are removed.
4. `cloudflare/reconciler.ts` depends on its own deferred `CloudflareDomainTransitionPort`. It is intentionally not wired to obsolete five-argument `DomainService` transitions; FUMA-060 owns the concrete adapter, state mapping, production reconciliation job, and provider operations.
5. No domain HTTP route, Cloudflare mutation, registrar purchase, DNS/TLS operation, or provider credential was added or executed by FUMA-059.

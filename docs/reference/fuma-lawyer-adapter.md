# FUMA-076 Lawyer import adapter

FUMA-076 provides a deterministic, sanitized migration proposal and a reauthentication-gated execution adapter for The Lawyer's Ghost/Next inventory. It reuses the FUMA-075 generic structured Ghost importer, the FUMA-058 verified customer-payment evidence shape, publication scope authority, and member-identity staff reauthentication. It does not contact Paystack, OCI, SMTP, Resend, Ghost, or any other provider.

Design conversion is intentionally outside this ticket. Reusable templates, loops, access bindings, and the zero-flattened-copy requirement remain FUMA-077 and FUMA-SITE-006 work. Pilot signatures, immutable grandfathering, live OCI activation, and rollback sign-off remain FUMA-084 acceptance.

## Inputs and proposal boundary

`planLawyerImport` accepts one strict TypeBox `LawyerSnapshotSchema` (`additionalProperties: false`) containing a sanitized Ghost export, a complete route manifest, declared inventory counts, legacy payment claims, already-verified FUMA-058 payment evidence, customer commitments, and hashed evidence locations. Inputs are bounded and copied before use. Unknown top-level authority and forbidden nested secret fields fail closed.

Planning is read-only. It builds the generic import plan and a sanitized reconciliation report; it has no repository, process environment, global, network, provider, or deployment authority. A `dryRun: true` plan cannot be executed by the generic importer. Report hashes are deterministic for the same snapshot and import identity.

The checked-in fixture uses synthetic `example.test` identities and sanitized content. Demo output contains aggregate counts, classifications, policy state, and hashes only—no email addresses, raw payment references, provider transaction IDs, credentials, or customer PII.

## Accepted sanitized inventory

| Boundary | Deterministic acceptance |
|---|---|
| Routes | 69 total: 40 page, 18 API, 6 feed, 5 system; every route is unique and retained with source and access metadata. |
| Route access | 44 public, 6 member, 3 staff, 16 service. Route/access conversion is deferred rather than flattened. |
| Content | 42 posts and 21 pages; 45 public, 9 member, 9 paid. Content IDs and the generic manifest are hashed. |
| Authors and members | 4 authors and 4 members. All eight imported identities require activation/reauthentication; source passwords and sessions are excluded. |
| Taxonomy and relations | 38 tags, including all 13 section tags, and exactly 147 valid author/tag relations. Dangling or duplicate source identity fails in the generic importer. |
| Reserved configuration | 16 underscore pages map typed JSON envelopes to `lawyer.reserved.*` settings; unsafe, malformed, or missing envelopes are quarantined instead of becoming configuration. |
| Newsletters and media | 1 newsletter and 2 unique media objects; both remain part of the resumable generic plan. |
| Commitments | Sanitized storage, backup retention, traffic, anonymous analytics, OCI email workload, annual maintenance, response, inclusion, and exclusion terms are retained and hashed. |

The report carries separate SHA-256 identities for routes, content IDs, relations, membership reconciliation, newsletters, commitments, evidence, the generic manifest, and the complete report seed. Declared-count drift and duplicate routes fail closed.

## Payment and access reconciliation

Legacy member labels and notes are claims, never payment authority. Each active claim is compared with one exact FUMA-058 verified transaction: customer-merchant scope, successful status, KES amount, member, tier, reference, owner coordinates, credential metadata, and unique provider/reference identity must all agree. Results are one of:

- `verified-for-fuma-reconciliation`, which is only eligible for a later Fuma payment reconciliation;
- missing, ambiguous, label, reference, provider, duplicate-identity, or orphan exceptions; or
- `no-paid-claim`.

No result directly grants access, activates a membership, creates a subscription, or imports a provider credential. Raw provider references and transaction IDs are replaced by hashes in the report. The fixture proves one eligible claim and four fail-closed outcomes when the orphan evidence row is included.

## OCI and identity policy

The report fixes the destination to `oci-email-delivery`, excludes `ghost-native`, `resend`, and `smtp`, and records `providerCredentialsImported: false`. This is a migration policy declaration, not live OCI activation or a provider mutation.

Execution and rollback both require a verified staff proof with exact publication platform/organization/workspace/site/owner/generation/profile scope, `staff` realm, `member-import` purpose, a current expiry, and at most a ten-minute authentication window. Every imported author and member remains marked for destination-side activation; source credentials are never migrated.

## Secret rejection and quarantine

The adapter recursively rejects password, session, cookie, authorization, token, API-key, private-key, client-secret, SMTP, Resend, and Paystack-secret fields. Sensitive Ghost settings are removed before generic mapping. Nested JSON rejects prototype keys, secret keys, excessive depth, excessive strings, and excessive arrays.

Malformed and unsafe `custom_excerpt` or reserved-page `codeinjection_head` JSON is represented by source ID, field, reason, and source SHA-256 only. The bad value is cleared, no synthetic setting is created, and processing continues with an explicit quarantine record. This differs deliberately from a snapshot secret, invalid strict contract, count mismatch, duplicate route, or invalid relation, all of which reject the proposal.

## Resume, receipt reuse, and rollback

`executeLawyerImport` delegates only to `executeStructuredGhostImport`. Object and media state checks make a retry skip already-applied work, while durable cursors identify object/media progress. An existing applied receipt with the same manifest hash is returned unchanged.

`rollbackLawyerImport` verifies the same exact staff proof and manifest identity, removes media and objects in reverse plan order, and writes a rolled-back receipt. Repeating rollback returns that receipt unchanged. The adapter uses hosted additive migration `000038_structured_imports`, whose scoped import, object/quarantine, Lawyer reconciliation, reauthentication, cursor, and rollback-receipt tables are the persistence contract; FUMA-076 does not introduce or execute a new migration.

## Evidence

Focused evidence lives in:

- `apps/studio/src/__tests__/fuma/FUMA076/lawyerIntegration.test.ts` — complete inventory, all routes/access classes, content, relations, member activation, JSON mappings, commitments, and hashes;
- `lawyerPayments.test.ts` — provider-evidence classifications, duplicate identities, reference mismatch, and no direct access grant;
- `lawyerSecurity.test.ts` — strict/secret/count/route rejection and unsafe JSON quarantine;
- `lawyerFault.test.ts` — dry-run immutability, exact/fresh reauthentication, fault resume, receipt reuse, and idempotent rollback;
- `lawyerDemo.test.ts` — deterministic aggregate-only read-only demo with explicit PII/provider-identifier absence;
- `apps/studio/src/__tests__/architecture/fuma-lawyer-import.test.ts` — TypeBox/server isolation, authority reuse, no provider/global mutation, sanitized reporting, hosted schema, and module-size gates.

Run only the focused ticket evidence:

```sh
bun test apps/studio/src/__tests__/fuma/FUMA076 apps/studio/src/__tests__/architecture/fuma-lawyer-import.test.ts
bunx eslint apps/studio/server/fuma/lawyerImport apps/studio/src/__tests__/fuma/FUMA076 apps/studio/src/__tests__/architecture/fuma-lawyer-import.test.ts
```

Final focused acceptance passed **15 tests, 106 assertions, 0 failures**. The deterministic demo retained 69 routes, 63 content records, 147 relations, four members, payment exceptions, one quarantine, OCI migration policy, and aggregate-only hashes without importing PII, secrets, sessions, or provider identifiers. FUMA-076 reuses finalized hosted migration `000038_structured_imports` and requires no new migration.

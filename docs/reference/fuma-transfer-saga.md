# Fuma Site-Transfer Saga

This reference defines the FUMA-023 durable, fenced site-ownership transfer saga and its claim-level worker contract.

The saga moves one existing site between exact organization/workspace owners without changing its platform identity, site ID, profile assignment, capability overrides, or immutable proposal manifest. PostgreSQL transfer records are authoritative. FUMA-009 is the durable-job target, FUMA-021 derives worker authority, and FUMA-022 appends correlated job facts. FUMA-024 contributes the resumable object-copy lane, final object ownership-policy step, and capability-composed job descriptors, while unfinished production persistence adapters and roots remain unmounted.

---

## TL;DR

- `server/fuma/transfers/contracts.ts` closes the proposal, dual confirmation, manifest capability snapshots, lock, step, receipt, failure, collaborator-intent, command, and result shapes with TypeBox.
- `server/fuma/db/migrations/000008_transfer_saga.ts` stores immutable proposal/confirmation snapshots, ancestry-qualified fenced locks, ordered attempts/receipts, and collaborator intent in additive hosted PostgreSQL tables. Lock identity/fence/acquisition facts and terminal step receipts are database-enforced durable history; deletes and terminal rewrites are rejected.
- `server/fuma/transfers/service.ts` owns staff proposal, source/destination confirmation, start, cancellation, and explicit resume requests. Proposal treats caller metadata only as an expectation: an injected `TransferManifestAuthority` reconstructs the exact snapshot from server-owned state, TypeBox validates it, and only a detached exact match is inserted. An independent `TransferEligibilityAuthority` returns a strict eligible/ineligible decision for a new proposal and is checked again from the stored manifest immediately before the start lock.
- Start checks `site.settings.write` plus every permission declared by the selected profile transfer contributions. Successful start and resume-request transactions call an injected, idempotent `TransferCommandEnqueuePort` for `transfer.execute` and `transfer.resume`; enqueue rejection is failure-audited and rolls back the command state.
- `server/fuma/transfers/jobs.ts` defines `transfer.execute`, `transfer.resume`, and `transfer.compensate`. Their payload is exactly `{ transferId }`; actor, ancestry, profile, permission, request, and fence claims are rejected. `src/core/fuma/launchProfiles.ts` contributes all three persisted kinds through `site.settings`, and `server/fuma/transfers/registrations.ts` resolves their handlers from a composed profile without mounting a worker root.
- `server/fuma/transfers/objectCopyStep.ts` registers mandatory `transfer.tenant-objects-copy`: a checksummed, per-object resumable FUMA-008 copy/rebind lane over every canonical tenant-object class whose destination remains hidden until the final policy step.
- `server/fuma/transfers/objectOwnershipPolicyStep.ts` registers the mandatory final policy step, depends on the complete verified copy receipt, atomically replaces exact source-prefix authorization with exact destination-prefix authorization, and restores source authority first during compensation.
- Step snapshots retain each stable `definitionId` while assigning execution sequence from the registry's arbitrary ordered forward definitions. Compensation attempts are explicitly identified by compensation kind and remain bound to the original forward receipt.
- `server/fuma/transfers/baseOwnershipStep.ts` can change only the site ownership projection and capture pending collaborator intent. Its adapter has no content, object, platform-internal grant, entitlement, payment, contract, or control-plane billing API.
- Process death and duplicate delivery replay handlers against persisted receipts. Explicit resume verifies whether an interrupted effect happened before deciding success versus retry.
- Compensation runs snapshotted step definitions in reverse sequence and releases the lock only after terminal completion or compensation completion.
- Focused coverage is maintained in `src/__tests__/fuma/transferService.test.ts`, `src/__tests__/fuma/transferSagaFaultInjection.test.ts`, and `src/__tests__/fuma/transferSagaDemo.test.ts`; `src/__tests__/architecture/fuma-transfer-boundaries.test.ts` prevents production execution outside the durable-job handler module and locks the eligibility, payload, and base-effect boundaries.

## Boundaries and ownership

| Responsibility | Source of truth |
|---|---|
| Persisted contracts and semantic invariants | `server/fuma/transfers/contracts.ts` |
| Hosted transfer tables and indexes | `server/fuma/db/migrations/000008_transfer_saga.ts`, `server/fuma/transfers/schemaManifest.ts` |
| Scoped transactional reads/writes | `server/fuma/transfers/repository.ts` |
| Staff commands, trusted manifest capture boundary, dual confirmation, eligibility checks, and request enqueue port | `server/fuma/transfers/service.ts` |
| Server-owned profile/override/resource/collaborator/checksum reads | `TransferManifestAuthority` adapter |
| Server-owned transfer business-policy decision at proposal and start | `TransferEligibilityAuthority` adapter |
| Deterministic handler composition | `server/fuma/transfers/stepRegistry.ts` |
| Base ownership effect | `server/fuma/transfers/baseOwnershipStep.ts` |
| Immutable object copy/rebind and fenced checkpoints | `server/fuma/transfers/objectCopyStep.ts` |
| Object authorization policy effect | `server/fuma/transfers/objectOwnershipPolicyStep.ts` |
| Capability-composed job descriptors | `server/fuma/transfers/registrations.ts`, `src/core/fuma/launchProfiles.ts` |
| Claim-level job execution | `server/fuma/transfers/jobs.ts` |
| Durable claim/effect ledger | `server/fuma/jobs/` |
| Trusted job authority | `server/fuma/context/jobContext.ts` |
| Correlated append-only audit facts | `server/fuma/audit/service.ts` |

A transfer retains `platformId` and `siteId`. Source and destination differ by organization and/or workspace. Repository keys always include transfer ID plus the complete source coordinate:

```text
platformId + sourceOrganizationId + sourceWorkspaceId + siteId + transferId
```

A bare transfer ID, site ID, or workspace ID is not repository authority. Job payload contains only the transfer selector; the frozen FUMA-021 context supplies source ancestry, active profile, composed capability, required permission, actor, and job/run correlation.

## State graph

The proposal lifecycle in `server/fuma/transfers/schemaManifest.ts` is closed:

```text
proposed
  └─ source or destination confirms
       → awaiting-confirmations
            └─ distinct actor confirms the other side
                 → ready
                      └─ acquire one ancestry-qualified lock + snapshot steps
                           → running
                                ├─ all forward steps + receipts complete
                                │    → completed + lock released
                                ├─ staff cancellation before ownership release
                                │    → cancellation-requested → cancelled + lock released
                                ├─ interrupted running effect
                                │    → resume-requested
                                │         ├─ verified → running
                                │         └─ not applied → failed attempt → retry → running
                                └─ step failure
                                     → compensating
                                          └─ reverse receipts complete
                                               → failed + lock released
```

`server/fuma/transfers/jobs.ts` subdivides worker progress so one claim does one unit:

1. `transfer.execute` changes one pending attempt to `running`, records one applied effect receipt, creates one retry attempt, or performs one terminal completion.
2. `transfer.resume` verifies one interrupted `running` attempt and records either its recovered receipt or one retryable failed attempt.
3. `transfer.compensate` reverses one original attempt, or performs the final failed transition and lock release after no reverse work remains.

A claim never loops over steps. The returned `nextJobKind` is passed to `TransferSagaContinuationPort`; enqueue idempotency binds transfer, next kind, persisted version, and transition. If continuation notification or process acknowledgement is lost after claim commit, reclaim reads the stable durable result and re-enqueues that exact continuation before any executor entry. Only a claim with no committed result lets persisted saga state select a new legal unit.

## Dual confirmation and immutable manifest

`TransferManifestSchema` snapshots:

- exact source and destination ancestry;
- stable platform/site identity;
- profile ID;
- the exact capability-override grant/revoke snapshot and resolved capability-ID snapshot;
- resource classes and snapshot checksum;
- collaborator preserve/remove intent;
- capture timestamp.

The proposal repeats and semantically matches that manifest, but the request copy is never snapshot authority. `TransferService.propose` first validates the caller copy with `TransferManifestSchema` and authorizes its exact source selector. It then asks `TransferManifestAuthority.capture` to load the exact source site and destination workspace from server-owned persistence and reconstruct profile ID, capability overrides, resolved capability IDs, resource classes, collaborator policy, checksum, and capture time. The port must reject a missing/inactive destination workspace and source changes during capture. Its unknown result crosses the same TypeBox contract, is compared field-for-field with the caller expectation, and is detached before insertion. Any difference is tampering or stale input and inserts no proposal.

Database triggers preserve proposal identity/manifest/proposer/creation fields and reject proposal deletion. Source and destination confirmations are separate immutable rows: the source confirmation repeats the expected transfer ID and complete source site coordinate, while the destination confirmation repeats the expected transfer ID and exact destination organization/workspace scope. Destination authority is workspace authority: its request context must match the destination platform, organization, and workspace and carry one exact `workspace.sites.create` decision. The currently selected destination-side site may be a different existing site and is not treated as ownership authority for the site being transferred. `TransferService.confirm` requires distinct effective staff users. Either confirmation order is valid; execution cannot start until both exist.

The manifest is evidence, not mutable worker input. Step handlers receive the stored manifest and stored lock tuple. They never receive payload-supplied ownership, profile, capability, collaborator, or fence values.

## Server-owned transfer eligibility

Eligibility is not a proposal or command field. `TransferEligibilityAuthority.check` receives a detached server-built input containing only phase (`proposal` or `start`), transfer ID, exact source/destination coordinates, and the validated manifest. Its unknown result must match one of two closed TypeBox branches:

```ts
type TransferEligibilityResult =
  | { decision: 'eligible' }
  | { decision: 'ineligible'; reasonCode: string }
```

Additional fields fail closed. A new proposal checks eligibility only after exact trusted manifest capture and source authorization, but before insertion or audit. Start rechecks from the stored immutable manifest after ready-state and expected-version validation, immediately before lock acquisition. A denial therefore leaves no proposal at proposal time, or leaves an already confirmed proposal in `ready` with no lock, steps, or enqueued execution job at start time.

The caller cannot provide, override, cache, or attest the decision. Eligibility results and their backing control-plane facts are never written into the transfer manifest, proposal, step receipt, job payload, or audit metadata. Platform-internal grant IDs, billing authority IDs, payment/contract IDs, and paid-transfer pending IDs are deliberately absent from every transfer command and durable payload. The eligibility adapter may consult those server-owned systems, but only its closed decision and bounded reason code cross into the saga service.

## Lock, fence, attempts, and receipts

`fuma_site_transfer_locks` grants one active lock per complete source site ancestry. Fence allocation is monotonic for that same ancestry, not global and not site-ID-only. Every step stores `(lockId, fence)` and the repository predicates updates on transfer plus complete source ancestry.

Two fences protect different races:

- the FUMA-009 claim fence rejects stale worker acknowledgement and durable job-effect writes;
- the transfer lock fence rejects stale ownership/step effects after another transfer lock generation exists.

Only a claimed `transfer.execute`, `transfer.resume`, or `transfer.compensate` job may enter `TransferSagaExecutor`; request/service paths can persist commands and enqueue those jobs but cannot call the executor or handlers directly. The executor checks the active transfer lock and every latest forward attempt before calling a handler. A registry definition's stable `definitionId` is its persisted identity. Forward definitions may use arbitrary order values; registry ordering determines their snapshotted execution sequence without turning order or sequence into identity. Attempts carry an explicit forward or compensation kind, and each compensation attempt is bound to the original forward definition and receipt.

Handlers receive:

```ts
{
  manifest,
  saga: { transferId, lockId, fence },
  receipt,
}
```

A successful effect returns a bounded `TransferReceipt`. Persisting that receipt is the commit point for the attempt. A crash after an external effect but before receipt persistence leaves the attempt `running`; duplicate apply must be idempotent, and explicit resume uses `verify` to distinguish `verified` from `not-applied`. Each durable transfer job uses one stable effect key derived from durable job ID, job kind, and transfer ID. On retry the handler reads that committed result before checking cancellation or entering `TransferSagaExecutor`; it replays only the same continuation and missing audit facts, never advances a second saga unit under the first job.

## Base ownership adapter

`BaseOwnershipAdapter` in `server/fuma/transfers/baseOwnershipStep.ts` is deliberately narrow. It exposes only:

- exact site-ownership and destination-workspace inspection;
- atomic fenced ownership rebind/restore;
- pending collaborator-intent capture/read/discard.

It exposes no content, object-storage, media, redirect, settings, encryption-key, platform-internal grant, entitlement, payment, contract, or billing-control-plane movement API. Platform-internal grants and control-plane billing ownership remain attached to their owning platform records; they are not transfer resources, effects, receipts, or collaborator intent. Before any ownership or collaborator-intent mutation, the mandatory `transfer.base-ownership` handler validates the immutable manifest, exact active destination workspace, unique site identity, exact profile ID, and exact capability-override grant/revoke snapshot. Its deterministic apply receipt is derived from that immutable manifest plus the active lock/fence. Replays accept only the same destination ownership receipt. Compensation accepts only that matching apply receipt under the same active fence and restores exact source ownership.

The base operation preserves site ID, profile, and the exact capability-override structure from the manifest snapshot. It captures collaborator policy as separate pending records but does not apply memberships. That separation prevents ownership authority and collaborator authorization from becoming one partially visible mutation.

## Collaborator intent and downstream steps

The manifest records each collaborator once as `preserve` with a destination role or `remove` with no destination role. `fuma_site_transfer_collaborator_intents` stores the intent and its independent application state.

The base handler only creates pending intent. A contributed downstream handler owns membership application. The deterministic registry in `server/fuma/transfers/stepRegistry.ts` requires stable unique definition IDs, unique order values, closed dependencies, and an acyclic forward graph containing the mandatory base definition. Forward steps may occupy arbitrary order values; the persisted snapshot assigns their execution sequence after deterministic ordering, while `definitionId` remains the identity across retries and compensation. Profile composition selects contributed handlers without branching on Website or Publication IDs. Before acquiring the lock, `TransferService.start` requires an allow summary and exactly one exact-source-site allow decision for `site.settings.write` and for every permission on `composition.transfer`; omitting any selected contribution permission rejects the entire start before state or enqueue changes.

Downstream handlers follow the same three-operation contract:

- `apply` is idempotent for the transfer/lock/fence and returns a receipt;
- `verify` determines whether an interrupted effect is absent or durably visible;
- `compensate` reverses only the effect proven by the original receipt.

Compensation candidates are latest succeeded/failed forward attempts, ordered from highest snapshotted sequence to lowest. A reverse attempt has compensation kind and stays bound to its original forward `definitionId` and receipt, so duplicate delivery cannot select a different original. The base ownership reversal therefore runs after higher-order downstream reversals.

## Immutable object-copy lane

`server/fuma/transfers/objectCopyStep.ts` registers mandatory definition `transfer.tenant-objects-copy` at order `60`, after `transfer.base-ownership` and before mandatory final `transfer.object-ownership-policy`. It consumes `TenantObjectStorage`, a server-owned `TenantObjectInventoryPort`, and an injected durable `ObjectCopyStatePort`. The inventory covers every class in `server/fuma/tenantObjects/`; copy lists the complete source site namespace and rejects missing, extra, or metadata-mismatched objects before freezing the canonical manifest.

The state port stores canonical fenced `TenantObjectCopyIntent`, `TenantObjectCopyReceipt`, `TenantObjectCopyProgressReceipt`, and `TenantObjectDeleteReceipt` values. Source/destination scopes and physical evidence derive only from immutable transfer ancestry and FUMA-008 key policy. Destination collisions are accepted only when immutable bytes and metadata match, becoming `rebind`; newly created destinations become `copy`. Replay verifies copied-but-unreceipted bytes instead of duplicating the provider effect.

The copy lane never changes read authorization. `server/fuma/transfers/objectOwnershipPolicyStep.ts` depends directly on its complete progress receipt and atomically persists the canonical source-seal/destination-activate `TenantObjectRebindReceipt`. During failure handling policy compensation restores source authorization first; object-copy compensation then removes only transfer-created `copy` objects, preserves `rebind` objects, and records delete/already-absent evidence. Base site plus stable owner-key ancestry restore last in one PostgreSQL transaction.

`src/__tests__/fuma/objectCopyTransferStep.test.ts` injects death before and after every per-object intent, copy, receipt, final copy receipt, reverse delete, reverse receipt, and compensation completion. It also covers checksum drift, stale fences, duplicate delivery, resume, rebind preservation, orphan cleanup, source-policy ordering, and attacker-scope denial.

## Job contracts and authority

`server/fuma/transfers/jobs.ts` exports these strict payload schemas:

```ts
type TransferExecuteJobPayload = { transferId: string }
type TransferResumeJobPayload = { transferId: string }
type TransferCompensateJobPayload = { transferId: string }
```

All three schemas use `additionalProperties: false`. Payload fields such as `organizationId`, `workspaceId`, `siteId`, `platformId`, `actor`, `permissions`, `requestId`, `fence`, `platformInternalGrantId`, `billingAuthorityId`, or `paidTransferPendingId` fail validation. The handler factory is the intended claimed execution boundary; HTTP/request services never invoke `TransferSagaExecutor` or handlers directly.

`TransferService` instead depends on `TransferCommandEnqueuePort`. After `recordStart`, it requests `transfer.execute`; after `recordResume`, it requests `transfer.resume`. The durable payload remains exactly `{ transferId }`; source organization/site are separate queue-routing fields. Each request carries a bounded SHA-256 idempotency key derived from job kind, complete source coordinate, transfer ID, and authoritative request ID. Replaying an already committed start or resume request returns the aggregate before enqueue, while a conforming adapter also deduplicates the same key.

The enqueue call remains inside the repository command callback. A rejected enqueue appends a `transfer.failed` request audit fact with an enqueue-specific failure code, throws, and rolls back lock/step/start or resume-request persistence; no success audit is emitted and the rejecting port must not have accepted a partial job. FUMA-023 supplies only this port contract. FUMA-024 must provide the durable FUMA-009 adapter and transactional deployment composition; this document does not claim those adapters or handlers are registered or mounted.

`createTransferSagaJobHandlers` calls `deriveFumaJobContext` before repository access or effects. It accepts only the site-context branch and checks persisted source ancestry, manifest identity, profile, `site.settings.write`, and the trusted allow/deny summary. The FUMA-021 authority lookup receives only persisted job selectors and never receives payload JSON.

The worker checks cooperative FUMA-009 cancellation before saga execution. A cancelled delivery writes no transfer transition or external effect. Persisted transfer cancellation remains a separate staff command and is accepted only before base ownership may have started.

## Audit and correlation

`createTransferSagaJobHandlers` calls `AuditService.recordJob` through `TransferSagaJobAuditPort`. Every attempt appends `job.started`, then one of `job.succeeded`, `job.failed`, or `job.cancelled`. FUMA-022 derives these authoritative fields from the frozen job context:

- exact platform/organization/workspace/site scope;
- internal job actor;
- durable job and run IDs;
- per-claim execution request ID;
- trusted originating request ID.

Audit metadata contains the job kind, attempt, transfer ID, transition, or failure code. Payload actor/scope/correlation claims cannot reach the audit boundary. Retries append new facts; no prior event is updated. Request-side `transfer.proposed`, `transfer.confirmed`, `transfer.started`, `transfer.resumed`, and `transfer.cancelled` facts remain owned by `TransferService` and use `recordRequest`.

## FUMA-024 registration boundary

`src/core/fuma/launchProfiles.ts` contributes exactly one descriptor for each persisted transfer kind through the shared `site.settings` capability:

```text
job.transfer-execute    → transfer.execute
job.transfer-resume     → transfer.resume
job.transfer-compensate → transfer.compensate
```

Each descriptor uses site-scoped `site.settings.write`. `composeTransferSagaJobRegistrations(...)` in `server/fuma/transfers/registrations.ts` resolves those descriptors from `ComposedProductProfile.jobs`, pairs them with `createTransferSagaJobHandlers(...)`, and rejects missing, duplicate, renamed, or permission-substituted entries. `transferSagaJobHandlerMap(...)` returns a neutral FUMA-009 map only after all three kinds are complete.

`createRegisteredTransferStepRegistry(...)` requires `transfer.base-ownership`, `transfer.tenant-objects-copy`, and `transfer.object-ownership-policy` as one mandatory chain. Copy and policy are not profile capability contributions; Website, Publication, injected profiles, and later profiles receive them identically. Capability composition still selects domain-specific transfer steps and the three durable job descriptors without profile-ID decisions.

These descriptors do not mount a production root. Production `TransferManifestAuthority`, command/continuation enqueue adapters, object policy persistence adapter, repository/context/audit construction, and worker-root ownership remain outside this lane until their complete composition exists. An unregistered or unmounted handler remains non-executable authority; payload flags and synthetic contexts cannot bypass FUMA-021 denial.

## Fault and demo coverage

`src/__tests__/fuma/transferService.test.ts` covers caller-manifest tampering against server capture, detached trusted persistence, proposal-time eligibility denial, start-time eligibility recheck with no lock/step/job partial state, malformed or control-plane-enriched result rejection, caller bypass resistance, exact destination-workspace confirmation authority, all selected contribution permissions, narrow idempotent execute/resume enqueues, and audited rollback on enqueue rejection.

`src/__tests__/fuma/transferSagaFaultInjection.test.ts` supplies a rollback-capable repository and atomic fake effect registry. Its cases cover:

- authority-field payload substitutions;
- faults before/after pending-to-running persistence;
- process death before/after the base effect;
- receipt-write failure followed by duplicate replay;
- cancellation before ownership release;
- explicit resume for applied and not-applied interruptions;
- stale ancestry/fence rejection;
- registered downstream failure;
- reverse downstream/base compensation;
- compensation receipt persistence faults;
- source-or-fully-receipted-destination visibility, never a partial projection.

`src/__tests__/fuma/transferSagaDemo.test.ts` is the inspectable scenario. It moves base ownership, kills a registered downstream fake after its effect, inspects the immutable manifest, base/downstream receipts, and active lock, resumes by verification, fails finalization, compensates final/downstream/base in reverse order, and asserts final source ownership plus released lock.

`src/__tests__/fuma/objectCopyTransferStep.test.ts` covers checksummed manifests, source/destination scope derivation, death before and after every object intent/copy/receipt boundary, duplicate-safe resume, checksum mismatch, stale fences, identical-object rebind, orphan cleanup, source-first reverse ordering, and no partial/cross-tenant exposure. `src/__tests__/fuma/objectOwnershipPolicyTransferStep.test.ts` covers exact source-to-destination prefix replacement, complete manifests, an atomic manifest race, stale fences, duplicate apply/verify, receipt substitution, and source-first compensation. `src/__tests__/fuma/transferRegistrationComposition.test.ts` covers Website, Publication, and injected-profile composition plus missing, duplicate, and tampered job descriptors.

## Acceptance gates

Migrations `000007_audit_history`, `000008_transfer_saga`, and `000009_tenant_keys` are finalized in strict source order from `hostedMigrationChecksum(...)`; `000009` is now included in the runner's checksum-finalized prefix. The hosted manifest continues to reject any finalized migration after a future sentinel, preventing out-of-order acceptance.

The FUMA-023 focused gates cover contracts, lifecycle/storage triggers, service commands, server-owned eligibility, deterministic step composition, transactional base ownership, trusted durable-job authority, ordered retries, race exactness, process death, resume, reverse compensation, transfer/job audit facts, and structural jobs-only/control-plane boundaries:

```sh
bun test src/__tests__/fuma/transferContracts.test.ts \
  src/__tests__/fuma/transferStepRegistry.test.ts \
  src/__tests__/fuma/baseOwnershipTransferStep.test.ts \
  src/__tests__/fuma/postgresBaseOwnershipAdapter.test.ts \
  src/__tests__/fuma/transferService.test.ts \
  src/__tests__/fuma/transferSagaFaultInjection.test.ts \
  src/__tests__/fuma/transferSagaDemo.test.ts \
  src/__tests__/fuma/transferMigration.test.ts \
  src/__tests__/architecture/fuma-transfer-boundaries.test.ts
bun test
bun run build
bun run lint
```

The downstream FUMA-024 object-copy, ownership-policy, tenant-key, and registration suites remain separately owned acceptance surfaces. They do not weaken the FUMA-023 rule that only complete, mounted durable-job composition is executable.

## Forbidden patterns

- Persisting caller-supplied profile, capability overrides/IDs, resources, collaborator policy, checksum, or capture time without an exact TypeBox-validated `TransferManifestAuthority` capture from server-owned state.
- Accepting a manifest capture that does not verify the exact source site and destination workspace, or persisting an authority-owned object without detaching it.
- Accepting caller-supplied eligibility, skipping the proposal/start eligibility checks, or persisting eligibility/control-plane facts into transfer state, receipts, jobs, or audit metadata.
- Moving platform-internal grants, entitlements, payment/contract identity, or control-plane billing authority through the manifest, base adapter, collaborator intent, or any transfer effect.
- Putting actor, tenant ancestry, profile, capability, permission, request/run correlation, or fence authority in a transfer job payload.
- Calling `TransferSagaExecutor` or a step handler from an HTTP/request/service path instead of a claimed durable transfer job.
- Calling a step before loading the persisted aggregate and checking exact trusted source ancestry plus active lock fence.
- Mutating ownership or collaborator intent before the current profile and exact capability overrides match the immutable manifest snapshot.
- Looping over multiple forward or reverse effects in one durable job claim.
- Treating Redis delivery, job payload, a bare site ID, or a bare transfer ID as ownership authority.
- Making external effects without transfer/lock/fence idempotency and `verify` support.
- Marking an interrupted effect failed without verification, or retrying it under a new fence without rejecting the old fence.
- Applying collaborator membership inside the base ownership mutation.
- Moving content, keys, media, objects, redirects, or settings through `BaseOwnershipAdapter`.
- Copying from caller-supplied scopes, accepting a mismatched immutable destination, switching visibility inside the copy lane, or deleting a rebound pre-existing object during compensation.
- Switching object authorization before an atomic exact source/destination manifest comparison, authorizing both prefixes, or deleting destination copies before source policy restoration.
- Releasing the transfer lock before all forward receipts complete or reverse compensation reaches a terminal state.
- Registering transfer handlers through Website/Publication conditionals instead of capability contributions.
- Mounting incomplete transfer adapters in a production worker root or bypassing FUMA-021 denial with payload authority.

## Related

- `docs/reference/fuma-object-ownership-transfer.md` — exact-prefix policy switch, complete manifest gate, and composed job descriptors.
- `docs/reference/fuma-durable-jobs.md` — claim fences, retries, cancellation, effect receipts, and Redis/PostgreSQL responsibilities.
- `docs/reference/fuma-request-context.md` — trusted internal-job derivation and correlation.
- `docs/reference/fuma-audit-history.md` — append-only transfer/job facts and exact-scope provenance.
- `docs/reference/fuma-platform-architecture.md` — ownership hierarchy, profile composition, and hosted PostgreSQL policy.
- Source-of-truth transfer files: `server/fuma/transfers/`
- Hosted schema: `server/fuma/db/migrations/000008_transfer_saga.ts`
- Focused tests: `src/__tests__/fuma/transferService.test.ts`, `src/__tests__/fuma/transferSagaFaultInjection.test.ts`, `src/__tests__/fuma/transferSagaDemo.test.ts`, `src/__tests__/fuma/objectCopyTransferStep.test.ts`, `src/__tests__/fuma/objectOwnershipPolicyTransferStep.test.ts`, `src/__tests__/fuma/transferRegistrationComposition.test.ts`

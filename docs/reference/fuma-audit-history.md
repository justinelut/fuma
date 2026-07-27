# Fuma Scoped Audit History

This reference defines the FUMA-022 hosted audit event contract, append-only PostgreSQL storage, trusted recording boundary, exact-scope read model, and reusable admin history UI.

Hosted audit history records security and operational facts without accepting tenant authority or secrets from untrusted input. Its source of truth is `server/fuma/audit/`; the read-only presentation is `src/admin/fuma/FumaAuditHistory.tsx`.

---

## TL;DR

- `server/fuma/audit/contracts.ts` defines one closed TypeBox-derived record with complete tenant ancestry, staff or internal-job actors, request or job correlation, three outcomes, bounded metadata, and an ISO timestamp.
- Migration `server/fuma/db/migrations/000007_audit_history.ts` creates `fuma_audit_history` as PostgreSQL-only, tenant-qualified, and append-only. Database triggers reject both `UPDATE` and `DELETE`.
- `server/fuma/audit/catalog.ts` allowlists every action and its required metadata; `server/fuma/audit/redaction.ts` rejects unsafe JSON and recursively replaces sensitive values before persistence.
- `server/fuma/audit/service.ts` derives actor, impersonator, scope, and correlation only from frozen FUMA-021 request/job contexts.
- `server/fuma/audit/repository.ts` exposes only `append` and `list`. Every listing binds one exact scope and all ancestry coordinates; broader scopes never include descendants.
- `src/admin/fuma/FumaAuditHistory.tsx` is presentation-only. It receives already validated `CreatedAuditEvent` records, filters them again at the exact component scope, and performs no fetch.
- The UI renders action, outcome, actor and impersonator, scoped resource, request/job provenance, safe metadata, and timestamp, with accessible loading, empty, and error states.
- Migration `000007_audit_history` is checksum-finalized from its SQL through `hostedMigrationChecksum`; focused migration coverage also validates the complete immutable hosted manifest while later sentinel migrations remain unapplied.

## Event shape

`CreatedAuditEventSchema` in `server/fuma/audit/contracts.ts` is the canonical persisted read model:

```ts
type CreatedAuditEvent = Readonly<{
  id: string
  action: AuditAction
  scope: AuditTenantScope
  actor: AuditActor
  correlation: AuditCorrelation
  outcome: 'success' | 'failure' | 'denied'
  metadata: AuditMetadata
  createdAt: string
}>
```

The union members carry these invariants:

| Field | Shape | Invariant |
|---|---|---|
| `scope` | `platform`, `organization`, `workspace`, or `site` | Every narrower branch repeats its complete `platformId → organizationId → workspaceId → siteId` ancestry. |
| `actor` | `staff` or `internal-job` | Staff includes user/session and nullable distinct impersonator. Jobs include durable job/run IDs. |
| `correlation` | `request` or `job` | Staff uses request correlation. A job repeats execution request, job, and run IDs and may include the trusted originating request. |
| `outcome` | `success`, `failure`, or `denied` | The vocabulary is closed; consumers do not infer an outcome from action names. |
| `metadata` | bounded recursive JSON object | Keys and values are validated and redacted before repository append. |
| `createdAt` | ISO timestamp with timezone | The service clock creates it; PostgreSQL stores it as `timestamptz`. |

`assertCreatedAuditEvent` also checks cross-field actor/correlation and impersonation rules. The repository validates mapped database rows with that same contract before returning deeply frozen records.

## PostgreSQL schema and append-only enforcement

Migration `server/fuma/db/migrations/000007_audit_history.ts` creates one domain table, `fuma_audit_history`. `server/fuma/audit/schemaManifest.ts` names the table, authority dependencies, index set, outcomes, and mutation policy.

The primary key is `(platform_id, id)`. Organization, workspace, site, actor, impersonator, and durable-job identifiers are immutable historical snapshots derived from trusted FUMA-021 context. They intentionally do not carry foreign keys to mutable authority rows: later site transfer, staff deletion, or job retention must neither rewrite history nor be blocked by it. Database checks enforce:

- exactly the nullable ancestry required by `scope_kind`;
- non-empty IDs wherever an ID is present;
- staff actors are request-only: request ID is required while originating-request, durable-job, and run IDs are null;
- internal-job actors require request, durable-job, and run IDs while staff/session/impersonator columns are null;
- a distinct staff impersonator;
- request or job correlation on every row;
- originating request IDs only on job-correlated rows;
- a JSON object in `metadata_json`.

Append-only behavior is enforced twice:

1. `PostgresAuditRepository` in `server/fuma/audit/repository.ts` publishes only `append` and `list`; it has no update or delete method.
2. PostgreSQL function `fuma_audit_history_reject_mutation` is attached through statement-level `BEFORE UPDATE` and `BEFORE DELETE` triggers. Direct SQL that bypasses the repository still fails with SQLSTATE `55000`.

Corrections are new events. Existing audit facts are never rewritten or removed. Historical IDs stay denormalized in the append-only row, so authority deletion or site transfer cannot erase, cascade, rewrite, or become blocked by prior history.

## Action catalog and metadata redaction

`FUMA_AUDIT_ACTIONS` in `server/fuma/audit/contracts.ts` is closed. `FUMA_AUDIT_EVENT_CATALOG` in `server/fuma/audit/catalog.ts` supplies exactly one declarative entry for every action:

```ts
type AuditEventCatalogEntry = Readonly<{
  action: AuditAction
  category: 'auth' | 'access' | 'permission' | 'context' | 'job'
    | 'organization' | 'workspace' | 'site' | 'transfer'
  sensitivity: 'tenant' | 'privileged' | 'security'
  requiredMetadataKeys: readonly string[]
}>
```

Catalog construction fails closed on malformed entries, duplicate actions, normalized collisions, category mismatches, duplicate required keys, missing actions, and unknown actions. `AuditService` performs catalog lookup before recording.

`redactAuditMetadata` in `server/fuma/audit/redaction.ts` runs before repository append. It accepts plain JSON data only and rejects accessors, custom prototypes, sparse/custom arrays, symbols, functions, bigint, non-finite numbers, cycles, and limit violations. Limits cover depth, property count, array length, node count, string length, and serialized bytes.

Key matching is normalization-resistant and recursive. Secret, password/passwd, token/API-key, cookie/authorization, session, OTP/MFA, private-key, request-body, and payload families become the literal storage marker `[REDACTED]`, including inside nested objects and arrays. Required safe metadata remains available for forensic use. The result is deterministic, detached, and deeply frozen.

The UI never presents `[REDACTED]` as a value. `MetadataValue` in `src/admin/fuma/FumaAuditHistory.tsx` replaces that known marker with a muted `Redacted` badge while continuing to render neighboring safe values. React text escaping remains the output boundary; metadata is never injected as HTML.

## Trusted request and job integration

`AuditService` in `server/fuma/audit/service.ts` has two recording entries:

- `recordRequest` consumes a frozen `FumaRequestContext` from `server/fuma/context/requestContext.ts`;
- `recordJob` consumes a frozen `FumaJobContext` from `server/fuma/context/jobContext.ts`.

Callers provide only action, target level, outcome, and metadata. The service derives the security-sensitive fields:

```text
trusted context
  → actor + optional impersonator
  → exact target ancestry
  → execution request correlation
  → optional originating request + durable job/run correlation
  → catalog lookup + metadata redaction
  → append-only repository
```

Request headers, route parameters, request bodies, and durable job payloads do not supply actor, tenant, profile, permission, or correlation authority at this boundary. Internal jobs cannot emit platform-scoped events because persisted job correlation requires organization ancestry. Organization-only job contexts cannot claim workspace or site targets.

The service intentionally does not catch append failures. Audit durability is part of the operation boundary; a failed audit write is not silently converted into successful unaudited work.

For job events, `requestId` is the deterministic execution request from the durable fence. `originatingRequestId` is a separate trusted link to the request that enqueued the work. The UI displays both, plus durable job and run IDs, rather than collapsing provenance into one ambiguous identifier.

## Exact scoped listings

`AuditListFilterSchema` in `server/fuma/audit/contracts.ts` requires `scope`. Optional filters cover actions, actor, outcomes, request/job IDs, time bounds, cursor, and a bounded limit.

`PostgresAuditRepository.list` builds one exact scope predicate:

| Requested scope | Required match |
|---|---|
| Platform | Same `platform_id`, `scope_kind = 'platform'`, and null organization/workspace/site. |
| Organization | Same platform and organization, `scope_kind = 'organization'`, and null workspace/site. |
| Workspace | Same platform, organization, and workspace, `scope_kind = 'workspace'`, and null site. |
| Site | Same platform, organization, workspace, and site with `scope_kind = 'site'`. |

This is not a descendant query. An organization listing does not include workspace or site events. Cursor lookup repeats the same complete predicate, so an ID from another scope cannot steer pagination. Request filters match either execution or originating request IDs; job filters remain inside the already-bound tenant scope. Results order by `created_at DESC, id`.

`FumaAuditHistory` repeats exact-scope equality before rendering. This defense prevents accidental record mixing if a future route passes a combined in-memory collection. It is a UI containment check, not a replacement for repository authorization.

## Read-only UI

Import the component through the admin Fuma barrel:

```tsx
import { FumaAuditHistory } from '@admin/fuma'

<FumaAuditHistory
  scope={validatedFilter.scope}
  records={validatedRecords}
  loading={loading}
  error={errorMessage}
/>
```

The props are defined in `src/admin/fuma/FumaAuditHistory.tsx`:

```ts
interface FumaAuditHistoryProps {
  scope: FumaAuditHistoryScope
  records: readonly FumaAuditHistoryRecord[]
  loading?: boolean
  error?: string | null
  title?: string
}
```

There is no fetch, mutation, pagination control, or route assumption in this component. A data owner supplies records only after validating the server response against the hosted audit contract.

The component uses repository primitives:

- `DataTable` for the read-only record grid;
- the existing admin `Badge` wrapper over `TagPill` for type, scope, outcome, and redaction labels;
- `Skeleton` for table-shaped loading rows.

The scope summary and every resource cell show full available ancestry. Rows show action, closed outcome, effective actor, session or job/run identity, impersonator when present, request/job provenance, recursive safe metadata, and a semantic `<time dateTime>` timestamp. Loading uses `aria-busy`; empty uses `role="status"`; failures use `role="alert"`; table, scope, correlation, and outcome surfaces have accessible labels.

Focused UI coverage is in `src/__tests__/admin/fumaAuditHistory.test.tsx`. It exercises exact ancestry display, cross-scope containment, impersonation, request-to-job correlation, all outcomes, nested redaction, and loading/empty/error states.

## Threat model

The audit boundary assumes these inputs are hostile or collision-prone:

- route/body/header tenant and actor claims;
- job payload authority or correlation claims;
- IDs that look globally unique but collide across organizations;
- unknown action names or catalog key collisions;
- metadata accessors, non-JSON values, cycles, oversized values, and secret-key spelling variants;
- cursors, request IDs, or job IDs belonging to another scope;
- a combined client collection containing records from several tenant scopes;
- direct SQL attempting to mutate or delete history.

Controls are layered: TypeBox contracts, frozen FUMA-021 authority, catalog closure, recursive redaction, immutable historical identity snapshots with strict ancestry-shape checks, exact repository predicates, append-only database triggers, row revalidation, and final component-boundary scope equality. The UI does not establish authorization and must never receive raw database rows or unredacted metadata.

## FUMA-023 handoff

FUMA-023 site-transfer orchestration uses the transfer actions already closed in `server/fuma/audit/catalog.ts`: proposed, confirmed, started, step completed, failed, resumed, compensated, completed, and cancelled.

The handoff rules are:

- request-side proposal/confirmation records use `AuditService.recordRequest` with the trusted effective staff actor and impersonator;
- durable transfer execution records use `AuditService.recordJob`, preserving the originating request separately from execution request/job/run IDs;
- required transfer metadata such as `transferId`, destination organization, confirmation side, step, failure, and reason codes goes through the catalog and redactor;
- retries, compensation, and terminal results append new facts rather than editing prior events;
- FUMA-023 route/data integration may mount `FumaAuditHistory`, but it passes only a validated exact-scope listing and does not add fetching to the reusable component.

FUMA-022 does not implement transfer state transitions or transfer authorization. It supplies the durable vocabulary and provenance surface those operations consume.

## Acceptance gates

Migration `000007_audit_history` is finalized in `server/fuma/db/migrations/index.ts` with the digest generated by `hostedMigrationChecksum(auditHistoryMigration.sql)`. Its SQL was not rewritten to fit the checksum. The hosted manifest permits only a contiguous trailing sentinel suffix, so later authored migrations cannot become runnable until their checksums are finalized in source order.

The maintained focused gates cover audit contracts, redaction, append/list-only repository behavior, trusted request/job context integration, exact-scope UI containment, additive SQL, append-only triggers, and checksum equality:

```sh
bun test src/__tests__/fuma/auditContracts.test.ts \
  src/__tests__/fuma/auditRedaction.test.ts \
  src/__tests__/fuma/auditHistoryMigration.test.ts \
  src/__tests__/fuma/auditRepository.test.ts \
  src/__tests__/fuma/auditContextIntegration.test.ts \
  src/__tests__/admin/fumaAuditHistory.test.tsx
bun test
bun run build
bun run lint
```

Any future edit to the finalized migration fails immutable manifest validation. Schema changes must use a new additive hosted migration.

## Forbidden patterns

- Accepting actor, impersonator, tenant ancestry, or correlation IDs from request bodies, headers, route payloads, or job payload JSON.
- Recording an action absent from `FUMA_AUDIT_EVENT_CATALOG` or bypassing required metadata/redaction.
- Persisting raw credentials, secrets, authorization headers, cookies, session material, OTP/MFA values, request bodies, or payloads.
- Adding repository update/delete methods or disabling the database mutation triggers.
- Listing by organization/workspace/site ID without every available ancestor and exact `scope_kind`.
- Treating a broader scope as an implicit descendant feed.
- Reusing an out-of-scope cursor or correlation result.
- Rendering raw database rows, unvalidated metadata, `[REDACTED]` as if it were a secret value, or HTML from metadata.
- Adding fetch or mutation behavior to `FumaAuditHistory`; route/data ownership remains outside the reusable view.

## Related

- `docs/reference/fuma-request-context.md` — trusted staff and internal-job authority, including originating-request semantics.
- `docs/reference/fuma-durable-jobs.md` — durable claims, fences, retries, and job/run identity.
- `docs/reference/fuma-platform-architecture.md` — tenant ancestry and PostgreSQL-only hosted policy.
- `docs/reference/fuma-hosted-migrations-transition.md` — hosted migration checksums and additive migration policy.
- Source-of-truth contracts/catalog/redaction: `server/fuma/audit/contracts.ts`, `server/fuma/audit/catalog.ts`, `server/fuma/audit/redaction.ts`
- Source-of-truth storage/integration: `server/fuma/db/migrations/000007_audit_history.ts`, `server/fuma/audit/repository.ts`, `server/fuma/audit/service.ts`
- Read-only UI: `src/admin/fuma/FumaAuditHistory.tsx`, `src/admin/fuma/FumaAuditHistory.module.css`
- Focused tests: `src/__tests__/fuma/auditHistoryMigration.test.ts`, `src/__tests__/fuma/auditRepository.test.ts`, `src/__tests__/fuma/auditContextIntegration.test.ts`, `src/__tests__/admin/fumaAuditHistory.test.tsx`

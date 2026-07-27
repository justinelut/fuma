# Fuma Tenant Keys and Resource Inventory

This reference defines the stable owner-key sidecars and complete current resource inventory introduced by FUMA-024.

A tenant owner key is a stable site identity that carries the current `platform → organization → workspace → site` ancestry without changing historical Instatic tables. Direct row and object identities map to that key; resumable receipts must reconcile legacy IDs, counts, hashes, and foreign-key evidence before a backfill is complete.

---

## TL;DR

- Migration source: `server/fuma/db/migrations/000009_tenant_keys.ts`.
- Schema manifest: `server/fuma/tenancy/schemaManifest.ts`.
- Table/owner-key inventory source: `server/fuma/tenancy/inventory.ts`.
- Canonical object-class inventory: `server/fuma/tenantObjects/inventory.ts`.
- TypeBox boundary contracts: `server/fuma/tenancy/contracts.ts`.
- Existing historical tables are not altered. `000009` creates four additive sidecar tables.
- Every persisted site row or object class has a required owner-key mapping. Embedded classes follow their parent; transient classes are not persisted.
- The inventory covers content, media, publishing, plugins, AI/MCP, forms, and import/export state. Platform authority and immutable operational history are explicitly excluded from site movement.
- Backfill completion requires equal source/mapped counts, equal non-null content hashes, and fully reconciled FK evidence.
- `000009_tenant_keys` is finalized after immutable `000007`/`000008` history with checksum `43e27fb6a3d46bb76e9e47be448fa58a6bada9aad86e7a4451f49daec566964a` and is part of `runnableHostedMigrations`.

## Schema

`server/fuma/db/migrations/000009_tenant_keys.ts` adds only these tables:

| Table | Responsibility |
|---|---|
| `fuma_tenant_owner_keys` | Stable `owner_key` plus current platform/organization/workspace/site ancestry, transfer fence, and generation. |
| `fuma_tenant_resource_owners` | Sidecar mapping from a preserved legacy table/object identity to one qualified owner key. |
| `fuma_tenant_key_backfills` | One resumable inventory-versioned run per owner key and source fingerprint. |
| `fuma_tenant_key_backfill_receipts` | Per-class cursor, count, hash, and FK evidence used to resume and prove completion. |

The migration contains no `ALTER TABLE`, destructive SQL, source-row rewrite, or profile-specific column. Existing IDs remain in their source tables and are copied into `legacy_id` plus `legacy_identity_json` evidence.

### Stable owner key

`fuma_tenant_owner_keys` uses `(platform_id, owner_key)` as its primary key. The same key survives a site ownership transfer while its organization/workspace ancestry changes under a transfer fence.

The directory enforces one active coordinate through:

```sql
unique (platform_id, organization_id, workspace_id, site_id)
```

Every child mapping references the complete qualified tuple:

```sql
foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)
references fuma_tenant_owner_keys(
  platform_id, owner_key, organization_id, workspace_id, site_id
)
on update cascade
on delete restrict
```

The update cascade is deliberate: changing the directory's mutable organization/workspace/site ancestry atomically requalifies existing resource mappings and backfill runs while the `owner_key` itself remains stable.

### Resource mappings

`fuma_tenant_resource_owners` has two persisted resource kinds:

- `table-row` — preserves the source table, canonical legacy ID, and complete key object. `object_key` and `size_bytes` are null.
- `object` — additionally requires a physical/logical object key, 64-character SHA-256 hash, and non-negative byte count.

The primary key is qualified by `owner_key`:

```sql
primary key (platform_id, owner_key, class_id, legacy_id)
```

This permits two sites to preserve the same legacy row ID without collision. Organization-, workspace-, and site-qualified indexes support narrowing at every tenant level. A partial site-qualified unique object-key index prevents two mapped object classes from claiming the same object path in one site.

## Inventory

`TENANT_RESOURCE_INVENTORY` in `server/fuma/tenancy/inventory.ts` is the current catalog. It parses through `TenantInventorySchema` and then receives semantic validation from `validateTenantResourceInventory`.

| Domain | Direct table classes | Embedded/transient metadata | Canonical object classes |
|---|---|---|---|
| Site | `site`, `site_sync_state`, `audit_events` | Object integrity sidecar metadata | Integrity metadata follows each parent object. |
| Content | `data_tables`, `data_rows`, `data_row_versions`, `data_row_redirects` | Page trees and content fields stay in their parent row/version. | `content-revision`. |
| Media | Assets, folders, memberships, smart folders, usage refs, adapter/delegate elections | Variant metadata remains in `media_assets.variants_json`. | `media`. |
| Publish | `site_snapshots`, `published_runtime_assets` | Generated route and bundle metadata | `publish-release`. |
| Plugins | Installations, records, crashes, schedules/runs, encrypted secrets | Manifest/settings JSON remain in installation rows. | `plugin-artifact`, `plugin-installation-artifact`. |
| AI/MCP | Credentials, defaults, conversations, messages, connectors, shared model pricing | Tool/message payloads remain in parent JSON/text columns. | `ai-artifact`, `mcp-artifact`. |
| Forms | No duplicate form tables | Definitions live in page-tree cells; submissions are ordinary `data_rows`; challenges are transient. | `form-attachment`. |
| Imports/exports | Legacy import run/table receipts | CMS bundle manifests and site import plans are transient. | `import-artifact`, `export-artifact`; staging/download wrappers remain transient. |

The object rows in `TENANT_RESOURCE_INVENTORY` are generated from `TENANT_OBJECT_CLASS_INVENTORY` in `server/fuma/tenantObjects/inventory.ts`. Each class therefore has one canonical logical root and metadata contract; the owner-key catalog adds only domain, FK-evidence, and mapping policy.

### Mapping policies

Each inventory entry has one mapping policy:

| Policy | Meaning |
|---|---|
| `required` | A persisted site row/object receives its own `fuma_tenant_resource_owners` row. |
| `through-parent` | Embedded metadata or an integrity sidecar moves only with its registered parent class. |
| `none` | User/platform authority or transient state does not receive a site owner mapping. |

`validateTenantResourceInventory` rejects a persisted site row/object without `required`, an unknown parent, an unknown FK target, duplicate class IDs, omitted required domains, or additional fields such as a profile ID.

### Transfer policies

The catalog records behavior rather than branching on Website or Publication:

- `rebind` — retain the row and legacy identity while changing qualified ownership.
- `copy-rebind` — copy immutable object bytes and metadata, verify the hash, then rebind.
- `regenerate` — published or reverse-index output is recreated from source authority.
- `deferred-domain` — encrypted/plugin/AI/MCP behavior remains under its owning later domain handler; a generic move must not guess secret or runtime policy.
- `retain` — user/platform authority or immutable history remains with its current authority.
- `through-parent` — embedded metadata follows its parent class.
- `ephemeral` — transient challenges, plans, staging bytes, and downloadable bundles are not transferred.

`server/fuma/tenantObjects/` owns object manifest, metadata, policy, and receipt contracts, and the owner-key inventory projects its canonical class list. `server/fuma/transfers/objectCopyStep.ts` and `objectOwnershipPolicyStep.ts` enforce mandatory all-class copy and verified policy mechanics without redefining owner-key table identities. `PostgresBaseOwnershipAdapter` rebinds the stable owner-key ancestry and `fuma_sites` row in one transaction; qualified resource/backfill sidecars follow through `ON UPDATE CASCADE`, while the public base adapter exposes no independent tenant-key mutation API.

## Resumable backfill evidence

A backfill run is identified by `(platform_id, id)` and deduplicated by:

```sql
unique (platform_id, owner_key, source_fingerprint, inventory_version)
```

Each class receipt records:

- `resume_cursor_json` — the last durable class-specific position;
- `source_count` and `mapped_count`;
- `source_content_hash` and `mapped_content_hash`;
- `source_foreign_key_count` and `valid_foreign_key_count`;
- `foreign_key_evidence_json` — individual source/target class and column checks;
- structured `failure_json` for a failed but resumable attempt.

`validateTenantKeyBackfillReceipt` in `server/fuma/tenancy/contracts.ts` is the untyped boundary. A `complete` receipt is accepted only when counts match, hashes match, every FK is valid, and detailed evidence totals reconcile with summary totals. A run cannot be complete until every expected class and resource is complete.

## Control-plane exclusions

`TENANT_INVENTORY_CONTROL_PLANE_EXCLUSIONS` documents resources that are not site-transfer payload:

- identity/security authority such as `users`, sessions, Better Auth tables, and login attempts;
- organization/workspace/site authority tables;
- jobs, append-only hosted audit history, and transfer saga state.

These exclusions do not mean the rows are unscoped. They mean site content/object movement cannot rewrite identity, authority, or durable operational history.

## Forbidden patterns

- Adding organization/workspace/site columns directly to immutable historical Instatic tables.
- Replacing legacy IDs with generated IDs during inventory or backfill.
- Completing a receipt without equal counts, hashes, and FK evidence.
- Treating user credentials, model pricing, jobs, audit history, or transfer state as movable site content.
- Moving an object before its checksum/size metadata is recorded and verified.
- Adding profile IDs or Website/Publication branches to inventory, mapping, persistence, or transfer policy.
- Giving embedded/transient classes direct ownership rows that duplicate their parent or outlive their operation.

## Related

- `docs/reference/fuma-platform-architecture.md` — hierarchy, PostgreSQL hosted policy, and immutable historical migration boundary.
- `docs/reference/fuma-hosted-migrations-transition.md` — hosted migration runner and SQLite transition receipts.
- `docs/reference/fuma-transfer-saga.md` — base ownership transfer, fences, resume, and compensation.
- `docs/reference/fuma-object-storage.md` — tenant-prefixed immutable objects and integrity sidecars.
- Source of truth: `server/fuma/tenancy/`.
- Canonical object classes and manifests: `server/fuma/tenantObjects/`.
- Object transfer behavior: `docs/reference/fuma-object-ownership-transfer.md`.
- Migration: `server/fuma/db/migrations/000009_tenant_keys.ts`.
- Focused tests: `src/__tests__/fuma/tenantKeyMigration.test.ts`, `src/__tests__/fuma/tenantInventory.test.ts`, `src/__tests__/fuma/tenantBackfillContracts.test.ts`.

# Fuma Tenant-Object Ownership Transfer

This reference defines the FUMA-024 copy/rebind and authorization-policy lane used by the site-transfer saga. It covers every registered tenant object class, independent of Website, Publication, or future profile IDs.

## TL;DR

- `server/fuma/tenantObjects/` is the single vocabulary for object classes, inventories, manifests, policy snapshots, copy intents/receipts, progress, rebind, delete, and compensation evidence.
- `transfer.tenant-objects-copy` is mandatory at order `60` after `transfer.base-ownership`.
- `transfer.object-ownership-policy` is mandatory at `Number.MAX_SAFE_INTEGER` and depends directly on `transfer.tenant-objects-copy`.
- Neither step is a capability/profile contribution. `createRegisteredTransferStepRegistry(...)` requires both for Website, Publication, injected profiles, and profiles added later.
- Copy captures a server-owned complete inventory, reconciles it against every object under the source site namespace, and rejects missing, extra, or mismatched objects.
- A durable fenced intent precedes each destination write. A canonical copy receipt follows byte, size, MIME, and SHA-256 verification.
- Policy activation requires a complete canonical copy-progress receipt and atomically persists the source-seal/destination-activate `TenantObjectRebindReceipt`.
- Compensation restores source policy first, then deletes every and only object whose durable disposition is `copy`; pre-existing identical `rebind` objects remain.

## Canonical inventory and manifest

`TENANT_OBJECT_CLASS_INVENTORY` in `server/fuma/tenantObjects/inventory.ts` covers these object classes:

```text
content-revision
form-attachment
media
publish-release
plugin-artifact
plugin-installation-artifact
import-artifact
export-artifact
ai-artifact
mcp-artifact
```

Each class owns one logical root and required metadata fields. `TenantObjectInventoryPort.captureTenantObjectInventory(...)` is server-owned; profile capabilities and caller-supplied transfer resource labels do not select object classes.

Before initializing durable copy state, `objectCopyStep.ts`:

1. validates and canonicalizes the inventory;
2. lists the complete FUMA-008 source site namespace, not a media sub-prefix;
3. requires exact logical key, byte size, MIME, and content SHA-256 equality;
4. rejects extra unclassified objects and missing catalog entries;
5. creates one sorted `TenantObjectManifest` with FUMA-008-derived physical source/destination keys and aggregate checksums.

Physical keys remain evidence. The copy adapter passes only `(tenant scope, logical key)` to `TenantObjectStorage`; callers cannot inject a provider key or alternate prefix.

## Resumable copy/rebind

For every manifest entry, the state port first persists `TenantObjectCopyIntent` under the exact transfer ID, lock ID, fence, manifest checksum, entry descriptor checksum, logical/physical keys, size, MIME, content checksum, and disposition:

- `copy` — no destination object existed; this transfer may create and later delete it;
- `rebind` — an immutable destination object already matched byte-for-byte and must survive compensation.

After destination verification, the state port persists `TenantObjectCopyReceipt`. Completion stores one sorted `TenantObjectCopyProgressReceipt` containing every entry receipt and exact count/byte totals. The transfer-step receipt binds the manifest and progress receipt checksums.

Crash/replay behavior is idempotent:

- death before intent: no attributable destination write exists;
- death after intent but before write: replay performs the missing copy;
- death after write but before receipt: replay verifies the immutable destination and writes the missing receipt without a second object effect;
- death after completion: apply/verify accept only the same manifest, progress, lock, fence, and transfer receipt.

A destination collision with different bytes, size, MIME, or checksum fails closed. Source drift after manifest capture also fails closed.

## Verified policy rebind

`ObjectOwnershipPolicyAdapter` exposes only inspection plus atomic switch/restore operations. Its inspection carries the canonical `TenantObjectManifest`, complete `TenantObjectCopyProgressReceipt`, exact source/destination `TenantObjectPolicySnapshot` pair, and optional `TenantObjectRebindReceipt`.

The policy handler independently validates that copy progress contains every manifest entry. The atomic adapter must re-read the expected manifest/progress checksums before it:

```text
source:      active → sealed
destination: sealed → active
```

The same atomic commit persists `TenantObjectRebindReceipt`, which checksums the complete copy receipt and all four policy snapshots. There is never a dual-authority state. Apply and verify reject a policy effect without that exact canonical rebind receipt.

## Mandatory registration

`createRegisteredTransferStepRegistry(...)` in `server/fuma/transfers/registrations.ts` fails closed unless definitions contain:

```text
transfer.base-ownership
  → transfer.tenant-objects-copy
      → transfer.object-ownership-policy
```

All three are mandatory. Profile capability contributions may add content/design/settings or later domain steps, but cannot select, omit, rename, or reorder the object lane. The retired `transfer.media` and `transfer.object-policy` contribution IDs do not exist in launch profile declarations.

Durable transfer jobs remain capability-composed through `site.settings` job descriptors. This registration is still neutral/unmounted: it does not create an incomplete production worker composition root.

## Stable owner-key ancestry

`PostgresBaseOwnershipAdapter` changes `fuma_tenant_owner_keys` ancestry and the matching `fuma_sites` ownership row inside the same PostgreSQL transaction as collaborator intent. The owner key itself remains stable, its generation/fence advances, and qualified resource/backfill rows follow through `ON UPDATE CASCADE`. A site row cannot become visible under destination ancestry separately from its stable owner-key directory entry; compensation restores both atomically.

The public `BaseOwnershipAdapter` exposes no independent tenant-key, content, object, billing, grant, or payment mutation API.

## Compensation order

The policy step uses maximum order, so reverse execution is:

```text
restore source policy and seal destination
  → remove transfer-created destination copies / preserve rebinds
      → restore base site and stable owner-key ancestry
```

The copy step checks `sourceAuthorized` before cleanup. A crash after delete but before delete-receipt persistence replays as `already-absent`; both outcomes are canonical fenced `TenantObjectDeleteReceipt` evidence. Final compensation binds the ordered delete receipt checksums and original apply receipt. After terminal compensation clears in-progress checkpoints, the durable delete receipts remain and must exactly match the canonical compensation receipt, so terminal replay cannot lose or substitute cleanup evidence.

## Forbidden patterns

- Media-only object IDs, roots, resource checks, or profile contributions.
- Profile-ID decisions in object inventory, copy, policy, registration, or ownership persistence.
- Copying only a configured sub-prefix instead of reconciling the complete source namespace.
- Caller-supplied physical keys, object classes, policy authority, lock, or fence.
- Switching destination policy without complete canonical copy progress and an atomic rebind receipt.
- Authorizing source and destination simultaneously.
- Deleting a `rebind` object or cleaning copies before source policy restoration.
- Updating the site row separately from stable owner-key ancestry.

## Related

- `docs/reference/fuma-tenant-keys.md` — stable owner keys and complete row/object inventory.
- `docs/reference/fuma-object-storage.md` — FUMA-008 immutable storage boundary.
- `docs/reference/fuma-transfer-saga.md` — durable step execution and reverse ordering.
- Source: `server/fuma/tenantObjects/`, `server/fuma/transfers/objectCopyStep.ts`, `server/fuma/transfers/objectOwnershipPolicyStep.ts`, `server/fuma/transfers/registrations.ts`.
- Focused tests: `tenantObjectManifest.test.ts`, `tenantObjectReceipts.test.ts`, `objectCopyTransferStep.test.ts`, `objectOwnershipPolicyTransferStep.test.ts`, `transferRegistrationComposition.test.ts`.

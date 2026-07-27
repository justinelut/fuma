# Fuma object storage contract

FUMA-008 adds the pooled MinIO/S3 object boundary under `server/fuma/objectStorage/`. `server/fuma/transfers/objectCopyStep.ts` and `server/fuma/transfers/objectOwnershipPolicyStep.ts` consume its barrel contracts, but no web, worker, or scheduler composition root mounts the storage or transfer lanes. It adds no schema, migration, package, or runtime-role ownership.

## Tenant keys and immutability

Every operation requires an explicit organization/workspace/site scope. The physical key is deterministic:

```text
organizations/<organizationId>/workspaces/<workspaceId>/sites/<siteId>/objects/<logicalKey>
```

Scope segments and logical path segments use a canonical ASCII identifier policy. Absolute paths, `.`/`..`, empty segments, backslashes, percent encoding, controls, physical `organizations/...` keys, and the internal metadata suffix are rejected before a transport call. Callers never pass physical keys to tenant operations.

`put` and multipart completion are create-only. The real transport signs S3 HTTP requests with `If-None-Match: *`; an existing object fails with `already_exists` instead of being replaced. Mutability belongs in PostgreSQL pointers and metadata, not referenced object bytes. `delete` is explicit and idempotent.

Each data object has an immutable internal sidecar containing its logical key, byte size, trusted MIME, SHA-256, and creation time. `get` rehashes bytes and `head` compares transport size/MIME against the sidecar. Invalid or divergent state fails as `corrupt_object`; it is never silently served.

## Validation and quotas

`ObjectStoragePolicy` defines:

- an exact MIME allowlist;
- maximum object bytes;
- maximum bytes under one full tenant prefix;
- multipart minimum part bytes (5 MiB by default, matching S3);
- maximum signed-URL TTL (300 seconds by default).

The service derives MIME from bytes for PNG, JPEG, GIF, WebP, PDF, ZIP, JSON, UTF-8 text, and generic binary. Claimed and detected MIME must agree. SHA-256 is checked before a single PUT, for every multipart part, and again across the completed multipart object. Quota admission includes active in-process multipart reservations so concurrent requests in one Bun process cannot knowingly over-admit. A future durable metering task remains authoritative for commercial usage accounting.

## Multipart contract

`beginMultipart` reserves the declared byte count and returns a tenant upload session. Parts are contiguous and one-based, each has a declared SHA-256, only the final part may be below the configured minimum, and the sum must equal the declared size. The whole checksum and MIME are verified before completion. Failure aborts staged parts and releases the reservation.

`BunS3ObjectStorageTransport` uses signed S3-compatible HTTP for initiate/upload-part/complete/abort. Completion is conditional, preserving create-only behavior. Bun's native `S3Client` handles reads, HEAD, paginated LIST, deletes, and provider presigning.

## Purpose-limited URLs

`createSignedUrl` issues a short-lived HMAC capability for exactly one tenant key and one purpose:

- `download` → `GET`;
- `preview` → `GET`;
- `metadata` → `HEAD`.

The capability URL points at the configured Fuma access endpoint, not directly at MinIO. A route that is mounted later must call `redeemSignedUrl(url, requiredPurpose)` before redirecting to the returned short-lived provider URL. Redemption validates endpoint, signature, TypeBox payload, tenant key policy, purpose, issue time, expiry, and current object existence. A download token therefore cannot be reused by a preview or metadata handler even when two purposes share an HTTP method.

The signing secret must be independent of MinIO credentials and contain at least 32 bytes. Do not log capability or provider URLs.

## Transfer copy adapter

`TenantObjectCopyTransferAdapter` in `server/fuma/transfers/objectCopyStep.ts` consumes this module's `TenantObjectStorage` barrel contract while all transfer vocabulary comes from `server/fuma/tenantObjects/`. It derives source and destination scopes from the immutable transfer manifest, asks a server-owned inventory port for every canonical object class, lists the complete source site namespace, and rejects any missing, extra, or metadata-mismatched object before creating `TenantObjectManifest`. Physical keys remain derived receipt evidence and provider commands never cross the adapter boundary.

Before each destination write, the injected `ObjectCopyStatePort` stores a fenced canonical `TenantObjectCopyIntent`. Verified results persist `TenantObjectCopyReceipt` and one complete `TenantObjectCopyProgressReceipt`. Replay after provider success but before receipt persistence verifies the immutable destination and records the missing receipt. Compensation records `TenantObjectDeleteReceipt` for every transfer-created copy, preserves identical pre-existing `rebind` objects, and refuses cleanup until the mandatory policy step proves source authorization restored.

The copy step does not expose destination bytes. Mandatory `transfer.object-ownership-policy` depends directly on verified copy progress and atomically persists the canonical `TenantObjectRebindReceipt`; partial destinations remain inaccessible.

## Tests

The deterministic contract uses `FakeObjectStorageTransport`, an injected fake clock, and real integrity/policy code:

```sh
bun test src/__tests__/fuma/objectStorage.test.ts src/__tests__/fuma/objectStorage.real.test.ts
```

The real test is skipped by default. It targets a pre-created disposable MinIO/S3 bucket when explicitly enabled:

```sh
FUMA_OBJECT_STORAGE_CONTRACT=1 \
FUMA_MINIO_ENDPOINT=http://127.0.0.1:9000 \
FUMA_MINIO_ACCESS_KEY_ID=minioadmin \
FUMA_MINIO_SECRET_ACCESS_KEY=minioadmin \
FUMA_MINIO_BUCKET=fuma-contract \
bun test src/__tests__/fuma/objectStorage.real.test.ts
```

Set `FUMA_S3_REGION` for providers that do not use `us-east-1`. The test creates a unique organization prefix, exercises immutable single and multipart writes, read/head/list/delete, tenant separation, and a redeemed provider URL, then removes its objects. It never creates or deletes the bucket.

## Related

- `docs/reference/fuma-object-ownership-transfer.md` — canonical manifest comparison and exact-prefix authorization transfer
- `docs/reference/fuma-transfer-saga.md` — fenced ownership transfer and compensation ordering
- Source of truth: `server/fuma/objectStorage/`, `server/fuma/transfers/objectCopyStep.ts`
- Focused tests: `src/__tests__/fuma/objectStorage.test.ts`, `src/__tests__/fuma/objectStorage.real.test.ts`, `src/__tests__/fuma/objectCopyTransferStep.test.ts`

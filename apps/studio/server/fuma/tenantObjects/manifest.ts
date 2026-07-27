import {
  physicalObjectKey,
  sha256Hex,
  tenantObjectPrefix,
} from '../objectStorage'
import {
  TENANT_OBJECT_POLICY_ACTIONS,
  TenantObjectContractError,
  TenantObjectEntrySchema,
  TenantObjectManifestSchema,
  TenantObjectPolicySnapshotSchema,
  assertTenantObjectSchema,
  type TenantObjectEntry,
  type TenantObjectInventoryItem,
  type TenantObjectManifest,
  type TenantObjectMetadata,
  type TenantObjectPolicyAction,
  type TenantObjectPolicyBinding,
  type TenantObjectPolicySnapshot,
  type TenantObjectScope,
} from './contracts'
import {
  assertTenantObjectInventoryItem,
  assertTenantObjectScope,
  createTenantObjectInventory,
} from './inventory'

const textEncoder = new TextEncoder()
const POLICY_ACTION_ORDER: ReadonlyMap<TenantObjectPolicyAction, number> = new Map(
  TENANT_OBJECT_POLICY_ACTIONS.map((action, index) => [action, index]),
)

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function scopeEquals(left: TenantObjectScope, right: TenantObjectScope): boolean {
  return left.organizationId === right.organizationId
    && left.workspaceId === right.workspaceId
    && left.siteId === right.siteId
}

function scopeIdentity(scope: TenantObjectScope): string {
  return `${scope.organizationId}\u0000${scope.workspaceId}\u0000${scope.siteId}`
}

function copyScope(scope: TenantObjectScope): TenantObjectScope {
  return {
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    siteId: scope.siteId,
  }
}

function checksum(value: string): string {
  return sha256Hex(textEncoder.encode(value))
}

function assertTimestamp(value: string, path: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new TenantObjectContractError(
      'invalid-contract',
      `${path} must be a real timestamp.`,
      path,
    )
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function canonicalMetadata(metadata: TenantObjectMetadata): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata).sort(([left], [right]) => compareText(left, right)),
  )
}

function canonicalActions(actions: readonly TenantObjectPolicyAction[]): TenantObjectPolicyAction[] {
  return [...actions].sort((left, right) => (
    (POLICY_ACTION_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER)
      - (POLICY_ACTION_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER)
  ))
}

function canonicalBindings(
  bindings: readonly TenantObjectPolicyBinding[],
): TenantObjectPolicyBinding[] {
  return bindings.map((binding) => ({
    principalKind: binding.principalKind,
    principalId: binding.principalId,
    actions: canonicalActions(binding.actions),
  })).sort((left, right) => (
    compareText(left.principalKind, right.principalKind)
      || compareText(left.principalId, right.principalId)
      || compareText(left.actions.join(','), right.actions.join(','))
  ))
}

function assertOwnershipMove(
  source: TenantObjectScope,
  destination: TenantObjectScope,
  path: string,
): void {
  assertTenantObjectScope(source, 'manifest.source')
  assertTenantObjectScope(destination, path)
  if (source.siteId !== destination.siteId) {
    throw new TenantObjectContractError(
      'site-identity-mismatch',
      'Object ownership transfer must retain the exact site ID.',
      path,
    )
  }
  if (source.organizationId === destination.organizationId
    && source.workspaceId === destination.workspaceId) {
    throw new TenantObjectContractError(
      'same-owner',
      'Object ownership source and destination must differ.',
      path,
    )
  }
}

export function tenantObjectEntryHashInput(
  entry: Omit<TenantObjectEntry, 'descriptorChecksumSha256'>,
): string {
  return JSON.stringify({
    schemaVersion: 1,
    objectClass: entry.objectClass,
    logicalKey: entry.logicalKey,
    sourcePhysicalKey: entry.sourcePhysicalKey,
    destinationPhysicalKey: entry.destinationPhysicalKey,
    sizeBytes: entry.sizeBytes,
    mimeType: entry.mimeType,
    contentChecksumSha256: entry.contentChecksumSha256,
    metadata: canonicalMetadata(entry.metadata),
  })
}

export function tenantObjectEntriesHashInput(entries: readonly TenantObjectEntry[]): string {
  return JSON.stringify(entries.map((entry) => ({
    logicalKey: entry.logicalKey,
    descriptorChecksumSha256: entry.descriptorChecksumSha256,
  })))
}

export function tenantObjectManifestHashInput(
  manifest: Omit<TenantObjectManifest, 'manifestChecksumSha256'>,
): string {
  return JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    transferId: manifest.transferId,
    source: manifest.source,
    destination: manifest.destination,
    sourcePrefix: manifest.sourcePrefix,
    destinationPrefix: manifest.destinationPrefix,
    entries: manifest.entries.map((entry) => ({
      logicalKey: entry.logicalKey,
      descriptorChecksumSha256: entry.descriptorChecksumSha256,
    })),
    entryCount: manifest.entryCount,
    totalSizeBytes: manifest.totalSizeBytes,
    entriesChecksumSha256: manifest.entriesChecksumSha256,
    capturedAt: manifest.capturedAt,
  })
}

export function createTenantObjectEntry(input: Readonly<{
  source: TenantObjectScope
  destination: TenantObjectScope
  item: TenantObjectInventoryItem
}>): TenantObjectEntry {
  assertOwnershipMove(input.source, input.destination, 'entry.destination')
  assertTenantObjectInventoryItem(input.item)
  const base = {
    objectClass: input.item.objectClass,
    logicalKey: input.item.logicalKey,
    sourcePhysicalKey: physicalObjectKey(input.source, input.item.logicalKey),
    destinationPhysicalKey: physicalObjectKey(input.destination, input.item.logicalKey),
    sizeBytes: input.item.sizeBytes,
    mimeType: input.item.mimeType,
    contentChecksumSha256: input.item.contentChecksumSha256,
    metadata: { ...input.item.metadata },
  } satisfies Omit<TenantObjectEntry, 'descriptorChecksumSha256'>
  const entry: TenantObjectEntry = {
    ...base,
    descriptorChecksumSha256: checksum(tenantObjectEntryHashInput(base)),
  }
  assertTenantObjectEntry(entry, input.source, input.destination)
  return deepFreeze(entry)
}

export function assertTenantObjectEntry(
  value: unknown,
  source: TenantObjectScope,
  destination: TenantObjectScope,
  path = 'entry',
): asserts value is TenantObjectEntry {
  assertTenantObjectSchema(TenantObjectEntrySchema, value, path)
  assertOwnershipMove(source, destination, `${path}.destination`)
  assertTenantObjectInventoryItem({
    objectClass: value.objectClass,
    logicalKey: value.logicalKey,
    sizeBytes: value.sizeBytes,
    mimeType: value.mimeType,
    contentChecksumSha256: value.contentChecksumSha256,
    metadata: value.metadata,
  }, path)
  const expectedSource = physicalObjectKey(source, value.logicalKey)
  const expectedDestination = physicalObjectKey(destination, value.logicalKey)
  if (value.sourcePhysicalKey !== expectedSource) {
    throw new TenantObjectContractError(
      'prefix-substitution',
      'Entry source key must be derived from its exact FUMA-008 source scope.',
      `${path}.sourcePhysicalKey`,
    )
  }
  if (value.destinationPhysicalKey !== expectedDestination
    || value.destinationPhysicalKey === value.sourcePhysicalKey) {
    throw new TenantObjectContractError(
      'prefix-substitution',
      'Entry destination key must be derived from its exact FUMA-008 destination scope.',
      `${path}.destinationPhysicalKey`,
    )
  }
  const { descriptorChecksumSha256: _descriptorChecksumSha256, ...base } = value
  const expectedDescriptorChecksum = checksum(tenantObjectEntryHashInput(base))
  if (value.descriptorChecksumSha256 !== expectedDescriptorChecksum) {
    throw new TenantObjectContractError(
      'object-drift',
      'Object key, class, checksum, byte size, MIME type, or metadata drifted from its descriptor checksum.',
      `${path}.descriptorChecksumSha256`,
    )
  }
}

export function createTenantObjectManifest(input: Readonly<{
  transferId: string
  source: TenantObjectScope
  destination: TenantObjectScope
  inventory: unknown
  capturedAt: string
}>): TenantObjectManifest {
  assertOwnershipMove(input.source, input.destination, 'manifest.destination')
  assertTimestamp(input.capturedAt, 'manifest.capturedAt')
  const inventory = createTenantObjectInventory(input.inventory)
  const entries = inventory.map((item) => createTenantObjectEntry({
    source: input.source,
    destination: input.destination,
    item,
  }))
  const totalSizeBytes = entries.reduce((total, entry) => total + entry.sizeBytes, 0)
  if (!Number.isSafeInteger(totalSizeBytes)) {
    throw new TenantObjectContractError(
      'aggregate-drift',
      'Object manifest total byte size exceeds the safe integer range.',
      'manifest.totalSizeBytes',
    )
  }
  const entriesChecksumSha256 = checksum(tenantObjectEntriesHashInput(entries))
  const base = {
    schemaVersion: 1,
    transferId: input.transferId,
    source: copyScope(input.source),
    destination: copyScope(input.destination),
    sourcePrefix: tenantObjectPrefix(input.source),
    destinationPrefix: tenantObjectPrefix(input.destination),
    entries,
    entryCount: entries.length,
    totalSizeBytes,
    entriesChecksumSha256,
    capturedAt: input.capturedAt,
  } satisfies Omit<TenantObjectManifest, 'manifestChecksumSha256'>
  const manifest: TenantObjectManifest = {
    ...base,
    manifestChecksumSha256: checksum(tenantObjectManifestHashInput(base)),
  }
  assertTenantObjectManifest(manifest)
  return deepFreeze(manifest)
}

export function assertTenantObjectManifest(
  value: unknown,
): asserts value is TenantObjectManifest {
  assertTenantObjectSchema(TenantObjectManifestSchema, value, 'manifest')
  assertOwnershipMove(value.source, value.destination, 'manifest.destination')
  assertTimestamp(value.capturedAt, 'manifest.capturedAt')
  if (value.sourcePrefix !== tenantObjectPrefix(value.source)) {
    throw new TenantObjectContractError(
      'prefix-substitution',
      'Manifest source prefix must exactly match its FUMA-008 source scope.',
      'manifest.sourcePrefix',
    )
  }
  if (value.destinationPrefix !== tenantObjectPrefix(value.destination)) {
    throw new TenantObjectContractError(
      'prefix-substitution',
      'Manifest destination prefix must exactly match its FUMA-008 destination scope.',
      'manifest.destinationPrefix',
    )
  }

  const logicalKeys = new Set<string>()
  const sourceKeys = new Set<string>()
  const destinationKeys = new Set<string>()
  let totalSizeBytes = 0
  for (const [index, entry] of value.entries.entries()) {
    const path = `manifest.entries[${index}]`
    assertTenantObjectEntry(entry, value.source, value.destination, path)
    if (index > 0 && compareText(value.entries[index - 1].logicalKey, entry.logicalKey) >= 0) {
      const duplicate = value.entries[index - 1].logicalKey === entry.logicalKey
      throw new TenantObjectContractError(
        duplicate ? 'duplicate-key' : 'ordering-drift',
        duplicate
          ? `Manifest contains duplicate logical key "${entry.logicalKey}".`
          : 'Manifest entries must use ascending canonical logical-key order.',
        `${path}.logicalKey`,
      )
    }
    if (logicalKeys.has(entry.logicalKey)
      || sourceKeys.has(entry.sourcePhysicalKey)
      || destinationKeys.has(entry.destinationPhysicalKey)) {
      throw new TenantObjectContractError(
        'duplicate-key',
        'Manifest object keys must be globally unique within their side.',
        path,
      )
    }
    logicalKeys.add(entry.logicalKey)
    sourceKeys.add(entry.sourcePhysicalKey)
    destinationKeys.add(entry.destinationPhysicalKey)
    totalSizeBytes += entry.sizeBytes
  }

  if (!Number.isSafeInteger(totalSizeBytes)
    || value.entryCount !== value.entries.length
    || value.totalSizeBytes !== totalSizeBytes
    || value.entriesChecksumSha256 !== checksum(tenantObjectEntriesHashInput(value.entries))) {
    throw new TenantObjectContractError(
      'aggregate-drift',
      'Manifest count, total byte size, or aggregate entry checksum does not match its entries.',
      'manifest.entriesChecksumSha256',
    )
  }
  const { manifestChecksumSha256: _manifestChecksumSha256, ...base } = value
  if (value.manifestChecksumSha256 !== checksum(tenantObjectManifestHashInput(base))) {
    throw new TenantObjectContractError(
      'aggregate-drift',
      'Manifest identity, prefixes, entries, totals, or capture time drifted from its checksum.',
      'manifest.manifestChecksumSha256',
    )
  }
}

export function assertNoTenantObjectManifestCollisions(
  manifests: readonly unknown[],
): asserts manifests is readonly TenantObjectManifest[] {
  const occupied = new Map<string, Readonly<{
    transferId: string
    scope: string
    manifestChecksumSha256: string
  }>>()
  for (const [manifestIndex, candidate] of manifests.entries()) {
    assertTenantObjectManifest(candidate)
    const manifest = candidate
    const sourceScope = scopeIdentity(manifest.source)
    const destinationScope = scopeIdentity(manifest.destination)
    for (const entry of manifest.entries) {
      for (const [physicalKey, scope] of [
        [entry.sourcePhysicalKey, sourceScope],
        [entry.destinationPhysicalKey, destinationScope],
      ] as const) {
        const existing = occupied.get(physicalKey)
        if (existing && (existing.transferId !== manifest.transferId
          || existing.scope !== scope
          || existing.manifestChecksumSha256 !== manifest.manifestChecksumSha256)) {
          throw new TenantObjectContractError(
            'cross-tenant-collision',
            `Physical key "${physicalKey}" is claimed by multiple tenant transfer manifests.`,
            `manifests[${manifestIndex}].entries`,
          )
        }
        occupied.set(physicalKey, {
          transferId: manifest.transferId,
          scope,
          manifestChecksumSha256: manifest.manifestChecksumSha256,
        })
      }
    }
  }
}

export function tenantObjectPolicyHashInput(
  snapshot: Omit<TenantObjectPolicySnapshot, 'policyChecksumSha256'>,
): string {
  return JSON.stringify({
    schemaVersion: snapshot.schemaVersion,
    namespace: snapshot.namespace,
    owner: snapshot.owner,
    prefix: snapshot.prefix,
    state: snapshot.state,
    version: snapshot.version,
    bindings: canonicalBindings(snapshot.bindings),
    capturedAt: snapshot.capturedAt,
  })
}

function assertPolicyPrincipal(
  binding: TenantObjectPolicyBinding,
  owner: TenantObjectScope,
  path: string,
): void {
  const expected = binding.principalKind === 'organization'
    ? owner.organizationId
    : binding.principalKind === 'workspace'
      ? owner.workspaceId
      : binding.principalKind === 'site'
        ? owner.siteId
        : null
  if (expected !== null && binding.principalId !== expected) {
    throw new TenantObjectContractError(
      'policy-drift',
      'Tenant policy binding principal must belong to the exact policy owner ancestry.',
      `${path}.principalId`,
    )
  }
}

export function createTenantObjectPolicySnapshot(input: Readonly<{
  namespace: TenantObjectScope
  owner: TenantObjectScope
  state: 'active' | 'sealed'
  version: number
  bindings: readonly TenantObjectPolicyBinding[]
  capturedAt: string
}>): TenantObjectPolicySnapshot {
  assertTenantObjectScope(input.namespace, 'policy.namespace')
  assertTenantObjectScope(input.owner, 'policy.owner')
  assertTimestamp(input.capturedAt, 'policy.capturedAt')
  const base = {
    schemaVersion: 1,
    namespace: copyScope(input.namespace),
    owner: copyScope(input.owner),
    prefix: tenantObjectPrefix(input.namespace),
    state: input.state,
    version: input.version,
    bindings: canonicalBindings(input.bindings),
    capturedAt: input.capturedAt,
  } satisfies Omit<TenantObjectPolicySnapshot, 'policyChecksumSha256'>
  const snapshot: TenantObjectPolicySnapshot = {
    ...base,
    policyChecksumSha256: checksum(tenantObjectPolicyHashInput(base)),
  }
  assertTenantObjectPolicySnapshot(snapshot)
  return deepFreeze(snapshot)
}

export function assertTenantObjectPolicySnapshot(
  value: unknown,
  path = 'policy',
): asserts value is TenantObjectPolicySnapshot {
  assertTenantObjectSchema(TenantObjectPolicySnapshotSchema, value, path)
  assertTenantObjectScope(value.namespace, `${path}.namespace`)
  assertTenantObjectScope(value.owner, `${path}.owner`)
  assertTimestamp(value.capturedAt, `${path}.capturedAt`)
  if (value.prefix !== tenantObjectPrefix(value.namespace)) {
    throw new TenantObjectContractError(
      'prefix-substitution',
      'Policy prefix must be derived from its exact FUMA-008 namespace.',
      `${path}.prefix`,
    )
  }
  if (!scopeEquals(value.namespace, value.owner)) {
    throw new TenantObjectContractError(
      'policy-drift',
      'Object namespace and policy owner must carry the same exact tenant ancestry.',
      `${path}.owner`,
    )
  }
  if (value.state === 'sealed' && value.bindings.length !== 0) {
    throw new TenantObjectContractError(
      'policy-drift',
      'A sealed object namespace cannot retain access bindings.',
      `${path}.bindings`,
    )
  }
  if (value.state === 'active' && value.bindings.length === 0) {
    throw new TenantObjectContractError(
      'policy-drift',
      'An active object namespace requires at least one explicit access binding.',
      `${path}.bindings`,
    )
  }
  const canonical = canonicalBindings(value.bindings)
  const identities = new Set<string>()
  for (const [index, binding] of value.bindings.entries()) {
    assertPolicyPrincipal(binding, value.owner, `${path}.bindings[${index}]`)
    const identity = `${binding.principalKind}\u0000${binding.principalId}`
    if (identities.has(identity)) {
      throw new TenantObjectContractError(
        'policy-drift',
        'Policy snapshot cannot contain duplicate principals.',
        `${path}.bindings[${index}]`,
      )
    }
    identities.add(identity)
    if (JSON.stringify(binding) !== JSON.stringify(canonical[index])) {
      throw new TenantObjectContractError(
        'ordering-drift',
        'Policy bindings and actions must use canonical order.',
        `${path}.bindings[${index}]`,
      )
    }
  }
  const { policyChecksumSha256: _policyChecksumSha256, ...base } = value
  if (value.policyChecksumSha256 !== checksum(tenantObjectPolicyHashInput(base))) {
    throw new TenantObjectContractError(
      'policy-drift',
      'Policy snapshot drifted from its checksum.',
      `${path}.policyChecksumSha256`,
    )
  }
}

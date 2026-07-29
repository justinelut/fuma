import { Type, Value, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'

const Id = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const Hash = Type.String({ pattern: '^[a-f0-9]{64}$' })
const Version = Type.String({ pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$' })
const Timestamp = Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$' })
const Positive = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
const ScopeProperties = {
  platformId: Id, organizationId: Id, workspaceId: Id, siteId: Id, ownerKey: Id,
  ownerGeneration: Positive,
} as const

export const ArtifactKindSchema = Type.Union([Type.Literal('plugin'), Type.Literal('component-pack')])
export type ArtifactKind = Static<typeof ArtifactKindSchema>
export const ArtifactExecutionPolicySchema = Type.Union([
  Type.Literal('plugin-sandbox-worker'),
  Type.Literal('component-declarative'),
  Type.Literal('component-restricted-client'),
])
export type ArtifactExecutionPolicy = Static<typeof ArtifactExecutionPolicySchema>

export const ArtifactReleaseSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  artifactId: Id,
  kind: ArtifactKindSchema,
  packageId: Id,
  exactVersion: Version,
  executionPolicy: ArtifactExecutionPolicySchema,
  objectKey: Type.String({ minLength: 8, maxLength: 512, pattern: '^artifacts/(?:plugin|component-pack)/[A-Za-z0-9._/-]+$' }),
  mimeType: Type.Union([Type.Literal('application/zip'), Type.Literal('application/json')]),
  contentHashSha256: Hash,
  sizeBytes: Type.Integer({ minimum: 1, maximum: 25 * 1024 * 1024 }),
  permissions: Type.Array(Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-z][a-z0-9.:-]+$' }), { maxItems: 128, uniqueItems: true }),
  provenance: Type.Object({ sourceHashSha256: Hash, lockHashSha256: Hash, builderId: Id }, { additionalProperties: false }),
  createdAt: Timestamp,
}, { additionalProperties: false })
export type ArtifactRelease = Static<typeof ArtifactReleaseSchema>

export const ArtifactSecretSchema = Type.Object({
  keyId: Id,
  ciphertextObjectKey: Type.String({ minLength: 8, maxLength: 512, pattern: '^secrets/artifact-installations/[A-Za-z0-9._/-]+$' }),
  fingerprintSha256: Hash,
}, { additionalProperties: false })
export type ArtifactSecret = Static<typeof ArtifactSecretSchema>

export const ArtifactInstallationSchema = Type.Object({
  ...ScopeProperties,
  installationId: Id,
  artifactId: Id,
  artifactKind: ArtifactKindSchema,
  packageId: Id,
  exactVersion: Version,
  contentHashSha256: Hash,
  executionPolicy: ArtifactExecutionPolicySchema,
  settingsObjectKey: Type.Union([Type.String({ minLength: 8, maxLength: 512, pattern: '^artifact-installations/[A-Za-z0-9._/-]+$' }), Type.Null()]),
  secret: Type.Union([ArtifactSecretSchema, Type.Null()]),
  state: Type.Union([Type.Literal('active'), Type.Literal('suspended'), Type.Literal('crashed'), Type.Literal('transferring')]),
  workerGeneration: Type.Union([Positive, Type.Null()]),
  quota: Type.Object({
    storageBytes: Positive,
    scheduledJobs: Type.Integer({ minimum: 0, maximum: 10_000 }),
    callsPerMinute: Positive,
  }, { additionalProperties: false }),
  previousArtifactId: Type.Union([Id, Type.Null()]),
  version: Positive,
  installedAt: Timestamp,
  updatedAt: Timestamp,
}, { additionalProperties: false })
export type ArtifactInstallation = Static<typeof ArtifactInstallationSchema>

export const ArtifactScheduleSchema = Type.Object({
  ...ScopeProperties,
  installationId: Id,
  scheduleId: Id,
  cronExpression: Type.String({ minLength: 9, maxLength: 128 }),
  handlerName: Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' }),
  enabled: Type.Boolean(),
  nextRunAt: Type.Union([Timestamp, Type.Null()]),
}, { additionalProperties: false })
export type ArtifactSchedule = Static<typeof ArtifactScheduleSchema>

export const ArtifactCrashSchema = Type.Object({
  ...ScopeProperties,
  installationId: Id,
  crashId: Id,
  workerGeneration: Positive,
  errorCode: Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }),
  evidenceHashSha256: Hash,
  occurredAt: Timestamp,
}, { additionalProperties: false })
export type ArtifactCrash = Static<typeof ArtifactCrashSchema>

export const ArtifactStorageUsageSchema = Type.Object({
  ...ScopeProperties,
  installationId: Id,
  objectCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  bytesUsed: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  version: Positive,
}, { additionalProperties: false })
export type ArtifactStorageUsage = Static<typeof ArtifactStorageUsageSchema>

export const ArtifactTransferReceiptSchema = Type.Object({
  transferId: Id,
  installationId: Id,
  artifactId: Id,
  sourceOwnerKey: Id,
  sourceOwnerGeneration: Positive,
  destinationOwnerKey: Id,
  destinationOwnerGeneration: Positive,
  sourceSecretFingerprintSha256: Type.Union([Hash, Type.Null()]),
  destinationSecretFingerprintSha256: Type.Union([Hash, Type.Null()]),
  transferredAt: Timestamp,
}, { additionalProperties: false })
export type ArtifactTransferReceipt = Static<typeof ArtifactTransferReceiptSchema>

export type ArtifactAuthorityErrorCode = 'invalid-contract' | 'immutable-artifact' | 'scope-denied' | 'policy-denied' | 'quota-exceeded' | 'conflict' | 'not-found'
export class ArtifactAuthorityError extends Error {
  readonly code: ArtifactAuthorityErrorCode
  constructor(code: ArtifactAuthorityErrorCode, message: string) { super(message); this.name = 'ArtifactAuthorityError'; this.code = code }
}

export function parseArtifactContract<T extends TSchema>(schema: T, value: unknown, label: string): Readonly<Static<T>> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) {
    const first = Value.Errors(schema, value).First()
    throw new ArtifactAuthorityError('invalid-contract', `${label} failed strict TypeBox validation${first ? ` at ${first.path || '/'}: ${first.message}` : ''}.`)
  }
  return deepFreeze(parsed.value)
}

export function assertArtifactPolicy(artifact: ArtifactRelease): void {
  const valid = artifact.kind === 'plugin'
    ? artifact.executionPolicy === 'plugin-sandbox-worker' && artifact.mimeType === 'application/zip'
    : artifact.executionPolicy !== 'plugin-sandbox-worker'
  if (!valid) throw new ArtifactAuthorityError('policy-denied', 'Artifact kind cannot use the requested execution policy.')
  if (artifact.kind === 'component-pack' && artifact.permissions.some((permission) => /(?:server|network|payment|provider|secret|worker|schedule)/.test(permission))) {
    throw new ArtifactAuthorityError('policy-denied', 'Component-pack artifact requests backend or privileged authority.')
  }
}

export function assertInstallationPolicy(installation: ArtifactInstallation): void {
  const plugin = installation.artifactKind === 'plugin'
  if (plugin !== (installation.executionPolicy === 'plugin-sandbox-worker')) throw new ArtifactAuthorityError('policy-denied', 'Installation execution policy does not match its artifact kind.')
  if (plugin && installation.workerGeneration === null) throw new ArtifactAuthorityError('policy-denied', 'Plugin installations require a worker generation.')
  if (!plugin && (installation.workerGeneration !== null || installation.secret !== null || installation.state === 'crashed')) {
    throw new ArtifactAuthorityError('policy-denied', 'Component packs cannot own workers, secrets, or crash state.')
  }
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const nested of Object.values(value)) deepFreeze(nested); Object.freeze(value) }
  return value
}

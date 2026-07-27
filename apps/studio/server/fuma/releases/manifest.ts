import {
  Type,
  Value,
  safeParseValue,
} from '@core/utils/typeboxHelpers'
import { sha256Hex } from '../objectStorage'
import {
  ReleaseArtifactKindSchema,
  ReleaseArtifactSchema,
  ReleaseContractError,
  assertManifestShape,
  assertReleaseLogicalPath,
  type ReleaseArtifact,
  type ReleaseManifest,
} from './contracts'
import { assertReleaseObjectKey, releaseObjectKey } from './keyPolicy'

const encoder = new TextEncoder()

type ManifestArtifactInput = Readonly<{
  logicalPath: string
  kind: ReleaseArtifact['kind']
  contentHashSha256: string
  sizeBytes: number
  mimeType: string
  references: readonly string[]
}>

const ManifestArtifactInputSchema = Type.Object({
  logicalPath: Type.String({ minLength: 2, maxLength: 2_048 }),
  kind: ReleaseArtifactKindSchema,
  contentHashSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  sizeBytes: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  mimeType: Type.String({ minLength: 3, maxLength: 255 }),
  references: Type.Array(Type.String({ minLength: 2, maxLength: 2_048 }), {
    maxItems: 10_000,
  }),
}, { additionalProperties: false })

function checksum(value: string): string {
  return sha256Hex(encoder.encode(value))
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function canonicalArtifactValue(artifact: ReleaseArtifact): ReleaseArtifact {
  return {
    logicalPath: artifact.logicalPath,
    kind: artifact.kind,
    objectKey: artifact.objectKey,
    contentHashSha256: artifact.contentHashSha256,
    sizeBytes: artifact.sizeBytes,
    mimeType: artifact.mimeType,
    references: artifact.references,
  }
}

function canonicalArtifact(artifact: ReleaseArtifact): string {
  return JSON.stringify(canonicalArtifactValue(artifact))
}

export function releaseArtifactsHashInput(artifacts: readonly ReleaseArtifact[]): string {
  return artifacts.map(canonicalArtifact).join('\n')
}

export function releaseManifestHashInput(
  manifest: Omit<ReleaseManifest, 'manifestHashSha256'>,
): string {
  return JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    releaseId: manifest.releaseId,
    ownerKey: manifest.ownerKey,
    siteId: manifest.siteId,
    sourceSnapshotHashSha256: manifest.sourceSnapshotHashSha256,
    artifacts: manifest.artifacts.map(canonicalArtifactValue),
    artifactCount: manifest.artifactCount,
    totalSizeBytes: manifest.totalSizeBytes,
    artifactsHashSha256: manifest.artifactsHashSha256,
    createdAt: manifest.createdAt,
  })
}

function assertConsistentObjectIdentities(
  artifacts: readonly ReleaseArtifact[],
  path: string,
): void {
  const identities = new Map<string, ReleaseArtifact>()
  for (const artifact of artifacts) {
    const existing = identities.get(artifact.objectKey)
    if (existing && (
      existing.contentHashSha256 !== artifact.contentHashSha256
      || existing.sizeBytes !== artifact.sizeBytes
      || existing.mimeType !== artifact.mimeType
    )) {
      throw new ReleaseContractError(
        'invalid-object-identity',
        'One immutable object identity cannot carry conflicting metadata.',
        path,
      )
    }
    identities.set(artifact.objectKey, artifact)
  }
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested)
    Object.freeze(value)
  }
  return value
}

function canonicalizeArtifact(releaseId: string, input: unknown, index: number): ReleaseArtifact {
  const path = `artifacts[${index}]`
  const parsed = safeParseValue(ManifestArtifactInputSchema, input)
  if (!parsed.ok) {
    throw new ReleaseContractError(
      'invalid-contract',
      `${path} does not match the strict release artifact input contract.`,
      path,
    )
  }
  const value: ManifestArtifactInput = parsed.value
  assertReleaseLogicalPath(value.logicalPath, `${path}.logicalPath`)
  const references = [...value.references].sort(compareText)
  for (const [referenceIndex, reference] of references.entries()) {
    assertReleaseLogicalPath(reference, `${path}.references[${referenceIndex}]`)
  }
  if (new Set(references).size !== references.length) {
    throw new ReleaseContractError(
      'duplicate-artifact',
      `${path}.references must be unique.`,
      `${path}.references`,
    )
  }
  const artifact = {
    logicalPath: value.logicalPath,
    kind: value.kind,
    objectKey: releaseObjectKey(releaseId, value.contentHashSha256),
    contentHashSha256: value.contentHashSha256,
    sizeBytes: value.sizeBytes,
    mimeType: value.mimeType,
    references,
  }
  if (!Value.Check(ReleaseArtifactSchema, artifact)) {
    throw new ReleaseContractError(
      'invalid-contract',
      `${path} does not match the strict release artifact contract.`,
      path,
    )
  }
  return artifact
}

export function createReleaseManifest(input: Readonly<{
  releaseId: string
  ownerKey: string
  siteId: string
  sourceSnapshotHashSha256: string
  artifacts: readonly unknown[]
  createdAt: string
}>): ReleaseManifest {
  const artifacts = input.artifacts
    .map((artifact, index) => canonicalizeArtifact(input.releaseId, artifact, index))
    .sort((left, right) => compareText(left.logicalPath, right.logicalPath))
  const paths = artifacts.map(({ logicalPath }) => logicalPath)
  if (new Set(paths).size !== paths.length) {
    throw new ReleaseContractError(
      'duplicate-artifact',
      'A release manifest cannot contain duplicate logical paths.',
      'artifacts',
    )
  }
  assertConsistentObjectIdentities(artifacts, 'artifacts')
  const pathSet = new Set(paths)
  for (const [artifactIndex, artifact] of artifacts.entries()) {
    for (const [referenceIndex, reference] of artifact.references.entries()) {
      if (!pathSet.has(reference)) {
        throw new ReleaseContractError(
          'missing-reference',
          `Release reference ${reference} is not present in the manifest.`,
          `artifacts[${artifactIndex}].references[${referenceIndex}]`,
        )
      }
    }
  }
  const totalSizeBytes = artifacts.reduce((total, artifact) => total + artifact.sizeBytes, 0)
  if (!Number.isSafeInteger(totalSizeBytes)) {
    throw new ReleaseContractError(
      'aggregate-mismatch',
      'Release total byte size exceeds the safe integer range.',
      'totalSizeBytes',
    )
  }
  const base = {
    schemaVersion: 1 as const,
    releaseId: input.releaseId,
    ownerKey: input.ownerKey,
    siteId: input.siteId,
    sourceSnapshotHashSha256: input.sourceSnapshotHashSha256,
    artifacts,
    artifactCount: artifacts.length,
    totalSizeBytes,
    artifactsHashSha256: checksum(releaseArtifactsHashInput(artifacts)),
    createdAt: input.createdAt,
  } satisfies Omit<ReleaseManifest, 'manifestHashSha256'>
  const manifest = {
    ...base,
    manifestHashSha256: checksum(releaseManifestHashInput(base)),
  } satisfies ReleaseManifest
  assertReleaseManifest(manifest)
  return freeze(manifest)
}

export function assertReleaseManifest(value: unknown): asserts value is ReleaseManifest {
  const manifest = assertManifestShape(value)
  const paths = manifest.artifacts.map(({ logicalPath }) => logicalPath)
  const sortedPaths = [...paths].sort(compareText)
  if (new Set(paths).size !== paths.length || paths.some((path, index) => path !== sortedPaths[index])) {
    throw new ReleaseContractError(
      'duplicate-artifact',
      'Manifest artifacts must have unique canonical sorted paths.',
      'manifest.artifacts',
    )
  }
  assertConsistentObjectIdentities(manifest.artifacts, 'manifest.artifacts')
  const pathSet = new Set(paths)
  let totalSizeBytes = 0
  for (const [artifactIndex, artifact] of manifest.artifacts.entries()) {
    assertReleaseLogicalPath(artifact.logicalPath, `manifest.artifacts[${artifactIndex}].logicalPath`)
    assertReleaseObjectKey(
      artifact.objectKey,
      manifest.releaseId,
      artifact.contentHashSha256,
      `manifest.artifacts[${artifactIndex}].objectKey`,
    )
    const sortedReferences = [...artifact.references].sort(compareText)
    if (artifact.references.some((reference, index) => reference !== sortedReferences[index])) {
      throw new ReleaseContractError(
        'aggregate-mismatch',
        'Manifest references must be canonical and sorted.',
        `manifest.artifacts[${artifactIndex}].references`,
      )
    }
    for (const [referenceIndex, reference] of artifact.references.entries()) {
      if (!pathSet.has(reference)) {
        throw new ReleaseContractError(
          'missing-reference',
          `Release reference ${reference} is not present in the manifest.`,
          `manifest.artifacts[${artifactIndex}].references[${referenceIndex}]`,
        )
      }
    }
    totalSizeBytes += artifact.sizeBytes
  }
  if (!Number.isSafeInteger(totalSizeBytes)
    || manifest.artifactCount !== manifest.artifacts.length
    || manifest.totalSizeBytes !== totalSizeBytes) {
    throw new ReleaseContractError(
      'aggregate-mismatch',
      'Manifest artifact count or byte total does not reconcile.',
      'manifest',
    )
  }
  const artifactsHash = checksum(releaseArtifactsHashInput(manifest.artifacts))
  if (manifest.artifactsHashSha256 !== artifactsHash) {
    throw new ReleaseContractError(
      'hash-mismatch',
      'Manifest artifact descriptor hash does not match.',
      'manifest.artifactsHashSha256',
    )
  }
  const { manifestHashSha256: _manifestHashSha256, ...base } = manifest
  if (manifest.manifestHashSha256 !== checksum(releaseManifestHashInput(base))) {
    throw new ReleaseContractError(
      'hash-mismatch',
      'Release manifest hash does not match.',
      'manifest.manifestHashSha256',
    )
  }
}

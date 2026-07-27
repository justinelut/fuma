import { createHash } from 'node:crypto'
import {
  PairedReleaseManifestSchema,
  parseStrict,
  type PairedReleaseManifest,
} from './contracts'

export type PairedReleaseManifestInput = Omit<PairedReleaseManifest, 'manifestHashSha256' | 'architectures'> & Readonly<{
  architectures: readonly ['linux/amd64', 'linux/arm64']
}>

type CanonicalPairedReleaseManifestInput = Omit<PairedReleaseManifest, 'manifestHashSha256'>

function canonicalValue(manifest: PairedReleaseManifestInput): CanonicalPairedReleaseManifestInput {
  return {
    schemaVersion: 3,
    sourceSha: manifest.sourceSha,
    lockHashSha256: manifest.lockHashSha256,
    migrationHighWaterMark: manifest.migrationHighWaterMark,
    runtimeImage: manifest.runtimeImage,
    runtimeImageSourceSha: manifest.runtimeImageSourceSha,
    webImage: manifest.webImage,
    webImageSourceSha: manifest.webImageSourceSha,
    architectures: ['linux/amd64', 'linux/arm64'],
    runtimeIndexHashSha256: manifest.runtimeIndexHashSha256,
    webIndexHashSha256: manifest.webIndexHashSha256,
    runtimeScanReportHashSha256: manifest.runtimeScanReportHashSha256,
    webScanReportHashSha256: manifest.webScanReportHashSha256,
    runtimeSbomHashSha256: manifest.runtimeSbomHashSha256,
    webSbomHashSha256: manifest.webSbomHashSha256,
    runtimeProvenanceHashSha256: manifest.runtimeProvenanceHashSha256,
    webProvenanceHashSha256: manifest.webProvenanceHashSha256,
    runtimeSignatureVerificationHashSha256: manifest.runtimeSignatureVerificationHashSha256,
    webSignatureVerificationHashSha256: manifest.webSignatureVerificationHashSha256,
    runtimeSmokeEvidenceHashSha256: manifest.runtimeSmokeEvidenceHashSha256,
    webSmokeEvidenceHashSha256: manifest.webSmokeEvidenceHashSha256,
    publicationPlanHashSha256: manifest.publicationPlanHashSha256,
  }
}

export function pairedReleaseManifestHash(input: PairedReleaseManifestInput): string {
  return createHash('sha256').update(JSON.stringify(canonicalValue(input))).digest('hex')
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

export function createPairedReleaseManifest(input: PairedReleaseManifestInput): PairedReleaseManifest {
  const canonical = canonicalValue(input)
  const manifest = parseStrict(PairedReleaseManifestSchema, {
    ...canonical,
    manifestHashSha256: pairedReleaseManifestHash(canonical),
  }, 'release.paired')
  return deepFreeze(manifest)
}

export function hashPairedReleaseFile(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

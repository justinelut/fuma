import { validateComponentPackRelease } from '../../../../../tooling/component-packs/contracts'
import { readPluginPackage } from '../../plugins/package'
import type { ArtifactRelease } from '../artifacts'
import {
  ArtifactScanReportSchema,
  parseReviewContract,
  reviewHash,
  type ArtifactScanFinding,
  type ArtifactScanReport,
  type ReviewPackageMetadata,
} from './contracts'

export type ArtifactScanInput = Readonly<{
  submissionId: string
  artifact: ArtifactRelease
  bytes: Uint8Array
  metadata: ReviewPackageMetadata
  scannedAt: string
}>

export interface ArtifactScanner {
  readonly scannerId: string
  readonly scannerVersion: string
  readonly artifactKinds: readonly ArtifactRelease['kind'][]
  scan(input: ArtifactScanInput): Promise<readonly ArtifactScanFinding[]> | readonly ArtifactScanFinding[]
}

function finding(scannerId: string, code: string, severity: ArtifactScanFinding['severity'], evidence: unknown): ArtifactScanFinding {
  const evidenceHashSha256 = reviewHash(evidence)
  return Object.freeze({ findingId: `${scannerId}:${code}:${evidenceHashSha256.slice(0, 16)}`, code, severity, state: 'open', evidenceHashSha256 })
}

export class PluginPackageScanner implements ArtifactScanner {
  readonly scannerId = 'fuma.plugin-package'
  readonly scannerVersion = '1.0.0'
  readonly artifactKinds = ['plugin'] as const
  async scan(input: ArtifactScanInput): Promise<readonly ArtifactScanFinding[]> {
    try {
      const owned = new Uint8Array(input.bytes.byteLength)
      owned.set(input.bytes)
      const parsed = await readPluginPackage(new File([owned.buffer], `${input.artifact.packageId}-${input.artifact.exactVersion}.zip`, { type: 'application/zip' }))
      const declaredPermissions = [...parsed.manifest.permissions].sort()
      const releasePermissions = [...input.artifact.permissions].sort()
      if (parsed.manifest.id !== input.artifact.packageId || parsed.manifest.version !== input.artifact.exactVersion
        || JSON.stringify(declaredPermissions) !== JSON.stringify(releasePermissions)) throw new Error('Plugin manifest identity, version, or permissions do not match the immutable release.')
      return []
    } catch (error) {
      return [finding(this.scannerId, 'invalid-plugin-archive', 'critical', { hash: input.artifact.contentHashSha256, bytes: input.bytes.byteLength, error: error instanceof Error ? error.message : 'invalid' })]
    }
  }
}

export class ComponentPackReleaseScanner implements ArtifactScanner {
  readonly scannerId = 'fuma.site007-component-pack'
  readonly scannerVersion = '1.0.0'
  readonly artifactKinds = ['component-pack'] as const
  scan(input: ArtifactScanInput): readonly ArtifactScanFinding[] {
    let value: unknown
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input.bytes)) as unknown } catch {
      return [finding(this.scannerId, 'invalid-component-json', 'critical', { hash: input.artifact.contentHashSha256 })]
    }
    try {
      validateComponentPackRelease(value)
      return []
    } catch (error) {
      return [finding(this.scannerId, 'invalid-component-release', 'critical', { hash: input.artifact.contentHashSha256, error: error instanceof Error ? error.message : 'invalid' })]
    }
  }
}

export class ArtifactEvidenceScanner implements ArtifactScanner {
  readonly scannerId = 'fuma.artifact-evidence'
  readonly scannerVersion = '1.0.0'
  readonly artifactKinds = ['plugin', 'component-pack'] as const
  scan(input: ArtifactScanInput): readonly ArtifactScanFinding[] {
    const findings: ArtifactScanFinding[] = []
    if (input.metadata.evidence.provenanceHashSha256 !== reviewHash(input.artifact.provenance)) {
      findings.push(finding(this.scannerId, 'provenance-mismatch', 'high', { expected: reviewHash(input.artifact.provenance), actual: input.metadata.evidence.provenanceHashSha256 }))
    }
    const duplicateDependencies = input.metadata.dependencies.map(({ packageId }) => packageId)
    if (new Set(duplicateDependencies).size !== duplicateDependencies.length) findings.push(finding(this.scannerId, 'duplicate-dependency', 'high', duplicateDependencies))
    const duplicateSchemas = input.metadata.schemas.map(({ schemaId }) => schemaId)
    if (new Set(duplicateSchemas).size !== duplicateSchemas.length) findings.push(finding(this.scannerId, 'duplicate-schema', 'high', duplicateSchemas))
    if (input.artifact.kind === 'component-pack' && input.metadata.evidence.accessibility.standard === 'not-applicable') {
      findings.push(finding(this.scannerId, 'accessibility-evidence-required', 'high', input.metadata.evidence.accessibility))
    }
    return findings
  }
}

export class ArtifactScannerRegistry {
  readonly #scanners: readonly ArtifactScanner[]
  constructor(scanners: readonly ArtifactScanner[] = [new PluginPackageScanner(), new ComponentPackReleaseScanner(), new ArtifactEvidenceScanner()]) {
    const identities = scanners.map((scanner) => `${scanner.scannerId}@${scanner.scannerVersion}`)
    if (new Set(identities).size !== identities.length) throw new TypeError('Artifact scanners require unique exact identities.')
    this.#scanners = Object.freeze([...scanners])
  }

  async scan(input: ArtifactScanInput): Promise<readonly ArtifactScanReport[]> {
    const selected = this.#scanners.filter((scanner) => scanner.artifactKinds.includes(input.artifact.kind))
    if (selected.length < 2) throw new TypeError(`Artifact kind ${input.artifact.kind} has no complete scanner set.`)
    const reports: ArtifactScanReport[] = []
    for (const scanner of selected) {
      const findings = [...await scanner.scan(input)].sort((left, right) => left.findingId.localeCompare(right.findingId))
      const reportBody = {
        submissionId: input.submissionId,
        artifactId: input.artifact.artifactId,
        artifactKind: input.artifact.kind,
        contentHashSha256: input.artifact.contentHashSha256,
        scannerId: scanner.scannerId,
        scannerVersion: scanner.scannerVersion,
        state: findings.some(({ state, severity }) => state === 'open' && (severity === 'high' || severity === 'critical')) ? 'rejected' as const : 'clean' as const,
        findings,
        scannedAt: input.scannedAt,
      }
      reports.push(parseReviewContract(ArtifactScanReportSchema, { ...reportBody, reportHashSha256: reviewHash(reportBody) }, 'artifact scan report') as ArtifactScanReport)
    }
    return Object.freeze(reports)
  }
}

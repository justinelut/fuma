import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Type, type Static, type TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { hashPairedReleaseFile } from '../src'

const SourceRevisionSchema = Type.String({ pattern: '^[a-f0-9]{40}(?:[a-f0-9]{24})?$' })
const Sha256Schema = Type.String({ pattern: '^[a-f0-9]{64}$' })
const RuntimeImageSchema = Type.String({ pattern: '^ghcr\\.io/corebunch/fuma-runtime@sha256:[a-f0-9]{64}$' })
const WebImageSchema = Type.String({ pattern: '^ghcr\\.io/corebunch/fuma-web@sha256:[a-f0-9]{64}$' })
const SiteRuntimeImageSchema = Type.String({ pattern: '^ghcr\\.io/corebunch/fuma-site-runtime@sha256:[a-f0-9]{64}$' })

export const PublicationPlanSchema = Type.Object({
  schemaVersion: Type.Literal(2),
  sourceSha: SourceRevisionSchema,
  runtimeImage: RuntimeImageSchema,
  webImage: WebImageSchema,
  siteRuntimeImage: SiteRuntimeImageSchema,
  architectures: Type.Tuple([Type.Literal('linux/arm64')]),
  state: Type.Literal('registry-published-unpromoted'),
  promotionAuthority: Type.Literal('external-fuma-079-or-later'),
  partialPublicationPolicy: Type.Literal('orphan-non-promotable'),
  rollbackPolicy: Type.Literal('retain-last-known-good-digests'),
  previousPairedReleaseManifestHashSha256: Type.Union([Sha256Schema, Type.Null()]),
  registryDeletionPlanned: Type.Literal(false),
  deploymentMutationPerformed: Type.Literal(false),
}, { additionalProperties: false })

export type PublicationPlan = Static<typeof PublicationPlanSchema>
export type EvidenceKind = 'oci-index' | 'scan' | 'sbom' | 'provenance' | 'signature'

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a JSON object`)
  return value as Record<string, unknown>
}

async function json(path: string, label: string): Promise<{ bytes: Uint8Array; value: unknown }> {
  const bytes = await readFile(resolve(path))
  let value: unknown
  try {
    value = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error(`${label} must be valid JSON`)
  }
  return { bytes, value }
}

function assertOciIndex(value: unknown): readonly string[] {
  const index = object(value, 'OCI index')
  if (index.mediaType !== 'application/vnd.oci.image.index.v1+json'
    && index.mediaType !== 'application/vnd.docker.distribution.manifest.list.v2+json') {
    throw new Error('OCI index has an unsupported media type')
  }
  if (!Array.isArray(index.manifests) || index.manifests.length < 1) throw new Error('OCI index must contain its runnable manifest')
  const runnablePlatforms: string[] = []
  const runnableDigests: string[] = []
  for (const [position, entry] of index.manifests.entries()) {
    const descriptor = object(entry, `OCI descriptor ${position}`)
    const platform = object(descriptor.platform, `OCI descriptor ${position} platform`)
    if (typeof descriptor.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(descriptor.digest) || /^sha256:0{64}$/.test(descriptor.digest)) {
      throw new Error('OCI descriptor digest must be a non-placeholder SHA-256')
    }
    if (platform.os === 'linux' && platform.architecture === 'arm64') {
      runnablePlatforms.push('linux/arm64')
      runnableDigests.push(descriptor.digest.slice('sha256:'.length))
      continue
    }
    const annotations = descriptor.annotations !== null && typeof descriptor.annotations === 'object' && !Array.isArray(descriptor.annotations)
      ? descriptor.annotations as Record<string, unknown>
      : {}
    if (platform.os !== 'unknown' || platform.architecture !== 'unknown'
      || annotations['vnd.docker.reference.type'] !== 'attestation-manifest') {
      throw new Error('OCI index contains an unrelated or non-ARM64 runnable descriptor')
    }
  }
  if (runnablePlatforms.join(',') !== 'linux/arm64') throw new Error('OCI index must contain exactly one linux/arm64 runnable architecture')
  return runnableDigests
}

function assertSarif(value: unknown, image: string, sourceSha: string): void {
  const report = object(value, 'Trivy SARIF report')
  if (report.version !== '2.1.0' || !Array.isArray(report.runs) || report.runs.length < 1) {
    throw new Error('Published scan must be a non-empty SARIF 2.1.0 report')
  }
  const receipt = object(object(report.properties, 'Trivy SARIF receipt properties').fuma, 'Trivy SARIF Fuma receipt')
  if (receipt.schemaVersion !== 1 || receipt.image !== image || receipt.sourceSha !== sourceSha
    || receipt.platform !== 'linux/arm64' || receipt.scanner !== 'trivy' || receipt.passed !== true || receipt.ignoreUnfixed !== false
    || !Array.isArray(receipt.severity) || receipt.severity.join(',') !== 'HIGH,CRITICAL') {
    throw new Error('Published scan receipt does not bind the exact ARM64 image, source, and blocking policy')
  }
  for (const [position, runValue] of report.runs.entries()) {
    const driver = object(object(object(runValue, `SARIF run ${position}`).tool, `SARIF run ${position} tool`).driver, `SARIF run ${position} driver`)
    if (typeof driver.name !== 'string' || !/trivy/i.test(driver.name)) throw new Error('Published scan must be produced by Trivy')
  }
}

function assertSpdx(value: unknown): void {
  const document = object(value, 'SPDX SBOM')
  if (document.spdxVersion !== 'SPDX-2.3' || document.SPDXID !== 'SPDXRef-DOCUMENT'
    || typeof document.documentNamespace !== 'string' || document.documentNamespace.length < 1
    || !Array.isArray(document.packages) || document.packages.length < 1) {
    throw new Error('Published SBOM must be a non-empty SPDX 2.3 document')
  }
}

function objectsAtAnyDepth(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(objectsAtAnyDepth)
  if (value === null || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  return [record, ...Object.values(record).flatMap(objectsAtAnyDepth)]
}

function assertProvenance(value: unknown, sourceSha: string, expectedSubjectDigests: readonly string[]): void {
  const statements = objectsAtAnyDepth(value).filter((candidate) => candidate.predicateType === 'https://slsa.dev/provenance/v1')
  const actualSubjectDigests = new Set(statements.flatMap((statement) => Array.isArray(statement.subject) ? statement.subject.flatMap((subjectValue) => {
    const subject = subjectValue !== null && typeof subjectValue === 'object' && !Array.isArray(subjectValue) ? subjectValue as Record<string, unknown> : {}
    const digests = subject.digest !== null && typeof subject.digest === 'object' && !Array.isArray(subject.digest) ? subject.digest as Record<string, unknown> : {}
    return typeof digests.sha256 === 'string' ? [digests.sha256] : []
  }) : []))
  if (!expectedSubjectDigests.every((digest) => actualSubjectDigests.has(digest))) {
    throw new Error('Verified provenance must bind the runnable ARM64 OCI platform digest with SLSA v1')
  }
  if (!JSON.stringify(value).includes(sourceSha)) throw new Error('Verified provenance must bind the release source SHA')
}

function assertSignature(value: unknown, image: string): void {
  const repository = image.slice(0, image.indexOf('@'))
  const digest = image.slice(image.indexOf('@') + 1)
  const matches = objectsAtAnyDepth(value).some((candidate) => {
    const critical = candidate.critical !== null && typeof candidate.critical === 'object' && !Array.isArray(candidate.critical) ? candidate.critical as Record<string, unknown> : {}
    const identity = critical.identity !== null && typeof critical.identity === 'object' && !Array.isArray(critical.identity) ? critical.identity as Record<string, unknown> : {}
    const imageIdentity = critical.image !== null && typeof critical.image === 'object' && !Array.isArray(critical.image) ? critical.image as Record<string, unknown> : {}
    return identity['docker-reference'] === repository && imageIdentity['docker-manifest-digest'] === digest
  })
  if (!matches) throw new Error('Cosign verification must bind the exact repository and manifest digest')
}

export async function validatedEvidenceHash(path: string, kind: EvidenceKind, image: string, sourceSha: string, indexPath?: string): Promise<string> {
  const { bytes, value } = await json(path, kind)
  if (kind === 'oci-index') assertOciIndex(value)
  else if (kind === 'scan') assertSarif(value, image, sourceSha)
  else if (kind === 'sbom') assertSpdx(value)
  else if (kind === 'provenance') {
    if (!indexPath) throw new Error('Provenance validation requires the exact OCI index')
    const index = await json(indexPath, 'OCI index')
    assertProvenance(value, sourceSha, assertOciIndex(index.value))
  } else assertSignature(value, image)
  return hashPairedReleaseFile(bytes)
}

export async function validatedPublicationPlanHash(path: string, sourceSha: string, runtimeImage: string, webImage: string, siteRuntimeImage: string): Promise<string> {
  const { bytes, value } = await json(path, 'Publication plan')
  if (!Value.Check(PublicationPlanSchema, value)) {
    const detail = Value.Errors(PublicationPlanSchema, value).First()
    throw new Error(`Invalid publication plan: ${detail?.path || '/'} ${detail?.message || 'invalid'}`)
  }
  const plan = value as PublicationPlan
  if (plan.sourceSha !== sourceSha || plan.runtimeImage !== runtimeImage || plan.webImage !== webImage || plan.siteRuntimeImage !== siteRuntimeImage) {
    throw new Error('Publication plan identity does not match the paired release')
  }
  if (plan.previousPairedReleaseManifestHashSha256 !== null && /^0{64}$/.test(plan.previousPairedReleaseManifestHashSha256)) {
    throw new Error('Publication plan previous release hash cannot be a placeholder')
  }
  return hashPairedReleaseFile(bytes)
}

export function assertSchema<T extends TSchema>(schema: T, value: unknown, label: string): Static<T> {
  if (!Value.Check(schema, value)) {
    const detail = Value.Errors(schema, value).First()
    throw new Error(`${label}: ${detail?.path || '/'} ${detail?.message || 'invalid'}`)
  }
  return value as Static<T>
}

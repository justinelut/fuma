import { FUMA_GOVERNANCE_DEPLOYMENT } from './deployment'
import {
  LaunchGateSchema,
  PairedReleaseManifestSchema,
  PublicWebDeploymentSeamSchema,
  parseStrict,
  type PairedReleaseManifest,
  type PublicWebDeploymentSeam,
} from './contracts'
import { pairedReleaseManifestHash } from './supplyChain'

export class LaunchPolicyError extends Error {
  constructor(readonly code: 'mixed-release' | 'promotion-blocked' | 'privacy-denied' | 'capacity-denied' | 'pilot-denied' | 'public-web-denied', message: string) {
    super(message)
    this.name = 'LaunchPolicyError'
  }
}

export function verifyPairedRelease(value: unknown): PairedReleaseManifest {
  const manifest = parseStrict(PairedReleaseManifestSchema, value, 'release.paired')
  const {
    manifestHashSha256,
    ...hashInput
  } = manifest
  const evidenceHashes = [
    manifest.lockHashSha256,
    manifest.runtimeIndexHashSha256,
    manifest.webIndexHashSha256,
    manifest.siteRuntimeIndexHashSha256,
    manifest.runtimeScanReportHashSha256,
    manifest.webScanReportHashSha256,
    manifest.siteRuntimeScanReportHashSha256,
    manifest.runtimeSbomHashSha256,
    manifest.webSbomHashSha256,
    manifest.siteRuntimeSbomHashSha256,
    manifest.runtimeProvenanceHashSha256,
    manifest.webProvenanceHashSha256,
    manifest.siteRuntimeProvenanceHashSha256,
    manifest.runtimeSignatureVerificationHashSha256,
    manifest.webSignatureVerificationHashSha256,
    manifest.siteRuntimeSignatureVerificationHashSha256,
    manifest.runtimeSmokeEvidenceHashSha256,
    manifest.webSmokeEvidenceHashSha256,
    manifest.siteRuntimeSmokeEvidenceHashSha256,
    manifest.publicationPlanHashSha256,
    manifestHashSha256,
  ]
  const imageDigests = [manifest.runtimeImage, manifest.webImage, manifest.siteRuntimeImage].map((image) => image.slice(-64))
  if (/^0{40}(?:0{24})?$/.test(manifest.sourceSha)
    || evidenceHashes.some((hash) => /^0{64}$/.test(hash))
    || imageDigests.some((digest) => /^0{64}$/.test(digest))) {
    throw new LaunchPolicyError('mixed-release', 'Placeholder release evidence is not promotable.')
  }
  if (new Set(imageDigests).size !== imageDigests.length
    || [manifest.runtimeImage, manifest.webImage, manifest.siteRuntimeImage].some((image) => image.includes('REQUIRED_'))) {
    throw new LaunchPolicyError('mixed-release', 'Runtime, public web, and site runtime require separate immutable images.')
  }
  if (manifest.runtimeImageSourceSha !== manifest.sourceSha
    || manifest.webImageSourceSha !== manifest.sourceSha
    || manifest.siteRuntimeImageSourceSha !== manifest.sourceSha) {
    throw new LaunchPolicyError('mixed-release', 'All image source revisions must match the paired release source revision.')
  }
  if (pairedReleaseManifestHash(hashInput) !== manifestHashSha256) {
    throw new LaunchPolicyError('mixed-release', 'Paired release manifest hash does not match its canonical immutable content.')
  }
  return manifest
}

export type DeploySmokeEvidence = Readonly<{
  releaseSourceSha: string
  migrationHighWaterMark: string
  exactHosts: readonly string[]
  unknownHostDenied: boolean
  parentDomainCookieAbsent: boolean
  backupAgeSeconds: number
  restoreCountsHashSha256: string
  restoreObjectsHashSha256: string
  rpoSeconds: number
  rtoSeconds: number
  observedRestoreSeconds: number
}>

export function authorizePromotion(releaseValue: unknown, evidence: DeploySmokeEvidence): PairedReleaseManifest {
  const release = verifyPairedRelease(releaseValue)
  const requiredHosts = [
    FUMA_GOVERNANCE_DEPLOYMENT.hosts.public,
    FUMA_GOVERNANCE_DEPLOYMENT.hosts.auth,
    FUMA_GOVERNANCE_DEPLOYMENT.hosts.product,
    FUMA_GOVERNANCE_DEPLOYMENT.hosts.console,
    FUMA_GOVERNANCE_DEPLOYMENT.tenantWildcard,
  ]
  const timings = [evidence.backupAgeSeconds, evidence.rpoSeconds, evidence.rtoSeconds, evidence.observedRestoreSeconds]
  if (evidence.releaseSourceSha !== release.sourceSha || evidence.migrationHighWaterMark !== release.migrationHighWaterMark || requiredHosts.some((host) => !evidence.exactHosts.includes(host)) || !evidence.unknownHostDenied || !evidence.parentDomainCookieAbsent || !timings.every((value) => Number.isSafeInteger(value) && value >= 0) || evidence.rpoSeconds <= 0 || evidence.rtoSeconds <= 0 || evidence.backupAgeSeconds > evidence.rpoSeconds || evidence.observedRestoreSeconds > evidence.rtoSeconds || !/^[a-f0-9]{64}$/.test(evidence.restoreCountsHashSha256) || !/^[a-f0-9]{64}$/.test(evidence.restoreObjectsHashSha256)) throw new LaunchPolicyError('promotion-blocked', 'Migration, host, backup, or restore evidence blocks promotion.')
  return release
}

const SECRET_KEYS = /(?:authorization|cookie|secret|password|token|email|phone|rawBody|prompt|toolArgs)/i

export function tenantSafeTelemetry(fields: Readonly<Record<string, unknown>>, allow: ReadonlySet<string>): Readonly<Record<string, string | number | boolean>> {
  const output: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (SECRET_KEYS.test(key) || !allow.has(key) || !['string', 'number', 'boolean'].includes(typeof value)) continue
    output[key] = value as string | number | boolean
  }
  return Object.freeze(output)
}

export type ServiceLevelObjective = Readonly<{ name: string; targetBasisPoints: number; windowSeconds: number; burnRateAlert: number; owner: string; runbook: string }>
export const LAUNCH_SLOS: readonly ServiceLevelObjective[] = Object.freeze([
  { name: 'public-web-availability', targetBasisPoints: 9_950, windowSeconds: 2_592_000, burnRateAlert: 14, owner: 'public-web-oncall', runbook: 'public-web-rollback' },
  { name: 'product-api-availability', targetBasisPoints: 9_900, windowSeconds: 2_592_000, burnRateAlert: 14, owner: 'platform-oncall', runbook: 'runtime-service-loss' },
  { name: 'publish-latency', targetBasisPoints: 9_500, windowSeconds: 604_800, burnRateAlert: 6, owner: 'publication-oncall', runbook: 'stuck-publish-queue' },
])

export type PrivacySubjectRecord = Readonly<{ subjectId: string; table: string; rowId: string; classification: 'customer-data' | 'legal-hold' | 'financial-record'; retainUntil: string | null }>
export type PrivacyPlan = Readonly<{ exportRows: readonly PrivacySubjectRecord[]; deleteRows: readonly PrivacySubjectRecord[]; retainedExceptions: readonly PrivacySubjectRecord[] }>

export function planPrivacyRequest(records: readonly PrivacySubjectRecord[], now: Date): PrivacyPlan {
  if (!Number.isFinite(now.getTime())) throw new LaunchPolicyError('privacy-denied', 'Privacy request time is invalid.')
  const subjects = new Set(records.map(({ subjectId }) => subjectId))
  const identities = new Set(records.map(({ table, rowId }) => `${table}:${rowId}`))
  if (subjects.size > 1 || identities.size !== records.length || records.some(({ subjectId, table, rowId, retainUntil }) => !subjectId || !table || !rowId || (retainUntil !== null && !Number.isFinite(Date.parse(retainUntil))))) throw new LaunchPolicyError('privacy-denied', 'Privacy records must belong to one subject with unique valid identities and retention dates.')
  const exportRows = [...records]
  const retainedExceptions = records.filter(({ classification, retainUntil }) => classification === 'legal-hold' || (classification === 'financial-record' && retainUntil !== null && Date.parse(retainUntil) > now.getTime()))
  const retained = new Set(retainedExceptions.map(({ table, rowId }) => `${table}:${rowId}`))
  return Object.freeze({ exportRows: Object.freeze(exportRows), deleteRows: Object.freeze(records.filter(({ table, rowId }) => !retained.has(`${table}:${rowId}`))), retainedExceptions: Object.freeze(retainedExceptions) })
}

export type CapacityEvidence = Readonly<{
  arm64: true
  p95Milliseconds: number
  p99Milliseconds: number
  p95BudgetMilliseconds: number
  p99BudgetMilliseconds: number
  noisyNeighborRatioBasisPoints: number
  customerRevenueMinor: number
  variableCogsMinor: number
  fixedAndSharedCogsMinor: number
  unallocatedMaterialCostMinor: number
  internalShadowCostMinor: number
}>

export function validateCapacityEconomics(evidence: CapacityEvidence): { grossMarginBasisPoints: number; variableCogsBasisPoints: number } {
  const exactCosts = [evidence.customerRevenueMinor, evidence.variableCogsMinor, evidence.fixedAndSharedCogsMinor, evidence.unallocatedMaterialCostMinor, evidence.internalShadowCostMinor]
  const measurements = [evidence.p95Milliseconds, evidence.p99Milliseconds, evidence.p95BudgetMilliseconds, evidence.p99BudgetMilliseconds, evidence.noisyNeighborRatioBasisPoints]
  if (evidence.arm64 !== true || !exactCosts.every((value) => Number.isSafeInteger(value) && value >= 0) || evidence.customerRevenueMinor <= 0 || !measurements.every((value) => Number.isFinite(value) && value >= 0) || evidence.p95BudgetMilliseconds <= 0 || evidence.p99BudgetMilliseconds <= 0 || evidence.noisyNeighborRatioBasisPoints < 1_000) throw new LaunchPolicyError('capacity-denied', 'ARM64 and exact non-negative complete cost and measurement evidence are required.')
  const variableCogsBasisPoints = Math.ceil(evidence.variableCogsMinor * 10_000 / evidence.customerRevenueMinor)
  const grossMarginBasisPoints = Math.floor((evidence.customerRevenueMinor - evidence.variableCogsMinor - evidence.fixedAndSharedCogsMinor - evidence.internalShadowCostMinor) * 10_000 / evidence.customerRevenueMinor)
  if (evidence.p95Milliseconds > evidence.p95BudgetMilliseconds || evidence.p99Milliseconds > evidence.p99BudgetMilliseconds || evidence.noisyNeighborRatioBasisPoints > 1_100 || evidence.unallocatedMaterialCostMinor > 0 || variableCogsBasisPoints > 3_000 || grossMarginBasisPoints < 7_000) throw new LaunchPolicyError('capacity-denied', 'Performance, allocation, variable COGS, or gross margin threshold failed.')
  return { grossMarginBasisPoints, variableCogsBasisPoints }
}

export type PilotEvidence = Readonly<{
  postgresMigrationHashMatched: boolean
  ghostManifestHashMatched: boolean
  lawyerInventoryComplete: boolean
  immutableGrandfatheredContract: boolean
  ociEmailActive: boolean
  routeMemberAccessParity: boolean
  providerPaymentsReconciled: boolean
  rollbackRestoredHash: boolean
  severityOneOpen: number
  signedBy: readonly string[]
}>

export function acceptPilot(evidence: PilotEvidence): PilotEvidence {
  if (!evidence.postgresMigrationHashMatched || !evidence.ghostManifestHashMatched || !evidence.lawyerInventoryComplete || !evidence.immutableGrandfatheredContract || !evidence.ociEmailActive || !evidence.routeMemberAccessParity || !evidence.providerPaymentsReconciled || !evidence.rollbackRestoredHash || evidence.severityOneOpen !== 0 || new Set(evidence.signedBy).size < 2) throw new LaunchPolicyError('pilot-denied', 'Migration, Lawyer pilot, or rollback evidence is incomplete.')
  return Object.freeze(structuredClone(evidence))
}

export function decideLaunch(value: unknown): 'declare' | 'abort' {
  const gate = parseStrict(LaunchGateSchema, value, 'launch.gate')
  const booleans = [gate.migrationPassed, gate.restorePassed, gate.hostIsolationPassed, gate.publicWebPassed, gate.securityPassed, gate.accessibilityPassed, gate.providerEvidenceCurrent]
  const requiredRoles = ['platform', 'security', 'finance', 'public-web', 'legal-accessibility', 'incident-command']
  const roles = new Set(gate.approvals.map(({ role }) => role))
  const actors = new Set(gate.approvals.map(({ actorId }) => actorId))
  const evidence = new Set(gate.approvals.map(({ evidenceHashSha256 }) => evidenceHashSha256))
  const approvalsValid = requiredRoles.every((role) => roles.has(role)) && actors.size === gate.approvals.length && evidence.size === gate.approvals.length && gate.approvals.every(({ evidenceHashSha256, signedAt }) => !/^0{64}$/.test(evidenceHashSha256) && Number.isFinite(Date.parse(signedAt)))
  if (booleans.some((passed) => !passed) || gate.grossMarginBasisPoints < 7_000 || gate.variableCogsBasisPoints > 3_000 || !approvalsValid) return 'abort'
  return 'declare'
}

export function verifyPublicWebDeploymentSeam(value: unknown, pairedRelease: PairedReleaseManifest): PublicWebDeploymentSeam {
  const seam = parseStrict(PublicWebDeploymentSeamSchema, value, 'public-web.deployment-seam')
  if (seam.releaseSourceSha !== pairedRelease.sourceSha || seam.runtimeProjectionVersion < seam.webContractVersion || seam.canaryPercent > 25 || !seam.publicRollbackIndependent || !seam.productTenantContinuityRequired) throw new LaunchPolicyError('public-web-denied', 'Public-web deployment seam is incompatible with the paired release.')
  return seam
}

export const REQUIRED_OBSERVABILITY_SIGNALS = Object.freeze(['http_requests_total', 'http_request_duration_seconds', 'job_queue_age_seconds', 'backup_age_seconds', 'restore_drill_age_seconds', 'public_web_vitals', 'payment_verification_failures', 'email_delivery_failures', 'domain_certificate_expiry_seconds'] as const)

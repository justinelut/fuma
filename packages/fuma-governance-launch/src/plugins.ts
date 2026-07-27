import {
  AiPaymentProposalSchema,
  CustomerPaymentRequestSchema,
  PluginArtifactSchema,
  PluginInstallationSchema,
  PluginReviewSchema,
  parseStrict,
  type AiPaymentProposal,
  type CustomerPaymentRequest,
  type PluginArtifact,
  type PluginInstallation,
  type PluginReview,
} from './contracts'

export class PluginGovernanceError extends Error {
  constructor(readonly code: 'artifact-mutated' | 'scope-denied' | 'review-denied' | 'signature-denied' | 'payment-denied' | 'confirmation-required', message: string) {
    super(message)
    this.name = 'PluginGovernanceError'
  }
}

export interface PluginArtifactPort {
  readArtifact(artifactId: string): Promise<PluginArtifact | null>
  putArtifactIfAbsent(artifact: PluginArtifact): Promise<boolean>
  readInstallation(siteId: string, installationId: string): Promise<PluginInstallation | null>
  putInstallationIfAbsent(installation: PluginInstallation): Promise<boolean>
  replaceInstallation(expectedGeneration: number, installation: PluginInstallation): Promise<boolean>
}

export class PluginInstallationService {
  constructor(private readonly port: PluginArtifactPort) {}

  async registerArtifact(input: unknown): Promise<PluginArtifact> {
    const artifact = parseStrict(PluginArtifactSchema, input, 'plugin.artifact')
    const existing = await this.port.readArtifact(artifact.artifactId)
    if (existing && JSON.stringify(existing) !== JSON.stringify(artifact)) throw new PluginGovernanceError('artifact-mutated', 'Immutable plugin artifact identity was reused.')
    if (!existing && !await this.port.putArtifactIfAbsent(artifact)) return this.registerArtifact(artifact)
    return existing ?? artifact
  }

  async install(input: unknown, approvedValue: PluginReview, grantedPermissions: readonly string[]): Promise<PluginInstallation> {
    const installation = parseStrict(PluginInstallationSchema, input, 'plugin.installation')
    const approved = parseStrict(PluginReviewSchema, approvedValue, 'plugin.installation.review')
    const artifact = await this.port.readArtifact(installation.artifactId)
    if (!artifact || approved.artifactId !== artifact.artifactId || approved.packageHashSha256 !== artifact.packageHashSha256 || approved.decision !== 'approved' || approved.scanState !== 'clean' || approved.signature === null || approved.reviewerId === null || approved.reviewerId === approved.submitterId) throw new PluginGovernanceError('review-denied', 'Only hash-bound signed reviewed artifacts can install.')
    if (artifact.permissions.some((permission) => !grantedPermissions.includes(permission))) throw new PluginGovernanceError('scope-denied', 'Installation permission grant is incomplete.')
    const existing = await this.port.readInstallation(installation.siteId, installation.installationId)
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(installation)) throw new PluginGovernanceError('scope-denied', 'Installation idempotency identity changed.')
      return existing
    }
    if (!await this.port.putInstallationIfAbsent(installation)) return this.install(installation, approved, grantedPermissions)
    return installation
  }

  async transfer(input: { installation: unknown; sourceGeneration: number; destination: Pick<PluginInstallation, 'organizationId' | 'workspaceId' | 'siteId' | 'ownerKey' | 'ownerGeneration'>; rekeyedSecret: PluginInstallation['secret'] }): Promise<PluginInstallation> {
    const current = parseStrict(PluginInstallationSchema, input.installation, 'plugin.transfer')
    if (current.ownerGeneration !== input.sourceGeneration || input.destination.ownerGeneration <= input.sourceGeneration || input.destination.ownerKey === current.ownerKey) throw new PluginGovernanceError('scope-denied', 'Stale or unchanged plugin ownership generation.')
    if (current.secret !== null && (input.rekeyedSecret === null || input.rekeyedSecret.fingerprintSha256 === current.secret.fingerprintSha256 || input.rekeyedSecret.ciphertextObjectKey === current.secret.ciphertextObjectKey)) throw new PluginGovernanceError('scope-denied', 'Plugin secret must be re-encrypted for the destination owner.')
    const next = parseStrict(PluginInstallationSchema, { ...current, ...input.destination, secret: input.rekeyedSecret, state: 'active' }, 'plugin.transfer.next')
    if (!await this.port.replaceInstallation(input.sourceGeneration, next)) throw new PluginGovernanceError('scope-denied', 'Plugin transfer fence lost.')
    return next
  }
}

export interface ReviewSigner {
  sign(packageHashSha256: string, submissionId: string): Promise<string>
  verify(packageHashSha256: string, submissionId: string, signature: string): Promise<boolean>
}

export class PluginReviewService {
  constructor(private readonly signer: ReviewSigner) {}

  async decide(value: unknown, input: { reviewerId: string; decision: 'approved' | 'rejected'; scanClean: boolean; currentArtifact: PluginArtifact }): Promise<PluginReview> {
    const review = parseStrict(PluginReviewSchema, value, 'plugin.review')
    if (review.submitterId === input.reviewerId) throw new PluginGovernanceError('review-denied', 'Plugin submitters cannot approve themselves.')
    if (review.packageHashSha256 !== input.currentArtifact.packageHashSha256 || review.artifactId !== input.currentArtifact.artifactId) throw new PluginGovernanceError('artifact-mutated', 'Review is not bound to current artifact bytes.')
    if (input.decision === 'approved' && (!input.scanClean || review.scanState !== 'clean')) throw new PluginGovernanceError('review-denied', 'Approval requires clean scans.')
    const signature = input.decision === 'approved' ? await this.signer.sign(review.packageHashSha256, review.submissionId) : null
    return parseStrict(PluginReviewSchema, { ...review, reviewerId: input.reviewerId, decision: input.decision, signature }, 'plugin.review.decision')
  }

  revoke(value: unknown, actorId: string): PluginReview {
    const review = parseStrict(PluginReviewSchema, value, 'plugin.review.revoke')
    if (review.decision !== 'approved' || review.signature === null || actorId === review.submitterId) throw new PluginGovernanceError('review-denied', 'Only an independently approved release can be revoked.')
    return parseStrict(PluginReviewSchema, { ...review, reviewerId: actorId, decision: 'revoked', signature: null }, 'plugin.review.revoked')
  }

  async verify(value: unknown, artifact: PluginArtifact): Promise<PluginReview> {
    const review = parseStrict(PluginReviewSchema, value, 'plugin.review.verify')
    if (review.decision !== 'approved' || !review.signature || review.packageHashSha256 !== artifact.packageHashSha256 || !await this.signer.verify(review.packageHashSha256, review.submissionId, review.signature)) throw new PluginGovernanceError('signature-denied', 'Plugin review signature is invalid or revoked.')
    return review
  }
}

export interface CustomerMerchantPort {
  createCheckout(input: CustomerPaymentRequest): Promise<{ checkoutId: string; redirectUrl: string }>
  verifyEvent(input: { siteId: string; providerEventId: string; signature: string; rawBody: Uint8Array }): Promise<{ ledgerId: string; duplicate: boolean }>
  refund(input: { siteId: string; ledgerId: string; reason: string }): Promise<{ refundId: string }>
}

export const CUSTOMER_PAYMENT_PLUGIN_PERMISSIONS = Object.freeze(['payments.customer.create', 'payments.customer.verify', 'payments.customer.refund'] as const)

export class ReviewedCustomerPaymentBinding {
  constructor(private readonly merchant: CustomerMerchantPort) {}

  checkout(value: unknown, grant: Readonly<{ siteId: string; permissions: readonly string[]; allowedReturnOrigin: string }>) {
    const request = parseStrict(CustomerPaymentRequestSchema, value, 'customer-payment.checkout')
    if (request.siteId !== grant.siteId || !grant.permissions.includes('payments.customer.create')) throw new PluginGovernanceError('payment-denied', 'Customer merchant scope denied.')
    let allowed: URL
    try { allowed = new URL(grant.allowedReturnOrigin) } catch { throw new PluginGovernanceError('payment-denied', 'Payment return origin is invalid.') }
    if (allowed.protocol !== 'https:' || allowed.pathname !== '/' || allowed.search || allowed.hash) throw new PluginGovernanceError('payment-denied', 'Payment return origin must be an HTTPS origin only.')
    const absolute = new URL(request.returnPath, allowed)
    if (absolute.origin !== allowed.origin) throw new PluginGovernanceError('payment-denied', 'Payment return origin escaped the site.')
    return this.merchant.createCheckout(request)
  }

  verifyEvent(input: Parameters<CustomerMerchantPort['verifyEvent']>[0], grant: Readonly<{ siteId: string; permissions: readonly string[] }>) {
    if (input.siteId !== grant.siteId || !grant.permissions.includes('payments.customer.verify')) throw new PluginGovernanceError('payment-denied', 'Payment verification scope denied.')
    return this.merchant.verifyEvent(input)
  }

  refund(input: Parameters<CustomerMerchantPort['refund']>[0], grant: Readonly<{ siteId: string; permissions: readonly string[] }>) {
    if (input.siteId !== grant.siteId || !grant.permissions.includes('payments.customer.refund')) throw new PluginGovernanceError('payment-denied', 'Payment refund scope denied.')
    return this.merchant.refund(input)
  }
}

export type AiPaymentConfirmation = Readonly<{ proposalId: string; actorId: string; nonceHashSha256: string; confirmedAt: string; stepUpAt: string }>

export function confirmAiPaymentProposal(value: unknown, input: { confirmation: AiPaymentConfirmation; actorMayInstall: boolean; expectedActorId: string; nonceUnused: boolean; now: Date; review: PluginReview; artifact: PluginArtifact }): AiPaymentProposal {
  const proposal = parseStrict(AiPaymentProposalSchema, value, 'ai.payment.proposal')
  const confirmation = input.confirmation
  const steppedUpAt = Date.parse(confirmation.stepUpAt)
  const confirmedAt = Date.parse(confirmation.confirmedAt)
  const liveStepUp = Number.isFinite(steppedUpAt) && input.now.getTime() - steppedUpAt >= 0 && input.now.getTime() - steppedUpAt <= 5 * 60_000
  if (!input.actorMayInstall || !input.nonceUnused || proposal.createdByActorId !== input.expectedActorId || confirmation.actorId !== input.expectedActorId || proposal.proposalId !== confirmation.proposalId || proposal.confirmationNonceHashSha256 !== confirmation.nonceHashSha256 || proposal.confirmedAt !== null || Date.parse(proposal.expiresAt) <= input.now.getTime() || !liveStepUp || confirmedAt < steppedUpAt || confirmedAt > input.now.getTime() || input.review.decision !== 'approved' || input.review.scanState !== 'clean' || input.review.reviewerId === null || input.review.reviewerId === input.review.submitterId || input.review.artifactId !== proposal.reviewedArtifactId || input.artifact.artifactId !== proposal.reviewedArtifactId || input.review.packageHashSha256 !== input.artifact.packageHashSha256 || input.review.signature === null) throw new PluginGovernanceError('confirmation-required', 'Explicit live actor confirmation of the reviewed payment plugin is required.')
  return parseStrict(AiPaymentProposalSchema, { ...proposal, confirmedAt: confirmation.confirmedAt }, 'ai.payment.confirmed')
}

export type SecureSecretEntryHandoff = Readonly<{ proposalId: string; handoffId: string; audience: 'secure-payment-settings'; expiresAt: string }>

export function paymentToolResult(proposal: AiPaymentProposal, handoff: SecureSecretEntryHandoff): Readonly<Record<string, unknown>> {
  return Object.freeze({ proposalId: proposal.proposalId, permissions: proposal.permissions, feeDisclosure: proposal.feeDisclosure, configuration: proposal.configuration, secureEntry: { audience: handoff.audience, handoffId: handoff.handoffId, path: '/secure-payment', expiresAt: handoff.expiresAt } })
}

function reviewMessage(packageHashSha256: string, submissionId: string): ArrayBuffer {
  return new TextEncoder().encode(`fuma-plugin-review-v1\n${packageHashSha256}\n${submissionId}`).buffer
}

function base64Url(bytes: ArrayBuffer): string {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): ArrayBuffer {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer
}

export class Ed25519ReviewSigner implements ReviewSigner {
  constructor(private readonly privateKey: CryptoKey, private readonly publicKey: CryptoKey) {
    if (privateKey.type !== 'private' || publicKey.type !== 'public' || privateKey.algorithm.name !== 'Ed25519' || publicKey.algorithm.name !== 'Ed25519') throw new PluginGovernanceError('signature-denied', 'Ed25519 signing and verification keys are required.')
  }

  async sign(packageHashSha256: string, submissionId: string): Promise<string> {
    return base64Url(await crypto.subtle.sign('Ed25519', this.privateKey, reviewMessage(packageHashSha256, submissionId)))
  }

  async verify(packageHashSha256: string, submissionId: string, signature: string): Promise<boolean> {
    try { return await crypto.subtle.verify('Ed25519', this.publicKey, fromBase64Url(signature), reviewMessage(packageHashSha256, submissionId)) } catch { return false }
  }
}

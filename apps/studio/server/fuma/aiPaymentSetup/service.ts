import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { ArtifactInstallation, ArtifactInstallationAuthority } from '../artifacts'
import type { ArtifactReviewService, MarketplaceArtifact } from '../artifactReviews'
import type { CustomerMerchantPaymentService } from '../customerPayments/service'
import type { SiteAiRepository } from '../siteAi/repository'
import type { SiteAiScope } from '../siteAi/contracts'
import type { AiPaymentSetupRepository } from './repository'
import {
  AI_PAYMENT_FEE_DISCLOSURE_VERSION,
  AI_PAYMENT_PLUGIN_EXACT_VERSION,
  AI_PAYMENT_PLUGIN_PACKAGE_ID,
  AI_PAYMENT_PLUGIN_PERMISSIONS,
  AI_PAYMENT_PREVIEW_AMOUNT_MINOR,
  AiPaymentSetupError,
  AiPaymentSetupProposalSchema,
  ConfirmAiPaymentSetupCommandSchema,
  ProposeAiPaymentSetupInputSchema,
  RegisterAiPaymentChallengeCommandSchema,
  StoreAiPaymentCredentialCommandSchema,
  blockForPurpose,
  exactAiPaymentPermissions,
  parseAiPaymentSetupContract,
  proposalView,
  type AiPaymentSetupHandoff,
  type AiPaymentSetupProposal,
  type AiPaymentSetupProposalView,
} from './contracts'

const PROPOSAL_LIFETIME_MS = 10 * 60_000
const CHALLENGE_LIFETIME_MS = 5 * 60_000
const HANDOFF_LIFETIME_MS = 5 * 60_000

export type AiPaymentSetupActorAuthority = Readonly<{ scope: SiteAiScope; actorId: string }>
export type AiPaymentSetupConfirmationAuthority = AiPaymentSetupActorAuthority & Readonly<{
  session: Readonly<{ userId: string; impersonatedBy: string | null; createdAt: Date }>
  freshSessionMs: number
}>

export interface AiPaymentTestPreviewPort {
  settle(input: Readonly<{
    proposal: AiPaymentSetupProposal
    installation: ArtifactInstallation
    credentialId: string
    amountMinor: typeof AI_PAYMENT_PREVIEW_AMOUNT_MINOR
    currency: 'KES'
  }>): Promise<Readonly<{
    purpose: AiPaymentSetupProposal['purpose']
    receiptFingerprintSha256: string
  }>>
}

function sha256(value: string): string { return createHash('sha256').update(value).digest('hex') }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}
function plus(at: string, milliseconds: number): string { return new Date(Date.parse(at) + milliseconds).toISOString() }
function validNow(now: () => Date): string {
  const value = now().toISOString()
  if (new Date(value).toISOString() !== value) throw new AiPaymentSetupError('unavailable', 'AI payment setup clock is invalid.')
  return value
}
function randomToken(): string { return randomBytes(32).toString('base64url') }
function exactScope(left: SiteAiScope, right: SiteAiScope): boolean { return canonical(left) === canonical(right) }
function exactText(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.byteLength === b.byteLength && timingSafeEqual(a, b)
}
function feeDisclosure() {
  return Object.freeze({
    version: AI_PAYMENT_FEE_DISCLOSURE_VERSION,
    currency: 'KES' as const,
    fumaPlatformFeeMinor: 0 as const,
    providerFeeNotice: 'Paystack fees are charged under the merchant account and are not controlled by AI.' as const,
    customerChargeNotice: 'Confirmation and credential storage do not charge a customer. A separate explicit checkout sets the amount.' as const,
    previewAmountMinor: AI_PAYMENT_PREVIEW_AMOUNT_MINOR,
  })
}
function merchantScope(scope: SiteAiScope) {
  return Object.freeze({
    platformId: scope.platformId,
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    siteId: scope.siteId,
    ownerKey: scope.ownerKey,
    ownerGeneration: scope.ownerGeneration,
  })
}
function assertActor(proposal: AiPaymentSetupProposal, authority: AiPaymentSetupActorAuthority): void {
  if (proposal.actorId !== authority.actorId || !exactScope(proposal.scope, authority.scope)) {
    throw new AiPaymentSetupError('not-found', 'AI payment setup proposal is unavailable.')
  }
}
function reviewEvidence(artifact: MarketplaceArtifact) {
  return Object.freeze({
    submissionId: artifact.submissionId,
    decisionId: artifact.decisionId,
    signatureKeyId: artifact.signatureKeyId,
    artifactId: artifact.artifactId,
    packageId: AI_PAYMENT_PLUGIN_PACKAGE_ID as typeof AI_PAYMENT_PLUGIN_PACKAGE_ID,
    exactVersion: AI_PAYMENT_PLUGIN_EXACT_VERSION as typeof AI_PAYMENT_PLUGIN_EXACT_VERSION,
    contentHashSha256: artifact.contentHashSha256,
    permissions: [...AI_PAYMENT_PLUGIN_PERMISSIONS],
  })
}

export class AiPaymentSetupService {
  readonly #repository: AiPaymentSetupRepository
  readonly #conversations: Pick<SiteAiRepository, 'conversation'>
  readonly #reviews: ArtifactReviewService
  readonly #artifacts: ArtifactInstallationAuthority
  readonly #payments: Pick<CustomerMerchantPaymentService, 'attachCredential'>
  readonly #preview: AiPaymentTestPreviewPort
  readonly #now: () => Date
  readonly #token: () => string

  constructor(input: Readonly<{
    repository: AiPaymentSetupRepository
    conversations: Pick<SiteAiRepository, 'conversation'>
    reviews: ArtifactReviewService
    artifacts: ArtifactInstallationAuthority
    payments: Pick<CustomerMerchantPaymentService, 'attachCredential'>
    preview: AiPaymentTestPreviewPort
    now?: () => Date
    token?: () => string
  }>) {
    this.#repository = input.repository
    this.#conversations = input.conversations
    this.#reviews = input.reviews
    this.#artifacts = input.artifacts
    this.#payments = input.payments
    this.#preview = input.preview
    this.#now = input.now ?? (() => new Date())
    this.#token = input.token ?? randomToken
  }

  async proposeFromAi(rawContext: unknown, rawInput: unknown): Promise<AiPaymentSetupProposalView> {
    const context = rawContext as Readonly<{ conversationId?: unknown; toolCallId?: unknown; actorId?: unknown }>
    if (typeof context?.conversationId !== 'string' || typeof context.toolCallId !== 'string' || typeof context.actorId !== 'string') {
      throw new AiPaymentSetupError('invalid-contract', 'Trusted AI payment proposal context is invalid.')
    }
    const input = parseAiPaymentSetupContract(ProposeAiPaymentSetupInputSchema, rawInput, 'AI payment proposal input')
    const conversation = await this.#conversations.conversation(context.conversationId)
    if (!conversation || conversation.actor.actorId !== context.actorId) throw new AiPaymentSetupError('denied', 'Active exact site AI conversation authority is required.')
    const reviewed = await this.#reviewedPaymentPlugin()
    const at = validNow(this.#now)
    const proposalId = `ai-payment:${sha256(`${context.conversationId}\0${context.toolCallId}`).slice(0, 40)}`
    const candidate = parseAiPaymentSetupContract(AiPaymentSetupProposalSchema, {
      schemaVersion: 1,
      proposalId,
      conversationId: context.conversationId,
      toolCallId: context.toolCallId,
      scope: conversation.scope,
      actorId: context.actorId,
      review: reviewEvidence(reviewed),
      purpose: input.purpose,
      blockId: blockForPurpose(input.purpose),
      amountAuthority: 'customer-or-merchant-explicit-input',
      feeDisclosure: feeDisclosure(),
      state: 'proposed',
      challenge: null,
      confirmationId: null,
      installationId: null,
      credentialId: null,
      preview: null,
      createdAt: at,
      expiresAt: plus(at, PROPOSAL_LIFETIME_MS),
      confirmedAt: null,
      credentialStoredAt: null,
      testedAt: null,
    }, 'AI payment setup proposal') as AiPaymentSetupProposal
    const existing = await this.#repository.read(proposalId)
    if (existing) {
      if (existing.conversationId !== candidate.conversationId || existing.toolCallId !== candidate.toolCallId
        || existing.actorId !== candidate.actorId || !exactScope(existing.scope, candidate.scope)
        || existing.purpose !== candidate.purpose || canonical(existing.review) !== canonical(candidate.review)) {
        throw new AiPaymentSetupError('conflict', 'AI payment proposal retry identity changed.')
      }
      return proposalView(existing)
    }
    if (!await this.#repository.insert(candidate)) return await this.proposeFromAi(context, input)
    return proposalView(candidate)
  }

  async read(authority: AiPaymentSetupActorAuthority, proposalId: string): Promise<AiPaymentSetupProposalView> {
    const proposal = await this.#required(proposalId)
    assertActor(proposal, authority)
    await this.#assertCurrentReview(proposal)
    return proposalView(proposal)
  }

  async registerChallenge(authority: AiPaymentSetupActorAuthority, proposalId: string, raw: unknown): Promise<AiPaymentSetupProposalView> {
    const command = parseAiPaymentSetupContract(RegisterAiPaymentChallengeCommandSchema, raw, 'AI payment confirmation challenge')
    const proposal = await this.#required(proposalId)
    assertActor(proposal, authority)
    const at = validNow(this.#now)
    if (proposal.state !== 'proposed' || proposal.expiresAt <= at) throw new AiPaymentSetupError('expired', 'AI payment proposal is no longer confirmable.')
    await this.#assertCurrentReview(proposal)
    const updated = await this.#repository.setChallenge(proposal, {
      challengeId: command.challengeId,
      nonceHashSha256: command.nonceHashSha256,
      expiresAt: plus(at, CHALLENGE_LIFETIME_MS),
    })
    if (!updated) throw new AiPaymentSetupError('conflict', 'AI payment confirmation challenge changed concurrently.')
    return proposalView(updated)
  }

  async confirm(authority: AiPaymentSetupConfirmationAuthority, proposalId: string, raw: unknown): Promise<Readonly<{ proposal: AiPaymentSetupProposalView; handoffToken: string | null }>> {
    const command = parseAiPaymentSetupContract(ConfirmAiPaymentSetupCommandSchema, raw, 'AI payment confirmation')
    const proposal = await this.#required(proposalId)
    assertActor(proposal, authority)
    const at = validNow(this.#now)
    const sessionAgeMs = Date.parse(at) - authority.session.createdAt.getTime()
    if (authority.session.userId !== authority.actorId || authority.session.impersonatedBy !== null
      || !Number.isFinite(sessionAgeMs) || sessionAgeMs < 0 || sessionAgeMs >= authority.freshSessionMs) {
      throw new AiPaymentSetupError('denied', 'A fresh direct hosted staff session is required for payment setup confirmation.')
    }
    if (proposal.state !== 'proposed') {
      if (proposal.confirmationId !== command.confirmationId) throw new AiPaymentSetupError('conflict', 'AI payment proposal already has another confirmation.')
      return Object.freeze({ proposal: proposalView(proposal), handoffToken: null })
    }
    if (proposal.expiresAt <= at || !proposal.challenge || proposal.challenge.expiresAt <= at || proposal.challenge.challengeId !== command.challengeId
      || !exactText(proposal.challenge.nonceHashSha256, sha256(command.confirmationNonce))) {
      throw new AiPaymentSetupError('expired', 'AI payment confirmation challenge is invalid or expired.')
    }
    if (command.acceptedArtifactId !== proposal.review.artifactId || command.acceptedContentHashSha256 !== proposal.review.contentHashSha256
      || command.acceptedExactVersion !== proposal.review.exactVersion || !exactAiPaymentPermissions(command.acceptedPermissions)
      || canonical([...command.acceptedPermissions].sort()) !== canonical([...proposal.review.permissions].sort())
      || command.acceptedFeeDisclosureVersion !== proposal.feeDisclosure.version || command.acceptedPurpose !== proposal.purpose
      || command.acceptedBlockId !== proposal.blockId) {
      throw new AiPaymentSetupError('denied', 'Explicit confirmation must accept the exact reviewed artifact, grants, fees, purpose, and block.')
    }
    const approved = await this.#assertCurrentReview(proposal)
    const installationId = `ai-payment-install:${sha256(proposal.proposalId).slice(0, 36)}`
    const installation = await this.#reviews.install({
      submissionId: approved.submission.submissionId,
      grantedPermissions: proposal.review.permissions,
      installation: {
        platformId: proposal.scope.platformId,
        organizationId: proposal.scope.organizationId,
        workspaceId: proposal.scope.workspaceId,
        siteId: proposal.scope.siteId,
        ownerKey: proposal.scope.ownerKey,
        ownerGeneration: proposal.scope.ownerGeneration,
        installationId,
        artifactId: proposal.review.artifactId,
        artifactKind: 'plugin',
        packageId: proposal.review.packageId,
        exactVersion: proposal.review.exactVersion,
        contentHashSha256: proposal.review.contentHashSha256,
        executionPolicy: 'plugin-sandbox-worker',
        settingsObjectKey: null,
        secret: null,
        state: 'active',
        workerGeneration: 1,
        quota: { storageBytes: 104_857_600, scheduledJobs: 100, callsPerMinute: 60 },
        previousArtifactId: null,
        version: 1,
        installedAt: at,
        updatedAt: at,
      },
    })
    const token = this.#token()
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AiPaymentSetupError('unavailable', 'Secure payment handoff token source is invalid.')
    const handoff: AiPaymentSetupHandoff = Object.freeze({
      handoffId: `ai-payment-handoff:${sha256(proposal.proposalId).slice(0, 36)}`,
      proposalId: proposal.proposalId,
      tokenHashSha256: sha256(token),
      audience: 'secure-payment-settings',
      state: 'issued',
      expiresAt: plus(at, HANDOFF_LIFETIME_MS),
      createdAt: at,
      consumedAt: null,
    })
    const next = parseAiPaymentSetupContract(AiPaymentSetupProposalSchema, {
      ...proposal,
      state: 'confirmed',
      confirmationId: command.confirmationId,
      installationId: installation.installationId,
      confirmedAt: at,
    }, 'Confirmed AI payment setup proposal') as AiPaymentSetupProposal
    if (!await this.#repository.confirm(proposal, next, handoff)) throw new AiPaymentSetupError('conflict', 'AI payment confirmation changed concurrently.')
    return Object.freeze({ proposal: proposalView(next), handoffToken: token })
  }

  async storeCredential(authority: AiPaymentSetupActorAuthority, proposalId: string, handoffToken: string, raw: unknown): Promise<AiPaymentSetupProposalView> {
    const command = parseAiPaymentSetupContract(StoreAiPaymentCredentialCommandSchema, raw, 'Secure AI payment credential')
    const expectedMode = command.testMode ? 'test' : 'live'
    if (!command.publicKey.startsWith(`pk_${expectedMode}_`) || !command.secretKey.startsWith(`sk_${expectedMode}_`)) {
      throw new AiPaymentSetupError('denied', 'Public and secret keys must match the explicitly selected provider mode.')
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(handoffToken)) throw new AiPaymentSetupError('not-found', 'Secure payment handoff is unavailable.')
    const at = validNow(this.#now)
    const proposal = await this.#required(proposalId)
    assertActor(proposal, authority)
    const claimed = await this.#repository.claimHandoff(proposalId, sha256(handoffToken), at)
    if (!claimed) throw new AiPaymentSetupError('not-found', 'Secure payment handoff is unavailable or already consumed.')
    await this.#assertCurrentReview(claimed.proposal)
    if (!claimed.proposal.installationId) throw new AiPaymentSetupError('denied', 'Reviewed payment installation is unavailable.')
    const installation = await this.#artifacts.readInstallation({
      platformId: claimed.proposal.scope.platformId,
      ownerKey: claimed.proposal.scope.ownerKey,
      installationId: claimed.proposal.installationId,
    })
    if (!installation || installation.state !== 'active' || installation.ownerGeneration !== claimed.proposal.scope.ownerGeneration
      || installation.artifactId !== claimed.proposal.review.artifactId || installation.contentHashSha256 !== claimed.proposal.review.contentHashSha256) {
      throw new AiPaymentSetupError('denied', 'Reviewed payment installation authority changed.')
    }
    const credentialId = `ai-payment-credential:${sha256(claimed.proposal.proposalId).slice(0, 32)}`
    await this.#payments.attachCredential(merchantScope(claimed.proposal.scope), {
      scope: 'customer_merchant',
      publicKey: command.publicKey,
      secretKey: command.secretKey,
    }, credentialId)
    const stored = parseAiPaymentSetupContract(AiPaymentSetupProposalSchema, {
      ...claimed.proposal,
      state: 'credential-stored',
      credentialId,
      credentialStoredAt: at,
    }, 'Credential-stored AI payment proposal') as AiPaymentSetupProposal
    if (!await this.#repository.completeCredential(claimed.proposal, stored, claimed.handoff)) {
      throw new AiPaymentSetupError('conflict', 'Secure payment credential completion changed concurrently.')
    }
    if (!command.testMode) return proposalView(stored)
    const preview = await this.#preview.settle({
      proposal: stored,
      installation,
      credentialId,
      amountMinor: AI_PAYMENT_PREVIEW_AMOUNT_MINOR,
      currency: 'KES',
    })
    if (preview.purpose !== stored.purpose || !/^[a-f0-9]{64}$/.test(preview.receiptFingerprintSha256)) {
      throw new AiPaymentSetupError('unavailable', 'Payment test preview returned invalid shared-ledger evidence.')
    }
    const testedAt = validNow(this.#now)
    const tested = parseAiPaymentSetupContract(AiPaymentSetupProposalSchema, {
      ...stored,
      state: 'tested',
      preview: {
        state: 'settled',
        purpose: stored.purpose,
        amountMinor: AI_PAYMENT_PREVIEW_AMOUNT_MINOR,
        currency: 'KES',
        receiptFingerprintSha256: preview.receiptFingerprintSha256,
      },
      testedAt,
    }, 'Tested AI payment proposal') as AiPaymentSetupProposal
    if (!await this.#repository.completePreview(stored, tested)) throw new AiPaymentSetupError('conflict', 'Payment test preview completion changed concurrently.')
    return proposalView(tested)
  }

  async #reviewedPaymentPlugin(): Promise<MarketplaceArtifact> {
    const matches = (await this.#reviews.marketplace(100)).filter((artifact) => artifact.kind === 'plugin'
      && artifact.packageId === AI_PAYMENT_PLUGIN_PACKAGE_ID && artifact.exactVersion === AI_PAYMENT_PLUGIN_EXACT_VERSION)
    if (matches.length !== 1 || !exactAiPaymentPermissions(matches[0]!.permissions)) {
      throw new AiPaymentSetupError('unavailable', 'The exact reviewed customer-payment plugin is unavailable.')
    }
    return matches[0]!
  }

  async #required(proposalId: string): Promise<AiPaymentSetupProposal> {
    const value = await this.#repository.read(proposalId)
    if (!value) throw new AiPaymentSetupError('not-found', 'AI payment setup proposal is unavailable.')
    return value
  }

  async #assertCurrentReview(proposal: AiPaymentSetupProposal) {
    const approved = await this.#reviews.verify(proposal.review.submissionId)
    const artifact = approved.submission.artifact
    if (approved.decision.decisionId !== proposal.review.decisionId || approved.decision.signature?.keyId !== proposal.review.signatureKeyId
      || artifact.artifactId !== proposal.review.artifactId || artifact.kind !== 'plugin' || artifact.packageId !== proposal.review.packageId
      || artifact.exactVersion !== proposal.review.exactVersion || artifact.contentHashSha256 !== proposal.review.contentHashSha256
      || canonical([...artifact.permissions].sort()) !== canonical([...proposal.review.permissions].sort()) || !exactAiPaymentPermissions(artifact.permissions)) {
      throw new AiPaymentSetupError('denied', 'Reviewed payment artifact authority changed.')
    }
    return approved
  }
}

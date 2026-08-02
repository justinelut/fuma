import { createHash } from 'node:crypto'
import type { DbClient } from '../../db/client'
import { configureSitePaymentSetupProposalPort } from '../../ai/tools/site/paymentSetupPort'
import type { HostedResolvedSession } from '../../auth/hosted/auth'
import type { ArtifactInstallationAuthority } from '../artifacts'
import type { ArtifactReviewService } from '../artifactReviews'
import type { CustomerMerchantPluginPaymentService } from '../customerPayments/plugin'
import type { CustomerMerchantPaymentService } from '../customerPayments/service'
import type { SiteAiRepository } from '../siteAi/repository'
import { PostgresAiPaymentSetupRepository } from './postgres'
import { createAiPaymentSetupScopedRoutes } from './routes'
import { AiPaymentSetupService, type AiPaymentTestPreviewPort } from './service'
import type { SiteAiScope } from '../siteAi/contracts'

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}
function fingerprint(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex') }

/** Test-mode adapter over the existing FUMA-069 plugin service, transport, purpose registry, and ledger. */
export class SharedCustomerPaymentTestPreview implements AiPaymentTestPreviewPort {
  readonly #payments: CustomerMerchantPluginPaymentService
  readonly #siteOrigin: (scope: SiteAiScope) => Promise<string> | string

  constructor(input: Readonly<{
    payments: CustomerMerchantPluginPaymentService
    siteOrigin(scope: SiteAiScope): Promise<string> | string
  }>) {
    this.#payments = input.payments
    this.#siteOrigin = input.siteOrigin
  }

  async settle(input: Parameters<AiPaymentTestPreviewPort['settle']>[0]) {
    const proposal = input.proposal
    const authority = Object.freeze({
      merchantScope: Object.freeze({
        platformId: proposal.scope.platformId,
        organizationId: proposal.scope.organizationId,
        workspaceId: proposal.scope.workspaceId,
        siteId: proposal.scope.siteId,
        ownerKey: proposal.scope.ownerKey,
        ownerGeneration: proposal.scope.ownerGeneration,
      }),
      installationId: input.installation.installationId,
      artifactId: proposal.review.artifactId,
      packageId: proposal.review.packageId,
      exactVersion: proposal.review.exactVersion,
      contentHashSha256: proposal.review.contentHashSha256,
      reviewSubmissionId: proposal.review.submissionId,
      reviewDecisionId: proposal.review.decisionId,
      reviewSignatureKeyId: proposal.review.signatureKeyId,
      siteOrigin: await this.#siteOrigin(proposal.scope),
    })
    const initialized = await this.#payments.create(authority, {
      requestId: `setup-preview:${fingerprint(proposal.proposalId).slice(0, 32)}`,
      purpose: proposal.purpose,
      amountMinor: input.amountMinor,
      currency: input.currency,
      payerEmail: 'fuma-payment-preview@example.test',
      returnPath: '/secure-payment/preview-complete',
    })
    const receipt = await this.#payments.receipt(authority, {
      paymentId: initialized.paymentId,
      reference: initialized.reference,
    })
    return Object.freeze({
      purpose: receipt.purpose,
      receiptFingerprintSha256: fingerprint(receipt),
    })
  }
}

export function createHostedAiPaymentSetupRuntime(input: Readonly<{
  db: DbClient
  conversations: Pick<SiteAiRepository, 'conversation'>
  reviews: ArtifactReviewService
  artifacts: ArtifactInstallationAuthority
  credentials: Pick<CustomerMerchantPaymentService, 'attachCredential'>
  pluginPayments: CustomerMerchantPluginPaymentService
  siteOrigin(scope: SiteAiScope): Promise<string> | string
  resolveSession(headers: Headers): Promise<HostedResolvedSession | null>
  freshSessionMs: number
  now?: () => Date
  token?: () => string
}>) {
  const repository = new PostgresAiPaymentSetupRepository(input.db)
  const preview = new SharedCustomerPaymentTestPreview({ payments: input.pluginPayments, siteOrigin: input.siteOrigin })
  const service = new AiPaymentSetupService({
    repository,
    conversations: input.conversations,
    reviews: input.reviews,
    artifacts: input.artifacts,
    payments: input.credentials,
    preview,
    ...(input.now ? { now: input.now } : {}),
    ...(input.token ? { token: input.token } : {}),
  })
  const scopedRoutes = createAiPaymentSetupScopedRoutes({
    service,
    resolveSession: input.resolveSession,
    freshSessionMs: input.freshSessionMs,
  })
  const unbindProposalTool = configureSitePaymentSetupProposalPort({
    propose: async (command) => await service.proposeFromAi({
      conversationId: command.conversationId,
      toolCallId: command.toolCallId,
      actorId: command.actorId,
    }, { purpose: command.purpose }),
  })
  return Object.freeze({ repository, preview, service, scopedRoutes, unbindProposalTool })
}

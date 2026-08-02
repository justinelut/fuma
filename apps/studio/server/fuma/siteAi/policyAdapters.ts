import type { AiCatalogService } from '../aiCatalog'
import type {
  AiCreditService,
  AiTurnMode,
} from '../aiCredits'
import type {
  SiteAiCreditAuthorityPort,
  SiteAiModelAuthorityPort,
} from './service'
import type { SiteAiScope } from './contracts'

type ModelAuthorization = Parameters<SiteAiModelAuthorityPort['authorize']>[0]
type CreditReservation = Parameters<SiteAiCreditAuthorityPort['reserve']>[0]
type CreditSettlement = Parameters<SiteAiCreditAuthorityPort['settle']>[0]
type CreditRelease = Parameters<SiteAiCreditAuthorityPort['release']>[0]

function audience(scope: SiteAiScope) {
  return Object.freeze({
    kind: 'customer' as const,
    platformId: scope.platformId,
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    siteId: scope.siteId,
    profile: scope.profileId,
  })
}

export function createSiteAiCatalogAuthority(
  catalog: Pick<AiCatalogService, 'quote'>,
): SiteAiModelAuthorityPort {
  return Object.freeze({
    async authorize(input: ModelAuthorization) {
      await catalog.quote(audience(input.scope), {
        providerId: input.providerId,
        modelId: input.modelId,
        inputTokens: 0,
        outputTokens: 0,
      })
    },
  })
}

export interface SiteAiCreditAccountLocator {
  locate(scope: SiteAiScope): Promise<Readonly<{
    accountId: string
    mode: AiTurnMode
    byokCredentialId: string | null
  }>>
}

/**
 * Adapts site turns to the finalized credit authority. Stable reservation/job
 * IDs make reserve, settle, and release replay-safe; no credential material is
 * accepted or projected by this seam.
 */
export function createSiteAiCreditAuthority(input: Readonly<{
  credits: Pick<AiCreditService, 'view' | 'reserve' | 'settle' | 'release'>
  accounts: SiteAiCreditAccountLocator
  now?: () => Date
}>): SiteAiCreditAuthorityPort {
  const now = input.now ?? (() => new Date())
  return Object.freeze({
    async reserve(command: CreditReservation) {
      const account = await input.accounts.locate(command.scope)
      const view = await input.credits.view(account.accountId)
      await input.credits.reserve({
        reservationId: command.reservationId,
        accountId: account.accountId,
        scope: command.scope,
        audience: audience(command.scope),
        providerId: command.providerId,
        modelId: command.modelId,
        estimatedInputTokens: command.estimatedInputTokens,
        estimatedOutputTokens: command.estimatedOutputTokens,
        mode: account.mode,
        byokCredentialId: account.byokCredentialId,
        expiresAt: new Date(now().getTime() + 30 * 60_000).toISOString(),
        expectedAccountVersion: view.version,
        idempotencyKey: `site-ai-reserve:${command.jobId}`,
      })
    },
    async settle(command: CreditSettlement) {
      await input.credits.settle({
        reservationId: command.reservationId,
        inputTokens: command.promptTokens,
        outputTokens: command.completionTokens,
        idempotencyKey: `site-ai-settle:${command.jobId}`,
        expectedReservationVersion: 1,
      })
    },
    async release(command: CreditRelease) {
      await input.credits.release({
        reservationId: command.reservationId,
        idempotencyKey: `site-ai-release:${command.jobId}:${command.reasonCode}`,
        expectedReservationVersion: 1,
      })
    },
  })
}

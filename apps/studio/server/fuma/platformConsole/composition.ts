import {
  PlatformConsoleRegistry,
  type ConsoleActionDelegate,
} from '../../../../../packages/fuma-governance-launch/src/operations'
import type { ConsoleActionResult } from '../../../../../packages/fuma-governance-launch/src/contracts'
import type { ArtifactReviewService } from '../artifactReviews/service'
import { artifactReviewConsoleContribution } from '../artifactReviews/consoleContribution'
import type { EntitlementService } from '../entitlements/service'

export const futurePlatformConsoleSeams = Object.freeze([
  Object.freeze({ ownerTicket: 'FUMA-072' as const, contributionId: 'support-moderation', mounted: false as const }),
  Object.freeze({ ownerTicket: 'FUMA-073' as const, contributionId: 'expert-moderation', mounted: false as const }),
  Object.freeze({ ownerTicket: 'FUMA-074' as const, contributionId: 'transfer-recovery', mounted: false as const }),
])

function completed(
  actionId: string,
  requestId: string,
  resourceId: string,
  resourceVersion: number | null,
): ConsoleActionResult {
  return Object.freeze({ actionId, requestId, state: 'completed', resourceId, resourceVersion })
}

/**
 * Delegates private-offer issuance to FUMA-054's sole commercial authority.
 * The console accepts only the canonical draft; economics, cost completeness,
 * quota finiteness, margin, destination and immutable issuance are recomputed
 * by EntitlementService.propose/issue.
 */
export function customOfferIssueConsoleDelegate(
  entitlements: Pick<EntitlementService, 'propose' | 'issue'>,
): ConsoleActionDelegate {
  return Object.freeze({
    actionId: 'commercial.offer.issue',
    requiredAuthority: 'internal.commercial.offer.issue',
    requiresFreshStepUp: true,
    async execute(input: unknown, context: Readonly<{ actorId: string; requestId: string; now: string }>) {
      const draft = await entitlements.propose(input)
      const issued = await entitlements.issue(draft)
      return completed('commercial.offer.issue', context.requestId, issued.offerId, issued.version)
    },
  })
}

/** Mounts FUMA-068's bounded metadata and delegates decisions to its one review service. */
export function registerArtifactReviewConsole(
  registry: PlatformConsoleRegistry,
  reviews: Pick<ArtifactReviewService, 'decide' | 'revoke'>,
): void {
  registry.register(artifactReviewConsoleContribution)
  registry.registerAction(Object.freeze({
    actionId: 'artifact-review.decide',
    requiredAuthority: 'internal.plugins.review',
    requiresFreshStepUp: true,
    async execute(input: unknown, context: Readonly<{ actorId: string; requestId: string; now: string }>) {
      const command = typeof input === 'object' && input !== null
        ? { ...(input as Record<string, unknown>), reviewerId: context.actorId }
        : input
      const decision = await reviews.decide(command)
      return completed('artifact-review.decide', context.requestId, decision.decisionId, null)
    },
  }))
  registry.registerAction(Object.freeze({
    actionId: 'artifact-review.revoke',
    requiredAuthority: 'internal.plugins.review',
    requiresFreshStepUp: true,
    async execute(input: unknown, context: Readonly<{ actorId: string; requestId: string; now: string }>) {
      const command = typeof input === 'object' && input !== null
        ? { ...(input as Record<string, unknown>), actorId: context.actorId }
        : input
      const revocation = await reviews.revoke(command)
      return completed('artifact-review.revoke', context.requestId, revocation.revocationId, null)
    },
  }))
}

export function composePlatformConsole(input: Readonly<{
  entitlements: Pick<EntitlementService, 'propose' | 'issue'>
  reviews: Pick<ArtifactReviewService, 'decide' | 'revoke'>
}>): PlatformConsoleRegistry {
  const registry = new PlatformConsoleRegistry()
  registry.registerAction(customOfferIssueConsoleDelegate(input.entitlements))
  registerArtifactReviewConsole(registry, input.reviews)
  return registry
}

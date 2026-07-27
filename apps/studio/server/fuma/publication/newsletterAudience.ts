import {
  NewsletterAudienceEstimateSchema,
  NewsletterAudienceQuerySchema,
  parseNewsletterComposerContract,
  type NewsletterAudienceEstimate,
  type NewsletterAudienceQuery,
} from '@core/fuma/publication/newsletterComposerContracts'
import type { PublicationMemberSegment, PublicationSegmentMembershipSnapshot } from '@core/fuma/publication'
import type { PublicationRepositoryScope } from './scope'
import { PublicationMemberAccessError, type PublicationMemberAccessService } from './memberAccess'
import type { NewsletterAudienceAuthority } from './newsletterComposer'

const SEGMENT_PAGE_LIMIT = 200

export class PublicationMemberAudienceAuthority implements NewsletterAudienceAuthority {
  readonly #members: Pick<PublicationMemberAccessService, 'listSegments' | 'recalculateSegment' | 'consentState'>
  readonly #now: () => Date

  constructor(
    members: Pick<PublicationMemberAccessService, 'listSegments' | 'recalculateSegment' | 'consentState'>,
    now: () => Date = () => new Date(),
  ) {
    this.#members = members
    this.#now = now
  }

  async segmentExists(scope: PublicationRepositoryScope, segmentId: string): Promise<boolean> {
    return (await this.#segments(scope)).some((segment) => segment.segmentId === segmentId)
  }

  async estimate(scope: PublicationRepositoryScope, newsletterId: string, audienceInput: NewsletterAudienceQuery): Promise<NewsletterAudienceEstimate> {
    const audience = parseNewsletterComposerContract('Newsletter audience query', NewsletterAudienceQuerySchema, audienceInput)
    const available = new Map((await this.#segments(scope)).map((segment) => [segment.segmentId, segment]))
    const snapshots: PublicationSegmentMembershipSnapshot[] = []
    for (const segmentId of audience.segmentIds) {
      if (!available.has(segmentId)) throw new PublicationMemberAccessError('not-found')
      snapshots.push(await this.#members.recalculateSegment(scope, segmentId, this.#now().toISOString()))
    }
    const candidates = combineMemberships(snapshots, audience.match)
    const evaluated = candidates.slice(0, audience.scanLimit)
    let estimatedSubscribed = 0
    for (const memberId of evaluated) {
      try {
        if ((await this.#members.consentState(scope, memberId, newsletterId)).subscribed) estimatedSubscribed += 1
      } catch (error) {
        if (!(error instanceof PublicationMemberAccessError) || error.code !== 'not-found') throw error
      }
    }
    return parseNewsletterComposerContract('Newsletter audience estimate', NewsletterAudienceEstimateSchema, {
      newsletterId,
      audience,
      estimatedSubscribed,
      evaluatedMembers: evaluated.length,
      candidateMembers: candidates.length,
      countKind: candidates.length > audience.scanLimit ? 'lower-bound' : 'exact',
      segmentVersions: snapshots.map((snapshot) => ({ segmentId: snapshot.segmentId, version: snapshot.segmentVersion })),
      estimatedAt: this.#now().toISOString(),
    })
  }

  async #segments(scope: PublicationRepositoryScope): Promise<readonly PublicationMemberSegment[]> {
    return await this.#members.listSegments(scope, { limit: SEGMENT_PAGE_LIMIT, afterId: null })
  }
}

function combineMemberships(snapshots: readonly PublicationSegmentMembershipSnapshot[], match: NewsletterAudienceQuery['match']): readonly string[] {
  if (snapshots.length === 0) return Object.freeze([])
  const counts = new Map<string, number>()
  for (const snapshot of snapshots) for (const memberId of new Set(snapshot.memberIds)) counts.set(memberId, (counts.get(memberId) ?? 0) + 1)
  const required = match === 'all' ? snapshots.length : 1
  return Object.freeze([...counts].filter(([, count]) => count >= required).map(([memberId]) => memberId).sort())
}

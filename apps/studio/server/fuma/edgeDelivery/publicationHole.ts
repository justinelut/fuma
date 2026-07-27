import type { PublicationSchedulingService } from '../publication/schedulingAccess'
import { bindPublicationScope } from '../publication/scope'
import type { FumaRepositoryScope } from '../tenancy'
import type { EdgeHoleResolver, EdgeRequestContext } from './service'

function publicationScope(context: EdgeRequestContext) {
  const scope: FumaRepositoryScope = {
    platformId: context.platformId,
    organizationId: context.organizationId,
    workspaceId: context.workspaceId,
    siteId: context.siteId,
    ownerKey: context.ownerKey,
    generation: context.ownerGeneration,
    state: 'active',
    transferFence: null,
  }
  return bindPublicationScope(scope, 'website')
}

/** Member-private FUMA-036/FUMA-039 access presentation, never caller HTML. */
export class PublicationAccessEdgeHoleResolver implements EdgeHoleResolver {
  readonly id = 'publication-access'
  readonly scope = 'member' as const
  readonly #scheduling: Pick<PublicationSchedulingService, 'resolve'>

  constructor(scheduling: Pick<PublicationSchedulingService, 'resolve'>) {
    this.#scheduling = scheduling
  }

  async resolve(context: EdgeRequestContext, input: Readonly<Record<string, string | number | boolean | null>>): Promise<string> {
    if (typeof input.contentId !== 'string') throw new TypeError('Publication access hole requires contentId.')
    const identity = context.requestClaims.memberIdentityId
    if (!identity) throw new TypeError('Publication access hole requires trusted member identity.')
    const result = await this.#scheduling.resolve(publicationScope(context), {
      contentId: input.contentId,
      previewToken: null,
      requestedPath: context.path,
    }, identity, `https://${context.host}`)
    return result.presentation.html ?? ''
  }
}

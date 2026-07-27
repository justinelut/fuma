import { Type, safeParseValue, type Static } from '@core/utils/typeboxHelpers'
import { FumaRepositoryScopeSchema, type FumaRepositoryScope } from '../tenancy'

const activeScope = FumaRepositoryScopeSchema.anyOf[0].properties

export const PublicationRepositoryScopeSchema = Type.Object({
  platformId: activeScope.platformId,
  organizationId: activeScope.organizationId,
  workspaceId: activeScope.workspaceId,
  siteId: activeScope.siteId,
  ownerKey: activeScope.ownerKey,
  generation: activeScope.generation,
  state: Type.Literal('active'),
  transferFence: Type.Null(),
  profileId: Type.String({ minLength: 1, maxLength: 255, pattern: '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$' }),
}, { additionalProperties: false })

export type PublicationRepositoryScope = Readonly<Static<typeof PublicationRepositoryScopeSchema>>

export class PublicationScopeError extends Error {
  readonly code = 'scope-denied' as const
  constructor() {
    super('Publication repository scope authority denied.')
    this.name = 'PublicationScopeError'
  }
}

export function bindPublicationScope(
  repositoryScope: FumaRepositoryScope,
  trustedProfileId: string,
): PublicationRepositoryScope {
  const parsed = safeParseValue(PublicationRepositoryScopeSchema, {
    ...repositoryScope,
    profileId: trustedProfileId,
  })
  if (!parsed.ok) throw new PublicationScopeError()
  return Object.freeze(structuredClone(parsed.value))
}

export function samePublicationScope(
  left: PublicationRepositoryScope,
  right: PublicationRepositoryScope,
): boolean {
  return left.platformId === right.platformId
    && left.organizationId === right.organizationId
    && left.workspaceId === right.workspaceId
    && left.siteId === right.siteId
    && left.ownerKey === right.ownerKey
    && left.generation === right.generation
    && left.profileId === right.profileId
}

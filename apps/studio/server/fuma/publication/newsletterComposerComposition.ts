import type { DbClient } from '../../db/client'
import type { PublicationDomainStore, PublicationIdAuthority } from './servicePorts'
import type { PublicationMemberAccessService } from './memberAccess'
import type { HierarchicalEmailSettingsService } from './emailSettings'
import { NewsletterComposerService } from './newsletterComposer'
import { PostgresNewsletterComposerRepository } from './newsletterComposerPostgres'
import { PublicationMemberAudienceAuthority } from './newsletterAudience'
import { createNewsletterComposerScopedRouteDeclarations } from './newsletterComposerRoutes'

export type NewsletterComposerCompositionInput = Readonly<{
  db: DbClient
  content: Pick<PublicationDomainStore, 'getContent'>
  memberAccess: Pick<PublicationMemberAccessService, 'listSegments' | 'recalculateSegment' | 'consentState'>
  emailSettings: Pick<HierarchicalEmailSettingsService, 'resolve'>
  ids: PublicationIdAuthority
  now?: () => Date
}>

export function createNewsletterComposerServiceGraph(input: NewsletterComposerCompositionInput) {
  const repository = new PostgresNewsletterComposerRepository(input.db)
  const audience = new PublicationMemberAudienceAuthority(input.memberAccess, input.now)
  const service = new NewsletterComposerService({ repository, content: input.content, settings: input.emailSettings, audience, ids: input.ids, now: input.now })
  return Object.freeze({
    repository,
    audience,
    service,
    scopedRoutes: createNewsletterComposerScopedRouteDeclarations({ service }),
  })
}

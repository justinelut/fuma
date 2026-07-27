import type {
  CampaignDelivery,
  CampaignSnapshot,
  DeliverabilitySummary,
  EmailSettingsLayer,
  Newsletter,
  NewsletterVersion,
  OciEmailProviderEvent,
  PublicationAccessGrant,
  PublicationAnalyticsEvent,
  PublicationAnalyticsSummary,
  PublicationAuthor,
  PublicationContent,
  PublicationContentImport,
  PublicationMember,
  PublicationReaderAccount,
  PublicationSegment,
  PublicationSettings,
  PublicationTag,
  PublicationTemplate,
  PublicationWorkflowTransition,
  Suppression,
  UnsubscribeTokenClaims,
} from '@core/fuma/publication'
import type { PublicationRepositoryScope } from './scope'

export interface PublicationDomainStore {
  getContent(scope: PublicationRepositoryScope, contentId: string): Promise<PublicationContent | null>
  listContent(scope: PublicationRepositoryScope): Promise<readonly PublicationContent[]>
  putContent(scope: PublicationRepositoryScope, content: PublicationContent, expectedVersion: number | null): Promise<boolean>
  importContent(scope: PublicationRepositoryScope, input: PublicationContentImport): Promise<boolean>
  deleteContent(scope: PublicationRepositoryScope, contentId: string, expectedVersion: number): Promise<boolean>
  listAuthors(scope: PublicationRepositoryScope): Promise<readonly PublicationAuthor[]>
  getSettings(scope: PublicationRepositoryScope): Promise<PublicationSettings | null>
  putSettings(scope: PublicationRepositoryScope, settings: PublicationSettings, expectedVersion: number | null): Promise<boolean>
  putTag(scope: PublicationRepositoryScope, tag: PublicationTag): Promise<boolean>
  listTags(scope: PublicationRepositoryScope): Promise<readonly PublicationTag[]>
  appendWorkflowTransition(scope: PublicationRepositoryScope, transition: PublicationWorkflowTransition): Promise<boolean>
  commitWorkflowTransition(scope: PublicationRepositoryScope, next: PublicationContent, transition: PublicationWorkflowTransition, expectedVersion: number): Promise<boolean>
  putTemplate(scope: PublicationRepositoryScope, template: PublicationTemplate, expectedVersion: number | null): Promise<boolean>
  listTemplates(scope: PublicationRepositoryScope): Promise<readonly PublicationTemplate[]>
  putReaderAccount(scope: PublicationRepositoryScope, account: PublicationReaderAccount): Promise<boolean>
  putMember(scope: PublicationRepositoryScope, member: PublicationMember): Promise<boolean>
  getMember(scope: PublicationRepositoryScope, memberId: string): Promise<PublicationMember | null>
  listMembers(scope: PublicationRepositoryScope): Promise<readonly PublicationMember[]>
  putSegment(scope: PublicationRepositoryScope, segment: PublicationSegment, expectedVersion: number | null): Promise<boolean>
  getSegment(scope: PublicationRepositoryScope, segmentId: string): Promise<PublicationSegment | null>
  listSegments(scope: PublicationRepositoryScope): Promise<readonly PublicationSegment[]>
  putAccessGrant(scope: PublicationRepositoryScope, grant: PublicationAccessGrant): Promise<boolean>
  listAccessGrants(scope: PublicationRepositoryScope, memberId: string): Promise<readonly PublicationAccessGrant[]>
  appendAnalyticsEvent(scope: PublicationRepositoryScope, event: PublicationAnalyticsEvent): Promise<boolean>
  analyticsSummary(scope: PublicationRepositoryScope, from: string, to: string): Promise<PublicationAnalyticsSummary>
  putEmailSettingsLayer(scope: PublicationRepositoryScope, layer: EmailSettingsLayer, expectedVersion: number | null): Promise<boolean>
  listEmailSettingsLayers(scope: PublicationRepositoryScope, newsletterId: string | null): Promise<readonly EmailSettingsLayer[]>
  putNewsletter(scope: PublicationRepositoryScope, newsletter: Newsletter): Promise<boolean>
  getNewsletter(scope: PublicationRepositoryScope, newsletterId: string): Promise<Newsletter | null>
  listNewsletters(scope: PublicationRepositoryScope): Promise<readonly Newsletter[]>
  appendNewsletterVersion(scope: PublicationRepositoryScope, version: NewsletterVersion): Promise<boolean>
  getNewsletterVersion(scope: PublicationRepositoryScope, versionId: string): Promise<NewsletterVersion | null>
  listNewsletterVersions(scope: PublicationRepositoryScope, newsletterId: string | null): Promise<readonly NewsletterVersion[]>
  putCampaign(scope: PublicationRepositoryScope, campaign: CampaignSnapshot): Promise<boolean>
  putCampaignWithDeliveries(scope: PublicationRepositoryScope, campaign: CampaignSnapshot, deliveries: readonly CampaignDelivery[]): Promise<boolean>
  getCampaign(scope: PublicationRepositoryScope, campaignId: string): Promise<CampaignSnapshot | null>
  putDeliveries(scope: PublicationRepositoryScope, deliveries: readonly CampaignDelivery[]): Promise<void>
  listDeliveries(scope: PublicationRepositoryScope, campaignId: string): Promise<readonly CampaignDelivery[]>
  putSuppression(scope: PublicationRepositoryScope, suppression: Suppression): Promise<boolean>
  isSuppressed(scope: PublicationRepositoryScope, emailHashSha256: string): Promise<boolean>
  issueUnsubscribeToken(scope: PublicationRepositoryScope, claims: UnsubscribeTokenClaims): Promise<boolean>
  getUnsubscribeToken(scope: PublicationRepositoryScope, tokenId: string): Promise<UnsubscribeTokenClaims | null>
  consumeUnsubscribeToken(scope: PublicationRepositoryScope, tokenId: string, consumedAt: string): Promise<UnsubscribeTokenClaims | null>
  consumeUnsubscribeAndSuppress(scope: PublicationRepositoryScope, tokenId: string, consumedAt: string, suppression: Suppression): Promise<UnsubscribeTokenClaims | null>
  appendProviderEvent(scope: PublicationRepositoryScope, event: OciEmailProviderEvent, payloadSha256: string): Promise<boolean>
  recordProviderEvent(scope: PublicationRepositoryScope, event: OciEmailProviderEvent, payloadSha256: string, suppression: Suppression | null): Promise<boolean>
  applyProviderEvent(scope: PublicationRepositoryScope, event: OciEmailProviderEvent): Promise<void>
  deliverabilitySummary(scope: PublicationRepositoryScope, from: string, to: string): Promise<DeliverabilitySummary>
}

export interface OciEmailDeliveryProvider {
  readonly kind: 'oci-email-delivery'
  submit(input: Readonly<{
    idempotencyKey: string
    recipient: string
    senderEmail: string
    senderName: string
    replyToEmail: string
    subject: string
    html: string
    text: string
    headers: Readonly<Record<string, string>>
  }>): Promise<Readonly<{ providerMessageId: string }>>
}

export interface PublicationIdAuthority {
  id(kind: string): string
  sha256(value: string): string
}

export interface PublicationUnsubscribeLinkIssuer {
  issue(scope: PublicationRepositoryScope, input: Readonly<{
    memberId: string
    newsletterId: string
    recipientEmail: string
    issuedAt: string
  }>): Promise<string>
}

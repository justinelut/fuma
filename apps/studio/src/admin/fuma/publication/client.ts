import { apiRequest, type FetchLike } from '@core/http'
import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import {
  CampaignDeliverySchema,
  CampaignProgressSchema,
  CampaignSnapshotSchema,
  CollaborationReconcileResultSchema,
  DeliverabilitySummarySchema,
  PublicationEngagementSummarySchema,
  SenderDomainHealthSchema,
  EmailSettingsLayerSchema,
  NewsletterPreviewSchema,
  NewsletterSchema,
  NewsletterVersionComparisonSchema,
  NewsletterVersionSchema,
  PublicationAnalyticsSummarySchema,
  PublicationAccessEvaluationSchema,
  PublicationMemberAccessSchema,
  PublicationMemberAccountSchema,
  PublicationMemberExportSchema,
  PublicationMemberSegmentSchema,
  PublicationNewsletterConsentEventSchema,
  PublicationNewsletterConsentStateSchema,
  PublicationPrivacyRequestSchema,
  PublicationSegmentMembershipSnapshotSchema,
  PublicationAuthorSchema,
  PublicationContentSchema,
  PublicationMemberSchema,
  PublicationPresenceStateSchema,
  PublicationContentAssignmentSchema,
  PublicationEditorialRoleAssignmentSchema,
  PublicationReviewRequestSchema,
  PublicationScheduledReadinessSchema,
  PublicationWorkflowHistoryEventSchema,
  PublicationWorkflowInboxSchema,
  PublicationPresentationDecisionSchema,
  PublicationRevisionComparisonSchema,
  PublicationRevisionListSchema,
  PublicationRevisionRecordSchema,
  PublicationRevisionSchema,
  PublicationSegmentSchema,
  PublicationSettingsSchema,
  PublicationTagSchema,
  PublicationTemplateSchema,
  ResolvedEmailSettingsSchema,
  type CampaignProgress,
  type CampaignSnapshot,
  type CollaborationOperationInput,
  type CollaborationReconcileResult,
  type DeliverabilitySummary,
  type PublicationEngagementSummary,
  type SenderDomainHealth,
  type EmailSettingsLayer,
  type Newsletter,
  type NewsletterFixtureKind,
  type NewsletterPreview,
  type NewsletterVersion,
  type NewsletterVersionComparison,
  type PublicationAnalyticsSummary,
  type PublicationAccessEvaluation,
  type PublicationAccessEvaluationRequest,
  type PublicationMemberAccess,
  type PublicationMemberAccount,
  type PublicationMemberExport,
  type PublicationMemberSegment,
  type PublicationNewsletterConsentEvent,
  type PublicationNewsletterConsentState,
  type PublicationPrivacyRequest,
  type PublicationSegmentMembershipSnapshot,
  type PublicationAuthor,
  type PublicationContent,
  type PublicationContentImport,
  type PublicationMember,
  type PublicationPresenceState,
  type PublicationPresentationDecision,
  type PublicationPresentationRequest,
  type PublicationRevisionComparison,
  type PublicationRevisionRecord,
  type PublicationRevision,
  type PublicationSegment,
  type PublicationSettings,
  type PublicationTag,
  type PublicationTemplate,
  type ResolvedEmailSettings,
} from '@core/fuma/publication'

const TargetSchema = Type.Object({ organizationId: Type.String({ minLength: 1, maxLength: 255 }), workspaceId: Type.String({ minLength: 1, maxLength: 255 }), siteId: Type.String({ minLength: 1, maxLength: 255 }), profileId: Type.String({ minLength: 1, maxLength: 255 }) }, { additionalProperties: false })
export type PublicationClientTarget = Readonly<Static<typeof TargetSchema>>
const AcceptedSchema = Type.Object({ accepted: Type.Boolean() }, { additionalProperties: false })
const MessageSchema = Type.Object({ providerMessageId: Type.String({ minLength: 1 }) }, { additionalProperties: false })
const PresenceListSchema = Type.Object({ entries: Type.Array(PublicationPresenceStateSchema) }, { additionalProperties: false })
const MemberListSchema = Type.Object({ members: Type.Array(PublicationMemberSchema, { maxItems: 100000 }) }, { additionalProperties: false })
const MemberAccountListSchema = Type.Object({ accounts: Type.Array(PublicationMemberAccountSchema, { maxItems: 200 }) }, { additionalProperties: false })
const MemberSegmentListSchema = Type.Object({ segments: Type.Array(PublicationMemberSegmentSchema, { maxItems: 200 }) }, { additionalProperties: false })
const MemberAccessListSchema = Type.Object({ access: Type.Array(PublicationMemberAccessSchema, { maxItems: 200 }) }, { additionalProperties: false })
const AuthorListSchema = Type.Object({ authors: Type.Array(PublicationAuthorSchema, { maxItems: 10000 }) }, { additionalProperties: false })
const TagListSchema = Type.Object({ tags: Type.Array(PublicationTagSchema, { maxItems: 10000 }) }, { additionalProperties: false })
const ContentListSchema = Type.Object({ content: Type.Array(PublicationContentSchema) }, { additionalProperties: false })
const PublicationSettingsResultSchema = Type.Object({ settings: Type.Union([PublicationSettingsSchema,Type.Null()]) }, { additionalProperties: false })
const TemplateListSchema = Type.Object({ templates: Type.Array(PublicationTemplateSchema) }, { additionalProperties: false })
const SegmentListSchema = Type.Object({ segments: Type.Array(PublicationSegmentSchema) }, { additionalProperties: false })
const SenderDomainHealthListSchema=Type.Object({domains:Type.Array(SenderDomainHealthSchema,{maxItems:1000})},{additionalProperties:false})
const NewsletterListSchema = Type.Object({ newsletters: Type.Array(NewsletterSchema) }, { additionalProperties: false })
const NewsletterVersionListSchema = Type.Object({ versions: Type.Array(NewsletterVersionSchema) }, { additionalProperties: false })
const DeliveryListSchema = Type.Object({ deliveries: Type.Array(CampaignDeliverySchema) }, { additionalProperties: false })
const WorkflowHistoryListSchema = Type.Object({ events: Type.Array(PublicationWorkflowHistoryEventSchema, { maxItems: 500 }) }, { additionalProperties: false })

export class PublicationClientError extends Error {
  constructor(message: string) { super(message); this.name = 'PublicationClientError' }
}

function bindTarget(input: PublicationClientTarget): PublicationClientTarget {
  const parsed = safeParseValue(TargetSchema, input)
  if (!parsed.ok) throw new PublicationClientError('Publication client target is invalid.')
  return Object.freeze(structuredClone(parsed.value))
}
function basePath(target: PublicationClientTarget): string {
  return `/api/fuma/organizations/${encodeURIComponent(target.organizationId)}/workspaces/${encodeURIComponent(target.workspaceId)}/sites/${encodeURIComponent(target.siteId)}/publication`
}

export function publicationPresenceSocketUrl(target: PublicationClientTarget, resourceKind: PublicationPresenceState['resourceKind'], resourceId: string, tabId: string, location: Pick<Location, 'protocol'|'host'> = globalThis.location): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}${basePath(bindTarget(target))}/presence/socket/${encodeURIComponent(resourceKind)}/${encodeURIComponent(resourceId)}?tab=${encodeURIComponent(tabId)}`
}

export function publicationCollaborationSocketUrl(target: PublicationClientTarget, resourceKind: PublicationPresenceState['resourceKind'], resourceId: string, tabId: string, location: Pick<Location, 'protocol'|'host'> = globalThis.location): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}${basePath(bindTarget(target))}/collaboration/socket/${encodeURIComponent(resourceKind)}/${encodeURIComponent(resourceId)}?tab=${encodeURIComponent(tabId)}`
}

export class PublicationHttpClient {
  readonly target: PublicationClientTarget
  readonly #fetch: FetchLike
  readonly #base: string
  constructor(target: PublicationClientTarget, fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)) { this.target = bindTarget(target); this.#fetch = fetchImpl; this.#base = basePath(this.target) }

  async #request<T extends TSchema>(method: string, suffix: string, schema: T, payload?: unknown): Promise<Static<T>> {
    return apiRequest(`${this.#base}${suffix}`, {
      method,
      body: payload,
      schema,
      fallbackMessage: 'Publication request failed',
      fetchImpl: this.#fetch,
    })
  }
  heartbeat(input: Readonly<{ resourceKind: 'post'|'page'|'template'|'newsletter'; resourceId: string; displayName: string; selection: PublicationPresenceState['selection']; draftSequence: number }>): Promise<{ accepted: boolean }> { return this.#request('POST','/presence',AcceptedSchema,input) }
  async presence(resourceKind: string, resourceId: string) { return (await this.#request('GET',`/presence/${encodeURIComponent(resourceKind)}/${encodeURIComponent(resourceId)}`,PresenceListSchema)).entries }
  reconcile(input: Readonly<{ mutationId:string; resourceKind: 'post'|'page'|'template'|'newsletter'; resourceId:string; expectedSequence:number; operations: readonly CollaborationOperationInput[] }>): Promise<CollaborationReconcileResult> { return this.#request('POST','/reconcile',CollaborationReconcileResultSchema,input) }
  checkpoint(input: Omit<PublicationRevision,'actorId'|'checksumSha256'|'createdAt'>): Promise<PublicationRevision> { return this.#request('POST','/checkpoints',PublicationRevisionSchema,input) }
  revisions(resourceKind:string,resourceId:string){return this.#request('GET',`/revisions/${encodeURIComponent(resourceKind)}/${encodeURIComponent(resourceId)}`,PublicationRevisionListSchema)}
  createRevision(input:Readonly<{revisionId:string;resourceKind:'post'|'page'|'template'|'newsletter';resourceId:string;expectedSequence:number;expectedHeadRevisionId:string|null;reason:'periodic'|'manual-checkpoint'|'publish';checkpointName:string|null;document:unknown;retentionDays:number}>):Promise<PublicationRevisionRecord>{return this.#request('POST','/revisions',PublicationRevisionRecordSchema,input)}
  compareRevisions(resourceKind:string,resourceId:string,from:string,to:string):Promise<PublicationRevisionComparison>{return this.#request('GET',`/revisions/${encodeURIComponent(resourceKind)}/${encodeURIComponent(resourceId)}/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,PublicationRevisionComparisonSchema)}
  restore(resourceKind:string,resourceId:string,input:Readonly<{sourceRevisionId:string;expectedHeadRevisionId:string;restoreRevisionId:string}>):Promise<PublicationRevisionRecord>{return this.#request('POST',`/restore/${encodeURIComponent(resourceKind)}/${encodeURIComponent(resourceId)}`,PublicationRevisionRecordSchema,input)}
  async contentList(){return (await this.#request('GET','/content',ContentListSchema)).content}
  content(contentId:string):Promise<PublicationContent>{return this.#request('GET',`/content/${encodeURIComponent(contentId)}`,PublicationContentSchema)}
  presentation(contentId:string,input:PublicationPresentationRequest):Promise<PublicationPresentationDecision>{return this.#request('POST',`/content/${encodeURIComponent(contentId)}/presentation`,PublicationPresentationDecisionSchema,input)}
  saveContent(content:PublicationContent,expectedVersion:number|null):Promise<PublicationContent>{return this.#request('POST','/content',PublicationContentSchema,{content,expectedVersion})}
  async importContent(input:PublicationContentImport){return (await this.#request('POST','/content/import',ContentListSchema,input)).content}
  deleteContent(contentId:string,expectedVersion:number):Promise<{accepted:boolean}>{return this.#request('DELETE',`/content/${encodeURIComponent(contentId)}`,AcceptedSchema,{expectedVersion})}
  async authors():Promise<readonly PublicationAuthor[]>{return (await this.#request('GET','/authors',AuthorListSchema)).authors}
  async publicationSettings():Promise<PublicationSettings|null>{return (await this.#request('GET','/settings',PublicationSettingsResultSchema)).settings}
  savePublicationSettings(settings:PublicationSettings,expectedVersion:number|null):Promise<PublicationSettings>{return this.#request('POST','/settings',PublicationSettingsSchema,{settings,expectedVersion})}
  transition(input:Readonly<{transitionId:string;contentId:string;from:PublicationContent['status'];to:PublicationContent['status'];expectedVersion:number;scheduledAt:string|null;note:string}>):Promise<PublicationContent>{return this.#request('POST','/workflow',PublicationContentSchema,input)}
  async templates(){return (await this.#request('GET','/templates',TemplateListSchema)).templates}
  saveTemplate(template:PublicationTemplate,expectedVersion:number|null):Promise<PublicationTemplate>{return this.#request('POST','/templates',PublicationTemplateSchema,{template,expectedVersion})}
  async members(){return (await this.#request('GET','/members',MemberListSchema)).members}
  async memberAccounts(limit=200,afterId:string|null=null):Promise<readonly PublicationMemberAccount[]>{const suffix=`/member-accounts?limit=${limit}${afterId?`&afterId=${encodeURIComponent(afterId)}`:''}`;return (await this.#request('GET',suffix,MemberAccountListSchema)).accounts}
  saveMemberAccount(account:PublicationMemberAccount,expectedUpdatedAt:string|null):Promise<PublicationMemberAccount>{return this.#request('POST','/member-accounts',PublicationMemberAccountSchema,{account,expectedUpdatedAt})}
  recordMemberConsent(event:PublicationNewsletterConsentEvent):Promise<PublicationNewsletterConsentEvent>{return this.#request('POST','/member-consents',PublicationNewsletterConsentEventSchema,event)}
  memberConsentState(memberId:string,newsletterId:string|null):Promise<PublicationNewsletterConsentState>{return this.#request('GET',`/member-consents/${encodeURIComponent(memberId)}/state${newsletterId?`?newsletterId=${encodeURIComponent(newsletterId)}`:''}`,PublicationNewsletterConsentStateSchema)}
  async memberSegments(limit=200,afterId:string|null=null):Promise<readonly PublicationMemberSegment[]>{const suffix=`/member-segments?limit=${limit}${afterId?`&afterId=${encodeURIComponent(afterId)}`:''}`;return (await this.#request('GET',suffix,MemberSegmentListSchema)).segments}
  saveMemberSegment(segment:PublicationMemberSegment,expectedVersion:number|null):Promise<PublicationMemberSegment>{return this.#request('POST','/member-segments',PublicationMemberSegmentSchema,{segment,expectedVersion})}
  recalculateMemberSegment(segmentId:string):Promise<PublicationSegmentMembershipSnapshot>{return this.#request('POST',`/member-segments/${encodeURIComponent(segmentId)}/recalculate`,PublicationSegmentMembershipSnapshotSchema,{})}
  async memberAccess(memberId:string,limit=200):Promise<readonly PublicationMemberAccess[]>{return (await this.#request('GET',`/member-access/${encodeURIComponent(memberId)}?limit=${limit}`,MemberAccessListSchema)).access}
  grantMemberAccess(access:PublicationMemberAccess):Promise<PublicationMemberAccess>{return this.#request('POST','/member-access',PublicationMemberAccessSchema,access)}
  transitionMemberAccess(accessId:string,memberId:string,state:PublicationMemberAccess['state'],updatedAt:string):Promise<PublicationMemberAccess>{return this.#request('POST',`/member-access/${encodeURIComponent(accessId)}/state`,PublicationMemberAccessSchema,{memberId,state,updatedAt})}
  evaluateMemberAccess(input:PublicationAccessEvaluationRequest):Promise<PublicationAccessEvaluation>{return this.#request('POST','/member-access/evaluate',PublicationAccessEvaluationSchema,input)}
  exportMemberAccount(accountId:string):Promise<PublicationMemberExport>{return this.#request('POST','/member-privacy/export',PublicationMemberExportSchema,{accountId})}
  requestMemberDeletion(accountId:string,reason:string):Promise<PublicationPrivacyRequest>{return this.#request('POST','/member-privacy/deletion',PublicationPrivacyRequestSchema,{accountId,reason})}
  completeMemberDeletion(request:PublicationPrivacyRequest):Promise<PublicationPrivacyRequest>{return this.#request('POST','/member-privacy/deletion/complete',PublicationPrivacyRequestSchema,request)}
  async tags(){return (await this.#request('GET','/tags',TagListSchema)).tags}
  saveTag(tag:PublicationTag):Promise<PublicationTag>{return this.#request('POST','/tags',PublicationTagSchema,tag)}
  saveMember(member:PublicationMember):Promise<PublicationMember>{return this.#request('POST','/members',PublicationMemberSchema,member)}
  async segments(){return (await this.#request('GET','/segments',SegmentListSchema)).segments}
  saveSegment(segment:PublicationSegment,expectedVersion:number|null):Promise<PublicationSegment>{return this.#request('POST','/segments',PublicationSegmentSchema,{segment,expectedVersion})}
  analytics(from:string,to:string):Promise<PublicationAnalyticsSummary>{return this.#request('GET',`/analytics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,PublicationAnalyticsSummarySchema)}
  saveEmailSettings(layer:EmailSettingsLayer,expectedVersion:number|null):Promise<EmailSettingsLayer>{return this.#request('POST','/email-settings',EmailSettingsLayerSchema,{layer,expectedVersion})}
  emailSettings(newsletterId:string|null):Promise<ResolvedEmailSettings>{return this.#request('GET',`/email-settings${newsletterId?`?newsletterId=${encodeURIComponent(newsletterId)}`:''}`,ResolvedEmailSettingsSchema)}
  async newsletters(){return (await this.#request('GET','/newsletters',NewsletterListSchema)).newsletters}
  saveNewsletter(newsletter:Newsletter):Promise<Newsletter>{return this.#request('POST','/newsletters',NewsletterSchema,newsletter)}
  async newsletterVersions(newsletterId:string|null=null){return (await this.#request('GET',`/newsletter-versions${newsletterId?`?newsletterId=${encodeURIComponent(newsletterId)}`:''}`,NewsletterVersionListSchema)).versions}
  createNewsletterVersion(version:Omit<NewsletterVersion,'createdBy'|'createdAt'|'lockedAt'>):Promise<NewsletterVersion>{return this.#request('POST','/newsletter-versions',NewsletterVersionSchema,version)}
  compareNewsletterVersions(newsletterId:string,from:string,to:string):Promise<NewsletterVersionComparison>{return this.#request('GET',`/newsletter-versions/compare?newsletterId=${encodeURIComponent(newsletterId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,NewsletterVersionComparisonSchema)}
  preview(versionId:string,fixture:NewsletterFixtureKind='public'):Promise<NewsletterPreview>{return this.#request('GET',`/newsletter-preview/${encodeURIComponent(versionId)}?fixture=${encodeURIComponent(fixture)}`,NewsletterPreviewSchema)}
  async testSend(versionId:string,recipient:string,idempotencyKey:string,fixture:NewsletterFixtureKind='public'):Promise<string>{return (await this.#request('POST','/newsletter-test',MessageSchema,{versionId,recipient,idempotencyKey,fixture})).providerMessageId}
  createCampaign(input:Readonly<{campaignId:string;newsletterId:string;versionId:string;segmentId:string;scheduledAt:string|null}>):Promise<CampaignSnapshot>{return this.#request('POST','/campaigns',CampaignSnapshotSchema,input)}
  campaignProgress(campaignId:string):Promise<CampaignProgress>{return this.#request('GET',`/campaigns/${encodeURIComponent(campaignId)}/progress`,CampaignProgressSchema)}
  cancelCampaign(campaignId:string):Promise<CampaignSnapshot>{return this.#request('POST',`/campaigns/${encodeURIComponent(campaignId)}/cancel`,CampaignSnapshotSchema)}
  async sendCampaign(campaignId:string){return (await this.#request('POST',`/campaigns/${encodeURIComponent(campaignId)}/send`,DeliveryListSchema)).deliveries}
  deliverability(from:string,to:string):Promise<DeliverabilitySummary>{return this.#request('GET',`/deliverability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,DeliverabilitySummarySchema)}
  async senderDomainHealth():Promise<readonly SenderDomainHealth[]>{return (await this.#request('GET','/deliverability/domains',SenderDomainHealthListSchema)).domains}
  engagement(from:string,to:string):Promise<PublicationEngagementSummary>{return this.#request('GET',`/engagement?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,PublicationEngagementSummarySchema)}
  workflowInbox(){return this.#request('GET','/workflow/inbox',PublicationWorkflowInboxSchema)}
  async workflowHistory(contentId:string){return (await this.#request('GET',`/workflow/history/${encodeURIComponent(contentId)}`,WorkflowHistoryListSchema)).events}
  workflowReadiness(contentId:string){return this.#request('GET',`/workflow/readiness/${encodeURIComponent(contentId)}`,PublicationScheduledReadinessSchema)}
  setEditorialRole(input:Readonly<{eventId:string;userId:string;role:'author'|'editor'|'managing-editor';active:boolean;expectedVersion:number|null;note:string}>){return this.#request('POST','/workflow/roles',PublicationEditorialRoleAssignmentSchema,input)}
  assignEditorialContent(input:Readonly<{eventId:string;notificationId:string;contentId:string;assigneeId:string;expectedVersion:number|null;note:string}>){return this.#request('POST','/workflow/assignments',PublicationContentAssignmentSchema,input)}
  requestEditorialReview(input:Readonly<{eventId:string;notificationId:string;reviewId:string;contentId:string;contentVersion:number;reviewerId:string;note:string}>){return this.#request('POST','/workflow/reviews',PublicationReviewRequestSchema,input)}
  decideEditorialReview(input:Readonly<{eventId:string;notificationId:string;reviewId:string;contentVersion:number;decision:'changes-requested'|'rejected'|'approved';note:string}>){const {decision,...command}=input;const action=decision==='changes-requested'?'changes':decision==='rejected'?'reject':'approve';return this.#request('POST',`/workflow/decisions/${action}`,PublicationReviewRequestSchema,command)}
  markWorkflowNotificationRead(notificationId:string){return this.#request('POST','/workflow/notifications/read',AcceptedSchema,{notificationId})}
}

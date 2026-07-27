import {
  CampaignDeliverySchema,
  CampaignSnapshotSchema,
  CollaborationReconcileCommandSchema,
  CollaborationReconcileResultSchema,
  DeliverabilitySummarySchema,
  EmailSettingsLayerSchema,
  NewsletterPreviewSchema,
  NewsletterSchema,
  NewsletterTestSendCommandSchema,
  NewsletterVersionSchema,
  PublicationAccessGrantSchema,
  PublicationAccessEvaluationRequestSchema,
  PublicationAccessEvaluationSchema,
  PublicationMemberAccessSchema,
  PublicationMemberAccountSchema,
  PublicationMemberExportSchema,
  PublicationMemberSegmentSchema,
  PublicationNewsletterConsentEventSchema,
  PublicationNewsletterConsentStateSchema,
  PublicationPrivacyRequestSchema,
  PublicationSegmentMembershipSnapshotSchema,
  PublicationAnalyticsEventSchema,
  PublicationAnalyticsSummarySchema,
  PublicationAuthorSchema,
  PublicationContentImportSchema,
  PublicationContentSchema,
  PublicationAssignmentCommandSchema,
  PublicationContentAssignmentSchema,
  PublicationEditorialRoleAssignmentSchema,
  PublicationEditorialRoleCommandSchema,
  PublicationReviewDecisionCommandSchema,
  PublicationReviewRequestCommandSchema,
  PublicationReviewRequestSchema,
  PublicationScheduledReadinessSchema,
  PublicationWorkflowHistoryEventSchema,
  PublicationWorkflowInboxSchema,
  PublicationMemberSchema,
  PublicationPresenceStateSchema,
  PublicationPresentationDecisionSchema,
  PublicationIdSchema,
  PublicationPresentationRequestSchema,
  PublicationRevisionComparisonSchema,
  PublicationRevisionCreateCommandSchema,
  PublicationRevisionListSchema,
  PublicationRevisionRecordSchema,
  PublicationRevisionRestoreCommandSchema,
  PublicationRevisionSchema,
  PublicationSegmentSchema,
  PublicationSettingsSchema,
  PublicationTagSchema,
  PublicationTemplateSchema,
  ResolvedEmailSettingsSchema,
} from '@core/fuma/publication'
import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import { readValidatedBody } from '../../http'
import type { FumaScopedRouteDeclaration, FumaScopedRouteHandlerInput } from '../context'
import { bindPublicationScope } from './scope'
import type { PublicationCollaborationService, PublicationPresenceService } from './collaboration'
import type { PublicationRevisionService } from './revisions'
import { decidePublicationPresentation } from './presentation'
import type {
  PublicationAnalyticsService,
  PublicationAudienceService,
  PublicationCampaignService,
  PublicationDeliverabilityService,
  PublicationDomainStore,
  PublicationEditorialService,
  PublicationEmailSettingsService,
  PublicationIdAuthority,
  PublicationIdentityService,
  PublicationNewsletterService,
} from './services'
import type { PublicationWorkflowService } from './editorialWorkflow'
import type { PublicationMemberAccessService } from './memberAccess'

const ErrorSchema = Type.Object({ error: Type.String({ minLength: 1 }) }, { additionalProperties: false })
const BooleanResultSchema = Type.Object({ accepted: Type.Boolean() }, { additionalProperties: false })
const MessageResultSchema = Type.Object({ providerMessageId: Type.String({ minLength: 1, maxLength: 255 }) }, { additionalProperties: false })
const PresenceListSchema = Type.Object({ entries: Type.Array(PublicationPresenceStateSchema, { maxItems: 256 }) }, { additionalProperties: false })
const RevisionResourceSchema=Type.Object({resourceKind:PublicationRevisionRecordSchema.properties.resourceKind,resourceId:PublicationRevisionRecordSchema.properties.resourceId},{additionalProperties:false})
const RevisionComparisonQuerySchema=Type.Object({from:Type.String({minLength:1,maxLength:255}),to:Type.String({minLength:1,maxLength:255})},{additionalProperties:false})
const MemberListSchema = Type.Object({ members: Type.Array(PublicationMemberSchema, { maxItems: 100000 }) }, { additionalProperties: false })
const AuthorListSchema = Type.Object({ authors: Type.Array(PublicationAuthorSchema, { maxItems: 10000 }) }, { additionalProperties: false })
const TagListSchema = Type.Object({ tags: Type.Array(PublicationTagSchema, { maxItems: 10000 }) }, { additionalProperties: false })
const ContentListSchema = Type.Object({ content: Type.Array(PublicationContentSchema, { maxItems: 100000 }) }, { additionalProperties: false })
const PublicationSettingsResultSchema = Type.Object({ settings: Type.Union([PublicationSettingsSchema,Type.Null()]) }, { additionalProperties: false })
const MemberAccountListSchema = Type.Object({ accounts: Type.Array(PublicationMemberAccountSchema, { maxItems: 200 }) }, { additionalProperties: false })
const MemberSegmentListSchema = Type.Object({ segments: Type.Array(PublicationMemberSegmentSchema, { maxItems: 200 }) }, { additionalProperties: false })
const MemberAccessListSchema = Type.Object({ access: Type.Array(PublicationMemberAccessSchema, { maxItems: 200 }) }, { additionalProperties: false })
const MemberAccountSaveSchema = Type.Object({ account: PublicationMemberAccountSchema, expectedUpdatedAt: Type.Union([PublicationMemberAccountSchema.properties.updatedAt, Type.Null()]) }, { additionalProperties: false })
const MemberSegmentSaveSchema = Type.Object({ segment: PublicationMemberSegmentSchema, expectedVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]) }, { additionalProperties: false })
const MemberPageQuerySchema = Type.Object({ limit: Type.Integer({ minimum: 1, maximum: 200 }), afterId: Type.Union([Type.String({ minLength: 1, maxLength: 255 }), Type.Null()]) }, { additionalProperties: false })
const MemberConsentStateQuerySchema = Type.Object({ newsletterId: Type.Union([Type.String({ minLength: 1, maxLength: 255 }), Type.Null()]) }, { additionalProperties: false })
const MemberAccessTransitionSchema = Type.Object({ memberId: Type.String({ minLength: 1, maxLength: 255 }), state: PublicationMemberAccessSchema.properties.state, updatedAt: PublicationMemberAccessSchema.properties.updatedAt }, { additionalProperties: false })
const MemberPrivacyExportSchema = Type.Object({ accountId: Type.String({ minLength: 1, maxLength: 255 }) }, { additionalProperties: false })
const MemberPrivacyDeletionSchema = Type.Object({ accountId: Type.String({ minLength: 1, maxLength: 255 }), reason: Type.String({ maxLength: 500 }) }, { additionalProperties: false })
const TemplateListSchema = Type.Object({ templates: Type.Array(PublicationTemplateSchema, { maxItems: 10000 }) }, { additionalProperties: false })
const SegmentListSchema = Type.Object({ segments: Type.Array(PublicationSegmentSchema, { maxItems: 10000 }) }, { additionalProperties: false })
const NewsletterListSchema = Type.Object({ newsletters: Type.Array(NewsletterSchema, { maxItems: 10000 }) }, { additionalProperties: false })
const NewsletterVersionListSchema = Type.Object({ versions: Type.Array(NewsletterVersionSchema, { maxItems: 100000 }) }, { additionalProperties: false })
const DeliveryListSchema = Type.Object({ deliveries: Type.Array(CampaignDeliverySchema, { maxItems: 100000 }) }, { additionalProperties: false })
const WorkflowHistoryListSchema = Type.Object({ events: Type.Array(PublicationWorkflowHistoryEventSchema, { maxItems: 500 }) }, { additionalProperties: false })
const WorkflowContentPathSchema = Type.Object({ contentId: PublicationIdSchema }, { additionalProperties: false })
const WorkflowDecisionActionCommandSchema = Type.Omit(PublicationReviewDecisionCommandSchema, ['decision'])
const NotificationReadSchema = Type.Object({ notificationId: Type.String({ minLength: 1, maxLength: 255 }) }, { additionalProperties: false })

const ContentSaveCommandSchema = Type.Object({ content: PublicationContentSchema, expectedVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]) }, { additionalProperties: false })
const ContentDeleteCommandSchema = Type.Object({ expectedVersion: Type.Integer({ minimum: 1 }) }, { additionalProperties: false })
const PublicationSettingsSaveSchema = Type.Object({ settings: PublicationSettingsSchema, expectedVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]) }, { additionalProperties: false })
const WorkflowCommandSchema = Type.Object({ transitionId: Type.String({ minLength: 1, maxLength: 255 }), contentId: Type.String({ minLength: 1, maxLength: 255 }), from: PublicationContentSchema.properties.status, to: PublicationContentSchema.properties.status, expectedVersion: Type.Integer({ minimum: 1 }), scheduledAt: PublicationContentSchema.properties.scheduledAt, note: Type.String({ maxLength: 500 }) }, { additionalProperties: false })
const PresenceHeartbeatSchema = Type.Object({ resourceKind: PublicationPresenceStateSchema.properties.resourceKind, resourceId: PublicationPresenceStateSchema.properties.resourceId, displayName: PublicationPresenceStateSchema.properties.displayName, selection: PublicationPresenceStateSchema.properties.selection, draftSequence: PublicationPresenceStateSchema.properties.draftSequence }, { additionalProperties: false })
const CheckpointCommandSchema = Type.Object({ revisionId: Type.String({ minLength: 1, maxLength: 255 }), resourceKind: PublicationRevisionSchema.properties.resourceKind, resourceId: PublicationRevisionSchema.properties.resourceId, sequence: Type.Integer({ minimum: 0 }), parentRevisionId: PublicationRevisionSchema.properties.parentRevisionId, reason: Type.Union([Type.Literal('autosave'), Type.Literal('manual-checkpoint'), Type.Literal('publish')]), document: Type.Unknown() }, { additionalProperties: false })
const TemplateSaveSchema = Type.Object({ template: PublicationTemplateSchema, expectedVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]) }, { additionalProperties: false })
const SegmentSaveSchema = Type.Object({ segment: PublicationSegmentSchema, expectedVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]) }, { additionalProperties: false })
const SettingsSaveSchema = Type.Object({ layer: EmailSettingsLayerSchema, expectedVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]) }, { additionalProperties: false })
const CampaignCommandSchema = Type.Object({ campaignId: Type.String({ minLength: 1, maxLength: 255 }), newsletterId: Type.String({ minLength: 1, maxLength: 255 }), versionId: Type.String({ minLength: 1, maxLength: 255 }), segmentId: Type.String({ minLength: 1, maxLength: 255 }), scheduledAt: Type.Union([Type.String(), Type.Null()]) }, { additionalProperties: false })
const NewsletterVersionCommandSchema = Type.Omit(NewsletterVersionSchema, ['createdBy','createdAt','lockedAt'])
const UnsubscribeCommandSchema = Type.Object({ tokenId: Type.String({ minLength: 1, maxLength: 255 }) }, { additionalProperties: false })

export type PublicationRoutePorts = Readonly<{
  store: PublicationDomainStore
  ids: PublicationIdAuthority
  presence: PublicationPresenceService
  collaboration: PublicationCollaborationService
  revisions: PublicationRevisionService
  workflow: PublicationWorkflowService
  editorial: PublicationEditorialService
  identity: PublicationIdentityService
  audience: PublicationAudienceService
  memberAccess: PublicationMemberAccessService
  analytics: PublicationAnalyticsService
  settings: PublicationEmailSettingsService
  newsletters: PublicationNewsletterService
  campaigns: PublicationCampaignService
  deliverability: PublicationDeliverabilityService
  now?: () => Date
}>

function actor(input: FumaScopedRouteHandlerInput): { actorId: string; sessionId: string } {
  return input.context.actor.kind === 'staff'
    ? { actorId: input.context.actor.userId, sessionId: input.context.actor.sessionId }
    : { actorId: input.context.actor.jobId, sessionId: input.context.actor.runId }
}
function workflowActor(input:FumaScopedRouteHandlerInput){
  if(input.context.actor.kind!=='staff'||input.context.source.kind!=='staff-session')throw Object.assign(new Error('Editorial workflow requires a staff session.'),{code:'scope-denied'})
  return Object.freeze({actorId:input.context.actor.userId,sessionId:input.context.actor.sessionId,requestId:input.context.requestId,impersonatorId:input.context.actor.impersonator?.userId??null})
}
function json<T extends TSchema>(schema: T, value: unknown, status = 200): Response {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new Error('Publication route response failed validation.')
  return new Response(JSON.stringify(parsed.value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}
function failure(error: unknown): Response {
  const message = error instanceof Error ? error.message : 'Publication request failed.'
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  const status = code === 'not-found' || code === 'scope-denied' ? 404 : code === 'rate-limited' ? 429 : code === 'unauthorized' ? 403 : code.includes('conflict') || code === 'invalid-transition' || code === 'invalid-access' || code === 'deletion-pending' || code === 'self-approval' || code === 'stale-review' ? 409 : 400
  return json(ErrorSchema, { error: status === 404 ? 'Resource not found.' : message }, status)
}
async function body<T extends TSchema>(input: FumaScopedRouteHandlerInput, schema: T): Promise<Static<T>> {
  const result = await readValidatedBody(input.request, schema)
  if (result === null) throw new TypeError('Request body is invalid.')
  return result
}
function scoped(input: FumaScopedRouteHandlerInput) { return bindPublicationScope(input.repositoryScope, input.context.profile.id) }
function memberPage(input:FumaScopedRouteHandlerInput):Static<typeof MemberPageQuerySchema>{const values=query(input);const rawLimit=values.get('limit');const parsed=safeParseValue(MemberPageQuerySchema,{limit:rawLimit===null?100:Number(rawLimit),afterId:values.get('afterId')});if(!parsed.ok)throw new TypeError('Member page query is invalid.');return parsed.value}
function consentStateQuery(input:FumaScopedRouteHandlerInput):Static<typeof MemberConsentStateQuerySchema>{const parsed=safeParseValue(MemberConsentStateQuerySchema,{newsletterId:query(input).get('newsletterId')});if(!parsed.ok)throw new TypeError('Consent state query is invalid.');return parsed.value}
function query(input: FumaScopedRouteHandlerInput): URLSearchParams { return new URL(input.request.url).searchParams }
function revisionResource(input:FumaScopedRouteHandlerInput):Static<typeof RevisionResourceSchema>{const parsed=safeParseValue(RevisionResourceSchema,input.params);if(!parsed.ok)throw new TypeError('Revision resource path is invalid.');return parsed.value}
function revisionComparisonQuery(input:FumaScopedRouteHandlerInput):Static<typeof RevisionComparisonQuerySchema>{const values=query(input);const parsed=safeParseValue(RevisionComparisonQuerySchema,{from:values.get('from'),to:values.get('to')});if(!parsed.ok)throw new TypeError('Revision comparison query is invalid.');return parsed.value}
function workflowContentPath(input:FumaScopedRouteHandlerInput):Static<typeof WorkflowContentPathSchema>{const parsed=safeParseValue(WorkflowContentPathSchema,input.params);if(!parsed.ok)throw new TypeError('Workflow content path is invalid.');return parsed.value}

export function createPublicationScopedRouteDeclarations(ports: PublicationRoutePorts): readonly FumaScopedRouteDeclaration[] {
  const now = ports.now ?? (() => new Date())
  const route = (method: FumaScopedRouteDeclaration['method'], path: string, permission: string, handler: (input: FumaScopedRouteHandlerInput) => Promise<Response>): FumaScopedRouteDeclaration => Object.freeze({ method, path, permission, handler: async (input) => { try { return await handler(input) } catch (error) { return failure(error) } } }) as FumaScopedRouteDeclaration
  return Object.freeze([
    route('POST', '/publication/presence', 'publication.posts.write', async (input) => {
      const command = await body(input, PresenceHeartbeatSchema); const identity = actor(input); const observedAt = now().toISOString()
      const accepted = await ports.presence.heartbeat(scoped(input), { ...command, ...identity, observedAt })
      return json(BooleanResultSchema, { accepted })
    }),
    route('GET', '/publication/presence/:resourceKind/:resourceId', 'publication.posts.read', async (input) => json(PresenceListSchema, { entries: await ports.presence.list(scoped(input), input.params.resourceKind as never, input.params.resourceId!) })),
    route('POST', '/publication/reconcile', 'publication.posts.write', async (input) => {
      const command = await body(input, CollaborationReconcileCommandSchema); const identity = actor(input); const createdAt = now().toISOString()
      return json(CollaborationReconcileResultSchema, await ports.collaboration.reconcile(scoped(input), command, { actorSessionId: identity.sessionId, createdAt }))
    }),
    route('POST', '/publication/checkpoints', 'publication.posts.write', async (input) => {
      const command = await body(input, CheckpointCommandSchema); const revision = { ...command, actorId: actor(input).actorId, checksumSha256: ports.ids.sha256(JSON.stringify(command.document)), createdAt: now().toISOString() }
      return json(PublicationRevisionSchema, await ports.collaboration.checkpoint(scoped(input), revision))
    }),
    route('GET', '/publication/revisions/:resourceKind/:resourceId', 'publication.posts.read', async (input) => {const resource=revisionResource(input);return json(PublicationRevisionListSchema, await ports.revisions.list(scoped(input),resource.resourceKind,resource.resourceId))}),
    route('POST', '/publication/revisions', 'publication.posts.write', async (input) => json(PublicationRevisionRecordSchema, await ports.revisions.create(scoped(input), actor(input).actorId, await body(input, PublicationRevisionCreateCommandSchema)), 201)),
    route('GET', '/publication/revisions/:resourceKind/:resourceId/compare', 'publication.posts.read', async (input) => {
      const resource=revisionResource(input);const parameters=revisionComparisonQuery(input)
      return json(PublicationRevisionComparisonSchema, await ports.revisions.compare(scoped(input),resource.resourceKind,resource.resourceId,parameters.from,parameters.to))
    }),
    route('POST', '/publication/restore/:resourceKind/:resourceId', 'publication.posts.write', async (input) => {const resource=revisionResource(input);return json(PublicationRevisionRecordSchema, await ports.revisions.restore(scoped(input),resource.resourceKind,resource.resourceId,actor(input).actorId,await body(input,PublicationRevisionRestoreCommandSchema)))}),
    route('GET', '/publication/content', 'publication.posts.read', async (input) => json(ContentListSchema, { content: await ports.store.listContent(scoped(input)) })),
    route('GET', '/publication/content/:contentId', 'publication.posts.read', async (input) => { const value=await ports.store.getContent(scoped(input),input.params.contentId!); if(!value)throw Object.assign(new Error('Content not found.'),{code:'not-found'}); return json(PublicationContentSchema,value) }),
    route('POST', '/publication/content/:contentId/presentation', 'publication.posts.read', async (input) => {
      const value=await ports.store.getContent(scoped(input),input.params.contentId!);if(!value)throw Object.assign(new Error('Content not found.'),{code:'not-found'})
      return json(PublicationPresentationDecisionSchema,decidePublicationPresentation(value,await body(input,PublicationPresentationRequestSchema)))
    }),
    route('POST', '/publication/content', 'publication.posts.write', async (input) => { const command = await body(input, ContentSaveCommandSchema); return json(PublicationContentSchema, await ports.editorial.save(scoped(input), command.content, command.expectedVersion)) }),
    route('POST', '/publication/content/import', 'publication.posts.write', async (input) => json(ContentListSchema, { content: await ports.editorial.importMany(scoped(input), await body(input, PublicationContentImportSchema)) }, 201)),
    route('DELETE', '/publication/content/:contentId', 'publication.posts.write', async (input) => { const command=await body(input,ContentDeleteCommandSchema); await ports.editorial.remove(scoped(input),input.params.contentId!,command.expectedVersion); return json(BooleanResultSchema,{accepted:true}) }),
    route('GET', '/publication/authors', 'publication.posts.read', async (input) => json(AuthorListSchema, { authors: await ports.store.listAuthors(scoped(input)) })),
    route('GET', '/publication/settings', 'site.settings.read', async (input) => json(PublicationSettingsResultSchema,{settings:await ports.identity.get(scoped(input))})),
    route('POST', '/publication/settings', 'site.settings.write', async (input) => { const command=await body(input,PublicationSettingsSaveSchema); return json(PublicationSettingsSchema,await ports.identity.save(scoped(input),command.settings,command.expectedVersion)) }),
    route('GET', '/publication/workflow/inbox', 'publication.workflow.read', async (input) => json(PublicationWorkflowInboxSchema,await ports.workflow.inbox(scoped(input),workflowActor(input).actorId))),
    route('GET', '/publication/workflow/history/:contentId', 'publication.workflow.read', async (input) => {const path=workflowContentPath(input);return json(WorkflowHistoryListSchema,{events:await ports.workflow.history(scoped(input),path.contentId)})}),
    route('GET', '/publication/workflow/readiness/:contentId', 'publication.workflow.read', async (input) => {const path=workflowContentPath(input);const content=await ports.store.getContent(scoped(input),path.contentId);if(!content)throw Object.assign(new Error('Content not found.'),{code:'not-found'});return json(PublicationScheduledReadinessSchema,await ports.workflow.scheduledReadiness(scoped(input),content.contentId,content.workflowVersion))}),
    route('POST', '/publication/workflow/roles', 'publication.workflow.assign', async (input) => json(PublicationEditorialRoleAssignmentSchema,await ports.workflow.setRole(scoped(input),workflowActor(input),await body(input,PublicationEditorialRoleCommandSchema)))),
    route('POST', '/publication/workflow/assignments', 'publication.workflow.assign', async (input) => json(PublicationContentAssignmentSchema,await ports.workflow.assign(scoped(input),workflowActor(input),await body(input,PublicationAssignmentCommandSchema)))),
    route('POST', '/publication/workflow/reviews', 'publication.workflow.review', async (input) => json(PublicationReviewRequestSchema,await ports.workflow.requestReview(scoped(input),workflowActor(input),await body(input,PublicationReviewRequestCommandSchema)),201)),
    route('POST', '/publication/workflow/decisions/changes', 'publication.workflow.review', async (input) => json(PublicationReviewRequestSchema,await ports.workflow.decide(scoped(input),workflowActor(input),{...await body(input,WorkflowDecisionActionCommandSchema),decision:'changes-requested'}))),
    route('POST', '/publication/workflow/decisions/reject', 'publication.workflow.approve', async (input) => json(PublicationReviewRequestSchema,await ports.workflow.decide(scoped(input),workflowActor(input),{...await body(input,WorkflowDecisionActionCommandSchema),decision:'rejected'}))),
    route('POST', '/publication/workflow/decisions/approve', 'publication.workflow.approve', async (input) => json(PublicationReviewRequestSchema,await ports.workflow.decide(scoped(input),workflowActor(input),{...await body(input,WorkflowDecisionActionCommandSchema),decision:'approved'}))),
    route('POST', '/publication/workflow/notifications/read', 'publication.workflow.read', async (input) => {const command=await body(input,NotificationReadSchema);return json(BooleanResultSchema,{accepted:await ports.workflow.markNotificationRead(scoped(input),workflowActor(input).actorId,command.notificationId)})}),
    route('POST', '/publication/workflow', 'publication.posts.schedule', async (input) => { const command = await body(input, WorkflowCommandSchema); return json(PublicationContentSchema, await ports.editorial.transition(scoped(input), { ...command, actorId: actor(input).actorId, createdAt: now().toISOString() })) }),
    route('GET', '/publication/templates', 'website.design.read', async (input) => json(TemplateListSchema, { templates: await ports.store.listTemplates(scoped(input)) })),
    route('POST', '/publication/templates', 'website.design.write', async (input) => { const command = await body(input, TemplateSaveSchema); return json(PublicationTemplateSchema, await ports.editorial.saveTemplate(scoped(input), command.template, command.expectedVersion)) }),
    route('GET', '/publication/tags', 'publication.tags.read', async (input) => json(TagListSchema, { tags: await ports.store.listTags(scoped(input)) })),
    route('POST', '/publication/tags', 'publication.tags.write', async (input) => { const tag=await body(input,PublicationTagSchema); if(!await ports.store.putTag(scoped(input),tag))throw Object.assign(new Error('Tag identity or slug conflicts.'),{code:'conflict'}); return json(PublicationTagSchema,tag) }),
    route('GET', '/publication/member-accounts', 'publication.members.read', async (input) => json(MemberAccountListSchema, { accounts: await ports.memberAccess.listAccounts(scoped(input), memberPage(input)) })),
    route('POST', '/publication/member-accounts', 'publication.members.write', async (input) => { const command=await body(input,MemberAccountSaveSchema);return json(PublicationMemberAccountSchema,await ports.memberAccess.saveAccount(scoped(input),command.account,command.expectedUpdatedAt)) }),
    route('POST', '/publication/member-consents', 'publication.members.write', async (input) => json(PublicationNewsletterConsentEventSchema,await ports.memberAccess.recordConsent(scoped(input),await body(input,PublicationNewsletterConsentEventSchema)),201)),
    route('GET', '/publication/member-consents/:memberId/state', 'publication.members.read', async (input) => {const parameters=consentStateQuery(input);return json(PublicationNewsletterConsentStateSchema,await ports.memberAccess.consentState(scoped(input),input.params.memberId!,parameters.newsletterId))}),
    route('GET', '/publication/member-segments', 'publication.members.read', async (input) => json(MemberSegmentListSchema,{segments:await ports.memberAccess.listSegments(scoped(input),memberPage(input))})),
    route('POST', '/publication/member-segments', 'publication.members.write', async (input) => {const command=await body(input,MemberSegmentSaveSchema);return json(PublicationMemberSegmentSchema,await ports.memberAccess.saveSegment(scoped(input),command.segment,command.expectedVersion))}),
    route('POST', '/publication/member-segments/:segmentId/recalculate', 'publication.members.write', async (input) => json(PublicationSegmentMembershipSnapshotSchema,await ports.memberAccess.recalculateSegment(scoped(input),input.params.segmentId!))),
    route('GET', '/publication/member-access/:memberId', 'publication.members.read', async (input) => json(MemberAccessListSchema,{access:await ports.memberAccess.listAccess(scoped(input),input.params.memberId!,memberPage(input).limit)})),
    route('POST', '/publication/member-access', 'publication.members.write', async (input) => json(PublicationMemberAccessSchema,await ports.memberAccess.grantAccess(scoped(input),await body(input,PublicationMemberAccessSchema)),201)),
    route('POST', '/publication/member-access/:accessId/state', 'publication.members.write', async (input) => {const command=await body(input,MemberAccessTransitionSchema);return json(PublicationMemberAccessSchema,await ports.memberAccess.transitionAccess(scoped(input),input.params.accessId!,command.memberId,command.state,command.updatedAt))}),
    route('POST', '/publication/member-access/evaluate', 'publication.members.read', async (input) => json(PublicationAccessEvaluationSchema,await ports.memberAccess.evaluate(scoped(input),await body(input,PublicationAccessEvaluationRequestSchema)))),
    route('POST', '/publication/member-privacy/export', 'publication.members.read', async (input) => {const command=await body(input,MemberPrivacyExportSchema);return json(PublicationMemberExportSchema,await ports.memberAccess.export(scoped(input),command.accountId,'staff'))}),
    route('POST', '/publication/member-privacy/deletion', 'publication.members.write', async (input) => {const command=await body(input,MemberPrivacyDeletionSchema);return json(PublicationPrivacyRequestSchema,await ports.memberAccess.requestDeletion(scoped(input),command.accountId,'staff',command.reason),202)}),
    route('POST', '/publication/member-privacy/deletion/complete', 'publication.members.write', async (input) => json(PublicationPrivacyRequestSchema,await ports.memberAccess.completeDeletion(scoped(input),await body(input,PublicationPrivacyRequestSchema)))),
    route('GET', '/publication/members', 'publication.members.read', async (input) => json(MemberListSchema,{members:await ports.store.listMembers(scoped(input))})),
    route('POST', '/publication/members', 'publication.members.write', async (input) => json(PublicationMemberSchema, await ports.audience.saveMember(scoped(input), await body(input, PublicationMemberSchema)))),
    route('GET', '/publication/segments', 'publication.members.read', async (input) => json(SegmentListSchema, { segments: await ports.store.listSegments(scoped(input)) })),
    route('POST', '/publication/segments', 'publication.members.write', async (input) => { const command = await body(input, SegmentSaveSchema); return json(PublicationSegmentSchema, await ports.audience.saveSegment(scoped(input), command.segment, command.expectedVersion)) }),
    route('POST', '/publication/access', 'publication.members.write', async (input) => json(PublicationAccessGrantSchema, await ports.audience.grant(scoped(input), await body(input, PublicationAccessGrantSchema)))),
    route('POST', '/publication/analytics/events', 'publication.analytics.read', async (input) => json(BooleanResultSchema, { accepted: await ports.analytics.record(scoped(input), await body(input, PublicationAnalyticsEventSchema)) })),
    route('GET', '/publication/analytics', 'publication.analytics.read', async (input) => json(PublicationAnalyticsSummarySchema, await ports.analytics.summary(scoped(input), query(input).get('from') ?? '', query(input).get('to') ?? ''))),
    route('POST', '/publication/email-settings', 'site.settings.write', async (input) => { const command = await body(input, SettingsSaveSchema); return json(EmailSettingsLayerSchema, await ports.settings.save(scoped(input), command.layer, command.expectedVersion)) }),
    route('GET', '/publication/email-settings', 'site.settings.read', async (input) => json(ResolvedEmailSettingsSchema, await ports.settings.resolve(scoped(input), query(input).get('newsletterId')))),
    route('GET', '/publication/newsletters', 'publication.newsletters.read', async (input) => json(NewsletterListSchema, { newsletters: await ports.store.listNewsletters(scoped(input)) })),
    route('POST', '/publication/newsletters', 'publication.newsletters.write', async (input) => json(NewsletterSchema, await ports.newsletters.save(scoped(input), await body(input, NewsletterSchema)))),
    route('GET', '/publication/newsletter-versions', 'publication.newsletters.read', async (input) => json(NewsletterVersionListSchema, { versions: await ports.store.listNewsletterVersions(scoped(input), query(input).get('newsletterId')) })),
    route('POST', '/publication/newsletter-versions', 'publication.newsletters.write', async (input) => {const command=await body(input,NewsletterVersionCommandSchema);return json(NewsletterVersionSchema, await ports.newsletters.createVersion(scoped(input),{...command,createdBy:actor(input).actorId,createdAt:now().toISOString(),lockedAt:null}))}),
    route('GET', '/publication/newsletter-preview/:versionId', 'publication.newsletters.read', async (input) => json(NewsletterPreviewSchema, await ports.newsletters.preview(scoped(input), input.params.versionId!))),
    route('POST', '/publication/newsletter-test', 'publication.newsletters.send', async (input) => json(MessageResultSchema, { providerMessageId: await ports.newsletters.testSend(scoped(input), await body(input, NewsletterTestSendCommandSchema)) })),
    route('POST', '/publication/campaigns', 'publication.newsletters.send', async (input) => json(CampaignSnapshotSchema, await ports.campaigns.snapshot(scoped(input), await body(input, CampaignCommandSchema)))),
    route('POST', '/publication/campaigns/:campaignId/send', 'publication.newsletters.send', async (input) => json(DeliveryListSchema, { deliveries: await ports.campaigns.send(scoped(input), input.params.campaignId!) })),
    route('POST', '/publication/unsubscribe', 'publication.members.write', async (input) => { const command=await body(input,UnsubscribeCommandSchema); await ports.deliverability.unsubscribe(scoped(input),command.tokenId); return json(BooleanResultSchema,{accepted:true}) }),
    route('GET', '/publication/deliverability', 'publication.analytics.read', async (input) => json(DeliverabilitySummarySchema, await ports.deliverability.summary(scoped(input), query(input).get('from') ?? '', query(input).get('to') ?? ''))),
  ])
}

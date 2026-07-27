import { Type, safeParseValue, type Static, type TSchema } from '../../utils/typeboxHelpers'

export type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T

const IdSchema = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const SlugSchema = Type.String({ minLength: 1, maxLength: 160, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' })
const TimestampSchema = Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?Z$' })
const NullableTimestampSchema = Type.Union([TimestampSchema, Type.Null()])
const VersionSchema = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
const SequenceSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
const Sha256Schema = Type.String({ minLength: 64, maxLength: 64, pattern: '^[a-f0-9]{64}$' })
const EmailSchema = Type.String({ minLength: 3, maxLength: 320, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' })
const HttpsUrlSchema = Type.String({ minLength: 8, maxLength: 2048, pattern: '^https://[^\\s]+$' })

export { IdSchema as PublicationIdSchema, SlugSchema as PublicationSlugSchema, TimestampSchema as PublicationTimestampSchema }

export const PublicationPresenceStateSchema = Type.Object({
  actorId: IdSchema,
  sessionId: IdSchema,
  displayName: Type.String({ minLength: 1, maxLength: 120 }),
  resourceKind: Type.Union([Type.Literal('post'), Type.Literal('page'), Type.Literal('template'), Type.Literal('newsletter')]),
  resourceId: IdSchema,
  selection: Type.Union([
    Type.Object({ kind: Type.Literal('none') }, { additionalProperties: false }),
    Type.Object({ kind: Type.Literal('node'), nodeId: IdSchema }, { additionalProperties: false }),
    Type.Object({ kind: Type.Literal('text'), anchor: Type.Integer({ minimum: 0 }), head: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }),
  ]),
  draftSequence: SequenceSchema,
  observedAt: TimestampSchema,
}, { additionalProperties: false })
export type PublicationPresenceState = DeepReadonly<Static<typeof PublicationPresenceStateSchema>>

export const PublicationCollaborativeResourceKindSchema = Type.Union([
  Type.Literal('post'), Type.Literal('page'), Type.Literal('template'), Type.Literal('newsletter'),
])
const CollaborationPathSchema = Type.Array(Type.Union([
  Type.String({ minLength: 1, maxLength: 255, pattern: '^(?!(?:__proto__|prototype|constructor)$).+$' }),
  Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
]), { minItems: 1, maxItems: 32 })
const CollaborationOperationBase = { operationId: IdSchema, baseSequence: SequenceSchema, path: CollaborationPathSchema }

/** Client-authored operations contain data only; actor/time/accepted order are server authority. */
export const CollaborationOperationInputSchema = Type.Union([
  Type.Object({ ...CollaborationOperationBase, kind: Type.Literal('set'), value: Type.Unknown() }, { additionalProperties: false }),
  Type.Object({ ...CollaborationOperationBase, kind: Type.Literal('insert'), value: Type.Unknown() }, { additionalProperties: false }),
  Type.Object({ ...CollaborationOperationBase, kind: Type.Literal('remove') }, { additionalProperties: false }),
  Type.Object({ ...CollaborationOperationBase, kind: Type.Literal('move'), toIndex: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }) }, { additionalProperties: false }),
])
export type CollaborationOperationInput = DeepReadonly<Static<typeof CollaborationOperationInputSchema>>

const AcceptedOperationAuthority = {
  mutationId: IdSchema,
  actorSessionId: IdSchema,
  acceptedSequence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  operationIndex: Type.Integer({ minimum: 0, maximum: 127 }),
  createdAt: TimestampSchema,
}
export const CollaborationOperationSchema = Type.Union([
  Type.Object({ ...CollaborationOperationBase, ...AcceptedOperationAuthority, kind: Type.Literal('set'), value: Type.Unknown() }, { additionalProperties: false }),
  Type.Object({ ...CollaborationOperationBase, ...AcceptedOperationAuthority, kind: Type.Literal('insert'), value: Type.Unknown() }, { additionalProperties: false }),
  Type.Object({ ...CollaborationOperationBase, ...AcceptedOperationAuthority, kind: Type.Literal('remove') }, { additionalProperties: false }),
  Type.Object({ ...CollaborationOperationBase, ...AcceptedOperationAuthority, kind: Type.Literal('move'), toIndex: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }) }, { additionalProperties: false }),
])
export type CollaborationOperation = DeepReadonly<Static<typeof CollaborationOperationSchema>>

export const CollaborationReconcileCommandSchema = Type.Object({
  mutationId: IdSchema,
  resourceKind: PublicationCollaborativeResourceKindSchema,
  resourceId: IdSchema,
  expectedSequence: SequenceSchema,
  operations: Type.Array(CollaborationOperationInputSchema, { minItems: 1, maxItems: 128 }),
}, { additionalProperties: false })
export type CollaborationReconcileCommand = DeepReadonly<Static<typeof CollaborationReconcileCommandSchema>>

export const CollaborationAcceptedReceiptSchema = Type.Object({
  mutationId: IdSchema,
  sequence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  operationIds: Type.Array(IdSchema, { minItems: 1, maxItems: 128 }),
  operations: Type.Array(CollaborationOperationSchema, { minItems: 1, maxItems: 128 }),
}, { additionalProperties: false })
export type CollaborationAcceptedReceipt = DeepReadonly<Static<typeof CollaborationAcceptedReceiptSchema>>

export const CollaborationReconcileResultSchema = Type.Union([
  Type.Object({ outcome: Type.Literal('accepted'), replayed: Type.Boolean(), receipt: CollaborationAcceptedReceiptSchema, document: Type.Unknown() }, { additionalProperties: false }),
  Type.Object({ outcome: Type.Literal('rebase-required'), mutationId: IdSchema, sequence: SequenceSchema, document: Type.Unknown(), operationsSinceBase: Type.Array(CollaborationOperationSchema, { maxItems: 1024 }) }, { additionalProperties: false }),
])
export type CollaborationReconcileResult = DeepReadonly<Static<typeof CollaborationReconcileResultSchema>>

export const CollaborationCatchUpSchema = Type.Object({
  sequence: SequenceSchema,
  document: Type.Unknown(),
  operationsSinceBase: Type.Array(CollaborationOperationSchema, { maxItems: 1024 }),
}, { additionalProperties: false })
export type CollaborationCatchUp = DeepReadonly<Static<typeof CollaborationCatchUpSchema>>

export const CollaborationSocketClientMessageSchema = Type.Union([
  Type.Object({ type: Type.Literal('collaboration-reconcile'), command: CollaborationReconcileCommandSchema }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('collaboration-catch-up'), afterSequence: SequenceSchema }, { additionalProperties: false }),
])
export const CollaborationSocketServerMessageSchema = Type.Union([
  Type.Object({ type: Type.Literal('collaboration-accepted'), replayed: Type.Boolean(), receipt: CollaborationAcceptedReceiptSchema, document: Type.Unknown() }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('collaboration-rebase-required'), mutationId: IdSchema, sequence: SequenceSchema, document: Type.Unknown(), operationsSinceBase: Type.Array(CollaborationOperationSchema, { maxItems: 1024 }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('collaboration-catch-up'), sequence: SequenceSchema, document: Type.Unknown(), operationsSinceBase: Type.Array(CollaborationOperationSchema, { maxItems: 1024 }) }, { additionalProperties: false }),
])
export type CollaborationSocketClientMessage = DeepReadonly<Static<typeof CollaborationSocketClientMessageSchema>>
export type CollaborationSocketServerMessage = DeepReadonly<Static<typeof CollaborationSocketServerMessageSchema>>

export const PublicationRevisionSchema = Type.Object({
  revisionId: IdSchema,
  resourceKind: Type.Union([Type.Literal('post'), Type.Literal('page'), Type.Literal('template'), Type.Literal('newsletter')]),
  resourceId: IdSchema,
  sequence: SequenceSchema,
  parentRevisionId: Type.Union([IdSchema, Type.Null()]),
  actorId: IdSchema,
  reason: Type.Union([Type.Literal('autosave'), Type.Literal('manual-checkpoint'), Type.Literal('publish'), Type.Literal('restore')]),
  document: Type.Unknown(),
  checksumSha256: Sha256Schema,
  createdAt: TimestampSchema,
}, { additionalProperties: false })
export type PublicationRevision = DeepReadonly<Static<typeof PublicationRevisionSchema>>

export const PublicationRestoreCommandSchema = Type.Object({
  revisionId: IdSchema,
  expectedHeadRevisionId: IdSchema,
  restoreRevisionId: IdSchema,
}, { additionalProperties: false })
export type PublicationRestoreCommand = DeepReadonly<Static<typeof PublicationRestoreCommandSchema>>

export const PublicationRevisionReasonSchema = Type.Union([
  Type.Literal('periodic'),
  Type.Literal('manual-checkpoint'),
  Type.Literal('publish'),
  Type.Literal('restore'),
])
export type PublicationRevisionReason = Static<typeof PublicationRevisionReasonSchema>

export const PublicationRevisionRecordSchema = Type.Object({
  revisionId: IdSchema,
  resourceKind: PublicationCollaborativeResourceKindSchema,
  resourceId: IdSchema,
  sequence: SequenceSchema,
  parentRevisionId: Type.Union([IdSchema, Type.Null()]),
  actorId: IdSchema,
  reason: PublicationRevisionReasonSchema,
  checkpointName: Type.Union([Type.String({ minLength: 1, maxLength: 120 }), Type.Null()]),
  snapshotId: Sha256Schema,
  checksumSha256: Sha256Schema,
  sizeBytes: Type.Integer({ minimum: 1, maximum: 100 * 1024 * 1024 }),
  retainedUntil: Type.Union([TimestampSchema, Type.Null()]),
  snapshotAvailable: Type.Boolean(),
  createdAt: TimestampSchema,
}, { additionalProperties: false })
export type PublicationRevisionRecord = DeepReadonly<Static<typeof PublicationRevisionRecordSchema>>

export const PublicationRevisionListSchema = Type.Object({
  revisions: Type.Array(PublicationRevisionRecordSchema, { maxItems: 500 }),
  headRevisionId: Type.Union([IdSchema, Type.Null()]),
  currentSequence: SequenceSchema,
}, { additionalProperties: false })
export type PublicationRevisionList = DeepReadonly<Static<typeof PublicationRevisionListSchema>>

export const PublicationRevisionCreateCommandSchema = Type.Object({
  revisionId: IdSchema,
  resourceKind: PublicationCollaborativeResourceKindSchema,
  resourceId: IdSchema,
  expectedSequence: SequenceSchema,
  expectedHeadRevisionId: Type.Union([IdSchema, Type.Null()]),
  reason: Type.Union([Type.Literal('periodic'), Type.Literal('manual-checkpoint'), Type.Literal('publish')]),
  checkpointName: Type.Union([Type.String({ minLength: 1, maxLength: 120 }), Type.Null()]),
  document: Type.Unknown(),
  retentionDays: Type.Integer({ minimum: 1, maximum: 3650 }),
}, { additionalProperties: false })
export type PublicationRevisionCreateCommand = DeepReadonly<Static<typeof PublicationRevisionCreateCommandSchema>>

export const PublicationRevisionRestoreCommandSchema = Type.Object({
  sourceRevisionId: IdSchema,
  expectedHeadRevisionId: IdSchema,
  restoreRevisionId: IdSchema,
}, { additionalProperties: false })
export type PublicationRevisionRestoreCommand = DeepReadonly<Static<typeof PublicationRevisionRestoreCommandSchema>>

export const PublicationRevisionDiffEntrySchema = Type.Object({
  path: Type.String({ maxLength: 2048 }),
  kind: Type.Union([Type.Literal('added'), Type.Literal('removed'), Type.Literal('changed')]),
  before: Type.Unknown(),
  after: Type.Unknown(),
}, { additionalProperties: false })
export type PublicationRevisionDiffEntry = DeepReadonly<Static<typeof PublicationRevisionDiffEntrySchema>>

export const PublicationRevisionComparisonSchema = Type.Object({
  fromRevisionId: IdSchema,
  toRevisionId: IdSchema,
  fromChecksumSha256: Sha256Schema,
  toChecksumSha256: Sha256Schema,
  truncated: Type.Boolean(),
  entries: Type.Array(PublicationRevisionDiffEntrySchema, { maxItems: 1000 }),
}, { additionalProperties: false })
export type PublicationRevisionComparison = DeepReadonly<Static<typeof PublicationRevisionComparisonSchema>>

export const PublicationContentStatusSchema = Type.Union([
  Type.Literal('draft'), Type.Literal('in-review'), Type.Literal('approved'), Type.Literal('scheduled'),
  Type.Literal('published'), Type.Literal('unpublished'), Type.Literal('archived'),
])
export type PublicationContentStatus = Static<typeof PublicationContentStatusSchema>

export const PublicationRedirectSchema = Type.Object({
  fromPath: Type.String({ minLength: 2, maxLength: 1024, pattern: '^/(?!/)(?!.*[?#])[A-Za-z0-9._~!$&\'()*+,;=:@%/-]+$' }),
  toPath: Type.String({ minLength: 2, maxLength: 1024, pattern: '^/(?!/)(?!.*[?#])[A-Za-z0-9._~!$&\'()*+,;=:@%/-]+$' }),
  statusCode: Type.Union([Type.Literal(301), Type.Literal(308)]),
}, { additionalProperties: false })
export type PublicationRedirect = DeepReadonly<Static<typeof PublicationRedirectSchema>>

export const PublicationOpenGraphSchema = Type.Object({
  title: Type.Union([Type.String({ minLength: 1, maxLength: 95 }), Type.Null()]),
  description: Type.Union([Type.String({ minLength: 1, maxLength: 300 }), Type.Null()]),
  imageId: Type.Union([IdSchema, Type.Null()]),
  type: Type.Union([Type.Literal('article'), Type.Literal('website')]),
}, { additionalProperties: false })
export const PublicationSocialMetadataSchema = Type.Object({
  title: Type.Union([Type.String({ minLength: 1, maxLength: 70 }), Type.Null()]),
  description: Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()]),
  imageId: Type.Union([IdSchema, Type.Null()]),
  card: Type.Union([Type.Literal('summary'), Type.Literal('summary-large-image')]),
}, { additionalProperties: false })
export const PublicationVisibilitySchema = Type.Union([
  Type.Object({ kind: Type.Literal('public') }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('member') }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('paid') }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('segment'), segmentIds: Type.Array(IdSchema, { minItems: 1, maxItems: 64, uniqueItems: true }) }, { additionalProperties: false }),
])
export type PublicationVisibility = DeepReadonly<Static<typeof PublicationVisibilitySchema>>

export const PublicationMetadataSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 300 }),
  slug: SlugSchema,
  excerpt: Type.String({ maxLength: 1000 }),
  canonicalUrl: Type.Union([HttpsUrlSchema, Type.Null()]),
  redirects: Type.Array(PublicationRedirectSchema, { maxItems: 100 }),
  openGraph: PublicationOpenGraphSchema,
  social: PublicationSocialMetadataSchema,
  visibility: PublicationVisibilitySchema,
  featureImageId: Type.Union([IdSchema, Type.Null()]),
  seoTitle: Type.Union([Type.String({ minLength: 1, maxLength: 70 }), Type.Null()]),
  seoDescription: Type.Union([Type.String({ minLength: 1, maxLength: 180 }), Type.Null()]),
  tagIds: Type.Array(IdSchema, { maxItems: 64, uniqueItems: true }),
  primaryTagId: Type.Union([IdSchema, Type.Null()]),
  authorIds: Type.Array(IdSchema, { minItems: 1, maxItems: 32, uniqueItems: true }),
}, { additionalProperties: false })
export type PublicationMetadata = DeepReadonly<Static<typeof PublicationMetadataSchema>>

export const PublicationAudienceContextSchema = Type.Object({
  member: Type.Boolean(),
  paid: Type.Boolean(),
  segmentIds: Type.Array(IdSchema, { maxItems: 64, uniqueItems: true }),
}, { additionalProperties: false })
export type PublicationAudienceContext = DeepReadonly<Static<typeof PublicationAudienceContextSchema>>

export const PublicationPresentationRequestSchema = Type.Object({
  mode: Type.Union([Type.Literal('public'), Type.Literal('preview')]),
  origin: HttpsUrlSchema,
  requestedPath: Type.String({ minLength: 1, maxLength: 1024, pattern: '^/(?!/)(?!.*[?#])(?:[A-Za-z0-9._~!$&\'()*+,;=:@%/-]+)?$' }),
  audience: PublicationAudienceContextSchema,
}, { additionalProperties: false })
export type PublicationPresentationRequest = DeepReadonly<Static<typeof PublicationPresentationRequestSchema>>

export const PublicationPresentationDecisionSchema = Type.Object({
  delivery: Type.Union([Type.Literal('render'), Type.Literal('redirect'), Type.Literal('deny'), Type.Literal('unavailable')]),
  access: Type.Union([Type.Literal('allowed'), Type.Literal('denied')]),
  preview: Type.Boolean(),
  statusCode: Type.Union([Type.Literal(200), Type.Literal(301), Type.Literal(308), Type.Literal(403), Type.Literal(404)]),
  canonicalUrl: HttpsUrlSchema,
  redirectLocation: Type.Union([Type.String({ minLength: 1, maxLength: 1024 }), Type.Null()]),
  robots: Type.Union([Type.Literal('index,follow'), Type.Literal('noindex,nofollow')]),
  title: Type.String({ minLength: 1, maxLength: 300 }),
  description: Type.String({ maxLength: 1000 }),
  openGraph: PublicationOpenGraphSchema,
  social: PublicationSocialMetadataSchema,
  html: Type.Union([Type.String({ minLength: 1, maxLength: 8192 }), Type.Null()]),
  reason: Type.Union([Type.Literal('published'), Type.Literal('preview'), Type.Literal('redirect'), Type.Literal('audience-denied'), Type.Literal('not-published')]),
}, { additionalProperties: false })
export type PublicationPresentationDecision = DeepReadonly<Static<typeof PublicationPresentationDecisionSchema>>

export const PublicationContentSchema = Type.Object({
  contentId: IdSchema,
  kind: Type.Union([Type.Literal('post'), Type.Literal('page')]),
  metadata: PublicationMetadataSchema,
  document: Type.Unknown(),
  status: PublicationContentStatusSchema,
  workflowVersion: VersionSchema,
  scheduledAt: NullableTimestampSchema,
  publishedAt: NullableTimestampSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}, { additionalProperties: false })
export type PublicationContent = DeepReadonly<Static<typeof PublicationContentSchema>>

export const PublicationContentImportItemSchema = Type.Object({
  content: PublicationContentSchema,
  expectedVersion: Type.Union([VersionSchema, Type.Null()]),
}, { additionalProperties: false })
export const PublicationContentImportSchema = Type.Object({
  items: Type.Array(PublicationContentImportItemSchema, { minItems: 1, maxItems: 500 }),
}, { additionalProperties: false })
export type PublicationContentImport = DeepReadonly<Static<typeof PublicationContentImportSchema>>

export const PublicationAuthorSchema = Type.Object({
  authorId: IdSchema,
  displayName: Type.String({ minLength: 1, maxLength: 160 }),
  email: EmailSchema,
  image: Type.Union([HttpsUrlSchema, Type.Null()]),
}, { additionalProperties: false })
export type PublicationAuthor = DeepReadonly<Static<typeof PublicationAuthorSchema>>

export const PublicationSettingsSchema = Type.Object({
  publicationId: IdSchema,
  name: Type.String({ minLength: 1, maxLength: 160 }),
  description: Type.String({ maxLength: 500 }),
  language: Type.String({ minLength: 2, maxLength: 35, pattern: '^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$' }),
  timezone: Type.String({ minLength: 1, maxLength: 100, pattern: '^[A-Za-z_]+(?:/[A-Za-z0-9_+.-]+)+$' }),
  version: VersionSchema,
  updatedAt: TimestampSchema,
}, { additionalProperties: false })
export type PublicationSettings = DeepReadonly<Static<typeof PublicationSettingsSchema>>

export const PublicationTagSchema = Type.Object({
  tagId: IdSchema,
  name: Type.String({ minLength: 1, maxLength: 120 }),
  slug: SlugSchema,
  description: Type.String({ maxLength: 500 }),
}, { additionalProperties: false })
export type PublicationTag = DeepReadonly<Static<typeof PublicationTagSchema>>

export const PublicationWorkflowTransitionSchema = Type.Object({
  transitionId: IdSchema,
  contentId: IdSchema,
  from: PublicationContentStatusSchema,
  to: PublicationContentStatusSchema,
  actorId: IdSchema,
  expectedVersion: VersionSchema,
  scheduledAt: NullableTimestampSchema,
  note: Type.String({ maxLength: 500 }),
  createdAt: TimestampSchema,
}, { additionalProperties: false })
export type PublicationWorkflowTransition = DeepReadonly<Static<typeof PublicationWorkflowTransitionSchema>>

export const PublicationEditorialRoleSchema = Type.Union([
  Type.Literal('author'), Type.Literal('editor'), Type.Literal('managing-editor'),
])
export type PublicationEditorialRole = Static<typeof PublicationEditorialRoleSchema>

export const PublicationEditorialRoleAssignmentSchema = Type.Object({
  userId: IdSchema,
  role: PublicationEditorialRoleSchema,
  active: Type.Boolean(),
  version: VersionSchema,
  assignedBy: IdSchema,
  note: Type.String({ maxLength: 500 }),
  updatedAt: TimestampSchema,
}, { additionalProperties: false })
export type PublicationEditorialRoleAssignment = DeepReadonly<Static<typeof PublicationEditorialRoleAssignmentSchema>>

export const PublicationContentAssignmentSchema = Type.Object({
  contentId: IdSchema,
  assigneeId: IdSchema,
  assignedBy: IdSchema,
  version: VersionSchema,
  note: Type.String({ maxLength: 500 }),
  updatedAt: TimestampSchema,
}, { additionalProperties: false })
export type PublicationContentAssignment = DeepReadonly<Static<typeof PublicationContentAssignmentSchema>>

export const PublicationReviewStatusSchema = Type.Union([
  Type.Literal('pending'), Type.Literal('changes-requested'), Type.Literal('rejected'), Type.Literal('approved'),
])
export type PublicationReviewStatus = Static<typeof PublicationReviewStatusSchema>

export const PublicationReviewRequestSchema = Type.Object({
  reviewId: IdSchema,
  contentId: IdSchema,
  contentVersion: VersionSchema,
  requestedBy: IdSchema,
  reviewerId: IdSchema,
  status: PublicationReviewStatusSchema,
  requestNote: Type.String({ maxLength: 1000 }),
  decisionNote: Type.Union([Type.String({ maxLength: 1000 }), Type.Null()]),
  decidedBy: Type.Union([IdSchema, Type.Null()]),
  requestedAt: TimestampSchema,
  decidedAt: NullableTimestampSchema,
}, { additionalProperties: false })
export type PublicationReviewRequest = DeepReadonly<Static<typeof PublicationReviewRequestSchema>>

export const PublicationWorkflowEventKindSchema = Type.Union([
  Type.Literal('role-assigned'), Type.Literal('role-revoked'), Type.Literal('content-assigned'),
  Type.Literal('review-requested'), Type.Literal('changes-requested'), Type.Literal('rejected'), Type.Literal('approved'),
])
export type PublicationWorkflowEventKind = Static<typeof PublicationWorkflowEventKindSchema>

export const PublicationWorkflowHistoryEventSchema = Type.Object({
  eventId: IdSchema,
  kind: PublicationWorkflowEventKindSchema,
  actorId: IdSchema,
  contentId: Type.Union([IdSchema, Type.Null()]),
  reviewId: Type.Union([IdSchema, Type.Null()]),
  subjectUserId: Type.Union([IdSchema, Type.Null()]),
  contentVersion: Type.Union([VersionSchema, Type.Null()]),
  note: Type.String({ maxLength: 1000 }),
  createdAt: TimestampSchema,
}, { additionalProperties: false })
export type PublicationWorkflowHistoryEvent = DeepReadonly<Static<typeof PublicationWorkflowHistoryEventSchema>>

export const PublicationWorkflowNotificationSchema = Type.Object({
  notificationId: IdSchema,
  recipientId: IdSchema,
  kind: Type.Union([Type.Literal('assignment'), Type.Literal('review-requested'), Type.Literal('changes-requested'), Type.Literal('rejected'), Type.Literal('approved')]),
  contentId: IdSchema,
  reviewId: Type.Union([IdSchema, Type.Null()]),
  message: Type.String({ minLength: 1, maxLength: 500 }),
  createdAt: TimestampSchema,
  readAt: NullableTimestampSchema,
}, { additionalProperties: false })
export type PublicationWorkflowNotification = DeepReadonly<Static<typeof PublicationWorkflowNotificationSchema>>

export const PublicationWorkflowInboxSchema = Type.Object({
  assignments: Type.Array(PublicationContentAssignmentSchema, { maxItems: 500 }),
  reviews: Type.Array(PublicationReviewRequestSchema, { maxItems: 500 }),
  notifications: Type.Array(PublicationWorkflowNotificationSchema, { maxItems: 500 }),
}, { additionalProperties: false })
export type PublicationWorkflowInbox = DeepReadonly<Static<typeof PublicationWorkflowInboxSchema>>

export const PublicationScheduledReadinessSchema = Type.Object({
  contentId: IdSchema,
  contentVersion: VersionSchema,
  ready: Type.Boolean(),
  approvedReviewId: Type.Union([IdSchema, Type.Null()]),
  reason: Type.Union([Type.Literal('approved-current-revision'), Type.Literal('no-current-approval')]),
}, { additionalProperties: false })
export type PublicationScheduledReadiness = DeepReadonly<Static<typeof PublicationScheduledReadinessSchema>>

export const PublicationEditorialRoleCommandSchema = Type.Object({
  eventId: IdSchema, userId: IdSchema, role: PublicationEditorialRoleSchema, active: Type.Boolean(),
  expectedVersion: Type.Union([VersionSchema, Type.Null()]), note: Type.String({ maxLength: 500 }),
}, { additionalProperties: false })
export type PublicationEditorialRoleCommand = DeepReadonly<Static<typeof PublicationEditorialRoleCommandSchema>>

export const PublicationAssignmentCommandSchema = Type.Object({
  eventId: IdSchema, notificationId: IdSchema, contentId: IdSchema, assigneeId: IdSchema,
  expectedVersion: Type.Union([VersionSchema, Type.Null()]), note: Type.String({ maxLength: 500 }),
}, { additionalProperties: false })
export type PublicationAssignmentCommand = DeepReadonly<Static<typeof PublicationAssignmentCommandSchema>>

export const PublicationReviewRequestCommandSchema = Type.Object({
  eventId: IdSchema, notificationId: IdSchema, reviewId: IdSchema, contentId: IdSchema,
  contentVersion: VersionSchema, reviewerId: IdSchema, note: Type.String({ maxLength: 1000 }),
}, { additionalProperties: false })
export type PublicationReviewRequestCommand = DeepReadonly<Static<typeof PublicationReviewRequestCommandSchema>>

export const PublicationReviewDecisionCommandSchema = Type.Object({
  eventId: IdSchema, notificationId: IdSchema, reviewId: IdSchema, contentVersion: VersionSchema,
  decision: Type.Union([Type.Literal('changes-requested'), Type.Literal('rejected'), Type.Literal('approved')]),
  note: Type.String({ maxLength: 1000 }),
}, { additionalProperties: false })
export type PublicationReviewDecisionCommand = DeepReadonly<Static<typeof PublicationReviewDecisionCommandSchema>>

export const PublicationTemplateSchema = Type.Object({
  templateId: IdSchema,
  name: Type.String({ minLength: 1, maxLength: 160 }),
  appliesTo: Type.Union([Type.Literal('post'), Type.Literal('page'), Type.Literal('newsletter')]),
  document: Type.Unknown(),
  version: VersionSchema,
  active: Type.Boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}, { additionalProperties: false })
export type PublicationTemplate = DeepReadonly<Static<typeof PublicationTemplateSchema>>

export const PublicationMemberStatusSchema = Type.Union([Type.Literal('active'), Type.Literal('complimentary'), Type.Literal('blocked'), Type.Literal('unsubscribed')])
export const PublicationMemberSchema = Type.Object({
  memberId: IdSchema,
  email: EmailSchema,
  name: Type.String({ maxLength: 160 }),
  status: PublicationMemberStatusSchema,
  accountId: Type.Union([IdSchema, Type.Null()]),
  attributes: Type.Record(Type.String({ maxLength: 64 }), Type.Union([Type.String({ maxLength: 500 }), Type.Number(), Type.Boolean(), Type.Null()])),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}, { additionalProperties: false })
export type PublicationMember = DeepReadonly<Static<typeof PublicationMemberSchema>>

export const PublicationReaderAccountSchema = Type.Object({
  accountId: IdSchema,
  normalizedEmailHashSha256: Sha256Schema,
  verifiedAt: NullableTimestampSchema,
  lastAuthenticatedAt: NullableTimestampSchema,
  disabledAt: NullableTimestampSchema,
}, { additionalProperties: false })
export type PublicationReaderAccount = DeepReadonly<Static<typeof PublicationReaderAccountSchema>>

export const PublicationSegmentRuleSchema = Type.Union([
  Type.Object({ field: Type.String({ minLength: 1, maxLength: 64 }), operator: Type.Literal('equals'), value: Type.Union([Type.String({ maxLength: 500 }), Type.Number(), Type.Boolean()]) }, { additionalProperties: false }),
  Type.Object({ field: Type.String({ minLength: 1, maxLength: 64 }), operator: Type.Literal('exists') }, { additionalProperties: false }),
  Type.Object({ field: Type.Literal('status'), operator: Type.Literal('in'), values: Type.Array(PublicationMemberStatusSchema, { minItems: 1, uniqueItems: true }) }, { additionalProperties: false }),
])
export const PublicationSegmentSchema = Type.Object({
  segmentId: IdSchema,
  name: Type.String({ minLength: 1, maxLength: 160 }),
  match: Type.Union([Type.Literal('all'), Type.Literal('any')]),
  rules: Type.Array(PublicationSegmentRuleSchema, { minItems: 1, maxItems: 32 }),
  version: VersionSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}, { additionalProperties: false })
export type PublicationSegment = DeepReadonly<Static<typeof PublicationSegmentSchema>>

export const PublicationAccessGrantSchema = Type.Object({
  grantId: IdSchema,
  memberId: IdSchema,
  resourceKind: Type.Union([Type.Literal('publication'), Type.Literal('post'), Type.Literal('tag')]),
  resourceId: IdSchema,
  access: Type.Union([Type.Literal('read'), Type.Literal('premium')]),
  expiresAt: NullableTimestampSchema,
  createdAt: TimestampSchema,
}, { additionalProperties: false })
export type PublicationAccessGrant = DeepReadonly<Static<typeof PublicationAccessGrantSchema>>

/** FUMA-039 account/profile authority linked only to the isolated FUMA-038 member realm. */
export const PublicationMemberAccountSchema = Type.Object({
  accountId: IdSchema,
  memberIdentityId: IdSchema,
  memberId: IdSchema,
  displayName: Type.String({ maxLength: 160 }),
  locale: Type.String({ minLength: 2, maxLength: 35, pattern: '^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$' }),
  timezone: Type.String({ minLength: 1, maxLength: 100, pattern: '^[A-Za-z_]+(?:/[A-Za-z0-9_+.-]+)+$' }),
  state: Type.Union([Type.Literal('active'), Type.Literal('disabled'), Type.Literal('deletion-pending'), Type.Literal('deleted')]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  deletedAt: NullableTimestampSchema,
}, { additionalProperties: false })
export type PublicationMemberAccount = DeepReadonly<Static<typeof PublicationMemberAccountSchema>>

export const PublicationNewsletterConsentEventSchema = Type.Object({
  eventId: IdSchema,
  accountId: IdSchema,
  memberId: IdSchema,
  newsletterId: Type.Union([IdSchema, Type.Null()]),
  action: Type.Union([Type.Literal('subscribed'), Type.Literal('unsubscribed')]),
  source: Type.Union([Type.Literal('member-profile'), Type.Literal('staff'), Type.Literal('staff-import'), Type.Literal('one-click')]),
  noticeVersion: Type.String({ minLength: 1, maxLength: 100 }),
  sourceReceiptId: Type.Union([IdSchema, Type.Null()]),
  occurredAt: TimestampSchema,
}, { additionalProperties: false })
export type PublicationNewsletterConsentEvent = DeepReadonly<Static<typeof PublicationNewsletterConsentEventSchema>>

export const PublicationNewsletterConsentStateSchema = Type.Object({
  memberId: IdSchema,
  newsletterId: Type.Union([IdSchema, Type.Null()]),
  subscribed: Type.Boolean(),
  provenance: Type.Union([PublicationNewsletterConsentEventSchema, Type.Null()]),
}, { additionalProperties: false })
export type PublicationNewsletterConsentState = DeepReadonly<Static<typeof PublicationNewsletterConsentStateSchema>>

export const PublicationMemberSegmentSchema = Type.Object({
  segmentId: IdSchema,
  name: Type.String({ minLength: 1, maxLength: 160 }),
  kind: Type.Union([Type.Literal('explicit'), Type.Literal('dynamic')]),
  match: Type.Union([Type.Literal('all'), Type.Literal('any')]),
  rules: Type.Array(PublicationSegmentRuleSchema, { maxItems: 32 }),
  explicitMemberIds: Type.Array(IdSchema, { maxItems: 100000, uniqueItems: true }),
  version: VersionSchema,
  recalculatedAt: NullableTimestampSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}, { additionalProperties: false })
export type PublicationMemberSegment = DeepReadonly<Static<typeof PublicationMemberSegmentSchema>>

export const PublicationSegmentMembershipSnapshotSchema = Type.Object({
  segmentId: IdSchema,
  segmentVersion: VersionSchema,
  memberIds: Type.Array(IdSchema, { maxItems: 100000, uniqueItems: true }),
  calculatedAt: TimestampSchema,
}, { additionalProperties: false })
export type PublicationSegmentMembershipSnapshot = DeepReadonly<Static<typeof PublicationSegmentMembershipSnapshotSchema>>

export const PublicationMemberAccessSchema = Type.Object({
  accessId: IdSchema,
  memberId: IdSchema,
  source: Type.Union([Type.Literal('complimentary'), Type.Literal('manual'), Type.Literal('paid')]),
  state: Type.Union([Type.Literal('active'), Type.Literal('grace'), Type.Literal('expired'), Type.Literal('revoked')]),
  resourceKind: Type.Union([Type.Literal('publication'), Type.Literal('post'), Type.Literal('tag')]),
  resourceId: IdSchema,
  access: Type.Union([Type.Literal('read'), Type.Literal('premium')]),
  startsAt: TimestampSchema,
  expiresAt: NullableTimestampSchema,
  graceEndsAt: NullableTimestampSchema,
  paymentReferenceSha256: Type.Union([Sha256Schema, Type.Null()]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}, { additionalProperties: false })
export type PublicationMemberAccess = DeepReadonly<Static<typeof PublicationMemberAccessSchema>>

export const PublicationAccessEvaluationRequestSchema = Type.Object({
  memberIdentityId: Type.Union([IdSchema, Type.Null()]),
  contentId: IdSchema,
  mode: Type.Union([Type.Literal('public'), Type.Literal('preview')]),
  origin: HttpsUrlSchema,
  requestedPath: Type.String({ minLength: 1, maxLength: 1024, pattern: "^/(?!/)(?!.*[?#])(?:[A-Za-z0-9._~!$&'()*+,;=:@%/-]+)?$" }),
  evaluatedAt: TimestampSchema,
}, { additionalProperties: false })
export type PublicationAccessEvaluationRequest = DeepReadonly<Static<typeof PublicationAccessEvaluationRequestSchema>>

export const PublicationAccessEvaluationSchema = Type.Object({
  accountId: Type.Union([IdSchema, Type.Null()]),
  memberId: Type.Union([IdSchema, Type.Null()]),
  member: Type.Boolean(),
  paid: Type.Boolean(),
  segmentIds: Type.Array(IdSchema, { maxItems: 10000, uniqueItems: true }),
  accessSources: Type.Array(Type.Union([Type.Literal('complimentary'), Type.Literal('manual'), Type.Literal('paid')]), { maxItems: 3, uniqueItems: true }),
  accessState: Type.Union([Type.Literal('anonymous'), Type.Literal('active'), Type.Literal('grace'), Type.Literal('expired'), Type.Literal('revoked'), Type.Literal('disabled')]),
  presentation: PublicationPresentationDecisionSchema,
}, { additionalProperties: false })
export type PublicationAccessEvaluation = DeepReadonly<Static<typeof PublicationAccessEvaluationSchema>>

export const PublicationMemberExportSchema = Type.Object({
  exportId: IdSchema,
  generatedAt: TimestampSchema,
  account: PublicationMemberAccountSchema,
  member: PublicationMemberSchema,
  newsletterConsents: Type.Array(PublicationNewsletterConsentEventSchema, { maxItems: 100000 }),
  segments: Type.Array(PublicationSegmentMembershipSnapshotSchema, { maxItems: 10000 }),
  access: Type.Array(PublicationMemberAccessSchema, { maxItems: 100000 }),
}, { additionalProperties: false })
export type PublicationMemberExport = DeepReadonly<Static<typeof PublicationMemberExportSchema>>

export const PublicationPrivacyRequestSchema = Type.Object({
  requestId: IdSchema,
  accountId: IdSchema,
  memberId: IdSchema,
  kind: Type.Union([Type.Literal('export'), Type.Literal('deletion')]),
  state: Type.Union([Type.Literal('pending'), Type.Literal('processing'), Type.Literal('completed'), Type.Literal('failed')]),
  requestedBy: Type.Union([Type.Literal('member'), Type.Literal('staff')]),
  reason: Type.String({ maxLength: 500 }),
  createdAt: TimestampSchema,
  completedAt: NullableTimestampSchema,
}, { additionalProperties: false })
export type PublicationPrivacyRequest = DeepReadonly<Static<typeof PublicationPrivacyRequestSchema>>

export const PublicationAnalyticsEventSchema = Type.Object({
  eventId: IdSchema,
  occurredAt: TimestampSchema,
  kind: Type.Union([Type.Literal('page-view'), Type.Literal('post-view'), Type.Literal('member-signup'), Type.Literal('newsletter-open'), Type.Literal('newsletter-click')]),
  contentId: Type.Union([IdSchema, Type.Null()]),
  campaignId: Type.Union([IdSchema, Type.Null()]),
  memberId: Type.Union([IdSchema, Type.Null()]),
  anonymousVisitorHashSha256: Type.Union([Sha256Schema, Type.Null()]),
  referrerOrigin: Type.Union([HttpsUrlSchema, Type.Null()]),
}, { additionalProperties: false })
export type PublicationAnalyticsEvent = DeepReadonly<Static<typeof PublicationAnalyticsEventSchema>>

export const PublicationAnalyticsSummarySchema = Type.Object({
  from: TimestampSchema,
  to: TimestampSchema,
  views: Type.Integer({ minimum: 0 }),
  uniqueVisitors: Type.Integer({ minimum: 0 }),
  memberSignups: Type.Integer({ minimum: 0 }),
  newsletterOpens: Type.Integer({ minimum: 0 }),
  newsletterClicks: Type.Integer({ minimum: 0 }),
  topContent: Type.Array(Type.Object({ contentId: IdSchema, views: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }), { maxItems: 100 }),
}, { additionalProperties: false })
export type PublicationAnalyticsSummary = DeepReadonly<Static<typeof PublicationAnalyticsSummarySchema>>

export class PublicationContractError extends Error {
  readonly contract: string
  constructor(contract: string) {
    super(`Publication ${contract} contract failed validation.`)
    this.name = 'PublicationContractError'
    this.contract = contract
  }
}

export function parsePublicationContract<T extends TSchema>(contract: string, schema: T, value: unknown): DeepReadonly<Static<T>> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new PublicationContractError(contract)
  return deepFreeze(structuredClone(parsed.value))
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value as DeepReadonly<T>
}

import { Type, type Static } from '@core/utils/typeboxHelpers'
import { PublicationPresentationDecisionSchema } from './contracts'

const IdSchema = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const TimestampSchema = Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$' })
const TimezoneSchema = Type.String({ minLength: 1, maxLength: 100, pattern: '^[A-Za-z_]+(?:/[A-Za-z0-9_+.-]+)+$' })
const Sha256Schema = Type.String({ pattern: '^[a-f0-9]{64}$' })

export const PublicationScheduleActionSchema = Type.Union([Type.Literal('publish'), Type.Literal('unpublish')])
export const PublicationScheduleStateSchema = Type.Union([Type.Literal('pending'), Type.Literal('claimed'), Type.Literal('completed'), Type.Literal('superseded'), Type.Literal('cancelled')])
export const PublicationScheduleCommandSchema = Type.Object({
  scheduleId: IdSchema,
  contentId: IdSchema,
  action: PublicationScheduleActionSchema,
  expectedWorkflowVersion: Type.Integer({ minimum: 1 }),
  dueAt: TimestampSchema,
  displayTimezone: TimezoneSchema,
}, { additionalProperties: false })
export const PublicationScheduleRecordSchema = Type.Object({
  ...PublicationScheduleCommandSchema.properties,
  state: PublicationScheduleStateSchema,
  claimFence: Type.Integer({ minimum: 0 }),
  claimedBy: Type.Union([IdSchema, Type.Null()]),
  claimExpiresAt: Type.Union([TimestampSchema, Type.Null()]),
  completedAt: Type.Union([TimestampSchema, Type.Null()]),
  createdAt: TimestampSchema,
}, { additionalProperties: false })
export type PublicationScheduleCommand = Readonly<Static<typeof PublicationScheduleCommandSchema>>
export type PublicationScheduleRecord = Readonly<Static<typeof PublicationScheduleRecordSchema>>

export const PublicationPreviewIssueCommandSchema = Type.Object({
  tokenId: IdSchema,
  contentId: IdSchema,
  expiresAt: TimestampSchema,
}, { additionalProperties: false })
export const PublicationPreviewTokenRecordSchema = Type.Object({
  tokenId: IdSchema,
  contentId: IdSchema,
  tokenDigestSha256: Sha256Schema,
  expiresAt: TimestampSchema,
  createdAt: TimestampSchema,
  revokedAt: Type.Union([TimestampSchema, Type.Null()]),
  lastUsedAt: Type.Union([TimestampSchema, Type.Null()]),
  useCount: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false })
export const PublicationPreviewIssueResultSchema = Type.Object({
  tokenId: IdSchema,
  contentId: IdSchema,
  token: Type.String({ minLength: 43, maxLength: 512 }),
  expiresAt: TimestampSchema,
  createdAt: TimestampSchema,
}, { additionalProperties: false })
export const PublicationPreviewRevokeCommandSchema = Type.Object({ tokenId: IdSchema }, { additionalProperties: false })
export type PublicationPreviewIssueCommand = Readonly<Static<typeof PublicationPreviewIssueCommandSchema>>
export type PublicationPreviewTokenRecord = Readonly<Static<typeof PublicationPreviewTokenRecordSchema>>
export type PublicationPreviewIssueResult = Readonly<Static<typeof PublicationPreviewIssueResultSchema>>

export const PublicationPublicResolveRequestSchema = Type.Object({
  contentId: IdSchema,
  previewToken: Type.Union([Type.String({ minLength: 43, maxLength: 512 }), Type.Null()]),
  requestedPath: Type.String({ minLength: 1, maxLength: 1024, pattern: "^/(?!/)(?!.*[?#])(?:[A-Za-z0-9._~!$&'()*+,;=:@%/-]+)?$" }),
}, { additionalProperties: false })
export const PublicationPublicResolveResultSchema = Type.Object({
  contentId: IdSchema,
  audience: Type.Union([Type.Literal('anonymous'), Type.Literal('member'), Type.Literal('paid'), Type.Literal('segment'), Type.Literal('preview')]),
  presentation: PublicationPresentationDecisionSchema,
}, { additionalProperties: false })
export type PublicationPublicResolveRequest = Readonly<Static<typeof PublicationPublicResolveRequestSchema>>
export type PublicationPublicResolveResult = Readonly<Static<typeof PublicationPublicResolveResultSchema>>

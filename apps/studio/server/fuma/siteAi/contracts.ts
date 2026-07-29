import { AiToolOutputSchema, type AiToolOutput } from '@core/ai'
import {
  Type,
  safeParseValue,
  type Static,
  type TSchema,
} from '@core/utils/typeboxHelpers'

const MAX = Number.MAX_SAFE_INTEGER
const Id = Type.String({
  minLength: 1,
  maxLength: 255,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]*$',
})
const Timestamp = Type.String({ format: 'date-time' })
const Sha256 = Type.String({ pattern: '^[a-f0-9]{64}$' })
const Positive = Type.Integer({ minimum: 1, maximum: MAX })
const Units = Type.Integer({ minimum: 0, maximum: MAX })
const Capability = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[a-z][a-z0-9.-]*$',
})

export const SiteAiProfileSchema = Type.Union([
  Type.Literal('website'),
  Type.Literal('publication'),
])
export type SiteAiProfile = Readonly<Static<typeof SiteAiProfileSchema>>

export const SiteAiScopeSchema = Type.Object({
  platformId: Id,
  organizationId: Id,
  workspaceId: Id,
  siteId: Id,
  ownerKey: Id,
  ownerGeneration: Positive,
  profileId: SiteAiProfileSchema,
}, { additionalProperties: false })
export type SiteAiScope = Readonly<Static<typeof SiteAiScopeSchema>>

export const SiteAiActorSchema = Type.Object({
  actorId: Id,
  sessionId: Id,
  editorSessionId: Id,
}, { additionalProperties: false })
export type SiteAiActor = Readonly<Static<typeof SiteAiActorSchema>>

export const SiteAiAuthoritySnapshotSchema = Type.Object({
  scope: SiteAiScopeSchema,
  actor: SiteAiActorSchema,
  capabilities: Type.Array(Capability, { uniqueItems: true, maxItems: 256 }),
  state: Type.Union([Type.Literal('active'), Type.Literal('revoked')]),
  revision: Positive,
  observedAt: Timestamp,
}, { additionalProperties: false })
export type SiteAiAuthoritySnapshot = Readonly<Static<typeof SiteAiAuthoritySnapshotSchema>>

export const SiteAiConversationBindingSchema = Type.Object({
  conversationId: Id,
  scope: SiteAiScopeSchema,
  actor: SiteAiActorSchema,
  createdAt: Timestamp,
}, { additionalProperties: false })
export type SiteAiConversationBinding = Readonly<Static<typeof SiteAiConversationBindingSchema>>

export const SiteAiSnapshotBindingSchema = Type.Object({
  snapshotId: Id,
  conversationId: Id,
  scope: SiteAiScopeSchema,
  actorId: Id,
  sequence: Units,
  snapshotHashSha256: Sha256,
  createdAt: Timestamp,
}, { additionalProperties: false })
export type SiteAiSnapshotBinding = Readonly<Static<typeof SiteAiSnapshotBindingSchema>>

export const SiteAiTurnStateSchema = Type.Union([
  Type.Literal('running'),
  Type.Literal('succeeded'),
  Type.Literal('failed'),
  Type.Literal('denied'),
])
export const SiteAiTurnJobSchema = Type.Object({
  jobId: Id,
  conversationId: Id,
  snapshotId: Id,
  scope: SiteAiScopeSchema,
  actor: SiteAiActorSchema,
  authorityRevision: Positive,
  providerId: Id,
  modelId: Id,
  requiredCapability: Capability,
  reservationId: Type.Union([Id, Type.Null()]),
  state: SiteAiTurnStateSchema,
  attempt: Positive,
  promptTokens: Units,
  completionTokens: Units,
  failureCode: Type.Union([Id, Type.Null()]),
  createdAt: Timestamp,
  updatedAt: Timestamp,
}, { additionalProperties: false })
export type SiteAiTurnJob = Readonly<Static<typeof SiteAiTurnJobSchema>>

export const SiteAiToolReceiptSchema = Type.Object({
  jobId: Id,
  toolCallId: Id,
  toolName: Id,
  inputHashSha256: Sha256,
  mutates: Type.Boolean(),
  state: Type.Union([
    Type.Literal('started'),
    Type.Literal('completed'),
    Type.Literal('failed'),
  ]),
  attempt: Positive,
  output: Type.Union([AiToolOutputSchema, Type.Null()]),
  createdAt: Timestamp,
  completedAt: Type.Union([Timestamp, Type.Null()]),
}, { additionalProperties: false })
export type SiteAiToolReceipt = Readonly<Omit<Static<typeof SiteAiToolReceiptSchema>, 'output'> & {
  output: AiToolOutput | null
}>

export const SiteAiAuditActionSchema = Type.Union([
  Type.Literal('site.ai.conversation.bound'),
  Type.Literal('site.ai.snapshot.bound'),
  Type.Literal('site.ai.turn.started'),
  Type.Literal('site.ai.turn.succeeded'),
  Type.Literal('site.ai.turn.failed'),
  Type.Literal('site.ai.turn.denied'),
  Type.Literal('site.ai.tool.started'),
  Type.Literal('site.ai.tool.completed'),
  Type.Literal('site.ai.tool.failed'),
])
export type SiteAiAuditAction = Readonly<Static<typeof SiteAiAuditActionSchema>>
export const SiteAiAuditFactSchema = Type.Object({
  auditId: Id,
  action: SiteAiAuditActionSchema,
  scope: SiteAiScopeSchema,
  actorId: Id,
  conversationId: Id,
  snapshotId: Type.Union([Id, Type.Null()]),
  jobId: Type.Union([Id, Type.Null()]),
  toolCallId: Type.Union([Id, Type.Null()]),
  outcome: Type.Union([
    Type.Literal('success'),
    Type.Literal('failure'),
    Type.Literal('denied'),
  ]),
  reasonCode: Type.Union([Id, Type.Null()]),
  occurredAt: Timestamp,
}, { additionalProperties: false })
export type SiteAiAuditFact = Readonly<Static<typeof SiteAiAuditFactSchema>>

export const BindSiteAiConversationCommandSchema = Type.Object({
  conversationId: Id,
  authority: SiteAiAuthoritySnapshotSchema,
}, { additionalProperties: false })
export type BindSiteAiConversationCommand = Readonly<Static<typeof BindSiteAiConversationCommandSchema>>

export const BindSiteAiSnapshotCommandSchema = Type.Object({
  snapshotId: Id,
  conversationId: Id,
  sequence: Units,
  snapshotHashSha256: Sha256,
  authority: SiteAiAuthoritySnapshotSchema,
}, { additionalProperties: false })
export type BindSiteAiSnapshotCommand = Readonly<Static<typeof BindSiteAiSnapshotCommandSchema>>

export const BeginSiteAiTurnCommandSchema = Type.Object({
  jobId: Id,
  conversationId: Id,
  snapshotId: Id,
  providerId: Id,
  modelId: Id,
  requiredCapability: Capability,
  estimatedInputTokens: Units,
  estimatedOutputTokens: Units,
  attempt: Positive,
  authority: SiteAiAuthoritySnapshotSchema,
}, { additionalProperties: false })
export type BeginSiteAiTurnCommand = Readonly<Static<typeof BeginSiteAiTurnCommandSchema>>

export class SiteAiContractError extends Error {
  override readonly name = 'SiteAiContractError'
  readonly boundary: string
  constructor(boundary: string) {
    super(`${boundary} failed strict TypeBox validation.`)
    this.boundary = boundary
  }
}

export function parseSiteAiContract<T extends TSchema>(
  schema: T,
  value: unknown,
  boundary: string,
): Static<T> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new SiteAiContractError(boundary)
  return structuredClone(parsed.value)
}

export function sameSiteAiScope(left: SiteAiScope, right: SiteAiScope): boolean {
  return left.platformId === right.platformId
    && left.organizationId === right.organizationId
    && left.workspaceId === right.workspaceId
    && left.siteId === right.siteId
    && left.ownerKey === right.ownerKey
    && left.ownerGeneration === right.ownerGeneration
    && left.profileId === right.profileId
}

export function sameSiteAiActor(left: SiteAiActor, right: SiteAiActor): boolean {
  return left.actorId === right.actorId
    && left.sessionId === right.sessionId
    && left.editorSessionId === right.editorSessionId
}

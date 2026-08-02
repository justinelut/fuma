import { createHash } from 'node:crypto'
import { Type, Value, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'

const Id = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const Hash = Type.String({ pattern: '^[a-f0-9]{64}$' })
const Timestamp = Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$' })
const Capability = Type.String({ minLength: 3, maxLength: 160, pattern: '^[a-z][a-z0-9.:-]+$' })
const EvidenceKey = Type.String({ minLength: 12, maxLength: 512, pattern: '^(?:support|moderation|break-glass)/evidence/[A-Za-z0-9._/-]+$' })
const JsonKey = Type.String({ minLength: 1, maxLength: 160, pattern: '^[^\\u0000-\\u001F\\u007F]+$' })
export const SupportJsonValueSchema = Type.Recursive((Self) => Type.Union([
  Type.Null(), Type.Boolean(), Type.Number(), Type.String({ maxLength: 100_000 }),
  Type.Array(Self, { maxItems: 1_000 }),
  Type.Record(JsonKey, Self, { maxProperties: 1_000 }),
]))
export type SupportJsonValue = Static<typeof SupportJsonValueSchema>

export const SupportTenantScopeSchema = Type.Object({
  platformId: Id,
  organizationId: Id,
  workspaceId: Id,
  siteId: Id,
  ownerKey: Id,
  ownerGeneration: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
}, { additionalProperties: false })
export type SupportTenantScope = Static<typeof SupportTenantScopeSchema>

export const ImmutableEvidenceReferenceSchema = Type.Object({
  objectKey: EvidenceKey,
  hashSha256: Hash,
}, { additionalProperties: false })
export type ImmutableEvidenceReference = Static<typeof ImmutableEvidenceReferenceSchema>

export const CurrentStaffAuthoritySchema = Type.Object({
  userId: Id,
  sessionId: Id,
  impersonatedBy: Type.Union([Id, Type.Null()]),
  stepUpAt: Type.Union([Timestamp, Type.Null()]),
  active: Type.Boolean(),
  protectedOwner: Type.Boolean(),
  capabilities: Type.Array(Capability, { maxItems: 128, uniqueItems: true }),
}, { additionalProperties: false })
export type CurrentStaffAuthority = Static<typeof CurrentStaffAuthoritySchema>

export const SupportTargetAuthoritySchema = Type.Object({
  userId: Id,
  active: Type.Boolean(),
  protectedOwner: Type.Boolean(),
  capabilities: Type.Array(Capability, { maxItems: 256, uniqueItems: true }),
}, { additionalProperties: false })
export type SupportTargetAuthority = Static<typeof SupportTargetAuthoritySchema>

export const BeginSupportCommandSchema = Type.Object({
  supportSessionId: Id,
  targetUserId: Id,
  reason: Type.String({ minLength: 10, maxLength: 500, pattern: '\\S' }),
  durationMinutes: Type.Integer({ minimum: 1, maximum: 30 }),
  evidence: ImmutableEvidenceReferenceSchema,
}, { additionalProperties: false })
export type BeginSupportCommand = Static<typeof BeginSupportCommandSchema>

export const SupportSessionRecordSchema = Type.Object({
  supportSessionId: Id,
  scope: SupportTenantScopeSchema,
  staffActorId: Id,
  staffSessionId: Id,
  targetUserId: Id,
  reason: Type.String({ minLength: 10, maxLength: 500 }),
  stepUpAt: Timestamp,
  startedAt: Timestamp,
  expiresAt: Timestamp,
  banner: Type.Literal('Support session active — actions are performed as this account and are audited.'),
  evidence: ImmutableEvidenceReferenceSchema,
}, { additionalProperties: false })
export type SupportSessionRecord = Static<typeof SupportSessionRecordSchema>

export const SupportSessionEndReasonSchema = Type.Union([
  Type.Literal('completed'),
  Type.Literal('expired'),
  Type.Literal('revoked'),
])

export const EndSupportCommandSchema = Type.Object({
  supportSessionId: Id,
  reasonCode: SupportSessionEndReasonSchema,
}, { additionalProperties: false })
export type EndSupportCommand = Static<typeof EndSupportCommandSchema>

export const SupportSessionEndRecordSchema = Type.Object({
  supportSessionId: Id,
  endedByActorId: Id,
  reasonCode: SupportSessionEndReasonSchema,
  endedAt: Timestamp,
}, { additionalProperties: false })
export type SupportSessionEndRecord = Static<typeof SupportSessionEndRecordSchema>

export const SupportActionCommandSchema = Type.Object({
  supportSessionId: Id,
  capability: Capability,
  operationId: Id,
  input: SupportJsonValueSchema,
}, { additionalProperties: false })
export type SupportActionCommand = Static<typeof SupportActionCommandSchema>

export const SupportActionRecordSchema = Type.Object({
  supportSessionId: Id,
  operationId: Id,
  capability: Capability,
  inputHashSha256: Hash,
  actorId: Id,
  createdAt: Timestamp,
}, { additionalProperties: false })
export type SupportActionRecord = Static<typeof SupportActionRecordSchema>

export const SupportOperationEffectKindSchema = Type.Union([
  Type.Literal('support-started'),
  Type.Literal('support-ended'),
  Type.Literal('support-action-executed'),
  Type.Literal('moderation-applied'),
  Type.Literal('recovery-executed'),
])
export type SupportOperationEffectKind = Static<typeof SupportOperationEffectKindSchema>

export const SupportOperationEffectRecordSchema = Type.Object({
  effectKey: Id,
  kind: SupportOperationEffectKindSchema,
  operationId: Id,
  completedAt: Timestamp,
}, { additionalProperties: false })
export type SupportOperationEffectRecord = Static<typeof SupportOperationEffectRecordSchema>

export const ModerationSubjectSchema = Type.Object({
  kind: Type.Union([Type.Literal('user'), Type.Literal('organization'), Type.Literal('site'), Type.Literal('expert'), Type.Literal('plugin')]),
  id: Id,
}, { additionalProperties: false })
export type ModerationSubject = Static<typeof ModerationSubjectSchema>

export const RecordModerationCommandSchema = Type.Object({
  evidenceId: Id,
  caseId: Id,
  priorEvidenceId: Type.Union([Id, Type.Null()]),
  subject: ModerationSubjectSchema,
  event: Type.Union([Type.Literal('opened'), Type.Literal('suspended'), Type.Literal('appealed'), Type.Literal('resolved')]),
  reasonCode: Type.String({ minLength: 3, maxLength: 96, pattern: '^[a-z][a-z0-9-]+$' }),
  reason: Type.String({ minLength: 10, maxLength: 1_000, pattern: '\\S' }),
  evidence: ImmutableEvidenceReferenceSchema,
}, { additionalProperties: false })
export type RecordModerationCommand = Static<typeof RecordModerationCommandSchema>

export const ModerationEvidenceRecordSchema = Type.Object({
  evidenceId: Id,
  caseId: Id,
  priorEvidenceId: Type.Union([Id, Type.Null()]),
  scope: SupportTenantScopeSchema,
  subject: ModerationSubjectSchema,
  event: Type.Union([Type.Literal('opened'), Type.Literal('suspended'), Type.Literal('appealed'), Type.Literal('resolved')]),
  reasonCode: Type.String({ minLength: 3, maxLength: 96 }),
  reason: Type.String({ minLength: 10, maxLength: 1_000 }),
  evidence: ImmutableEvidenceReferenceSchema,
  actorId: Id,
  createdAt: Timestamp,
}, { additionalProperties: false })
export type ModerationEvidenceRecord = Static<typeof ModerationEvidenceRecordSchema>


export const ModerationQueueSchema = Type.Union([
  Type.Literal('moderation'),
  Type.Literal('suspension'),
  Type.Literal('appeal'),
])
export type ModerationQueue = Static<typeof ModerationQueueSchema>

export const ListModerationQueueCommandSchema = Type.Object({
  queue: ModerationQueueSchema,
  afterEvidenceId: Type.Union([Id, Type.Null()]),
  limit: Type.Integer({ minimum: 1, maximum: 100 }),
}, { additionalProperties: false })
export type ListModerationQueueCommand = Static<typeof ListModerationQueueCommandSchema>

export const ModerationQueuePageSchema = Type.Object({
  queue: ModerationQueueSchema,
  rows: Type.Array(ModerationEvidenceRecordSchema, { maxItems: 100 }),
  nextAfterEvidenceId: Type.Union([Id, Type.Null()]),
}, { additionalProperties: false })
export type ModerationQueuePage = Static<typeof ModerationQueuePageSchema>
export const CreateBreakGlassRequestSchema = Type.Object({
  requestId: Id,
  targetOwnerId: Id,
  reason: Type.String({ minLength: 20, maxLength: 1_000, pattern: '\\S' }),
  expiresInMinutes: Type.Integer({ minimum: 1, maximum: 15 }),
  evidence: ImmutableEvidenceReferenceSchema,
  channel: Type.Literal('isolated-owner-recovery'),
}, { additionalProperties: false })
export type CreateBreakGlassRequest = Static<typeof CreateBreakGlassRequestSchema>

export const BreakGlassRequestRecordSchema = Type.Object({
  requestId: Id,
  scope: SupportTenantScopeSchema,
  targetOwnerId: Id,
  requestedByActorId: Id,
  reason: Type.String({ minLength: 20, maxLength: 1_000 }),
  evidence: ImmutableEvidenceReferenceSchema,
  channel: Type.Literal('isolated-owner-recovery'),
  createdAt: Timestamp,
  expiresAt: Timestamp,
}, { additionalProperties: false })
export type BreakGlassRequestRecord = Static<typeof BreakGlassRequestRecordSchema>

export const ApproveBreakGlassCommandSchema = Type.Object({
  approvalId: Id,
  requestId: Id,
  evidence: ImmutableEvidenceReferenceSchema,
  channel: Type.Literal('isolated-owner-recovery'),
}, { additionalProperties: false })
export type ApproveBreakGlassCommand = Static<typeof ApproveBreakGlassCommandSchema>

export const BreakGlassApprovalRecordSchema = Type.Object({
  approvalId: Id,
  requestId: Id,
  approverId: Id,
  approverSessionId: Id,
  stepUpAt: Timestamp,
  evidence: ImmutableEvidenceReferenceSchema,
  approvedAt: Timestamp,
}, { additionalProperties: false })
export type BreakGlassApprovalRecord = Static<typeof BreakGlassApprovalRecordSchema>

export const ExecuteBreakGlassCommandSchema = Type.Object({
  executionId: Id,
  requestId: Id,
  recoveryIdempotencyKey: Id,
  channel: Type.Literal('isolated-owner-recovery'),
}, { additionalProperties: false })
export type ExecuteBreakGlassCommand = Static<typeof ExecuteBreakGlassCommandSchema>

export const BreakGlassExecutionRecordSchema = Type.Object({
  executionId: Id,
  requestId: Id,
  executorId: Id,
  approverIds: Type.Tuple([Id, Id]),
  recoveryIdempotencyKey: Id,
  executedAt: Timestamp,
}, { additionalProperties: false })
export type BreakGlassExecutionRecord = Static<typeof BreakGlassExecutionRecordSchema>

export type SupportOperationsErrorCode = 'invalid-contract' | 'authority-denied' | 'scope-denied' | 'protected-owner-denied' | 'nested-impersonation-denied' | 'step-up-required' | 'expired' | 'conflict' | 'invalid-transition' | 'evidence-denied'
export class SupportOperationsError extends Error {
  readonly code: SupportOperationsErrorCode
  constructor(code: SupportOperationsErrorCode, message: string) {
    super(message)
    this.name = 'SupportOperationsError'
    this.code = code
  }
}

export function parseSupportContract<T extends TSchema>(schema: T, value: unknown, label: string): Readonly<Static<T>> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) {
    const first = Value.Errors(schema, value).First()
    throw new SupportOperationsError('invalid-contract', `${label} failed strict TypeBox validation${first ? ` at ${first.path || '/'}: ${first.message}` : ''}.`)
  }
  return deepFreeze(parsed.value)
}

export function supportEvidenceHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(',')}}`
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

import {
  Type,
  Value,
  type Static,
  type TSchema,
} from '@core/utils/typeboxHelpers'

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T

type Contract<T> = DeepReadonly<T>

const ID_OPTIONS = {
  minLength: 1,
  maxLength: 255,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
} as const
const TIMESTAMP_OPTIONS = {
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$',
} as const

export const AUDIT_METADATA_MAX_DEPTH = 6
export const AUDIT_METADATA_MAX_PROPERTIES = 64
export const AUDIT_METADATA_MAX_ARRAY_ITEMS = 64
export const AUDIT_METADATA_MAX_NODES = 512
export const AUDIT_METADATA_MAX_STRING_LENGTH = 4_096
export const AUDIT_METADATA_MAX_BYTES = 32_768

export const FUMA_AUDIT_ACTIONS = Object.freeze([
  'auth.login.succeeded',
  'auth.login.failed',
  'auth.logout.succeeded',
  'auth.mfa.challenge-failed',
  'auth.session.revoked',
  'access.impersonation.started',
  'access.impersonation.ended',
  'support.action.authorized',
  'moderation.evidence.recorded',
  'breakglass.recovery.requested',
  'breakglass.recovery.approved',
  'breakglass.recovery.executed',
  'access.denied',
  'permission.role.assigned',
  'permission.role.removed',
  'permission.override.changed',
  'context.request.resolved',
  'context.request.denied',
  'job.enqueued',
  'job.started',
  'job.succeeded',
  'job.failed',
  'job.cancelled',
  'job.dead-lettered',
  'organization.created',
  'organization.updated',
  'organization.suspended',
  'organization.restored',
  'organization.member.invited',
  'organization.member.role-changed',
  'workspace.created',
  'workspace.updated',
  'workspace.archived',
  'workspace.restored',
  'workspace.membership.override-changed',
  'site.created',
  'site.updated',
  'site.archived',
  'site.restored',
  'site.capabilities.changed',
  'publication.workflow.role-changed',
  'publication.workflow.assignment-changed',
  'publication.workflow.review-requested',
  'publication.workflow.decision-recorded',
  'transfer.proposed',
  'transfer.confirmed',
  'transfer.started',
  'transfer.step.completed',
  'transfer.failed',
  'transfer.resumed',
  'transfer.compensated',
  'transfer.completed',
  'transfer.cancelled',
] as const)

export const AuditActionSchema = Type.Union(
  FUMA_AUDIT_ACTIONS.map((action) => Type.Literal(action)),
)
export type AuditAction = Contract<Static<typeof AuditActionSchema>>

export const AuditIdSchema = Type.String(ID_OPTIONS)
export type AuditId = Contract<Static<typeof AuditIdSchema>>

export const AuditPlatformScopeSchema = Type.Object({
  kind: Type.Literal('platform'),
  platformId: AuditIdSchema,
}, { additionalProperties: false })
export type AuditPlatformScope = Contract<Static<typeof AuditPlatformScopeSchema>>

export const AuditOrganizationScopeSchema = Type.Object({
  kind: Type.Literal('organization'),
  platformId: AuditIdSchema,
  organizationId: AuditIdSchema,
}, { additionalProperties: false })
export type AuditOrganizationScope = Contract<Static<typeof AuditOrganizationScopeSchema>>

export const AuditWorkspaceScopeSchema = Type.Object({
  kind: Type.Literal('workspace'),
  platformId: AuditIdSchema,
  organizationId: AuditIdSchema,
  workspaceId: AuditIdSchema,
}, { additionalProperties: false })
export type AuditWorkspaceScope = Contract<Static<typeof AuditWorkspaceScopeSchema>>

export const AuditSiteScopeSchema = Type.Object({
  kind: Type.Literal('site'),
  platformId: AuditIdSchema,
  organizationId: AuditIdSchema,
  workspaceId: AuditIdSchema,
  siteId: AuditIdSchema,
}, { additionalProperties: false })
export type AuditSiteScope = Contract<Static<typeof AuditSiteScopeSchema>>

/** Every narrower scope carries its complete tenant ancestry. */
export const AuditTenantScopeSchema = Type.Union([
  AuditPlatformScopeSchema,
  AuditOrganizationScopeSchema,
  AuditWorkspaceScopeSchema,
  AuditSiteScopeSchema,
])
export type AuditTenantScope = Contract<Static<typeof AuditTenantScopeSchema>>

export const AuditImpersonatorSchema = Type.Object({
  userId: AuditIdSchema,
}, { additionalProperties: false })
export type AuditImpersonator = Contract<Static<typeof AuditImpersonatorSchema>>

export const AuditStaffActorSchema = Type.Object({
  kind: Type.Literal('staff'),
  userId: AuditIdSchema,
  sessionId: AuditIdSchema,
  impersonator: Type.Union([AuditImpersonatorSchema, Type.Null()]),
}, { additionalProperties: false })
export type AuditStaffActor = Contract<Static<typeof AuditStaffActorSchema>>

export const AuditJobActorSchema = Type.Object({
  kind: Type.Literal('internal-job'),
  jobId: AuditIdSchema,
  runId: AuditIdSchema,
}, { additionalProperties: false })
export type AuditJobActor = Contract<Static<typeof AuditJobActorSchema>>

export const AuditActorSchema = Type.Union([
  AuditStaffActorSchema,
  AuditJobActorSchema,
])
export type AuditActor = Contract<Static<typeof AuditActorSchema>>

export const AuditRequestCorrelationSchema = Type.Object({
  kind: Type.Literal('request'),
  requestId: AuditIdSchema,
}, { additionalProperties: false })
export type AuditRequestCorrelation = Contract<Static<typeof AuditRequestCorrelationSchema>>

export const AuditJobCorrelationSchema = Type.Object({
  kind: Type.Literal('job'),
  requestId: AuditIdSchema,
  jobId: AuditIdSchema,
  runId: AuditIdSchema,
  originatingRequestId: Type.Union([AuditIdSchema, Type.Null()]),
}, { additionalProperties: false })
export type AuditJobCorrelation = Contract<Static<typeof AuditJobCorrelationSchema>>

export const AuditCorrelationSchema = Type.Union([
  AuditRequestCorrelationSchema,
  AuditJobCorrelationSchema,
])
export type AuditCorrelation = Contract<Static<typeof AuditCorrelationSchema>>

export const AuditOutcomeSchema = Type.Union([
  Type.Literal('success'),
  Type.Literal('failure'),
  Type.Literal('denied'),
])
export type AuditOutcome = Contract<Static<typeof AuditOutcomeSchema>>

export const AuditMetadataKeySchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._ -]*$',
})

export const AuditMetadataValueSchema = Type.Recursive((Self) => Type.Union([
  Type.Null(),
  Type.Boolean(),
  Type.Number(),
  Type.String({ maxLength: AUDIT_METADATA_MAX_STRING_LENGTH }),
  Type.Array(Self, { maxItems: AUDIT_METADATA_MAX_ARRAY_ITEMS }),
  Type.Record(AuditMetadataKeySchema, Self, {
    maxProperties: AUDIT_METADATA_MAX_PROPERTIES,
  }),
]))
export type AuditMetadataValue = Contract<Static<typeof AuditMetadataValueSchema>>

export const AuditMetadataSchema = Type.Record(
  AuditMetadataKeySchema,
  AuditMetadataValueSchema,
  { maxProperties: AUDIT_METADATA_MAX_PROPERTIES },
)
export type AuditMetadata = Contract<Static<typeof AuditMetadataSchema>>

const AUDIT_EVENT_PROPERTIES = {
  action: AuditActionSchema,
  scope: AuditTenantScopeSchema,
  actor: AuditActorSchema,
  correlation: AuditCorrelationSchema,
  outcome: AuditOutcomeSchema,
  metadata: AuditMetadataSchema,
} as const

export const AuditAppendInputSchema = Type.Object(AUDIT_EVENT_PROPERTIES, {
  additionalProperties: false,
})
export type AuditAppendInput = Contract<Static<typeof AuditAppendInputSchema>>

export const CreatedAuditEventSchema = Type.Object({
  id: AuditIdSchema,
  ...AUDIT_EVENT_PROPERTIES,
  createdAt: Type.String(TIMESTAMP_OPTIONS),
}, { additionalProperties: false })
export type CreatedAuditEvent = Contract<Static<typeof CreatedAuditEventSchema>>

export const AuditActorFilterSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('staff'),
    userId: AuditIdSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('internal-job'),
    jobId: AuditIdSchema,
  }, { additionalProperties: false }),
])
export type AuditActorFilter = Contract<Static<typeof AuditActorFilterSchema>>

export const AuditListFilterSchema = Type.Object({
  scope: AuditTenantScopeSchema,
  actions: Type.Optional(Type.Array(AuditActionSchema, {
    minItems: 1,
    maxItems: FUMA_AUDIT_ACTIONS.length,
    uniqueItems: true,
  })),
  actor: Type.Optional(AuditActorFilterSchema),
  outcomes: Type.Optional(Type.Array(AuditOutcomeSchema, {
    minItems: 1,
    maxItems: 3,
    uniqueItems: true,
  })),
  requestId: Type.Optional(AuditIdSchema),
  jobId: Type.Optional(AuditIdSchema),
  createdAfter: Type.Optional(Type.String(TIMESTAMP_OPTIONS)),
  createdBefore: Type.Optional(Type.String(TIMESTAMP_OPTIONS)),
  cursor: Type.Optional(AuditIdSchema),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
}, { additionalProperties: false })
export type AuditListFilter = Contract<Static<typeof AuditListFilterSchema>>

export const AuditContractErrorCodeSchema = Type.Union([
  Type.Literal('invalid-contract'),
  Type.Literal('actor-correlation-mismatch'),
  Type.Literal('invalid-impersonation'),
  Type.Literal('invalid-time-range'),
])
export type AuditContractErrorCode = Contract<Static<typeof AuditContractErrorCodeSchema>>

export class AuditContractError extends Error {
  readonly code: AuditContractErrorCode
  readonly path: string

  constructor(code: AuditContractErrorCode, message: string, path: string) {
    super(message)
    this.name = 'AuditContractError'
    this.code = code
    this.path = path
  }
}

function assertSchema<T extends TSchema>(
  schema: T,
  value: unknown,
  path: string,
): asserts value is Static<T> {
  if (Value.Check(schema, value)) return
  const error = Value.Errors(schema, value).First()
  throw new AuditContractError(
    'invalid-contract',
    `${path} does not match its TypeBox contract${error ? `: ${error.path || '/'} ${error.message}` : ''}.`,
    path,
  )
}

function assertActorCorrelation(
  actor: AuditActor,
  correlation: AuditCorrelation,
): void {
  if (actor.kind === 'staff') {
    if (correlation.kind !== 'request') {
      throw new AuditContractError(
        'actor-correlation-mismatch',
        'A staff audit actor requires request correlation.',
        'event.correlation',
      )
    }
    if (actor.impersonator?.userId === actor.userId) {
      throw new AuditContractError(
        'invalid-impersonation',
        'An audit impersonator must be distinct from the effective actor.',
        'event.actor.impersonator.userId',
      )
    }
    return
  }

  if (
    correlation.kind !== 'job'
    || correlation.jobId !== actor.jobId
    || correlation.runId !== actor.runId
  ) {
    throw new AuditContractError(
      'actor-correlation-mismatch',
      'An internal-job audit actor must match its durable job correlation.',
      'event.correlation',
    )
  }
}

export function assertAuditAppendInput(
  value: unknown,
): asserts value is AuditAppendInput {
  assertSchema(AuditAppendInputSchema, value, 'event')
  assertActorCorrelation(value.actor, value.correlation)
}

export function assertCreatedAuditEvent(
  value: unknown,
): asserts value is CreatedAuditEvent {
  assertSchema(CreatedAuditEventSchema, value, 'event')
  assertActorCorrelation(value.actor, value.correlation)
}

export function assertAuditListFilter(
  value: unknown,
): asserts value is AuditListFilter {
  assertSchema(AuditListFilterSchema, value, 'filter')
  if (
    value.createdAfter !== undefined
    && value.createdBefore !== undefined
    && value.createdAfter > value.createdBefore
  ) {
    throw new AuditContractError(
      'invalid-time-range',
      'Audit createdAfter must not be later than createdBefore.',
      'filter.createdAfter',
    )
  }
}

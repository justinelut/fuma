import {
  Type,
  safeParseValue,
  type Static,
  type TSchema,
} from '@core/utils/typeboxHelpers'

const Strict = { additionalProperties: false } as const
const Id = Type.String({
  minLength: 1,
  maxLength: 255,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]*$',
})
const CapabilityId = Type.String({
  minLength: 3,
  maxLength: 160,
  pattern: '^[a-z][a-z0-9.-]*$',
})
const Version = Type.String({
  minLength: 5,
  maxLength: 64,
  pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$',
})
const Timestamp = Type.String({ format: 'date-time' })
const Sha256 = Type.String({ pattern: '^[a-f0-9]{64}$' })
const Positive = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })

export const BackendCapabilityChannelSchema = Type.Union([
  Type.Literal('site-ai'),
  Type.Literal('mcp'),
  Type.Literal('imported-runtime'),
  Type.Literal('export-adapter'),
])
export type BackendCapabilityChannel = Static<typeof BackendCapabilityChannelSchema>

export const BackendCapabilityScopeSchema = Type.Object({
  platformId: Id,
  organizationId: Id,
  workspaceId: Id,
  siteId: Id,
  ownerKey: Id,
  ownerGeneration: Positive,
  profileId: Type.Union([Type.Literal('website'), Type.Literal('publication')]),
}, Strict)
export type BackendCapabilityScope = Readonly<Static<typeof BackendCapabilityScopeSchema>>

export const BackendCapabilityActorSchema = Type.Object({
  kind: Type.Union([Type.Literal('staff'), Type.Literal('member')]),
  actorId: Id,
  sessionId: Id,
  impersonatorId: Type.Union([Id, Type.Null()]),
}, Strict)
export type BackendCapabilityActor = Readonly<Static<typeof BackendCapabilityActorSchema>>

export const BackendCapabilityConfirmationSchema = Type.Object({
  confirmationId: Id,
  actorId: Id,
  operationId: Id,
  capabilityId: CapabilityId,
  capabilityVersion: Version,
  ownerKey: Id,
  ownerGeneration: Positive,
  confirmedAt: Timestamp,
}, Strict)
export type BackendCapabilityConfirmation = Readonly<Static<typeof BackendCapabilityConfirmationSchema>>

export const BackendCapabilityMetadataSchema = Type.Object({
  id: CapabilityId,
  version: Version,
  title: Type.String({ minLength: 1, maxLength: 160 }),
  description: Type.String({ minLength: 1, maxLength: 1_000 }),
  class: Type.Union([
    Type.Literal('read'),
    Type.Literal('mutate'),
    Type.Literal('confirm'),
  ]),
  profiles: Type.Array(
    Type.Union([Type.Literal('website'), Type.Literal('publication')]),
    { minItems: 1, maxItems: 2, uniqueItems: true },
  ),
  channels: Type.Array(BackendCapabilityChannelSchema, {
    minItems: 1,
    maxItems: 4,
    uniqueItems: true,
  }),
  requiredPermission: Type.String({ minLength: 1, maxLength: 128 }),
  grants: Type.Object({
    siteAi: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
    mcp: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
    importedRuntime: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
    exportAdapter: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
  }, Strict),
  dataClassification: Type.Union([
    Type.Literal('public'),
    Type.Literal('customer'),
    Type.Literal('internal'),
    Type.Literal('sensitive'),
  ]),
  confirmation: Type.Union([Type.Literal('none'), Type.Literal('owner')]),
  limits: Type.Object({
    inputBytes: Type.Integer({ minimum: 1, maximum: 1_048_576 }),
    outputBytes: Type.Integer({ minimum: 1, maximum: 2_097_152 }),
    resultItems: Type.Integer({ minimum: 1, maximum: 10_000 }),
    requestsPerMinute: Type.Integer({ minimum: 1, maximum: 10_000 }),
    timeoutMs: Type.Integer({ minimum: 50, maximum: 120_000 }),
  }, Strict),
  metering: Type.Object({
    kind: Type.Literal('ai'),
    logicalCredits: Positive,
    providerCredits: Positive,
  }, Strict),
  exportAdapter: Type.Object({
    id: CapabilityId,
    version: Version,
  }, Strict),
  state: Type.Union([
    Type.Literal('active'),
    Type.Literal('deprecated'),
    Type.Literal('unavailable'),
  ]),
}, Strict)
export type BackendCapabilityMetadata = Readonly<Static<typeof BackendCapabilityMetadataSchema>>

export const TrustedBackendCapabilityAuthoritySchema = Type.Object({
  channel: BackendCapabilityChannelSchema,
  operationId: Id,
  outerReceiptId: Id,
  reservationId: Id,
  scope: BackendCapabilityScopeSchema,
  actor: BackendCapabilityActorSchema,
  permissions: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
    maxItems: 256,
    uniqueItems: true,
  }),
  grants: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
    maxItems: 64,
    uniqueItems: true,
  }),
  authorityRevision: Positive,
  state: Type.Union([Type.Literal('active'), Type.Literal('revoked')]),
  resolvedAt: Timestamp,
  confirmation: Type.Union([BackendCapabilityConfirmationSchema, Type.Null()]),
}, Strict)
export type TrustedBackendCapabilityAuthority = Readonly<Static<typeof TrustedBackendCapabilityAuthoritySchema>>

export const BackendCapabilityReceiptSchema = Type.Object({
  receiptId: Sha256,
  capabilityId: CapabilityId,
  capabilityVersion: Version,
  channel: BackendCapabilityChannelSchema,
  operationId: Id,
  outerReceiptId: Id,
  inputHashSha256: Sha256,
  outputHashSha256: Sha256,
  outcome: Type.Literal('succeeded'),
  metered: Type.Boolean(),
  audited: Type.Boolean(),
  occurredAt: Timestamp,
}, Strict)
export type BackendCapabilityReceipt = Readonly<Static<typeof BackendCapabilityReceiptSchema>>

export class BackendCapabilityContractError extends Error {
  override readonly name = 'BackendCapabilityContractError'
  readonly boundary: string

  constructor(boundary: string) {
    super(`${boundary} failed strict TypeBox validation.`)
    this.boundary = boundary
  }
}

export function parseBackendCapability<T extends TSchema>(
  schema: T,
  value: unknown,
  boundary: string,
): Static<T> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new BackendCapabilityContractError(boundary)
  return structuredClone(parsed.value)
}

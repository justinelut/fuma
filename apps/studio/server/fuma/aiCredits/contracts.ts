import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'

const MAX = Number.MAX_SAFE_INTEGER
const Id = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]*$' })
const Timestamp = Type.String({ format: 'date-time' })
const Micros = Type.Integer({ minimum: 0, maximum: MAX })
const PositiveMicros = Type.Integer({ minimum: 1, maximum: MAX })
const Sha256 = Type.String({ pattern: '^[a-f0-9]{64}$' })

export const AiCreditScopeSchema = Type.Object({
  platformId: Id, organizationId: Id, workspaceId: Id, siteId: Id,
  ownerKey: Id, ownerGeneration: Type.Integer({ minimum: 1, maximum: MAX }),
}, { additionalProperties: false })
export type AiCreditScope = Readonly<Static<typeof AiCreditScopeSchema>>

export const AiCreditAccountSchema = Type.Object({
  accountId: Id, scope: AiCreditScopeSchema, balanceMicros: Micros,
  reservedMicros: Micros, spentMicros: Micros, budgetMicros: Micros,
  version: Type.Integer({ minimum: 1, maximum: MAX }), updatedAt: Timestamp,
}, { additionalProperties: false })
export type AiCreditAccount = Readonly<Static<typeof AiCreditAccountSchema>>

export const AiCreditSourceSchema = Type.Union([Type.Literal('grant'), Type.Literal('purchase')])
export const AiCreditLotSchema = Type.Object({
  lotId: Id, accountId: Id, kind: AiCreditSourceSchema, amountMicros: PositiveMicros,
  remainingMicros: Micros, expiresAt: Type.Union([Timestamp, Type.Null()]),
  evidenceId: Id, idempotencyKey: Id, createdAt: Timestamp,
}, { additionalProperties: false })
export type AiCreditLot = Readonly<Static<typeof AiCreditLotSchema>>

export const AiCreditCommandSchema = Type.Object({
  lotId: Id, accountId: Id, scope: AiCreditScopeSchema, amountMicros: PositiveMicros,
  budgetMicros: Micros, expiresAt: Type.Union([Timestamp, Type.Null()]),
  evidenceId: Id, idempotencyKey: Id,
}, { additionalProperties: false })
export type AiCreditCommand = Readonly<Static<typeof AiCreditCommandSchema>>

export const AiCreditAudienceSchema = Type.Object({
  kind: Type.Literal('customer'), platformId: Id, organizationId: Id,
  workspaceId: Id, siteId: Id,
  profile: Type.Union([Type.Literal('website'), Type.Literal('publication')]),
}, { additionalProperties: false })
export type AiCreditAudience = Readonly<Static<typeof AiCreditAudienceSchema>>

export const AiTurnModeSchema = Type.Union([Type.Literal('platform'), Type.Literal('byok')])
export type AiTurnMode = Readonly<Static<typeof AiTurnModeSchema>>
export const AiCreditReserveCommandSchema = Type.Object({
  reservationId: Id, accountId: Id, scope: AiCreditScopeSchema,
  audience: AiCreditAudienceSchema, providerId: Id, modelId: Id,
  estimatedInputTokens: Micros, estimatedOutputTokens: Micros,
  mode: AiTurnModeSchema, byokCredentialId: Type.Union([Id, Type.Null()]),
  expiresAt: Timestamp, expectedAccountVersion: Type.Integer({ minimum: 1, maximum: MAX }),
  idempotencyKey: Id,
}, { additionalProperties: false })
export type AiCreditReserveCommand = Readonly<Static<typeof AiCreditReserveCommandSchema>>

export const AiCatalogQuoteEvidenceSchema = Type.Object({
  providerId: Id, modelId: Id, inputTokens: Micros, outputTokens: Micros,
  providerCostMicros: Micros, markupMicros: Micros, chargeMicros: Micros,
  included: Type.Boolean(), bindingSha256: Sha256,
}, { additionalProperties: false })
export type AiCatalogQuoteEvidence = Readonly<Static<typeof AiCatalogQuoteEvidenceSchema>>

export const AiCreditReservationStateSchema = Type.Union([
  Type.Literal('reserved'), Type.Literal('settled'), Type.Literal('released'),
  Type.Literal('refunded'), Type.Literal('expired'),
])
export const AiCreditReservationSchema = Type.Object({
  reservationId: Id, idempotencyKey: Id, accountId: Id, scope: AiCreditScopeSchema,
  mode: AiTurnModeSchema, byokCredentialId: Type.Union([Id, Type.Null()]),
  quote: AiCatalogQuoteEvidenceSchema, reservedMicros: Micros,
  state: AiCreditReservationStateSchema, version: Type.Integer({ minimum: 1, maximum: MAX }),
  expiresAt: Timestamp, createdAt: Timestamp, resolvedAt: Type.Union([Timestamp, Type.Null()]),
}, { additionalProperties: false })
export type AiCreditReservation = Readonly<Static<typeof AiCreditReservationSchema>>

export const AiCreditSettlementCommandSchema = Type.Object({
  reservationId: Id, inputTokens: Micros, outputTokens: Micros,
  idempotencyKey: Id, expectedReservationVersion: Type.Integer({ minimum: 1, maximum: MAX }),
}, { additionalProperties: false })
export type AiCreditSettlementCommand = Readonly<Static<typeof AiCreditSettlementCommandSchema>>

export const AiCreditSettlementSchema = Type.Object({
  settlementId: Id, reservationId: Id, idempotencyKey: Id,
  inputTokens: Micros, outputTokens: Micros, providerCostMicros: Micros,
  markupMicros: Micros, chargedMicros: Micros, refundedMicros: Micros,
  quoteBindingSha256: Sha256, createdAt: Timestamp,
}, { additionalProperties: false })
export type AiCreditSettlement = Readonly<Static<typeof AiCreditSettlementSchema>>

export const AiCreditResolutionCommandSchema = Type.Object({
  reservationId: Id, idempotencyKey: Id,
  expectedReservationVersion: Type.Integer({ minimum: 1, maximum: MAX }),
}, { additionalProperties: false })
export type AiCreditResolutionCommand = Readonly<Static<typeof AiCreditResolutionCommandSchema>>

export const AiByokMetadataPlaintextSchema = Type.Object({
  providerId: Id, existingCredentialId: Id, displayLabel: Type.String({ minLength: 1, maxLength: 120 }),
}, { additionalProperties: false })
export type AiByokMetadataPlaintext = Readonly<Static<typeof AiByokMetadataPlaintextSchema>>
export const AiByokEnvelopeSchema = Type.Object({
  keyId: Id, algorithm: Type.Literal('AES-GCM-256'), iv: Type.String({ minLength: 16, maxLength: 64 }),
  ciphertext: Type.String({ minLength: 16, maxLength: 4096 }), fingerprintSha256: Sha256,
}, { additionalProperties: false })
export type AiByokEnvelope = Readonly<Static<typeof AiByokEnvelopeSchema>>
export const AiByokCredentialSchema = Type.Object({
  credentialId: Id, scope: AiCreditScopeSchema, providerId: Id,
  envelope: AiByokEnvelopeSchema, state: Type.Union([Type.Literal('active'), Type.Literal('rekey-required'), Type.Literal('detached')]),
  version: Type.Integer({ minimum: 1, maximum: MAX }), createdAt: Timestamp, updatedAt: Timestamp,
}, { additionalProperties: false })
export type AiByokCredential = Readonly<Static<typeof AiByokCredentialSchema>>
export const AiByokCredentialViewSchema = Type.Object({
  credentialId: Id, providerId: Id, displayLabel: Type.String({ minLength: 1, maxLength: 120 }),
  state: AiByokCredentialSchema.properties.state, version: Type.Integer({ minimum: 1, maximum: MAX }),
  keyCurrent: Type.Boolean(), createdAt: Timestamp, updatedAt: Timestamp,
}, { additionalProperties: false })
export type AiByokCredentialView = Readonly<Static<typeof AiByokCredentialViewSchema>>
export const AiByokAttachCommandSchema = Type.Object({
  credentialId: Id, scope: AiCreditScopeSchema, providerId: Id, existingCredentialId: Id,
  displayLabel: Type.String({ minLength: 1, maxLength: 120 }), idempotencyKey: Id,
}, { additionalProperties: false })
export type AiByokAttachCommand = Readonly<Static<typeof AiByokAttachCommandSchema>>

export const AiCreditAccountViewSchema = Type.Object({
  accountId: Id, balanceMicros: Micros, reservedMicros: Micros, spentMicros: Micros,
  budgetMicros: Micros, availableMicros: Micros, version: Type.Integer({ minimum: 1, maximum: MAX }),
  credentials: Type.Array(AiByokCredentialViewSchema, { maxItems: 100 }),
}, { additionalProperties: false })
export type AiCreditAccountView = Readonly<Omit<Static<typeof AiCreditAccountViewSchema>, 'credentials'> & { credentials: readonly AiByokCredentialView[] }>

export class AiCreditContractError extends Error {
  override readonly name = 'AiCreditContractError'
  readonly boundary: string
  constructor(boundary: string) { super(`${boundary} failed strict TypeBox validation.`); this.boundary = boundary }
}
export function parseAiCreditContract<T extends TSchema>(schema: T, value: unknown, boundary: string): Static<T> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new AiCreditContractError(boundary)
  return structuredClone(parsed.value)
}
export function sameAiCreditScope(left: AiCreditScope, right: AiCreditScope): boolean {
  return left.platformId === right.platformId && left.organizationId === right.organizationId
    && left.workspaceId === right.workspaceId && left.siteId === right.siteId
    && left.ownerKey === right.ownerKey && left.ownerGeneration === right.ownerGeneration
}

export const AiByokTransferChoiceSchema = Type.Object({
  transferId: Id, credentialId: Type.Union([Id, Type.Null()]),
  choice: Type.Union([Type.Literal('rekey'), Type.Literal('detach')]),
  destinationScope: AiCreditScopeSchema,
  rekeyedEnvelope: Type.Union([AiByokEnvelopeSchema, Type.Null()]),
  recordedAt: Timestamp,
}, { additionalProperties: false })
export type AiByokTransferChoice = Readonly<Static<typeof AiByokTransferChoiceSchema>>

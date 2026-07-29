import { AiToolOutputSchema, type AiToolOutput } from '@core/ai'
import { CORE_CAPABILITIES } from '@core/capabilities'
import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'

const MAX = Number.MAX_SAFE_INTEGER
const Id = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]*$' })
const Timestamp = Type.String({ format: 'date-time' })
const Positive = Type.Integer({ minimum: 1, maximum: MAX })
const Units = Type.Integer({ minimum: 0, maximum: MAX })
const TokenHash = Type.String({ pattern: '^[A-Za-z0-9_-]{43}$' })
const Sha256 = Type.String({ pattern: '^[a-f0-9]{64}$' })
export const McpToolCapabilitySchema = Type.Union(CORE_CAPABILITIES.map((capability) => Type.Literal(capability)))

export const McpConnectorCapabilitySchema = Type.Union([
  Type.Literal('site.read'),
  Type.Literal('site.mutate'),
  Type.Literal('site.publish'),
  // Reserved on this same connector authority for FUMA-SITE-008. No component
  // tools are registered by FUMA-066.
  Type.Literal('component.read'),
  Type.Literal('component.create-source'),
  Type.Literal('component.install'),
  Type.Literal('component.mutate'),
  Type.Literal('component.confirm'),
  Type.Literal('component.publish'),
])
export type McpConnectorCapability = Static<typeof McpConnectorCapabilitySchema>

export const McpScopeSchema = Type.Object({
  platformId: Id,
  organizationId: Id,
  workspaceId: Id,
  siteId: Id,
  ownerKey: Id,
  ownerGeneration: Positive,
  profileId: Type.Union([Type.Literal('website'), Type.Literal('publication')]),
}, { additionalProperties: false })
export type McpScope = Readonly<Static<typeof McpScopeSchema>>

export const McpRateSchema = Type.Object({
  requestsPerMinute: Type.Integer({ minimum: 1, maximum: 10_000 }),
  reserveInputTokens: Units,
  reserveOutputTokens: Units,
}, { additionalProperties: false })
export type McpRate = Readonly<Static<typeof McpRateSchema>>

export const McpRatePolicySchema = Type.Object({
  read: McpRateSchema,
  mutate: McpRateSchema,
  publish: McpRateSchema,
}, { additionalProperties: false })
export type McpRatePolicy = Readonly<Static<typeof McpRatePolicySchema>>

export const McpConnectorSchema = Type.Object({
  connectorId: Id,
  actorId: Id,
  label: Type.String({ minLength: 1, maxLength: 120 }),
  type: Type.Union([Type.Literal('local'), Type.Literal('remote')]),
  scope: McpScopeSchema,
  tokenHash: TokenHash,
  capabilities: Type.Array(McpConnectorCapabilitySchema, { minItems: 1, maxItems: 9, uniqueItems: true }),
  toolCapabilities: Type.Array(McpToolCapabilitySchema, { minItems: 1, maxItems: 256, uniqueItems: true }),
  rates: McpRatePolicySchema,
  state: Type.Union([Type.Literal('active'), Type.Literal('revoked'), Type.Literal('transferring')]),
  version: Positive,
  createdAt: Timestamp,
  expiresAt: Timestamp,
  revokedAt: Type.Union([Timestamp, Type.Null()]),
  lastUsedAt: Type.Union([Timestamp, Type.Null()]),
}, { additionalProperties: false })
export type McpConnector = Readonly<Static<typeof McpConnectorSchema>>

export const McpConnectorViewSchema = Type.Object({
  connectorId: Id,
  label: Type.String({ minLength: 1, maxLength: 120 }),
  type: Type.Union([Type.Literal('local'), Type.Literal('remote')]),
  siteId: Id,
  ownerGeneration: Positive,
  capabilities: Type.Array(McpConnectorCapabilitySchema, { minItems: 1, maxItems: 9, uniqueItems: true }),
  rates: McpRatePolicySchema,
  state: McpConnectorSchema.properties.state,
  version: Positive,
  createdAt: Timestamp,
  expiresAt: Timestamp,
  revokedAt: Type.Union([Timestamp, Type.Null()]),
  lastUsedAt: Type.Union([Timestamp, Type.Null()]),
}, { additionalProperties: false })
export type McpConnectorView = Readonly<Static<typeof McpConnectorViewSchema>>

export const McpSessionSchema = Type.Object({
  sessionId: Id,
  connectorId: Id,
  actorId: Id,
  scope: McpScopeSchema,
  connectorVersion: Positive,
  state: Type.Union([Type.Literal('active'), Type.Literal('closed'), Type.Literal('revoked')]),
  openedAt: Timestamp,
  expiresAt: Timestamp,
  lastValidatedAt: Timestamp,
  closedAt: Type.Union([Timestamp, Type.Null()]),
}, { additionalProperties: false })
export type McpSession = Readonly<Static<typeof McpSessionSchema>>

export const McpOperationCapabilitySchema = Type.Union([
  Type.Literal('read'), Type.Literal('mutate'), Type.Literal('publish'),
])
export type McpOperationCapability = Static<typeof McpOperationCapabilitySchema>

export const McpPublishConfirmationSchema = Type.Object({
  confirmationId: Id,
  stepUpReceiptId: Id,
  confirmedAt: Timestamp,
}, { additionalProperties: false })
export type McpPublishConfirmation = Readonly<Static<typeof McpPublishConfirmationSchema>>

export const BeginMcpOperationSchema = Type.Object({
  sessionId: Id,
  operationId: Id,
  toolName: Id,
  capability: McpOperationCapabilitySchema,
  inputHashSha256: Sha256,
  estimatedInputTokens: Units,
  estimatedOutputTokens: Units,
  confirmation: Type.Union([McpPublishConfirmationSchema, Type.Null()]),
}, { additionalProperties: false })
export type BeginMcpOperation = Readonly<Static<typeof BeginMcpOperationSchema>>

export const McpToolReceiptSchema = Type.Object({
  sessionId: Id,
  connectorId: Id,
  operationId: Id,
  toolName: Id,
  capability: McpOperationCapabilitySchema,
  inputHashSha256: Sha256,
  reservationId: Id,
  state: Type.Union([Type.Literal('started'), Type.Literal('completed'), Type.Literal('failed'), Type.Literal('denied')]),
  output: Type.Union([AiToolOutputSchema, Type.Null()]),
  createdAt: Timestamp,
  completedAt: Type.Union([Timestamp, Type.Null()]),
}, { additionalProperties: false })
export type McpToolReceipt = Readonly<Omit<Static<typeof McpToolReceiptSchema>, 'output'> & { output: AiToolOutput | null }>

export const McpUsageWindowSchema = Type.Object({
  connectorId: Id,
  siteId: Id,
  capability: McpOperationCapabilitySchema,
  windowStartedAt: Timestamp,
  requestsUsed: Positive,
  inputTokens: Units,
  outputTokens: Units,
}, { additionalProperties: false })
export type McpUsageWindow = Readonly<Static<typeof McpUsageWindowSchema>>

export const McpAuditActionSchema = Type.Union([
  Type.Literal('mcp.connector.created'), Type.Literal('mcp.connector.revoked'),
  Type.Literal('mcp.session.opened'), Type.Literal('mcp.session.denied'), Type.Literal('mcp.session.closed'),
  Type.Literal('mcp.tool.started'), Type.Literal('mcp.tool.completed'), Type.Literal('mcp.tool.failed'), Type.Literal('mcp.tool.denied'),
  Type.Literal('mcp.publish.confirmed'), Type.Literal('mcp.transfer.rescoped'), Type.Literal('mcp.transfer.revoked'), Type.Literal('mcp.transfer.compensated'),
])
export const McpAuditFactSchema = Type.Object({
  auditId: Id,
  action: McpAuditActionSchema,
  scope: McpScopeSchema,
  actorId: Id,
  connectorId: Id,
  sessionId: Type.Union([Id, Type.Null()]),
  operationId: Type.Union([Id, Type.Null()]),
  outcome: Type.Union([Type.Literal('success'), Type.Literal('failure'), Type.Literal('denied')]),
  reasonCode: Type.Union([Id, Type.Null()]),
  occurredAt: Timestamp,
}, { additionalProperties: false })
export type McpAuditFact = Readonly<Static<typeof McpAuditFactSchema>>

export const McpTransferChoiceSchema = Type.Object({
  transferId: Id,
  connectorId: Id,
  choice: Type.Union([Type.Literal('rescope'), Type.Literal('revoke')]),
  destinationScope: McpScopeSchema,
  recordedAt: Timestamp,
}, { additionalProperties: false })
export type McpTransferChoice = Readonly<Static<typeof McpTransferChoiceSchema>>

export class McpContractError extends Error {
  override readonly name = 'McpContractError'
  readonly boundary: string

  constructor(boundary: string) {
    super(`${boundary} failed strict TypeBox validation.`)
    this.boundary = boundary
  }
}

export function parseMcpContract<T extends TSchema>(schema: T, value: unknown, boundary: string): Static<T> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new McpContractError(boundary)
  return structuredClone(parsed.value)
}

export function sameMcpScope(left: McpScope, right: McpScope): boolean {
  return left.platformId === right.platformId && left.organizationId === right.organizationId
    && left.workspaceId === right.workspaceId && left.siteId === right.siteId
    && left.ownerKey === right.ownerKey && left.ownerGeneration === right.ownerGeneration
    && left.profileId === right.profileId
}

export function toMcpConnectorView(value: McpConnector): McpConnectorView {
  return Object.freeze({ connectorId: value.connectorId, label: value.label, type: value.type,
    siteId: value.scope.siteId, ownerGeneration: value.scope.ownerGeneration,
    capabilities: [...value.capabilities], rates: structuredClone(value.rates),
    state: value.state, version: value.version, createdAt: value.createdAt,
    expiresAt: value.expiresAt, revokedAt: value.revokedAt, lastUsedAt: value.lastUsedAt })
}

import { Type, Value, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import { DnsInstructionSchema } from '../cloudflare/contracts'
import { DomainCredentialAuthoritySchema, DomainScopeSchema } from '../domains/contracts'

const MAX = Number.MAX_SAFE_INTEGER
const IdSchema = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const TimestampSchema = Type.String({ format: 'date-time' })
const HashSchema = Type.String({ pattern: '^[a-f0-9]{64}$' })
const HostnameSchema = Type.String({ minLength: 3, maxLength: 253, pattern: '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$' })

export const DomainAutomationSchema = Type.Union([
  Type.Object({ mode: Type.Literal('manual'), credentialId: Type.Null(), credentialState: Type.Null() }, { additionalProperties: false }),
  Type.Object({ mode: Type.Literal('customer-managed'), credentialId: IdSchema, credentialState: Type.Union([Type.Literal('active'), Type.Literal('revoked')]) }, { additionalProperties: false }),
])
export type DomainAutomation = Readonly<Static<typeof DomainAutomationSchema>>

export const ApexAlternativeSchema = Type.Object({
  kind: Type.Union([Type.Literal('www-cname'), Type.Literal('alias'), Type.Literal('aname'), Type.Literal('cname-flattening'), Type.Literal('registrar-redirect')]),
  available: Type.Boolean(),
  instruction: Type.String({ minLength: 1, maxLength: 500 }),
}, { additionalProperties: false })
export type ApexAlternative = Readonly<Static<typeof ApexAlternativeSchema>>

export const CustomerDnsSettingsSchema = Type.Object({
  ...DomainScopeSchema.properties,
  domainId: IdSchema,
  hostname: HostnameSchema,
  records: Type.Array(DnsInstructionSchema, { minItems: 1, maxItems: 41 }),
  authoritativeDnsRetainedByCustomer: Type.Literal(true),
  customerCloudflareAccountRequired: Type.Literal(false),
  customerCloudflareTokenRequired: Type.Literal(false),
  automation: DomainAutomationSchema,
  apexAlternatives: Type.Array(ApexAlternativeSchema, { minItems: 1, maxItems: 5 }),
  launchState: Type.Union([Type.Literal('awaiting-records'), Type.Literal('awaiting-tls'), Type.Literal('active'), Type.Literal('detached')]),
  version: Type.Integer({ minimum: 1, maximum: MAX }),
  operationFence: Type.Integer({ minimum: 1, maximum: MAX }),
  updatedAt: TimestampSchema,
}, { additionalProperties: false })
export type CustomerDnsSettings = Readonly<Static<typeof CustomerDnsSettingsSchema>>

export const DnsObservationSchema = Type.Object({
  records: Type.Array(DnsInstructionSchema, { maxItems: 100 }),
  tls: Type.Union([Type.Literal('pending'), Type.Literal('active'), Type.Literal('failed')]),
  observedAt: TimestampSchema,
}, { additionalProperties: false })
export type DnsObservation = Readonly<Static<typeof DnsObservationSchema>>

export const DomainDiagnosticSchema = Type.Object({
  code: Type.Union([
    Type.Literal('record-missing'), Type.Literal('record-wrong-value'), Type.Literal('tls-pending'),
    Type.Literal('tls-failed'), Type.Literal('automation-credential-revoked'), Type.Literal('healthy'),
  ]),
  severity: Type.Union([Type.Literal('info'), Type.Literal('warning'), Type.Literal('error')]),
  message: Type.String({ minLength: 1, maxLength: 500 }),
  expected: Type.Union([DnsInstructionSchema, Type.Null()]),
  observedValue: Type.Union([Type.String({ maxLength: 2048 }), Type.Null()]),
}, { additionalProperties: false })
export type DomainDiagnostic = Readonly<Static<typeof DomainDiagnosticSchema>>

export const DomainDiagnosticReportSchema = Type.Object({
  domainId: IdSchema,
  hostname: HostnameSchema,
  diagnostics: Type.Array(DomainDiagnosticSchema, { minItems: 1, maxItems: 100 }),
  observedAt: TimestampSchema,
  canCutover: Type.Boolean(),
}, { additionalProperties: false })
export type DomainDiagnosticReport = Readonly<Static<typeof DomainDiagnosticReportSchema>>

export const RegistrarTransferDirectionSchema = Type.Union([Type.Literal('inbound'), Type.Literal('outbound')])
export type RegistrarTransferDirection = Static<typeof RegistrarTransferDirectionSchema>
export const RegistrarTransferStateSchema = Type.Union([
  Type.Literal('requested'), Type.Literal('awaiting-unlock'), Type.Literal('awaiting-auth-code'),
  Type.Literal('submitted'), Type.Literal('completed'), Type.Literal('failed'),
  Type.Literal('rolling-back'), Type.Literal('rolled-back'), Type.Literal('detached'),
])
export type RegistrarTransferState = Static<typeof RegistrarTransferStateSchema>

/** Internal encrypted auth-code metadata. This schema is never an HTTP response. */
export const RegistrarAuthCodeEnvelopeSchema = Type.Object({
  ciphertext: Type.String({ minLength: 24, maxLength: 131_072, pattern: '^v1\\.[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]{22,}$' }),
  keyId: IdSchema,
  fingerprintSha256: HashSchema,
  expiresAt: TimestampSchema,
}, { additionalProperties: false })
export type RegistrarAuthCodeEnvelope = Readonly<Static<typeof RegistrarAuthCodeEnvelopeSchema>>

export const RegistrarTransferSchema = Type.Object({
  ...DomainScopeSchema.properties,
  transferOperationId: IdSchema,
  domainId: IdSchema,
  hostname: HostnameSchema,
  direction: RegistrarTransferDirectionSchema,
  lifecycle: RegistrarTransferStateSchema,
  registrarLocked: Type.Boolean(),
  authCode: Type.Union([RegistrarAuthCodeEnvelopeSchema, Type.Null()]),
  providerReference: Type.Union([IdSchema, Type.Null()]),
  ownership: Type.Union([Type.Literal('customer'), Type.Literal('fuma'), Type.Literal('external')]),
  renewalHandoff: Type.Union([Type.Literal('pending'), Type.Literal('fuma-managed'), Type.Literal('customer-managed'), Type.Literal('not-applicable')]),
  authCodeDelivery: Type.Union([Type.Literal('not-applicable'), Type.Literal('pending'), Type.Literal('delivered')]),
  version: Type.Integer({ minimum: 1, maximum: MAX }),
  fence: Type.Integer({ minimum: 1, maximum: MAX }),
  operationSha256: HashSchema,
  failureCode: Type.Union([Type.String({ minLength: 1, maxLength: 100, pattern: '^[a-z][a-z0-9-]*$' }), Type.Null()]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}, { additionalProperties: false })
export type RegistrarTransfer = Readonly<Static<typeof RegistrarTransferSchema>>

export const RegistrarTransferProjectionSchema = Type.Object({
  transferOperationId: IdSchema, domainId: IdSchema, hostname: HostnameSchema,
  direction: RegistrarTransferDirectionSchema, state: RegistrarTransferStateSchema,
  registrarLocked: Type.Boolean(), authCodeExpiresAt: Type.Union([TimestampSchema, Type.Null()]),
  ownership: RegistrarTransferSchema.properties.ownership,
  renewalHandoff: RegistrarTransferSchema.properties.renewalHandoff,
  authCodeDelivery: RegistrarTransferSchema.properties.authCodeDelivery,
  version: Type.Integer({ minimum: 1 }), failureCode: RegistrarTransferSchema.properties.failureCode,
  updatedAt: TimestampSchema,
}, { additionalProperties: false })
export type RegistrarTransferProjection = Readonly<Static<typeof RegistrarTransferProjectionSchema>>

export const InboundTransferCommandSchema = Type.Object({
  transferOperationId: IdSchema, domainId: IdSchema, hostname: HostnameSchema,
  authCode: Type.Uint8Array({ minByteLength: 1, maxByteLength: 4096 }),
  authCodeExpiresAt: TimestampSchema,
}, { additionalProperties: false })
export type InboundTransferCommand = Readonly<Static<typeof InboundTransferCommandSchema>>
export const OutboundTransferCommandSchema = Type.Object({
  transferOperationId: IdSchema, domainId: IdSchema, hostname: HostnameSchema,
}, { additionalProperties: false })
export type OutboundTransferCommand = Readonly<Static<typeof OutboundTransferCommandSchema>>

export const SITE_TRANSFER_DOMAIN_OUTCOMES = ['retain-with-source', 'move-with-site', 'detach-and-manual'] as const
export const SiteTransferDomainChoiceSchema = Type.Object({
  transferId: IdSchema,
  domainId: IdSchema,
  source: DomainScopeSchema,
  destination: DomainScopeSchema,
  outcome: Type.Union(SITE_TRANSFER_DOMAIN_OUTCOMES.map((value) => Type.Literal(value))),
  decidedAt: TimestampSchema,
}, { additionalProperties: false })
export type SiteTransferDomainChoice = Readonly<Static<typeof SiteTransferDomainChoiceSchema>>

export const SiteTransferDomainStateSchema = Type.Object({
  choice: SiteTransferDomainChoiceSchema,
  sourceSettings: CustomerDnsSettingsSchema,
  currentSettings: CustomerDnsSettingsSchema,
  automationCredentialMoved: Type.Literal(false),
  appliedFence: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  applyReceipt: Type.Union([Type.Unknown(), Type.Null()]),
  compensatedFence: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  compensationReceipt: Type.Union([Type.Unknown(), Type.Null()]),
}, { additionalProperties: false })
export type SiteTransferDomainState = Readonly<Static<typeof SiteTransferDomainStateSchema>>

export const CustomerAutomationCommandSchema = Type.Object({
  credentialId: IdSchema,
  authority: DomainCredentialAuthoritySchema,
}, { additionalProperties: false })

export function parseDomainOperations<T extends TSchema>(schema: T, value: unknown, label: string): Static<T> {
  if (!Value.Check(schema, value)) throw new DomainOperationError('invalid-contract', `${label} failed strict TypeBox validation.`)
  return Object.freeze(structuredClone(value)) as Static<T>
}
export function canonicalDomainOperation(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalDomainOperation).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalDomainOperation(record[key])}`).join(',')}}`
}
export function domainOperationHash(value: unknown): string {
  return new Bun.CryptoHasher('sha256').update(canonicalDomainOperation(value)).digest('hex')
}
export class DomainOperationError extends Error {
  readonly code: 'invalid-contract' | 'scope' | 'conflict' | 'not-found' | 'expired-auth-code' | 'registrar-locked' | 'revoked-credential' | 'unsafe-detachment' | 'provider'
  constructor(code: DomainOperationError['code'], message: string) { super(message); this.name = 'DomainOperationError'; this.code = code }
}

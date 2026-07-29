import { Type, Value, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import { DomainScopeSchema, type DomainScope } from '../domains/contracts'

const MAX = Number.MAX_SAFE_INTEGER
const IdSchema = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const HostnameSchema = Type.String({ minLength: 1, maxLength: 253, pattern: '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$' })
const DnsOwnerNameSchema = Type.String({ minLength: 1, maxLength: 253, pattern: '^(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$' })
const TimestampSchema = Type.String({ format: 'date-time' })
const HashSchema = Type.String({ pattern: '^[a-f0-9]{64}$' })

export const DnsInstructionSchema = Type.Object({
  type: Type.Union([Type.Literal('CNAME'), Type.Literal('TXT'), Type.Literal('A')]),
  name: DnsOwnerNameSchema,
  value: Type.String({ minLength: 1, maxLength: 2048, pattern: '^[^\\u0000-\\u001F\\u007F]+$' }),
  purpose: Type.Union([Type.Literal('routing'), Type.Literal('ownership'), Type.Literal('tls-validation')]),
}, { additionalProperties: false })
export type DnsInstruction = Readonly<Static<typeof DnsInstructionSchema>>

export const CloudflareHostnameSchema = Type.Object({
  id: IdSchema,
  hostname: HostnameSchema,
  status: Type.Union([Type.Literal('pending'), Type.Literal('active'), Type.Literal('blocked'), Type.Literal('deleted')]),
  sslStatus: Type.Union([Type.Literal('pending'), Type.Literal('active'), Type.Literal('failed')]),
  ownershipVerified: Type.Boolean(),
  ownershipRecords: Type.Array(DnsInstructionSchema, { maxItems: 20 }),
  validationRecords: Type.Array(DnsInstructionSchema, { maxItems: 20 }),
}, { additionalProperties: false })
export type CloudflareHostname = Readonly<Static<typeof CloudflareHostnameSchema>>

export const CLOUDFLARE_LIFECYCLE_STATES = [
  'prevalidating', 'awaiting-dns', 'awaiting-tls', 'ready', 'active',
  'rolling-back', 'detached', 'deleting', 'deleted', 'failed',
] as const
export const CloudflareLifecycleStateSchema = Type.Union(CLOUDFLARE_LIFECYCLE_STATES.map((value) => Type.Literal(value)))
export type CloudflareLifecycleState = Static<typeof CloudflareLifecycleStateSchema>

export const CloudflareDiagnosticSchema = Type.Object({
  code: Type.Union([
    Type.Literal('cname-missing'), Type.Literal('ownership-missing'), Type.Literal('tls-validation-missing'),
    Type.Literal('provider-blocked'), Type.Literal('tls-failed'), Type.Literal('tls-pending'), Type.Literal('healthy'),
  ]),
  severity: Type.Union([Type.Literal('info'), Type.Literal('warning'), Type.Literal('error')]),
  message: Type.String({ minLength: 1, maxLength: 500 }),
  expected: Type.Union([DnsInstructionSchema, Type.Null()]),
}, { additionalProperties: false })
export type CloudflareDiagnostic = Readonly<Static<typeof CloudflareDiagnosticSchema>>

export const CloudflareBindingSchema = Type.Object({
  ...DomainScopeSchema.properties,
  domainId: IdSchema,
  hostname: HostnameSchema,
  providerHostnameId: IdSchema,
  lifecycle: CloudflareLifecycleStateSchema,
  providerStatus: CloudflareHostnameSchema.properties.status,
  sslStatus: CloudflareHostnameSchema.properties.sslStatus,
  ownershipVerified: Type.Boolean(),
  instructions: Type.Array(DnsInstructionSchema, { minItems: 1, maxItems: 41 }),
  diagnostics: Type.Array(CloudflareDiagnosticSchema, { maxItems: 64 }),
  version: Type.Integer({ minimum: 1, maximum: MAX }),
  reconcileFence: Type.Integer({ minimum: 1, maximum: MAX }),
  lastEventSequence: Type.String({ pattern: '^[0-9]+$' }),
  lastOperationId: IdSchema,
  lastOperationSha256: HashSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}, { additionalProperties: false })
export type CloudflareBinding = Readonly<Static<typeof CloudflareBindingSchema>>

export const ApexCapabilitySchema = Type.Object({
  alias: Type.Boolean(), aname: Type.Boolean(), cnameFlattening: Type.Boolean(), registrarRedirect: Type.Boolean(),
  enterpriseApex: Type.Boolean(), actualQuoteApproved: Type.Boolean(), securityReviewApproved: Type.Boolean(), marginGatePassed: Type.Boolean(),
}, { additionalProperties: false })
export type ApexCapability = Readonly<Static<typeof ApexCapabilitySchema>>

export const CloudflarePrevalidationSchema = Type.Object({
  binding: CloudflareBindingSchema,
  records: Type.Array(DnsInstructionSchema, { minItems: 1, maxItems: 41 }),
  customerAccountRequired: Type.Literal(false),
  customerTokenRequired: Type.Literal(false),
  authoritativeDnsRetainedByCustomer: Type.Literal(true),
}, { additionalProperties: false })
export type CloudflarePrevalidation = Readonly<Static<typeof CloudflarePrevalidationSchema>>

export const CloudflareObservedDnsSchema = Type.Array(DnsInstructionSchema, { maxItems: 100 })
export const CloudflareEventSchema = Type.Object({
  sequence: Type.String({ pattern: '^[1-9][0-9]*$' }),
  provider: CloudflareHostnameSchema,
  observedAt: TimestampSchema,
}, { additionalProperties: false })
export type CloudflareEvent = Readonly<Static<typeof CloudflareEventSchema>>

export function parseCloudflareContract<T extends TSchema>(schema: T, value: unknown, label: string): Static<T> {
  if (!Value.Check(schema, value)) throw new CloudflareContractError('invalid', `${label} failed strict TypeBox validation.`)
  return Object.freeze(structuredClone(value)) as Static<T>
}

export function bindingScope(binding: CloudflareBinding): DomainScope {
  return parseCloudflareContract(DomainScopeSchema, {
    platformId: binding.platformId, organizationId: binding.organizationId, workspaceId: binding.workspaceId,
    siteId: binding.siteId, ownerKey: binding.ownerKey, generation: binding.generation,
    state: binding.state, transferFence: binding.transferFence, profileId: binding.profileId,
  }, 'Cloudflare binding scope') as DomainScope
}

export class CloudflareContractError extends Error {
  readonly code: 'invalid' | 'scope'
  constructor(code: CloudflareContractError['code'], message: string) { super(message); this.name = 'CloudflareContractError'; this.code = code }
}

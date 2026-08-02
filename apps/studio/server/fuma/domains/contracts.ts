import { Type, Value, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import { domainToASCII } from 'node:url'
import { toUnicode as punycodeToUnicode } from 'node:punycode'
import { FumaRepositoryScopeSchema } from '../tenancy'

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER
const IdSchema = Type.String({
  minLength: 1,
  maxLength: 255,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
})
const HashSchema = Type.String({ pattern: '^[a-f0-9]{64}$' })
const TimestampSchema = Type.String({ format: 'date-time' })
const ProfileIdSchema = Type.String({
  minLength: 1,
  maxLength: 255,
  pattern: '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$',
})
const HostnameSchema = Type.String({
  minLength: 1,
  maxLength: 253,
  pattern: '^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$',
})

export const DomainScopeSchema = Type.Object({
  ...FumaRepositoryScopeSchema.anyOf[0].properties,
  profileId: ProfileIdSchema,
}, { additionalProperties: false })
export type DomainScope = Readonly<Static<typeof DomainScopeSchema>>

export const DOMAIN_KINDS = ['customer-dns', 'fuma-registered'] as const
export const DomainKindSchema = Type.Union(DOMAIN_KINDS.map((value) => Type.Literal(value)))
export type DomainKind = Static<typeof DomainKindSchema>

export const DOMAIN_DESIRED_STATES = ['detached', 'validating', 'active', 'suspended', 'deleted'] as const
export const DomainDesiredStateSchema = Type.Union(DOMAIN_DESIRED_STATES.map((value) => Type.Literal(value)))
export type DomainDesiredState = Static<typeof DomainDesiredStateSchema>

export const DOMAIN_OBSERVED_STATES = [
  'unknown', 'dns-pending', 'dns-valid', 'tls-pending', 'active', 'degraded', 'detached', 'deleted',
] as const
export const DomainObservedStateSchema = Type.Union(DOMAIN_OBSERVED_STATES.map((value) => Type.Literal(value)))
export type DomainObservedState = Static<typeof DomainObservedStateSchema>

export const CERTIFICATE_STATES = ['none', 'provisioning', 'active', 'expiring', 'expired', 'failed', 'revoked'] as const
export const CertificateStateSchema = Type.Union(CERTIFICATE_STATES.map((value) => Type.Literal(value)))
export type CertificateState = Static<typeof CertificateStateSchema>

export const DomainRecordSchema = Type.Object({
  ...DomainScopeSchema.properties,
  domainId: IdSchema,
  hostname: HostnameSchema,
  unicodeHostname: Type.String({ minLength: 1, maxLength: 253 }),
  kind: DomainKindSchema,
  desired: DomainDesiredStateSchema,
  observed: DomainObservedStateSchema,
  certificate: CertificateStateSchema,
  credentialId: Type.Union([IdSchema, Type.Null()]),
  version: Type.Integer({ minimum: 1, maximum: MAX_SAFE_INTEGER }),
  operationFence: Type.Integer({ minimum: 1, maximum: MAX_SAFE_INTEGER }),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}, { additionalProperties: false })
export type DomainRecord = Readonly<Static<typeof DomainRecordSchema>>

export const DomainTransitionSchema = Type.Object({
  transitionId: IdSchema,
  ...DomainScopeSchema.properties,
  domainId: IdSchema,
  expectedVersion: Type.Integer({ minimum: 1, maximum: MAX_SAFE_INTEGER }),
  fromDesired: DomainDesiredStateSchema,
  toDesired: DomainDesiredStateSchema,
  fromObserved: DomainObservedStateSchema,
  toObserved: DomainObservedStateSchema,
  fromCertificate: CertificateStateSchema,
  toCertificate: CertificateStateSchema,
  fromFence: Type.Integer({ minimum: 1, maximum: MAX_SAFE_INTEGER }),
  toFence: Type.Integer({ minimum: 1, maximum: MAX_SAFE_INTEGER }),
  actorId: IdSchema,
  reasonCode: Type.String({ minLength: 1, maxLength: 100, pattern: '^[a-z][a-z0-9-]*$' }),
  operationId: IdSchema,
  evidenceSha256: HashSchema,
  occurredAt: TimestampSchema,
}, { additionalProperties: false })
export type DomainTransition = Readonly<Static<typeof DomainTransitionSchema>>

export const CredentialScopeSchema = Type.Union([
  Type.Literal('fuma-platform'),
  Type.Literal('customer-automation'),
])
export type CredentialScope = Static<typeof CredentialScopeSchema>
export const CredentialStateSchema = Type.Union([Type.Literal('active'), Type.Literal('revoked')])
export type CredentialState = Static<typeof CredentialStateSchema>

export const DomainCredentialAuthoritySchema = Type.Union([
  Type.Object({
    scope: Type.Literal('fuma-platform'),
    platformId: IdSchema,
    organizationId: Type.Null(),
    workspaceId: Type.Null(),
    siteId: Type.Null(),
    ownerKey: Type.Null(),
    ownerGeneration: Type.Null(),
    profileId: Type.Null(),
  }, { additionalProperties: false }),
  Type.Object({
    scope: Type.Literal('customer-automation'),
    platformId: IdSchema,
    organizationId: IdSchema,
    workspaceId: IdSchema,
    siteId: IdSchema,
    ownerKey: IdSchema,
    ownerGeneration: Type.Integer({ minimum: 1, maximum: MAX_SAFE_INTEGER }),
    profileId: ProfileIdSchema,
  }, { additionalProperties: false }),
])
export type DomainCredentialAuthority = Readonly<Static<typeof DomainCredentialAuthoritySchema>>

/** Internal persistence only. Never use this schema as an HTTP/audit/log response. */
export const DomainCredentialEnvelopeSchema = Type.Object({
  credentialId: IdSchema,
  authority: DomainCredentialAuthoritySchema,
  ciphertext: Type.String({ minLength: 24, maxLength: 131_072, pattern: '^v1\\.[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]{22,}$' }),
  keyId: IdSchema,
  algorithm: Type.Literal('AES-256-GCM'),
  fingerprintSha256: HashSchema,
  state: CredentialStateSchema,
  version: Type.Integer({ minimum: 1, maximum: MAX_SAFE_INTEGER }),
  fence: Type.Integer({ minimum: 1, maximum: MAX_SAFE_INTEGER }),
  createdAt: TimestampSchema,
  rotatedAt: Type.Union([TimestampSchema, Type.Null()]),
  revokedAt: Type.Union([TimestampSchema, Type.Null()]),
  rotatedFrom: Type.Union([HashSchema, Type.Null()]),
}, { additionalProperties: false })
export type DomainCredentialEnvelope = Readonly<Static<typeof DomainCredentialEnvelopeSchema>>

export const RedactedDomainCredentialSchema = Type.Object({
  credentialId: IdSchema,
  scope: CredentialScopeSchema,
  organizationId: Type.Union([IdSchema, Type.Null()]),
  keyId: IdSchema,
  algorithm: Type.Literal('AES-256-GCM'),
  fingerprintSha256: HashSchema,
  state: CredentialStateSchema,
  version: Type.Integer({ minimum: 1 }),
  fence: Type.Integer({ minimum: 1 }),
  rotatedAt: Type.Union([TimestampSchema, Type.Null()]),
  revokedAt: Type.Union([TimestampSchema, Type.Null()]),
  secret: Type.Literal('[REDACTED]'),
}, { additionalProperties: false })
export type RedactedDomainCredential = Readonly<Static<typeof RedactedDomainCredentialSchema>>

export const DomainProviderOperationSchema = Type.Object({
  operationId: IdSchema,
  idempotencyKey: Type.String({ minLength: 1, maxLength: 512 }),
  ...DomainScopeSchema.properties,
  domainId: IdSchema,
  credentialId: IdSchema,
  action: Type.Union([
    Type.Literal('validate-ownership'),
    Type.Literal('read-provider-status'),
  ]),
  expectedDomainVersion: Type.Integer({ minimum: 1, maximum: MAX_SAFE_INTEGER }),
  expectedDomainFence: Type.Integer({ minimum: 1, maximum: MAX_SAFE_INTEGER }),
  expectedCredentialVersion: Type.Integer({ minimum: 1, maximum: MAX_SAFE_INTEGER }),
  expectedCredentialFence: Type.Integer({ minimum: 1, maximum: MAX_SAFE_INTEGER }),
  requestedAt: TimestampSchema,
}, { additionalProperties: false })
export type DomainProviderOperation = Readonly<Static<typeof DomainProviderOperationSchema>>

export const DomainProviderResultSchema = Type.Object({
  operationId: IdSchema,
  status: Type.Union([Type.Literal('authorized'), Type.Literal('not-ready')]),
  providerCode: Type.String({ minLength: 1, maxLength: 80, pattern: '^[a-z0-9-]+$' }),
  observedAt: TimestampSchema,
}, { additionalProperties: false })
export type DomainProviderResult = Readonly<Static<typeof DomainProviderResultSchema>>

export const DomainOperationReceiptSchema = Type.Object({
  command: DomainProviderOperationSchema,
  commandSha256: HashSchema,
  state: Type.Union([Type.Literal('claimed'), Type.Literal('retryable'), Type.Literal('succeeded')]),
  attempt: Type.Integer({ minimum: 1, maximum: 100 }),
  result: Type.Union([DomainProviderResultSchema, Type.Null()]),
  failureCode: Type.Union([Type.String({ minLength: 1, maxLength: 80, pattern: '^[a-z0-9-]+$' }), Type.Null()]),
  updatedAt: TimestampSchema,
}, { additionalProperties: false })
export type DomainOperationReceipt = Readonly<Static<typeof DomainOperationReceiptSchema>>

export const DomainPublicProjectionSchema = Type.Object({
  domainId: IdSchema,
  hostname: HostnameSchema,
  unicodeHostname: Type.String({ minLength: 1, maxLength: 253 }),
  kind: DomainKindSchema,
  desired: DomainDesiredStateSchema,
  observed: DomainObservedStateSchema,
  certificate: CertificateStateSchema,
  version: Type.Integer({ minimum: 1 }),
  updatedAt: TimestampSchema,
  credential: Type.Union([Type.Object({ configured: Type.Literal(true), scope: CredentialScopeSchema }, { additionalProperties: false }), Type.Null()]),
}, { additionalProperties: false })
export type DomainPublicProjection = Readonly<Static<typeof DomainPublicProjectionSchema>>

export const CreateDomainCommandSchema = Type.Object({
  domainId: IdSchema,
  hostname: Type.String({ minLength: 1, maxLength: 1024 }),
  kind: DomainKindSchema,
  credentialId: Type.Union([IdSchema, Type.Null()]),
  requestedAt: TimestampSchema,
}, { additionalProperties: false })
export type CreateDomainCommand = Readonly<Static<typeof CreateDomainCommandSchema>>

export const TransitionDomainCommandSchema = Type.Object({
  operationId: IdSchema,
  domainId: IdSchema,
  expectedVersion: Type.Integer({ minimum: 1, maximum: MAX_SAFE_INTEGER }),
  expectedFence: Type.Integer({ minimum: 1, maximum: MAX_SAFE_INTEGER }),
  desired: DomainDesiredStateSchema,
  observed: DomainObservedStateSchema,
  certificate: CertificateStateSchema,
  actorId: IdSchema,
  reasonCode: Type.String({ minLength: 1, maxLength: 100, pattern: '^[a-z][a-z0-9-]*$' }),
  occurredAt: TimestampSchema,
}, { additionalProperties: false })
export type TransitionDomainCommand = Readonly<Static<typeof TransitionDomainCommandSchema>>

export const StoreCredentialCommandSchema = Type.Object({
  credentialId: IdSchema,
  authority: DomainCredentialAuthoritySchema,
  plaintext: Type.Uint8Array({ minByteLength: 1, maxByteLength: 65_536 }),
  createdAt: TimestampSchema,
}, { additionalProperties: false })
export type StoreCredentialCommand = Readonly<Static<typeof StoreCredentialCommandSchema>>

export const RotateCredentialCommandSchema = Type.Object({
  credentialId: IdSchema,
  authority: DomainCredentialAuthoritySchema,
  expectedVersion: Type.Integer({ minimum: 1, maximum: MAX_SAFE_INTEGER }),
  expectedFence: Type.Integer({ minimum: 1, maximum: MAX_SAFE_INTEGER }),
  replacementPlaintext: Type.Uint8Array({ minByteLength: 1, maxByteLength: 65_536 }),
  rotatedAt: TimestampSchema,
}, { additionalProperties: false })
export type RotateCredentialCommand = Readonly<Static<typeof RotateCredentialCommandSchema>>

export const RevokeCredentialCommandSchema = Type.Object({
  credentialId: IdSchema,
  authority: DomainCredentialAuthoritySchema,
  expectedVersion: Type.Integer({ minimum: 1, maximum: MAX_SAFE_INTEGER }),
  expectedFence: Type.Integer({ minimum: 1, maximum: MAX_SAFE_INTEGER }),
  revokedAt: TimestampSchema,
}, { additionalProperties: false })
export type RevokeCredentialCommand = Readonly<Static<typeof RevokeCredentialCommandSchema>>

export class DomainContractError extends Error {
  readonly code: 'invalid' | 'hostname' | 'transition' | 'scope'

  constructor(code: DomainContractError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'DomainContractError'
  }
}

export function parseDomainContract<T extends TSchema>(schema: T, value: unknown, label: string): Static<T> {
  if (!Value.Check(schema, value)) throw new DomainContractError('invalid', `${label} failed strict TypeBox validation.`)
  return Object.freeze(structuredClone(value)) as Static<T>
}

/** UTS-46/IDNA conversion produces the sole persisted host identity. */
export function normalizeDomainHostname(input: string): Readonly<{ hostname: string; unicodeHostname: string }> {
  if (typeof input !== 'string' || input.length < 1 || input.length > 1024) {
    throw new DomainContractError('hostname', 'Hostname is malformed.')
  }
  const candidate = input.trim().normalize('NFC').replace(/\.+$/u, '').toLowerCase()
  const hasControl = [...candidate].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f
  })
  if (!candidate || /[\\/@?#%\s]/u.test(candidate) || hasControl
    || candidate.includes(':') || candidate.startsWith('*.') || /^\[.*\]$/u.test(candidate)) {
    throw new DomainContractError('hostname', 'Hostname is malformed.')
  }
  const hostname = domainToASCII(candidate).toLowerCase()
  if (!hostname || !Value.Check(HostnameSchema, hostname) || hostname.split('.').some((label) => label.length > 63)
    || /^(?:\d{1,3}\.){3}\d{1,3}$/u.test(hostname)) {
    throw new DomainContractError('hostname', 'Hostname is not a valid registrable IDN hostname.')
  }
  const unicodeHostname = punycodeToUnicode(hostname).normalize('NFC').toLowerCase()
  if (domainToASCII(unicodeHostname).toLowerCase() !== hostname) {
    throw new DomainContractError('hostname', 'Hostname IDN conversion is not stable.')
  }
  return Object.freeze({ hostname, unicodeHostname })
}

export function domainScopeFromRepository(
  repositoryScope: Static<typeof FumaRepositoryScopeSchema>,
  profileId: string,
): DomainScope {
  return parseDomainContract(DomainScopeSchema, { ...repositoryScope, profileId }, 'Domain scope') as DomainScope
}

export function customerCredentialAuthority(scope: DomainScope): DomainCredentialAuthority {
  return parseDomainContract(DomainCredentialAuthoritySchema, {
    scope: 'customer-automation',
    platformId: scope.platformId,
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    siteId: scope.siteId,
    ownerKey: scope.ownerKey,
    ownerGeneration: scope.generation,
    profileId: scope.profileId,
  }, 'Customer credential authority') as DomainCredentialAuthority
}

export function platformCredentialAuthority(platformId: string): DomainCredentialAuthority {
  return parseDomainContract(DomainCredentialAuthoritySchema, {
    scope: 'fuma-platform',
    platformId,
    organizationId: null,
    workspaceId: null,
    siteId: null,
    ownerKey: null,
    ownerGeneration: null,
    profileId: null,
  }, 'Platform credential authority') as DomainCredentialAuthority
}

export function credentialAuthorityKey(authority: DomainCredentialAuthority): string {
  const value = parseDomainContract(DomainCredentialAuthoritySchema, authority, 'Credential authority') as DomainCredentialAuthority
  return JSON.stringify([
    'domain-credential-v1', value.scope, value.platformId, value.organizationId, value.workspaceId,
    value.siteId, value.ownerKey, value.ownerGeneration, value.profileId,
  ])
}

export function sameDomainScope(left: DomainScope, right: DomainScope): boolean {
  return left.platformId === right.platformId && left.organizationId === right.organizationId
    && left.workspaceId === right.workspaceId && left.siteId === right.siteId
    && left.ownerKey === right.ownerKey && left.generation === right.generation
    && left.profileId === right.profileId && left.state === right.state
    && left.transferFence === right.transferFence
}

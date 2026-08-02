import { Type, Value, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'

const Id = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const Host = Type.String({ minLength: 1, maxLength: 253, pattern: '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$' })
const Hash = Type.String({ pattern: '^[a-f0-9]{64}$' })
const Route = Type.String({ minLength: 1, maxLength: 2_048, pattern: '^/(?:[A-Za-z0-9._~-]+(?:/[A-Za-z0-9._~-]+)*)?$' })
const Timestamp = Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$' })
const Version = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
const RuntimeJson = Type.Recursive((Self) => Type.Union([
  Type.Null(), Type.Boolean(), Type.Number(), Type.String({ maxLength: 65_536 }),
  Type.Array(Self, { maxItems: 1_000 }),
  Type.Record(Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9._-]+$' }), Self, { maxProperties: 256 }),
]))

const SiteApplicationAudienceSchema = Type.Union([
  Type.Object({ kind: Type.Literal('public'), memberId: Type.Null(), accessFingerprintSha256: Hash }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('member'), memberId: Id, accessFingerprintSha256: Hash }, { additionalProperties: false }),
])
const SiteApplicationCacheIdentitySchema = Type.Object({
  host: Host, platformId: Id, organizationId: Id, workspaceId: Id, siteId: Id, ownerKey: Id,
  ownerGeneration: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  releaseId: Id, releaseHashSha256: Hash, route: Route,
  canonicalQuery: Type.String({ maxLength: 4_096, pattern: '^(?:[A-Za-z0-9._~%+-]+=[A-Za-z0-9._~%+-]*(?:&[A-Za-z0-9._~%+-]+=[A-Za-z0-9._~%+-]*)*)?$' }),
  audience: SiteApplicationAudienceSchema,
  runtimeDeploymentVersion: Type.String({ pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$' }),
  componentRegistryVersion: Type.String({ pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$' }),
  rolloutPolicyVersion: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
}, { additionalProperties: false })

export const SiteApplicationMemberSchema = Type.Union([
  Type.Object({ authenticated: Type.Literal(false), memberIdentityId: Type.Null(), memberId: Type.Null(), sessionId: Type.Null(), displayName: Type.Null() }, { additionalProperties: false }),
  Type.Object({ authenticated: Type.Literal(true), memberIdentityId: Id, memberId: Id, sessionId: Id, displayName: Type.String({ maxLength: 200 }) }, { additionalProperties: false }),
])
export type SiteApplicationMember = Readonly<Static<typeof SiteApplicationMemberSchema>>

export const SiteApplicationSnapshotSchema = Type.Object({
  version: Version,
  cart: Type.Object({ items: Type.Array(Type.Object({ itemId: Id, quantity: Type.Integer({ minimum: 1, maximum: 10_000 }) }, { additionalProperties: false }), { maxItems: 1_000 }) }, { additionalProperties: false }),
  booking: Type.Object({ selections: Type.Array(Type.Object({ selectionId: Id, resourceId: Id, startsAt: Timestamp }, { additionalProperties: false }), { maxItems: 1_000 }) }, { additionalProperties: false }),
  account: Type.Union([Type.Object({ displayName: Type.String({ maxLength: 200 }), locale: Type.String({ minLength: 2, maxLength: 35 }), timezone: Type.String({ minLength: 1, maxLength: 100 }) }, { additionalProperties: false }), Type.Null()]),
}, { additionalProperties: false })
export type SiteApplicationSnapshot = Readonly<Static<typeof SiteApplicationSnapshotSchema>>

export const SiteApplicationAccessSchema = Type.Object({
  member: Type.Boolean(),
  paid: Type.Boolean(),
  memberSource: Type.Union([Type.Literal('none'), Type.Literal('registered'), Type.Literal('complimentary'), Type.Literal('manual'), Type.Literal('paid')]),
  segmentIds: Type.Array(Id, { maxItems: 10_000, uniqueItems: true }),
}, { additionalProperties: false })
export type SiteApplicationAccess = Readonly<Static<typeof SiteApplicationAccessSchema>>
export const SiteApplicationContextSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  cacheIdentity: SiteApplicationCacheIdentitySchema,
  member: SiteApplicationMemberSchema,
  snapshot: SiteApplicationSnapshotSchema,
  access: Type.Optional(SiteApplicationAccessSchema),
  cachePolicy: Type.Union([Type.Literal('public'), Type.Literal('private'), Type.Literal('no-store')]),
}, { additionalProperties: false })
export type SiteApplicationContext = Readonly<Static<typeof SiteApplicationContextSchema>>

export const SiteRuntimeRolloutPolicySchema = Type.Object({
  route: Route,
  target: Type.Union([Type.Literal('react'), Type.Literal('legacy')]),
  shadow: Type.Union([Type.Literal('off'), Type.Literal('compare')]),
  fallback: Type.Union([Type.Literal('deny'), Type.Literal('legacy')]),
  legacyReleaseId: Type.Union([Id, Type.Null()]),
  version: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
}, { additionalProperties: false })
export type SiteRuntimeRolloutPolicy = Readonly<Static<typeof SiteRuntimeRolloutPolicySchema>>

export const SiteRuntimeLegacyScriptSchema = Type.Object({
  logicalPath: Type.String({ minLength: 2, maxLength: 2_048, pattern: '^/[A-Za-z0-9._/-]+$' }),
  source: Type.String({ maxLength: 512 * 1024 }),
  contentHashSha256: Hash,
}, { additionalProperties: false })
export const SiteRuntimeLegacyDocumentSchema = Type.Object({
  releaseId: Id,
  route: Route,
  html: Type.String({ maxLength: 2 * 1024 * 1024 }),
  contentHashSha256: Hash,
  scripts: Type.Array(SiteRuntimeLegacyScriptSchema, { maxItems: 32 }),
  csp: Type.Literal("default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'"),
}, { additionalProperties: false })
export type SiteRuntimeLegacyDocument = Readonly<Static<typeof SiteRuntimeLegacyDocumentSchema>>

export const SiteRuntimeDeliverySchema = Type.Object({
  selected: Type.Union([Type.Literal('react'), Type.Literal('legacy')]),
  reason: Type.Union([Type.Literal('policy'), Type.Literal('shadow-match'), Type.Literal('shadow-mismatch-fallback')]),
  policy: SiteRuntimeRolloutPolicySchema,
  shadowParity: Type.Union([Type.Literal('not-run'), Type.Literal('matched'), Type.Literal('mismatched')]),
  legacy: Type.Union([SiteRuntimeLegacyDocumentSchema, Type.Null()]),
}, { additionalProperties: false })
export type SiteRuntimeDelivery = Readonly<Static<typeof SiteRuntimeDeliverySchema>>

export const SiteApplicationOperationSchema = Type.Object({
  mutationId: Id,
  idempotencyKey: Type.String({ minLength: 16, maxLength: 255, pattern: '^[A-Za-z0-9._:-]+$' }),
  kind: Type.Union([
    Type.Literal('cart.update'), Type.Literal('booking.update'), Type.Literal('account.update'), Type.Literal('payment.initialize'),
  ]),
  expectedVersion: Version,
  payload: RuntimeJson,
  issuedAt: Timestamp,
}, { additionalProperties: false })
export type SiteApplicationOperation = Readonly<Static<typeof SiteApplicationOperationSchema>>

export const SiteApplicationMutationRequestSchema = Type.Object({
  host: Type.String({ minLength: 1, maxLength: 253 }),
  memberSessionToken: Type.Union([Type.String({ minLength: 32, maxLength: 4_096 }), Type.Null()]),
  context: SiteApplicationContextSchema,
  operation: SiteApplicationOperationSchema,
}, { additionalProperties: false })
export type SiteApplicationMutationRequest = Readonly<Static<typeof SiteApplicationMutationRequestSchema>>

export const SiteApplicationMutationResponseSchema = Type.Object({
  accepted: Type.Literal(true),
  duplicate: Type.Boolean(),
  mutationId: Id,
  snapshot: SiteApplicationSnapshotSchema,
}, { additionalProperties: false })
export type SiteApplicationMutationResponse = Readonly<Static<typeof SiteApplicationMutationResponseSchema>>

export class SiteApplicationError extends Error {
  readonly code: 'invalid' | 'unauthenticated' | 'scope' | 'stale' | 'replay' | 'unsupported' | 'legacy-unavailable'
  constructor(code: SiteApplicationError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'SiteApplicationError'
  }
}

export function parseSiteApplicationContract<T extends TSchema>(schema: T, raw: unknown, label: string): Readonly<Static<T>> {
  const parsed = safeParseValue(schema, raw)
  if (!parsed.ok) {
    const first = Value.Errors(schema, raw).First()
    throw new SiteApplicationError('invalid', `${label} failed its strict TypeBox contract${first ? ` at ${first.path || '/'}: ${first.message}` : ''}.`)
  }
  return deepFreeze(parsed.value)
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

export function publicApplicationMember(): SiteApplicationMember {
  return Object.freeze({ authenticated: false, memberIdentityId: null, memberId: null, sessionId: null, displayName: null })
}

export function emptyApplicationSnapshot(): SiteApplicationSnapshot {
  const snapshot: SiteApplicationSnapshot = { version: 0, cart: { items: [] }, booking: { selections: [] }, account: null }
  return deepFreeze(snapshot)
}

export function publicAudience(): Static<typeof SiteApplicationAudienceSchema> {
  return Object.freeze({ kind: 'public', memberId: null, accessFingerprintSha256: '0'.repeat(64) })
}

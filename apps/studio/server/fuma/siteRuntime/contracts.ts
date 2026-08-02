import { Type, Value, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import { SiteApplicationContextSchema, SiteRuntimeDeliverySchema } from './applicationContracts'
import { RuntimeRouteArtifactSchema } from '../publishing/runtimeTree/contracts'

const IdSchema = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const HostSchema = Type.String({ minLength: 1, maxLength: 253, pattern: '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$' })
const HashSchema = Type.String({ pattern: '^[a-f0-9]{64}$' })
const VersionSchema = Type.String({ pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$' })
const RouteSchema = Type.String({ minLength: 1, maxLength: 2_048, pattern: '^/(?:[A-Za-z0-9._~-]+(?:/[A-Za-z0-9._~-]+)*)?$' })
const QuerySchema = Type.String({ maxLength: 4_096, pattern: '^(?:[A-Za-z0-9._~%+-]+=[A-Za-z0-9._~%+-]*(?:&[A-Za-z0-9._~%+-]+=[A-Za-z0-9._~%+-]*)*)?$' })

export const SiteRuntimeResolveRequestSchema = Type.Object({
  host: Type.String({ minLength: 1, maxLength: 300 }),
  route: RouteSchema,
  canonicalQuery: QuerySchema,
  runtimeDeploymentVersion: VersionSchema,
  memberSessionToken: Type.Union([Type.String({ minLength: 32, maxLength: 4_096 }), Type.Null()]),
}, { additionalProperties: false })
export type SiteRuntimeResolveRequest = Static<typeof SiteRuntimeResolveRequestSchema>

export const SiteRuntimeAudienceSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('public'),
    memberId: Type.Null(),
    accessFingerprintSha256: HashSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('member'),
    memberId: IdSchema,
    accessFingerprintSha256: HashSchema,
  }, { additionalProperties: false }),
])
export type SiteRuntimeAudience = Static<typeof SiteRuntimeAudienceSchema>

export const SiteRuntimeCacheIdentitySchema = Type.Object({
  host: HostSchema,
  platformId: IdSchema,
  organizationId: IdSchema,
  workspaceId: IdSchema,
  siteId: IdSchema,
  ownerKey: IdSchema,
  ownerGeneration: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  releaseId: IdSchema,
  releaseHashSha256: HashSchema,
  route: RouteSchema,
  canonicalQuery: QuerySchema,
  audience: SiteRuntimeAudienceSchema,
  runtimeDeploymentVersion: VersionSchema,
  componentRegistryVersion: VersionSchema,
  rolloutPolicyVersion: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
}, { additionalProperties: false })
export type SiteRuntimeCacheIdentity = Static<typeof SiteRuntimeCacheIdentitySchema>

export const SiteRuntimeResolveResponseSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  contractVersion: Type.Literal('1.0.0'),
  cacheIdentity: SiteRuntimeCacheIdentitySchema,
  sourceSnapshotHashSha256: HashSchema,
  application: SiteApplicationContextSchema,
  delivery: SiteRuntimeDeliverySchema,
  routeArtifact: RuntimeRouteArtifactSchema,
}, { additionalProperties: false })
export type SiteRuntimeResolveResponse = Static<typeof SiteRuntimeResolveResponseSchema>

export class SiteRuntimeContractError extends Error {
  readonly code: 'invalid-request' | 'unknown-host' | 'route-not-found' | 'stale-release' | 'incompatible-deployment' | 'invalid-artifact'

  constructor(code: SiteRuntimeContractError['code'], message: string) {
    super(message)
    this.name = 'SiteRuntimeContractError'
    this.code = code
  }
}

export function parseSiteRuntimeContract<T extends TSchema>(schema: T, value: unknown, label: string): Readonly<Static<T>> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) {
    const first = Value.Errors(schema, value).First()
    throw new SiteRuntimeContractError('invalid-request', `${label} failed its strict TypeBox contract${first ? ` at ${first.path || '/'}: ${first.message}` : ''}.`)
  }
  return deepFreeze(parsed.value)
}

export function canonicalSiteRuntimeQuery(value: string): string {
  if (value === '') return value
  const entries = value.split('&').map((pair) => pair.split('=', 2) as [string, string])
  const sorted = [...entries].sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey, 'en') || leftValue.localeCompare(rightValue, 'en'))
  if (!entries.every(([key, item], index) => key === sorted[index]?.[0] && item === sorted[index]?.[1])) {
    throw new SiteRuntimeContractError('invalid-request', 'Query identity must be canonically sorted.')
  }
  return value
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

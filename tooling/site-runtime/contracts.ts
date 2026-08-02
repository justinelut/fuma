import { Type, type Static, type TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { createHash } from 'node:crypto'

const IdSchema = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const HostSchema = Type.String({ minLength: 1, maxLength: 253, pattern: '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$' })
const HashSchema = Type.String({ pattern: '^[a-f0-9]{64}$' })
const ExactVersionSchema = Type.String({ pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$' })
const RouteSchema = Type.String({ minLength: 1, maxLength: 2_048, pattern: '^/(?:[A-Za-z0-9._~-]+(?:/[A-Za-z0-9._~-]+)*)?$' })
const CanonicalQuerySchema = Type.String({ maxLength: 4_096, pattern: '^(?:[A-Za-z0-9._~-]+=[A-Za-z0-9._~-]*(?:&[A-Za-z0-9._~-]+=[A-Za-z0-9._~-]*)*)?$' })

export const TenantRuntimeApplicationContractSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  applicationPath: Type.Literal('apps/site-runtime'),
  deploymentModel: Type.Literal('single-multi-tenant'),
  router: Type.Literal('next-app-router'),
  serverRuntime: Type.Literal('node'),
  bunRole: Type.Literal('benchmark-only'),
  outputMode: Type.Literal('standalone'),
  privateContractValidation: Type.Literal('typebox'),
  imports: Type.Object({
    applications: Type.Tuple([]),
    sharedUiPackage: Type.Literal(false),
    studioAuthority: Type.Literal(false),
  }, { additionalProperties: false }),
  tenantState: Type.Object({
    processGlobal: Type.Literal(false),
    defaultTenant: Type.Null(),
  }, { additionalProperties: false }),
  styling: Type.Object({
    ownership: Type.Literal('app-local'),
    tailwindVersion: ExactVersionSchema,
    shadcnVersion: ExactVersionSchema,
    utilities: Type.Literal('static-source-only'),
    persistedUtilitiesCompile: Type.Literal(false),
    studioTailwind: Type.Literal(false),
  }, { additionalProperties: false }),
  production: Type.Object({
    os: Type.Literal('linux'),
    architecture: Type.Literal('arm64'),
    emulation: Type.Literal(false),
  }, { additionalProperties: false }),
}, { additionalProperties: false })
export type TenantRuntimeApplicationContract = Static<typeof TenantRuntimeApplicationContractSchema>

export const TenantRuntimeCompatibilityContractSchema = Type.Object({
  semanticHtmlCompiler: Type.Literal('retained'),
  staticHostedRoutes: Type.Literal('retained-during-migration'),
  portableExport: Type.Literal('retained'),
  selfHostedPublishing: Type.Literal('retained'),
  legacyReleaseReader: Type.Literal('retained'),
  stringPluginRenderer: Type.Literal('bounded-legacy-only'),
  emergencyRollback: Type.Literal('legacy-without-data-mutation'),
}, { additionalProperties: false })
export type TenantRuntimeCompatibilityContract = Static<typeof TenantRuntimeCompatibilityContractSchema>

export const TenantHostBindingSchema = Type.Object({
  host: HostSchema,
  platformId: IdSchema,
  organizationId: IdSchema,
  workspaceId: IdSchema,
  siteId: IdSchema,
  ownerKey: IdSchema,
  ownerGeneration: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  state: Type.Literal('active'),
  releaseId: IdSchema,
  releaseHashSha256: HashSchema,
}, { additionalProperties: false })
export type TenantHostBinding = Static<typeof TenantHostBindingSchema>

export const TenantRouteResolutionSchema = Type.Object({
  ...TenantHostBindingSchema.properties,
  route: RouteSchema,
}, { additionalProperties: false })
export type TenantRouteResolution = Static<typeof TenantRouteResolutionSchema>

const CacheAudienceSchema = Type.Union([
  Type.Object({ kind: Type.Literal('public'), memberId: Type.Null(), accessFingerprintSha256: HashSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('member'), memberId: IdSchema, accessFingerprintSha256: HashSchema }, { additionalProperties: false }),
])

export const TenantCacheIdentitySchema = Type.Object({
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
  canonicalQuery: CanonicalQuerySchema,
  audience: CacheAudienceSchema,
  runtimeDeploymentVersion: ExactVersionSchema,
  componentRegistryVersion: ExactVersionSchema,
}, { additionalProperties: false })
export type TenantCacheIdentity = Static<typeof TenantCacheIdentitySchema>

export const TenantComponentTrustBindingSchema = Type.Object({
  namespace: Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-z0-9]+(?:[.-][a-z0-9]+)*$' }),
  componentId: Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-z0-9]+(?:[.-][a-z0-9]+)*$' }),
  exactVersion: ExactVersionSchema,
  execution: Type.Union([
    Type.Literal('server-component'),
    Type.Literal('client-component'),
    Type.Literal('declarative-tree'),
    Type.Literal('legacy-string'),
  ]),
  trustTier: Type.Union([
    Type.Literal('official'),
    Type.Literal('declarative-community'),
    Type.Literal('reviewed-client'),
    Type.Literal('legacy'),
  ]),
  propsSchemaHashSha256: HashSchema,
  slotsSchemaHashSha256: HashSchema,
  sourceHashSha256: HashSchema,
  capabilities: Type.Array(Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-z0-9]+(?:[.:_-][a-z0-9]+)*$' }), { maxItems: 64, uniqueItems: true }),
  dynamicTenantImport: Type.Literal(false),
  persistedExecutableSource: Type.Literal(false),
}, { additionalProperties: false })
export type TenantComponentTrustBinding = Static<typeof TenantComponentTrustBindingSchema>

export const TenantSiteCookieSchema = Type.Object({
  host: HostSchema,
  realm: Type.Literal('site-member'),
  name: Type.String({ pattern: '^__Host-fuma_site_[a-f0-9]{16}$' }),
  secure: Type.Literal(true),
  httpOnly: Type.Literal(true),
  sameSite: Type.Literal('lax'),
  path: Type.Literal('/'),
  domain: Type.Null(),
  staffCookie: Type.Literal(false),
}, { additionalProperties: false })
export type TenantSiteCookie = Static<typeof TenantSiteCookieSchema>

export const TenantRuntimeAuthorityContractSchema = Type.Object({
  hostAuthority: Type.Literal('studio-exact-host-private-api'),
  releaseAuthority: Type.Literal('studio-active-immutable-release-private-api'),
  dynamicAuthority: Type.Literal('typed-bun-domain-api'),
  directDatabase: Type.Literal(false),
  directProvider: Type.Literal(false),
  draftReads: Type.Literal(false),
}, { additionalProperties: false })
export type TenantRuntimeAuthorityContract = Static<typeof TenantRuntimeAuthorityContractSchema>

export const TenantRuntimeRatificationSchema = Type.Object({
  ticket: Type.Literal('FUMA-SITE-001'),
  application: TenantRuntimeApplicationContractSchema,
  authority: TenantRuntimeAuthorityContractSchema,
  compatibility: TenantRuntimeCompatibilityContractSchema,
  hostBindings: Type.Array(TenantHostBindingSchema, { minItems: 2, maxItems: 100, uniqueItems: true }),
  cacheIdentities: Type.Array(TenantCacheIdentitySchema, { minItems: 2, maxItems: 100 }),
  components: Type.Array(TenantComponentTrustBindingSchema, { minItems: 1, maxItems: 1_000 }),
  cookies: Type.Array(TenantSiteCookieSchema, { maxItems: 100 }),
}, { additionalProperties: false })
export type TenantRuntimeRatification = Static<typeof TenantRuntimeRatificationSchema>

export type TenantRuntimeContractErrorCode =
  | 'invalid-contract'
  | 'invalid-component-trust'
  | 'duplicate-host'
  | 'unknown-host'
  | 'invalid-route'
  | 'cross-tenant-cache'

export class TenantRuntimeContractError extends Error {
  constructor(readonly code: TenantRuntimeContractErrorCode, message: string) {
    super(message)
    this.name = 'TenantRuntimeContractError'
  }
}

function parse<T extends TSchema>(schema: T, value: unknown, label: string): Static<T> {
  if (!Value.Check(schema, value)) {
    const detail = Value.Errors(schema, value).First()
    throw new TenantRuntimeContractError('invalid-contract', `${label} failed its TypeBox contract${detail ? ` at ${detail.path || '/'}: ${detail.message}` : ''}.`)
  }
  return structuredClone(value) as Static<T>
}

function deeplyFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deeplyFreeze(nested)
    Object.freeze(value)
  }
  return value
}

function canonicalQuery(value: string): boolean {
  if (!value) return true
  const entries = value.split('&').map((pair) => pair.split('=', 2) as [string, string])
  const ordered = [...entries].sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey, 'en') || leftValue.localeCompare(rightValue, 'en'))
  return entries.every(([key, item], index) => key === ordered[index]?.[0] && item === ordered[index]?.[1])
}

function validateComponentTrust(component: TenantComponentTrustBinding): void {
  const valid = component.execution === 'server-component'
    ? component.trustTier === 'official'
    : component.execution === 'client-component'
      ? component.trustTier === 'official' || component.trustTier === 'reviewed-client'
      : component.execution === 'declarative-tree'
        ? component.trustTier === 'official' || component.trustTier === 'declarative-community'
        : component.trustTier === 'legacy'
  if (!valid) throw new TenantRuntimeContractError('invalid-component-trust', 'Component execution mode is not permitted for its trust tier.')
}

export function validateTenantRuntimeRatification(value: unknown): Readonly<TenantRuntimeRatification> {
  const contract = parse(TenantRuntimeRatificationSchema, value, 'tenant runtime ratification')
  const hosts = new Set<string>()
  for (const binding of contract.hostBindings) {
    if (hosts.has(binding.host)) throw new TenantRuntimeContractError('duplicate-host', `Duplicate exact host ${binding.host}.`)
    hosts.add(binding.host)
  }
  for (const cache of contract.cacheIdentities) {
    if (!canonicalQuery(cache.canonicalQuery)) throw new TenantRuntimeContractError('invalid-contract', 'Cache query identity must be canonically sorted.')
    if (!contract.hostBindings.some((binding) => sameReleaseAuthority(binding, cache))) {
      throw new TenantRuntimeContractError('cross-tenant-cache', 'Cache identity is not qualified by an exact ratified host and immutable release.')
    }
  }
  for (const component of contract.components) validateComponentTrust(component)
  for (const cookie of contract.cookies) {
    if (!hosts.has(cookie.host)) throw new TenantRuntimeContractError('invalid-contract', 'Site-member cookie host is not a ratified exact host.')
  }
  return deeplyFreeze(contract)
}

export function normalizeTenantHost(rawHost: string): string {
  if (!rawHost || rawHost !== rawHost.trim() || /[^\x21-\x7e]|[\s/@\\,#[\]]/.test(rawHost)) {
    throw new TenantRuntimeContractError('unknown-host', 'Host is malformed and has no fallback.')
  }
  let authority = rawHost.toLowerCase()
  if (authority.endsWith('.')) authority = authority.slice(0, -1)
  const match = /^([^:]+)(?::([0-9]{1,5}))?$/.exec(authority)
  if (!match || (match[2] !== undefined && (Number(match[2]) < 1 || Number(match[2]) > 65_535)) || !Value.Check(HostSchema, match[1])) {
    throw new TenantRuntimeContractError('unknown-host', 'Host is malformed and has no fallback.')
  }
  return match[1]!
}

export class FixtureTenantRuntimeAuthority {
  readonly #bindings: ReadonlyMap<string, TenantHostBinding>

  constructor(bindings: readonly TenantHostBinding[]) {
    const parsed = bindings.map((binding) => parse(TenantHostBindingSchema, binding, 'host binding'))
    if (new Set(parsed.map(({ host }) => host)).size !== parsed.length) throw new TenantRuntimeContractError('duplicate-host', 'Exact host bindings must be unique.')
    this.#bindings = new Map(parsed.map((binding) => [binding.host, deeplyFreeze(binding)]))
  }

  resolve(rawHost: string, route: string): Readonly<TenantRouteResolution> {
    const host = normalizeTenantHost(rawHost)
    const binding = this.#bindings.get(host)
    if (!binding) throw new TenantRuntimeContractError('unknown-host', 'Unknown host has no default tenant.')
    if (!Value.Check(RouteSchema, route) || route.includes('//') || route.includes('/..')) {
      throw new TenantRuntimeContractError('invalid-route', 'Route must be canonical and query-free.')
    }
    return deeplyFreeze({ ...structuredClone(binding), route })
  }
}

function sameReleaseAuthority(left: TenantHostBinding | TenantRouteResolution, right: TenantCacheIdentity): boolean {
  return left.host === right.host
    && left.platformId === right.platformId
    && left.organizationId === right.organizationId
    && left.workspaceId === right.workspaceId
    && left.siteId === right.siteId
    && left.ownerKey === right.ownerKey
    && left.ownerGeneration === right.ownerGeneration
    && left.releaseId === right.releaseId
    && left.releaseHashSha256 === right.releaseHashSha256
}

export function assertCacheIdentityForResolution(value: unknown, resolution: TenantRouteResolution): Readonly<TenantCacheIdentity> {
  const identity = parse(TenantCacheIdentitySchema, value, 'tenant cache identity')
  if (!canonicalQuery(identity.canonicalQuery)) throw new TenantRuntimeContractError('invalid-contract', 'Cache query identity must be canonically sorted.')
  if (!sameReleaseAuthority(resolution, identity) || resolution.route !== identity.route) {
    throw new TenantRuntimeContractError('cross-tenant-cache', 'Cache identity does not match the exact host, owner generation, immutable release, and route.')
  }
  return deeplyFreeze(identity)
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right, 'en'))
    return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function tenantCacheKey(value: unknown): string {
  const identity = parse(TenantCacheIdentitySchema, value, 'tenant cache identity')
  if (!canonicalQuery(identity.canonicalQuery)) throw new TenantRuntimeContractError('invalid-contract', 'Cache query identity must be canonically sorted.')
  return `site-runtime:v1:${createHash('sha256').update(canonicalJson(identity)).digest('hex')}`
}

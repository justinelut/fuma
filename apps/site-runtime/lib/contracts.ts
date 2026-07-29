import { Type, type Static, type TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

const Id = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const Host = Type.String({ minLength: 1, maxLength: 253, pattern: '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$' })
const Hash = Type.String({ pattern: '^[a-f0-9]{64}$' })
const Version = Type.String({ pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$' })
const Route = Type.String({ minLength: 1, maxLength: 2_048, pattern: '^/(?:[A-Za-z0-9._~-]+(?:/[A-Za-z0-9._~-]+)*)?$' })
const Path = Type.String({ minLength: 2, maxLength: 2_048, pattern: '^/[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$' })
const Query = Type.String({ maxLength: 4_096, pattern: '^(?:[A-Za-z0-9._~%+-]+=[A-Za-z0-9._~%+-]*(?:&[A-Za-z0-9._~%+-]+=[A-Za-z0-9._~%+-]*)*)?$' })
const Namespace = Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-z0-9]+(?:[.-][a-z0-9]+)*$' })
const Capability = Type.Union([
  Type.Literal('content.public.read'), Type.Literal('media.public.read'), Type.Literal('public-data.read'),
  Type.Literal('interaction.local-state'), Type.Literal('browser.events'), Type.Literal('browser.animation'),
])
const Capabilities = Type.Array(Capability, { maxItems: 16, uniqueItems: true })

export const RuntimeJsonSchema = Type.Recursive((Self) => Type.Union([
  Type.Null(), Type.Boolean(), Type.Number(), Type.String({ maxLength: 1_000_000 }),
  Type.Array(Self, { maxItems: 100_000 }),
  Type.Record(Type.String({ minLength: 1, maxLength: 255 }), Self),
]))
export type RuntimeJson = Static<typeof RuntimeJsonSchema>

export const ComponentReferenceSchema = Type.Object({
  namespace: Namespace,
  componentId: Namespace,
  exactVersion: Version,
}, { additionalProperties: false })
export type ComponentReference = Static<typeof ComponentReferenceSchema>

export const RuntimeNodeSchema = Type.Recursive((Self) => Type.Object({
  nodeId: Id,
  component: ComponentReferenceSchema,
  props: RuntimeJsonSchema,
  classes: Type.Array(Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z_][A-Za-z0-9_-]*$' }), { maxItems: 1_000, uniqueItems: true }),
  styles: Type.Array(Type.Object({ property: Type.String({ minLength: 1, maxLength: 128 }), value: Type.String({ maxLength: 4_096 }) }, { additionalProperties: false }), { maxItems: 1_000 }),
  requiredCapabilities: Capabilities,
  bindings: Type.Array(Type.Object({ prop: Type.String({ minLength: 1, maxLength: 128 }), publicDataKey: Id }, { additionalProperties: false }), { maxItems: 1_000 }),
  slots: Type.Array(Type.Object({ name: Type.String({ minLength: 1, maxLength: 128 }), children: Type.Array(Self, { maxItems: 10_000 }) }, { additionalProperties: false }), { maxItems: 128 }),
}, { additionalProperties: false }))
export type RuntimeNode = Static<typeof RuntimeNodeSchema>

const RuntimeParameterSchema = Type.Object({
  id: Id,
  name: Type.String({ minLength: 1, maxLength: 255 }),
  type: Type.Union([
    Type.Literal('string'), Type.Literal('number'), Type.Literal('boolean'), Type.Literal('url'),
    Type.Literal('enum'), Type.Literal('color'), Type.Literal('image'), Type.Literal('richText'), Type.Literal('slot'),
  ]),
  defaultValue: RuntimeJsonSchema,
  required: Type.Boolean(),
  enumOptions: Type.Optional(Type.Array(Type.String({ maxLength: 1_000 }), { maxItems: 1_000, uniqueItems: true })),
}, { additionalProperties: false })

const OfficialTrustSchema = Type.Object({
  tier: Type.Literal('official'), reviewState: Type.Literal('compiled-into-runtime'), ownerConfirmed: Type.Literal(true),
  validation: Type.Object({
    typecheck: Type.Literal(true), build: Type.Literal(true), staticUtilities: Type.Literal(true),
    accessibility: Type.Literal(true), security: Type.Literal(true), csp: Type.Literal(true), bundleBudget: Type.Literal(true),
  }, { additionalProperties: false }),
}, { additionalProperties: false })
const DeclarativeTrustSchema = Type.Object({
  tier: Type.Literal('owner-private-declarative'), reviewState: Type.Literal('owner-private'), ownerConfirmed: Type.Literal(true),
  validation: Type.Object({
    schema: Type.Literal(true), references: Type.Literal(true), capabilities: Type.Literal(true), noExecutableSource: Type.Literal(true),
  }, { additionalProperties: false }),
}, { additionalProperties: false })
const RestrictedTrustSchema = Type.Object({
  tier: Type.Literal('owner-private-restricted-client'), reviewState: Type.Literal('validated-and-owner-confirmed'), ownerConfirmed: Type.Literal(true),
  validation: Type.Object({
    typecheck: Type.Literal(true), build: Type.Literal(true), staticUtilities: Type.Literal(true), accessibility: Type.Literal(true),
    security: Type.Literal(true), csp: Type.Literal(true), bundleBudget: Type.Literal(true), noServerCode: Type.Literal(true),
    noSecrets: Type.Literal(true), noNetwork: Type.Literal(true), noPaymentAuthority: Type.Literal(true),
  }, { additionalProperties: false }),
}, { additionalProperties: false })

export const ComponentRegistryEntrySchema = Type.Object({
  reference: ComponentReferenceSchema,
  source: Type.Union([
    Type.Object({ kind: Type.Literal('official'), publisher: Type.Literal('fuma'), ownerKey: Type.Null(), siteId: Type.Null(), origin: Type.Literal('runtime-source') }, { additionalProperties: false }),
    Type.Object({
      kind: Type.Literal('owner-private'), publisher: Type.Literal('site-owner'), ownerKey: Id, siteId: Id,
      origin: Type.Union([
        Type.Literal('site-created'), Type.Literal('visual-designer'), Type.Literal('ai-designer'),
        Type.Literal('source-import'), Type.Literal('team-pack'), Type.Literal('reviewed-marketplace'),
      ]),
    }, { additionalProperties: false }),
  ]),
  execution: Type.Union([Type.Literal('official-server'), Type.Literal('official-client'), Type.Literal('private-declarative'), Type.Literal('restricted-client')]),
  trust: Type.Union([OfficialTrustSchema, DeclarativeTrustSchema, RestrictedTrustSchema]),
  propsSchemaHashSha256: Hash,
  slotsSchemaHashSha256: Hash,
  sourceHashSha256: Hash,
  capabilities: Capabilities,
  artifactPaths: Type.Array(Path, { maxItems: 64, uniqueItems: true }),
  parameters: Type.Array(RuntimeParameterSchema, { maxItems: 1_000 }),
  definition: Type.Union([RuntimeNodeSchema, Type.Null()]),
  dynamicTenantServerImport: Type.Literal(false),
  persistedExecutableJsx: Type.Literal(false),
}, { additionalProperties: false })
export type ComponentRegistryEntry = Static<typeof ComponentRegistryEntrySchema>

const RouteManifestSchema = Type.Object({
  route: Route, pageId: Id, artifactPath: Path, semanticHtmlPath: Path,
  layoutIds: Type.Array(Id, { maxItems: 64, uniqueItems: true }),
  styleArtifactPaths: Type.Array(Path, { maxItems: 64, uniqueItems: true }),
  publicDataKeys: Type.Array(Id, { maxItems: 1_000, uniqueItems: true }),
}, { additionalProperties: false })
const PageSchema = Type.Object({ pageId: Id, title: Type.String({ minLength: 1, maxLength: 512 }), root: RuntimeNodeSchema }, { additionalProperties: false })
const LayoutSchema = Type.Object({ layoutId: Id, exactVersion: Version, root: RuntimeNodeSchema }, { additionalProperties: false })
const StyleDeclarationSchema = Type.Object({ property: Type.String({ minLength: 1, maxLength: 128 }), value: Type.String({ maxLength: 4_096 }) }, { additionalProperties: false })
const StyleManifestSchema = Type.Object({
  tokens: Type.Array(Type.Object({ name: Type.String({ minLength: 1, maxLength: 128 }), value: Type.String({ minLength: 1, maxLength: 4_096 }) }, { additionalProperties: false }), { maxItems: 10_000 }),
  breakpoints: Type.Array(Type.Object({ id: Id, minWidthPx: Type.Integer({ minimum: 0, maximum: 100_000 }) }, { additionalProperties: false }), { maxItems: 64 }),
  rules: Type.Array(Type.Object({ ruleId: Id, selector: Type.String({ minLength: 1, maxLength: 2_048 }), declarations: Type.Array(StyleDeclarationSchema, { maxItems: 1_000 }) }, { additionalProperties: false }), { maxItems: 100_000 }),
  cssArtifactPaths: Type.Array(Path, { maxItems: 1_000, uniqueItems: true }),
}, { additionalProperties: false })
const PublicDataSchema = Type.Object({ key: Id, value: RuntimeJsonSchema }, { additionalProperties: false })
const StylesheetSchema = Type.Object({ logicalPath: Path, contentHashSha256: Hash, cssText: Type.String({ maxLength: 10 * 1024 * 1024 }) }, { additionalProperties: false })
const ArtifactReferenceSchema = Type.Object({
  logicalPath: Path,
  role: Type.Union([Type.Literal('semantic-html'), Type.Literal('semantic-css'), Type.Literal('runtime-route'), Type.Literal('client-bundle'), Type.Literal('component-css'), Type.Literal('source-map'), Type.Literal('media'), Type.Literal('public-data')]),
  mimeType: Type.String({ minLength: 3, maxLength: 255 }),
  contentHashSha256: Hash,
  integritySha256: Type.String({ pattern: '^sha256-[A-Za-z0-9+/]{43}=$' }),
  sizeBytes: Type.Integer({ minimum: 0, maximum: 25 * 1024 * 1024 }),
  references: Type.Array(Path, { maxItems: 10_000, uniqueItems: true }),
  component: Type.Union([ComponentReferenceSchema, Type.Null()]),
  declaredCapabilities: Capabilities,
}, { additionalProperties: false })
const ReleaseIdentity = {
  platformId: Id, organizationId: Id, workspaceId: Id, siteId: Id, ownerKey: Id,
  ownerGeneration: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  releaseId: Id, sourceSnapshotId: Id, sourceSnapshotHashSha256: Hash,
} as const
export const RuntimeRouteArtifactSchema = Type.Object({
  schemaVersion: Type.Literal(1), contractVersion: Type.Literal('1.0.0'), ...ReleaseIdentity,
  componentRegistryVersion: Version,
  route: RouteManifestSchema,
  page: PageSchema,
  layouts: Type.Array(LayoutSchema, { maxItems: 64 }),
  components: Type.Array(ComponentRegistryEntrySchema, { minItems: 1, maxItems: 100_000 }),
  styles: StyleManifestSchema,
  stylesheets: Type.Array(StylesheetSchema, { maxItems: 1_000 }),
  publicData: Type.Array(PublicDataSchema, { maxItems: 1_000 }),
  artifactReferences: Type.Array(ArtifactReferenceSchema, { minItems: 1, maxItems: 10_000 }),
  routeHashSha256: Hash,
}, { additionalProperties: false })
export type RuntimeRouteArtifact = Static<typeof RuntimeRouteArtifactSchema>

export const AudienceSchema = Type.Union([
  Type.Object({ kind: Type.Literal('public'), memberId: Type.Null(), accessFingerprintSha256: Hash }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('member'), memberId: Id, accessFingerprintSha256: Hash }, { additionalProperties: false }),
])
export const CacheIdentitySchema = Type.Object({
  host: Host, platformId: Id, organizationId: Id, workspaceId: Id, siteId: Id, ownerKey: Id,
  ownerGeneration: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  releaseId: Id, releaseHashSha256: Hash, route: Route, canonicalQuery: Query,
  audience: AudienceSchema, runtimeDeploymentVersion: Version, componentRegistryVersion: Version,
  rolloutPolicyVersion: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
}, { additionalProperties: false })
export const SiteApplicationMemberSchema = Type.Union([
  Type.Object({ authenticated: Type.Literal(false), memberIdentityId: Type.Null(), memberId: Type.Null(), sessionId: Type.Null(), displayName: Type.Null() }, { additionalProperties: false }),
  Type.Object({ authenticated: Type.Literal(true), memberIdentityId: Id, memberId: Id, sessionId: Id, displayName: Type.String({ maxLength: 200 }) }, { additionalProperties: false }),
])
export const SiteApplicationSnapshotSchema = Type.Object({
  version: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  cart: Type.Object({ items: Type.Array(Type.Object({ itemId: Id, quantity: Type.Integer({ minimum: 1, maximum: 10_000 }) }, { additionalProperties: false }), { maxItems: 1_000 }) }, { additionalProperties: false }),
  booking: Type.Object({ selections: Type.Array(Type.Object({ selectionId: Id, resourceId: Id, startsAt: Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$' }) }, { additionalProperties: false }), { maxItems: 1_000 }) }, { additionalProperties: false }),
  account: Type.Union([Type.Object({ displayName: Type.String({ maxLength: 200 }), locale: Type.String({ minLength: 2, maxLength: 35 }), timezone: Type.String({ minLength: 1, maxLength: 100 }) }, { additionalProperties: false }), Type.Null()]),
}, { additionalProperties: false })
export type SiteApplicationSnapshot = Static<typeof SiteApplicationSnapshotSchema>
export const SiteApplicationAccessSchema = Type.Object({
  member: Type.Boolean(),
  paid: Type.Boolean(),
  memberSource: Type.Union([Type.Literal('none'), Type.Literal('registered'), Type.Literal('complimentary'), Type.Literal('manual'), Type.Literal('paid')]),
  segmentIds: Type.Array(Id, { maxItems: 10_000, uniqueItems: true }),
}, { additionalProperties: false })
export type SiteApplicationAccess = Static<typeof SiteApplicationAccessSchema>
export const SiteApplicationContextSchema = Type.Object({
  schemaVersion: Type.Literal(1), cacheIdentity: CacheIdentitySchema, member: SiteApplicationMemberSchema,
  snapshot: SiteApplicationSnapshotSchema,
  access: Type.Optional(SiteApplicationAccessSchema),
  cachePolicy: Type.Union([Type.Literal('public'), Type.Literal('private'), Type.Literal('no-store')]),
}, { additionalProperties: false })
export type SiteApplicationContext = Static<typeof SiteApplicationContextSchema>
const SiteRuntimeRolloutPolicySchema = Type.Object({
  route: Route, target: Type.Union([Type.Literal('react'), Type.Literal('legacy')]),
  shadow: Type.Union([Type.Literal('off'), Type.Literal('compare')]), fallback: Type.Union([Type.Literal('deny'), Type.Literal('legacy')]),
  legacyReleaseId: Type.Union([Id, Type.Null()]), version: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
}, { additionalProperties: false })
const SiteRuntimeLegacyDocumentSchema = Type.Object({
  releaseId: Id, route: Route, html: Type.String({ maxLength: 2 * 1024 * 1024 }), contentHashSha256: Hash,
  scripts: Type.Array(Type.Object({ logicalPath: Path, source: Type.String({ maxLength: 512 * 1024 }), contentHashSha256: Hash }, { additionalProperties: false }), { maxItems: 32 }),
  csp: Type.Literal("default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'"),
}, { additionalProperties: false })
export type SiteRuntimeLegacyDocument = Static<typeof SiteRuntimeLegacyDocumentSchema>
const SiteRuntimeDeliverySchema = Type.Object({
  selected: Type.Union([Type.Literal('react'), Type.Literal('legacy')]),
  reason: Type.Union([Type.Literal('policy'), Type.Literal('shadow-match'), Type.Literal('shadow-mismatch-fallback')]),
  policy: SiteRuntimeRolloutPolicySchema,
  shadowParity: Type.Union([Type.Literal('not-run'), Type.Literal('matched'), Type.Literal('mismatched')]),
  legacy: Type.Union([SiteRuntimeLegacyDocumentSchema, Type.Null()]),
}, { additionalProperties: false })
export const SiteApplicationOperationSchema = Type.Object({
  mutationId: Id, idempotencyKey: Type.String({ minLength: 16, maxLength: 255, pattern: '^[A-Za-z0-9._:-]+$' }),
  kind: Type.Union([Type.Literal('cart.update'), Type.Literal('booking.update'), Type.Literal('account.update'), Type.Literal('payment.initialize')]),
  expectedVersion: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }), payload: RuntimeJsonSchema,
  issuedAt: Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$' }),
}, { additionalProperties: false })
export type SiteApplicationOperation = Static<typeof SiteApplicationOperationSchema>
export const SiteApplicationMutationCommandSchema = Type.Object({ context: SiteApplicationContextSchema, operation: SiteApplicationOperationSchema }, { additionalProperties: false })
export type SiteApplicationMutationCommand = Static<typeof SiteApplicationMutationCommandSchema>
export const SiteApplicationMutationResponseSchema = Type.Object({ accepted: Type.Literal(true), duplicate: Type.Boolean(), mutationId: Id, snapshot: SiteApplicationSnapshotSchema }, { additionalProperties: false })
export type SiteApplicationMutationResponse = Static<typeof SiteApplicationMutationResponseSchema>

export const ResolveResponseSchema = Type.Object({
  schemaVersion: Type.Literal(1), contractVersion: Type.Literal('1.0.0'),
  cacheIdentity: CacheIdentitySchema, sourceSnapshotHashSha256: Hash,
  application: SiteApplicationContextSchema, delivery: SiteRuntimeDeliverySchema,
  routeArtifact: RuntimeRouteArtifactSchema,
}, { additionalProperties: false })
export type ResolveResponse = Static<typeof ResolveResponseSchema>

export function parseContract<T extends TSchema>(schema: T, value: unknown, label: string): Readonly<Static<T>> {
  if (!Value.Check(schema, value)) {
    const first = Value.Errors(schema, value).First()
    throw new SiteRuntimeClientError('invalid-response', `${label} failed strict TypeBox validation${first ? ` at ${first.path || '/'}: ${first.message}` : ''}.`)
  }
  return deepFreeze(structuredClone(value) as Static<T>)
}

export class SiteRuntimeClientError extends Error {
  readonly code: 'invalid-request' | 'direct-origin' | 'authority-unavailable' | 'invalid-response' | 'runtime-conflict'
  constructor(code: 'invalid-request' | 'direct-origin' | 'authority-unavailable' | 'invalid-response' | 'runtime-conflict', message: string) {
    super(message)
    this.code = code
    this.name = 'SiteRuntimeClientError'

  }
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

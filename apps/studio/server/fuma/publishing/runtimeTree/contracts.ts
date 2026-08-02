import { Type, type Static, type TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { createHash } from 'node:crypto'

const IdSchema = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const NamespaceSchema = Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-z0-9]+(?:[.-][a-z0-9]+)*$' })
const HashSchema = Type.String({ pattern: '^[a-f0-9]{64}$' })
const IntegritySchema = Type.String({ pattern: '^sha256-[A-Za-z0-9+/]{43}=$' })
const ExactVersionSchema = Type.String({ pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$' })
const RouteSchema = Type.String({ minLength: 1, maxLength: 2_048, pattern: '^/(?:[A-Za-z0-9._~-]+(?:/[A-Za-z0-9._~-]+)*)?$' })
const LogicalPathSchema = Type.String({ minLength: 2, maxLength: 2_048, pattern: '^/[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$' })
const CssNameSchema = Type.String({ minLength: 1, maxLength: 128, pattern: '^--?[A-Za-z_][A-Za-z0-9_-]*$' })

export const RuntimeCapabilitySchema = Type.Union([
  Type.Literal('content.public.read'),
  Type.Literal('media.public.read'),
  Type.Literal('public-data.read'),
  Type.Literal('interaction.local-state'),
  Type.Literal('browser.events'),
  Type.Literal('browser.animation'),
])
export type RuntimeCapability = Static<typeof RuntimeCapabilitySchema>

const RuntimeCapabilitiesSchema = Type.Array(RuntimeCapabilitySchema, { maxItems: 16, uniqueItems: true })

export const RuntimeJsonValueSchema = Type.Recursive((Self) => Type.Union([
  Type.Null(),
  Type.Boolean(),
  Type.Number(),
  Type.String({ maxLength: 1_000_000 }),
  Type.Array(Self, { maxItems: 100_000 }),
  Type.Record(Type.String({ minLength: 1, maxLength: 255 }), Self),
]))
export type RuntimeJsonValue = Static<typeof RuntimeJsonValueSchema>

export const RuntimeComponentReferenceSchema = Type.Object({
  namespace: NamespaceSchema,
  componentId: NamespaceSchema,
  exactVersion: ExactVersionSchema,
}, { additionalProperties: false })
export type RuntimeComponentReference = Static<typeof RuntimeComponentReferenceSchema>

export const RuntimeStyleDeclarationSchema = Type.Object({
  property: Type.String({ minLength: 1, maxLength: 128, pattern: '^--?[A-Za-z_][A-Za-z0-9_-]*$|^[a-z][a-z0-9-]*$' }),
  value: Type.String({ maxLength: 4_096 }),
}, { additionalProperties: false })
export type RuntimeStyleDeclaration = Static<typeof RuntimeStyleDeclarationSchema>

export const RuntimeNodeSchema = Type.Recursive((Self) => Type.Object({
  nodeId: IdSchema,
  component: RuntimeComponentReferenceSchema,
  props: RuntimeJsonValueSchema,
  classes: Type.Array(Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z_][A-Za-z0-9_-]*$' }), { maxItems: 1_000, uniqueItems: true }),
  styles: Type.Array(RuntimeStyleDeclarationSchema, { maxItems: 1_000 }),
  requiredCapabilities: RuntimeCapabilitiesSchema,
  bindings: Type.Array(Type.Object({
    prop: Type.String({ minLength: 1, maxLength: 128 }),
    publicDataKey: IdSchema,
  }, { additionalProperties: false }), { maxItems: 1_000 }),
  slots: Type.Array(Type.Object({
    name: Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-z][A-Za-z0-9_-]*$' }),
    children: Type.Array(Self, { maxItems: 10_000 }),
  }, { additionalProperties: false }), { maxItems: 128 }),
}, { additionalProperties: false }))

export const RuntimeDeclarativeParameterSchema = Type.Object({
  id: IdSchema,
  name: Type.String({ minLength: 1, maxLength: 255 }),
  type: Type.Union([
    Type.Literal('string'), Type.Literal('number'), Type.Literal('boolean'), Type.Literal('url'),
    Type.Literal('enum'), Type.Literal('color'), Type.Literal('image'), Type.Literal('richText'), Type.Literal('slot'),
  ]),
  defaultValue: RuntimeJsonValueSchema,
  required: Type.Boolean(),
  enumOptions: Type.Optional(Type.Array(Type.String({ maxLength: 1_000 }), { maxItems: 1_000, uniqueItems: true })),
}, { additionalProperties: false })
export type RuntimeDeclarativeParameter = Static<typeof RuntimeDeclarativeParameterSchema>
export type RuntimeNode = Static<typeof RuntimeNodeSchema>

export const RuntimeComponentRegistryEntrySchema = Type.Object({
  reference: RuntimeComponentReferenceSchema,
  source: Type.Union([
    Type.Object({
      kind: Type.Literal('official'),
      publisher: Type.Literal('fuma'),
      ownerKey: Type.Null(),
      siteId: Type.Null(),
      origin: Type.Literal('runtime-source'),
    }, { additionalProperties: false }),
    Type.Object({
      kind: Type.Literal('owner-private'),
      publisher: Type.Literal('site-owner'),
      ownerKey: IdSchema,
      siteId: IdSchema,
      origin: Type.Union([
        Type.Literal('site-created'),
        Type.Literal('visual-designer'),
        Type.Literal('ai-designer'),
        Type.Literal('source-import'),
        Type.Literal('team-pack'),
        Type.Literal('reviewed-marketplace'),
      ]),
    }, { additionalProperties: false }),
  ]),
  execution: Type.Union([
    Type.Literal('official-server'),
    Type.Literal('official-client'),
    Type.Literal('private-declarative'),
    Type.Literal('restricted-client'),
  ]),
  trust: Type.Union([
    Type.Object({
      tier: Type.Literal('official'),
      reviewState: Type.Literal('compiled-into-runtime'),
      ownerConfirmed: Type.Literal(true),
      validation: Type.Object({
        typecheck: Type.Literal(true),
        build: Type.Literal(true),
        staticUtilities: Type.Literal(true),
        accessibility: Type.Literal(true),
        security: Type.Literal(true),
        csp: Type.Literal(true),
        bundleBudget: Type.Literal(true),
      }, { additionalProperties: false }),
    }, { additionalProperties: false }),
    Type.Object({
      tier: Type.Literal('owner-private-declarative'),
      reviewState: Type.Literal('owner-private'),
      ownerConfirmed: Type.Literal(true),
      validation: Type.Object({
        schema: Type.Literal(true),
        references: Type.Literal(true),
        capabilities: Type.Literal(true),
        noExecutableSource: Type.Literal(true),
      }, { additionalProperties: false }),
    }, { additionalProperties: false }),
    Type.Object({
      tier: Type.Literal('owner-private-restricted-client'),
      reviewState: Type.Literal('validated-and-owner-confirmed'),
      ownerConfirmed: Type.Literal(true),
      validation: Type.Object({
        typecheck: Type.Literal(true),
        build: Type.Literal(true),
        staticUtilities: Type.Literal(true),
        accessibility: Type.Literal(true),
        security: Type.Literal(true),
        csp: Type.Literal(true),
        bundleBudget: Type.Literal(true),
        noServerCode: Type.Literal(true),
        noSecrets: Type.Literal(true),
        noNetwork: Type.Literal(true),
        noPaymentAuthority: Type.Literal(true),
      }, { additionalProperties: false }),
    }, { additionalProperties: false }),
  ]),
  propsSchemaHashSha256: HashSchema,
  slotsSchemaHashSha256: HashSchema,
  sourceHashSha256: HashSchema,
  capabilities: RuntimeCapabilitiesSchema,
  artifactPaths: Type.Array(LogicalPathSchema, { maxItems: 64, uniqueItems: true }),
  parameters: Type.Array(RuntimeDeclarativeParameterSchema, { maxItems: 1_000 }),
  definition: Type.Union([RuntimeNodeSchema, Type.Null()]),
  dynamicTenantServerImport: Type.Literal(false),
  persistedExecutableJsx: Type.Literal(false),
}, { additionalProperties: false })
export type RuntimeComponentRegistryEntry = Static<typeof RuntimeComponentRegistryEntrySchema>

export const RuntimeArtifactRoleSchema = Type.Union([
  Type.Literal('semantic-html'),
  Type.Literal('semantic-css'),
  Type.Literal('runtime-route'),
  Type.Literal('client-bundle'),
  Type.Literal('component-css'),
  Type.Literal('source-map'),
  Type.Literal('media'),
  Type.Literal('public-data'),
])
export type RuntimeArtifactRole = Static<typeof RuntimeArtifactRoleSchema>

export const RuntimeArtifactMimeSchema = Type.Union([
  Type.Literal('text/html'),
  Type.Literal('text/css'),
  Type.Literal('text/javascript'),
  Type.Literal('application/javascript'),
  Type.Literal('application/json'),
  Type.Literal('application/vnd.fuma.runtime-route+json'),
  Type.Literal('image/avif'),
  Type.Literal('image/jpeg'),
  Type.Literal('image/png'),
  Type.Literal('image/webp'),
  Type.Literal('image/svg+xml'),
  Type.Literal('font/woff2'),
])
export type RuntimeArtifactMime = Static<typeof RuntimeArtifactMimeSchema>

export const RuntimeArtifactReferenceSchema = Type.Object({
  logicalPath: LogicalPathSchema,
  role: RuntimeArtifactRoleSchema,
  mimeType: RuntimeArtifactMimeSchema,
  contentHashSha256: HashSchema,
  integritySha256: IntegritySchema,
  sizeBytes: Type.Integer({ minimum: 0, maximum: 25 * 1024 * 1024 }),
  references: Type.Array(LogicalPathSchema, { maxItems: 10_000, uniqueItems: true }),
  component: Type.Union([RuntimeComponentReferenceSchema, Type.Null()]),
  declaredCapabilities: RuntimeCapabilitiesSchema,
}, { additionalProperties: false })
export type RuntimeArtifactReference = Static<typeof RuntimeArtifactReferenceSchema>

export const RuntimeRouteManifestSchema = Type.Object({
  route: RouteSchema,
  pageId: IdSchema,
  artifactPath: LogicalPathSchema,
  semanticHtmlPath: LogicalPathSchema,
  layoutIds: Type.Array(IdSchema, { maxItems: 64, uniqueItems: true }),
  styleArtifactPaths: Type.Array(LogicalPathSchema, { maxItems: 64, uniqueItems: true }),
  publicDataKeys: Type.Array(IdSchema, { maxItems: 1_000, uniqueItems: true }),
}, { additionalProperties: false })
export type RuntimeRouteManifest = Static<typeof RuntimeRouteManifestSchema>

export const RuntimePageSchema = Type.Object({
  pageId: IdSchema,
  title: Type.String({ minLength: 1, maxLength: 512 }),
  root: RuntimeNodeSchema,
}, { additionalProperties: false })
export type RuntimePage = Static<typeof RuntimePageSchema>

export const RuntimeLayoutSchema = Type.Object({
  layoutId: IdSchema,
  exactVersion: ExactVersionSchema,
  root: RuntimeNodeSchema,
}, { additionalProperties: false })
export type RuntimeLayout = Static<typeof RuntimeLayoutSchema>

export const RuntimeVisualComponentSchema = Type.Object({
  visualComponentId: IdSchema,
  component: RuntimeComponentReferenceSchema,
  root: RuntimeNodeSchema,
}, { additionalProperties: false })
export type RuntimeVisualComponent = Static<typeof RuntimeVisualComponentSchema>

export const RuntimeStyleManifestSchema = Type.Object({
  tokens: Type.Array(Type.Object({
    name: CssNameSchema,
    value: Type.String({ minLength: 1, maxLength: 4_096 }),
  }, { additionalProperties: false }), { maxItems: 10_000 }),
  breakpoints: Type.Array(Type.Object({
    id: IdSchema,
    minWidthPx: Type.Integer({ minimum: 0, maximum: 100_000 }),
  }, { additionalProperties: false }), { maxItems: 64 }),
  rules: Type.Array(Type.Object({
    ruleId: IdSchema,
    selector: Type.String({ minLength: 1, maxLength: 2_048 }),
    declarations: Type.Array(RuntimeStyleDeclarationSchema, { maxItems: 1_000 }),
  }, { additionalProperties: false }), { maxItems: 100_000 }),
  cssArtifactPaths: Type.Array(LogicalPathSchema, { maxItems: 1_000, uniqueItems: true }),
}, { additionalProperties: false })
export type RuntimeStyleManifest = Static<typeof RuntimeStyleManifestSchema>

export const RuntimeMediaSchema = Type.Object({
  mediaId: IdSchema,
  artifactPath: LogicalPathSchema,
  alt: Type.String({ maxLength: 2_048 }),
}, { additionalProperties: false })
export type RuntimeMedia = Static<typeof RuntimeMediaSchema>

export const RuntimePublicDataSchema = Type.Object({
  key: IdSchema,
  value: RuntimeJsonValueSchema,
}, { additionalProperties: false })
export type RuntimePublicData = Static<typeof RuntimePublicDataSchema>

const RuntimeReleaseIdentityProperties = {
  platformId: IdSchema,
  organizationId: IdSchema,
  workspaceId: IdSchema,
  siteId: IdSchema,
  ownerKey: IdSchema,
  ownerGeneration: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  releaseId: IdSchema,
  sourceSnapshotId: IdSchema,
  sourceSnapshotHashSha256: HashSchema,
} as const

const RuntimeReleaseBodyProperties = {
  schemaVersion: Type.Literal(1),
  contractVersion: Type.Literal('1.0.0'),
  ...RuntimeReleaseIdentityProperties,
  componentRegistryVersion: ExactVersionSchema,
  routes: Type.Array(RuntimeRouteManifestSchema, { minItems: 1, maxItems: 100_000 }),
  pages: Type.Array(RuntimePageSchema, { minItems: 1, maxItems: 100_000 }),
  layouts: Type.Array(RuntimeLayoutSchema, { maxItems: 10_000 }),
  visualComponents: Type.Array(RuntimeVisualComponentSchema, { maxItems: 100_000 }),
  components: Type.Array(RuntimeComponentRegistryEntrySchema, { minItems: 1, maxItems: 100_000 }),
  styles: RuntimeStyleManifestSchema,
  media: Type.Array(RuntimeMediaSchema, { maxItems: 100_000 }),
  publicData: Type.Array(RuntimePublicDataSchema, { maxItems: 100_000 }),
  artifacts: Type.Array(RuntimeArtifactReferenceSchema, { minItems: 1, maxItems: 100_000 }),
  compatibility: Type.Object({
    semanticHtmlCss: Type.Literal('coexists'),
    legacyReleaseReadable: Type.Literal(true),
    runtimeQueriesDraftState: Type.Literal(false),
    runtimeQueriesPlatformTables: Type.Literal(false),
    tenantServerComponents: Type.Literal('forbidden'),
  }, { additionalProperties: false }),
} as const

export const RuntimeReleaseDraftSchema = Type.Object({
  ...RuntimeReleaseBodyProperties,
  artifacts: Type.Optional(Type.Never()),
}, { additionalProperties: false })
export type RuntimeReleaseDraft = Static<typeof RuntimeReleaseDraftSchema>

export const RuntimeReleaseSnapshotSchema = Type.Object({
  ...RuntimeReleaseBodyProperties,
  runtimeTreeHashSha256: HashSchema,
}, { additionalProperties: false })
export type RuntimeReleaseSnapshot = Static<typeof RuntimeReleaseSnapshotSchema>

export const RuntimeInlineStylesheetSchema = Type.Object({
  logicalPath: LogicalPathSchema,
  contentHashSha256: HashSchema,
  cssText: Type.String({ maxLength: 10 * 1024 * 1024 }),
}, { additionalProperties: false })
export type RuntimeInlineStylesheet = Static<typeof RuntimeInlineStylesheetSchema>

export const RuntimeRouteArtifactSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  contractVersion: Type.Literal('1.0.0'),
  ...RuntimeReleaseIdentityProperties,
  componentRegistryVersion: ExactVersionSchema,
  route: RuntimeRouteManifestSchema,
  page: RuntimePageSchema,
  layouts: Type.Array(RuntimeLayoutSchema, { maxItems: 64 }),
  components: Type.Array(RuntimeComponentRegistryEntrySchema, { minItems: 1, maxItems: 100_000 }),
  styles: RuntimeStyleManifestSchema,
  stylesheets: Type.Array(RuntimeInlineStylesheetSchema, { maxItems: 1_000 }),
  publicData: Type.Array(RuntimePublicDataSchema, { maxItems: 1_000 }),
  artifactReferences: Type.Array(RuntimeArtifactReferenceSchema, { minItems: 1, maxItems: 10_000 }),
  routeHashSha256: HashSchema,
}, { additionalProperties: false })
export type RuntimeRouteArtifact = Static<typeof RuntimeRouteArtifactSchema>

export const RuntimeArtifactPayloadSchema = Type.Object({
  ...RuntimeReleaseIdentityProperties,
  logicalPath: LogicalPathSchema,
  role: RuntimeArtifactRoleSchema,
  mimeType: RuntimeArtifactMimeSchema,
  bytes: Type.Uint8Array({ maxByteLength: 25 * 1024 * 1024 }),
  references: Type.Array(LogicalPathSchema, { maxItems: 10_000, uniqueItems: true }),
  component: Type.Union([RuntimeComponentReferenceSchema, Type.Null()]),
  declaredCapabilities: RuntimeCapabilitiesSchema,
}, { additionalProperties: false })
export type RuntimeArtifactPayload = Static<typeof RuntimeArtifactPayloadSchema>

export type RuntimeReleaseContractErrorCode =
  | 'invalid-contract'
  | 'identity-mismatch'
  | 'duplicate-identity'
  | 'noncanonical-order'
  | 'missing-reference'
  | 'hash-mismatch'
  | 'version-mismatch'
  | 'capability-mismatch'
  | 'component-trust'
  | 'unsafe-artifact'
  | 'persisted-executable-source'

export class RuntimeReleaseContractError extends Error {
  readonly code: RuntimeReleaseContractErrorCode

  constructor(code: RuntimeReleaseContractErrorCode, message: string) {
    super(message)
    this.name = 'RuntimeReleaseContractError'
    this.code = code
  }
}

export function parseRuntimeContract<T extends TSchema>(schema: T, value: unknown, label: string): Static<T> {
  if (!Value.Check(schema, value)) {
    const detail = Value.Errors(schema, value).First()
    throw new RuntimeReleaseContractError('invalid-contract', `${label} failed its strict TypeBox contract${detail ? ` at ${detail.path || '/'}: ${detail.message}` : ''}.`)
  }
  return structuredClone(value) as Static<T>
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function sha256Integrity(hashSha256: string): string {
  return `sha256-${Buffer.from(hashSha256, 'hex').toString('base64')}`
}

export function componentKey(reference: RuntimeComponentReference): string {
  return `${reference.namespace}:${reference.componentId}@${reference.exactVersion}`
}

export const RUNTIME_SNAPSHOT_MIME = 'application/vnd.fuma.runtime+json' as const
export const RUNTIME_ROUTE_MIME = 'application/vnd.fuma.runtime-route+json' as const
export const RUNTIME_SNAPSHOT_PATH = '/runtime/snapshot.json' as const

export type RuntimeReleaseIdentity = Readonly<{
  platformId: string
  organizationId: string
  workspaceId: string
  siteId: string
  ownerKey: string
  ownerGeneration: number
  releaseId: string
  sourceSnapshotId: string
  sourceSnapshotHashSha256: string
}>

export function runtimeIdentity(value: Pick<RuntimeReleaseSnapshot, keyof typeof RuntimeReleaseIdentityProperties>): RuntimeReleaseIdentity {
  return {
    platformId: value.platformId,
    organizationId: value.organizationId,
    workspaceId: value.workspaceId,
    siteId: value.siteId,
    ownerKey: value.ownerKey,
    ownerGeneration: value.ownerGeneration,
    releaseId: value.releaseId,
    sourceSnapshotId: value.sourceSnapshotId,
    sourceSnapshotHashSha256: value.sourceSnapshotHashSha256,
  }
}

export const FORBIDDEN_PERSISTED_RUNTIME_KEYS = new Set([
  'jsx', 'tsx', 'componentSource', 'serverComponentSource', 'executableSource',
  'serverModule', 'modulePath', 'dynamicImport', 'tailwindUtilities', 'tailwindSource',
])

export function assertSafeRuntimeJson(value: unknown, path = 'value', seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return
    throw new RuntimeReleaseContractError('invalid-contract', `${path} contains a non-finite number.`)
  }
  if (!value || typeof value !== 'object' || seen.has(value)) {
    throw new RuntimeReleaseContractError('invalid-contract', `${path} is not an acyclic JSON value.`)
  }
  seen.add(value)
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeRuntimeJson(item, `${path}[${index}]`, seen))
    seen.delete(value)
    return
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new RuntimeReleaseContractError('invalid-contract', `${path} contains a non-JSON object.`)
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_PERSISTED_RUNTIME_KEYS.has(key)) {
      throw new RuntimeReleaseContractError('persisted-executable-source', `${path}.${key} is forbidden in canonical runtime data.`)
    }
    assertSafeRuntimeJson(nested, `${path}.${key}`, seen)
  }
  seen.delete(value)
}

import { Type, type Static, type TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { createHash } from 'node:crypto'

const Strict = { additionalProperties: false } as const
const IdSchema = Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-z0-9][a-z0-9-]*$' })
const NamespaceSchema = Type.String({ minLength: 3, maxLength: 128, pattern: '^[a-z0-9]+(?:[.-][a-z0-9]+)+$' })
const ExactVersionSchema = Type.String({ pattern: '^(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$' })
const HashSchema = Type.String({ pattern: '^[a-f0-9]{64}$' })
const TimestampSchema = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$' })
const PermissionIdSchema = Type.String({ minLength: 1, maxLength: 160, pattern: '^[a-z0-9]+(?:[.:_-][a-z0-9]+)*$' })

export const ComponentPackSourceSchema = Type.Union([
  Type.Literal('official-fuma'),
  Type.Literal('private-site-created'),
  Type.Literal('ai-created'),
  Type.Literal('designer-created'),
  Type.Literal('source-imported'),
  Type.Literal('team-pack'),
  Type.Literal('reviewed-marketplace'),
])
export type ComponentPackSource = Static<typeof ComponentPackSourceSchema>

export const ComponentTrustTierSchema = Type.Union([
  Type.Literal('official'),
  Type.Literal('private-declarative'),
  Type.Literal('restricted-client'),
  Type.Literal('reviewed-distributable'),
  Type.Literal('trusted-privileged'),
])
export type ComponentTrustTier = Static<typeof ComponentTrustTierSchema>

export const TenantOwnerScopeSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('site'),
    organizationId: IdSchema,
    workspaceId: IdSchema,
    siteId: IdSchema,
    ownerKey: IdSchema,
    ownerGeneration: Type.Integer({ minimum: 1 }),
  }, Strict),
  Type.Object({

    kind: Type.Literal('team'),
    organizationId: IdSchema,
    workspaceId: IdSchema,
    ownerKey: IdSchema,
    ownerGeneration: Type.Integer({ minimum: 1 }),
  }, Strict),
  Type.Object({ kind: Type.Literal('platform'), platformId: IdSchema }, Strict),
])
export type TenantOwnerScope = Static<typeof TenantOwnerScopeSchema>

export const ComponentCapabilitySchema = Type.Union([
  Type.Literal('declarative.composition'),
  Type.Literal('declarative.loops'),
  Type.Literal('declarative.conditions'),
  Type.Literal('declarative.bindings'),
  Type.Literal('declarative.styles'),
  Type.Literal('declarative.tokens'),
  Type.Literal('declarative.responsive'),
  Type.Literal('declarative.animations'),
  Type.Literal('declarative.interactions'),
  Type.Literal('client.browser'),
  Type.Literal('client.typed-bun-api'),
  Type.Literal('network.direct'),
  Type.Literal('server.execute'),
  Type.Literal('provider.invoke'),
  Type.Literal('payment.transact'),
  Type.Literal('secret.read'),
])
export type ComponentCapability = Static<typeof ComponentCapabilitySchema>

export const ComponentPermissionSchema = Type.Object({
  id: PermissionIdSchema,
  authority: Type.Union([
    Type.Literal('none'),
    Type.Literal('browser'),
    Type.Literal('typed-bun-api'),
    Type.Literal('network'),
    Type.Literal('server'),
    Type.Literal('provider'),
    Type.Literal('payment'),
    Type.Literal('secret'),
  ]),
  purpose: Type.String({ minLength: 1, maxLength: 500 }),
  required: Type.Boolean(),
}, Strict)
export type ComponentPermission = Static<typeof ComponentPermissionSchema>

export const ComponentDependencySchema = Type.Object({
  namespace: NamespaceSchema,
  packId: IdSchema,
  exactVersion: ExactVersionSchema,
  integritySha256: HashSchema,
}, Strict)
export type ComponentDependency = Static<typeof ComponentDependencySchema>

export const RuntimeCompatibilitySchema = Type.Object({
  registryApiVersion: ExactVersionSchema,
  minimumRuntimeVersion: ExactVersionSchema,
  maximumRuntimeVersion: ExactVersionSchema,
  canonicalTreeVersion: Type.Integer({ minimum: 1, maximum: 100 }),
}, Strict)
export type RuntimeCompatibility = Static<typeof RuntimeCompatibilitySchema>

const CommonPropSchema = {
  name: IdSchema,
  label: Type.String({ minLength: 1, maxLength: 160 }),
  required: Type.Boolean(),
  description: Type.Optional(Type.String({ maxLength: 500 })),
}
export const ComponentPropSchema = Type.Union([
  Type.Object({ ...CommonPropSchema, type: Type.Literal('string'), defaultValue: Type.String({ maxLength: 100_000 }) }, Strict),
  Type.Object({ ...CommonPropSchema, type: Type.Literal('number'), defaultValue: Type.Number() }, Strict),
  Type.Object({ ...CommonPropSchema, type: Type.Literal('boolean'), defaultValue: Type.Boolean() }, Strict),
  Type.Object({ ...CommonPropSchema, type: Type.Literal('url'), defaultValue: Type.String({ maxLength: 2_048 }) }, Strict),
  Type.Object({ ...CommonPropSchema, type: Type.Literal('color'), defaultValue: Type.String({ maxLength: 128 }) }, Strict),
  Type.Object({ ...CommonPropSchema, type: Type.Literal('image'), defaultValue: Type.Union([Type.String({ maxLength: 2_048 }), Type.Null()]) }, Strict),
  Type.Object({ ...CommonPropSchema, type: Type.Literal('rich-text'), defaultValue: Type.String({ maxLength: 100_000 }) }, Strict),
  Type.Object({ ...CommonPropSchema, type: Type.Literal('enum'), values: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { minItems: 1, maxItems: 100, uniqueItems: true }), defaultValue: Type.String({ minLength: 1, maxLength: 128 }) }, Strict),
])
export type ComponentProp = Static<typeof ComponentPropSchema>

export const ComponentSlotSchema = Type.Object({
  name: IdSchema,
  label: Type.String({ minLength: 1, maxLength: 160 }),
  required: Type.Boolean(),
  accepts: Type.Array(Type.Union([Type.Literal('text'), Type.Literal('rich-text'), Type.Literal('media'), Type.Literal('component')]), { minItems: 1, uniqueItems: true }),
  maxItems: Type.Integer({ minimum: 1, maximum: 1_000 }),
}, Strict)
export type ComponentSlot = Static<typeof ComponentSlotSchema>

export const ComponentReferenceSchema = Type.Object({
  namespace: NamespaceSchema,
  packId: IdSchema,
  componentId: IdSchema,
  exactVersion: ExactVersionSchema,
}, Strict)
export type ComponentReference = Static<typeof ComponentReferenceSchema>

const StyleValueSchema = Type.Union([Type.String({ maxLength: 8_192 }), Type.Number(), Type.Boolean(), Type.Null()])
export const DeclarativeNodeSchema = Type.Object({
  id: IdSchema,
  kind: Type.Union([
    Type.Literal('element'), Type.Literal('text'), Type.Literal('component'), Type.Literal('slot'),
    Type.Literal('loop'), Type.Literal('condition'), Type.Literal('interaction'),
  ]),
  component: Type.Optional(ComponentReferenceSchema),
  children: Type.Array(IdSchema, { maxItems: 10_000, uniqueItems: true }),
  props: Type.Record(Type.String({ maxLength: 128 }), Type.Unknown()),
  classes: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 1_000, uniqueItems: true }),
  styles: Type.Record(Type.String({ maxLength: 128 }), StyleValueSchema),
  tokens: Type.Record(Type.String({ maxLength: 128 }), Type.String({ maxLength: 512 })),
  responsiveRules: Type.Array(Type.Object({ breakpoint: IdSchema, styles: Type.Record(Type.String({ maxLength: 128 }), StyleValueSchema) }, Strict), { maxItems: 100 }),
  binding: Type.Optional(Type.Object({ source: PermissionIdSchema, path: Type.String({ minLength: 1, maxLength: 500 }) }, Strict)),
  loop: Type.Optional(Type.Object({ source: PermissionIdSchema, itemName: IdSchema, limit: Type.Integer({ minimum: 1, maximum: 1_000 }) }, Strict)),
  condition: Type.Optional(Type.Object({ binding: PermissionIdSchema, operator: Type.Union([Type.Literal('truthy'), Type.Literal('equals'), Type.Literal('not-equals')]), value: Type.Optional(Type.Unknown()) }, Strict)),
  animation: Type.Optional(Type.Object({ preset: IdSchema, durationMs: Type.Integer({ minimum: 0, maximum: 60_000 }), reducedMotion: Type.Literal('disable-or-simplify') }, Strict)),
  interaction: Type.Optional(Type.Object({ trigger: Type.Union([Type.Literal('click'), Type.Literal('submit'), Type.Literal('change'), Type.Literal('hover'), Type.Literal('focus')]), action: Type.Union([Type.Literal('toggle'), Type.Literal('navigate'), Type.Literal('submit-typed-action'), Type.Literal('set-local-state')]), target: Type.String({ minLength: 1, maxLength: 500 }) }, Strict)),
}, Strict)
export type DeclarativeNode = Static<typeof DeclarativeNodeSchema>

export const DeclarativeComponentSchema = Type.Object({
  componentId: IdSchema,
  displayName: Type.String({ minLength: 1, maxLength: 160 }),
  description: Type.String({ maxLength: 2_000 }),
  props: Type.Array(ComponentPropSchema, { maxItems: 200 }),
  slots: Type.Array(ComponentSlotSchema, { maxItems: 100 }),
  variants: Type.Array(Type.Object({ id: IdSchema, label: Type.String({ minLength: 1, maxLength: 160 }), propOverrides: Type.Record(Type.String({ maxLength: 128 }), Type.Unknown()) }, Strict), { maxItems: 100 }),
  tree: Type.Object({ rootNodeId: IdSchema, nodes: Type.Record(IdSchema, DeclarativeNodeSchema) }, Strict),
  propsSchemaHashSha256: HashSchema,
  slotsSchemaHashSha256: HashSchema,
}, Strict)
export type DeclarativeComponent = Static<typeof DeclarativeComponentSchema>

export const RestrictedClientComponentSchema = Type.Object({
  componentId: IdSchema,
  displayName: Type.String({ minLength: 1, maxLength: 160 }),
  props: Type.Array(ComponentPropSchema, { maxItems: 200 }),
  slots: Type.Array(ComponentSlotSchema, { maxItems: 100 }),
  propsSchemaHashSha256: HashSchema,
  slotsSchemaHashSha256: HashSchema,
  compiledJavaScriptSha256: HashSchema,
  compiledCssSha256: HashSchema,
  validationReceiptSha256: HashSchema,
  disclosureSha256: HashSchema,
  ownerConfirmationSha256: HashSchema,
  sandbox: Type.Object({
    isolation: Type.Literal('restricted-client-iframe-or-worker'),
    csp: Type.Literal('deny-by-default'),
    dynamicImports: Type.Literal(false),
    serverExecution: Type.Literal(false),
    directNetwork: Type.Literal(false),
  }, Strict),
}, Strict)
export type RestrictedClientComponent = Static<typeof RestrictedClientComponentSchema>

export const TrustedPrivilegedComponentSchema = Type.Object({
  componentId: IdSchema,
  displayName: Type.String({ minLength: 1, maxLength: 160 }),
  execution: Type.Union([Type.Literal('compiled-official-server'), Type.Literal('reviewed-provider-adapter')]),
  sourceHashSha256: HashSchema,
  buildProvenanceSha256: HashSchema,
  promotionReviewId: Type.String({ minLength: 1, maxLength: 255 }),
  promotedByAuthority: Type.Literal('fuma-review-authority'),
  dynamicTenantImport: Type.Literal(false),
}, Strict)
export type TrustedPrivilegedComponent = Static<typeof TrustedPrivilegedComponentSchema>

export const ComponentPackPayloadSchema = Type.Union([
  Type.Object({ kind: Type.Literal('declarative'), components: Type.Array(DeclarativeComponentSchema, { minItems: 1, maxItems: 1_000 }) }, Strict),
  Type.Object({ kind: Type.Literal('restricted-client'), components: Type.Array(RestrictedClientComponentSchema, { minItems: 1, maxItems: 1_000 }) }, Strict),
  Type.Object({ kind: Type.Literal('trusted-privileged'), components: Type.Array(TrustedPrivilegedComponentSchema, { minItems: 1, maxItems: 1_000 }) }, Strict),
])
export type ComponentPackPayload = Static<typeof ComponentPackPayloadSchema>

export const DistributionSchema = Type.Union([
  Type.Object({ state: Type.Literal('private'), reviewId: Type.Null(), provenanceSha256: Type.Optional(HashSchema), licenseSpdx: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })) }, Strict),
  Type.Object({ state: Type.Literal('reviewed'), reviewId: Type.String({ minLength: 1, maxLength: 255 }), provenanceSha256: HashSchema, licenseSpdx: Type.String({ minLength: 1, maxLength: 100 }) }, Strict),
])
export type Distribution = Static<typeof DistributionSchema>

export const ComponentPackManifestSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  namespace: NamespaceSchema,
  packId: IdSchema,
  exactVersion: ExactVersionSchema,
  displayName: Type.String({ minLength: 1, maxLength: 160 }),
  source: ComponentPackSourceSchema,
  trustTier: ComponentTrustTierSchema,
  owner: TenantOwnerScopeSchema,
  capabilities: Type.Array(ComponentCapabilitySchema, { maxItems: 100, uniqueItems: true }),
  permissions: Type.Array(ComponentPermissionSchema, { maxItems: 100 }),
  dependencies: Type.Array(ComponentDependencySchema, { maxItems: 100 }),
  compatibility: RuntimeCompatibilitySchema,
  distribution: DistributionSchema,
  createdAt: TimestampSchema,
}, Strict)
export type ComponentPackManifest = Static<typeof ComponentPackManifestSchema>

export const ComponentPackReleaseContentSchema = Type.Object({
  manifest: ComponentPackManifestSchema,
  payload: ComponentPackPayloadSchema,
}, Strict)
export type ComponentPackReleaseContent = Static<typeof ComponentPackReleaseContentSchema>

export const ComponentPackReleaseSchema = Type.Object({
  ...ComponentPackReleaseContentSchema.properties,
  immutableArtifact: Type.Object({
    bytesBase64: Type.String({ minLength: 1, maxLength: 20_000_000, pattern: '^[A-Za-z0-9+/]+={0,2}$' }),
    sizeBytes: Type.Integer({ minimum: 1, maximum: 15_000_000 }),
    integritySha256: HashSchema,
  }, Strict),
}, Strict)
export type ComponentPackRelease = Static<typeof ComponentPackReleaseSchema>

export const GeneratedClientDraftSchema = Type.Object({
  draftId: IdSchema,
  owner: TenantOwnerScopeSchema,
  namespace: NamespaceSchema,
  packId: IdSchema,
  componentId: IdSchema,
  targetVersion: ExactVersionSchema,
  source: ComponentPackSourceSchema,
  sourceTsx: Type.String({ minLength: 1, maxLength: 2_000_000 }),
  tailwindCss: Type.String({ maxLength: 1_000_000 }),
  props: Type.Array(ComponentPropSchema, { maxItems: 200 }),
  slots: Type.Array(ComponentSlotSchema, { maxItems: 100 }),
  requestedPermissions: Type.Array(ComponentPermissionSchema, { maxItems: 100 }),
  exactDependencies: Type.Array(Type.Object({ name: Type.String({ minLength: 1, maxLength: 255 }), exactVersion: ExactVersionSchema, integritySha256: HashSchema }, Strict), { maxItems: 100 }),
  state: Type.Literal('isolated-draft'),
}, Strict)
export type GeneratedClientDraft = Static<typeof GeneratedClientDraftSchema>

const CheckSchema = Type.Object({ passed: Type.Boolean(), evidenceSha256: HashSchema, detail: Type.String({ minLength: 1, maxLength: 1_000 }) }, Strict)
export const GeneratedClientValidationSchema = Type.Object({
  draftId: IdSchema,
  sourceHashSha256: HashSchema,
  checks: Type.Object({
    staticSource: CheckSchema,
    typeScript: CheckSchema,
    build: CheckSchema,
    staticTailwind: CheckSchema,
    accessibility: CheckSchema,
    security: CheckSchema,
    csp: CheckSchema,
    network: CheckSchema,
    dependencies: CheckSchema,
    budget: CheckSchema,
  }, Strict),
  budgets: Type.Object({ javascriptBytes: Type.Integer({ minimum: 0, maximum: 250_000 }), cssBytes: Type.Integer({ minimum: 0, maximum: 100_000 }), hydrationNodes: Type.Integer({ minimum: 0, maximum: 2_000 }) }, Strict),
  compiledJavaScriptBase64: Type.String({ minLength: 1, maxLength: 1_000_000 }),
  compiledCssBase64: Type.String({ minLength: 1, maxLength: 400_000 }),
}, Strict)
export type GeneratedClientValidation = Static<typeof GeneratedClientValidationSchema>

export const PermissionDisclosureSchema = Type.Object({
  draftId: IdSchema,
  permissions: Type.Array(ComponentPermissionSchema, { maxItems: 100 }),
  dependencyLockSha256: HashSchema,
  disclosedAt: TimestampSchema,
  disclosedToOwnerKey: IdSchema,
}, Strict)
export type PermissionDisclosure = Static<typeof PermissionDisclosureSchema>

export const OwnerArtifactConfirmationSchema = Type.Object({
  draftId: IdSchema,
  ownerKey: IdSchema,
  ownerGeneration: Type.Integer({ minimum: 1 }),
  sourceHashSha256: HashSchema,
  disclosureSha256: HashSchema,
  confirmedAt: TimestampSchema,
  confirmation: Type.Literal('approve-restricted-client-artifact'),
}, Strict)
export type OwnerArtifactConfirmation = Static<typeof OwnerArtifactConfirmationSchema>

export const PromotionEvidenceSchema = Type.Object({
  reviewId: Type.String({ minLength: 1, maxLength: 255 }),
  authority: Type.Literal('fuma-review-authority'),
  provenanceSha256: HashSchema,
  licenseSpdx: Type.String({ minLength: 1, maxLength: 100 }),
  dependencyReviewSha256: HashSchema,
  securityReviewSha256: HashSchema,
  accessibilityReviewSha256: HashSchema,
  compatibilityReviewSha256: HashSchema,
  signingAuthoritySeam: Type.Literal('FUMA-068'),
  artifactAuthoritySeam: Type.Literal('FUMA-067'),
}, Strict)
export type PromotionEvidence = Static<typeof PromotionEvidenceSchema>

export class ComponentPackContractError extends Error {
  override readonly name = 'ComponentPackContractError'
  readonly code: 'invalid-contract' | 'integrity-mismatch' | 'invalid-tree' | 'invalid-trust' | 'invalid-dependency'
  constructor(code: 'invalid-contract' | 'integrity-mismatch' | 'invalid-tree' | 'invalid-trust' | 'invalid-dependency', message: string) {
    super(message)
    this.code = code
  }
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(',')}}`
}

export function hashContract(value: unknown): string { return sha256(canonicalJson(value)) }

export function parseContract<T extends TSchema>(schema: T, value: unknown, label: string): Static<T> {
  if (!Value.Check(schema, value)) {
    const issue = Value.Errors(schema, value).First()
    throw new ComponentPackContractError('invalid-contract', `${label} failed its TypeBox contract${issue ? ` at ${issue.path || '/'}: ${issue.message}` : ''}.`)
  }
  return structuredClone(value) as Static<T>
}


const FORBIDDEN_CANONICAL_EXECUTABLE_KEYS = new Set([
  'jsx', 'tsx', 'sourceTsx', 'componentSource', 'serverComponentSource', 'serverComponentPath',
  'dynamicImport', 'tailwindUtilities', 'tailwindCompileInput',
])

function forbiddenCanonicalKey(value: unknown, seen = new Set<object>()): string | undefined {
  if (!value || typeof value !== 'object' || seen.has(value)) return undefined
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) { const found = forbiddenCanonicalKey(item, seen); if (found) return found }
    return undefined
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_CANONICAL_EXECUTABLE_KEYS.has(key)) return key
    const found = forbiddenCanonicalKey(nested, seen)
    if (found) return found
  }
  return undefined
}
function validateUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new ComponentPackContractError('invalid-contract', `${label} must be unique.`)
}

function validateDeclarativeComponent(component: DeclarativeComponent, release: ComponentPackReleaseContent): void {
  validateUnique(component.props.map((item) => item.name), `${component.componentId} props`)
  validateUnique(component.slots.map((item) => item.name), `${component.componentId} slots`)
  validateUnique(component.variants.map((item) => item.id), `${component.componentId} variants`)
  if (component.propsSchemaHashSha256 !== hashContract(component.props) || component.slotsSchemaHashSha256 !== hashContract(component.slots)) {
    throw new ComponentPackContractError('integrity-mismatch', `${component.componentId} schema hashes do not match its typed props/slots.`)
  }
  const nodes = component.tree.nodes
  if (!nodes[component.tree.rootNodeId]) throw new ComponentPackContractError('invalid-tree', `${component.componentId} root node is missing.`)
  for (const [key, node] of Object.entries(nodes)) {
    if (key !== node.id) throw new ComponentPackContractError('invalid-tree', `${component.componentId} node key/id drift.`)
    const forbiddenKey = forbiddenCanonicalKey(node.props)
    if (forbiddenKey) throw new ComponentPackContractError('invalid-tree', `${component.componentId} canonical props contain forbidden executable field ${forbiddenKey}.`)
    for (const child of node.children) if (!nodes[child]) throw new ComponentPackContractError('invalid-tree', `${component.componentId} references missing child ${child}.`)
    if (node.component?.namespace === release.manifest.namespace && node.component.packId === release.manifest.packId && node.component.componentId === component.componentId) {
      throw new ComponentPackContractError('invalid-tree', `${component.componentId} cannot reference itself.`)
    }
  }
  const visiting = new Set<string>(); const visited = new Set<string>()
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new ComponentPackContractError('invalid-tree', `${component.componentId} contains a node cycle.`)
    if (visited.has(id)) return
    visiting.add(id); for (const child of nodes[id]!.children) visit(child); visiting.delete(id); visited.add(id)
  }
  visit(component.tree.rootNodeId)
  if (visited.size !== Object.keys(nodes).length) throw new ComponentPackContractError('invalid-tree', `${component.componentId} contains unreachable nodes.`)
}

function validateTrust(content: ComponentPackReleaseContent): void {
  const { manifest, payload } = content
  const privilegedAuthorities = new Set(['network', 'server', 'provider', 'payment', 'secret'])
  const privilegedCapabilities = new Set(['network.direct', 'server.execute', 'provider.invoke', 'payment.transact', 'secret.read'])
  const privileged = manifest.permissions.some((permission) => privilegedAuthorities.has(permission.authority))
    || manifest.capabilities.some((capability) => privilegedCapabilities.has(capability))
  if (payload.kind === 'declarative') {
    if (!['private-declarative', 'reviewed-distributable', 'official'].includes(manifest.trustTier) || privileged || manifest.capabilities.some((capability) => !capability.startsWith('declarative.'))) throw new ComponentPackContractError('invalid-trust', 'Declarative packs can use declarative design capabilities but cannot request executable or privileged authority.')
    for (const component of payload.components) validateDeclarativeComponent(component, content)
  } else if (payload.kind === 'restricted-client') {
    if (manifest.trustTier !== 'restricted-client'
      || manifest.permissions.some((permission) => privilegedAuthorities.has(permission.authority))
      || manifest.capabilities.some((capability) => !['client.browser', 'client.typed-bun-api'].includes(capability))) {
      throw new ComponentPackContractError('invalid-trust', 'Restricted clients permit browser and typed Bun API capability only.')
    }
  } else {
    if (manifest.trustTier !== 'trusted-privileged' && manifest.trustTier !== 'official') throw new ComponentPackContractError('invalid-trust', 'Privileged payloads require trusted promotion or official Fuma ownership.')
    if (manifest.trustTier === 'trusted-privileged'
      && (manifest.source !== 'reviewed-marketplace' || manifest.distribution.state !== 'reviewed' || !privileged
        || payload.components.some((component) => component.promotionReviewId !== manifest.distribution.reviewId))) {
      throw new ComponentPackContractError('invalid-trust', 'Trusted privileged packs require reviewed source, explicit privileged capability, and review-bound promotion evidence.')
    }
  }
  if (manifest.trustTier === 'private-declarative' || manifest.trustTier === 'restricted-client') {
    if (manifest.owner.kind === 'platform' || manifest.distribution.state !== 'private' || manifest.source === 'official-fuma' || manifest.source === 'reviewed-marketplace') throw new ComponentPackContractError('invalid-trust', 'Private packs must remain tenant-owned and private.')
  }
  if (manifest.trustTier === 'reviewed-distributable' && (manifest.distribution.state !== 'reviewed' || manifest.source !== 'reviewed-marketplace')) throw new ComponentPackContractError('invalid-trust', 'Distributable packs require a distinct reviewed marketplace promotion.')
  if (manifest.trustTier === 'official' && (manifest.owner.kind !== 'platform' || manifest.source !== 'official-fuma')) throw new ComponentPackContractError('invalid-trust', 'Official packs are platform-owned official Fuma source.')
}

export function validateReleaseContent(value: unknown): ComponentPackReleaseContent {
  const content = parseContract(ComponentPackReleaseContentSchema, value, 'component-pack release content')
  validateUnique(content.manifest.permissions.map((item) => item.id), 'permissions')
  validateUnique(content.manifest.dependencies.map((item) => `${item.namespace}/${item.packId}`), 'dependencies')
  validateUnique(content.payload.components.map((item) => item.componentId), 'components')
  if (content.manifest.dependencies.some((item) => item.namespace === content.manifest.namespace && item.packId === content.manifest.packId)) throw new ComponentPackContractError('invalid-dependency', 'A pack cannot depend on itself.')
  validateTrust(content)
  return content
}

export function sealComponentPackRelease(value: unknown): Readonly<ComponentPackRelease> {
  const content = validateReleaseContent(value)
  const bytes = Buffer.from(canonicalJson(content), 'utf8')
  return deepFreeze({ ...content, immutableArtifact: { bytesBase64: bytes.toString('base64'), sizeBytes: bytes.byteLength, integritySha256: sha256(bytes) } })
}

export function validateComponentPackRelease(value: unknown): Readonly<ComponentPackRelease> {
  const release = parseContract(ComponentPackReleaseSchema, value, 'component-pack release')
  validateReleaseContent({ manifest: release.manifest, payload: release.payload })
  const bytes = Buffer.from(release.immutableArtifact.bytesBase64, 'base64')
  const canonical = Buffer.from(canonicalJson({ manifest: release.manifest, payload: release.payload }), 'utf8')
  if (!bytes.equals(canonical) || release.immutableArtifact.sizeBytes !== bytes.byteLength || release.immutableArtifact.integritySha256 !== sha256(bytes)) throw new ComponentPackContractError('integrity-mismatch', 'Immutable component-pack bytes or integrity drifted.')
  return deepFreeze(release)
}

export function releaseCoordinate(release: Pick<ComponentPackRelease, 'manifest'>): string {
  return `${release.manifest.namespace}/${release.manifest.packId}@${release.manifest.exactVersion}`
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

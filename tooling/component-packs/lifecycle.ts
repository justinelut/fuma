import { Type, type Static } from '@sinclair/typebox'
import {
  ComponentPackManifestSchema,
  ComponentPackReleaseSchema,
  GeneratedClientDraftSchema,
  GeneratedClientValidationSchema,
  OwnerArtifactConfirmationSchema,
  PermissionDisclosureSchema,
  PromotionEvidenceSchema,
  canonicalJson,
  deepFreeze,
  hashContract,
  parseContract,
  releaseCoordinate,
  sealComponentPackRelease,
  sha256,
  validateComponentPackRelease,
  type ComponentCapability,
  type ComponentDependency,
  type ComponentPackManifest,
  type ComponentPackRelease,
  type ComponentPermission,
  type GeneratedClientDraft,
  type GeneratedClientValidation,
  type OwnerArtifactConfirmation,
  type PermissionDisclosure,
  type RuntimeCompatibility,
  type TenantOwnerScope,
} from './contracts'

const Strict = { additionalProperties: false } as const
const IdSchema = Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-z0-9][a-z0-9-]*$' })
const HashSchema = Type.String({ pattern: '^[a-f0-9]{64}$' })
const ExactVersionSchema = Type.String({ pattern: '^(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$' })

export const SiteActorScopeSchema = Type.Object({
  organizationId: IdSchema,
  workspaceId: IdSchema,
  siteId: IdSchema,
  ownerKey: IdSchema,
  ownerGeneration: Type.Integer({ minimum: 1 }),
}, Strict)
export type SiteActorScope = Static<typeof SiteActorScopeSchema>

export const SourceAuditSchema = Type.Object({
  sourceHashSha256: HashSchema,
  passed: Type.Boolean(),
  findings: Type.Array(Type.Object({
    rule: Type.Union([
      Type.Literal('server-code'), Type.Literal('dynamic-import'), Type.Literal('direct-network'),
      Type.Literal('secret-access'), Type.Literal('sandbox-escape'), Type.Literal('dynamic-tailwind'),
      Type.Literal('undeclared-dependency'), Type.Literal('dangerous-evaluation'),
    ]),
    detail: Type.String({ minLength: 1, maxLength: 500 }),
  }, Strict), { maxItems: 1_000 }),
}, Strict)
export type SourceAudit = Static<typeof SourceAuditSchema>

export type ComponentPackLifecycleErrorCode =
  | 'invalid-source' | 'validation-failed' | 'confirmation-required' | 'permission-drift'
  | 'mutable-release' | 'dependency-missing' | 'dependency-integrity' | 'namespace-owner'
  | 'owner-isolation' | 'incompatible-runtime' | 'not-found' | 'install-blocked'
  | 'unsafe-uninstall' | 'withdrawn' | 'security-revoked' | 'promotion-required'

export class ComponentPackLifecycleError extends Error {
  override readonly name = 'ComponentPackLifecycleError'
  constructor(readonly code: ComponentPackLifecycleErrorCode, message: string) { super(message) }
}

export type RestrictedClientConfirmationInput = Readonly<{
  draft: unknown
  validation: unknown
  disclosure: unknown
  confirmation: unknown
  manifest: Omit<ComponentPackManifest, 'schemaVersion' | 'namespace' | 'packId' | 'exactVersion' | 'source' | 'trustTier' | 'owner' | 'capabilities' | 'permissions' | 'distribution'>
}>

export type ReviewedPromotionInput = Readonly<{
  privateRelease: unknown
  targetVersion: string
  evidence: unknown
  createdAt: string
}>

export type PrivilegedPromotionInput = Readonly<{
  manifest: unknown
  componentId: string
  displayName: string
  execution: 'compiled-official-server' | 'reviewed-provider-adapter'
  sourceHashSha256: string
  buildProvenanceSha256: string
  evidence: unknown
}>

export type UpgradeDiff = Readonly<{
  from: string
  to: string
  capabilityDiff: Readonly<{ added: ComponentCapability[]; removed: ComponentCapability[] }>
  permissionDiff: Readonly<{ added: ComponentPermission[]; removed: ComponentPermission[]; changed: Array<{ before: ComponentPermission; after: ComponentPermission }> }>
  dependencyDiff: Readonly<{ added: ComponentDependency[]; removed: ComponentDependency[]; changed: Array<{ before: ComponentDependency; after: ComponentDependency }> }>
  schemaDiff: Readonly<Array<{ componentId: string; propsChanged: boolean; slotsChanged: boolean; removed: boolean; added: boolean }>>
  compatibilityChanged: boolean
  visualArtifactChanged: boolean
  affectedNodeCount: number
  requiresOwnerConfirmation: boolean
  rollbackCoordinate: string
}>

export type UsageReferences = Readonly<{
  pageNodeIds: readonly string[]
  visualComponentIds: readonly string[]
  templateIds: readonly string[]
  retainedReleaseIds: readonly string[]
}>

export type InstalledPack = Readonly<{
  siteId: string
  coordinate: string
  integritySha256: string
  installedAt: string
  rollbackCoordinates: readonly string[]
}>

export type RetainedRelease = Readonly<{
  releaseId: string
  owner: SiteActorScope
  coordinates: readonly string[]
  pinnedAt: string
}>

type RegistryState = 'available' | 'marketplace-withdrawn' | 'security-revoked'

function versionParts(value: string): [number, number, number] {
  const [core] = value.split('-', 1)
  const [major, minor, patch] = core!.split('.').map(Number)
  return [major!, minor!, patch!]
}
function compareVersions(left: string, right: string): number {
  const a = versionParts(left); const b = versionParts(right)
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}
function compatible(runtime: string, contract: RuntimeCompatibility): boolean {
  return compareVersions(contract.minimumRuntimeVersion, contract.maximumRuntimeVersion) <= 0
    && compareVersions(runtime, contract.minimumRuntimeVersion) >= 0
    && compareVersions(runtime, contract.maximumRuntimeVersion) <= 0
}
function ownerIdentity(owner: TenantOwnerScope): string {
  if (owner.kind === 'platform') return `platform:${owner.platformId}`
  return `${owner.kind}:${owner.organizationId}:${owner.workspaceId}:${owner.ownerKey}:${owner.ownerGeneration}`
}
function exactOwner(owner: TenantOwnerScope, actor: SiteActorScope): boolean {
  if (owner.kind === 'platform') return true
  if (owner.organizationId !== actor.organizationId || owner.workspaceId !== actor.workspaceId || owner.ownerKey !== actor.ownerKey || owner.ownerGeneration !== actor.ownerGeneration) return false
  return owner.kind === 'team' || owner.siteId === actor.siteId
}
function permissionMap(permissions: readonly ComponentPermission[]): Map<string, ComponentPermission> { return new Map(permissions.map((item) => [item.id, item])) }
function dependencyMap(dependencies: readonly ComponentDependency[]): Map<string, ComponentDependency> { return new Map(dependencies.map((item) => [`${item.namespace}/${item.packId}`, item])) }
function sameValue(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right) }
function importedPackages(source: string): Set<string> {
  const packages = new Set<string>()
  for (const match of source.matchAll(/(?:import\s+(?:[^'";]+?\s+from\s+)?|require\s*\()\s*['"]([^'".][^'"]*)['"]/g)) {
    const name = match[1]!
    packages.add(name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]!)
  }
  return packages
}

export function auditGeneratedClientSource(value: unknown): Readonly<SourceAudit> {
  const draft = parseContract(GeneratedClientDraftSchema, value, 'generated client draft')
  if (draft.owner.kind === 'platform') throw new ComponentPackLifecycleError('invalid-source', 'Generated private client drafts require site or team ownership.')
  const findings: SourceAudit['findings'][number][] = []
  const source = `${draft.sourceTsx}\n${draft.tailwindCss}`
  const add = (rule: SourceAudit['findings'][number]['rule'], detail: string): void => { findings.push({ rule, detail }) }
  if (/(?:^|[;\n]\s*)['"]use server['"]|\b(?:getServerSideProps|generateStaticParams)\b|from\s*['"](?:node:|fs|path|child_process|server-only)/m.test(source)) add('server-code', 'Server directives, Node built-ins, and server entrypoints are forbidden in restricted client drafts.')
  if (/\bimport\s*\(/.test(source)) add('dynamic-import', 'Dynamic imports are forbidden; artifacts use an exact static dependency graph.')
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon)\s*\(?/.test(source)) add('direct-network', 'Direct network primitives are forbidden; use disclosed typed Bun API bindings.')
  if (/\b(?:process\.env|import\.meta\.env|Bun\.env|Deno\.env|document\.cookie)\b/.test(source)) add('secret-access', 'Environment, secret, and cookie access are forbidden.')
  if (/\b(?:window\.)?(?:top|parent|opener)\b|postMessage\s*\([^,]+,\s*['"]\*['"]/.test(source)) add('sandbox-escape', 'Parent/opener access and wildcard postMessage are forbidden.')
  if (/\b(?:eval|Function)\s*\(|setTimeout\s*\(\s*['"]|setInterval\s*\(\s*['"]/.test(source)) add('dangerous-evaluation', 'String evaluation and generated functions are forbidden.')
  if (/(?:className|class)\s*=\s*\{?`[^`]*\$\{|(?:className|class)\s*=\s*\{[^}]*\+/.test(source)) add('dynamic-tailwind', 'Tailwind utility strings must be complete and statically detectable.')
  const declared = new Set(draft.exactDependencies.map((item) => item.name))
  for (const dependency of importedPackages(draft.sourceTsx)) if (dependency !== 'react' && dependency !== 'react/jsx-runtime' && !declared.has(dependency)) add('undeclared-dependency', `Imported package ${dependency} is not exact-pinned in the draft dependency lock.`)
  return deepFreeze({ sourceHashSha256: sha256(draft.sourceTsx), passed: findings.length === 0, findings })
}

function assertValidation(draft: GeneratedClientDraft, validation: GeneratedClientValidation): void {
  const audit = auditGeneratedClientSource(draft)
  if (!audit.passed) throw new ComponentPackLifecycleError('invalid-source', audit.findings.map((item) => item.detail).join(' '))
  if (validation.draftId !== draft.draftId || validation.sourceHashSha256 !== sha256(draft.sourceTsx)) throw new ComponentPackLifecycleError('validation-failed', 'Validation receipt is not bound to the exact draft source.')
  const failed = Object.entries(validation.checks).filter(([, check]) => !check.passed).map(([name]) => name)
  if (failed.length > 0) throw new ComponentPackLifecycleError('validation-failed', `Restricted-client checks failed: ${failed.join(', ')}.`)
  const jsBytes = Buffer.from(validation.compiledJavaScriptBase64, 'base64').byteLength
  const cssBytes = Buffer.from(validation.compiledCssBase64, 'base64').byteLength
  if (jsBytes !== validation.budgets.javascriptBytes || cssBytes !== validation.budgets.cssBytes) throw new ComponentPackLifecycleError('validation-failed', 'Compiled artifact bytes do not match the validated bundle budget evidence.')
}

function assertDisclosureAndConfirmation(draft: GeneratedClientDraft, disclosure: PermissionDisclosure, confirmation: OwnerArtifactConfirmation): void {
  if (draft.owner.kind === 'platform') throw new ComponentPackLifecycleError('invalid-source', 'Generated private client drafts require site or team ownership.')
  if (disclosure.draftId !== draft.draftId || disclosure.disclosedToOwnerKey !== draft.owner.ownerKey || !sameValue(disclosure.permissions, draft.requestedPermissions)) throw new ComponentPackLifecycleError('permission-drift', 'Permission disclosure must exactly match the draft and owning actor.')
  const disclosureHash = hashContract(disclosure)
  if (confirmation.draftId !== draft.draftId || confirmation.ownerKey !== draft.owner.ownerKey || confirmation.ownerGeneration !== draft.owner.ownerGeneration || confirmation.sourceHashSha256 !== sha256(draft.sourceTsx) || confirmation.disclosureSha256 !== disclosureHash) throw new ComponentPackLifecycleError('confirmation-required', 'Owner confirmation must bind the exact source, permission disclosure, and owner generation.')
}

export function confirmRestrictedClientArtifact(input: RestrictedClientConfirmationInput): Readonly<ComponentPackRelease> {
  const draft = parseContract(GeneratedClientDraftSchema, input.draft, 'generated client draft')
  const validation = parseContract(GeneratedClientValidationSchema, input.validation, 'generated client validation')
  const disclosure = parseContract(PermissionDisclosureSchema, input.disclosure, 'permission disclosure')
  const confirmation = parseContract(OwnerArtifactConfirmationSchema, input.confirmation, 'owner artifact confirmation')
  assertValidation(draft, validation)
  assertDisclosureAndConfirmation(draft, disclosure, confirmation)
  const manifest = {
    schemaVersion: 1 as const,
    namespace: draft.namespace,
    packId: draft.packId,
    exactVersion: draft.targetVersion,
    source: draft.source,
    trustTier: 'restricted-client' as const,
    owner: draft.owner,
    capabilities: draft.requestedPermissions.some((permission) => permission.authority === 'typed-bun-api') ? ['client.browser' as const, 'client.typed-bun-api' as const] : ['client.browser' as const],
    permissions: draft.requestedPermissions,
    distribution: { state: 'private' as const, reviewId: null },
    ...input.manifest,
  }
  return sealComponentPackRelease({
    manifest,
    payload: {
      kind: 'restricted-client',
      components: [{
        componentId: draft.componentId,
        displayName: input.manifest.displayName,
        props: draft.props,
        slots: draft.slots,
        propsSchemaHashSha256: hashContract(draft.props),
        slotsSchemaHashSha256: hashContract(draft.slots),
        compiledJavaScriptSha256: sha256(Buffer.from(validation.compiledJavaScriptBase64, 'base64')),
        compiledCssSha256: sha256(Buffer.from(validation.compiledCssBase64, 'base64')),
        validationReceiptSha256: hashContract(validation),
        disclosureSha256: hashContract(disclosure),
        ownerConfirmationSha256: hashContract(confirmation),
        sandbox: { isolation: 'restricted-client-iframe-or-worker', csp: 'deny-by-default', dynamicImports: false, serverExecution: false, directNetwork: false },
      }],
    },
  })
}

export function promoteReviewedDistributable(input: ReviewedPromotionInput): Readonly<ComponentPackRelease> {
  const source = validateComponentPackRelease(input.privateRelease)
  const evidence = parseContract(PromotionEvidenceSchema, input.evidence, 'reviewed promotion evidence')
  if (source.payload.kind !== 'declarative' || source.manifest.trustTier !== 'private-declarative') throw new ComponentPackLifecycleError('promotion-required', 'Only a private declarative pack may use the declarative distribution promotion path.')
  return sealComponentPackRelease({
    manifest: {
      ...source.manifest,
      exactVersion: input.targetVersion,
      source: 'reviewed-marketplace',
      trustTier: 'reviewed-distributable',
      distribution: { state: 'reviewed', reviewId: evidence.reviewId, provenanceSha256: evidence.provenanceSha256, licenseSpdx: evidence.licenseSpdx },
      createdAt: input.createdAt,
    },
    payload: source.payload,
  })
}

export function promoteTrustedPrivileged(input: PrivilegedPromotionInput): Readonly<ComponentPackRelease> {
  const manifest = parseContract(ComponentPackManifestSchema, input.manifest, 'privileged manifest')
  const evidence = parseContract(PromotionEvidenceSchema, input.evidence, 'privileged promotion evidence')
  if (manifest.trustTier !== 'trusted-privileged' || manifest.distribution.state !== 'reviewed' || !manifest.permissions.some((permission) => ['server', 'provider', 'network', 'payment', 'secret'].includes(permission.authority))) throw new ComponentPackLifecycleError('promotion-required', 'Privileged execution requires reviewed distribution and explicit privileged permissions.')
  return sealComponentPackRelease({ manifest, payload: { kind: 'trusted-privileged', components: [{ componentId: input.componentId, displayName: input.displayName, execution: input.execution, sourceHashSha256: input.sourceHashSha256, buildProvenanceSha256: input.buildProvenanceSha256, promotionReviewId: evidence.reviewId, promotedByAuthority: 'fuma-review-authority', dynamicTenantImport: false }] } })
}

function diffMap<T>(before: Map<string, T>, after: Map<string, T>): { added: T[]; removed: T[]; changed: Array<{ before: T; after: T }> } {
  const added: T[] = []; const removed: T[] = []; const changed: Array<{ before: T; after: T }> = []
  for (const [key, value] of after) { const previous = before.get(key); if (!previous) added.push(value); else if (!sameValue(previous, value)) changed.push({ before: previous, after: value }) }
  for (const [key, value] of before) if (!after.has(key)) removed.push(value)
  return { added, removed, changed }
}
function componentSchemas(release: ComponentPackRelease): Map<string, { props: string; slots: string }> {
  const result = new Map<string, { props: string; slots: string }>()
  if (release.payload.kind !== 'trusted-privileged') for (const component of release.payload.components) result.set(component.componentId, { props: component.propsSchemaHashSha256, slots: component.slotsSchemaHashSha256 })
  return result
}

export function previewComponentPackUpgrade(fromValue: unknown, toValue: unknown, affectedNodeCount: number): Readonly<UpgradeDiff> {
  const from = validateComponentPackRelease(fromValue); const to = validateComponentPackRelease(toValue)
  if (from.manifest.namespace !== to.manifest.namespace || from.manifest.packId !== to.manifest.packId || compareVersions(to.manifest.exactVersion, from.manifest.exactVersion) <= 0) throw new ComponentPackLifecycleError('install-blocked', 'Upgrade previews require the same pack and a higher exact version.')
  const fromCapabilities = new Set(from.manifest.capabilities); const toCapabilities = new Set(to.manifest.capabilities)
  const capabilityDiff = { added: to.manifest.capabilities.filter((item) => !fromCapabilities.has(item)), removed: from.manifest.capabilities.filter((item) => !toCapabilities.has(item)) }
  const permissionDiff = diffMap(permissionMap(from.manifest.permissions), permissionMap(to.manifest.permissions))
  const dependencyDiff = diffMap(dependencyMap(from.manifest.dependencies), dependencyMap(to.manifest.dependencies))
  const beforeSchemas = componentSchemas(from); const afterSchemas = componentSchemas(to); const ids = new Set([...beforeSchemas.keys(), ...afterSchemas.keys()])
  const schemaDiff = [...ids].map((componentId) => { const before = beforeSchemas.get(componentId); const after = afterSchemas.get(componentId); return { componentId, propsChanged: Boolean(before && after && before.props !== after.props), slotsChanged: Boolean(before && after && before.slots !== after.slots), removed: Boolean(before && !after), added: Boolean(!before && after) } }).filter((item) => item.propsChanged || item.slotsChanged || item.removed || item.added)
  return deepFreeze({
    from: releaseCoordinate(from), to: releaseCoordinate(to), capabilityDiff, permissionDiff, dependencyDiff, schemaDiff,
    compatibilityChanged: !sameValue(from.manifest.compatibility, to.manifest.compatibility),
    visualArtifactChanged: from.immutableArtifact.integritySha256 !== to.immutableArtifact.integritySha256,
    affectedNodeCount,
    requiresOwnerConfirmation: capabilityDiff.added.length > 0 || capabilityDiff.removed.length > 0 || permissionDiff.added.length > 0 || permissionDiff.changed.length > 0 || dependencyDiff.added.length > 0 || dependencyDiff.changed.length > 0 || schemaDiff.length > 0,
    rollbackCoordinate: releaseCoordinate(from),
  })
}

export class OpenComponentPackRegistry {
  readonly persistenceAuthoritySeam = 'FUMA-067' as const
  readonly reviewSigningAuthoritySeam = 'FUMA-068' as const
  readonly editorAiMcpIntegrationSeam = 'FUMA-SITE-008' as const
  private readonly releases = new Map<string, Readonly<ComponentPackRelease>>()
  private readonly namespaceOwners = new Map<string, string>()
  private readonly states = new Map<string, RegistryState>()
  private readonly installs = new Map<string, InstalledPack>()
  private readonly retained = new Map<string, RetainedRelease>()

  constructor(readonly runtimeVersion: string, readonly registryApiVersion: string) {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(runtimeVersion) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(registryApiVersion)) throw new ComponentPackLifecycleError('incompatible-runtime', 'Registry and runtime versions must be exact versions.')
  }

  register(value: unknown): Readonly<ComponentPackRelease> {
    const release = validateComponentPackRelease(value); const coordinate = releaseCoordinate(release); const manifest = release.manifest
    if (manifest.compatibility.registryApiVersion !== this.registryApiVersion || !compatible(this.runtimeVersion, manifest.compatibility)) throw new ComponentPackLifecycleError('incompatible-runtime', `${coordinate} is incompatible with this exact registry/runtime.`)
    const namespaceOwner = ownerIdentity(manifest.owner); const existingOwner = this.namespaceOwners.get(manifest.namespace)
    if (existingOwner && existingOwner !== namespaceOwner) throw new ComponentPackLifecycleError('namespace-owner', `Namespace ${manifest.namespace} belongs to another owner scope.`)
    for (const dependency of manifest.dependencies) {
      const dependencyRelease = this.releases.get(`${dependency.namespace}/${dependency.packId}@${dependency.exactVersion}`)
      if (!dependencyRelease) throw new ComponentPackLifecycleError('dependency-missing', `Exact dependency ${dependency.namespace}/${dependency.packId}@${dependency.exactVersion} is missing.`)
      if (dependencyRelease.immutableArtifact.integritySha256 !== dependency.integritySha256) throw new ComponentPackLifecycleError('dependency-integrity', 'Dependency integrity does not match immutable registry bytes.')
    }
    const existing = this.releases.get(coordinate)
    if (existing && existing.immutableArtifact.integritySha256 !== release.immutableArtifact.integritySha256) throw new ComponentPackLifecycleError('mutable-release', `${coordinate} already exists with different immutable bytes.`)
    if (existing) return existing
    this.namespaceOwners.set(manifest.namespace, namespaceOwner); this.releases.set(coordinate, release); this.states.set(coordinate, 'available')
    return release
  }

  get(coordinate: string): Readonly<ComponentPackRelease> { const release = this.releases.get(coordinate); if (!release) throw new ComponentPackLifecycleError('not-found', `${coordinate} is not registered.`); return release }

  usePrivateImmediately(coordinate: string, actorValue: unknown): Readonly<ComponentPackRelease> {
    const actor = parseContract(SiteActorScopeSchema, actorValue, 'site actor'); const release = this.get(coordinate)
    if (!['private-declarative', 'restricted-client'].includes(release.manifest.trustTier) || !exactOwner(release.manifest.owner, actor)) throw new ComponentPackLifecycleError('owner-isolation', 'Private component use is restricted to its exact owner site/team generation.')
    this.assertPublishable(coordinate); return release
  }

  install(coordinate: string, actorValue: unknown, installedAt: string): InstalledPack {
    const actor = parseContract(SiteActorScopeSchema, actorValue, 'site actor'); const release = this.get(coordinate); const state = this.states.get(coordinate)
    if (state === 'security-revoked') throw new ComponentPackLifecycleError('security-revoked', 'Security-revoked releases cannot be installed.')
    if (state === 'marketplace-withdrawn' && release.manifest.distribution.state === 'reviewed') throw new ComponentPackLifecycleError('withdrawn', 'Withdrawn marketplace releases cannot be newly installed.')
    if (release.manifest.distribution.state === 'private' && !exactOwner(release.manifest.owner, actor)) throw new ComponentPackLifecycleError('owner-isolation', 'Private installs cannot cross owner/site scope.')
    const key = `${actor.siteId}:${release.manifest.namespace}/${release.manifest.packId}`; const previous = this.installs.get(key)
    const installed = deepFreeze({ siteId: actor.siteId, coordinate, integritySha256: release.immutableArtifact.integritySha256, installedAt, rollbackCoordinates: previous ? [...previous.rollbackCoordinates, previous.coordinate] : [] })
    this.installs.set(key, installed); return installed
  }

  previewUpgrade(siteId: string, targetCoordinate: string, affectedNodeCount: number): UpgradeDiff {
    const target = this.get(targetCoordinate); const current = this.installs.get(`${siteId}:${target.manifest.namespace}/${target.manifest.packId}`)
    if (!current) throw new ComponentPackLifecycleError('not-found', 'Pack is not installed for this site.')
    return previewComponentPackUpgrade(this.get(current.coordinate), target, affectedNodeCount)
  }

  upgrade(siteId: string, targetCoordinate: string, ownerConfirmedDiff: boolean, installedAt: string): InstalledPack {
    const target = this.get(targetCoordinate); const key = `${siteId}:${target.manifest.namespace}/${target.manifest.packId}`; const current = this.installs.get(key)
    if (!current) throw new ComponentPackLifecycleError('not-found', 'Pack is not installed for this site.')
    const diff = previewComponentPackUpgrade(this.get(current.coordinate), target, 0)
    if (this.states.get(targetCoordinate) === 'marketplace-withdrawn' && target.manifest.distribution.state === 'reviewed') throw new ComponentPackLifecycleError('withdrawn', 'Withdrawn marketplace releases cannot be upgrade targets.')
    if (diff.requiresOwnerConfirmation && !ownerConfirmedDiff) throw new ComponentPackLifecycleError('confirmation-required', 'Permission, dependency, schema, or compatibility changes require owner confirmation.')
    this.assertPublishable(targetCoordinate)
    const upgraded = deepFreeze({ siteId, coordinate: targetCoordinate, integritySha256: target.immutableArtifact.integritySha256, installedAt, rollbackCoordinates: [...current.rollbackCoordinates, current.coordinate] })
    this.installs.set(key, upgraded); return upgraded
  }

  pinRelease(releaseId: string, actorValue: unknown, coordinates: readonly string[], pinnedAt: string): RetainedRelease {
    const actor = parseContract(SiteActorScopeSchema, actorValue, 'site actor')
    if (this.retained.has(releaseId)) throw new ComponentPackLifecycleError('mutable-release', `Retained release ${releaseId} is immutable.`)
    for (const coordinate of coordinates) { const release = this.get(coordinate); if (release.manifest.owner.kind !== 'platform' && !exactOwner(release.manifest.owner, actor) && release.manifest.distribution.state !== 'reviewed') throw new ComponentPackLifecycleError('owner-isolation', 'A release cannot pin another tenant owner\'s component.'); this.assertPublishable(coordinate) }
    const retained = deepFreeze({ releaseId, owner: actor, coordinates: [...coordinates], pinnedAt }); this.retained.set(releaseId, retained); return retained
  }

  uninstall(siteId: string, namespace: string, packId: string, usage: UsageReferences): void {
    const key = `${siteId}:${namespace}/${packId}`
    if (!this.installs.has(key)) throw new ComponentPackLifecycleError('not-found', 'Pack is not installed for this site.')
    const count = usage.pageNodeIds.length + usage.visualComponentIds.length + usage.templateIds.length + usage.retainedReleaseIds.length
    if (count > 0) throw new ComponentPackLifecycleError('unsafe-uninstall', `Uninstall is blocked by ${count} page/Visual Component/template/retained-release references.`)
    this.installs.delete(key)
  }

  withdrawMarketplace(coordinate: string): void {
    const release = this.get(coordinate)
    if (release.manifest.distribution.state !== 'reviewed') throw new ComponentPackLifecycleError('install-blocked', 'Private releases are not marketplace listings and cannot be withdrawn.')
    this.states.set(coordinate, 'marketplace-withdrawn')
  }

  revokeForSecurity(coordinate: string): void { this.get(coordinate); this.states.set(coordinate, 'security-revoked') }
  assertPublishable(coordinate: string): void { if (this.states.get(coordinate) === 'security-revoked') throw new ComponentPackLifecycleError('security-revoked', 'Critical security revocation blocks new publishing and requires audited remediation/fallback.') }

  resolveRetained(releaseId: string): ReadonlyArray<Readonly<{ release: ComponentPackRelease; marketplaceWithdrawn: boolean; publishingBlocked: boolean }>> {
    const retained = this.retained.get(releaseId); if (!retained) throw new ComponentPackLifecycleError('not-found', `Retained release ${releaseId} is missing.`)
    return deepFreeze(retained.coordinates.map((coordinate) => ({ release: this.get(coordinate), marketplaceWithdrawn: this.states.get(coordinate) === 'marketplace-withdrawn', publishingBlocked: this.states.get(coordinate) === 'security-revoked' })))
  }

  stateOf(coordinate: string): RegistryState { this.get(coordinate); return this.states.get(coordinate)! }
  installedFor(siteId: string, namespace: string, packId: string): InstalledPack | undefined { return this.installs.get(`${siteId}:${namespace}/${packId}`) }
}

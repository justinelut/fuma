import type { ArtifactInstallationAuthority } from '../artifacts'
import type { ArtifactReviewService, MarketplaceArtifact } from '../artifactReviews'
import {
  canonicalJson,
  hashContract,
  releaseCoordinate,
  sealComponentPackRelease,
  sha256,
  validateComponentPackRelease,
  type ComponentPackRelease,
  type GeneratedClientDraft,
} from '../../../../../tooling/component-packs/contracts'
import {
  ComponentCatalogError,
  ComponentCatalogItemSchema,
  ComponentCatalogReleaseSchema,
  ComponentInstallationSchema,
  ComponentSourceDraftRecordSchema,
  ComponentUpgradeReceiptSchema,
  ComponentUsageSchema,
  ConfirmComponentSourceCommandSchema,
  CreateComponentVariantCommandSchema,
  CreateDeclarativeComponentCommandSchema,
  GetComponentCommandSchema,
  InsertComponentCommandSchema,
  InstallComponentCommandSchema,
  ListComponentUsageCommandSchema,
  PreviewComponentCommandSchema,
  SearchComponentsCommandSchema,
  UninstallComponentCommandSchema,
  UpgradeComponentCommandSchema,
  ValidateComponentSourceCommandSchema,
  parseComponentCatalog,
  type ComponentCatalogAction,
  type ComponentCatalogItem,
  type ComponentCatalogScope,
  type ComponentInstallation,
} from './contracts'
import type { ComponentCatalogRepository } from './repository'
import { IsolatedRestrictedClientValidator, type ComponentSourceValidator } from './sourceValidator'

const STARTERS = Object.freeze([
  ['fuma.layout/section@1.0.0', 'Section', 'Semantic responsive section', ['section']],
  ['fuma.layout/container@1.0.0', 'Container', 'Bounded responsive container', ['container']],
  ['fuma.layout/grid@1.0.0', 'Grid', 'Responsive content grid', ['grid']],
  ['fuma.navigation/navbar@1.0.0', 'Navbar', 'Accessible site navigation', ['navbar', 'mobile-menu']],

  ['fuma.marketing/hero@1.0.0', 'Hero', 'Responsive marketing hero', ['hero']],
  ['fuma.marketing/features@1.0.0', 'Feature grid', 'Semantic feature cards', ['feature-grid']],
  ['fuma.marketing/faq@1.0.0', 'FAQ', 'Accessible question list', ['faq']],
  ['fuma.content/article@1.0.0', 'Article', 'Publication header and body', ['article-header', 'article-body']],
  ['fuma.media/gallery@1.0.0', 'Gallery', 'Responsive media gallery', ['gallery', 'lightbox']],
  ['fuma.forms/contact@1.0.0', 'Contact form', 'Typed contact form', ['contact-form']],
  ['fuma.members/account@1.0.0', 'Member account', 'Sign-in and account controls', ['sign-in', 'account-menu']],
  ['fuma.commerce/catalog@1.0.0', 'Commerce catalog', 'Product cards and cart handoff', ['product-card', 'product-grid', 'add-to-cart']],
] as const)

export interface ComponentCatalogContext { scope: ComponentCatalogScope; actorId: string; operationId: string }
const packageKey = (coordinate: string) => coordinate.slice(0, coordinate.lastIndexOf('@'))
const nowIso = (now: () => Date) => now().toISOString()

function confirmRestricted(record: import('./contracts').ComponentSourceDraftRecord, confirmation: import('../../../../../tooling/component-packs/contracts').OwnerArtifactConfirmation, displayName: string): Readonly<ComponentPackRelease> {
  const { draft, validation, disclosure } = record
  if (draft.owner.kind === 'platform') throw new ComponentCatalogError('confirmation', 'Restricted client drafts require tenant ownership.')
  if (validation.draftId !== draft.draftId || validation.sourceHashSha256 !== sha256(draft.sourceTsx) || Object.values(validation.checks).some((check) => !check.passed)) throw new ComponentCatalogError('validation', 'Restricted client validation is missing or not bound to the exact source.')
  if (disclosure.draftId !== draft.draftId || disclosure.disclosedToOwnerKey !== draft.owner.ownerKey || canonicalJson(disclosure.permissions) !== canonicalJson(draft.requestedPermissions)) throw new ComponentCatalogError('confirmation', 'Permission disclosure changed.')
  if (confirmation.draftId !== draft.draftId || confirmation.ownerKey !== draft.owner.ownerKey || confirmation.ownerGeneration !== draft.owner.ownerGeneration || confirmation.sourceHashSha256 !== sha256(draft.sourceTsx) || confirmation.disclosureSha256 !== hashContract(disclosure)) throw new ComponentCatalogError('confirmation', 'Owner confirmation is not bound to exact source, disclosure, and generation.')
  return sealComponentPackRelease({ manifest: { schemaVersion: 1, namespace: draft.namespace, packId: draft.packId, exactVersion: draft.targetVersion, displayName, source: draft.source, trustTier: 'restricted-client', owner: draft.owner, capabilities: draft.requestedPermissions.some((permission) => permission.authority === 'typed-bun-api') ? ['client.browser','client.typed-bun-api'] : ['client.browser'], permissions: draft.requestedPermissions, dependencies: [], compatibility: { registryApiVersion: '1.0.0', minimumRuntimeVersion: '1.0.0', maximumRuntimeVersion: '1.9.9', canonicalTreeVersion: 1 }, distribution: { state: 'private', reviewId: null }, createdAt: confirmation.confirmedAt }, payload: { kind: 'restricted-client', components: [{ componentId: draft.componentId, displayName, props: draft.props, slots: draft.slots, propsSchemaHashSha256: hashContract(draft.props), slotsSchemaHashSha256: hashContract(draft.slots), compiledJavaScriptSha256: sha256(Buffer.from(validation.compiledJavaScriptBase64,'base64')), compiledCssSha256: sha256(Buffer.from(validation.compiledCssBase64,'base64')), validationReceiptSha256: hashContract(validation), disclosureSha256: hashContract(disclosure), ownerConfirmationSha256: hashContract(confirmation), sandbox: { isolation: 'restricted-client-iframe-or-worker', csp: 'deny-by-default', dynamicImports: false, serverExecution: false, directNetwork: false } }] } })
}
function upgradeDiff(from: ComponentPackRelease, to: ComponentPackRelease, affectedNodeCount: number) {
  if (packageKey(releaseCoordinate(from)) !== packageKey(releaseCoordinate(to)) || releaseCoordinate(from) === releaseCoordinate(to)) throw new ComponentCatalogError('validation', 'Upgrade target must be a different exact version of the same pack.')
  const beforePermissions = new Map(from.manifest.permissions.map((item)=>[item.id,item])); const afterPermissions = new Map(to.manifest.permissions.map((item)=>[item.id,item]));
  const permissionAdded=to.manifest.permissions.filter((item)=>!beforePermissions.has(item.id)); const permissionRemoved=from.manifest.permissions.filter((item)=>!afterPermissions.has(item.id)); const permissionChanged=to.manifest.permissions.filter((item)=>beforePermissions.has(item.id)&&canonicalJson(beforePermissions.get(item.id))!==canonicalJson(item));
  const fromIds=new Set(from.payload.components.map((item)=>item.componentId)); const toIds=new Set(to.payload.components.map((item)=>item.componentId)); const schemaChanged=from.payload.components.filter((item)=>toIds.has(item.componentId)).some((item)=>{const target=to.payload.components.find((candidate)=>candidate.componentId===item.componentId);return target&&'propsSchemaHashSha256'in item&&'propsSchemaHashSha256'in target&&(item.propsSchemaHashSha256!==target.propsSchemaHashSha256||item.slotsSchemaHashSha256!==target.slotsSchemaHashSha256)})||[...fromIds].some((id)=>!toIds.has(id))||[...toIds].some((id)=>!fromIds.has(id));
  const requiresOwnerConfirmation=permissionAdded.length>0||permissionRemoved.length>0||permissionChanged.length>0||schemaChanged||canonicalJson(from.manifest.dependencies)!==canonicalJson(to.manifest.dependencies)||canonicalJson(from.manifest.capabilities)!==canonicalJson(to.manifest.capabilities)
  return Object.freeze({from:releaseCoordinate(from),to:releaseCoordinate(to),permissionAdded,permissionRemoved,permissionChanged,schemaChanged,affectedNodeCount,visualArtifactChanged:from.immutableArtifact.integritySha256!==to.immutableArtifact.integritySha256,requiresOwnerConfirmation,rollbackCoordinate:releaseCoordinate(from)})
}

export class ComponentCatalogService {
  readonly #repository: ComponentCatalogRepository
  readonly #reviews: Pick<ArtifactReviewService, 'marketplace' | 'install'>
  readonly #artifacts: Pick<ArtifactInstallationAuthority, 'readVerifiedArtifact'>
  readonly #validator: ComponentSourceValidator
  readonly #now: () => Date
  readonly #id: () => string
  constructor(input: Readonly<{ repository: ComponentCatalogRepository; reviews: Pick<ArtifactReviewService, 'marketplace' | 'install'>; artifacts: Pick<ArtifactInstallationAuthority, 'readVerifiedArtifact'>; validator?: ComponentSourceValidator; now?: () => Date; generateId?: () => string }>) { this.#repository = input.repository; this.#reviews = input.reviews; this.#artifacts = input.artifacts; this.#validator = input.validator ?? new IsolatedRestrictedClientValidator(); this.#now = input.now ?? (() => new Date()); this.#id = input.generateId ?? (() => crypto.randomUUID()) }

  async execute(context: ComponentCatalogContext, action: ComponentCatalogAction, raw: unknown): Promise<unknown> {
    switch (action) {
      case 'create': case 'edit': return this.create(context, raw)
      case 'variant': return this.variant(context, raw)
      case 'preview': return this.preview(context, raw)
      case 'validate-source': return this.validateSource(context, raw)
      case 'confirm-source': return this.confirmSource(context, raw)
      case 'search': return this.search(context, raw)
      case 'get': return this.get(context, raw)
      case 'install': return this.install(context, raw)
      case 'insert': return this.insert(context, raw)
      case 'upgrade': return this.upgrade(context, raw)
      case 'usage': return this.usage(context, raw)
      case 'uninstall': return this.uninstall(context, raw)
      case 'publish-check': return this.publishCheck(context)
    }
  }

  async create(context: ComponentCatalogContext, raw: unknown) {
    const command = parseComponentCatalog(CreateDeclarativeComponentCommandSchema, raw, 'create component command')
    const release = validateComponentPackRelease(command.release)
    const owner = release.manifest.owner
    if (release.manifest.trustTier !== 'private-declarative' || release.payload.kind !== 'declarative' || owner.kind !== 'site' || owner.organizationId !== context.scope.organizationId || owner.workspaceId !== context.scope.workspaceId || owner.siteId !== context.scope.siteId || owner.ownerKey !== context.scope.ownerKey || owner.ownerGeneration !== context.scope.ownerGeneration) throw new ComponentCatalogError('scope', 'Private component release must belong to the exact active site owner generation.')
    if (command.previousCoordinate) { const prior = await this.#repository.release(context.scope, command.previousCoordinate); if (!prior || packageKey(prior.coordinate) !== packageKey(releaseCoordinate(release))) throw new ComponentCatalogError('conflict', 'Component version ancestry is unavailable or changed.') }
    const record = parseComponentCatalog(ComponentCatalogReleaseSchema, { scope: context.scope, coordinate: releaseCoordinate(release), previousCoordinate: command.previousCoordinate, release, origin: 'private', state: 'active', actorId: context.actorId, createdAt: nowIso(this.#now) }, 'component release record')
    const outcome = await this.#repository.putRelease(record)
    if (outcome === 'conflict') throw new ComponentCatalogError('conflict', 'Exact component coordinate already has different immutable bytes.')
    await this.#audit(context, command.previousCoordinate ? 'component.private.versioned' : 'component.private.created', record.coordinate)
    return record
  }

  async variant(context: ComponentCatalogContext, raw: unknown) {
    const command = parseComponentCatalog(CreateComponentVariantCommandSchema, raw, 'component variant command')
    const prior = await this.#requiredRelease(context.scope, command.coordinate)
    if (prior.release.payload.kind !== 'declarative') throw new ComponentCatalogError('validation', 'Only declarative components have visual variants.')
    const components = prior.release.payload.components.map((component) => component.componentId === command.componentId ? { ...component, variants: [...component.variants, command.variant] } : component)
    if (!components.some((item) => item.componentId === command.componentId)) throw new ComponentCatalogError('not-found', 'Component is unavailable in this exact release.')
    const release = sealComponentPackRelease({ manifest: { ...prior.release.manifest, exactVersion: command.targetVersion, createdAt: nowIso(this.#now) }, payload: { kind: 'declarative', components } })
    return this.create(context, { release, previousCoordinate: prior.coordinate })
  }

  async validateSource(context: ComponentCatalogContext, raw: unknown) {
    const { draft } = parseComponentCatalog(ValidateComponentSourceCommandSchema, raw, 'validate source command')
    this.#assertDraftOwner(context.scope, draft)
    const { audit, validation } = await this.#validator.validate(draft)
    const disclosure = { draftId: draft.draftId, permissions: draft.requestedPermissions, dependencyLockSha256: hashContract(draft.exactDependencies), disclosedAt: nowIso(this.#now), disclosedToOwnerKey: context.scope.ownerKey }
    const record = parseComponentCatalog(ComponentSourceDraftRecordSchema, { scope: context.scope, actorId: context.actorId, draft, validation, disclosure, sourceAuditHashSha256: hashContract(audit), state: 'validated', createdAt: nowIso(this.#now), confirmedAt: null }, 'validated source draft')
    const outcome = await this.#repository.putDraft(record); if (outcome === 'conflict') throw new ComponentCatalogError('conflict', 'Source draft identity already binds different bytes or permissions.')
    await this.#audit(context, 'component.source.validated', `${draft.namespace}/${draft.packId}@${draft.targetVersion}`)
    return { draftId: draft.draftId, sourceAudit: audit, validation, disclosure, ownerConfirmationRequired: true }
  }

  async confirmSource(context: ComponentCatalogContext, raw: unknown) {
    const command = parseComponentCatalog(ConfirmComponentSourceCommandSchema, raw, 'confirm source command')
    const record = await this.#repository.draft(context.scope, command.draftId)
    if (!record || record.state !== 'validated' || record.actorId !== context.actorId) throw new ComponentCatalogError('confirmation', 'A current validated source draft owned by this actor is required.')
    const release = confirmRestricted(record, command.confirmation, command.displayName)
    if (!await this.#repository.confirmDraft(context.scope, command.draftId, command.confirmation.confirmedAt)) throw new ComponentCatalogError('conflict', 'Source confirmation raced another operation.')
    const saved = parseComponentCatalog(ComponentCatalogReleaseSchema, { scope: context.scope, coordinate: releaseCoordinate(release), previousCoordinate: null, release, origin: 'restricted-client', state: 'active', actorId: context.actorId, createdAt: command.confirmation.confirmedAt }, 'restricted component release')
    if (await this.#repository.putRelease(saved) === 'conflict') throw new ComponentCatalogError('conflict', 'Restricted component coordinate changed.')
    await this.#audit(context, 'component.source.confirmed', saved.coordinate)
    return saved
  }

  async search(context: ComponentCatalogContext, raw: unknown) {
    const command = parseComponentCatalog(SearchComponentsCommandSchema, raw, 'component search command'); const source = command.source ?? 'all'; const query = command.query.trim().toLowerCase(); const installations = await this.#repository.listInstallations(context.scope); const installed = new Set(installations.map((item) => item.coordinate)); const items: ComponentCatalogItem[] = []
    if (source === 'all' || source === 'starter') for (const [coordinate, displayName, description, componentIds] of STARTERS) items.push(this.#item({ coordinate, displayName, description, componentIds: [...componentIds], source: 'starter', trustTier: 'official', permissions: [], installed: installed.has(coordinate), integritySha256: sha256(coordinate) }))
    if (source === 'all' || source === 'private') for (const record of await this.#repository.listReleases(context.scope)) items.push(this.#releaseItem(record.release, record.origin, installed.has(record.coordinate)))
    if (source === 'all' || source === 'reviewed') for (const artifact of (await this.#reviews.marketplace(100)).filter((item) => item.kind === 'component-pack')) { const release = await this.#reviewedRelease(artifact); items.push(this.#releaseItem(release, 'reviewed', installed.has(releaseCoordinate(release)))) }
    if (source === 'installed') for (const installation of installations) { const release = await this.#resolveRelease(context.scope, installation.coordinate, installation); items.push(this.#releaseItem(release, installation.source, true)) }
    return { items: items.filter((item) => !query || `${item.displayName} ${item.description} ${item.coordinate} ${item.componentIds.join(' ')}`.toLowerCase().includes(query)).slice(0, command.limit ?? 50) }
  }

  async get(context: ComponentCatalogContext, raw: unknown) { const { coordinate } = parseComponentCatalog(GetComponentCommandSchema, raw, 'get component command'); const installation = (await this.#repository.listInstallations(context.scope)).find((item) => item.coordinate === coordinate); return this.#resolveRelease(context.scope, coordinate, installation) }
  async preview(context: ComponentCatalogContext, raw: unknown) {
    const command = parseComponentCatalog(PreviewComponentCommandSchema, raw, 'preview component command')
    const release = await this.get(context, { coordinate: command.coordinate }) as ComponentPackRelease
    if (release.payload.kind === 'trusted-privileged') throw new ComponentCatalogError('validation', 'Privileged components cannot use tenant visual preview.')
    if (release.payload.kind === 'declarative') {
      const component = release.payload.components.find((item) => item.componentId === command.componentId)
      if (!component) throw new ComponentCatalogError('not-found', 'Component is unavailable.')
      const variant = command.variantId ? component.variants.find((item) => item.id === command.variantId) : null
      if (command.variantId && !variant) throw new ComponentCatalogError('not-found', 'Component variant is unavailable.')
      return { coordinate: command.coordinate, component, variant, sandbox: null }
    }
    const component = release.payload.components.find((item) => item.componentId === command.componentId)
    if (!component) throw new ComponentCatalogError('not-found', 'Component is unavailable.')
    if (command.variantId) throw new ComponentCatalogError('not-found', 'Restricted client components do not expose declarative variants.')
    return { coordinate: command.coordinate, component, variant: null, sandbox: component.sandbox }
  }

  async install(context: ComponentCatalogContext, raw: unknown) { const command = parseComponentCatalog(InstallComponentCommandSchema, raw, 'install component command'); const artifact = (await this.#reviews.marketplace(100)).find((item) => item.submissionId === command.submissionId && item.artifactId === command.artifactId && item.kind === 'component-pack'); if (!artifact) throw new ComponentCatalogError('review', 'A current signed and unrevoked component-pack review is required.'); const release = await this.#reviewedRelease(artifact); const at = nowIso(this.#now); const native = await this.#reviews.install({ submissionId: command.submissionId, grantedPermissions: command.grantedPermissions, installation: this.#nativeInstallation(context, command.installationId, artifact, at) }); const record = parseComponentCatalog(ComponentInstallationSchema, { scope: context.scope, installationId: command.installationId, packageKey: packageKey(releaseCoordinate(release)), coordinate: releaseCoordinate(release), integritySha256: release.immutableArtifact.integritySha256, source: 'reviewed', artifactInstallationId: native.installationId, artifactId: artifact.artifactId, reviewSubmissionId: command.submissionId, rollbackCoordinates: [], version: 1, installedAt: at, updatedAt: at }, 'component installation'); if (!await this.#repository.putInstallation(record, null)) throw new ComponentCatalogError('conflict', 'Component installation identity changed.'); await this.#audit(context, 'component.installed', record.coordinate); return record }

  async insert(context: ComponentCatalogContext, raw: unknown) { const command = parseComponentCatalog(InsertComponentCommandSchema, raw, 'insert component command'); const release = await this.get(context, { coordinate: command.coordinate }) as ComponentPackRelease; if (release.payload.kind === 'trusted-privileged' || !release.payload.components.some((item) => item.componentId === command.componentId)) throw new ComponentCatalogError('validation', 'Insert requires an available declarative or restricted client component.'); const usage = parseComponentCatalog(ComponentUsageSchema, { scope: context.scope, usageId: command.usageId, coordinate: command.coordinate, kind: command.kind, resourceId: command.resourceId, nodeId: command.parentNodeId, variantId: command.variantId, props: command.props, createdAt: nowIso(this.#now) }, 'component usage'); if (await this.#repository.putUsage(usage) === 'conflict') throw new ComponentCatalogError('conflict', 'Component insertion replay evidence changed.'); await this.#audit(context, 'component.inserted', command.coordinate); return { usage, insertion: { moduleId: 'fuma.component', component: { coordinate: command.coordinate, componentId: command.componentId, variantId: command.variantId }, props: command.props, parentNodeId: command.parentNodeId } } }

  async usage(context: ComponentCatalogContext, raw: unknown) { const { coordinate } = parseComponentCatalog(ListComponentUsageCommandSchema, raw, 'list usage command'); return { usages: await this.#repository.listUsage(context.scope, coordinate) } }
  async uninstall(context: ComponentCatalogContext, raw: unknown) { const { installationId } = parseComponentCatalog(UninstallComponentCommandSchema, raw, 'uninstall component command'); const installation = await this.#repository.installation(context.scope, installationId); if (!installation) throw new ComponentCatalogError('not-found', 'Component installation is unavailable.'); const usages = await this.#repository.listUsage(context.scope, installation.coordinate); if (usages.length) throw new ComponentCatalogError('usage', `Uninstall is blocked by ${usages.length} page, Visual Component, template, or retained-release reference(s).`); if (!await this.#repository.removeInstallation(context.scope, installationId, installation.version)) throw new ComponentCatalogError('conflict', 'Component installation changed concurrently.'); await this.#audit(context, 'component.uninstalled', installation.coordinate); return { uninstalled: true, retainedArtifactEvidence: installation.artifactInstallationId !== null } }

  async upgrade(context: ComponentCatalogContext, raw: unknown) { const command = parseComponentCatalog(UpgradeComponentCommandSchema, raw, 'upgrade component command'); const current = await this.#repository.installation(context.scope, command.installationId); if (!current) throw new ComponentCatalogError('not-found', 'Component installation is unavailable.'); const artifact = (await this.#reviews.marketplace(100)).find((item) => item.submissionId === command.submissionId && item.artifactId === command.artifactId && item.kind === 'component-pack'); if (!artifact) throw new ComponentCatalogError('review', 'Upgrade target is not a current signed review.'); const target = await this.#reviewedRelease(artifact); const from = await this.#resolveRelease(context.scope, current.coordinate, current); const usages = await this.#repository.listUsage(context.scope, current.coordinate); const diff = upgradeDiff(from, target, usages.length); if (diff.requiresOwnerConfirmation && !command.ownerConfirmed) throw new ComponentCatalogError('confirmation', 'Upgrade changes permissions, dependencies, schemas, or capabilities and requires explicit owner confirmation.'); const at = nowIso(this.#now); await this.#reviews.install({ submissionId: command.submissionId, grantedPermissions: command.grantedPermissions, installation: this.#nativeInstallation(context, command.targetInstallationId, artifact, at) }); const next = parseComponentCatalog(ComponentInstallationSchema, { ...current, coordinate: releaseCoordinate(target), integritySha256: target.immutableArtifact.integritySha256, artifactInstallationId: command.targetInstallationId, artifactId: artifact.artifactId, reviewSubmissionId: command.submissionId, rollbackCoordinates: [...current.rollbackCoordinates, current.coordinate], version: current.version + 1, updatedAt: at }, 'upgraded installation'); if (!await this.#repository.putInstallation(next, current.version)) throw new ComponentCatalogError('conflict', 'Component installation changed concurrently.'); const receipt = parseComponentCatalog(ComponentUpgradeReceiptSchema, { scope: context.scope, receiptId: this.#id(), installationId: current.installationId, fromCoordinate: current.coordinate, toCoordinate: next.coordinate, diffHashSha256: hashContract(diff), rollbackCoordinate: current.coordinate, affectedUsageIds: usages.map((item) => item.usageId), ownerConfirmed: command.ownerConfirmed, actorId: context.actorId, createdAt: at }, 'component upgrade receipt'); if (await this.#repository.putUpgradeReceipt(receipt) === 'conflict') throw new ComponentCatalogError('conflict', 'Upgrade receipt identity changed.'); await this.#audit(context, 'component.upgraded', next.coordinate); return { installation: next, diff, receipt } }

  async publishCheck(context: ComponentCatalogContext) { const installations = await this.#repository.listInstallations(context.scope); const marketplace = await this.#reviews.marketplace(100); for (const installation of installations) if (installation.source === 'reviewed' && !marketplace.some((item) => item.artifactId === installation.artifactId || item.submissionId === installation.reviewSubmissionId)) throw new ComponentCatalogError('revoked', `Publishing is blocked because ${installation.coordinate} is withdrawn or security-revoked.`); const usage = await this.#repository.listUsage(context.scope); for (const item of usage) await this.#resolveRelease(context.scope, item.coordinate, installations.find((entry) => entry.coordinate === item.coordinate)); await this.#audit(context, 'component.publish.checked', null); return { publishable: true, exactPins: [...new Set(usage.map((item) => item.coordinate))] } }

  #assertDraftOwner(scope: ComponentCatalogScope, draft: GeneratedClientDraft) { const owner = draft.owner; if (owner.kind !== 'site' || owner.organizationId !== scope.organizationId || owner.workspaceId !== scope.workspaceId || owner.siteId !== scope.siteId || owner.ownerKey !== scope.ownerKey || owner.ownerGeneration !== scope.ownerGeneration) throw new ComponentCatalogError('scope', 'Restricted client draft belongs to another owner generation.') }
  async #requiredRelease(scope: ComponentCatalogScope, coordinate: string) { const value = await this.#repository.release(scope, coordinate); if (!value) throw new ComponentCatalogError('not-found', 'Private component release is unavailable.'); return value }
  async #resolveRelease(scope: ComponentCatalogScope, coordinate: string, installation?: ComponentInstallation) { const privateRelease = await this.#repository.release(scope, coordinate); if (privateRelease) return privateRelease.release; if (coordinate.startsWith('fuma.')) throw new ComponentCatalogError('not-found', 'Starter components are compiled into the runtime and have no tenant release bytes.'); if (!installation?.artifactId) throw new ComponentCatalogError('not-found', 'Exact installed component bytes are unavailable.'); const verified = await this.#artifacts.readVerifiedArtifact(installation.artifactId); const release = validateComponentPackRelease(JSON.parse(new TextDecoder().decode(verified.bytes))); if (releaseCoordinate(release) !== coordinate || release.immutableArtifact.integritySha256 !== installation.integritySha256) throw new ComponentCatalogError('conflict', 'Installed component exact pin or integrity changed.'); return release }
  async #reviewedRelease(artifact: MarketplaceArtifact) { const verified = await this.#artifacts.readVerifiedArtifact(artifact.artifactId); if (verified.artifact.kind !== 'component-pack') throw new ComponentCatalogError('review', 'Reviewed artifact is not a component pack.'); const release = validateComponentPackRelease(JSON.parse(new TextDecoder().decode(verified.bytes))); if (release.manifest.distribution.state !== 'reviewed' || release.manifest.distribution.reviewId === null || verified.artifact.contentHashSha256 !== artifact.contentHashSha256) throw new ComponentCatalogError('review', 'Reviewed component bytes or promotion evidence changed.'); return release }
  #nativeInstallation(context: ComponentCatalogContext, installationId: string, artifact: MarketplaceArtifact, at: string) { return { platformId: context.scope.platformId, organizationId: context.scope.organizationId, workspaceId: context.scope.workspaceId, siteId: context.scope.siteId, ownerKey: context.scope.ownerKey, ownerGeneration: context.scope.ownerGeneration, installationId, artifactId: artifact.artifactId, artifactKind: 'component-pack' as const, packageId: artifact.packageId, exactVersion: artifact.exactVersion, contentHashSha256: artifact.contentHashSha256, executionPolicy: 'component-declarative' as const, settingsObjectKey: null, secret: null, state: 'active' as const, workerGeneration: null, quota: { storageBytes: 1, scheduledJobs: 0, callsPerMinute: 1 }, previousArtifactId: null, version: 1, installedAt: at, updatedAt: at } }
  #releaseItem(release: ComponentPackRelease, source: 'private' | 'restricted-client' | 'reviewed', installed: boolean) { return this.#item({ coordinate: releaseCoordinate(release), displayName: release.manifest.displayName, description: release.payload.kind === 'declarative' ? release.payload.components.map((item) => item.description).join(' ') : `${release.manifest.trustTier} component pack`, componentIds: release.payload.components.map((item) => item.componentId), source, trustTier: release.manifest.trustTier, permissions: release.manifest.permissions.map((item) => item.id), installed, integritySha256: release.immutableArtifact.integritySha256 }) }
  #item(input: Omit<ComponentCatalogItem, 'exactVersion'>) { const item = { ...input, exactVersion: input.coordinate.slice(input.coordinate.lastIndexOf('@') + 1) }; return parseComponentCatalog(ComponentCatalogItemSchema, item, 'catalog item') as ComponentCatalogItem }
  async #audit(context: ComponentCatalogContext, action: Parameters<ComponentCatalogRepository['appendAudit']>[0]['action'], coordinate: string | null) { await this.#repository.appendAudit({ auditId: this.#id(), scope: context.scope, actorId: context.actorId, action, coordinate, operationId: context.operationId, outcome: 'success', reasonCode: null, occurredAt: nowIso(this.#now) }) }
}

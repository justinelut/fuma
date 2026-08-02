import { createHash } from 'node:crypto'
import { Type, Value, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import {
  RuntimeNodeSchema,
  parseRuntimeContract,
  type RuntimeNode,
} from '../publishing/runtimeTree/contracts'
import type { LawyerImportPlan } from './adapter'

const Id = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const Hash = Type.String({ pattern: '^[a-f0-9]{64}$' })
const Version = Type.String({ pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$' })
const SourceRoute = Type.String({ minLength: 1, maxLength: 512, pattern: '^/(?:(?:[A-Za-z0-9._~-]+|\\[[A-Za-z0-9_-]+\\])(?:/(?:[A-Za-z0-9._~-]+|\\[[A-Za-z0-9_-]+\\]))*)?$' })
const RuntimePath = Type.String({ minLength: 1, maxLength: 512, pattern: '^/(?:[A-Za-z0-9._~-]+(?:/[A-Za-z0-9._~-]+)*)?$' })
const ComponentId = Type.String({ pattern: '^lawyer\\.[a-z]+(?:-[a-z]+)*$' })
const Access = Type.Union([Type.Literal('public'), Type.Literal('member'), Type.Literal('paid'), Type.Literal('staff'), Type.Literal('service'), Type.Literal('content')])

const DependencySchema = Type.Object({
  package: Type.String({ minLength: 1, maxLength: 128 }),
  exactVersion: Version,
  license: Type.Literal('MIT'),
  runtimeOwned: Type.Boolean(),
}, { additionalProperties: false })

const SourceComponentSchema = Type.Object({
  componentId: ComponentId,
  exactVersion: Type.Literal('1.0.0'),
  sourcePath: Type.Literal('apps/site-runtime/components/lawyer-components.tsx'),
  execution: Type.Literal('official-server'),
  sourceMode: Type.Literal('owned-next-tailwind'),
  propsSchemaHashSha256: Hash,
  slotsSchemaHashSha256: Hash,
  permissions: Type.Array(Type.Never(), { maxItems: 0 }),
  staticTailwind: Type.Literal(true),
  flattenedHtml: Type.Literal(false),
}, { additionalProperties: false })

const TemplateSchema = Type.Object({
  templateId: Id,
  exactVersion: Type.Literal('1.0.0'),
  componentIds: Type.Array(ComponentId, { minItems: 1, maxItems: 16, uniqueItems: true }),
  loopIds: Type.Array(Id, { maxItems: 16, uniqueItems: true }),
  outlet: Type.Literal(true),
}, { additionalProperties: false })

const RouteMappingSchema = Type.Object({
  sourceRoute: SourceRoute,
  sourceKind: Type.Union([Type.Literal('page'), Type.Literal('api'), Type.Literal('feed'), Type.Literal('system')]),
  sourceFile: Type.String({ minLength: 1, maxLength: 1_024 }),
  sourceAccess: Type.Union([Type.Literal('public'), Type.Literal('member'), Type.Literal('staff'), Type.Literal('service')]),
  target: Type.Union([Type.Literal('react-page'), Type.Literal('bun-authority'), Type.Literal('generated-publication'), Type.Literal('runtime-system')]),
  templateId: Type.Union([Id, Type.Null()]),
  accessBinding: Access,
  canonicalPattern: Type.Union([SourceRoute, Type.Null()]),
  authorityAdapter: Id,
  internalLinks: Type.Array(RuntimePath, { maxItems: 32, uniqueItems: true }),
}, { additionalProperties: false })

const ContentMappingSchema = Type.Object({
  sourceId: Id,
  destinationId: Id,
  kind: Type.Union([Type.Literal('post'), Type.Literal('page')]),
  slug: Type.String({ minLength: 1, maxLength: 255 }),
  title: Type.String({ minLength: 1, maxLength: 512 }),
  accessBinding: Type.Union([Type.Literal('public'), Type.Literal('member'), Type.Literal('paid')]),
  templateId: Id,
  canonicalPath: Type.Union([RuntimePath, Type.Null()]),
  dataBinding: Type.String({ minLength: 1, maxLength: 512 }),
  authorIds: Type.Array(Id, { maxItems: 64, uniqueItems: true }),
  tagIds: Type.Array(Id, { maxItems: 128, uniqueItems: true }),
  contentHashSha256: Hash,
  connected: Type.Literal(true),
}, { additionalProperties: false })

const AdapterSchema = Type.Object({
  adapterId: Id,
  domain: Type.Union([Type.Literal('content'), Type.Literal('member-access'), Type.Literal('payment'), Type.Literal('email')]),
  authority: Type.String({ minLength: 1, maxLength: 255 }),
  exactVersion: Type.Literal('1.0.0'),
  mode: Type.Union([Type.Literal('read'), Type.Literal('verified-reconciliation'), Type.Literal('managed-delivery')]),
  directProviderAccess: Type.Literal(false),
}, { additionalProperties: false })

const TokenSchema = Type.Object({ name: Type.String({ pattern: '^--lawyer-[a-z-]+$' }), value: Type.String({ minLength: 1, maxLength: 128 }) }, { additionalProperties: false })
const AssetSchema = Type.Object({ sourceUrlHashSha256: Hash, destinationKey: Type.String({ minLength: 1, maxLength: 1_024 }), sourceHashSha256: Hash, connectedContentIds: Type.Array(Id, { minItems: 1, maxItems: 10_000, uniqueItems: true }) }, { additionalProperties: false })
const RoutePolicySchema = Type.Object({ sourceRoute: SourceRoute, target: Type.Literal('react'), shadow: Type.Literal('compare'), fallback: Type.Literal('legacy'), retainedLegacyRequired: Type.Literal(true) }, { additionalProperties: false })
const RollbackSchema = Type.Object({
  trigger: Type.Union([Type.Literal('visual-parity'), Type.Literal('access-parity'), Type.Literal('hydration'), Type.Literal('budget'), Type.Literal('operator')]),
  action: Type.Literal('route-policy-to-retained-legacy'),
  mutatesContent: Type.Literal(false),
  mutatesMemberState: Type.Literal(false),
  mutatesPaymentState: Type.Literal(false),
}, { additionalProperties: false })

export const LawyerRuntimePilotManifestSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  ticket: Type.Literal('FUMA-SITE-006'),
  sourceSnapshotId: Id,
  sourceSystem: Type.Literal('the-lawyer-ghost-next'),
  inventoryHashSha256: Hash,
  routeManifestHashSha256: Hash,
  contentManifestHashSha256: Hash,
  componentPack: Type.Object({
    namespace: Type.Literal('fuma.official'),
    packId: Type.Literal('lawyer-editorial'),
    exactVersion: Type.Literal('1.0.0'),
    license: Type.Literal('MIT'),
    sourceOwned: Type.Literal(true),
    registry: Type.Literal('existing-site-runtime-registry'),
    components: Type.Array(SourceComponentSchema, { minItems: 6, maxItems: 6 }),
  }, { additionalProperties: false }),
  dependencies: Type.Array(DependencySchema, { minItems: 6, maxItems: 6 }),
  adapters: Type.Array(AdapterSchema, { minItems: 4, maxItems: 4 }),
  routes: Type.Array(RouteMappingSchema, { minItems: 69, maxItems: 69 }),
  content: Type.Array(ContentMappingSchema, { minItems: 63, maxItems: 63 }),
  templates: Type.Array(TemplateSchema, { minItems: 11, maxItems: 11 }),
  tokens: Type.Array(TokenSchema, { minItems: 6, maxItems: 6, uniqueItems: true }),
  assets: Type.Array(AssetSchema, { minItems: 2, maxItems: 2 }),
  reconciliation: Type.Object({
    providerEvidenceHashSha256: Hash,
    verifiedEligible: Type.Integer({ minimum: 0, maximum: 4 }),
    deniedOrException: Type.Integer({ minimum: 0, maximum: 10 }),
    directAccessGrants: Type.Literal(0),
    staffReauthentication: Type.Integer({ minimum: 4, maximum: 4 }),
    memberReactivation: Type.Integer({ minimum: 4, maximum: 4 }),
    mailProvider: Type.Literal('oci-email-delivery'),
    providerCredentialsImported: Type.Literal(false),
  }, { additionalProperties: false }),
  cutover: Type.Object({
    mode: Type.Literal('exact-route-policy'),
    policies: Type.Array(RoutePolicySchema, { minItems: 1, maxItems: 69 }),
    activation: Type.Literal('after-deterministic-parity'),
    unknownHostFallback: Type.Literal(false),
  }, { additionalProperties: false }),
  rollback: Type.Array(RollbackSchema, { minItems: 5, maxItems: 5 }),
  parity: Type.Object({
    flattenedCopies: Type.Literal(0),
    disconnectedCopies: Type.Literal(0),
    routeCount: Type.Literal(69),
    contentCount: Type.Literal(63),
    relationCount: Type.Literal(147),
    authorCount: Type.Literal(4),
    memberCount: Type.Literal(4),
    publicContentCount: Type.Literal(45),
    memberContentCount: Type.Literal(9),
    paidContentCount: Type.Literal(9),
  }, { additionalProperties: false }),
  manifestHashSha256: Hash,
}, { additionalProperties: false })

export type LawyerRuntimePilotManifest = Readonly<Static<typeof LawyerRuntimePilotManifestSchema>>

export class LawyerRuntimePilotError extends Error {
  readonly code: 'invalid' | 'inventory' | 'disconnected' | 'authority'
  constructor(code: 'invalid' | 'inventory' | 'disconnected' | 'authority', message: string) {
    super(message)
    this.code = code
    this.name = 'LawyerRuntimePilotError'
  }
}

const COMPONENT_IDS = Object.freeze([
  'lawyer.site-shell', 'lawyer.editorial-header', 'lawyer.story-card',
  'lawyer.access-gate', 'lawyer.membership-panel', 'lawyer.account-panel',
] as const)
const NAVIGATION = Object.freeze(['/archive', '/topics', '/podcast', '/newsletters', '/membership'] as const)
const TOKENS = Object.freeze([
  { name: '--lawyer-paper', value: '#f7f3e8' },
  { name: '--lawyer-panel', value: '#eee7d6' },
  { name: '--lawyer-ink', value: '#171713' },
  { name: '--lawyer-muted', value: '#5c5b52' },
  { name: '--lawyer-rule', value: '#cbc3ae' },
  { name: '--lawyer-accent', value: '#9b2c20' },
] as const)

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Readonly<Record<string, unknown>>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}
function sha256(value: unknown): string { return createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex') }
function text(value: unknown, fallback = ''): string { return typeof value === 'string' ? value : fallback }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] }
function safeSlug(value: unknown, sourceId: string): string {
  const slug = text(value, sourceId)
  if (!/^[A-Za-z0-9_~-]+$/.test(slug)) throw new LawyerRuntimePilotError('inventory', `Content ${sourceId} has no canonical slug.`)
  return slug
}
function accessForVisibility(value: unknown): 'public' | 'member' | 'paid' {
  if (value === 'members') return 'member'
  if (value === 'paid' || value === 'tiers') return 'paid'
  return 'public'
}
function templateForContent(sourceId: string, kind: 'post' | 'page', plan: LawyerImportPlan): string {
  if (kind === 'page') return 'lawyer-editorial-page'
  const envelope = plan.report.envelopes.find((item) => item.sourceId === sourceId)
  return envelope?.schema === 'podcast' ? 'lawyer-podcast-episode' : 'lawyer-article'
}
function canonicalContentPath(kind: 'post' | 'page', slug: string): string | null {
  if (kind === 'post') return `/article/${slug}`
  if (slug.startsWith('_')) return null
  if (slug === 'about') return '/about'
  return `/legal/${slug}`
}
function templateForRoute(route: string): string {
  if (route === '/') return 'lawyer-home'
  if (route === '/membership' || route.startsWith('/membership/')) return 'lawyer-membership'
  if (route === '/member' || route.startsWith('/member/')) return 'lawyer-account'
  if (route === '/sign-in' || route === '/sign-up') return 'lawyer-auth'
  if (route.startsWith('/article/')) return 'lawyer-article'
  if (route.startsWith('/podcast/')) return 'lawyer-podcast-episode'
  if (route === '/podcast') return 'lawyer-podcast-index'
  if (route === '/submit' || route.startsWith('/submit/')) return 'lawyer-submission'
  if (route === '/newsletters' || route.startsWith('/newsletter/')) return 'lawyer-newsletter'
  if (route.includes('[slug]') || ['/archive', '/contributors', '/global-brief', '/letters', '/search', '/topics'].includes(route)) return 'lawyer-editorial-index'
  return 'lawyer-editorial-page'
}
function authorityFor(route: string, kind: 'page' | 'api' | 'feed' | 'system'): string {
  if (kind === 'feed') return 'fuma.publication.content'
  if (kind === 'system') return route === '/auth/verify' ? 'fuma.member-identity' : 'fuma.site-runtime'
  if (kind === 'api') {
    if (route.includes('paystack')) return 'fuma.customer-payments'
    if (route.includes('newsletter')) return 'fuma.oci-email-delivery'
    if (route.includes('auth') || route.includes('member')) return 'fuma.member-identity'
    return 'fuma.publication.content'
  }
  if (route.startsWith('/admin')) return 'fuma.staff-publication'
  if (route.includes('membership/callback') || route.includes('membership/initialise')) return 'fuma.customer-payments'
  return route.startsWith('/member') || route === '/sign-in' || route === '/sign-up' ? 'fuma.member-identity' : 'fuma.publication.content'
}
function targetFor(route: string, kind: 'page' | 'api' | 'feed' | 'system'): 'react-page' | 'bun-authority' | 'generated-publication' | 'runtime-system' {
  if (kind === 'api' || route.startsWith('/admin') || route === '/membership/callback' || route === '/membership/initialise') return 'bun-authority'
  if (kind === 'feed') return 'generated-publication'
  if (kind === 'system') return route === '/auth/verify' ? 'bun-authority' : 'runtime-system'
  return 'react-page'
}
function accessForRoute(route: string, sourceAccess: 'public' | 'member' | 'staff' | 'service'): Static<typeof Access> {
  if (route.startsWith('/article/')) return 'content'
  return sourceAccess
}
function componentSchemaHash(componentId: string, field: 'props' | 'slots'): string { return sha256({ componentId, exactVersion: '1.0.0', field }) }

const TEMPLATES = Object.freeze([
  { templateId: 'lawyer-home', exactVersion: '1.0.0', componentIds: ['lawyer.site-shell', 'lawyer.story-card'], loopIds: ['cover-story', 'featured', 'latest'], outlet: true },
  { templateId: 'lawyer-editorial-index', exactVersion: '1.0.0', componentIds: ['lawyer.site-shell', 'lawyer.story-card'], loopIds: ['section-content'], outlet: true },
  { templateId: 'lawyer-article', exactVersion: '1.0.0', componentIds: ['lawyer.site-shell', 'lawyer.editorial-header', 'lawyer.access-gate'], loopIds: ['related-content'], outlet: true },
  { templateId: 'lawyer-editorial-page', exactVersion: '1.0.0', componentIds: ['lawyer.site-shell', 'lawyer.editorial-header'], loopIds: [], outlet: true },
  { templateId: 'lawyer-podcast-index', exactVersion: '1.0.0', componentIds: ['lawyer.site-shell', 'lawyer.story-card'], loopIds: ['podcast-episodes'], outlet: true },
  { templateId: 'lawyer-podcast-episode', exactVersion: '1.0.0', componentIds: ['lawyer.site-shell', 'lawyer.editorial-header', 'lawyer.access-gate'], loopIds: ['related-podcasts'], outlet: true },
  { templateId: 'lawyer-membership', exactVersion: '1.0.0', componentIds: ['lawyer.site-shell', 'lawyer.membership-panel'], loopIds: ['membership-plans'], outlet: true },
  { templateId: 'lawyer-account', exactVersion: '1.0.0', componentIds: ['lawyer.site-shell', 'lawyer.account-panel', 'lawyer.access-gate'], loopIds: ['member-subscriptions'], outlet: true },
  { templateId: 'lawyer-auth', exactVersion: '1.0.0', componentIds: ['lawyer.site-shell', 'lawyer.access-gate'], loopIds: [], outlet: true },
  { templateId: 'lawyer-submission', exactVersion: '1.0.0', componentIds: ['lawyer.site-shell', 'lawyer.editorial-header'], loopIds: [], outlet: true },
  { templateId: 'lawyer-newsletter', exactVersion: '1.0.0', componentIds: ['lawyer.site-shell', 'lawyer.story-card'], loopIds: ['newsletter-archive'], outlet: true },
] as const)

export function parseLawyerRuntimePilot<T extends TSchema>(schema: T, raw: unknown, label: string): Readonly<Static<T>> {
  const parsed = safeParseValue(schema, raw)
  if (!parsed.ok) {
    const first = Value.Errors(schema, raw).First()
    throw new LawyerRuntimePilotError('invalid', `${label} failed strict TypeBox validation${first ? ` at ${first.path || '/'}: ${first.message}` : ''}.`)
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

export function projectLawyerRuntimePilot(plan: LawyerImportPlan): LawyerRuntimePilotManifest {
  const { counts } = plan.report
  if (counts.routes !== 69 || counts.posts !== 42 || counts.pages !== 21 || counts.authors !== 4 || counts.relations !== 147 || counts.members !== 4
    || counts.publicContent !== 45 || counts.memberContent !== 9 || counts.paidContent !== 9) {
    throw new LawyerRuntimePilotError('inventory', 'The complete accepted FUMA-076 Lawyer inventory is required.')
  }
  const routeMappings = plan.report.routes.map((route) => {
    const target = targetFor(route.route, route.kind)
    return {
      sourceRoute: route.route,
      sourceKind: route.kind,
      sourceFile: route.source,
      sourceAccess: route.access,
      target,
      templateId: target === 'react-page' ? templateForRoute(route.route) : null,
      accessBinding: accessForRoute(route.route, route.access),
      canonicalPattern: target === 'react-page' || target === 'generated-publication' ? route.route : null,
      authorityAdapter: authorityFor(route.route, route.kind),
      internalLinks: target === 'react-page' ? [...NAVIGATION] : [],
    }
  }).sort((left, right) => left.sourceRoute.localeCompare(right.sourceRoute))
  if (new Set(routeMappings.map(({ sourceRoute }) => sourceRoute)).size !== 69) throw new LawyerRuntimePilotError('inventory', 'Lawyer route mappings must be unique.')

  const contentMappings = plan.genericPlan.objects
    .filter((item): item is typeof item & { kind: 'post' | 'page' } => item.kind === 'post' || item.kind === 'page')
    .map((item) => {
      const slug = safeSlug(item.value.slug, item.sourceId)
      const kind = item.kind
      const canonicalPath = canonicalContentPath(kind, slug)
      return {
        sourceId: item.sourceId,
        destinationId: item.destinationId,
        kind,
        slug,
        title: text(item.value.title, slug),
        accessBinding: accessForVisibility(item.value.visibility),
        templateId: templateForContent(item.sourceId, kind, plan),
        canonicalPath,
        dataBinding: `fuma.publication.content:${item.destinationId}`,
        authorIds: strings(item.value.authorIds).sort(),
        tagIds: strings(item.value.tagIds).sort(),
        contentHashSha256: item.contentHashSha256,
        connected: true as const,
      }
    }).sort((left, right) => `${left.kind}:${left.sourceId}`.localeCompare(`${right.kind}:${right.sourceId}`))
  if (contentMappings.length !== 63 || contentMappings.some(({ dataBinding }) => !dataBinding.startsWith('fuma.publication.content:'))) {
    throw new LawyerRuntimePilotError('disconnected', 'Every imported Lawyer content record must remain connected to Fuma publication data.')
  }
  const connectedContentIds = contentMappings.filter(({ kind }) => kind === 'post').map(({ destinationId }) => destinationId)
  const assets = plan.genericPlan.media.map((asset) => ({
    sourceUrlHashSha256: sha256(asset.sourceUrl),
    destinationKey: asset.destinationKey,
    sourceHashSha256: asset.sourceHashSha256,
    connectedContentIds,
  })).sort((left, right) => left.destinationKey.localeCompare(right.destinationKey))

  const components = COMPONENT_IDS.map((componentId) => ({
    componentId,
    exactVersion: '1.0.0' as const,
    sourcePath: 'apps/site-runtime/components/lawyer-components.tsx' as const,
    execution: 'official-server' as const,
    sourceMode: 'owned-next-tailwind' as const,
    propsSchemaHashSha256: componentSchemaHash(componentId, 'props'),
    slotsSchemaHashSha256: componentSchemaHash(componentId, 'slots'),
    permissions: [] as never[],
    staticTailwind: true as const,
    flattenedHtml: false as const,
  }))
  const paymentRows = [...plan.report.payments, ...plan.report.orphanPaymentEvidence]
  const policies = routeMappings.filter(({ target }) => target === 'react-page').map(({ sourceRoute }) => ({
    sourceRoute, target: 'react' as const, shadow: 'compare' as const, fallback: 'legacy' as const, retainedLegacyRequired: true as const,
  }))
  const body = {
    schemaVersion: 1 as const,
    ticket: 'FUMA-SITE-006' as const,
    sourceSnapshotId: plan.report.snapshotId,
    sourceSystem: plan.report.sourceSystem,
    inventoryHashSha256: plan.report.hashes.reportSha256,
    routeManifestHashSha256: sha256(routeMappings),
    contentManifestHashSha256: sha256(contentMappings),
    componentPack: { namespace: 'fuma.official' as const, packId: 'lawyer-editorial' as const, exactVersion: '1.0.0' as const, license: 'MIT' as const, sourceOwned: true as const, registry: 'existing-site-runtime-registry' as const, components },
    dependencies: [
      { package: '@sinclair/typebox', exactVersion: '0.34.49', license: 'MIT' as const, runtimeOwned: true },
      { package: 'next', exactVersion: '16.2.9', license: 'MIT' as const, runtimeOwned: true },
      { package: 'react', exactVersion: '19.2.5', license: 'MIT' as const, runtimeOwned: true },
      { package: 'react-dom', exactVersion: '19.2.5', license: 'MIT' as const, runtimeOwned: true },
      { package: 'tailwindcss', exactVersion: '4.3.3', license: 'MIT' as const, runtimeOwned: true },
      { package: 'shadcn', exactVersion: '4.14.1', license: 'MIT' as const, runtimeOwned: true },
    ],
    adapters: [
      { adapterId: 'fuma.publication.content', domain: 'content' as const, authority: 'PublicationDomainStore', exactVersion: '1.0.0' as const, mode: 'read' as const, directProviderAccess: false as const },
      { adapterId: 'fuma.publication.member-access', domain: 'member-access' as const, authority: 'PublicationMemberAccessService', exactVersion: '1.0.0' as const, mode: 'read' as const, directProviderAccess: false as const },
      { adapterId: 'fuma.customer-payments', domain: 'payment' as const, authority: 'CustomerMerchantPaymentService', exactVersion: '1.0.0' as const, mode: 'verified-reconciliation' as const, directProviderAccess: false as const },
      { adapterId: 'fuma.oci-email-delivery', domain: 'email' as const, authority: 'FumaOciEmailDelivery', exactVersion: '1.0.0' as const, mode: 'managed-delivery' as const, directProviderAccess: false as const },
    ],
    routes: routeMappings,
    content: contentMappings,
    templates: TEMPLATES,
    tokens: TOKENS,
    assets,
    reconciliation: {
      providerEvidenceHashSha256: plan.report.hashes.membershipSha256,
      verifiedEligible: paymentRows.filter(({ classification }) => classification === 'verified-for-fuma-reconciliation').length,
      deniedOrException: paymentRows.filter(({ classification }) => classification !== 'verified-for-fuma-reconciliation').length,
      directAccessGrants: 0 as const,
      staffReauthentication: plan.report.reauthentication.staffSourceIds.length,
      memberReactivation: plan.report.reauthentication.memberSourceIds.length,
      mailProvider: 'oci-email-delivery' as const,
      providerCredentialsImported: false as const,
    },
    cutover: { mode: 'exact-route-policy' as const, policies, activation: 'after-deterministic-parity' as const, unknownHostFallback: false as const },
    rollback: ['visual-parity', 'access-parity', 'hydration', 'budget', 'operator'].map((trigger) => ({
      trigger, action: 'route-policy-to-retained-legacy' as const, mutatesContent: false as const, mutatesMemberState: false as const, mutatesPaymentState: false as const,
    })),
    parity: { flattenedCopies: 0 as const, disconnectedCopies: 0 as const, routeCount: 69 as const, contentCount: 63 as const, relationCount: 147 as const, authorCount: 4 as const, memberCount: 4 as const, publicContentCount: 45 as const, memberContentCount: 9 as const, paidContentCount: 9 as const },
  }
  return validateLawyerRuntimePilotManifest({ ...body, manifestHashSha256: sha256(body) })
}

export function mutateLawyerPilotToken(manifest: LawyerRuntimePilotManifest, name = '--lawyer-accent', value = '#1f5e46'): LawyerRuntimePilotManifest {
  if (!manifest.tokens.some((token) => token.name === name) || !/^#[a-fA-F0-9]{6}$/.test(value)) throw new LawyerRuntimePilotError('invalid', 'Shared Lawyer token mutation is invalid.')
  const { manifestHashSha256: _priorHash, ...body } = manifest
  const next = { ...body, tokens: manifest.tokens.map((token) => token.name === name ? { ...token, value } : token) }
  return validateLawyerRuntimePilotManifest({ ...next, manifestHashSha256: sha256(next) })
}

export type LawyerCanonicalRouteProjection = Readonly<{
  sourceRoute: string
  canonicalRoute: string
  templateId: string
  page: RuntimeNode
  layout: RuntimeNode
  publicDataKeys: readonly string[]
  exactComponentIds: readonly string[]
}>

const LAWYER_OFFICIAL_VERSIONS: Readonly<Record<string, string>> = Object.freeze({
  'base.container': '2.0.0',
  'base.outlet': '1.0.0',
  'base.loop': '1.0.0',
})
function official(componentId: string) {
  return Object.freeze({ namespace: 'fuma.official', componentId, exactVersion: LAWYER_OFFICIAL_VERSIONS[componentId] ?? '1.0.0' })
}
function runtimeNode(
  nodeId: string,
  componentId: string,
  input: Partial<RuntimeNode> = {},
): RuntimeNode {
  return parseRuntimeContract(RuntimeNodeSchema, {
    nodeId,
    component: official(componentId),
    props: input.props ?? {},
    classes: input.classes ?? [],
    styles: input.styles ?? [],
    requiredCapabilities: input.requiredCapabilities ?? [],
    bindings: input.bindings ?? [],
    slots: input.slots ?? [],
  }, `Lawyer canonical node ${nodeId}`) as RuntimeNode
}
function children(...nodes: RuntimeNode[]) { return [{ name: 'children', children: nodes }] }

export function projectLawyerCanonicalRoute(
  manifest: LawyerRuntimePilotManifest,
  input: Readonly<{ sourceRoute: string; canonicalRoute: string; contentId?: string }>,
): LawyerCanonicalRouteProjection {
  const mapping = manifest.routes.find((item) => item.sourceRoute === input.sourceRoute)
  if (!mapping || mapping.target !== 'react-page' || mapping.templateId === null) throw new LawyerRuntimePilotError('inventory', 'Requested Lawyer route is not a React cutover route.')
  if (!Value.Check(RuntimePath, input.canonicalRoute) || input.canonicalRoute.split('/').some((segment) => segment === '.' || segment === '..')) throw new LawyerRuntimePilotError('invalid', 'Concrete Lawyer route is not canonical.')
  const content = input.contentId ? manifest.content.find((item) => item.destinationId === input.contentId) : undefined
  if (input.contentId && !content) throw new LawyerRuntimePilotError('disconnected', 'Requested Lawyer content binding is unavailable.')
  if (mapping.accessBinding === 'content' && !content) throw new LawyerRuntimePilotError('disconnected', 'Content-routed Lawyer pages require an imported Fuma data binding.')

  const publicDataKeys = ['lawyer.route.title', 'lawyer.route.excerpt', 'lawyer.route.byline', 'lawyer.route.publishedAt', 'lawyer.route.body', 'lawyer.route.items']
  const access = mapping.accessBinding === 'content' ? content!.accessBinding : mapping.accessBinding === 'member' ? 'member' : 'public'
  const header = runtimeNode('lawyer-route-header', 'lawyer.editorial-header', {
    props: { eyebrow: 'The Lawyer', canonicalPath: input.canonicalRoute },
    bindings: [
      { prop: 'title', publicDataKey: 'lawyer.route.title' },
      { prop: 'excerpt', publicDataKey: 'lawyer.route.excerpt' },
      { prop: 'byline', publicDataKey: 'lawyer.route.byline' },
      { prop: 'publishedAt', publicDataKey: 'lawyer.route.publishedAt' },
    ],
  })
  const body = runtimeNode('lawyer-route-body', 'base.outlet', {
    props: { tag: 'article' },
    bindings: [{ prop: 'html', publicDataKey: 'lawyer.route.body' }],
  })
  const gate = runtimeNode('lawyer-route-access', 'lawyer.access-gate', { props: { requirement: access }, slots: children(body) })
  const story = runtimeNode('lawyer-story-variant', 'lawyer.story-card', {
    props: { title: '{{entry.title}}', excerpt: '{{entry.excerpt}}', href: '{{entry.href}}', section: '{{entry.section}}', image: '{{entry.image}}', imageAlt: '{{entry.imageAlt}}' },
  })
  const loop = runtimeNode('lawyer-route-loop', 'base.loop', {
    props: { tag: 'section' },
    bindings: [{ prop: 'items', publicDataKey: 'lawyer.route.items' }],
    slots: children(story),
  })

  let page: RuntimeNode
  if (mapping.templateId === 'lawyer-membership') page = runtimeNode('lawyer-membership-page', 'lawyer.membership-panel', { props: {} })
  else if (mapping.templateId === 'lawyer-account') page = runtimeNode('lawyer-account-gate', 'lawyer.access-gate', { props: { requirement: 'member' }, slots: children(runtimeNode('lawyer-account-page', 'lawyer.account-panel', { props: {} })) })
  else if (mapping.templateId === 'lawyer-home' || mapping.templateId === 'lawyer-editorial-index' || mapping.templateId === 'lawyer-podcast-index' || mapping.templateId === 'lawyer-newsletter') {
    page = runtimeNode('lawyer-index-page', 'base.container', { props: { tag: 'section' }, slots: children(header, loop) })
  } else page = runtimeNode('lawyer-content-page', 'base.container', { props: { tag: 'article' }, slots: children(header, gate, loop) })

  const navigation = [
    { label: 'Archive', href: '/archive' }, { label: 'Topics', href: '/topics' }, { label: 'Podcast', href: '/podcast' },
    { label: 'Newsletters', href: '/newsletters' }, { label: 'Membership', href: '/membership' },
  ]
  const layout = runtimeNode('lawyer-site-layout', 'lawyer.site-shell', {
    props: { navigation },
    slots: children(runtimeNode('lawyer-site-outlet', 'base.outlet', { props: { tag: 'div' } })),
  })
  const ids = new Set<string>()
  const visit = (node: RuntimeNode) => { ids.add(node.component.componentId); for (const slot of node.slots) for (const child of slot.children) visit(child) }
  visit(page); visit(layout)
  return deepFreeze({
    sourceRoute: input.sourceRoute,
    canonicalRoute: input.canonicalRoute,
    templateId: mapping.templateId,
    page,
    layout,
    publicDataKeys,
    exactComponentIds: [...ids].sort(),
  })
}

export function validateLawyerRuntimePilotManifest(raw: unknown): LawyerRuntimePilotManifest {
  const manifest = parseLawyerRuntimePilot(LawyerRuntimePilotManifestSchema, raw, 'Lawyer runtime pilot') as LawyerRuntimePilotManifest
  const { manifestHashSha256, ...body } = manifest
  if (manifestHashSha256 !== sha256(body)) throw new LawyerRuntimePilotError('invalid', 'Lawyer runtime pilot hash changed.')
  const routeSet = new Set(manifest.routes.map(({ sourceRoute }) => sourceRoute))
  const templateSet = new Set(manifest.templates.map(({ templateId }) => templateId))
  const componentSet = new Set(manifest.componentPack.components.map(({ componentId }) => componentId))
  if (routeSet.size !== 69 || manifest.content.some(({ templateId, connected }) => !connected || !templateSet.has(templateId))) {
    throw new LawyerRuntimePilotError('disconnected', 'Lawyer route/content mappings are incomplete or disconnected.')
  }
  for (const route of manifest.routes) {
    if (route.templateId !== null && !templateSet.has(route.templateId)) throw new LawyerRuntimePilotError('disconnected', `Lawyer route ${route.sourceRoute} has no shared template.`)
    if (route.internalLinks.some((link) => !routeSet.has(link))) throw new LawyerRuntimePilotError('disconnected', `Lawyer route ${route.sourceRoute} has a broken internal link.`)
  }
  if (manifest.templates.some(({ componentIds }) => componentIds.some((componentId) => !componentSet.has(componentId)))) {
    throw new LawyerRuntimePilotError('disconnected', 'Lawyer template references an unavailable source component.')
  }
  if (manifest.adapters.some(({ directProviderAccess }) => directProviderAccess) || manifest.reconciliation.directAccessGrants !== 0) {
    throw new LawyerRuntimePilotError('authority', 'Lawyer pilot cannot own provider or paid-access authority.')
  }
  return manifest
}

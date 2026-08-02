import { Type, type Static } from '@core/utils/typeboxHelpers'

const Strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const Slug = Type.String({ minLength: 1, maxLength: 160, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' })
const Timestamp = Type.String({ format: 'date-time' })
const HttpsUrl = Type.String({ minLength: 8, maxLength: 2_048, pattern: '^https://[^\\s]+$' })
const NullableId = Type.Union([Id, Type.Null()])
const NullableText = (maximum: number) => Type.Union([Type.String({ minLength: 1, maxLength: maximum }), Type.Null()])
const PublicationRedirectSchema = Type.Object({
  fromPath: Type.String({ minLength: 2, maxLength: 1_024, pattern: '^/(?!/)(?!.*[?#])[A-Za-z0-9._~!$&\\\'()*+,;=:@%/-]+$' }),
  toPath: Type.String({ minLength: 2, maxLength: 1_024, pattern: '^/(?!/)(?!.*[?#])[A-Za-z0-9._~!$&\\\'()*+,;=:@%/-]+$' }),
  statusCode: Type.Union([Type.Literal(301), Type.Literal(308)]),
}, Strict)
const PublicationOpenGraphSchema = Type.Object({
  title: NullableText(95),
  description: NullableText(300),
  imageId: NullableId,
  type: Type.Union([Type.Literal('article'), Type.Literal('website')]),
}, Strict)
const PublicationSocialMetadataSchema = Type.Object({
  title: NullableText(70),
  description: NullableText(200),
  imageId: NullableId,
  card: Type.Union([Type.Literal('summary'), Type.Literal('summary-large-image')]),
}, Strict)

export const ProviderNeutralBodySchema = Type.Object({
  format: Type.Union([Type.Literal('plain-text'), Type.Literal('markdown'), Type.Literal('html')]),
  value: Type.String({ maxLength: 262_144 }),
}, Strict)

export const ProviderNeutralContentViewSchema = Type.Object({
  contentId: Id,
  kind: Type.Union([Type.Literal('post'), Type.Literal('page')]),
  title: Type.String({ minLength: 1, maxLength: 300 }),
  slug: Slug,
  excerpt: Type.String({ maxLength: 1_000 }),
  body: Type.Union([ProviderNeutralBodySchema, Type.Null()]),
  status: Type.Union([
    Type.Literal('draft'), Type.Literal('in-review'), Type.Literal('approved'),
    Type.Literal('scheduled'), Type.Literal('published'), Type.Literal('unpublished'),
    Type.Literal('archived'),
  ]),
  workflowVersion: Type.Integer({ minimum: 1 }),
  canonicalUrl: Type.Union([HttpsUrl, Type.Null()]),
  redirects: Type.Array(PublicationRedirectSchema, { maxItems: 100 }),
  openGraph: PublicationOpenGraphSchema,
  social: PublicationSocialMetadataSchema,
  seoTitle: NullableText(70),
  seoDescription: NullableText(180),
  featureImageId: NullableId,
  tagIds: Type.Array(Id, { maxItems: 64, uniqueItems: true }),
  primaryTagId: NullableId,
  authorIds: Type.Array(Id, { minItems: 1, maxItems: 32, uniqueItems: true }),
  visibility: Type.Union([
    Type.Object({ kind: Type.Literal('public') }, Strict),
    Type.Object({ kind: Type.Literal('member') }, Strict),
    Type.Object({ kind: Type.Literal('paid') }, Strict),
    Type.Object({ kind: Type.Literal('segment'), segmentIds: Type.Array(Id, { minItems: 1, maxItems: 64, uniqueItems: true }) }, Strict),
  ]),
  scheduledAt: Type.Union([Timestamp, Type.Null()]),
  publishedAt: Type.Union([Timestamp, Type.Null()]),
  updatedAt: Timestamp,
}, Strict)

export const ListPublicationContentInputSchema = Type.Object({
  kind: Type.Union([Type.Literal('all'), Type.Literal('post'), Type.Literal('page')]),
  status: Type.Union([Type.Literal('all'), Type.Literal('draft'), Type.Literal('published'), Type.Literal('scheduled')]),
  query: Type.String({ maxLength: 160 }),
  afterId: NullableId,
  limit: Type.Integer({ minimum: 1, maximum: 100 }),
}, Strict)
export const ListPublicationContentOutputSchema = Type.Object({
  items: Type.Array(ProviderNeutralContentViewSchema, { maxItems: 100 }),
  nextAfterId: NullableId,
}, Strict)

export const GetPublicationContentInputSchema = Type.Object({ contentId: Id }, Strict)
export const GetPublicationContentOutputSchema = Type.Object({ item: Type.Union([ProviderNeutralContentViewSchema, Type.Null()]) }, Strict)

export const SavePublicationDraftInputSchema = Type.Object({
  contentId: Id,
  kind: Type.Union([Type.Literal('post'), Type.Literal('page')]),
  title: Type.String({ minLength: 1, maxLength: 300 }),
  slug: Slug,
  excerpt: Type.String({ maxLength: 1_000 }),
  body: ProviderNeutralBodySchema,
  canonicalUrl: Type.Union([HttpsUrl, Type.Null()]),
  redirects: Type.Array(PublicationRedirectSchema, { maxItems: 100 }),
  openGraph: PublicationOpenGraphSchema,
  social: PublicationSocialMetadataSchema,
  seoTitle: NullableText(70),
  seoDescription: NullableText(180),
  featureImageId: NullableId,
  tagIds: Type.Array(Id, { maxItems: 64, uniqueItems: true }),
  primaryTagId: NullableId,
  authorIds: Type.Array(Id, { minItems: 1, maxItems: 32, uniqueItems: true }),
  visibility: ProviderNeutralContentViewSchema.properties.visibility,
  expectedVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
}, Strict)
export const SavePublicationDraftOutputSchema = Type.Object({ item: ProviderNeutralContentViewSchema }, Strict)

export const RequestPublicationInputSchema = Type.Object({
  contentId: Id,
  from: Type.Union([Type.Literal('draft'), Type.Literal('approved'), Type.Literal('scheduled'), Type.Literal('unpublished')]),
  to: Type.Union([Type.Literal('published'), Type.Literal('scheduled')]),
  expectedVersion: Type.Integer({ minimum: 1 }),
  scheduledAt: Type.Union([Timestamp, Type.Null()]),
  note: Type.String({ maxLength: 500 }),
}, Strict)
export const RequestPublicationOutputSchema = Type.Object({ item: ProviderNeutralContentViewSchema }, Strict)

const AuthorView = Type.Object({
  authorId: Id,
  displayName: Type.String({ minLength: 1, maxLength: 160 }),
  image: Type.Union([HttpsUrl, Type.Null()]),
}, Strict)
const TagView = Type.Object({
  tagId: Id,
  name: Type.String({ minLength: 1, maxLength: 120 }),
  slug: Slug,
  description: Type.String({ maxLength: 500 }),
}, Strict)
export const ListPublicationTaxonomyInputSchema = Type.Object({}, Strict)
export const ListPublicationTaxonomyOutputSchema = Type.Object({
  authors: Type.Array(AuthorView, { maxItems: 500 }),
  tags: Type.Array(TagView, { maxItems: 500 }),
}, Strict)

export const GetPublicationSettingsInputSchema = Type.Object({}, Strict)
export const GetPublicationSettingsOutputSchema = Type.Object({
  settings: Type.Union([Type.Object({
    publicationId: Id,
    name: Type.String({ minLength: 1, maxLength: 160 }),
    description: Type.String({ maxLength: 500 }),
    language: Type.String({ minLength: 2, maxLength: 35 }),
    timezone: Type.String({ minLength: 1, maxLength: 100 }),
    version: Type.Integer({ minimum: 1 }),
    updatedAt: Timestamp,
  }, Strict), Type.Null()]),
}, Strict)

export const ListNewslettersInputSchema = Type.Object({ limit: Type.Integer({ minimum: 1, maximum: 100 }) }, Strict)
export const ListNewslettersOutputSchema = Type.Object({
  items: Type.Array(Type.Object({
    newsletterId: Id,
    name: Type.String({ minLength: 1, maxLength: 160 }),
    slug: Slug,
    description: Type.String({ maxLength: 500 }),
    status: Type.Union([Type.Literal('active'), Type.Literal('paused'), Type.Literal('archived')]),
    defaultSegmentId: NullableId,
    updatedAt: Timestamp,
  }, Strict), { maxItems: 100 }),
}, Strict)

export const EvaluatePublicationAccessInputSchema = Type.Object({
  contentId: Id,
  mode: Type.Union([Type.Literal('public'), Type.Literal('preview')]),
  origin: HttpsUrl,
  requestedPath: Type.String({ minLength: 1, maxLength: 1_024, pattern: '^/(?!/)(?!.*[?#])' }),
}, Strict)
export const EvaluatePublicationAccessOutputSchema = Type.Object({
  member: Type.Boolean(),
  paid: Type.Boolean(),
  accessState: Type.Union([
    Type.Literal('anonymous'), Type.Literal('active'), Type.Literal('grace'),
    Type.Literal('expired'), Type.Literal('revoked'), Type.Literal('disabled'),
  ]),
  delivery: Type.Union([Type.Literal('render'), Type.Literal('redirect'), Type.Literal('deny'), Type.Literal('unavailable')]),
  statusCode: Type.Union([Type.Literal(200), Type.Literal(301), Type.Literal(308), Type.Literal(403), Type.Literal(404)]),
  reason: Type.String({ minLength: 1, maxLength: 64 }),
}, Strict)

export const PublicationAnalyticsReportInputSchema = Type.Object({
  from: Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }),
  to: Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }),
}, Strict)
export const PublicationAnalyticsReportOutputSchema = Type.Object({
  siteReads: Type.Integer({ minimum: 0 }),
  postReads: Type.Integer({ minimum: 0 }),
  publicReads: Type.Integer({ minimum: 0 }),
  memberReads: Type.Integer({ minimum: 0 }),
  newsletterOpens: Type.Integer({ minimum: 0 }),
  newsletterClicks: Type.Integer({ minimum: 0 }),
  subscriptions: Type.Integer({ minimum: 0 }),
  unsubscriptions: Type.Integer({ minimum: 0 }),
}, Strict)

export type ProviderNeutralContentView = Readonly<Static<typeof ProviderNeutralContentViewSchema>>
export type ListPublicationContentInput = Readonly<Static<typeof ListPublicationContentInputSchema>>
export type SavePublicationDraftInput = Readonly<Static<typeof SavePublicationDraftInputSchema>>
export type RequestPublicationInput = Readonly<Static<typeof RequestPublicationInputSchema>>
export type EvaluatePublicationAccessInput = Readonly<Static<typeof EvaluatePublicationAccessInputSchema>>
export type PublicationAnalyticsReportInput = Readonly<Static<typeof PublicationAnalyticsReportInputSchema>>

export const PROVIDER_NEUTRAL_CAPABILITY_IDS = Object.freeze({
  listContent: 'publication.content.list',
  getContent: 'publication.content.get',
  saveDraft: 'publication.content.save-draft',
  requestPublication: 'publication.content.request-publication',
  listTaxonomy: 'publication.taxonomy.list',
  getSettings: 'publication.settings.get',
  listNewsletters: 'publication.newsletter.list',
  evaluateAccess: 'publication.access.evaluate',
  analyticsReport: 'publication.analytics.report',
} as const)

export type ProviderNeutralCapabilityId = typeof PROVIDER_NEUTRAL_CAPABILITY_IDS[keyof typeof PROVIDER_NEUTRAL_CAPABILITY_IDS]
export type ProviderNeutralCoverageState = 'active' | 'blocked' | 'deferred'
export type ProviderNeutralCoverageRow = Readonly<{
  function: string
  capabilityId: ProviderNeutralCapabilityId | null
  state: ProviderNeutralCoverageState
  authority: string
  diagnostic: string | null
}>

export const PROVIDER_NEUTRAL_COVERAGE_MATRIX: readonly ProviderNeutralCoverageRow[] = Object.freeze([
  { function: 'publishing/blogging/content list', capabilityId: PROVIDER_NEUTRAL_CAPABILITY_IDS.listContent, state: 'active', authority: 'PublicationDomainStore', diagnostic: null },
  { function: 'publishing/blogging/content read', capabilityId: PROVIDER_NEUTRAL_CAPABILITY_IDS.getContent, state: 'active', authority: 'PublicationDomainStore', diagnostic: null },
  { function: 'publishing/blogging draft + SEO/social/canonical metadata', capabilityId: PROVIDER_NEUTRAL_CAPABILITY_IDS.saveDraft, state: 'active', authority: 'PublicationEditorialService', diagnostic: null },
  { function: 'publishing protected publish/schedule request', capabilityId: PROVIDER_NEUTRAL_CAPABILITY_IDS.requestPublication, state: 'active', authority: 'PublicationEditorialService', diagnostic: null },
  { function: 'authors/tags', capabilityId: PROVIDER_NEUTRAL_CAPABILITY_IDS.listTaxonomy, state: 'active', authority: 'PublicationDomainStore', diagnostic: null },
  { function: 'publication identity/settings', capabilityId: PROVIDER_NEUTRAL_CAPABILITY_IDS.getSettings, state: 'active', authority: 'PublicationIdentityService', diagnostic: null },
  { function: 'newsletter inventory', capabilityId: PROVIDER_NEUTRAL_CAPABILITY_IDS.listNewsletters, state: 'active', authority: 'PublicationDomainStore', diagnostic: null },
  { function: 'member/subscription access evaluation', capabilityId: PROVIDER_NEUTRAL_CAPABILITY_IDS.evaluateAccess, state: 'active', authority: 'PublicationMemberAccessService', diagnostic: null },
  { function: 'privacy-preserving conversion report', capabilityId: PROVIDER_NEUTRAL_CAPABILITY_IDS.analyticsReport, state: 'active', authority: 'PublicationPrivacyAnalyticsService', diagnostic: null },
  { function: 'media inventory/upload', capabilityId: null, state: 'blocked', authority: 'media repository', diagnostic: 'CAPABILITY_AUTHORITY_UNSCOPED: hosted owner-generation media adapter is not reviewed.' },
  { function: 'member registration/session', capabilityId: null, state: 'blocked', authority: 'MemberAuthenticationService', diagnostic: 'CAPABILITY_CHANNEL_FORBIDDEN: passwords and member sessions cannot transit Site AI or MCP.' },
  { function: 'newsletter subscribe/unsubscribe', capabilityId: null, state: 'blocked', authority: 'PublicationMemberAccessService/public unsubscribe boundary', diagnostic: 'CAPABILITY_SUBJECT_AUTHORITY_REQUIRED: current member/one-click provenance is unavailable to staff AI.' },
  { function: 'paid subscription initialization', capabilityId: null, state: 'blocked', authority: 'CustomerMerchantPaymentService', diagnostic: 'CAPABILITY_OWNER_MEMBER_CONFIRMATION_REQUIRED: current payer authority remains unchanged.' },
  { function: 'podcast/audio feed', capabilityId: null, state: 'blocked', authority: 'none', diagnostic: 'CAPABILITY_AUTHORITY_MISSING: no reviewed podcast feed authority exists.' },
  { function: 'forms submission', capabilityId: null, state: 'blocked', authority: 'public form challenge boundary', diagnostic: 'CAPABILITY_BROWSER_CHALLENGE_REQUIRED: AI cannot bypass origin, challenge, honeypot, and rate controls.' },
  { function: 'lead/contact capture', capabilityId: null, state: 'blocked', authority: 'public form challenge boundary', diagnostic: 'CAPABILITY_BROWSER_CHALLENGE_REQUIRED: leads must use the canonical public form flow.' },
  { function: 'navigation read/write', capabilityId: null, state: 'blocked', authority: 'editor snapshot', diagnostic: 'CAPABILITY_AUTHORITY_MISSING: no durable owner-generation navigation authority exists.' },
  { function: 'search', capabilityId: null, state: 'blocked', authority: 'data row search repository', diagnostic: 'CAPABILITY_AUTHORITY_UNSCOPED: hosted scoped search adapter is not reviewed.' },
  { function: 'agency portfolio/team/services/testimonials/case-study', capabilityId: null, state: 'blocked', authority: 'universal data tables/rows', diagnostic: 'CAPABILITY_AUTHORITY_UNSCOPED: generic hosted collection adapter lacks owner-generation scope.' },
  { function: 'landing sections/conversion mutation', capabilityId: null, state: 'blocked', authority: 'editor/public analytics adapters', diagnostic: 'CAPABILITY_CHANNEL_FORBIDDEN: editor mutation and visitor-consent context cannot be forged by AI.' },
  { function: 'ecommerce/catalog/cart/order/inventory/checkout', capabilityId: null, state: 'deferred', authority: 'none', diagnostic: 'CAPABILITY_DEFERRED_ECOMMERCE: Paystack and commerce scope are unchanged.' },
])

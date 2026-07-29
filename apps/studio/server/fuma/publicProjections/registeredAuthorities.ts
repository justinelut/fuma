import {
  PublicComponentSchema,
  PublicExpertSchema,
  PublicPluginSchema,
  PublicProfileSchema,
  PublicShowcaseSchema,
  type PublicComponent,
  type PublicExpert,
  type PublicPlugin,
  type PublicPricingPlan,
  type PublicProductFact,
  type PublicProjectionResource,
  type PublicShowcase,
  type PublicTemplate,
} from '@fuma/public-contracts'
import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { fumaLaunchRegistry, type FumaRegistry } from '@core/fuma'
import type { DbClient } from '../../db/client'
import { PostgresPublicTemplateCatalogRepository, PostgresTemplateReleaseAuthority } from '../publicTemplates/postgres'
import { ApprovedTemplatesProjectionSource } from '../publicTemplates/projection'
import { ApprovedPricingProjectionSource } from './pricingAuthority'
import { PublicTemplateCatalogService } from '../publicTemplates/service'
import {
  PublicProjectionAuthorityCatalog,
  PublicProjectionInvalidRequestError,
  PublicProjectionUnavailableError,
} from './authority'
import {
  createValidatedPublicProjectionAdapter,
  type ApprovedPublicProjectionSource,
} from './adapters/validatedDomainAdapter'

const DEFAULT_PAGE_SIZE = 24
const PRODUCT_FACTS_UPDATED_AT = '2026-07-26T00:00:00.000Z'
const ExpertPublicMetadataSchema = Type.Object({
  id: PublicExpertSchema.properties.id,
  slug: PublicExpertSchema.properties.slug,
  summary: PublicExpertSchema.properties.summary,
  location: PublicExpertSchema.properties.location,
  skills: PublicExpertSchema.properties.skills,
  services: PublicExpertSchema.properties.services,
  showcaseIds: PublicExpertSchema.properties.showcaseIds,
  mediatedInquiryAvailable: PublicExpertSchema.properties.mediatedInquiryAvailable,
  imageUrl: PublicExpertSchema.properties.imageUrl,
  showcases: Type.Array(PublicShowcaseSchema, { maxItems: 24 }),
}, { additionalProperties: false })
const PluginPublicMetadataSchema = Type.Object({
  id: PublicPluginSchema.properties.id,
  slug: PublicPluginSchema.properties.slug,
  name: PublicPluginSchema.properties.name,
  summary: PublicPluginSchema.properties.summary,
  categories: PublicPluginSchema.properties.categories,
  publisherName: PublicPluginSchema.properties.publisherName,
  publisherVerified: Type.Literal(true),
  permissionLabels: PublicPluginSchema.properties.permissionLabels,
  imageUrl: PublicPluginSchema.properties.imageUrl,
}, { additionalProperties: false })

interface ExpertRow {
  kind: PublicExpert['expertType']
  display_name: string
  profile_json: unknown
  approved_at: string | Date
}

interface PluginRow {
  version: string
  public_json: unknown
  decided_at: string | Date
}

type PublicPageItem = PublicProductFact | PublicPricingPlan | PublicTemplate | PublicShowcase | PublicExpert | PublicPlugin | PublicComponent

type PublicPage = Readonly<{
  items: readonly PublicPageItem[]
  page: Readonly<{ hasMore: true; nextCursor: string } | { hasMore: false; nextCursor: null }>
}>

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

async function contentVersion(resource: PublicProjectionResource, items: readonly PublicPageItem[]): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(items))))
  return `${resource}:sha256:${[...digest].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function pageLimit(query: Readonly<Record<string, string | number>>): number {
  const limit = query.limit ?? DEFAULT_PAGE_SIZE
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new PublicProjectionInvalidRequestError('Invalid public projection limit.')
  }
  return limit
}

function cursorFor(offset: number, datasetVersion: string): string {
  return `p_${offset}_${datasetVersion.slice(-16)}`
}

function cursorOffset(query: Readonly<Record<string, string | number>>, datasetVersion: string, itemCount: number): number {
  const cursor = query.cursor
  if (cursor === undefined) return 0
  if (typeof cursor !== 'string') throw new PublicProjectionInvalidRequestError('Invalid public projection cursor.')
  const match = /^p_([0-9]{1,10})_([a-f0-9]{16})$/.exec(cursor)
  const offset = match ? Number(match[1]) : Number.NaN
  if (!match || match[2] !== datasetVersion.slice(-16) || !Number.isSafeInteger(offset) || offset < 1 || offset >= itemCount) {
    throw new PublicProjectionInvalidRequestError('Invalid or stale public projection cursor.')
  }
  return offset
}

async function paginate(
  resource: PublicProjectionResource,
  allItems: readonly PublicPageItem[],
  filteredItems: readonly PublicPageItem[],
  query: Readonly<Record<string, string | number>>,
): Promise<Readonly<{ datasetVersion: string; data: PublicPage }>> {
  const datasetVersion = await contentVersion(resource, allItems)
  const offset = cursorOffset(query, datasetVersion, filteredItems.length)
  const limit = pageLimit(query)
  const items = filteredItems.slice(offset, offset + limit)
  const nextOffset = offset + items.length
  const page = nextOffset < filteredItems.length
    ? { hasMore: true as const, nextCursor: cursorFor(nextOffset, datasetVersion) }
    : { hasMore: false as const, nextCursor: null }
  return Object.freeze({ datasetVersion, data: Object.freeze({ items: Object.freeze(items), page: Object.freeze(page) }) })
}

function publicProfiles(registry: FumaRegistry): readonly PublicProductFact[] {
  return registry.profiles.flatMap((profile) => {
    if (!Value.Check(PublicProfileSchema, profile.id)) return []
    const composition = registry.compose(profile.id)
    const featureKeys = composition.capabilities
      .map(({ id }) => id.replaceAll('.', '-'))
      .filter((id, index, values) => values.indexOf(id) === index)
      .slice(0, 24)
    return [Object.freeze({
      id: `product_${profile.id}`,
      slug: profile.id,
      name: profile.label,
      summary: profile.subtitle ?? 'Visual website building, content management, and clean publishing.',
      profiles: Object.freeze([profile.id]),
      available: true,
      featureKeys: Object.freeze(featureKeys),
      updatedAt: PRODUCT_FACTS_UPDATED_AT,
    }) as PublicProductFact]
  }).toSorted((left, right) => left.id.localeCompare(right.id))
}

class ProductFactsSource implements ApprovedPublicProjectionSource {
  readonly #registry: FumaRegistry
  constructor(registry: FumaRegistry) { this.#registry = registry }

  async readApprovedDisplayPage(query: Readonly<Record<string, string | number>>) {
    const items = publicProfiles(this.#registry)
    const profile = query.profile
    const filtered = typeof profile === 'string'
      ? items.filter((item) => item.profiles.includes(profile as 'website' | 'publication'))
      : items
    return paginate('product-facts', items, filtered, query)
  }
}

async function approvedExpertRows(db: DbClient): Promise<readonly ExpertRow[]> {
  const { rows } = await db<ExpertRow>`
    select p.kind, p.display_name, p.profile_json, r.approved_at
    from fuma_expert_profiles p
    join fuma_expert_public_releases r on r.release_id = p.approved_release_id and r.expert_id = p.expert_id
    join fuma_expert_attribution_consents ec on ec.release_id = r.release_id and ec.party_kind = 'expert' and ec.revoked_at is null
    join fuma_expert_attribution_consents sc on sc.release_id = r.release_id and sc.party_kind = 'site-owner' and sc.revoked_at is null
    join fuma_organization_profiles o on o.organization_id = p.organization_id and o.kind = 'customer' and o.status = 'active'
    where p.opted_in and not p.suspended and r.withdrawn_at is null
      and not exists (
        select 1 from fuma_moderation_evidence m
        where m.subject_kind = 'expert' and m.subject_id = p.expert_id and m.state = 'suspended'
          and not exists (
            select 1 from fuma_moderation_evidence resolved
            where resolved.subject_kind = 'expert' and resolved.subject_id = p.expert_id
              and resolved.state = 'resolved' and resolved.created_at > m.created_at
          )
      )
    order by p.public_revision desc, p.expert_id
  `
  return rows
}

function expertMetadata(row: ExpertRow): typeof ExpertPublicMetadataSchema.static {
  const value = typeof row.profile_json === 'object' && row.profile_json !== null
    ? (row.profile_json as Record<string, unknown>).public
    : undefined
  if (!Value.Check(ExpertPublicMetadataSchema, value)) {
    throw new PublicProjectionUnavailableError('Approved expert public data failed validation.')
  }
  return value
}

function mapExpert(row: ExpertRow): PublicExpert {
  const metadata = expertMetadata(row)
  const item = {
    id: metadata.id,
    slug: metadata.slug,
    publicName: row.display_name,
    summary: metadata.summary,
    expertType: row.kind,
    location: metadata.location,
    skills: metadata.skills,
    services: metadata.services,
    showcaseIds: metadata.showcaseIds,
    mediatedInquiryAvailable: metadata.mediatedInquiryAvailable,
    imageUrl: metadata.imageUrl,
    approvedAt: new Date(row.approved_at).toISOString(),
  }
  if (!Value.Check(PublicExpertSchema, item)) throw new PublicProjectionUnavailableError('Approved expert row failed validation.')
  return item
}

class ExpertsSource implements ApprovedPublicProjectionSource {
  readonly #db: DbClient
  constructor(db: DbClient) { this.#db = db }

  async readApprovedDisplayPage(query: Readonly<Record<string, string | number>>) {
    const items = (await approvedExpertRows(this.#db)).map(mapExpert)
    const filtered = items.filter((item) => (
      (query.expertType === undefined || item.expertType === query.expertType)
      && (query.skill === undefined || item.skills.includes(String(query.skill)))
      && (query.location === undefined || item.location.toLowerCase().replace(/[^a-z0-9]+/g, '-') === query.location)
    ))
    return paginate('experts', items, filtered, query)
  }
}

class ShowcasesSource implements ApprovedPublicProjectionSource {
  readonly #db: DbClient
  constructor(db: DbClient) { this.#db = db }

  async readApprovedDisplayPage(query: Readonly<Record<string, string | number>>) {
    const items = (await approvedExpertRows(this.#db))
      .flatMap((row) => [...expertMetadata(row).showcases])
      .toSorted((left, right) => left.id.localeCompare(right.id))
    const filtered = items.filter((item) => (
      (query.profile === undefined || item.profiles.includes(query.profile as 'website' | 'publication'))
      && (query.industry === undefined || item.industries.includes(String(query.industry)))
    ))
    return paginate('showcases', items, filtered, query)
  }
}

function pluginMetadata(row: PluginRow): typeof PluginPublicMetadataSchema.static {
  const value = row.public_json
  if (!Value.Check(PluginPublicMetadataSchema, value)) {
    throw new PublicProjectionUnavailableError('Reviewed plugin public data failed validation.')
  }
  return value
}

class PluginsSource implements ApprovedPublicProjectionSource {
  readonly #db: DbClient
  constructor(db: DbClient) { this.#db = db }

  async readApprovedDisplayPage(query: Readonly<Record<string, string | number>>) {
    const { rows } = await this.#db<PluginRow>`
      select distinct on (submission.package_id)
        submission.exact_version as version,
        submission.submission_json->'metadata'->'public' as public_json,
        decision.decided_at
      from fuma_artifact_review_submissions_v2 submission
      join fuma_artifact_review_decisions_v2 decision on decision.submission_id=submission.submission_id
        and decision.artifact_id=submission.artifact_id and decision.content_hash_sha256=submission.content_hash_sha256
      left join fuma_artifact_review_revocations_v2 revocation on revocation.decision_id=decision.decision_id
      where submission.artifact_kind='plugin' and submission.scan_state='clean'
        and decision.decision='approved' and decision.signature_key_id is not null
        and decision.signature_payload_hash_sha256 is not null and decision.signature_value is not null
        and revocation.decision_id is null
      order by submission.package_id,decision.decided_at desc,submission.exact_version desc
    `
    const items = rows.map((row): PublicPlugin => {
      const metadata = pluginMetadata(row)
      const item = {
        ...metadata,
        version: row.version,
        permissionLabels: metadata.permissionLabels,
        reviewedAt: new Date(row.decided_at).toISOString(),
      }
      if (!Value.Check(PublicPluginSchema, item)) throw new PublicProjectionUnavailableError('Reviewed plugin row failed validation.')
      return item
    }).toSorted((left, right) => left.id.localeCompare(right.id))
    const filtered = items.filter((item) => query.category === undefined || item.categories.includes(String(query.category)))
    return paginate('plugins', items, filtered, query)
  }
}

export function createHostedPublicProjectionAuthorityCatalog(
  db: DbClient,
  registry: FumaRegistry = fumaLaunchRegistry,
): PublicProjectionAuthorityCatalog {
  if (db.dialect !== 'postgres') {
    throw new PublicProjectionUnavailableError('Hosted public projections require PostgreSQL authority.')
  }

class ComponentsSource implements ApprovedPublicProjectionSource {
  readonly db: DbClient
  constructor(db: DbClient) { this.db = db }
  async readApprovedDisplayPage(query: Readonly<Record<string, string | number>>) {
    const { rows } = await this.db<PluginRow>`
      select distinct on (submission.package_id) submission.exact_version as version,
        submission.submission_json->'metadata'->'public' as public_json, decision.decided_at
      from fuma_artifact_review_submissions_v2 submission
      join fuma_artifact_review_decisions_v2 decision on decision.submission_id=submission.submission_id
        and decision.artifact_id=submission.artifact_id and decision.content_hash_sha256=submission.content_hash_sha256
      left join fuma_artifact_review_revocations_v2 revocation on revocation.decision_id=decision.decision_id
      where submission.artifact_kind='component-pack' and submission.scan_state='clean'
        and decision.decision='approved' and decision.signature_key_id is not null
        and decision.signature_payload_hash_sha256 is not null and decision.signature_value is not null
        and revocation.decision_id is null
      order by submission.package_id,decision.decided_at desc,submission.exact_version desc
    `
    const items = rows.map((row): PublicComponent => {
      const metadata = pluginMetadata(row)
      const item = { ...metadata, version: row.version, reviewedAt: new Date(row.decided_at).toISOString(), artifactKind: 'component-pack' as const }
      if (!Value.Check(PublicComponentSchema, item)) throw new PublicProjectionUnavailableError('Reviewed component row failed validation.')
      return item
    }).toSorted((left, right) => left.id.localeCompare(right.id))
    const filtered = items.filter((item) => query.category === undefined || item.categories.includes(String(query.category)))
    return paginate('components', items, filtered, query)
  }
}
  const catalog = new PublicProjectionAuthorityCatalog()
  const templateCatalog = new PublicTemplateCatalogService(
    new PostgresPublicTemplateCatalogRepository(db),
    new PostgresTemplateReleaseAuthority(db),
  )
  const sources: Readonly<Record<PublicProjectionResource, ApprovedPublicProjectionSource>> = Object.freeze({
    'product-facts': new ProductFactsSource(registry),
    pricing: new ApprovedPricingProjectionSource(db),
    templates: new ApprovedTemplatesProjectionSource(templateCatalog),
    showcases: new ShowcasesSource(db),
    experts: new ExpertsSource(db),
    plugins: new PluginsSource(db),
    components: new ComponentsSource(db),
  })
  for (const resource of Object.keys(sources) as PublicProjectionResource[]) {
    catalog.register(resource, createValidatedPublicProjectionAdapter(resource, sources[resource]))
  }
  return catalog
}

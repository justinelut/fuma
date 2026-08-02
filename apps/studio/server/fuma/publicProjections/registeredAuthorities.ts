import {
  PublicProfileSchema,
  type PublicProductFact,
  type PublicProjectionResource,
} from '@fuma/public-contracts'
import { Value } from '@sinclair/typebox/value'
import { fumaLaunchRegistry, type FumaRegistry } from '@core/fuma'
import type { DbClient } from '../../db/client'
import { PostgresPublicTemplateCatalogRepository, PostgresTemplateReleaseAuthority } from '../publicTemplates/postgres'
import { ApprovedTemplatesProjectionSource } from '../publicTemplates/projection'
import { PublicTemplateCatalogService } from '../publicTemplates/service'
import { createValidatedPublicProjectionAdapter, type ApprovedPublicProjectionSource } from './adapters/validatedDomainAdapter'
import { PublicProjectionAuthorityCatalog, PublicProjectionUnavailableError } from './authority'
import { ApprovedExpertsProjectionSource, ApprovedShowcasesProjectionSource } from './expertShowcaseProjection'
import { paginatePublicDiscovery } from './discoveryPagination'
import { ApprovedPricingProjectionSource } from './pricingAuthority'
import { ApprovedReviewedArtifactsProjectionSource } from './reviewedArtifactProjection'

const PRODUCT_FACTS_UPDATED_AT = '2026-07-26T00:00:00.000Z'

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
    const filteredItems = typeof profile === 'string'
      ? items.filter((item) => item.profiles.includes(profile as 'website' | 'publication'))
      : items
    const result = await paginatePublicDiscovery({ resource: 'product-facts', allItems: items, filteredItems, facets: {}, query })
    return Object.freeze({
      datasetVersion: result.datasetVersion,
      data: Object.freeze({ items: result.data.items, page: result.data.page }),
    })
  }
}

/**
 * Registers read-only adapters over the canonical FUMA-073, FUMA-068 and
 * FUMA-SITE-008 PostgreSQL authorities. It creates no approval, ranking,
 * marketplace, moderation, installation, inquiry, cache or identity authority.
 */
export function createHostedPublicProjectionAuthorityCatalog(
  db: DbClient,
  registry: FumaRegistry = fumaLaunchRegistry,
): PublicProjectionAuthorityCatalog {
  if (db.dialect !== 'postgres') {
    throw new PublicProjectionUnavailableError('Hosted public projections require PostgreSQL authority.')
  }
  const templateCatalog = new PublicTemplateCatalogService(
    new PostgresPublicTemplateCatalogRepository(db),
    new PostgresTemplateReleaseAuthority(db),
  )
  const sources: Readonly<Record<PublicProjectionResource, ApprovedPublicProjectionSource>> = Object.freeze({
    'product-facts': new ProductFactsSource(registry),
    pricing: new ApprovedPricingProjectionSource(db),
    templates: new ApprovedTemplatesProjectionSource(templateCatalog),
    showcases: new ApprovedShowcasesProjectionSource(db),
    experts: new ApprovedExpertsProjectionSource(db),
    plugins: new ApprovedReviewedArtifactsProjectionSource(db, 'plugins'),
    components: new ApprovedReviewedArtifactsProjectionSource(db, 'components'),
  })
  const catalog = new PublicProjectionAuthorityCatalog()
  for (const resource of Object.keys(sources) as PublicProjectionResource[]) {
    catalog.register(resource, createValidatedPublicProjectionAdapter(resource, sources[resource]))
  }
  return catalog
}

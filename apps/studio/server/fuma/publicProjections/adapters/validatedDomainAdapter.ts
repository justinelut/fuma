import {
  PublicDatasetVersionSchema, PublicExpertsPageSchema, PublicPluginsPageSchema, PublicPricingCatalogPageSchema,
  PublicProductFactsPageSchema, PublicShowcasesPageSchema, PublicTemplatesPageSchema,
  type PublicProjectionResource,
} from '@fuma/public-contracts'
import type { TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { PublicProjectionAuthority, PublicProjectionAuthorityInput, PublicProjectionAuthorityResult } from '../authority'
import { PublicProjectionUnavailableError } from '../authority'

/** Domain services own approval, ranking, withdrawal and stable IDs. This port accepts only their display-safe page. */
export interface ApprovedPublicProjectionSource {
  readApprovedDisplayPage(query: Readonly<Record<string, string | number>>): Promise<Readonly<{ datasetVersion: unknown; data: unknown }>>
}

const PAGE_SCHEMAS: Readonly<Record<PublicProjectionResource, TSchema>> = Object.freeze({
  'product-facts': PublicProductFactsPageSchema,
  pricing: PublicPricingCatalogPageSchema,
  templates: PublicTemplatesPageSchema,
  showcases: PublicShowcasesPageSchema,
  experts: PublicExpertsPageSchema,
  plugins: PublicPluginsPageSchema,
})

export class ValidatedPublicProjectionAdapter implements PublicProjectionAuthority {
  readonly #resource: PublicProjectionResource
  readonly #source: ApprovedPublicProjectionSource
  constructor(resource: PublicProjectionResource, source: ApprovedPublicProjectionSource) { this.#resource = resource; this.#source = source }
  async read(input: PublicProjectionAuthorityInput): Promise<PublicProjectionAuthorityResult> {
    if (input.resource !== this.#resource) throw new PublicProjectionUnavailableError('Projection resource mismatch.')
    const result = await this.#source.readApprovedDisplayPage(input.query)
    if (!Value.Check(PublicDatasetVersionSchema, result.datasetVersion) || !Value.Check(PAGE_SCHEMAS[this.#resource], result.data)) {
      throw new PublicProjectionUnavailableError('Domain projection failed public validation.')
    }
    const page = result.data as { items: readonly { id: string }[] }
    if (new Set(page.items.map(item => item.id)).size !== page.items.length) throw new PublicProjectionUnavailableError('Domain projection IDs are not unique.')
    return Object.freeze({ datasetVersion: result.datasetVersion, data: result.data })
  }
}

export function createValidatedPublicProjectionAdapter(resource: PublicProjectionResource, source: ApprovedPublicProjectionSource): PublicProjectionAuthority {
  return new ValidatedPublicProjectionAdapter(resource, source)
}

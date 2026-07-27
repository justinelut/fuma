import type { PublicProjectionResource } from '@fuma/public-contracts'

export type PublicProjectionAuthorityResult = Readonly<{
  datasetVersion: unknown
  data: unknown
}>

export type PublicProjectionAuthorityInput = Readonly<{
  resource: PublicProjectionResource
  query: Readonly<Record<string, string | number>>
}>

export interface PublicProjectionAuthority {
  read(input: PublicProjectionAuthorityInput): Promise<unknown>
}

export class PublicProjectionUnavailableError extends Error {
  override readonly name = 'PublicProjectionUnavailableError'
}

export class PublicProjectionInvalidRequestError extends Error {
  override readonly name = 'PublicProjectionInvalidRequestError'
}

/**
 * Domain owners register their display-safe projection authority here. The
 * catalog deliberately has no fallback records: an unregistered authority is
 * unavailable rather than guessed from Web copy, provider data, or tenant DBs.
 */
export class PublicProjectionAuthorityCatalog implements PublicProjectionAuthority {
  readonly #authorities = new Map<PublicProjectionResource, PublicProjectionAuthority>()

  register(resource: PublicProjectionResource, authority: PublicProjectionAuthority): void {
    if (this.#authorities.has(resource)) {
      throw new Error(`Public projection authority ${resource} is already registered.`)
    }
    this.#authorities.set(resource, authority)
  }

  async read(input: PublicProjectionAuthorityInput): Promise<unknown> {
    const authority = this.#authorities.get(input.resource)
    if (!authority) throw new PublicProjectionUnavailableError('Public projection authority is unavailable.')
    return authority.read(input)
  }
}

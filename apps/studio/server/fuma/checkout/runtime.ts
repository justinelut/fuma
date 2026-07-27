import type { DbClient } from '../../db/client'
import {
  EntitlementError,
  type EntitlementService,
} from '../entitlements'
import type {
  PaystackPurposeRegistry,
  ScopedPaystackTransport,
} from '../paystack/transport'
import {
  PlatformCheckoutError,
  type PlatformCheckoutChannel,
  type PlatformCheckoutOfferAcceptanceAuthority,
} from './contracts'
import { PostgresPlatformCheckoutRepository } from './postgres'
import {
  createPlatformCheckoutScopedRouteDeclarations,
  type PlatformCheckoutPayerSession,
} from './routes'
import {
  PlatformCheckoutService,
  registerPlatformCheckoutPurposes,
} from './service'

class EntitlementCheckoutOfferAcceptanceAuthority
implements PlatformCheckoutOfferAcceptanceAuthority {
  readonly #service: EntitlementService

  constructor(service: EntitlementService) {
    this.#service = service
  }

  async acceptExactIssuedOffer(input: Readonly<{
    offerId: string
    offerVersion: number
    destination: Readonly<{
      organizationId: string
      workspaceId: string
      siteId: string
      profileId: string
    }>
  }>): Promise<void> {
    try {
      await this.#service.accept({
        offerId: input.offerId,
        version: input.offerVersion,
        destinationOrganizationId: input.destination.organizationId,
        destinationWorkspaceId: input.destination.workspaceId,
        siteId: input.destination.siteId,
      })
    } catch (error) {
      if (error instanceof EntitlementError) {
        if (error.code === 'not-found') {
          throw new PlatformCheckoutError('not-found', 'Exact private offer was not found.')
        }
        if (error.code === 'destination') {
          throw new PlatformCheckoutError('scope', 'Private offer destination substitution denied.')
        }
        throw new PlatformCheckoutError('stale', 'Exact private offer is unavailable.')
      }
      throw error
    }
  }
}

export type HostedPlatformCheckoutRuntimeInput = Readonly<{
  db: DbClient
  transport: ScopedPaystackTransport
  registry: PaystackPurposeRegistry
  entitlements: EntitlementService
  callbackOrigin: string
  resolvePayer(request: Request): Promise<PlatformCheckoutPayerSession | null>
  allowedChannels?: readonly PlatformCheckoutChannel[]
  allowedAuthorizationOrigins?: readonly string[]
  now?: () => Date
}>

export function createHostedPlatformCheckoutRuntime(
  input: HostedPlatformCheckoutRuntimeInput,
) {
  const repository = new PostgresPlatformCheckoutRepository(input.db, {
    now: input.now,
  })
  registerPlatformCheckoutPurposes(input.registry, repository)
  const service = new PlatformCheckoutService(
    input.transport,
    repository,
    new EntitlementCheckoutOfferAcceptanceAuthority(input.entitlements),
    {
      callbackOrigin: input.callbackOrigin,
      allowedChannels: input.allowedChannels ?? ['card'],
      allowedAuthorizationOrigins: input.allowedAuthorizationOrigins,
    },
  )
  const scopedRoutes = createPlatformCheckoutScopedRouteDeclarations({
    service,
    resolvePayer: input.resolvePayer,
  })
  return Object.freeze({ repository, service, scopedRoutes })
}

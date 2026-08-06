import type { DbClient } from '../../db/client'
import type { HostedIdentityAuthRuntime } from '../../auth/hosted/runtime'
import type { PublicProjectionAuthority } from '../publicProjections'
import type { PublicTemplateCatalogService } from '../publicTemplates'
import { HostedPublicHandoffResolutionAuthority } from './authority'
import { createPublicHandoffAppBoundary, createPublicHandoffIssuer } from './boundary'
import { AUTH_HANDOFF_SESSION_COOKIE } from './contracts'
import { PostgresPublicHandoffRepository } from './repository'
import { PublicHandoffService } from './service'

export type HostedPublicHandoffRuntime = Readonly<{
  issuer: ReturnType<typeof createPublicHandoffIssuer>
  boundary: ReturnType<typeof createPublicHandoffAppBoundary>
  service: PublicHandoffService
}>

export function createHostedPublicHandoffRuntime(input: Readonly<{
  db: DbClient
  projections: PublicProjectionAuthority
  templates: PublicTemplateCatalogService
  identityAuth: HostedIdentityAuthRuntime
  appHost: string
  authHost: string
  marketingHost: string
  secureCookies: boolean
  googleAuthEnabled?: boolean
  /**
   * Mints the app-host staff session once a handoff is exchanged, so someone who
   * has just authenticated is not asked to sign in again on the app.
   */
  completeStaffSession?: (
    request: Request,
    session: Readonly<{ userId: string, identitySessionId: string }>,
  ) => Promise<readonly string[]>
}>): HostedPublicHandoffRuntime {
  const expectedCookie = input.secureCookies ? AUTH_HANDOFF_SESSION_COOKIE : 'fuma_auth'
  if (input.identityAuth.boundary.cookieName !== expectedCookie) {
    throw new TypeError('Public handoff identity authority must use the auth-host-only cookie.')
  }
  const service = new PublicHandoffService({
    repository: new PostgresPublicHandoffRepository(input.db),
    authority: new HostedPublicHandoffResolutionAuthority({ projections: input.projections, templates: input.templates }),
  })
  const protocol = input.secureCookies ? 'https' : 'http'
  const issuer = createPublicHandoffIssuer(service)
  const boundary = createPublicHandoffAppBoundary({
    service,
    appOrigin: `${protocol}://${input.appHost}`,
    authOrigin: `${protocol}://${input.authHost}`,
    ...(input.completeStaffSession ? { completeStaffSession: input.completeStaffSession } : {}),
    marketingOrigin: `${protocol}://${input.marketingHost}`,
    secureCookies: input.secureCookies,
    googleAuthEnabled: input.googleAuthEnabled ?? false,
    identityAuth: input.identityAuth.boundary,
    resolveIdentitySession: input.identityAuth.resolveSession,
  })
  return Object.freeze({ issuer, boundary, service })
}

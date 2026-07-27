import type { DbClient } from '../../db/client'
import {
  createPostgresFumaRequestContextAuthorityPorts,
  createPostgresFumaScopedRouteBoundaryFactory,
  type FumaScopedRouteBoundary,
  type FumaScopedRouteDeclaration,
} from '../../fuma/context'
import {
  createEditorScopedRouteDeclarations,
  EditorScopedRepository,
  EditorSessionAuthority,
  PostgresEditorScopedStorage,
} from '../../fuma/editor'
import {
  FUMA_STAFF_FRESH_SESSION_SECONDS,
  createPostgresHostedAuth,
  type HostedAuthDelivery,
  type HostedResolvedSession,
} from './auth'
import { createHostedStaffAuthBoundary, type HostedStaffAuthBoundary } from './routes'

export type HostedStaffAuthRuntimeInput = Readonly<{
  databaseUrl: string
  productHost: string
  protectedOwnerEmail: string
  secureCookies: boolean
  cookieName: string
  secret: string
  delivery: HostedAuthDelivery
}>

export type HostedStaffAuthRuntime = Readonly<{
  boundary: HostedStaffAuthBoundary
  resolveSession: (headers: Headers) => Promise<HostedResolvedSession | null>
  allowsMutationOrigin: (request: Request) => boolean
  close: () => Promise<void>
}>

export type HostedFumaScopedApiInput = Readonly<{
  db: DbClient
  hostedStaffAuth: HostedStaffAuthRuntime | undefined
  publicationRoutes?: readonly FumaScopedRouteDeclaration[]
  checkoutRoutes?: readonly FumaScopedRouteDeclaration[]
}>

export function readHostedAuthSecret(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const secret = env.BETTER_AUTH_SECRET ?? env.INSTATIC_SECRET_KEY
  if (!secret || secret.length < 32) {
    throw new Error('Fuma hosted auth requires BETTER_AUTH_SECRET (at least 32 characters).')
  }
  return secret
}

export function createHostedStaffAuthRuntime(
  input: HostedStaffAuthRuntimeInput,
): HostedStaffAuthRuntime {
  const protocol = input.secureCookies ? 'https' : 'http'
  const origin = `${protocol}://${input.productHost}`
  const postgres = createPostgresHostedAuth({
    baseURL: origin,
    databaseUrl: input.databaseUrl,
    secret: input.secret,
    secureCookies: input.secureCookies,
    cookieName: input.cookieName,
    delivery: input.delivery,
  })
  const boundary = createHostedStaffAuthBoundary({
    auth: postgres.auth,
    origin,
    cookieName: input.cookieName,
    secureCookies: input.secureCookies,
    security: {
      freshSessionSeconds: FUMA_STAFF_FRESH_SESSION_SECONDS,
      protectedOwnerEmail: input.protectedOwnerEmail,
      resolveSession: postgres.resolveSession,
      findUserEmailById: postgres.findUserEmailById,
      findSessionUserIdByToken: postgres.findSessionUserIdByToken,
    },
  })
  return Object.freeze({
    boundary,
    resolveSession: postgres.resolveSession,
    allowsMutationOrigin: (request: Request) => (
      boundary.handlesProductRequest(request)
      && request.headers.get('origin') === boundary.origin
    ),
    close: postgres.close,
  })
}

/**
 * Mounts hosted editor routes from live PostgreSQL and trusted Better Auth
 * authority. An absent hosted runtime returns before any hosted authority or
 * storage is constructed, preserving both SQLite and PostgreSQL self-hosting.
 */
export function createHostedFumaScopedApi(
  input: HostedFumaScopedApiInput,
): FumaScopedRouteBoundary | undefined {
  if (!input.hostedStaffAuth) return undefined

  const createBoundary = createPostgresFumaScopedRouteBoundaryFactory({
    db: input.db,
    ports: createPostgresFumaRequestContextAuthorityPorts({
      db: input.db,
      resolveSession: input.hostedStaffAuth.resolveSession,
    }),
    allowsMutationOrigin: input.hostedStaffAuth.allowsMutationOrigin,
  })
  const repository = new EditorScopedRepository(
    new PostgresEditorScopedStorage(input.db),
  )
  const editorRoutes=createEditorScopedRouteDeclarations({
    repository,
    sessions: new EditorSessionAuthority(),
  })
  return createBoundary(Object.freeze([
    ...editorRoutes,
    ...(input.publicationRoutes??[]),
    ...(input.checkoutRoutes ?? []),
  ]))
}

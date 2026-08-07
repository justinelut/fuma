/**
 * The authorising side of site-document resolution.
 *
 * `siteDocumentScope.ts` decides what a correct answer looks like but deliberately performs no
 * authorisation — it takes an already-authorised scope. This module is the piece that does the
 * checking, kept separate so the decision logic stays testable without a database and so there
 * is exactly one place where "the caller may edit this site" is established.
 *
 * Handlers depend on the PORT rather than on this implementation, because a handler that reaches
 * for the authority itself is a handler that can forget to.
 */

import {
  readUntrustedScope,
  resolveSiteDocumentId,
  statusForRefusal,
  type DeploymentMode,
  type SiteDocumentResolution,
} from './siteDocumentScope'

/**
 * Establishes whether the request's caller may act on the scope the request names.
 *
 * Returns the scope when authorised and null otherwise. Null covers unauthenticated,
 * unauthorised and unknown-site alike, because from the resolver's point of view they all mean
 * the same thing: do not serve a document.
 */
export interface SiteScopeAuthorizer {
  authorizeScope(
    request: Request,
    scope: Readonly<{ organizationId: string, workspaceId: string, siteId: string }>,
  ): Promise<Readonly<{ organizationId: string, workspaceId: string, siteId: string }> | null>
}

/** What a handler asks for. One call, one answer, no way to skip the check. */
export interface SiteDocumentResolverPort {
  resolve(request: Request): Promise<SiteDocumentResolution>
}

export type ResolverInput = Readonly<{
  mode: DeploymentMode
  authorizer: SiteScopeAuthorizer
}>

/**
 * Build the resolver a handler consumes.
 *
 * In self-host mode the authorizer is never consulted: there is one site, its id is historical,
 * and there is no scope to check. Calling an authority anyway would make a self-hosted install
 * depend on hosted authorisation tables it does not have.
 */
export function createSiteDocumentResolver(input: ResolverInput): SiteDocumentResolverPort {
  async function resolve(request: Request): Promise<SiteDocumentResolution> {
    if (input.mode === 'self-host') {
      return resolveSiteDocumentId({
        mode: 'self-host', authorizedScope: null, scopeWasSupplied: false,
      })
    }

    const untrusted = readUntrustedScope(request)
    if (untrusted === null) {
      // Nothing to authorise. Reported as missing rather than denied so the client is told to
      // send the parameters instead of being told it lacks permission.
      return resolveSiteDocumentId({
        mode: 'hosted', authorizedScope: null, scopeWasSupplied: false,
      })
    }

    const authorized = await input.authorizer.authorizeScope(request, untrusted)
    return resolveSiteDocumentId({
      mode: 'hosted',
      authorizedScope: authorized,
      // A scope WAS supplied, so a null result here is a denial rather than an omission.
      scopeWasSupplied: true,
    })
  }

  return Object.freeze({ resolve })
}

/**
 * Turn a refusal into the response a handler should return.
 *
 * Centralised so every handler refuses identically: a handler that invented its own status or
 * leaked the requested site id back to an unauthorised caller would confirm that site exists.
 */
export function refusalResponse(resolution: SiteDocumentResolution): Response | null {
  if (resolution.ok) return null
  return new Response(
    JSON.stringify({ error: resolution.message }),
    {
      status: statusForRefusal(resolution.reason),
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    },
  )
}

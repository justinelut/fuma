/**
 * Which site document does this request address?
 *
 * The CMS handlers historically answered this with a constant: `SELF_HOST_SITE_ID`
 * (`'default'`). That is correct for a self-hosted install, which has exactly one site. In a
 * hosted deployment it means **every site shares one CMS document** — with two sites, editing
 * one overwrites the other, and nothing reports a conflict because both writes are valid writes
 * to the same row.
 *
 * This module is the single seam that answers the question, and it is deliberately shaped so
 * the dangerous answers are unreachable rather than merely discouraged:
 *
 *   1. **It never falls back.** A request whose scope cannot be authorised is REFUSED. Falling
 *      back to the legacy id would hand an unauthorised caller the shared document, and in
 *      hosted mode that is a cross-tenant read rather than a tidy default.
 *   2. **Hosted never returns the legacy id.** If it could, a hosted request that merely forgot
 *      its scope would land on the shared document — reintroducing the exact bug, but only for
 *      the requests that are hardest to notice.
 *   3. **The id comes from the AUTHORISED scope, not the URL.** The route scope arrives in query
 *      parameters, which any authenticated user can edit. Deriving the document key straight
 *      from them would let one tenant read and overwrite another's design by changing
 *      `?siteId=` — strictly worse than the shared-document bug it would be fixing.
 */

/**
 * The historical self-host composition scope.
 *
 * Existing installations persist their one site under this id, so it cannot be renamed without
 * migrating live rows. It is re-declared here rather than imported so this module states the one
 * value it must never hand to a hosted request.
 */
export const LEGACY_SELF_HOST_DOCUMENT_ID = 'default'

/** How the deployment is configured, which decides what a correct answer looks like. */
export type DeploymentMode = 'self-host' | 'hosted'

/**
 * A scope that has been checked against the authorization authority.
 *
 * Constructed only by a caller that has actually performed the check. The type is separate from
 * the request's untrusted query parameters precisely so the two cannot be confused at a call
 * site — the codebase already names the other one `UntrustedFumaRouteScope`.
 */
export type AuthorizedSiteScope = Readonly<{
  organizationId: string
  workspaceId: string
  siteId: string
}>

export type SiteDocumentRefusal =
  /** Hosted request carried no scope, or an incomplete one. */
  | 'missing-scope'
  /** The caller is not authorised for the scope they asked for. */
  | 'unauthorized-scope'
  /** A hosted site id that collides with the legacy shared document. */
  | 'reserved-site-id'

export type SiteDocumentResolution =
  | Readonly<{ ok: true, documentId: string }>
  | Readonly<{ ok: false, reason: SiteDocumentRefusal, message: string }>

/**
 * The self-host answer.
 *
 * Separate from the hosted path because there is genuinely one site and its id is historical
 * data. Keeping it a distinct function means the hosted path has no branch that could reach the
 * legacy value.
 */
export function selfHostDocumentId(): string {
  return LEGACY_SELF_HOST_DOCUMENT_ID
}

/**
 * Whether a string is a usable scope component.
 *
 * Whitespace-only is treated as absent: a query parameter present but blank is the shape a
 * client sends when it *meant* to send a scope and had nothing, and treating it as a real value
 * would produce a document key made of spaces.
 */
function isPresent(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Read a route scope from a request's query parameters.
 *
 * The result is explicitly NOT authorized — it is the untrusted triple. It exists so the
 * authorising caller has one place to parse from, and so a handler cannot accidentally treat
 * the parsed value as trustworthy: it is returned under a name that says otherwise.
 */
export function readUntrustedScope(request: Request): AuthorizedSiteScope | null {
  const query = new URL(request.url).searchParams
  const organizationId = query.get('organizationId')?.trim() ?? ''
  const workspaceId = query.get('workspaceId')?.trim() ?? ''
  const siteId = query.get('siteId')?.trim() ?? ''
  if (!isPresent(organizationId) || !isPresent(workspaceId) || !isPresent(siteId)) return null
  return Object.freeze({ organizationId, workspaceId, siteId })
}

export type ResolveInput = Readonly<{
  mode: DeploymentMode
  /**
   * The scope the caller has ALREADY authorised, or null when authorisation failed or no scope
   * was supplied.
   *
   * Required as an argument rather than resolved here so this module cannot be used without an
   * authorisation step having happened: there is no code path in which it authorises nothing and
   * returns an id anyway.
   */
  authorizedScope: AuthorizedSiteScope | null
  /** Whether a scope was present at all, to tell "did not ask" from "not allowed". */
  scopeWasSupplied: boolean
}>

/**
 * Resolve the document id, or refuse.
 *
 * The two refusal reasons are kept apart because they need different responses: a missing scope
 * is a client that has not been updated (a 400 naming the parameters), while an unauthorised
 * scope is a permission decision (a 403, and worth an audit trail).
 */
export function resolveSiteDocumentId(input: ResolveInput): SiteDocumentResolution {
  if (input.mode === 'self-host') {
    // One site, and its id is historical data rather than a choice.
    return Object.freeze({ ok: true as const, documentId: LEGACY_SELF_HOST_DOCUMENT_ID })
  }

  if (input.authorizedScope === null) {
    return input.scopeWasSupplied
      ? Object.freeze({
        ok: false as const,
        reason: 'unauthorized-scope' as const,
        message:
          'The signed-in user is not authorised for the requested site. The request is refused '
          + 'rather than served the default document, because serving it would return another '
          + 'tenant\'s design.',
      })
      : Object.freeze({
        ok: false as const,
        reason: 'missing-scope' as const,
        message:
          'This hosted request carried no site scope. Supply organizationId, workspaceId and '
          + 'siteId. There is no default site in a hosted deployment, so there is nothing safe '
          + 'to assume.',
      })
  }

  // A hosted site whose id is literally the legacy value would read and write the shared
  // document, which is the precise bug this module exists to close. Refused explicitly: the
  // cost of the check is nothing and the cost of missing it is one tenant editing another.
  if (input.authorizedScope.siteId === LEGACY_SELF_HOST_DOCUMENT_ID) {
    return Object.freeze({
      ok: false as const,
      reason: 'reserved-site-id' as const,
      message:
        `"${LEGACY_SELF_HOST_DOCUMENT_ID}" is reserved for the self-hosted composition scope, so `
        + 'a hosted site cannot use it as its id without colliding with the shared legacy '
        + 'document.',
    })
  }

  // The site id alone is the document key: it is already unique, and folding the organisation
  // and workspace into the key would mean moving a site between workspaces changed the key and
  // orphaned its document.
  return Object.freeze({ ok: true as const, documentId: input.authorizedScope.siteId })
}

/**
 * The HTTP status a refusal deserves.
 *
 * Kept with the refusal reasons so a handler cannot report a permission failure as a bad
 * request, which would tell a caller to fix their parameters when the parameters were fine.
 */
export function statusForRefusal(reason: SiteDocumentRefusal): 400 | 403 {
  return reason === 'unauthorized-scope' ? 403 : 400
}

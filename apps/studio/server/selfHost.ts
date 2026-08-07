/**
 * Legacy self-host composition scope.
 *
 * Existing installations persist their one site under this historical ID.
 * Keep the value stable: repository APIs receive it explicitly so selection is
 * scope-bound without renaming or rewriting live data.
 */
export const SELF_HOST_SITE_ID = 'default'

/**
 * Hosted site-document bridge.
 *
 * A self-hosted installation has exactly one site, so answering "which site document is this
 * request for?" with the constant above is correct there. In the hosted product many sites share
 * one process, and that same constant means **every site reads and writes ONE document** — with
 * two sites, editing one silently overwrites the other, because both writes are valid writes to
 * the same row and nothing reports a conflict.
 *
 * Registration is composition-time and process-wide, matching `setHostedBuilderIdentityResolver`
 * in `auth/authz.ts`. When no resolver is registered the behaviour is byte-for-byte the
 * self-hosted behaviour, so a self-hosted install cannot be affected by this seam existing.
 *
 * The resolver returns null to REFUSE. It deliberately cannot return the legacy id: a hosted
 * request that failed authorisation must not be handed the shared document, because that is a
 * cross-tenant read rather than a tidy default. Callers turn null into a refusal response.
 */
export type HostedSiteDocumentResolver = (
  req: Request,
) => Promise<string | null>

let hostedSiteDocumentResolver: HostedSiteDocumentResolver | null = null

export function setHostedSiteDocumentResolver(
  resolver: HostedSiteDocumentResolver | null,
): void {
  hostedSiteDocumentResolver = resolver
}

/** Whether this process is running the hosted product. */
export function isHostedSiteDocumentModeActive(): boolean {
  return hostedSiteDocumentResolver !== null
}

/**
 * The site document this request addresses, or null when it must be refused.
 *
 * Self-host answers with the historical id and never consults a resolver it does not have.
 */
export async function resolveRequestSiteDocumentId(
  req: Request,
): Promise<string | null> {
  if (hostedSiteDocumentResolver === null) return SELF_HOST_SITE_ID
  return await hostedSiteDocumentResolver(req)
}

/**
 * The bridge that lets a hosted deployment tell the dashboard what a tenant's plan includes.
 *
 * WHY A BRIDGE RATHER THAN A DIRECT READ: the dashboard storage reader is a CMS handler with no
 * organization in scope - it is the self-hosted surface, where there is no plan at all. Reaching
 * into the entitlement layer from there would make a self-hosted install depend on machinery it
 * does not run, and would give it a limit nobody sold it.
 *
 * So this follows the SAME precedent as setHostedSiteDocumentResolver and
 * setHostedBuilderIdentityResolver: module-level, NULL BY DEFAULT. With no resolver registered,
 * behaviour is byte-for-byte self-host - the allowance is unknown, and the surface already renders
 * an unknown allowance honestly rather than as "unlimited".
 */

/**
 * Bytes a tenant's plan includes, or null when it cannot be resolved.
 *
 * TAKES THE REQUEST, and that is a correctness requirement rather than convenience. A zero-argument
 * resolver has no way to know WHICH tenant is asking, so it would return one tenant's allowance to
 * every tenant - the same cross-tenant class of defect that the shared site document and the
 * unscoped render cache both were. The request is what carries the scope, and a hosted
 * registration is expected to authorise it the same way the site document resolver does rather
 * than trusting what the caller asked for.
 */
export type StorageAllowanceResolver = (request: Request) => Promise<number | null> | number | null

let resolver: StorageAllowanceResolver | null = null

export function setHostedStorageAllowanceResolver(next: StorageAllowanceResolver | null): void {
  resolver = next
}

/**
 * The allowance to report, or null.
 *
 * A THROWING resolver reports NULL rather than propagating, and that is deliberate: the dashboard
 * is a read-only surface, and failing the whole storage widget because an entitlement lookup was
 * briefly unavailable would replace a known-good usage figure with an error. An unknown limit is
 * already a state the surface renders correctly.
 */
export async function hostedStorageAllowanceBytes(request: Request): Promise<number | null> {
  if (resolver === null) return null
  try {
    const value = await resolver(request)
    if (value === null) return null
    // A non-positive or non-finite allowance is treated as unknown rather than shown. Rendering a
    // limit of zero would put every account permanently over its allowance.
    if (!Number.isFinite(value) || value <= 0) return null
    return value
  } catch {
    return null
  }
}

/**
 * The scope the builder is currently editing.
 *
 * The server resolves which site document a CMS request addresses from the scope the request
 * carries. Self-hosted installs have one site and send nothing, which is why this is null by
 * default: with no scope registered the requests are byte-for-byte the self-hosted requests.
 *
 * In the hosted product the builder edits a specific site, and without this the CMS calls carry
 * no scope at all — so the server would either have to guess (which is the shared-document bug:
 * every site reading and writing one document) or refuse. Recording the scope here is what lets
 * it do neither.
 *
 * Module-level rather than threaded through every call because the builder edits exactly one
 * site per session, and threading it through every persistence call site would mean any call that
 * forgot silently addressed the wrong site — the same failure this exists to remove.
 */

export type BuilderScope = Readonly<{
  organizationId: string
  workspaceId: string
  siteId: string
}>

let activeScope: BuilderScope | null = null

/**
 * Record the scope for the rest of the session.
 *
 * Called once the hosted shell has opened the builder for a site. Passing null restores
 * self-hosted behaviour, which is what tests must do so a registered scope cannot leak into a
 * later test.
 */
export function setActiveBuilderScope(scope: BuilderScope | null): void {
  activeScope = scope
}

export function getActiveBuilderScope(): BuilderScope | null {
  return activeScope
}

/**
 * The query parameters a CMS request should carry.
 *
 * An EMPTY object when unset rather than undefined, so a caller can spread it unconditionally
 * and self-host keeps sending exactly the URL it always sent.
 */
export function activeBuilderScopeQuery(): Readonly<Record<string, string>> {
  if (activeScope === null) return Object.freeze({})
  return Object.freeze({
    organizationId: activeScope.organizationId,
    workspaceId: activeScope.workspaceId,
    siteId: activeScope.siteId,
  })
}

/**
 * The scope as a URL search string, including the leading `?`, or an empty string when unset.
 *
 * For call sites that build a URL by hand rather than passing a query object. Empty (not `?`)
 * when self-hosted, because a bare trailing question mark changes the URL a cache keys on.
 */
export function builderScopeSearch(): string {
  const query = activeBuilderScopeQuery()
  const keys = Object.keys(query)
  if (keys.length === 0) return ''
  const search = new URLSearchParams()
  for (const key of keys) search.set(key, query[key] as string)
  return `?${search.toString()}`
}

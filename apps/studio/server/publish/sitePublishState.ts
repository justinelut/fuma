/**
 * Per-site publish state.
 *
 * `publishState.ts` owns ONE publish version and ONE publish lock for the whole process. That is
 * correct for a self-hosted install, which has one site. In the hosted product many sites share
 * one process, and the single global has two consequences:
 *
 *   1. **One tenant's publish invalidates every other tenant's caches.** The version is what
 *      every version-keyed cache reads for staleness, so publishing site A makes site B's entries
 *      stale even though nothing about B changed. Nothing breaks visibly; B just quietly re-renders
 *      everything, and the busier the platform gets the worse it gets.
 *   2. **Every tenant's publish serializes against every other tenant's.** One in-process chain
 *      means a slow publish blocks unrelated sites. That is a throughput cliff rather than a bug
 *      today, and it becomes a hard blocker once publishing runs a per-tenant BUILD, because
 *      builds take seconds and there is no reason one tenant should wait for another's.
 *
 * This module scopes both to a site. The same site still serializes — that is ISS-038's whole
 * point and dropping it would let two publishes of one site mis-stamp their baked hole shells.
 */

/**
 * Current version per site.
 *
 * **A VERSION MUST NEVER GO BACKWARDS, AND THAT IS WHY NOTHING IS EVICTED FROM THIS MAP.** Every
 * version-keyed cache decides staleness by comparing the version it stored against the version it
 * reads. If a site's entry were dropped and recreated at 0, entries cached at version 5 would
 * compare as NEWER than current and be treated as fresh forever — the site would serve retracted
 * content with no way to flush it, and nothing would report a problem.
 *
 * The cost of not evicting is one small integer per site, bounded by the number of sites that have
 * published in this process. That is a price worth paying for a guarantee that cannot be restored
 * once broken.
 */
const versions = new Map<string, number>()

/** Serialization chain per site, plus how many callers are waiting on it. */
type SiteLock = Readonly<{ chain: Promise<unknown>, active: number }>

const locks = new Map<string, SiteLock>()

/**
 * The version a site's caches should compare against.
 *
 * An unknown site reads 0 rather than throwing: a site that has never published in this process
 * genuinely has no publish behind it, and 0 is the honest answer that makes every cached entry
 * (all stamped at 1 or more) look newer and therefore valid to re-check.
 */
export function publishVersionFor(siteDocumentId: string): number {
  return versions.get(siteDocumentId) ?? 0
}

/**
 * Move a site's version forward.
 *
 * Monotonic per site and independent of every other site, so one tenant's publish cannot
 * invalidate another tenant's caches.
 */
export function bumpPublishVersionFor(siteDocumentId: string): number {
  const next = publishVersionFor(siteDocumentId) + 1
  versions.set(siteDocumentId, next)
  return next
}

/**
 * Run a publish operation under the lock for ONE site.
 *
 * Two publishes of the same site serialize, preserving ISS-038: without it both read version N,
 * stamp every baked hole shell N+1, then each bump to N+2, leaving those shells permanently
 * mis-stamped and served as stale.
 *
 * Two publishes of DIFFERENT sites run concurrently, which is the point: they share no version,
 * no cache entries and no artefact slots, so serializing them buys nothing and costs every tenant
 * the latency of every other tenant.
 */
export function withSitePublishLock<T>(
  siteDocumentId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const existing = locks.get(siteDocumentId)
  const chain = existing?.chain ?? Promise.resolve()
  const active = (existing?.active ?? 0) + 1

  const run = (): Promise<T> => fn()
  // Settled either way: a rejected publish must not wedge the chain for the next one.
  const result = chain.then(run, run)

  const settled = result.then(() => undefined, () => undefined)
  locks.set(siteDocumentId, Object.freeze({ chain: settled, active }))

  void settled.then(() => {
    const current = locks.get(siteDocumentId)
    if (!current) return
    const remaining = current.active - 1
    // Releasing the entry once nobody is waiting keeps the map from holding a promise reference
    // per site forever. Safe because a fresh chain is behaviourally identical to a settled one —
    // and deliberately NOT done for versions, where dropping an entry is corruption.
    if (remaining <= 0) locks.delete(siteDocumentId)
    else locks.set(siteDocumentId, Object.freeze({ chain: current.chain, active: remaining }))
  })

  return result
}

/**
 * Bump a site's version under that site's lock.
 *
 * NEVER call inside an open DB transaction: the lock may be held by a publish that is itself
 * queued behind the transaction chain, which deadlocks. Same hazard as the process-wide version.
 */
export function bumpPublishVersionForSerialized(siteDocumentId: string): Promise<void> {
  return withSitePublishLock(siteDocumentId, async () => { bumpPublishVersionFor(siteDocumentId) })
}

/** How many sites hold state. Lets a test assert the lock map does not grow without bound. */
export function trackedSiteCount(): Readonly<{ versions: number, locks: number }> {
  return Object.freeze({ versions: versions.size, locks: locks.size })
}

/**
 * Clear everything. Tests only.
 *
 * Deliberately not exported as a general reset: clearing versions in a running process is the
 * corruption this module's comments warn about.
 */
export function resetSitePublishStateForTests(): void {
  versions.clear()
  locks.clear()
}

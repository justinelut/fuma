/**
 * Durable staleness for baked shells — the fix for the stale-publish window.
 *
 * THE DEFECT, verified by reading the code rather than inferred:
 *
 * `server/publish/publishState.ts` holds `let publishVersion = 0` in PROCESS MEMORY. The publisher
 * stamps every baked hole shell with `getPublishVersion() + 1` (publishSite.ts:221) into files on
 * SHARED DISK. The hole endpoint then compares the shell's `?v=` against that in-memory counter
 * with STRICT EQUALITY (handlers/cms/hole.ts:188-189) and returns a stale sentinel on mismatch.
 *
 * Those two facts cannot both hold safely:
 *
 *   - AFTER A RESTART the counter is 0 while the shells on disk still say N, so every hole request
 *     returns the stale sentinel. The existing comment reasons that "the next full page load will
 *     carry the correct version", but it does not: the next page load serves the SAME baked shell
 *     from disk, still stamped N. So this is not a window that closes — it is a STUCK STATE that
 *     persists until somebody publishes again, and in the meantime every dynamic region on every
 *     baked page silently fails to load. Nothing errors; the regions are simply empty.
 *   - WITH MORE THAN ONE PROCESS each holds its own counter, so they disagree permanently and which
 *     answer a visitor gets depends on which process took the request.
 *
 * Nothing restores the counter at startup: grepped `bumpPublishVersion` across the server (callers
 * are all mutation paths) and found no persisted publish-version column anywhere.
 *
 * THE FIX is to stop comparing against process memory. Staleness is a question about the PUBLISHED
 * STATE, and the codebase already persists exactly the right thing: `ActiveReleasePointer`
 * (server/fuma/releases/contracts.ts:131) carries a per-site monotonic `version`, incremented
 * transactionally on every activation by the existing `activate()` in releases/service.ts. It is
 * durable, identical in every process, and already guarded by optimistic concurrency.
 *
 * This module derives the comparator from that pointer. It deliberately adds NO activation logic —
 * blue/green activation already exists and is more careful than anything worth rewriting.
 */

/** The subset of the persisted pointer this comparator needs. */
export type ActivePointerFacts = Readonly<{
  siteId: string
  releaseId: string
  /** Monotonic per site, incremented on each activation. Persisted, so a restart cannot reset it. */
  version: number
}>

/**
 * The token a baked shell carries and the hole endpoint compares.
 *
 * SITE-SCOPED, not a bare number. A bare version would mean site A's activation invalidated site
 * B's shells whenever the numbers happened to differ — the same cross-tenant coupling the per-site
 * publish version exists to remove.
 */
export type StalenessToken = string

export function stalenessTokenFor(pointer: ActivePointerFacts): StalenessToken {
  // The release id is included as well as the version so a token cannot be forged by guessing a
  // number, and so a token identifies WHICH release baked the shell when reading a log.
  return `${pointer.siteId}:${pointer.version}:${pointer.releaseId}`
}

export type FreshnessVerdict =
  /** The shell was baked by what is currently serving. */
  | 'fresh'
  /** The shell predates the current activation and must be re-fetched. */
  | 'superseded'
  /** The shell belongs to a different site. Never serve it. */
  | 'foreign'
  /** Unparseable token. Treated as stale rather than trusted. */
  | 'malformed'

/**
 * Compare a shell's token against what is serving.
 *
 * Distinguishes `foreign` from `superseded` because they need opposite responses: a superseded
 * shell should be refreshed, while a token naming another site is either a bug or an attempt and
 * must never be served regardless of version.
 */
export function judgeFreshness(
  shellToken: string,
  pointer: ActivePointerFacts,
): FreshnessVerdict {
  const parts = shellToken.split(':')
  if (parts.length !== 3) return 'malformed'
  const [siteId, versionText, releaseId] = parts
  if (siteId === undefined || versionText === undefined || releaseId === undefined) return 'malformed'
  if (siteId.length === 0 || releaseId.length === 0) return 'malformed'
  if (!/^[0-9]+$/.test(versionText)) return 'malformed'
  if (siteId !== pointer.siteId) return 'foreign'
  return shellToken === stalenessTokenFor(pointer) ? 'fresh' : 'superseded'
}

/** Whether the hole endpoint may serve a fragment for this shell. */
export function mayServe(shellToken: string, pointer: ActivePointerFacts): boolean {
  return judgeFreshness(shellToken, pointer) === 'fresh'
}

export type StalenessProblem = Readonly<{
  code: 'process-local-comparator' | 'version-not-monotonic'
  message: string
}>

/**
 * Check that a comparator source is durable.
 *
 * Exists so the defect this module replaces cannot be reintroduced by wiring the hole endpoint back
 * to a counter: a caller can assert what it is comparing against is persisted.
 */
export function reviewComparator(
  input: Readonly<{ durable: boolean, previousVersion: number, currentVersion: number }>,
): readonly StalenessProblem[] {
  const problems: StalenessProblem[] = []
  if (!input.durable) {
    problems.push(Object.freeze({
      code: 'process-local-comparator',
      message:
        'The staleness comparator is process-local, so a restart resets it while baked shells on '
        + 'disk still carry the old value. Every dynamic region then fails to load until the next '
        + 'publish, silently.',
    }))
  }
  if (input.currentVersion < input.previousVersion) {
    problems.push(Object.freeze({
      code: 'version-not-monotonic',
      message:
        'The activation version went backwards, so shells baked at the higher value would compare '
        + 'as current forever and serve content that has been retracted.',
    }))
  }
  return Object.freeze(problems)
}

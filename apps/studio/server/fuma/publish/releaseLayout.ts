/**
 * Source workspace, build snapshot, and release.
 *
 * Publishing a Next site is no longer "bake HTML and swap it": it runs a BUILD, which takes
 * seconds and can fail. That turns one concept into three, and collapsing any two of them loses
 * something you cannot get back:
 *
 *   WORKSPACE — mutable. What the designer edits and what the canvas saves into. Always the
 *     newest source, never what is live.
 *   SNAPSHOT  — immutable, content-addressed. The exact source a build consumed. If the build
 *     could read the workspace directly, an edit made while the build ran would change what got
 *     built, so the release would not correspond to any source anybody reviewed and could not be
 *     reproduced.
 *   RELEASE   — the built output, plus a record of which snapshot produced it. Built is NOT live:
 *     activation is a separate decision (blue/green), because a build that succeeded can still be
 *     wrong and the point of a release is to be able to choose it or not.
 *
 * Storage uses the object class the tenant inventory ALREADY declares — `publish-release` under
 * `publish/releases/`, keyed by `releaseId` — rather than inventing a parallel layout.
 */

/** The object class already declared in the tenant object inventory. */
export const RELEASE_OBJECT_CLASS = 'publish-release' as const

/** The logical root that inventory declares for releases. */
export const RELEASE_LOGICAL_ROOT = 'publish/releases/' as const

export type ReleaseState =
  /** The build has been requested; no output exists yet. */
  | 'building'
  /** Built and verified enough to be activatable. NOT live. */
  | 'built'
  /** The build failed. Kept rather than deleted so the failure can be read. */
  | 'failed'
  /** Currently serving traffic. At most one per site. */
  | 'active'
  /** Was active, superseded. Kept so a rollback has somewhere to go. */
  | 'superseded'

export const RELEASE_STATES: readonly ReleaseState[] = Object.freeze([
  'building', 'built', 'failed', 'active', 'superseded',
])

/**
 * The immutable input to one build.
 *
 * `sourceHash` is what makes it a snapshot rather than a pointer: two builds of the same hash
 * must produce equivalent output, and a release can be traced back to exactly the source that
 * produced it. A pointer to the workspace would answer "what is live?" with "whatever the
 * workspace says now", which is not an answer.
 */
export type BuildSnapshot = Readonly<{
  snapshotId: string
  siteDocumentId: string
  /** Content hash over every module path and body, so identical source yields one identity. */
  sourceHash: string
  /** Module paths included, sorted, so the manifest is comparable between snapshots. */
  modulePaths: readonly string[]
  createdAt: string
}>

export type Release = Readonly<{
  releaseId: string
  siteDocumentId: string
  /**
   * Which snapshot produced this release.
   *
   * Required, not optional. A release without it cannot answer "what source is live?", which is
   * the first question asked in any incident and the one a rollback depends on.
   */
  snapshotId: string
  state: ReleaseState
  createdAt: string
  /** Why the build failed, when it did. Absent otherwise. */
  failureReason?: string
}>

export type LayoutProblem = Readonly<{
  code:
    | 'mutable-snapshot'
    | 'release-without-snapshot'
    | 'two-active-releases'
    | 'active-without-build'
    | 'failed-without-reason'
  message: string
}>

/** The object key a release's artefacts live under. */
export function releaseObjectPrefix(siteDocumentId: string, releaseId: string): string {
  // Site first so one tenant's releases are contiguous, which is what makes a per-tenant purge or
  // quota measurement a prefix operation rather than a scan.
  return `${RELEASE_LOGICAL_ROOT}${siteDocumentId}/${releaseId}/`
}

/**
 * Whether a release may serve traffic.
 *
 * Only `active`. Deliberately not "anything that built", because that is exactly the conflation
 * blue/green exists to prevent: a build finishing is not a decision to ship it.
 */
export function isServing(release: Release): boolean {
  return release.state === 'active'
}

/**
 * Whether a release can be rolled back to.
 *
 * A superseded release is the rollback target; a failed one never served and rolling back to it
 * would take the site down. Reported as a predicate rather than left to each caller, because a
 * caller that guessed would guess wrong exactly during an incident.
 */
export function isRollbackTarget(release: Release): boolean {
  return release.state === 'superseded'
}

/**
 * Check a site's releases against the layout's rules.
 *
 * Every problem here is one that reads as something else at runtime: two active releases look
 * like intermittently wrong content, and an active release with no snapshot looks like a
 * mystery rather than a missing record.
 */
export function reviewReleases(
  releases: readonly Release[],
  snapshots: readonly BuildSnapshot[],
): readonly LayoutProblem[] {
  const problems: LayoutProblem[] = []
  const knownSnapshots = new Set(snapshots.map((snapshot) => snapshot.snapshotId))

  const active = releases.filter((release) => release.state === 'active')
  if (active.length > 1) {
    problems.push(Object.freeze({
      code: 'two-active-releases',
      message:
        `${active.length} releases are active for one site. Traffic would be served by whichever `
        + 'the router happened to resolve, so the site would appear to change content at random '
        + 'rather than to be misconfigured.',
    }))
  }

  for (const release of releases) {
    if (!knownSnapshots.has(release.snapshotId)) {
      problems.push(Object.freeze({
        code: 'release-without-snapshot',
        message:
          `Release ${release.releaseId} names snapshot ${release.snapshotId}, which does not `
          + 'exist. The source that produced it cannot be recovered, so it cannot be rebuilt or '
          + 'explained.',
      }))
    }
    if (release.state === 'failed' && release.failureReason === undefined) {
      problems.push(Object.freeze({
        code: 'failed-without-reason',
        message:
          `Release ${release.releaseId} failed with no reason recorded. A failure nobody can read `
          + 'is indistinguishable from one nobody noticed.',
      }))
    }
  }

  return Object.freeze(problems)
}

/**
 * Whether two snapshots are the same input.
 *
 * Compared by hash rather than by id, so a rebuild of identical source is recognisable as such
 * and does not need to be built again.
 */
export function sameInput(first: BuildSnapshot, second: BuildSnapshot): boolean {
  return first.sourceHash === second.sourceHash
    && first.siteDocumentId === second.siteDocumentId
}

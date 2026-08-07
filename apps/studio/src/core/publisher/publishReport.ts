/**
 * What "publish" means, now that it is sometimes a build rather than an act.
 *
 * THERE ARE TWO PUBLISH PATHS AND THEY HAVE DIFFERENT TRUTHS.
 *
 * SELF-HOST (repositories/publish.ts) bakes every page synchronously and returns
 * `publishedPages`. When that call returns, the pages ARE live. Saying "3 pages published" is
 * exactly true.
 *
 * THE RELEASE PATH (tasks 53-55) enqueues `fuma.publish-release` and, in the words of its own
 * code, "never publishes in the web process" (fuma/mcp/productionRuntime.ts:124). The request
 * returning means the job was ACCEPTED. The build then runs outside the process, takes seconds,
 * and CAN FAIL. And even a build that succeeds is not live: task 53 made activation a separate
 * decision precisely because a build that compiled can still be wrong.
 *
 * So on that path the existing message is wrong three times over. It claims the work finished
 * before it started; it claims success before anything could fail; and it claims live when
 * `built` and `active` are deliberately different states.
 *
 * The failure mode this creates is the one worth naming: A BUILD THAT FAILS AFTER THE BUTTON
 * SAID "PUBLISHED" CANNOT BE REPORTED AT ALL. The person has already been told it worked, so
 * they go and look at a site that did not change and conclude the product is broken rather than
 * that their build failed. Nothing in the old state machine could express it - it had no state
 * between 'published' and 'error', and 'error' only ever meant the REQUEST failed.
 */

/** How this installation publishes. Not a preference - a fact about the deployment. */
export type PublishMode = 'immediate' | 'build'

/**
 * Where a publish has got to.
 *
 * `accepted` and `live` are deliberately separate on the build path, and deliberately collapsed
 * on the immediate path, because collapsing them there would invent a wait that does not exist.
 */
export type PublishPhase =
  | 'idle'
  | 'submitting'
  /** The request was taken. On the build path nothing has been built yet. */
  | 'accepted'
  /** The build is running. It can still fail. */
  | 'building'
  /** Built, but not yet serving - activation is a separate decision. */
  | 'built'
  /** Serving to visitors. The only phase that may be described as published. */
  | 'live'
  /** The build ran and failed. Distinct from a failed REQUEST. */
  | 'failed'
  /** The request itself failed, so nothing was accepted. */
  | 'request-failed'

export interface PublishReport {
  readonly mode: PublishMode
  readonly phase: PublishPhase
  /** Pages baked, when the path actually baked them. Absent on the build path. */
  readonly pages?: number
  /** Why a build failed, when it did. */
  readonly failure?: string
}

/**
 * The one rule everything else follows: only a serving release may be called published.
 *
 * On the immediate path 'live' is reached by the request returning, so nothing is lost. On the
 * build path it is reached later, or not at all.
 */
export function isPublished(report: PublishReport): boolean {
  return report.phase === 'live'
}

/** Whether the phase can still change without the person doing anything. */
export function isInFlight(report: PublishReport): boolean {
  return report.phase === 'submitting' || report.phase === 'accepted' || report.phase === 'building'
}

/**
 * What the button says.
 *
 * The immediate path keeps its existing words exactly, because they were true there and changing
 * them would invent uncertainty a self-hosted install does not have.
 */
export function publishLabel(report: PublishReport): string {
  if (report.mode === 'immediate') {
    if (report.phase === 'submitting') return 'Publishing'
    if (report.phase === 'live') return 'Published'
    if (report.phase === 'request-failed' || report.phase === 'failed') return 'Publish site'
    return 'Publish site'
  }
  switch (report.phase) {
    case 'submitting': return 'Starting build'
    case 'accepted': return 'Queued'
    case 'building': return 'Building'
    // NOT "Published": built is not serving, and saying otherwise is the precise
    // misstatement task 53 separated these states to prevent.
    case 'built': return 'Built - not live yet'
    case 'live': return 'Published'
    case 'failed': return 'Build failed'
    case 'request-failed': return 'Publish site'
    default: return 'Publish site'
  }
}

/**
 * The sentence shown beside the button.
 *
 * Returns null when there is nothing worth saying, rather than filling the space - a status line
 * that always says something trains people to stop reading it.
 */
export function publishMessage(report: PublishReport): string | null {
  if (report.mode === 'immediate') {
    if (report.phase !== 'live') return report.phase === 'failed' || report.phase === 'request-failed'
      ? (report.failure ?? 'Publish failed.')
      : null
    if (report.pages === undefined) return 'Published.'
    return report.pages === 1 ? '1 page published' : `${report.pages} pages published`
  }

  switch (report.phase) {
    case 'accepted':
      // States plainly that nothing is live yet, because the previous wording let somebody go
      // and look at an unchanged site believing the work was done.
      return 'Build queued. Your live site is unchanged until it finishes.'
    case 'building':
      return 'Building your site. This takes a moment and can fail, so the result is reported here.'
    case 'built':
      return 'Built successfully. It goes live when the release is activated.'
    case 'live':
      return 'Live. Visitors are seeing this version.'
    case 'failed':
      // The cause, not just the fact: a failure nobody can read is indistinguishable from one
      // nobody noticed, and this one arrives AFTER the request already succeeded.
      return report.failure
        ? `Build failed, so your live site is unchanged. ${report.failure}`
        : 'Build failed, so your live site is unchanged.'
    case 'request-failed':
      return report.failure ?? 'The publish request failed, so no build was started.'
    default:
      return null
  }
}

/**
 * Whether a phase means the visitor-facing site changed.
 *
 * Offered as a predicate because "did anything actually happen" is the question somebody asks
 * after a publish, and answering it from the phase name is how the two get confused.
 */
export function liveSiteChanged(report: PublishReport): boolean {
  return report.phase === 'live'
}

/**
 * Review the wording a surface uses, so a claim of completion cannot be reattached to a phase
 * that has not completed.
 */
export function reviewClaim(report: PublishReport, claim: string): string | null {
  const saysDone = /\bpublished\b/i.test(claim) && !/not\b/i.test(claim)
  if (saysDone && !isPublished(report)) {
    return `Claims "published" in phase ${report.phase}, which is not serving. Only the live phase may be described as published.`
  }
  return null
}

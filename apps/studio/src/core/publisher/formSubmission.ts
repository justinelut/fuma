/**
 * Where a generated site's form submissions go, and why the choice is not free.
 *
 * THE QUESTION task 63 asks is usually posed as "server actions or route handlers?". For this
 * product it is settled by a fact rather than a preference, and the fact is worth stating first.
 *
 * A RELEASE IS A SET OF STATIC FILE ARTIFACTS. RenderedArtifact (publishing/workerPublisher.ts) is
 * {logicalPath, kind: 'html' | 'css' | 'javascript' | 'asset', mimeType}, uploaded to object
 * storage and served from there. There is no Next server process running a tenant's app per
 * request. So:
 *   - A SERVER ACTION CANNOT RUN. It is a POST to the Next runtime, and there is no runtime.
 *   - A ROUTE HANDLER IN THE TENANT'S APP CANNOT RUN either, for the same reason.
 * Choosing either would produce a form that works in `next dev` and fails on the published site -
 * the worst possible failure shape, because it passes every check the author can run locally.
 *
 * THE SECOND REASON, which would decide it even if a runtime existed: THE SUBMISSIONS ARE NOT THE
 * SITE'S DATA, THEY ARE THE TENANT'S CMS DATA. They land in data_tables/data_rows inside this
 * platform. A server action would therefore have to forward to us anyway, adding a hop that can
 * fail while looking to the visitor as though the form is broken.
 *
 * THREE MORE CONSEQUENCES OF A STATIC BUILD THAT THE OLD DESIGN DID NOT HAVE TO FACE:
 *
 * 1. A server action's identity is a build-specific id. A page cached from an earlier release
 *    would post to an action id the current build no longer has - the same staleness class as the
 *    publish-stamp defect, and it presents as a form that silently stops working after a deploy.
 *
 * 2. THE PAGE TOKEN CANNOT BE STAMPED ANY MORE. formRuntime.ts stamps a per-page HMAC into the
 *    rendered markup with a regex, as a post-render step, because issuing it needs the server
 *    signing secret. A statically built file has no post-render step to stamp it in.
 *
 * 3. AND STAMPING WOULD BE WRONG NOW EVEN IF IT WERE POSSIBLE. A token baked into a static file
 *    served from object storage is public, permanent, and identical for every visitor - so it can
 *    no longer distinguish anything. The old design was sound because the file was baked per
 *    publish by a process holding the secret; that property is gone.
 */

/** How a submission reaches storage. A closed set, because each has a different failure shape. */
export type SubmissionRoute =
  /** The site posts to this platform's public endpoint. The only one a static release supports. */
  | 'platform-endpoint'
  /** A Next server action. Requires a running Next server, which a static release does not have. */
  | 'server-action'
  /** A route handler inside the tenant's app. Same requirement, same problem. */
  | 'route-handler'

/** What the deployment can actually execute, read from the release format rather than assumed. */
export type DeploymentFacts = Readonly<{
  /** True when a Next server runs the tenant's app per request. False for a static release. */
  servesTenantCodeAtRequestTime: boolean
  /** True when submissions are stored by this platform rather than by the tenant's own code. */
  submissionsStoredByPlatform: boolean
}>

export type RouteDecision = Readonly<{
  route: SubmissionRoute
  /** Why, in terms a reader can check against the deployment. */
  reason: string
  /** Routes that were considered and cannot work here, each with the reason. */
  unavailable: readonly Readonly<{ route: SubmissionRoute; reason: string }>[]
}>

export function decideSubmissionRoute(facts: DeploymentFacts): RouteDecision {
  const unavailable: { route: SubmissionRoute; reason: string }[] = []

  if (!facts.servesTenantCodeAtRequestTime) {
    // Both refusals share one cause, and naming it twice is deliberate: somebody evaluating one
    // option should not have to infer that the other fails for the same reason.
    unavailable.push({
      route: 'server-action',
      reason: 'A server action is a request to the Next server runtime, and a static release has no runtime. It would work in development and fail on the published site.',
    })
    unavailable.push({
      route: 'route-handler',
      reason: 'A route handler also requires the Next server runtime. A static release serves files only.',
    })
  } else if (facts.submissionsStoredByPlatform) {
    // A runtime exists, so these are possible - but they would forward to us regardless, and a
    // hop that can fail looks to the visitor like a broken form rather than a failed proxy.
    unavailable.push({
      route: 'server-action',
      reason: 'Possible here, but submissions are stored by the platform, so the action would forward to the platform anyway - an extra hop that can fail while presenting as a broken form.',
    })
  }

  return Object.freeze({
    route: 'platform-endpoint' as const,
    reason: facts.servesTenantCodeAtRequestTime
      ? 'Submissions belong to the platform\'s own tables, so posting to the platform directly avoids a forwarding hop that can fail independently.'
      : 'A static release cannot execute tenant code per request, so the platform endpoint is the only route that works on the published site.',
    unavailable: Object.freeze(unavailable),
  })
}

/**
 * How the anti-abuse token has to work once pages are static files.
 *
 * THE OLD MODEL: a per-page HMAC stamped into the markup at publish time. Sound then, because a
 * process holding the signing secret produced the file. Unusable now, and unsafe if forced.
 *
 * THE NEW MODEL: the token is FETCHED AT SUBMIT TIME from the platform, so it is per-attempt
 * rather than per-file. That also fixes a property the old one lost the moment pages became
 * public static files - a token every visitor shares cannot distinguish anything.
 */
export type TokenDelivery =
  /** Baked into the page at publish time. Only valid when a server produces the page. */
  | 'stamped-into-markup'
  /** Requested from the platform when the visitor submits. */
  | 'fetched-at-submit'

export function decideTokenDelivery(facts: DeploymentFacts): Readonly<{
  delivery: TokenDelivery
  reason: string
}> {
  if (facts.servesTenantCodeAtRequestTime) {
    return Object.freeze({
      delivery: 'stamped-into-markup' as const,
      reason: 'A server renders each page, so it can issue a token scoped to that response.',
    })
  }
  return Object.freeze({
    delivery: 'fetched-at-submit' as const,
    reason: 'A static file is public, permanent and identical for every visitor, so a token baked into it distinguishes nothing. Fetching at submit time makes the token per-attempt.',
  })
}

export type SubmissionProblem = Readonly<{ code: string; message: string }>

/**
 * The properties a submission path must keep, whatever route it takes.
 *
 * These are not new requirements - they are what the existing challenge flow already provides, and
 * the point of listing them is that a rewrite is exactly when they get dropped one at a time.
 */
export function reviewSubmissionPlan(plan: Readonly<{
  route: SubmissionRoute
  facts: DeploymentFacts
  /** Whether a submission is single-use, so a captured request cannot be replayed. */
  singleUse: boolean
  /** Whether the challenge store survives a restart and is shared between processes. */
  challengeStoreIsDurable: boolean
  /** Whether the endpoint states which origins may post to it. */
  originChecked: boolean
}>): readonly SubmissionProblem[] {
  const problems: SubmissionProblem[] = []

  if (plan.route !== 'platform-endpoint' && !plan.facts.servesTenantCodeAtRequestTime) {
    problems.push({
      code: 'route-cannot-run',
      message: 'This route needs a Next server and the release is static files. The form would work in development and fail once published.',
    })
  }

  if (!plan.singleUse) {
    problems.push({
      code: 'replayable-submission',
      message: 'A submission that can be replayed lets one captured request be resent indefinitely, filling the tenant\'s own tables with rows they did not receive.',
    })
  }

  if (!plan.challengeStoreIsDurable) {
    // This is a live property of the shipped code rather than a hypothetical: challenge.ts holds
    // its records in a module-level Map.
    problems.push({
      code: 'challenge-store-in-process',
      message: 'Challenges held in process memory are lost on restart and invisible to other processes, so a visitor who loaded the form before a restart - or who is answered by a different process - is refused with nothing wrong on their side.',
    })
  }

  if (!plan.originChecked) {
    problems.push({
      code: 'origin-unchecked',
      message: 'Without an origin check any page anywhere can post to this endpoint on a visitor\'s behalf.',
    })
  }

  return Object.freeze(problems)
}

/**
 * What the generated site actually contains for a form.
 *
 * A CLIENT COMPONENT, deliberately, and it is the one place in the engine where that is the right
 * answer rather than a cost: a submission is a visitor interaction, so it cannot be a server
 * component, and the alternative - a plain HTML form doing a full-page POST to another origin -
 * navigates the visitor away from the site to a response we would then have to redirect back.
 */
export const GENERATED_FORM_SHAPE = Object.freeze({
  component: 'client' as const,
  reason: 'A submission is a visitor interaction and the response is shown in place. A plain cross-origin form POST would navigate the visitor off the site.',
  validation: 'react-hook-form + zod' as const,
  validationReason: 'Already pinned in the library baseline, and the same schema can state the fields the platform endpoint expects, so the form and the table cannot disagree about what is required.',
  submitsTo: 'platform-endpoint' as const,
})

/** Recorded so the replaced mechanism is explained rather than merely gone. */
export const STAMPING_RETIREMENT = Object.freeze({
  mechanism: 'stampFormPageTokens',
  reason: 'It rewrites rendered HTML with a regex as a post-render step. A static release has no post-render step, and a token baked into a public permanent file distinguishes nothing.',
  replacement: 'A token fetched at submit time, scoped to the attempt rather than to the file.',
})

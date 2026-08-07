/**
 * Task 63: the form submission architecture under Next.
 *
 * The decision is settled by the release format rather than by preference, so the tests assert the
 * format from the shipped contract rather than restating it.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  GENERATED_FORM_SHAPE,
  STAMPING_RETIREMENT,
  decideSubmissionRoute,
  decideTokenDelivery,
  reviewSubmissionPlan,
  type DeploymentFacts,
} from '../../core/publisher/formSubmission'

const STUDIO = join(import.meta.dir, '..', '..', '..')

const STATIC_RELEASE: DeploymentFacts = Object.freeze({
  servesTenantCodeAtRequestTime: false,
  submissionsStoredByPlatform: true,
})

const WITH_RUNTIME: DeploymentFacts = Object.freeze({
  servesTenantCodeAtRequestTime: true,
  submissionsStoredByPlatform: true,
})

describe('the release format decides the route, and it is a static file set', () => {
  it('RenderedArtifact really is a file, not a request handler', () => {
    // This is the fact the whole decision rests on, so it is read from the shipped contract.
    const publisher = readFileSync(join(STUDIO, 'server/fuma/publishing/workerPublisher.ts'), 'utf8')
    expect(publisher).toContain('logicalPath')
    expect(publisher).toContain("Type.Literal('html')")
    expect(publisher).toContain("Type.Literal('asset')")
  })

  it('so a server action is reported as unable to run, not merely discouraged', () => {
    const decision = decideSubmissionRoute(STATIC_RELEASE)
    const action = decision.unavailable.find((entry) => entry.route === 'server-action')
    expect(action?.reason).toContain('no runtime')
  })

  it('and the reason names the failure shape that makes it dangerous', () => {
    // Working in development and failing once published is the worst shape: it passes every check
    // the author can run locally.
    const decision = decideSubmissionRoute(STATIC_RELEASE)
    const action = decision.unavailable.find((entry) => entry.route === 'server-action')
    expect(action?.reason).toContain('development')
    expect(action?.reason).toContain('published')
  })

  it('a route handler is refused for the same cause, stated rather than implied', () => {
    const decision = decideSubmissionRoute(STATIC_RELEASE)
    const handler = decision.unavailable.find((entry) => entry.route === 'route-handler')
    expect(handler?.reason).toContain('runtime')
  })

  it('the chosen route is the platform endpoint', () => {
    expect(decideSubmissionRoute(STATIC_RELEASE).route).toBe('platform-endpoint')
  })
})

describe('the choice survives even if a runtime existed', () => {
  it('because the submissions are the platform\'s data, so an action would forward anyway', () => {
    const decision = decideSubmissionRoute(WITH_RUNTIME)
    expect(decision.route).toBe('platform-endpoint')
    expect(decision.reason).toContain('forwarding hop')
  })

  it('and the extra hop is described by how it presents, not just that it exists', () => {
    const decision = decideSubmissionRoute(WITH_RUNTIME)
    const action = decision.unavailable.find((entry) => entry.route === 'server-action')
    expect(action?.reason).toContain('broken form')
  })

  it('a route handler becomes genuinely available once a runtime exists', () => {
    // The refusal must not outlive its cause, or the reasoning stops being checkable.
    const decision = decideSubmissionRoute(WITH_RUNTIME)
    expect(decision.unavailable.some((entry) => entry.route === 'route-handler')).toBe(false)
  })

  it('and if the platform did not store submissions, nothing is refused at all', () => {
    const tenantStores: DeploymentFacts = {
      servesTenantCodeAtRequestTime: true,
      submissionsStoredByPlatform: false,
    }
    expect(decideSubmissionRoute(tenantStores).unavailable).toHaveLength(0)
  })
})

describe('the page token cannot be stamped into a static file', () => {
  it('the shipped stamper really does rewrite HTML with a regex', () => {
    const runtime = readFileSync(join(STUDIO, 'server/forms/formRuntime.ts'), 'utf8')
    expect(runtime).toContain('html.replace(')
    expect(runtime).toContain('CMS_FORM_TAG_PATTERN')
  })

  it('and it needs the signing secret, which is why it was a post-render step', () => {
    const runtime = readFileSync(join(STUDIO, 'server/forms/formRuntime.ts'), 'utf8')
    expect(runtime).toContain('issuePublicFormPageToken')
  })

  it('so a static release fetches the token at submit time instead', () => {
    expect(decideTokenDelivery(STATIC_RELEASE).delivery).toBe('fetched-at-submit')
  })

  it('and the reason is that a shared permanent token distinguishes nothing', () => {
    // The sharper half of the argument: stamping is not merely impossible now, it would be wrong.
    const decision = decideTokenDelivery(STATIC_RELEASE)
    expect(decision.reason).toContain('distinguishes nothing')
    expect(decision.reason).toContain('every visitor')
  })

  it('while a server-rendered page may still stamp, so the old design is not called a mistake', () => {
    const decision = decideTokenDelivery(WITH_RUNTIME)
    expect(decision.delivery).toBe('stamped-into-markup')
    expect(decision.reason).toContain('scoped to that response')
  })

  it('the retirement records the mechanism and its replacement', () => {
    expect(STAMPING_RETIREMENT.mechanism).toBe('stampFormPageTokens')
    expect(STAMPING_RETIREMENT.replacement).toContain('scoped to the attempt')
  })
})

describe('the properties a rewrite must not drop', () => {
  const sound = {
    route: 'platform-endpoint' as const,
    facts: STATIC_RELEASE,
    singleUse: true,
    challengeStoreIsDurable: true,
    originChecked: true,
  }

  it('a sound plan reports nothing', () => {
    // A review that flags its own correct output gets switched off.
    expect(reviewSubmissionPlan(sound)).toHaveLength(0)
  })

  it('a replayable submission is flagged with the consequence named', () => {
    const problems = reviewSubmissionPlan({ ...sound, singleUse: false })
    expect(problems.map((p) => p.code)).toContain('replayable-submission')
    expect(problems[0]!.message).toContain('rows they did not receive')
  })

  it('an in-process challenge store is flagged, and this is a LIVE property of the shipped code', () => {
    const problems = reviewSubmissionPlan({ ...sound, challengeStoreIsDurable: false })
    expect(problems.map((p) => p.code)).toContain('challenge-store-in-process')
  })

  it('the shipped challenge store really is a module-level Map', () => {
    // The same durability class as the publish-version counter: lost on restart, invisible to
    // other processes. Evidenced rather than asserted.
    const challenge = readFileSync(join(STUDIO, 'server/forms/challenge.ts'), 'utf8')
    expect(challenge).toMatch(/const challenges = new Map</)
  })

  it('and the message states both failure modes, because they present differently', () => {
    const problems = reviewSubmissionPlan({ ...sound, challengeStoreIsDurable: false })
    const message = problems.find((p) => p.code === 'challenge-store-in-process')!.message
    expect(message).toContain('restart')
    expect(message).toContain('different process')
  })

  it('an unchecked origin is flagged', () => {
    const problems = reviewSubmissionPlan({ ...sound, originChecked: false })
    expect(problems.map((p) => p.code)).toContain('origin-unchecked')
  })

  it('a route that cannot run is flagged even when everything else is sound', () => {
    const problems = reviewSubmissionPlan({ ...sound, route: 'server-action' })
    expect(problems.map((p) => p.code)).toContain('route-cannot-run')
  })

  it('reports every problem rather than stopping at the first', () => {
    const problems = reviewSubmissionPlan({
      ...sound,
      singleUse: false,
      challengeStoreIsDurable: false,
      originChecked: false,
    })
    expect(problems.length).toBe(3)
  })
})

describe('what the generated site contains', () => {
  it('a client component, which is the right answer here rather than a cost', () => {
    expect(GENERATED_FORM_SHAPE.component).toBe('client')
    expect(GENERATED_FORM_SHAPE.reason).toContain('navigate the visitor off the site')
  })

  it('validated with the libraries already pinned in the baseline', () => {
    expect(GENERATED_FORM_SHAPE.validation).toBe('react-hook-form + zod')
    const baseline = readFileSync(join(STUDIO, 'src/core/generatedSite/libraryBaseline.ts'), 'utf8')
    expect(baseline).toContain('react-hook-form')
    expect(baseline).toContain('zod')
  })

  it('and the schema is shared so the form and the table cannot disagree', () => {
    expect(GENERATED_FORM_SHAPE.validationReason).toContain('cannot disagree')
  })

  it('submitting to the platform endpoint, agreeing with the decision', () => {
    expect(GENERATED_FORM_SHAPE.submitsTo).toBe(decideSubmissionRoute(STATIC_RELEASE).route)
  })
})

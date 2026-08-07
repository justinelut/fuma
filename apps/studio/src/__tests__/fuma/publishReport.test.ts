/**
 * Task 56: communicate build-based publish honestly.
 *
 * The builder said "N pages published" the instant the request returned. On the release path that
 * request only ENQUEUES - productionRuntime.ts:124 states it "never publishes in the web
 * process". So the message claimed the work had finished before it started, claimed success
 * before anything could fail, and claimed live when `built` and `active` are deliberately
 * different states (task 53).
 */
import { describe, expect, it } from 'bun:test'
import {
  isInFlight,
  isPublished,
  liveSiteChanged,
  publishLabel,
  publishMessage,
  reviewClaim,
  type PublishReport,
} from '@core/publisher/publishReport'

const immediate = (phase: PublishReport['phase'], pages?: number): PublishReport =>
  ({ mode: 'immediate', phase, pages })
const build = (phase: PublishReport['phase'], failure?: string): PublishReport =>
  ({ mode: 'build', phase, failure })

describe('only a serving release may be called published', () => {
  it('built is NOT published', () => {
    // Task 53 separated `built` from `active` because a build that compiled can still be wrong.
    // Calling it published here would undo that distinction in the one place people read.
    expect(isPublished(build('built'))).toBe(false)
    expect(publishLabel(build('built'))).toContain('not live yet')
  })

  it('accepted is NOT published', () => {
    expect(isPublished(build('accepted'))).toBe(false)
  })

  it('live IS published', () => {
    expect(isPublished(build('live'))).toBe(true)
    expect(publishLabel(build('live'))).toBe('Published')
  })

  it('only live means the visitor-facing site changed', () => {
    for (const phase of ['idle', 'submitting', 'accepted', 'building', 'built', 'failed', 'request-failed'] as const) {
      expect(liveSiteChanged(build(phase))).toBe(false)
    }
    expect(liveSiteChanged(build('live'))).toBe(true)
  })
})

describe('the immediate path keeps its existing truth', () => {
  it('says exactly what it said before', () => {
    // Those words were TRUE for a synchronous bake, so changing them would invent uncertainty a
    // self-hosted install does not have.
    expect(publishLabel(immediate('live'))).toBe('Published')
    expect(publishMessage(immediate('live', 3))).toBe('3 pages published')
  })

  it('uses singular wording for one page', () => {
    expect(publishMessage(immediate('live', 1))).toBe('1 page published')
  })

  it('says nothing mid-flight rather than filling the space', () => {
    // A status line that always says something trains people to stop reading it.
    expect(publishMessage(immediate('submitting'))).toBeNull()
  })

  it('still reports a page count it was given', () => {
    expect(publishMessage(immediate('live', 12))).toContain('12 pages')
  })
})

describe('the build path states that nothing is live yet', () => {
  it('queued says the live site is unchanged', () => {
    // The precise correction: the old wording let somebody go and look at an unchanged site
    // believing the work was done, and conclude the product was broken.
    const message = publishMessage(build('accepted'))
    expect(message).toContain('unchanged')
    expect(message).not.toMatch(/\bpublished\b/i)
  })

  it('building warns that it can still fail', () => {
    expect(publishMessage(build('building'))).toContain('can fail')
  })

  it('built says it is not live until activated', () => {
    const message = publishMessage(build('built'))
    expect(message).toContain('activated')
    expect(message).not.toMatch(/^Published/)
  })

  it('live states that visitors are seeing it', () => {
    expect(publishMessage(build('live'))).toContain('Live')
  })
})

describe('a build failure AFTER a successful request is expressible', () => {
  it('is a distinct phase from a failed request', () => {
    // The old state machine had no state between 'published' and 'error', and 'error' only ever
    // meant the REQUEST failed - so this outcome could not be reported at all.
    expect(publishLabel(build('failed'))).toBe('Build failed')
    expect(publishLabel(build('request-failed'))).toBe('Publish site')
  })

  it('says the live site is unchanged, which is the fact that matters', () => {
    expect(publishMessage(build('failed'))).toContain('live site is unchanged')
  })

  it('carries the cause when there is one', () => {
    // A failure nobody can read is indistinguishable from one nobody noticed.
    expect(publishMessage(build('failed', 'Type error in app/page.tsx'))).toContain('Type error in app/page.tsx')
  })

  it('still reads sensibly with no cause', () => {
    expect(publishMessage(build('failed'))).not.toContain('undefined')
  })

  it('a failed request says no build was started', () => {
    // Distinguishing them matters: one means retry, the other means read the build log.
    expect(publishMessage(build('request-failed'))).toContain('no build was started')
  })
})

describe('isInFlight', () => {
  it('covers every phase that can change on its own', () => {
    expect(isInFlight(build('submitting'))).toBe(true)
    expect(isInFlight(build('accepted'))).toBe(true)
    expect(isInFlight(build('building'))).toBe(true)
  })

  it('excludes phases that need a person or nothing at all', () => {
    // `built` is deliberately NOT in flight: it waits for an activation decision, and showing a
    // spinner would imply it resolves itself.
    expect(isInFlight(build('built'))).toBe(false)
    expect(isInFlight(build('live'))).toBe(false)
    expect(isInFlight(build('failed'))).toBe(false)
    expect(isInFlight(build('idle'))).toBe(false)
  })
})

describe('reviewClaim guards the wording', () => {
  it('refuses a completion claim in a non-serving phase', () => {
    const problem = reviewClaim(build('accepted'), '3 pages published')
    expect(problem).not.toBeNull()
    expect(problem).toContain('not serving')
  })

  it('accepts the same claim once live', () => {
    expect(reviewClaim(build('live'), '3 pages published')).toBeNull()
  })

  it('does not trip on a negated mention', () => {
    // "not published yet" is honest, and a checker that flagged it would push authors towards
    // vaguer wording rather than clearer.
    expect(reviewClaim(build('building'), 'This is not published yet')).toBeNull()
  })

  it('accepts wording that avoids the claim entirely', () => {
    expect(reviewClaim(build('building'), 'Building your site')).toBeNull()
  })
})

describe('the release path genuinely defers the work', () => {
  it('the runtime states it never publishes in the web process', async () => {
    // This is why the honest vocabulary is needed rather than a nicety: the request returning
    // cannot mean the pages are live.
    const text = await Bun.file(new URL('../../../server/fuma/mcp/productionRuntime.ts', import.meta.url)).text()
    expect(text).toContain('never publishes in the web process')
  })
})

describe('the builder uses the shared vocabulary, not its own wording', () => {
  it('the publish button reports through publishMessage', async () => {
    // Otherwise the rule lives in a module nothing consults, which is how the two paths came to
    // disagree in the first place.
    const text = await Bun.file(new URL('../../admin/pages/site/toolbar/PublishButton.tsx', import.meta.url)).text()
    expect(text).toContain('publishMessage({')
    // The hand-written template strings it used to build are gone.
    expect(text).not.toMatch(/`\$\{result\.publishedPages\} pages published`/)
  })

  it('distinguishes a failed request from a failed build', async () => {
    const text = await Bun.file(new URL('../../admin/pages/site/toolbar/PublishButton.tsx', import.meta.url)).text()
    expect(text).toContain("phase: 'request-failed'")
  })

  it('states why the immediate phase is live on this path', async () => {
    // A future reader must not copy `phase: 'live'` into the enqueueing path, where it would be
    // exactly the false claim this task removed.
    const text = await Bun.file(new URL('../../admin/pages/site/toolbar/PublishButton.tsx', import.meta.url)).text()
    expect(text).toContain('bakes the pages synchronously')
  })
})

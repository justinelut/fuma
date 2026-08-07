/**
 * The app root as a real entry surface.
 *
 * The hosted root redirects to /admin, and for a staff user whose scope does not resolve to one
 * site that lands on PlatformDashboard. So this file IS the entry surface, and it was carrying
 * three defects that only show up on a first visit or a narrow viewport.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../admin/fuma')
const source = readFileSync(join(ROOT, 'dashboards/PlatformDashboard.tsx'), 'utf8')

describe('the entry header is one row at every width', () => {
  it('does NOT flex-wrap', () => {
    // THE SAME DEFECT AS TASKS 5 AND 14, IN A THIRD PLACE. A sticky element has whatever
    // height its content gives it, so flex-wrap plus a full-width nav made this header several
    // rows tall on a narrow viewport - and it covered the surface underneath, which is the
    // page the visitor came for.
    const header = source.slice(source.indexOf('function HeaderShell'), source.indexOf('function HeaderShell') + 900)
    // Scoped to CLASS position, not the whole slice: the source comment explaining the fix
    // names the class deliberately, and matching that would fail on the explanation.
    const classLines = header.split('\n').filter((line) => /^\s*'/.test(line))
    expect(classLines.join(' ')).not.toContain('flex-wrap')
    expect(header).toContain('flex items-center justify-between')
  })

  it('the nav is not forced onto its own full-width row', () => {
    // Scoped to a className attribute so a comment mentioning the old value cannot pass or
    // fail this on its own.
    expect(source).not.toMatch(/className="[^"]*order-3 w-full/)
  })

  it('the nav is hidden below lg rather than stacked', () => {
    expect(source).toContain('className="hidden lg:block"')
  })

  it('is translucent so it does not seam against the gradient wash', () => {
    // The page carries a radial gradient; an opaque strip over a gradient shows as a hard
    // edge exactly where the header ends.
    expect(source).toContain('bg-background/85')
    expect(source).toContain('backdrop-blur-sm')
  })
})

describe('the site strip describes what it contains', () => {
  it('is named for sites, not sections', () => {
    // It listed SITE names under the accessible name "Platform sections", so a screen-reader
    // user was told one thing and read another.
    expect(source).toContain('aria-label="Jump to a site"')
    expect(source).not.toContain('aria-label="Platform sections"')
  })

  it('reports the sites it does not show instead of truncating silently', () => {
    // Same dishonesty task 8 fixed in the switcher: a site that exists but is not listed
    // reads as deleted, and somebody goes looking for it in the wrong place.
    expect(source).toContain('NAV_SITE_LIMIT')
    expect(source).toMatch(/more below/)
    expect(source).toMatch(/sites\.length > NAV_SITE_LIMIT/)
  })

  it('states why the limit exists where the limit is declared', () => {
    const declaration = source.slice(Math.max(0, source.indexOf('const NAV_SITE_LIMIT') - 400), source.indexOf('const NAV_SITE_LIMIT'))
    expect(declaration.length).toBeGreaterThan(100)
    expect(declaration).toContain('REPORTED')
  })
})

describe('first run carries the action, not a direction', () => {
  it('no longer tells the visitor to look "below"', () => {
    // A direction depends on layout the component does not control, so it is false the moment
    // the order changes or the form is gated - and it is wrong on the one visit that decides
    // whether somebody keeps going.
    expect(source).not.toContain('Create one below to get started')
  })

  it('offers a create action in the empty state', () => {
    expect(source).toContain('Create your first site')
    expect(source).toContain('href="#add-a-site"')
  })

  it('the action targets a section that actually exists', () => {
    // A first-run call to action pointing at a missing anchor does nothing when clicked,
    // which reads as the product being broken.
    expect(source).toContain('id="add-a-site"')
  })

  it('reserves space for the sticky header when jumping to it', () => {
    // Without scroll-mt the anchor lands under the sticky header and the heading is hidden.
    expect(source).toContain('scroll-mt-24')
  })
})

describe('the entry surface spends only rhythm steps', () => {
  const ALLOWED = new Set(['mt-1.5', 'mt-3', 'mt-6', 'mt-10', 'mt-12'])

  it('has no ad-hoc top margins left', () => {
    // MEASURED DEFECT: this file carried ELEVEN distinct values (mt-0.5, 1, 1.5, 2, 3, 4, 5,
    // 6, 7, 8, 9) with nothing deciding which applied where. That reads as slightly wrong
    // everywhere while no single value is identifiably the mistake, which is why adjusting one
    // number never fixed it. My task-3 sweep covered five dashboards and MISSED this one.
    const used = new Set<string>()
    for (const match of source.matchAll(/(?<![-\w.])mt-[0-9.]+/g)) used.add(match[0])
    const offenders = [...used].filter((token) => !ALLOWED.has(token))
    expect(offenders).toEqual([])
  })

  it('imports the shared scale rather than restating values', () => {
    // Reading the same source the gate reads is what keeps the two from drifting.
    expect(source).toContain("from '../ui/rhythm'")
  })
})

describe('the root keeps one canonical entry address', () => {
  const router = readFileSync(join(import.meta.dir, '../../admin/router.tsx'), 'utf8')

  it('sends / to the single entry rather than rendering a second copy', () => {
    // Deliberate: two addresses rendering the entry means two surfaces to keep correct and a
    // bookmark that depends on which one somebody saved. The entry earns its name by what it
    // SHOWS, which is what this file tests, not by owning an extra URL.
    expect(router).toContain('<Route path="/" element={<Navigate')
  })

  it('self-host and hosted resolve to their own entries', () => {
    expect(router).toContain("hosted ? '/admin' : '/admin/dashboard'")
  })
})

/**
 * The page acceptance standard, run over the REAL shipped navigation presets and the REAL admin tree.
 *
 * This gate found a live defect rather than confirming a belief: `nav.website-analytics` resolved to
 * `route.website-analytics` and no surface claimed it, so a website site's Analytics entry rendered
 * an empty content region.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  DASHBOARD_OWNED_SUBPATHS,
  PAGE_ACCEPTANCE,
  reviewProfilePages,
  type NavEntry,
  type RouteDecl,
} from '../../core/fuma/pageAcceptance'

const STUDIO = join(import.meta.dir, '..', '..', '..')
const PROFILES = readFileSync(join(STUDIO, 'src/core/fuma/launchProfiles.ts'), 'utf8')

function adminSources(): string {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return entry === '__tests__' ? [] : walk(path)
    return path.endsWith('.tsx') || path.endsWith('.ts') ? [path] : []
  })
  return walk(join(STUDIO, 'src/admin')).map((path) => readFileSync(path, 'utf8')).join('\n')
}

const ADMIN = adminSources()

const shippedNav: readonly NavEntry[] = Object.freeze(
  [...PROFILES.matchAll(/\{ id: '(nav\.[^']+)',[^}]*?path: '([^']+)'/g)]
    .map((match) => Object.freeze({ id: match[1]!, path: match[2]! })),
)

const shippedRoutes: readonly RouteDecl[] = Object.freeze(
  [...PROFILES.matchAll(/\{ id: '(route\.[^']+)', method: '([A-Z]+)', path: '([^']+)'/g)]
    .map((match) => Object.freeze({ id: match[1]!, method: match[2]!, path: match[3]! })),
)

const claims = (routeId: string): boolean => ADMIN.includes(`'${routeId}'`)

describe('the shipped navigation is extracted, not assumed', () => {
  it('finds real entries and routes, so a passing gate is not a gate reading nothing', () => {
    // Without this, a regex that stopped matching would make every assertion below vacuous.
    expect(shippedNav.length).toBeGreaterThanOrEqual(8)
    expect(shippedRoutes.length).toBeGreaterThanOrEqual(15)
    expect(shippedNav.some((entry) => entry.id === 'nav.website-analytics')).toBe(true)
  })

  it('declares both a GET and a POST route on some shared path', () => {
    // The reason the review filters by method. Keying by path alone let the POST twin displace the
    // GET route and reported four publication pages as unclaimed when they are fine.
    const posts = shippedRoutes.filter((route) => route.path === '/admin/posts')
    expect(posts.map((route) => route.method).sort()).toEqual(['GET', 'POST'])
  })
})

describe('every navigation entry reaches a page', () => {
  it('reports no unreachable destination across every shipped profile', () => {
    const problems = reviewProfilePages(shippedNav, shippedRoutes, claims)
    expect(problems.map((problem) => `${problem.navId} -> ${problem.routeId ?? problem.path}`)).toEqual([])
  })

  it('and the analytics route is claimed, which is the defect this gate found', () => {
    expect(claims('route.website-analytics')).toBe(true)
  })

  it('and every claiming surface is MOUNTED in the shell, not merely present in the tree', () => {
    // A surface that claims a route id but is never rendered leaves the region just as empty as no
    // surface at all - the inert-fix mistake tasks 20, 52 and 68 each made. Naming the file is not
    // enough; the shell has to render it.
    const shell = readFileSync(join(STUDIO, 'src/admin/preauth/HostedStaffShell.tsx'), 'utf8')
    for (const surface of [
      'WebsiteAnalyticsRouteContent',
      'DomainsRouteContent',
      'OrganizationManagementRouteContent',
      'PublicationRouteContent',
    ]) {
      expect(shell).toContain(`<${surface}`)
    }
  })
})

describe('the review fires rather than only passing', () => {
  it('reports a navigation entry whose route nobody claims', () => {
    const problems = reviewProfilePages(
      [{ id: 'nav.invented', path: '/admin/invented' }],
      [{ id: 'route.invented', method: 'GET', path: '/admin/invented' }],
      () => false,
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]!.code).toBe('route-claimed-by-nothing')
    // The consequence has to be in the message, or somebody reads it as a naming nit.
    expect(problems[0]!.message).toContain('empty content region')
  })

  it('reports a navigation entry with no route at all, as a different problem', () => {
    const problems = reviewProfilePages(
      [{ id: 'nav.dangling', path: '/admin/nowhere' }],
      [],
      () => true,
    )
    expect(problems[0]!.code).toBe('nav-path-has-no-route')
    expect(problems[0]!.routeId).toBeNull()
  })

  it('does not accept a POST route as a navigation destination', () => {
    // A nav link is a GET; treating the POST twin as the destination would pass a nav entry that
    // resolves to nothing on click.
    const problems = reviewProfilePages(
      [{ id: 'nav.writeonly', path: '/admin/thing' }],
      [{ id: 'route.thing.write', method: 'POST', path: '/admin/thing' }],
      () => true,
    )
    expect(problems[0]!.code).toBe('nav-path-has-no-route')
  })

  it('exempts only the dashboard-owned home path', () => {
    expect(DASHBOARD_OWNED_SUBPATHS).toEqual(['/admin'])
    const problems = reviewProfilePages(
      [{ id: 'nav.home', path: '/admin' }],
      [{ id: 'route.home', method: 'GET', path: '/admin' }],
      () => false,
    )
    expect(problems).toEqual([])
  })

  it('and the exemption is genuinely earned by a dashboard owning that subpath', () => {
    const website = readFileSync(
      join(STUDIO, 'src/admin/fuma/dashboards/website/WebsiteDashboardRoute.tsx'), 'utf8',
    )
    expect(website).toContain("WEBSITE_DASHBOARD_SUBPATH = '/admin'")
  })
})

describe('THE VISUAL BUILDER KEEPS WHAT IT WAS BUILT WITH; EVERYTHING ELSE IS TAILWIND', () => {
  /**
   * The boundary is the visual builder, and it is drawn by direction and by the build configuration
   * agreeing with each other:
   *
   * - `postcss.config.mjs`: "Tailwind runs only for the hosted Fuma surfaces. src/styles/hosted.css
   *   deliberately omits Tailwind's preflight so the Instatic builder's CSS modules keep their own
   *   base styles."
   * - `src/styles/hosted.css`: preflight "would silently restyle Instatic's builder files, which stay
   *   on CSS modules by design."
   *
   * WHY THE BUILDER CANNOT SIMPLY BE CONVERTED: hosted.css imports Tailwind's theme and utilities but
   * NOT preflight. The builder's stylesheets therefore supply its base element styles. Converting a
   * builder file would strip those bases with nothing replacing them - headings and paragraphs fall
   * back to browser defaults, so the page looks wrong while every test still passes.
   *
   * So there are TWO ratchets pointing in opposite directions, which is the whole rule:
   *   - the builder's stylesheet count must NOT SHRINK;
   *   - every OTHER admin surface must move to Tailwind, so its count must NOT GROW.
   */
  /**
   * The builder's own tree, plus the shared components that render inside it.
   *
   * `src/admin/shared` is BUILDER CHROME, established by measurement rather than by its name: every
   * one of its stylesheet-bearing components is imported by `src/admin/pages` (Panel 21 times, StepUp
   * 20) and NONE is imported by a hosted surface. Converting them would strip base styles inside the
   * builder, which is the one place with no preflight to fall back on.
   */
  const BUILDER_ROOTS = ['src/admin/pages', 'src/admin/shared'] as const
  const HOSTED_ROOTS = ['src/admin/fuma', 'src/admin/preauth'] as const
  /**
   * The SECOND half of the same property, and the half that is easy to overclaim. A hosted surface
   * owning no stylesheet is not the same as a hosted surface being free of hand-written CSS: the
   * shared editor kit under `src/ui` carries its own CSS modules (Button.module.css, Input.module.css,
   * and so on), so importing one pulls a stylesheet in transitively.
   *
   * Measured, not assumed: the Button and Input were swapped for their shadcn equivalents across
   * every hosted surface, and what remains are the kit components with NO drop-in shadcn twin -
   * FormField, DataTable, EmptyState, Select, Alert, Skeleton, Toast, TagPill. Those carry real
   * behaviour (adornments, column configuration) rather than only styling, so swapping them is a
   * rewrite per call site rather than a rename, and doing it carelessly silently drops function.
   *
   * So this is a shrink-only ratchet like the one above was: it records the true remaining number and
   * refuses to let it grow. A new hosted surface must reach for shadcn.
   */
  const SHARED_KIT_IMPORTER_BUDGET = 10

  const BUILDER_STYLESHEET_FLOOR = 152

  function walk(dir: string, match: (path: string) => boolean): string[] {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return [] }
    return entries.flatMap((entry) => {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) return walk(path, match)
      return match(path) ? [path] : []
    })
  }

  it('never grows the hosted dependency on the shared editor kit, which carries its own CSS', () => {
    const importers = HOSTED_ROOTS.flatMap((root) =>
      walk(join(STUDIO, root), (path) => path.endsWith('.tsx') || path.endsWith('.ts')))
      .filter((path) => readFileSync(path, 'utf8').includes('@ui/components/'))
    expect(importers.length).toBeLessThanOrEqual(SHARED_KIT_IMPORTER_BUDGET)
  })

  it('keeps that budget honest, so a stale number cannot silently permit a new one', () => {
    const importers = HOSTED_ROOTS.flatMap((root) =>
      walk(join(STUDIO, root), (path) => path.endsWith('.tsx') || path.endsWith('.ts')))
      .filter((path) => readFileSync(path, 'utf8').includes('@ui/components/'))
    expect(importers.length).toBe(SHARED_KIT_IMPORTER_BUDGET)
  })

  it('reaches for shadcn for the two primitives that DO have a drop-in twin', () => {
    // Button and Input were the bulk of the dependency and are fully migrated; asserting it here
    // stops a later edit from reintroducing the kit spelling that the budget above still permits
    // for the components with no twin.
    const hosted = HOSTED_ROOTS.flatMap((root) =>
      walk(join(STUDIO, root), (path) => path.endsWith('.tsx')))
      .map((path) => readFileSync(path, 'utf8')).join('\n')
    expect(hosted).not.toContain("@ui/components/Button")
    expect(hosted).not.toContain("@ui/components/Input")
  })

  it('never loses a builder stylesheet, because the builder has no preflight to fall back on', () => {
    const sheets = BUILDER_ROOTS.flatMap((root) =>
      walk(join(STUDIO, root), (path) => path.endsWith('.module.css')))
    expect(sheets.length).toBeGreaterThanOrEqual(BUILDER_STYLESHEET_FLOOR)
  })

  it('and no hosted surface reaches into the builder\'s stylesheet components', () => {
    // This is what makes the split safe to hold: if a hosted page imported Panel or StepUp it would
    // inherit a CSS module, and the two rules would be in conflict over one file.
    const hosted = ['src/admin/fuma', 'src/admin/preauth']
      .flatMap((root) => walk(join(STUDIO, root), (path) => path.endsWith('.tsx')))
      .map((path) => readFileSync(path, 'utf8')).join('\n')
    for (const component of ['shared/Panel', 'shared/StepUp', 'shared/FloatingWindow']) {
      expect(hosted, component).not.toContain(component)
    }
  })

  it('and the reason is stated in the shipped build configuration, not only here', () => {
    const postcss = readFileSync(join(STUDIO, 'postcss.config.mjs'), 'utf8')
    expect(postcss).toContain('hosted Fuma surfaces')
    // The comment wraps across lines, so match the words rather than the joined phrase.
    expect(postcss).toMatch(/CSS\s*\*?\s*modules keep their own base styles/)
    const hosted = readFileSync(join(STUDIO, 'src/styles/hosted.css'), 'utf8')
    expect(hosted).toContain("@import 'tailwindcss/utilities.css'")
    // No preflight is what makes the split safe; importing it would restyle the builder globally.
    expect(hosted).not.toContain('preflight.css')
  })

  it('and Tailwind is genuinely compiled for the surfaces it does govern', () => {
    // Without this the conversions would emit classes producing no CSS at all - the same silent
    // failure the dead `dash-*` tokens caused in task 6.
    expect(readFileSync(join(STUDIO, 'postcss.config.mjs'), 'utf8')).toContain('@tailwindcss/postcss')
    expect(readFileSync(join(STUDIO, 'src/admin/main.tsx'), 'utf8')).toContain('hosted.css')
  })
})

describe('the shadcn-only property is ratcheted rather than merely stated', () => {
  /**
   * The count of hosted surfaces still carrying a CSS module.
   *
   * A RATCHET, not a target: it may SHRINK and must never grow. Files that predate the shadcn
   * conversion, and converting them is task 76/77 work rather than something to do silently here.
   * But without a bound the standard is a wish - a new page could ship with a stylesheet and no gate
   * would notice, so the debt would grow while a document said it should not.
   *
   * Lower this number when a surface is converted. It is deliberately awkward to raise: raising it
   * means deleting a converted page's progress, which is a visible reviewable act.
   */
  /**
   * This began as a shrink-only ratchet at 34 and has reached zero, so it is no longer a budget being
   * worked down - it is an absolute rule. Every surface outside the visual builder is Tailwind, and a
   * stylesheet reappearing under a hosted directory is now a failure rather than a permitted remnant.
   * It stays expressed as a number so the two directions - this at zero, BUILDER_STYLESHEET_FLOOR at
   * 152 - read as one boundary rather than two unrelated rules.
   */

  const CSS_MODULE_BUDGET = 0

  function surfacesWithStylesheets(): readonly string[] {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) return entry === '__tests__' ? [] : walk(path)
      return path.endsWith('.tsx') || path.endsWith('.ts') ? [path] : []
    })
    // Every admin surface EXCEPT the visual builder: apart from the builder, everything is
    // Tailwind, so any stylesheet outside src/admin/pages is debt on its way out.
    // HOSTED surfaces only. src/admin/shared is builder chrome (measured above), so it is held by
    // the builder floor rather than pushed toward Tailwind here.
    return Object.freeze(['src/admin/fuma', 'src/admin/preauth']
      .flatMap((root) => walk(join(STUDIO, root)))
      .filter((path) => readFileSync(path, 'utf8').includes('module.css')))
  }

  it('never grows beyond the recorded budget', () => {
    const offenders = surfacesWithStylesheets()
    expect(offenders.length).toBeLessThanOrEqual(CSS_MODULE_BUDGET)
  })

  it('and the budget is not stale, so a conversion has to lower it', () => {
    // A budget left above the real count would silently permit a new stylesheet.
    expect(surfacesWithStylesheets().length).toBe(CSS_MODULE_BUDGET)
  })

  it('and the pages built to the standard carry none', () => {
    const offenders = surfacesWithStylesheets().join('\n')
    for (const built of ['analytics/WebsiteAnalyticsRouteContent', 'members/SiteMembersSurface']) {
      expect(offenders).not.toContain(built)
    }
  })
})

describe('the standard names its own enforcement', () => {  it('lists every property with a gate rather than a wish', () => {
    expect(PAGE_ACCEPTANCE.length).toBeGreaterThanOrEqual(5)
    for (const property of PAGE_ACCEPTANCE) {
      expect(property.rule.length).toBeGreaterThan(30)
      // A property with no named enforcement is a document, and documents do not fail builds.
      expect(property.enforcedBy.length).toBeGreaterThan(20)
    }
  })

  it('and the gates it names exist', () => {
    for (const file of [
      'src/__tests__/architecture/noTailwindUtilities.test.ts',
      'src/__tests__/admin/storageAllowance.test.tsx',
      'src/__tests__/admin/websiteDashboardHome.test.tsx',
      'src/__tests__/admin/siteMembers.test.tsx',
    ]) {
      expect(statSync(join(STUDIO, file)).isFile()).toBe(true)
    }
  })
})

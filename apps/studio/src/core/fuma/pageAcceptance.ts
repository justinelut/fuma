/**
 * One acceptance standard for every hosted page.
 *
 * WHY THIS IS A FUNCTION AND NOT A CHECKLIST. A written standard is checked when somebody remembers
 * to check it, which is never the page that needed it. The property below was not found by reading
 * the pages - it was found by MEASURING them, and it had been wrong in production the whole time:
 * `nav.website-analytics` pointed at `route.website-analytics`, and no admin file claimed that id,
 * so a website site's "Analytics" entry rendered the shell with an EMPTY CONTENT REGION.
 *
 * That failure is silent in the worst way. Nothing throws, the navigation highlights correctly, the
 * chrome draws, and the region where the page belongs is blank - so it reads as the product being
 * broken rather than as a page nobody wrote. It is also invisible to every unit test of every
 * component, because the defect is the ABSENCE of a component.
 *
 * The standard therefore checks the wiring between three declarations that are maintained
 * separately and drift silently: the navigation preset, the route table and the components that
 * claim route ids.
 */

export interface NavEntry {
  readonly id: string
  readonly path: string
}

export interface RouteDecl {
  readonly id: string
  /** A navigation link is a GET. A POST twin sharing the path is a different route. */
  readonly method: string
  readonly path: string
}

export type AcceptanceCode =
  | 'nav-path-has-no-route'
  | 'route-claimed-by-nothing'

export interface AcceptanceProblem {
  readonly code: AcceptanceCode
  readonly navId: string
  readonly path: string
  readonly routeId: string | null
  readonly message: string
}

/**
 * Subpaths a profile dashboard renders as its own body rather than through a route-id claim.
 *
 * A CARVE-OUT WITH A REASON, not a silencer. `WebsiteDashboardRoute` and `PublicationDashboardRoute`
 * own `/admin` and select on `profileRelativeSubpath`, so `route.home` is genuinely served while no
 * file mentions its id. Without this the gate would report its own product's home page as missing
 * and be switched off - and a gate that cries wolf is not there when it is right.
 *
 * Deliberately narrow: one path. Any other unclaimed route is a real finding.
 */
export const DASHBOARD_OWNED_SUBPATHS: readonly string[] = Object.freeze(['/admin'])

/**
 * Review the navigation of one profile against the routes and the ids some component claims.
 *
 * `claimsRouteId` is supplied by the caller rather than computed here, because deciding whether a
 * component claims an id means reading the admin tree - a filesystem concern that has no business
 * in `src/core`, which is browser-shared.
 */
export function reviewProfilePages(
  navigation: readonly NavEntry[],
  routes: readonly RouteDecl[],
  claimsRouteId: (routeId: string) => boolean,
): readonly AcceptanceProblem[] {
  const problems: AcceptanceProblem[] = []
  // Keyed from GET routes only. Keying by path alone lets a POST twin overwrite the GET one, which
  // is a mistake I made measuring this: it reported four publication pages as unclaimed because the
  // write route displaced the read route they are actually reached by.
  const getByPath = new Map(
    routes.filter((route) => route.method === 'GET').map((route) => [route.path, route.id]),
  )
  for (const entry of navigation) {
    if (DASHBOARD_OWNED_SUBPATHS.includes(entry.path)) continue
    const routeId = getByPath.get(entry.path) ?? null
    if (routeId === null) {
      problems.push(Object.freeze({
        code: 'nav-path-has-no-route' as const,
        navId: entry.id,
        path: entry.path,
        routeId: null,
        message: `${entry.id} links to ${entry.path}, which no GET route declares. Choosing it `
          + 'cannot resolve to a page, so the navigation offers a destination that does not exist.',
      }))
      continue
    }
    if (!claimsRouteId(routeId)) {
      problems.push(Object.freeze({
        code: 'route-claimed-by-nothing' as const,
        navId: entry.id,
        path: entry.path,
        routeId,
        message: `${entry.id} resolves to ${routeId} and no surface claims that id, so the page `
          + 'renders as an empty content region. Nothing errors, which is why this is not caught by '
          + 'a component test - the defect is the absence of a component.',
      }))
    }
  }
  return Object.freeze(problems)
}

/**
 * The properties every hosted page is held to, recorded as data so a reviewer reads one list.
 *
 * Only the first is mechanically checked by `reviewProfilePages`. The rest are enforced by existing
 * gates, and each names the gate so this list cannot drift into a wish list: a standard whose items
 * have no enforcement is a document, and documents do not fail builds.
 */
export const PAGE_ACCEPTANCE: readonly Readonly<{
  id: string
  rule: string
  enforcedBy: string
}>[] = Object.freeze([
  Object.freeze({
    id: 'reachable',
    rule: 'Every navigation entry resolves to a route some surface claims.',
    enforcedBy: 'reviewProfilePages, run over every profile by page-acceptance.test.ts',
  }),
  Object.freeze({
    id: 'shadcn-only',
    rule: 'Composed from the shadcn set and Lucide. No CSS module, no hand-written stylesheet - and\n      no import of the shared editor kit under src/ui, whose components carry stylesheets of their own,\n      so a hosted surface can depend on hand-written CSS without owning any.',
    enforcedBy: 'two ratchets in page-acceptance.test.ts - the CSS-module one, now at ZERO and so a\n      hard rule rather than a budget, and the shared-kit importer one, still shrinking; plus '
      + 'noTailwindUtilities.test.ts REACT_ENGINE_CONVERTED and the dash-token scan in storageAllowance.test.ts',
  }),
  Object.freeze({
    id: 'one-rhythm',
    rule: 'Vertical space comes from the rhythm scale rather than ad-hoc margins.',
    enforcedBy: 'the rhythm gate in websiteDashboardHome.test.ts',
  }),
  Object.freeze({
    id: 'absence-is-stated',
    rule: 'An unmeasured or unknown quantity is stated in words. It is never rendered as zero, as '
      + 'unlimited, or as an empty chart, because each of those is read as a measurement.',
    enforcedBy: 'per-surface tests: storageAllowance.test.ts, siteMembers.test.tsx, websiteAnalytics.test.tsx',
  }),
  Object.freeze({
    id: 'empty-is-not-no-match',
    rule: 'A surface with nothing in it says so differently from a search that matched nothing, '
      + 'because the wrong one of those reads as a broken search.',
    enforcedBy: 'per-surface tests: siteMembers.test.tsx, blocksPanel.test.tsx',
  }),
])

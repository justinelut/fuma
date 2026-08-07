/**
 * Which shell owns each admin section.
 *
 * THE HOSTED PRODUCT HAS TWO SHELLS, and for a while both offered the same things. The platform
 * shell owns the account, billing, credits, domains, team and the dashboards; the builder is
 * Instatic's own admin, which grew all of those first because it had to work standalone.
 *
 * TWO OF THE SAME SURFACE IS WORSE THAN AN AWKWARD ONE. A tenant who changes a setting in the
 * builder and sees no effect on the platform page has not been given a choice, they have been given
 * a coin toss - and the one they picked is the one nobody else reads. The failure is silent in both
 * directions: the value was saved, just not where the product looks.
 *
 * THE CONSTRAINT THAT SHAPES THE WHOLE FILE: SELF-HOST HAS NO SECOND SHELL. Deleting the builder's
 * dashboard, users, AI configuration and account pages would leave a self-hosted install with no
 * way to reach them at all - so this is a MODE-DEPENDENT OWNERSHIP SPLIT, not a deletion. With no
 * hosted platform present every section stays exactly where it is.
 */

/** Every section the builder can route to. Mirrors AdminWorkspace so the two cannot drift apart. */
export type AdminSection =
  | 'dashboard'
  | 'site'
  | 'content'
  | 'data'
  | 'media'
  | 'plugins'
  | 'users'
  | 'ai'
  | 'pluginPage'
  | 'account'

/**
 * Sections the hosted platform owns, so the builder must not offer its own version.
 *
 * Each is here because the platform is the only one that can answer correctly:
 * - dashboard: the platform's dashboards read across every site in the workspace; the builder can
 *   only ever see the one site it has open, so its dashboard answers a narrower question with the
 *   same name.
 * - users: staff identity is Better Auth's, and the builder's own user table cannot grant or revoke
 *   anything the platform recognises.
 * - ai: the model and key decide what a request costs, and the platform holds the credit balance and
 *   the metering. Configuring a key in a surface that cannot see the balance is how somebody selects
 *   a model they cannot afford.
 * - account: the signed-in identity is the platform's, so a password or MFA change made here would
 *   edit a record the platform does not read.
 */
export const PLATFORM_OWNED_SECTIONS: readonly AdminSection[] = Object.freeze([
  'dashboard',
  'users',
  'ai',
  'account',
])

/**
 * What the builder keeps: design, content and the data behind them.
 *
 * media is included because assets are the material design and content are made of, not a separate
 * administrative concern - and the picker that consumes them lives here.
 * plugins and pluginPage are included because a plugin extends THE BUILDER; managing them from a
 * shell that cannot show their canvas modules would separate the switch from the thing it controls.
 */
export const BUILDER_OWNED_SECTIONS: readonly AdminSection[] = Object.freeze([
  'site',
  'content',
  'data',
  'media',
  'plugins',
  'pluginPage',
])

/**
 * Whether the builder should offer a section.
 *
 * `platformPresent` false is self-host, where the answer is always yes.
 */
export function builderOffersSection(
  section: AdminSection,
  platformPresent: boolean,
): boolean {
  if (!platformPresent) return true
  return !PLATFORM_OWNED_SECTIONS.includes(section)
}

/**
 * Where a platform-owned route sends somebody who reaches it inside the builder.
 *
 * HIDING THE NAV LINK IS NOT ENOUGH, and this is the part that is easy to miss: the ROUTE still
 * resolves. A bookmark, a plugin's link or a typed URL opens the builder's own version of a surface
 * the platform owns - and because it looks like the product, whatever is changed there is believed.
 * So a platform-owned section redirects rather than rendering.
 *
 * The target is the platform entry rather than a constructed scoped path, deliberately: the builder
 * does not always hold an organization and workspace, and a path assembled from a partial scope
 * lands on a route that cannot resolve its own context. The entry re-reads the accessible catalog
 * and resolves to the right shell for whoever is asking.
 */
export const PLATFORM_ENTRY_PATH = '/admin'

export function redirectForSection(
  section: AdminSection,
  platformPresent: boolean,
): string | null {
  if (builderOffersSection(section, platformPresent)) return null
  return PLATFORM_ENTRY_PATH
}

export type OwnershipProblem = Readonly<{ code: string; message: string }>

/**
 * Reviews the split for the ways it silently stops holding.
 */
export function reviewOwnership(state: Readonly<{
  /** Sections whose nav link the builder still renders under a hosted platform. */
  navLinksShown: readonly AdminSection[]
  /** Sections whose route still renders the builder's own page under a hosted platform. */
  routesStillRendering: readonly AdminSection[]
}>): readonly OwnershipProblem[] {
  const problems: OwnershipProblem[] = []

  for (const section of state.navLinksShown) {
    if (PLATFORM_OWNED_SECTIONS.includes(section)) {
      problems.push({
        code: 'duplicate-surface-offered',
        message: `The builder offers ${section}, which the platform owns. Two surfaces for one setting means a change can be saved somewhere the product does not read.`,
      })
    }
  }

  for (const section of state.routesStillRendering) {
    if (PLATFORM_OWNED_SECTIONS.includes(section)) {
      // Worse than a visible duplicate: nothing advertises it, so nobody reviews it, and the person
      // who arrives by bookmark has no way to tell it is not the real one.
      problems.push({
        code: 'route-reachable-without-link',
        message: `The ${section} route still renders inside the builder even with its link hidden, so a bookmark opens a duplicate surface that looks like the product.`,
      })
    }
  }

  return Object.freeze(problems)
}

/** Recorded because the reduction is only complete if nothing is left in both places. */
export const REDUCTION = Object.freeze({
  keeps: 'Design, content and the data behind them, plus the media they are made of and the plugins that extend the canvas.',
  moves: 'Dashboard, users, AI configuration and account - each owned by the platform because only the platform can answer them across the whole workspace.',
  selfHost: 'Unchanged. With no platform shell present the builder offers every section, because there is nowhere else for them to be.',
})

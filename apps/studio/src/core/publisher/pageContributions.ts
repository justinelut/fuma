/**
 * What a plugin may contribute to a published page, as declared operations rather than a string.
 *
 * THE FILTER THIS REPLACES. `publish.html` hands a plugin the ENTIRE rendered HTML and takes a
 * replacement string back; the SDK's own example is `html.replace('</body>', ...)`. Three problems,
 * in ascending order of seriousness:
 *
 * 1. A `.replace()` against rendered markup is ORDER-DEPENDENT AND SILENTLY NO-OPS. Change the
 *    markup and the plugin stops working while still reporting as installed - nothing errors, the
 *    contribution simply is not there, and the plugin author cannot tell from the outside.
 *
 * 2. IT RUNS LAST, AFTER THE CSP HAS BEEN DECIDED. publishedHtmlPipeline.ts calls the filter after
 *    injectModuleScripts, which is what relaxes script-src. So a plugin injecting a script the CSP
 *    forbids gets it BLOCKED BY THE BROWSER - installed, silent, and the reason is in a console
 *    nobody is looking at.
 *
 * 3. AND IT CAN EDIT THE CSP ITSELF. rewriteCspMeta(html, mutate) is exported and operates on the
 *    HTML string the plugin was just handed, so a plugin can loosen the whole page's policy and
 *    undo the platform's protection. Nothing checks that today. THAT is the reason this task is
 *    not merely tidying.
 *
 * THE TRANSITION ARGUMENT, which decides the vocabulary. Under the React engine there IS NO HTML
 * STRING to filter - the output is a Next build, and the markup does not exist at the moment a
 * plugin would run. So `.replace()` has nothing to map onto, while "add something to the head" and
 * "add a script before the body ends" map directly onto Next's own metadata export and its Script
 * component. Constraining the vocabulary is therefore what makes plugin contributions survive the
 * engine change at all.
 */

/** Where a contribution may go. Deliberately a closed set. */
export type InjectionSlot =
  /** Inside <head>, for a meta tag, a preconnect, or a stylesheet link. */
  | 'head'
  /** Immediately before </body>, for a script that must not block rendering. */
  | 'body-end'

export type Contribution = Readonly<{
  /** The plugin accountable for this, so a bad contribution names its owner. */
  pluginId: string
  slot: InjectionSlot
  kind: 'meta' | 'link' | 'external-script' | 'inline-script'
  /**
   * For a script, the URL. For meta/link, the fully-formed tag.
   *
   * An INLINE script carries its source here. It is accepted as a kind because analytics vendors
   * genuinely require one, but it is the case the CSP check below is strictest about.
   */
  value: string
}>

/** What the CSP currently permits, read rather than assumed. */
export type CspFacts = Readonly<{
  /** Sources allowed for scripts, as the policy states them. */
  scriptSources: readonly string[]
  /** Whether the policy permits an inline script at all. */
  allowsInlineScript: boolean
}>

export type ContributionProblem = Readonly<{
  pluginId: string
  code: string
  message: string
}>

/**
 * THE RULE THAT MAKES THIS WORTH DOING: a contribution the CSP forbids is REFUSED HERE, with the
 * reason, rather than injected and then blocked by the browser.
 *
 * A browser-blocked script is the worst of both outcomes: the plugin is installed, the page looks
 * fine, the contribution does nothing, and the only evidence is a console message on a visitor's
 * machine. Refusing at publish time puts the problem in front of the person who can fix it.
 */
export function reviewContributions(
  contributions: readonly Contribution[],
  csp: CspFacts,
): readonly ContributionProblem[] {
  const problems: ContributionProblem[] = []

  for (const contribution of contributions) {
    // THE SLOT CHECK RUNS FIRST, and it has to. My first draft put it last, after the
    // external-script branch had already `continue`d - so a script in the head was NEVER flagged.
    // The test caught it. A dead branch in a review is worse than no review, because it reports
    // nothing while looking as though it checked.
    const isScript = contribution.kind === 'external-script' || contribution.kind === 'inline-script'
    if (contribution.slot === 'head' && isScript) {
      // A script in the head blocks rendering; that is a performance decision the plugin should
      // not make on the site owner's behalf.
      problems.push({
        pluginId: contribution.pluginId,
        code: 'script-in-head',
        message: 'A script in the head blocks the page from rendering. Use the body-end slot so the page paints first.',
      })
    }

    if (contribution.kind === 'inline-script' && !csp.allowsInlineScript) {
      problems.push({
        pluginId: contribution.pluginId,
        code: 'inline-script-forbidden',
        message: 'This page\'s content security policy does not permit inline scripts, so the browser would block this one. Ship it as an external script instead.',
      })
      continue
    }

    if (contribution.kind === 'external-script') {
      const origin = originOf(contribution.value)
      if (origin === null) {
        problems.push({
          pluginId: contribution.pluginId,
          code: 'script-url-unreadable',
          message: 'This script URL could not be parsed, so whether the policy permits it cannot be decided. Refused rather than guessed.',
        })
        continue
      }
      if (!permitsOrigin(csp.scriptSources, origin)) {
        problems.push({
          pluginId: contribution.pluginId,
          code: 'script-origin-forbidden',
          message: `The content security policy does not list ${origin}, so the browser would block this script. Add the origin to the policy deliberately, or host the script on this site.`,
        })
      }
      continue
    }
  }

  return Object.freeze(problems)
}

/**
 * A contribution may NEVER carry a policy change, and that is structural rather than advisory.
 *
 * The old filter could call rewriteCspMeta on the string it was handed, so a plugin could loosen
 * the page's own protection with no record. The vocabulary here simply has no operation for it:
 * `kind` is a closed union with no policy member, so the change cannot be expressed. Loosening a
 * policy stays a decision for whoever configures the site.
 */
export function mentionsPolicy(contribution: Contribution): boolean {
  // Defence in depth: a meta tag is fully-formed text, so a plugin could try to smuggle a second
  // CSP meta through the 'meta' kind. Two policies on one page resolve to the INTERSECTION in
  // browsers, so this cannot loosen anything - but it can silently TIGHTEN and break the site's
  // own scripts, which reads as the platform being broken.
  return /http-equiv\s*=\s*["']?content-security-policy/i.test(contribution.value)
}

export function reviewPolicyTampering(
  contributions: readonly Contribution[],
): readonly ContributionProblem[] {
  return Object.freeze(
    contributions.filter(mentionsPolicy).map((contribution) => ({
      pluginId: contribution.pluginId,
      code: 'policy-tampering',
      message: 'A contribution may not carry a content security policy. A second policy on one page intersects with the first, which can silently break the site\'s own scripts.',
    })),
  )
}

/**
 * Renders the accepted contributions as the tags to place in each slot.
 *
 * Returns TAGS PER SLOT rather than a mutated document, so the caller decides where they go. That
 * is what lets the same contributions serve both renderers: the string publisher inserts them at
 * its own markers, and the React engine turns the head slot into metadata entries and the body-end
 * slot into Script components.
 */
export function renderContributions(
  contributions: readonly Contribution[],
): Readonly<Record<InjectionSlot, readonly string[]>> {
  const head: string[] = []
  const bodyEnd: string[] = []

  for (const contribution of contributions) {
    const tag = tagFor(contribution)
    if (tag === null) continue
    if (contribution.slot === 'head') head.push(tag)
    else bodyEnd.push(tag)
  }

  return Object.freeze({ head: Object.freeze(head), 'body-end': Object.freeze(bodyEnd) })
}

function tagFor(contribution: Contribution): string | null {
  switch (contribution.kind) {
    case 'meta':
    case 'link':
      // Already a formed tag; the review above is what decides whether it is acceptable.
      return contribution.value
    case 'external-script':
      // `defer` always: a plugin script is never what the page is for, so it must not delay it.
      return `<script src="${escapeAttribute(contribution.value)}" defer></script>`
    case 'inline-script':
      return `<script>${contribution.value}</script>`
  }
}

/**
 * Escapes an attribute value.
 *
 * Needed because a URL carrying a quote would otherwise close the attribute and let the rest of
 * the value become markup - the classic injection through a field nobody thought of as markup.
 */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    // A relative URL is same-origin by definition, which 'self' covers.
    if (url.startsWith('/')) return 'self'
    return null
  }
}

function permitsOrigin(sources: readonly string[], origin: string): boolean {
  if (sources.includes('*')) return true
  if (origin === 'self') return sources.includes("'self'")
  // An exact origin match, or a wildcard subdomain entry that covers it.
  return sources.some((source) => source === origin || wildcardCovers(source, origin))
}

function wildcardCovers(source: string, origin: string): boolean {
  if (!source.startsWith('https://*.')) return false
  const suffix = source.slice('https://*.'.length)
  // Requires a dot before the suffix so `https://*.example.com` does not match
  // `https://notexample.com` - the mistake that makes a wildcard broader than it reads.
  return origin.startsWith('https://') && origin.endsWith(`.${suffix}`)
}

/** Why the old filter cannot simply be kept, as data for the migration to read. */
export const FILTER_RETIREMENT = Object.freeze({
  filter: 'publish.html',
  reason: 'It returns an arbitrary HTML string, which is order-dependent, silently no-ops when markup changes, runs after the CSP is decided, and can rewrite the CSP itself. Under the React engine there is no HTML string at that point at all.',
  replacement: 'Declared contributions (head / body-end) reviewed against the policy before they are placed.',
})

/**
 * Task 64: the arbitrary publish.html filter constrained to declared contributions.
 *
 * The filter handed a plugin the whole HTML string and took a replacement back. It ran AFTER the
 * CSP was decided and could rewrite the CSP itself.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FILTER_RETIREMENT,
  mentionsPolicy,
  renderContributions,
  reviewContributions,
  reviewPolicyTampering,
  type Contribution,
  type CspFacts,
} from '../../core/publisher/pageContributions'

const STRICT: CspFacts = Object.freeze({
  scriptSources: ["'self'"],
  allowsInlineScript: false,
})

const PERMISSIVE: CspFacts = Object.freeze({
  scriptSources: ["'self'", 'https://cdn.example.test', 'https://*.analytics.test'],
  allowsInlineScript: true,
})

function contribution(overrides: Partial<Contribution> = {}): Contribution {
  return Object.freeze({
    pluginId: 'acme.analytics',
    slot: 'body-end' as const,
    kind: 'external-script' as const,
    value: 'https://cdn.example.test/a.js',
    ...overrides,
  })
}

describe('a contribution the policy forbids is refused HERE, not blocked by the browser', () => {
  it('refuses a script from an origin the policy does not list', () => {
    // Injected and then blocked is the worst outcome: installed, page looks fine, contribution
    // does nothing, and the only evidence is a console message on a visitor's machine.
    const problems = reviewContributions([contribution({ value: 'https://tracker.other.test/t.js' })], STRICT)
    expect(problems.map((p) => p.code)).toContain('script-origin-forbidden')
    expect(problems[0]!.message).toContain('tracker.other.test')
  })

  it('names the accountable plugin', () => {
    const problems = reviewContributions([contribution({ value: 'https://tracker.other.test/t.js' })], STRICT)
    expect(problems[0]!.pluginId).toBe('acme.analytics')
  })

  it('accepts a script the policy lists', () => {
    expect(reviewContributions([contribution()], PERMISSIVE)).toHaveLength(0)
  })

  it('accepts a relative script under self', () => {
    const problems = reviewContributions([contribution({ value: '/plugin/a.js' })], STRICT)
    expect(problems).toHaveLength(0)
  })

  it('refuses an inline script when the policy forbids inline', () => {
    const problems = reviewContributions([contribution({ kind: 'inline-script', value: 'x()' })], STRICT)
    expect(problems.map((p) => p.code)).toContain('inline-script-forbidden')
    expect(problems[0]!.message).toContain('external script instead')
  })

  it('allows an inline script when the policy permits it', () => {
    expect(reviewContributions([contribution({ kind: 'inline-script', value: 'x()' })], PERMISSIVE)).toHaveLength(0)
  })

  it('refuses an unparseable URL rather than guessing', () => {
    // Whether the policy permits it cannot be decided, and guessing would either block something
    // fine or admit something forbidden.
    const problems = reviewContributions([contribution({ value: 'not a url' })], PERMISSIVE)
    expect(problems.map((p) => p.code)).toContain('script-url-unreadable')
  })
})

describe('wildcard sources are matched without becoming broader than they read', () => {
  it('a wildcard subdomain covers a real subdomain', () => {
    const problems = reviewContributions(
      [contribution({ value: 'https://eu.analytics.test/a.js' })],
      PERMISSIVE,
    )
    expect(problems).toHaveLength(0)
  })

  it('but does NOT cover a lookalike host', () => {
    // https://*.analytics.test must not match https://notanalytics.test - the mistake that makes a
    // wildcard admit a domain somebody else can register.
    const problems = reviewContributions(
      [contribution({ value: 'https://notanalytics.test/a.js' })],
      PERMISSIVE,
    )
    expect(problems.map((p) => p.code)).toContain('script-origin-forbidden')
  })

  it('a star source permits anything, which is the policy owner\'s decision', () => {
    const open: CspFacts = { scriptSources: ['*'], allowsInlineScript: false }
    expect(reviewContributions([contribution({ value: 'https://anywhere.test/a.js' })], open)).toHaveLength(0)
  })
})

describe('a plugin cannot change the page policy', () => {
  it('the vocabulary has no operation for it', () => {
    // Structural rather than advisory: `kind` is a closed union with no policy member, so the
    // change cannot be expressed at all.
    const kinds: Contribution['kind'][] = ['meta', 'link', 'external-script', 'inline-script']
    expect(kinds).not.toContain('policy' as never)
  })

  it('and a policy smuggled through a meta tag is caught', () => {
    // Defence in depth - a meta tag is fully-formed text, so somebody could try.
    const sneaky = contribution({
      kind: 'meta',
      slot: 'head',
      value: '<meta http-equiv="Content-Security-Policy" content="script-src *">',
    })
    expect(mentionsPolicy(sneaky)).toBe(true)
    expect(reviewPolicyTampering([sneaky]).map((p) => p.code)).toContain('policy-tampering')
  })

  it('the message explains the real consequence, which is TIGHTENING not loosening', () => {
    // Two policies on one page intersect in browsers, so a second one cannot loosen anything - but
    // it can silently break the site's own scripts, which reads as the platform being broken.
    const sneaky = contribution({ kind: 'meta', slot: 'head', value: '<meta http-equiv="content-security-policy" content="x">' })
    expect(reviewPolicyTampering([sneaky])[0]!.message).toContain('intersects')
  })

  it('an ordinary meta tag is not flagged', () => {
    const ordinary = contribution({ kind: 'meta', slot: 'head', value: '<meta name="theme-color" content="#000">' })
    expect(mentionsPolicy(ordinary)).toBe(false)
    expect(reviewPolicyTampering([ordinary])).toHaveLength(0)
  })
})

describe('a script never blocks rendering', () => {
  it('refuses a script in the head', () => {
    // A performance decision the plugin should not make on the site owner's behalf.
    const problems = reviewContributions([contribution({ slot: 'head' })], PERMISSIVE)
    expect(problems.map((p) => p.code)).toContain('script-in-head')
  })

  it('a meta or link in the head is fine', () => {
    const problems = reviewContributions(
      [contribution({ slot: 'head', kind: 'meta', value: '<meta name="a" content="b">' })],
      PERMISSIVE,
    )
    expect(problems).toHaveLength(0)
  })

  it('every rendered external script carries defer', () => {
    const rendered = renderContributions([contribution()])
    expect(rendered['body-end'][0]).toContain(' defer>')
  })
})

describe('rendering returns tags per slot, not a mutated document', () => {
  it('separates head from body-end', () => {
    const rendered = renderContributions([
      contribution({ slot: 'head', kind: 'meta', value: '<meta name="a" content="b">' }),
      contribution({ slot: 'body-end' }),
    ])
    expect(rendered.head).toHaveLength(1)
    expect(rendered['body-end']).toHaveLength(1)
  })

  it('which is what lets the same contributions serve both renderers', () => {
    // The string publisher inserts at its own markers; the React engine turns head into metadata
    // and body-end into Script components. A mutated document would serve only the first.
    const rendered = renderContributions([contribution()])
    expect(Object.keys(rendered).sort()).toEqual(['body-end', 'head'])
  })

  it('escapes a quote in a script URL so it cannot close the attribute', () => {
    // A URL carrying a quote would otherwise let the rest of the value become markup - injection
    // through a field nobody thinks of as markup.
    const rendered = renderContributions([contribution({ value: 'https://x.test/a.js"><script>bad()</script>' })])
    expect(rendered['body-end'][0]).not.toContain('"><script>bad()')
    expect(rendered['body-end'][0]).toContain('&quot;')
  })

  it('an empty contribution list renders nothing rather than empty tags', () => {
    const rendered = renderContributions([])
    expect(rendered.head).toHaveLength(0)
    expect(rendered['body-end']).toHaveLength(0)
  })
})

describe('the retirement is recorded with its reasons', () => {
  it('names the filter and why a string return cannot be kept', () => {
    expect(FILTER_RETIREMENT.filter).toBe('publish.html')
    expect(FILTER_RETIREMENT.reason).toContain('after the CSP is decided')
    expect(FILTER_RETIREMENT.reason).toContain('rewrite the CSP')
  })

  it('states the replacement so a plugin author has somewhere to go', () => {
    expect(FILTER_RETIREMENT.replacement).toContain('reviewed against the policy')
  })
})

describe('the defects described are real, asserted against the shipped code', () => {
  const STUDIO = join(import.meta.dir, '..', '..', '..')

  it('the filter really does run AFTER the module scripts and CSP relaxation', () => {
    // This ordering is the reason a forbidden script is browser-blocked rather than refused.
    const pipeline = readFileSync(join(STUDIO, 'server/publish/publishedHtmlPipeline.ts'), 'utf8')
    const relax = pipeline.indexOf('injectModuleScripts')
    const filter = pipeline.indexOf("applyFilter('publish.html'")
    expect(relax).toBeGreaterThan(-1)
    expect(filter).toBeGreaterThan(relax)
  })

  it('rewriteCspMeta really does operate on an HTML string', () => {
    // Which is what a plugin holding the whole document could reach for.
    const csp = readFileSync(join(STUDIO, 'src/core/publisher/cspPlan.ts'), 'utf8')
    expect(csp).toContain('export function rewriteCspMeta(html: string')
  })

  it('the SDK really does document arbitrary string replacement', () => {
    const hooks = readFileSync(join(STUDIO, 'src/core/plugin-sdk/types/hooks.ts'), 'utf8')
    expect(hooks).toContain("'publish.html': string")
    expect(hooks).toContain('html.replace(')
  })
})

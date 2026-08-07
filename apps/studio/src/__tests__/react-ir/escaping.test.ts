/**
 * Task 62: escaping rebuilt for React.
 *
 * The old contract escaped every string prop before render(). Under React that is the DEFECT: React
 * escapes text itself, so a pre-escaped value renders its entities visibly. But URL-scheme
 * validation and raw-markup sanitisation still matter, because React does neither.
 */
import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import {
  ESCAPING_CONTRACTS,
  REFUSED_URL,
  looksPreEscaped,
  needsSanitiser,
  prepareProp,
  reviewProps,
} from '../../core/react-ir/escaping'

describe('REACT REALLY DOES ESCAPE, proven rather than assumed', () => {
  it('escapes a text child, so escaping beforehand is a second escape', () => {
    // The whole model rests on this. Verified against the real renderer rather than taken on faith.
    const html = renderToStaticMarkup(createElement('h1', null, 'Ben & Jerry'))
    expect(html).toBe('<h1>Ben &amp; Jerry</h1>')
  })

  it('a PRE-ESCAPED value renders the entities visibly', () => {
    // This is the defect the old contract would cause: the visitor reads "Ben &amp; Jerry".
    const html = renderToStaticMarkup(createElement('h1', null, 'Ben &amp; Jerry'))
    expect(html).toBe('<h1>Ben &amp;amp; Jerry</h1>')
  })

  it('escapes an attribute value too', () => {
    const html = renderToStaticMarkup(createElement('div', { title: 'a "quoted" thing' }))
    expect(html).toContain('&quot;')
  })

  it('DOES block javascript:, correcting my first assumption', () => {
    // I claimed React does not check schemes at all. This test proved that FALSE - React 19
    // substitutes a throwing URL - and the module's comments were corrected to match.
    const html = renderToStaticMarkup(createElement('a', { href: 'javascript:alert(1)' }, 'x'))
    expect(html).toContain('React has blocked')
  })

  it('blocks obfuscated javascript: too, which is genuinely thorough', () => {
    for (const href of ['JavaScript:alert(1)', 'java\tscript:alert(1)']) {
      expect(renderToStaticMarkup(createElement('a', { href }, 'x'))).toContain('React has blocked')
    }
  })

  it('but ALLOWS vbscript: and data: URLs, which is the gap our check exists to cover', () => {
    // Measured, not assumed. These three render through unchanged, and a data:text/html URL is a
    // real script-execution vector. So the scheme check is still required - for a narrower and
    // more precise reason than "React does nothing".
    for (const href of [
      'vbscript:msgbox(1)',
      'data:text/html,<script>alert(1)</script>',
      'data:image/svg+xml,<svg onload=alert(1)>',
    ]) {
      const html = renderToStaticMarkup(createElement('a', { href }, 'x'))
      expect(html).not.toContain('React has blocked')
    }
  })
})

describe('text is passed through unchanged', () => {
  it('returns the value exactly', () => {
    const prepared = prepareProp('Ben & Jerry', 'text')
    expect(prepared.value).toBe('Ben & Jerry')
    expect(prepared.treatment).toBe('passed-through')
  })

  it('does not escape a quote, an angle bracket or an apostrophe', () => {
    // Every one of these would render as an entity if escaped here.
    for (const raw of ['"quoted"', '5 < 6', "it's", 'a & b']) {
      expect(prepareProp(raw, 'text').value).toBe(raw)
    }
  })

  it('round-trips through React to the original text', () => {
    // End to end: prepare -> render -> the visitor sees what the author typed.
    const prepared = prepareProp("Bob's Bikes & Co", 'text')
    const html = renderToStaticMarkup(createElement('p', null, prepared.value))
    expect(html).toBe("<p>Bob&#x27;s Bikes &amp; Co</p>")
    // And the entity count is ONE level, not two.
    expect(html).not.toContain('&amp;amp;')
  })
})

describe('URL props are still validated, because React does not', () => {
  it('passes a safe URL through unescaped', () => {
    const prepared = prepareProp('https://example.test/a?b=1&c=2', 'url')
    expect(prepared.treatment).toBe('url-validated')
    // NOT escaped: escaping here would put &amp; in the query string and change the address.
    expect(prepared.value).toBe('https://example.test/a?b=1&c=2')
  })

  it('refuses an executable scheme and says why', () => {
    const prepared = prepareProp('javascript:alert(1)', 'url')
    expect(prepared.value).toBe(REFUSED_URL)
    expect(prepared.treatment).toBe('url-refused')
    expect(prepared.note).toContain('execute code')
  })

  it('the refusal renders as a link that goes nowhere rather than one that runs code', () => {
    const prepared = prepareProp('javascript:alert(1)', 'url')
    const html = renderToStaticMarkup(createElement('a', { href: prepared.value }, 'x'))
    expect(html).not.toContain('javascript')
    // And nothing reaches React's own guard, so the refusal does not depend on the React version.
    expect(html).not.toContain('React has blocked')
  })

  it('refuses the schemes React lets through', () => {
    // This is the check's real value, established by measuring React rather than assuming.
    for (const href of ['vbscript:msgbox(1)', 'data:text/html,<script>alert(1)</script>']) {
      expect(prepareProp(href, 'url').treatment).toBe('url-refused')
    }
  })

  it('a relative URL is allowed', () => {
    expect(prepareProp('/about', 'url').treatment).toBe('url-validated')
  })
})

describe('raw-markup sinks report that a sanitiser is required', () => {
  it('rich text is not silently passed as safe', () => {
    // Returning it unchanged with no signal is how raw markup reaches innerHTML while looking as
    // though it went through a safety layer.
    const prepared = prepareProp('<p>hello</p>', 'html')
    expect(needsSanitiser(prepared)).toBe(true)
    expect(prepared.note).toContain('dangerouslySetInnerHTML')
  })

  it('SVG reports an SVG-specific requirement', () => {
    const prepared = prepareProp('<svg><use href="#x"/></svg>', 'svg')
    expect(needsSanitiser(prepared)).toBe(true)
    expect(prepared.note).toContain('SVG profile')
  })

  it('text and url never report needing a sanitiser', () => {
    expect(needsSanitiser(prepareProp('hi', 'text'))).toBe(false)
    expect(needsSanitiser(prepareProp('/a', 'url'))).toBe(false)
  })
})

describe('pre-escaped detection reports rather than reverses', () => {
  it('recognises the five entities escapeHtml produces', () => {
    for (const escaped of ['&amp;', '&lt;', '&gt;', '&quot;', '&#39;']) {
      expect(looksPreEscaped(`a ${escaped} b`)).toBe(true)
    }
  })

  it('a bare ampersand is ordinary text, not a suspicion', () => {
    // Only the entity form is suspicious; flagging every '&' would flag most real copy.
    expect(looksPreEscaped('Ben & Jerry')).toBe(false)
  })

  it('does NOT unescape, because reversing it is not safely decidable', () => {
    // A value legitimately containing the literal "&amp;" - documentation about escaping, a code
    // sample - is indistinguishable from one escaped once. Unescaping would corrupt it silently.
    const prepared = prepareProp('Write &amp; to mean an ampersand', 'text')
    expect(prepared.value).toBe('Write &amp; to mean an ampersand')
    expect(prepared.treatment).toBe('passed-through')
  })
})

describe('the review names what each problem looks like at runtime', () => {
  it('flags double-escaped text with the visible symptom', () => {
    const problems = reviewProps({ title: 'Ben &amp; Jerry' }, { title: 'text' })
    expect(problems.map((p) => p.code)).toContain('double-escaped-text')
    expect(problems[0]!.message).toContain('renders the entities visibly')
  })

  it('flags an executable URL', () => {
    const problems = reviewProps({ href: 'javascript:alert(1)' }, { href: 'url' })
    expect(problems.map((p) => p.code)).toContain('executable-url')
  })

  it('flags EVERY raw-markup prop, not only suspicious ones', () => {
    // The sink itself bypasses React's escaping, so the requirement holds regardless of the
    // current value.
    const problems = reviewProps({ body: '<p>perfectly ordinary</p>' }, { body: 'html' })
    expect(problems.map((p) => p.code)).toContain('unsanitised-raw-markup')
  })

  it('reports NOTHING for clean props', () => {
    // A review that flags correct input gets switched off.
    const problems = reviewProps(
      { title: 'Ben & Jerry', href: 'https://example.test' },
      { title: 'text', href: 'url' },
    )
    expect(problems).toHaveLength(0)
  })

  it('treats an undeclared prop as text, the commonest sink', () => {
    // Defaulting to a raw-markup sink would flood the report; defaulting to url would refuse
    // ordinary copy. Text is both the commonest and the one React already protects.
    expect(reviewProps({ anything: 'plain copy' }, {})).toHaveLength(0)
  })

  it('reports every problem rather than stopping at the first', () => {
    const problems = reviewProps(
      { a: 'x &amp; y', b: 'javascript:alert(1)' },
      { a: 'text', b: 'url' },
    )
    expect(problems).toHaveLength(2)
  })
})

describe('the two contracts are recorded as opposites', () => {
  it('states the string publisher rule and the React rule', () => {
    // Copying the string publisher's discipline into a React component is the exact mistake this
    // module exists to prevent, so both rules are written down in one place.
    expect(ESCAPING_CONTRACTS.stringPublisher).toContain('escape')
    expect(ESCAPING_CONTRACTS.reactEngine).toContain('React escapes text')
    expect(ESCAPING_CONTRACTS.reactEngine).toContain('unchanged')
  })

  it('the old contract is still documented where it applies', () => {
    // The string publisher is still shipping and its rule is still right for it - this is not a
    // correction of that file, it is a different rule for a different renderer.
    const utils = require('node:fs').readFileSync(
      require('node:path').join(import.meta.dir, '..', '..', 'core', 'publisher', 'utils.ts'),
      'utf8',
    ) as string
    expect(utils).toContain('double-escaping')
  })
})

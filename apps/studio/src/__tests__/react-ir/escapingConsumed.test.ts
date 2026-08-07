/**
 * Proves task 62's escaping model is CONSUMED by the generator rather than only modelled.
 *
 * The model was built and tested and `generate.ts` never called it, so a URL-bearing attribute was
 * emitted verbatim into a tenant's source file. That matters because of what was MEASURED in task 62:
 * React 19 blocks `javascript:` itself, but `vbscript:` and every `data:` URL render through
 * unchanged - and `data:text/html,<script>` is a real execution vector. The generator is the last
 * place a refusal can happen, because after it the string is in a file we shipped.
 */
import { describe, expect, it } from 'bun:test'
import { generateModule } from '@core/react-ir/generate'
import { REFUSED_URL } from '@core/react-ir/escaping'
import { REACT_IR_VERSION, type ReactIrModule } from '@core/react-ir/nodes'

function moduleWithAttribute(tag: string, name: string, value: string): ReactIrModule {
  return {
    version: REACT_IR_VERSION,
    id: 'mod-1',
    kind: 'page',
    path: 'app/page.tsx',
    symbol: 'Page',
    rootNodeId: 'root',
    propsInterface: [],
    boundary: 'server',
    nodes: {
      root: { kind: 'element', id: 'root', tag: 'main', attributes: {}, children: ['target'] },
      target: {
        kind: 'element',
        id: 'target',
        tag,
        attributes: { [name]: { kind: 'expression', expression: { kind: 'literal', value } } },
        children: [],
      },
    },
  } as ReactIrModule
}

describe('the generator refuses an executable URL', () => {
  it('refuses vbscript:, which React does NOT block', () => {
    const code = generateModule(moduleWithAttribute('a', 'href', 'vbscript:msgbox(1)')).code
    expect(code).not.toContain('vbscript')
    expect(code).toContain(`href="${REFUSED_URL}"`)
  })

  it('refuses data:text/html, which is a real script-execution vector', () => {
    const code = generateModule(
      moduleWithAttribute('a', 'href', 'data:text/html,<script>alert(1)</script>')).code
    expect(code).not.toContain('data:text/html')
    expect(code).toContain(`href="${REFUSED_URL}"`)
  })

  it('refuses javascript: too, so the refusal does not depend on the React version installed', () => {
    const code = generateModule(moduleWithAttribute('a', 'href', 'javascript:alert(1)')).code
    expect(code).not.toContain('javascript:')
  })

  it('refuses an obfuscated scheme, because the check strips whitespace first', () => {
    // `java\tscript:` is how a naive prefix comparison gets bypassed.
    const code = generateModule(moduleWithAttribute('a', 'href', 'java\tscript:alert(1)')).code
    expect(code).toContain(`href="${REFUSED_URL}"`)
  })

  it('covers src as well as href, since both are resolved as URLs', () => {
    const code = generateModule(
      moduleWithAttribute('iframe', 'src', 'data:text/html,<script>alert(1)</script>')).code
    expect(code).toContain(`src="${REFUSED_URL}"`)
  })
})

describe('ordinary values are untouched, so the check does not damage working markup', () => {
  it('leaves an https URL exactly as written, query string included', () => {
    const url = 'https://example.com/a?x=1&y=2'
    const code = generateModule(moduleWithAttribute('a', 'href', url)).code
    // NOT escaped: putting &amp; inside a query string changes the address the link points at.
    expect(code).toContain(`href="${url}"`)
  })

  it('leaves a relative path and a fragment alone', () => {
    expect(generateModule(moduleWithAttribute('a', 'href', '/about')).code).toContain('href="/about"')
    expect(generateModule(moduleWithAttribute('a', 'href', '#top')).code).toContain('href="#top"')
  })

  it('refuses EVERY data: URL, including data:image, and that is the right rule', () => {
    // An image allowlist looks reasonable and is not safe: data:image/svg+xml can carry
    // `<svg onload=alert(1)>`, and task 62 MEASURED that React renders exactly that through
    // unchanged. So the shipped isSafeUrl blocks the whole scheme rather than allow-listing a
    // media type whose payload is executable. Inline media belongs in a real asset.
    const code = generateModule(
      moduleWithAttribute('img', 'src', 'data:image/svg+xml,%3Csvg%2F%3E')).code
    expect(code).toContain(`src="${REFUSED_URL}"`)
  })

  it('does NOT rewrite an attribute that merely looks URL-ish', () => {
    // A closed set rather than a heuristic: `data-src` is read as ordinary text by whatever
    // component owns it, and rewriting it to '#' would break working markup.
    const code = generateModule(
      moduleWithAttribute('div', 'data-src', 'vbscript:not-a-url-here')).code
    expect(code).toContain('vbscript:not-a-url-here')
  })

  it('does NOT escape ordinary text, which is the whole point of task 62', () => {
    // React escapes text when it renders it; doing it here too is what puts &amp; on the page.
    const module = moduleWithAttribute('a', 'href', '/x')
    const withText = {
      ...module,
      nodes: {
        ...module.nodes,
        root: { kind: 'element', id: 'root', tag: 'main', attributes: {}, children: ['t'] },
        t: { kind: 'text', id: 't', value: 'Ben & Jerry', children: [] },
      },
    } as ReactIrModule
    const code = generateModule(withText).code
    expect(code).toContain('Ben & Jerry')
    expect(code).not.toContain('&amp;')
  })
})

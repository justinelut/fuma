/**
 * TASK 65 — end-to-end acceptance with MEASURED parity.
 *
 * The measurement is not a screenshot or a byte diff. A byte comparison fails on formatting nobody can
 * see; a screenshot needs a browser and reports that something changed without saying what. So this
 * measures whether the React engine produces the SAME SEMANTIC PAGE as the markup it was given:
 *
 *   real page markup -> importHtmlToReactIr -> renderModuleForCanvas -> renderToStaticMarkup -> compare
 *
 * Every step is shipped code. Nothing here is a stand-in, which is what makes the result acceptance
 * rather than a demonstration.
 */
import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { importHtmlToReactIr } from '@core/react-ir/htmlToIr'
import { renderModuleForCanvas } from '@site/canvas/reactIrRenderer'
import { semanticEntries, compareSemantics, type ParityReport } from '@core/react-ir/parity'
import { REACT_IR_VERSION, type ReactIrModule } from '@core/react-ir/nodes'

/** happy-dom supplies DOMParser in this environment; the comparator takes it as a seam. */
const parse = (source: string): Document =>
  new DOMParser().parseFromString(`<html><body>${source}</body></html>`, 'text/html')

/** The full path under measurement. Returns the report AND the rendered markup for diagnosis. */
function measureParity(html: string): { report: ParityReport; rendered: string } {
  // The importer returns { nodes, rootIds, notes } rather than a module, so the module is assembled
  // here. Every fixture below has a SINGLE root element on purpose: wrapping several roots in a
  // synthetic element would add an element the source never had and the comparison would report a
  // difference this harness invented.
  const imported = importHtmlToReactIr(html)
  expect(imported.rootIds.length, JSON.stringify(imported.rootIds)).toBe(1)
  const module = {
    version: REACT_IR_VERSION,
    id: 'parity',
    kind: 'page',
    path: 'app/page.tsx',
    symbol: 'Page',
    rootNodeId: imported.rootIds[0]!,
    propsInterface: [],
    boundary: 'server',
    nodes: imported.nodes,
  } as ReactIrModule
  const element = renderModuleForCanvas({ module })
  const rendered = element === null ? '' : renderToStaticMarkup(element)
  const report = compareSemantics(semanticEntries(html, parse), semanticEntries(rendered, parse))
  return { report, rendered }
}

/** A page using the constructs a real marketing page is built from. */
const REAL_PAGE = `
<section class="mx-auto max-w-3xl px-6 py-16">
  <h1 class="text-4xl font-semibold">Own your site</h1>
  <p class="mt-3 text-muted-foreground">A CMS where the editor and publisher live in one server.</p>
  <a class="mt-6 inline-flex" href="/pricing" rel="noopener">See pricing</a>
  <img src="/hero.png" alt="The editor in use" width="1200" height="600">
  <ul class="mt-6">
    <li>Semantic HTML</li>
    <li>Compact CSS</li>
  </ul>
</section>
`

describe('measured parity on a real page', () => {
  it('renders the SAME semantic page as the markup it was given', () => {
    const { report, rendered } = measureParity(REAL_PAGE)
    // The report names each difference, so a failure states what changed rather than that something did.
    expect(report.identical, JSON.stringify(report.differences, null, 2)).toBe(true)
    // Guard: a comparison of nothing is not parity. This asserts the measurement examined real content.
    expect(report.compared).toBeGreaterThan(10)
    expect(rendered.length).toBeGreaterThan(100)
  })

  it('preserves the attributes that change what a page MEANS', () => {
    const { rendered } = measureParity(REAL_PAGE)
    // Each of these is a documented failure class: a lost href is a dead link, a lost alt is an
    // inaccessible image, lost intrinsic dimensions reintroduce layout shift.
    expect(rendered).toContain('href="/pricing"')
    expect(rendered).toContain('alt="The editor in use"')
    expect(rendered).toContain('src="/hero.png"')
    expect(rendered).toContain('rel="noopener"')
    expect(rendered).toContain('width="1200"')
  })

  it('preserves the text a visitor reads, in order', () => {
    const { rendered } = measureParity(REAL_PAGE)
    const own = rendered.indexOf('Own your site')
    const pricing = rendered.indexOf('See pricing')
    expect(own).toBeGreaterThan(-1)
    expect(pricing).toBeGreaterThan(own)
    expect(rendered).toContain('Semantic HTML')
  })
})

describe('a label keeps labelling its input, which is the regression nobody sees', () => {
  it('carries `for` through as htmlFor and renders it back as for', () => {
    // Passing `for` through to React silently does nothing: the label renders looking correct and NO
    // LONGER LABELS ITS INPUT. Invisible on screen, and only a comparison catches it.
    const { report, rendered } = measureParity(
      '<form><label for="email">Email</label><input id="email" type="email" required></form>',
    )
    expect(report.identical, JSON.stringify(report.differences)).toBe(true)
    expect(rendered).toContain('for="email"')
    expect(rendered).toContain('type="email"')
  })
})

describe('a table keeps its structure', () => {
  it('preserves colspan and scope, which are numeric and easy to lose', () => {
    const { report } = measureParity(
      '<table><thead><tr><th scope="col" colspan="2">Plan</th></tr></thead>'
      + '<tbody><tr><td>Starter</td><td>Free</td></tr></tbody></table>',
    )
    expect(report.identical, JSON.stringify(report.differences)).toBe(true)
  })
})

describe('the measurement can FAIL, so a pass means something', () => {
  it('reports a missing element', () => {
    const expected = semanticEntries('<p>one</p><p>two</p>', parse)
    const actual = semanticEntries('<p>one</p>', parse)
    const report = compareSemantics(expected, actual)
    expect(report.identical).toBe(false)
    expect(report.differences.some((difference) => difference.kind === 'missing')).toBe(true)
  })

  it('reports a changed tag', () => {
    const report = compareSemantics(
      semanticEntries('<h1>Title</h1>', parse),
      semanticEntries('<div>Title</div>', parse),
    )
    expect(report.differences.some((difference) => difference.kind === 'tag')).toBe(true)
  })

  it('reports a lost meaningful attribute', () => {
    const report = compareSemantics(
      semanticEntries('<a href="/x">go</a>', parse),
      semanticEntries('<a>go</a>', parse),
    )
    expect(report.differences.some((difference) => difference.detail.includes('href'))).toBe(true)
  })

  it('reports changed text', () => {
    const report = compareSemantics(
      semanticEntries('<p>before</p>', parse),
      semanticEntries('<p>after</p>', parse),
    )
    expect(report.differences.some((difference) => difference.kind === 'text')).toBe(true)
  })

  it('reports EVERY difference rather than stopping at the first', () => {
    const report = compareSemantics(
      semanticEntries('<a href="/x">one</a><p>two</p>', parse),
      semanticEntries('<a>changed</a>', parse),
    )
    expect(report.differences.length).toBeGreaterThan(2)
  })
})

describe('what parity deliberately does NOT compare', () => {
  it('ignores formatting, so indentation is not a difference', () => {
    const report = compareSemantics(
      semanticEntries('<section>\n  <p>text</p>\n</section>', parse),
      semanticEntries('<section><p>text</p></section>', parse),
    )
    // Reporting whitespace would bury a real difference under noise nobody can act on.
    expect(report.identical).toBe(true)
  })

  it('ignores class ORDER, because the engine merges tokens conflict-aware', () => {
    const report = compareSemantics(
      semanticEntries('<p class="mt-3 text-sm">x</p>', parse),
      semanticEntries('<p class="text-sm mt-3">x</p>', parse),
    )
    expect(report.identical).toBe(true)
  })

  it('still reports a class that was LOST', () => {
    // Ignoring order must not become ignoring content.
    const report = compareSemantics(
      semanticEntries('<p class="mt-3 text-sm">x</p>', parse),
      semanticEntries('<p class="mt-3">x</p>', parse),
    )
    expect(report.identical).toBe(false)
  })

  it('ignores the canvas selection attribute, which appears in no published page', () => {
    // data-node-id is added by the canvas renderer for selection. Comparing it would report a
    // difference on every element and the gate would be useless on its first run.
    const report = compareSemantics(
      semanticEntries('<p>x</p>', parse),
      semanticEntries('<p data-node-id="n1">x</p>', parse),
    )
    expect(report.identical).toBe(true)
  })
})

describe('React\'s injected resource hints are excluded, and only those', () => {
  it('ignores the preload link React 19 emits for an img', () => {
    // MEASURED: renderToStaticMarkup emits <link rel="preload" as="image"> ahead of the tree for an
    // <img src>. Comparing it would report a difference on every page containing an image, and this
    // gate would have failed on its first real input.
    const report = compareSemantics(
      semanticEntries('<img src="/h.png" alt="x">', parse),
      semanticEntries('<link rel="preload" as="image" href="/h.png"/><img src="/h.png" alt="x">', parse),
    )
    expect(report.identical).toBe(true)
  })

  it('still compares a stylesheet link an AUTHOR wrote', () => {
    // The exclusion must not widen into ignoring links: losing a stylesheet changes what the page
    // looks like.
    const report = compareSemantics(
      semanticEntries('<link rel="stylesheet" href="/site.css"/><p>x</p>', parse),
      semanticEntries('<p>x</p>', parse),
    )
    expect(report.identical).toBe(false)
  })
})

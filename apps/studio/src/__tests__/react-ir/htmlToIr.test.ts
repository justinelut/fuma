/**
 * Pasted HTML becomes React IR.
 *
 * The assertions concentrate on differences between HTML and JSX that a browser tolerates
 * and React does not: attribute names, boolean values, numeric values, void elements. Every
 * one of those fails quietly — a `for` that no longer labels its input, a `disabled` that
 * renders enabled, a `tabIndex` string that fails the tenant's typecheck.
 */

import { describe, it, expect } from 'bun:test'
import {
  documentToReactIr,
  importHtmlToReactIr,
  isVoidElement,
  jsxAttributeName,
  parseInlineStyle,
} from '@core/react-ir/htmlToIr'
import { parseHtml } from '@core/htmlImport/parseHtml'
import { generateModule } from '@core/react-ir/generate'
import { readModuleSource } from '@core/react-ir/read'
import type { ReactIrModule } from '@core/react-ir/nodes'

/**
 * Convert through the shipped entry point.
 *
 * Not via `stripUnsafe`: that helper deletes the `style` attribute without counting it, so a
 * paste would lose inline styling with nothing reporting the loss. The entry point removes
 * scripts, handlers and executable URLs itself.
 */
function convert(html: string) {
  return importHtmlToReactIr(html, { idPrefix: 'p' })
}

/** Attribute value of a node, unwrapped from its literal expression. */
function attribute(node: unknown, name: string): unknown {
  const attributes = (node as { attributes?: Record<string, { expression?: { value?: unknown } }> })
    .attributes
  return attributes?.[name]?.expression?.value
}

const nodeAt = (result: ReturnType<typeof convert>, id: string) => result.nodes[id]

describe('structure', () => {
  it('converts an element to an element node', () => {
    const result = convert('<div class="p-4">Hi</div>')
    expect((nodeAt(result, 'p-1') as { kind?: string }).kind).toBe('element')
    expect((nodeAt(result, 'p-1') as { tag?: string }).tag).toBe('div')
  })

  it('splits the class attribute into tokens', () => {
    const result = convert('<div class="grid  gap-4 p-8">x</div>')
    expect((nodeAt(result, 'p-1') as { classTokens?: string[] }).classTokens)
      .toEqual(['grid', 'gap-4', 'p-8'])
  })

  it('converts text to a text node', () => {
    const result = convert('<p>Hello</p>')
    const child = (nodeAt(result, 'p-1') as { children: string[] }).children[0]
    expect((nodeAt(result, child ?? '') as { value?: string }).value).toBe('Hello')
  })

  it('collapses whitespace the way a browser would', () => {
    // Preserving it verbatim would put the source file's indentation into rendered text.
    const result = convert('<p>Hello\n     there</p>')
    const child = (nodeAt(result, 'p-1') as { children: string[] }).children[0]
    expect((nodeAt(result, child ?? '') as { value?: string }).value).toBe('Hello there')
  })

  it('drops whitespace-only text between elements', () => {
    // In JSX that is a stray text node rather than layout.
    const result = convert('<div>\n  <span>a</span>\n  <span>b</span>\n</div>')
    expect((nodeAt(result, 'p-1') as { children: string[] }).children).toHaveLength(2)
  })

  it('reports document-order roots', () => {
    const result = convert('<h1>a</h1><p>b</p>')
    expect(result.rootIds).toEqual(['p-1', 'p-3'])
  })

  it('nests deeply without losing anything', () => {
    const result = convert('<div><section><article><p>deep</p></article></section></div>')
    expect(Object.keys(result.nodes)).toHaveLength(5)
  })
})

describe('attribute names differ in JSX', () => {
  it('renames class to className via the class path', () => {
    expect(jsxAttributeName('class')).toBe('className')
  })

  it('renames for to htmlFor', () => {
    // A pasted label that keeps `for` renders looking correct and labels nothing.
    const result = convert('<label for="email">Email</label>')
    expect(attribute(nodeAt(result, 'p-1'), 'htmlFor')).toBe('email')
    expect(attribute(nodeAt(result, 'p-1'), 'for')).toBeUndefined()
  })

  it('renames tabindex, colspan and readonly', () => {
    expect(jsxAttributeName('tabindex')).toBe('tabIndex')
    expect(jsxAttributeName('colspan')).toBe('colSpan')
    expect(jsxAttributeName('readonly')).toBe('readOnly')
  })

  it('reports every rename, because the HTML spelling would have done nothing', () => {
    const result = convert('<label for="a">x</label>')
    expect(result.notes.some((note) => note.code === 'attribute-renamed')).toBe(true)
  })

  it('passes through what React accepts verbatim', () => {
    const result = convert('<a href="/x" id="y" data-test="z" aria-label="w">go</a>')
    for (const [name, value] of [['href', '/x'], ['id', 'y'], ['data-test', 'z'], ['aria-label', 'w']]) {
      expect(attribute(nodeAt(result, 'p-1'), name ?? '')).toBe(value)
    }
  })
})

describe('boolean attributes', () => {
  it('becomes true rather than the empty string', () => {
    // The DOM reports `disabled=""`, which React reads as falsy — the control would render
    // enabled, the opposite of the markup.
    const result = convert('<input disabled required>')
    expect(attribute(nodeAt(result, 'p-1'), 'disabled')).toBe(true)
    expect(attribute(nodeAt(result, 'p-1'), 'required')).toBe(true)
  })

  it('handles a renamed boolean', () => {
    const result = convert('<input readonly>')
    expect(attribute(nodeAt(result, 'p-1'), 'readOnly')).toBe(true)
  })
})

describe('numeric attributes', () => {
  it('coerces a numeric attribute to a number', () => {
    // React types tabIndex as number, so the string is a compile error in the tenant's site.
    const result = convert('<a href="/x" tabindex="0">go</a>')
    expect(attribute(nodeAt(result, 'p-1'), 'tabIndex')).toBe(0)
  })

  it('coerces colspan', () => {
    const result = convert('<table><tr><td colspan="2">c</td></tr></table>')
    const cell = Object.values(result.nodes).find((node) => (node as { tag?: string }).tag === 'td')
    expect(attribute(cell, 'colSpan')).toBe(2)
  })

  it('keeps a non-numeric value as written and reports it', () => {
    // height="100%" is legal HTML; storing NaN would be worse than a value the compiler can
    // object to. On an img the dimension is meaningful, so it is not treated as presentational.
    const result = convert('<img src="/a.png" alt="" height="100%">')
    expect(attribute(nodeAt(result, 'p-1'), 'height')).toBe('100%')
    expect(result.notes.some((note) => note.message.includes('not one'))).toBe(true)
  })
})

describe('void elements', () => {
  it('knows which tags are void', () => {
    expect(isVoidElement('img')).toBe(true)
    expect(isVoidElement('BR')).toBe(true)
    expect(isVoidElement('div')).toBe(false)
  })

  it('gives a void element no children', () => {
    // React throws rather than warns for a void element with children.
    const result = convert('<img src="/a.png" alt="">')
    expect((nodeAt(result, 'p-1') as { children: string[] }).children).toEqual([])
  })
})

describe('what cannot be carried across', () => {
  it('discards script elements', () => {
    // Discarded by the converter itself, so the entry point is safe without a separate pass.
    const result = convert('<div><script>alert(1)</script><p>keep</p></div>')
    const tags = Object.values(result.nodes).map((node) => (node as { tag?: string }).tag)
    expect(tags).not.toContain('script')
  })

  it('drops an event handler rather than pretending to keep behaviour', () => {
    // Reached only if stripUnsafe missed one; the IR has no way to express pasted behaviour.
    const doc = parseHtml('<button onclick="alert(1)">x</button>')
    const result = documentToReactIr(doc, { idPrefix: 'p' })
    expect(attribute(nodeAt(result, 'p-1'), 'onclick')).toBeUndefined()
    expect(result.notes.some((note) => note.code === 'attribute-dropped')).toBe(true)
  })

  it('reports a presentational attribute rather than keeping it', () => {
    // bgcolor works in a browser and is invisible to the theme, so a token change would move
    // the whole page except this element. Wrapped in a table because the parser discards a
    // bare <td>.
    const result = convert('<table><tr><td bgcolor="#eee">c</td></tr></table>')
    const cell = Object.values(result.nodes).find((node) => (node as { tag?: string }).tag === 'td')
    expect(attribute(cell, 'bgcolor')).toBeUndefined()
    expect(result.notes.some((note) => note.code === 'presentational-attribute')).toBe(true)
  })

  it('keeps width and height on an image, where they prevent layout shift', () => {
    // The same attribute name judged by the element that carries it: presentational on a
    // table cell, intrinsic dimensions on an image.
    const result = convert('<img src="/a.png" alt="" width="200" height="100">')
    expect(attribute(nodeAt(result, 'p-1'), 'width')).toBe(200)
    expect(attribute(nodeAt(result, 'p-1'), 'height')).toBe(100)
  })

  it('drops a width on a table cell, where it is styling', () => {
    const result = convert('<table><tr><td width="200">c</td></tr></table>')
    const cell = Object.values(result.nodes).find((node) => (node as { tag?: string }).tag === 'td')
    expect(attribute(cell, 'width')).toBeUndefined()
  })

  it('reports a class Tailwind cannot see', () => {
    const result = convert('<div class="bg-${color}">x</div>')
    expect(result.notes.some((note) => note.code === 'unscannable-class')).toBe(true)
  })
})

describe('executable URLs cannot survive a paste', () => {
  it('drops a javascript: href', () => {
    // Markup rather than a handler, so a handler sweep does not catch it — and it runs on
    // click exactly as a handler would.
    const result = convert('<a href="javascript:alert(1)">click</a>')
    expect(attribute(nodeAt(result, 'p-1'), 'href')).toBeUndefined()
    expect(result.notes.some((note) => note.message.includes('executable scheme'))).toBe(true)
  })

  it('is not fooled by whitespace inside the scheme', () => {
    expect(attribute(nodeAt(convert('<a href="java\tscript:alert(1)">x</a>'), 'p-1'), 'href'))
      .toBeUndefined()
  })

  it('drops a non-image data: URL', () => {
    expect(attribute(nodeAt(convert('<a href="data:text/html,<h1>x">y</a>'), 'p-1'), 'href'))
      .toBeUndefined()
  })

  it('keeps an inline image data URL, which is the one safe form', () => {
    const url = 'data:image/png;base64,iVBORw0KGgo='
    expect(attribute(nodeAt(convert(`<img alt="" src="${url}">`), 'p-1'), 'src')).toBe(url)
  })

  it('keeps an ordinary URL', () => {
    expect(attribute(nodeAt(convert('<a href="/next">x</a>'), 'p-1'), 'href')).toBe('/next')
  })
})

describe('inline styles', () => {
  it('keeps them as the escape hatch and says so', () => {
    const result = convert('<div style="color: red">x</div>')
    expect((nodeAt(result, 'p-1') as { style?: Record<string, string> }).style)
      .toEqual({ color: 'red' })
    expect(result.notes.some((note) => note.code === 'inline-style-kept')).toBe(true)
  })

  it('camelCases CSS property names, which is what React takes', () => {
    expect(parseInlineStyle('background-color: red; font-size: 12px'))
      .toEqual({ backgroundColor: 'red', fontSize: '12px' })
  })

  it('leaves a custom property exactly as written', () => {
    // Renaming --my-var would break the reference it exists for.
    expect(parseInlineStyle('--my-var: 4px')).toEqual({ '--my-var': '4px' })
  })

  it('ignores a malformed declaration rather than storing half of it', () => {
    expect(parseInlineStyle('color; :red; padding: 4px')).toEqual({ padding: '4px' })
  })
})

describe('the result is real IR the engine can use', () => {
  const html = `<section class="grid gap-4">
  <label for="email" class="text-sm">Email</label>
  <input type="email" id="email" required class="rounded">
  <a href="/next" tabindex="0">Go</a>
</section>`

  function generated(): string {
    const result = convert(html)
    const module_ = {
      version: 1,
      id: 'app/page.tsx',
      path: 'app/page.tsx',
      symbol: 'Pasted',
      kind: 'page',
      boundary: 'server',
      rootNodeId: result.rootIds[0],
      nodes: result.nodes,
    } as unknown as ReactIrModule
    return generateModule(module_, { anchorComments: true }).code
  }

  it('generates TSX carrying every attribute', () => {
    const code = generated()
    expect(code).toContain('htmlFor="email"')
    expect(code).toContain('href="/next"')
    expect(code).toContain('type="email"')
  })

  it('emits a boolean attribute bare rather than as a string', () => {
    expect(generated()).toMatch(/\brequired\b(?!=)/)
  })

  it('emits a numeric attribute as a number', () => {
    expect(generated()).toContain('tabIndex={0}')
  })

  it('round-trips back through the reader with no diagnostics', () => {
    // The proof that a paste produces the same artifact hand-written source produces.
    expect(readModuleSource('app/page.tsx', generated()).diagnostics).toEqual([])
  })

  it('preserves node identity through the round trip', () => {
    const reread = readModuleSource('app/page.tsx', generated())
    expect(reread.anchoredNodeIds).toContain('p-1')
  })
})

describe('empty and degenerate input', () => {
  it('handles empty markup without failing', () => {
    const result = convert('')
    expect(result.rootIds).toEqual([])
    expect(result.nodes).toEqual({})
  })

  it('handles a comment-only document', () => {
    expect(convert('<!-- nothing -->').rootIds).toEqual([])
  })

  it('is deterministic for the same input', () => {
    expect(JSON.stringify(convert('<div class="p-4">x</div>')))
      .toBe(JSON.stringify(convert('<div class="p-4">x</div>')))
  })
})

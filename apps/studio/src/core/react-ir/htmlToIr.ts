/**
 * Convert pasted HTML into React IR nodes.
 *
 * The old importer produced module+props `PageNode`s. This one produces the React node
 * union, so pasted markup becomes the same thing hand-written TSX becomes and there is one
 * model rather than two.
 *
 * The conversion that matters most is **attribute renaming**. JSX is not HTML: `class`,
 * `for`, `tabindex`, `colspan` and about twenty others have different names in React. Pass
 * them through unchanged and React silently ignores them — a pasted `<label for="email">`
 * renders looking correct and no longer labels its input, which is an accessibility
 * regression invisible on screen. So every attribute goes through a rename table, and an
 * attribute React would refuse is reported rather than dropped quietly.
 *
 * Safety is not re-implemented: `stripUnsafe` already removes scripts and inline handlers,
 * and this runs after it. What arrives here is markup, not behaviour.
 */

import { splitClassString, isScannable } from './classTokens'
import type { ReactIrNode } from './nodes'

/**
 * HTML attribute names that differ in JSX.
 *
 * Not exhaustive of all of HTML, but exhaustive of what pasted markup actually carries.
 * Anything absent passes through, which is correct for `id`, `src`, `href`, `alt`, `title`,
 * every `data-*` and every `aria-*` — React accepts those verbatim.
 */
const JSX_ATTRIBUTE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  class: 'className',
  for: 'htmlFor',
  tabindex: 'tabIndex',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  maxlength: 'maxLength',
  minlength: 'minLength',
  readonly: 'readOnly',
  autocomplete: 'autoComplete',
  autofocus: 'autoFocus',
  autoplay: 'autoPlay',
  srcset: 'srcSet',
  novalidate: 'noValidate',
  enctype: 'encType',
  formaction: 'formAction',
  accesskey: 'accessKey',
  contenteditable: 'contentEditable',
  spellcheck: 'spellCheck',
  crossorigin: 'crossOrigin',
  datetime: 'dateTime',
  usemap: 'useMap',
  frameborder: 'frameBorder',
  allowfullscreen: 'allowFullScreen',
  playsinline: 'playsInline',
})

/**
 * Attributes that are `true` in JSX rather than the empty string.
 *
 * HTML writes `<input disabled>`, which the DOM reports as `disabled=""`. Passing the empty
 * string to React means falsy, so the control would render enabled — the opposite of the
 * markup's intent.
 */
const BOOLEAN_ATTRIBUTES: ReadonlySet<string> = new Set([
  'disabled', 'checked', 'readOnly', 'required', 'multiple', 'selected', 'autoFocus',
  'autoPlay', 'controls', 'loop', 'muted', 'noValidate', 'open', 'reversed',
  'allowFullScreen', 'playsInline', 'hidden', 'default', 'itemScope',
])

/**
 * Attributes React types as `number` rather than `string`.
 *
 * HTML has only strings, so the DOM reports `tabindex="0"`. React's types declare
 * `tabIndex: number`, which makes the string a compile error — verified by compiling the
 * generated TSX against the real React types rather than by reading them. A paste
 * containing a table with `colspan` would otherwise fail the tenant's own typecheck.
 */
const NUMERIC_ATTRIBUTES: ReadonlySet<string> = new Set([
  'tabIndex', 'colSpan', 'rowSpan', 'maxLength', 'minLength', 'size', 'span',
  'start', 'rows', 'cols', 'width', 'height',
])

/**
 * Elements that must not be given children.
 *
 * React throws rather than warns for a void element with children, so this is a crash
 * rather than a cosmetic problem.
 */
const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
])

/**
 * Presentational attributes that HTML allows and the styling model does not.
 *
 * Reported rather than silently kept: `bgcolor` on a table cell works in a browser but is
 * invisible to the theme, so a token change would move the whole page except that cell.
 */
const PRESENTATIONAL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'align', 'valign', 'bgcolor', 'border', 'cellpadding', 'cellspacing',
  'width', 'height', 'hspace', 'vspace', 'nowrap', 'color', 'face',
])

/**
 * Elements where `width` and `height` are meaningful rather than presentational.
 *
 * On a table cell they are styling the theme cannot see. On an image they are the intrinsic
 * dimensions the browser needs in order to reserve space before the file loads — dropping
 * them reintroduces layout shift, which is the opposite of an improvement. So the same
 * attribute name is judged by the element carrying it.
 */
const DIMENSION_BEARING_ELEMENTS: ReadonlySet<string> = new Set([
  'img', 'svg', 'canvas', 'video', 'iframe', 'embed', 'object', 'input', 'source',
])

/**
 * URL attributes, and the schemes that must never survive a paste.
 *
 * `href="javascript:..."` is markup rather than an event handler, so a handler sweep does not
 * catch it — and it executes on click exactly as a handler would. Refused rather than
 * sanitised, because there is no version of an executable URL that is safe to keep.
 */
const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'href', 'src', 'action', 'formAction', 'poster', 'cite', 'data', 'background',
])

function isDangerousUrl(value: string): boolean {
  // Whitespace and control characters are how this check gets bypassed, so the scheme is
  // read from a stripped copy rather than from the raw string.
  const scheme = value.replace(/[\s\u0000-\u001f]/g, '').toLowerCase()
  return scheme.startsWith('javascript:')
    || scheme.startsWith('vbscript:')
    // A data: URL can carry markup that then runs; an inline image is the only safe form.
    || (scheme.startsWith('data:') && !scheme.startsWith('data:image/'))
}

/** Elements carrying no meaning that the IR should not preserve as structure. */
const DISCARDED_ELEMENTS: ReadonlySet<string> = new Set(['script', 'style', 'noscript', 'template'])

export type HtmlImportNote = Readonly<{
  code:
    | 'attribute-renamed'
    | 'attribute-dropped'
    | 'presentational-attribute'
    | 'inline-style-kept'
    | 'unscannable-class'
    | 'element-discarded'
  /** Node the note concerns, when there is one. */
  nodeId: string | null
  message: string
}>

export type HtmlImportResult = Readonly<{
  nodes: Readonly<Record<string, ReactIrNode>>
  /** Top-level node ids in document order. */
  rootIds: readonly string[]
  /**
   * What the conversion changed or could not carry.
   *
   * Surfaced rather than logged, because every one of these is a difference between what
   * was pasted and what will render, and the author is the only one who can judge whether
   * it matters.
   */
  notes: readonly HtmlImportNote[]
}>

type Walker = {
  nodes: Record<string, ReactIrNode>
  notes: HtmlImportNote[]
  counter: number
  idPrefix: string
}

/**
 * Convert a parsed document body into React IR nodes.
 *
 * Takes a `Document` rather than a string so the caller keeps ownership of parsing and of
 * `stripUnsafe` — this function assumes the document has already been made safe.
 */
export function documentToReactIr(
  doc: Document,
  options: Readonly<{ idPrefix?: string }> = {},
): HtmlImportResult {
  const walker: Walker = {
    nodes: {},
    notes: [],
    counter: 0,
    idPrefix: options.idPrefix ?? 'n',
  }

  const rootIds: string[] = []
  const body = doc.body
  if (body) {
    for (const child of Array.from(body.childNodes)) {
      const id = convertNode(walker, child)
      if (id !== null) rootIds.push(id)
    }
  }

  return Object.freeze({
    nodes: Object.freeze(walker.nodes),
    rootIds: Object.freeze(rootIds),
    notes: Object.freeze(walker.notes),
  })
}

function nextId(walker: Walker): string {
  walker.counter += 1
  return `${walker.idPrefix}-${walker.counter}`
}

/** Convert one DOM node, returning its id or null when nothing is produced. */
function convertNode(walker: Walker, node: ChildNode): string | null {
  // 3 = TEXT_NODE, 1 = ELEMENT_NODE. Spelled numerically so this module needs no DOM
  // globals beyond the document it is handed.
  if (node.nodeType === 3) {
    const value = normaliseText(node.textContent ?? '')
    // Whitespace between elements is layout in HTML and a stray text node in JSX.
    if (value === '') return null
    const id = nextId(walker)
    walker.nodes[id] = { kind: 'text', id, value, children: [] } as unknown as ReactIrNode
    return id
  }

  if (node.nodeType !== 1) return null

  const element = node as Element
  const tag = element.tagName.toLowerCase()

  if (DISCARDED_ELEMENTS.has(tag)) {
    walker.notes.push(Object.freeze({
      code: 'element-discarded',
      nodeId: null,
      message: `<${tag}> was discarded: it carries behaviour or styling rather than structure, `
        + 'and the engine models those separately.',
    }))
    return null
  }

  const id = nextId(walker)
  const { classTokens, attributes, style } = convertAttributes(walker, element, id)

  const children: string[] = []
  if (!VOID_ELEMENTS.has(tag)) {
    for (const child of Array.from(element.childNodes)) {
      const childId = convertNode(walker, child)
      if (childId !== null) children.push(childId)
    }
  } else if (element.childNodes.length > 0) {
    // Not merely dropped: React throws for a void element with children, so a paste that
    // contained one would crash the canvas rather than render oddly.
    walker.notes.push(Object.freeze({
      code: 'element-discarded',
      nodeId: id,
      message: `<${tag}> is a void element, so its children were dropped. React throws rather `
        + 'than warns when a void element is given children.',
    }))
  }

  walker.nodes[id] = {
    kind: 'element',
    id,
    tag,
    classTokens,
    children,
    // `attributes`, not `props`: that is what the element schema declares, and because it
    // sets additionalProperties:false a misnamed field is dropped in silence rather than
    // refused — which is how a pasted link loses its href without anything saying so.
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    ...(style === undefined ? {} : { style }),
  } as unknown as ReactIrNode

  return id
}

/**
 * Collapse HTML whitespace the way a browser would.
 *
 * A newline and indentation between words is one space in HTML; preserving it verbatim
 * would put the source file's formatting into the rendered text.
 */
function normaliseText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

function convertAttributes(
  walker: Walker,
  element: Element,
  nodeId: string,
): Readonly<{
  classTokens: string[]
  attributes: Record<string, unknown>
  style: Record<string, string> | undefined
}> {
  const classTokens: string[] = []
  const attributes: Record<string, unknown> = {}
  let style: Record<string, string> | undefined

  for (const attribute of Array.from(element.attributes)) {
    const rawName = attribute.name.toLowerCase()
    const value = attribute.value

    if (rawName === 'class') {
      for (const token of splitClassString(value)) {
        if (isScannable(token)) classTokens.push(token)
        else {
          walker.notes.push(Object.freeze({
            code: 'unscannable-class',
            nodeId,
            message: `Class "${token}" is not a complete literal, so Tailwind generates no CSS `
              + 'for it and the element will render unstyled.',
          }))
        }
      }
      continue
    }

    if (rawName === 'style') {
      const declarations = parseInlineStyle(value)
      if (Object.keys(declarations).length > 0) {
        style = declarations
        walker.notes.push(Object.freeze({
          code: 'inline-style-kept',
          nodeId,
          message: 'Inline styles were kept as an escape hatch. Most of them have a Tailwind '
            + 'equivalent, and a class follows a token change where an inline value does not.',
        }))
      }
      continue
    }

    // An event handler should already be gone; if one survives, dropping it is the only safe
    // option because the IR has no way to express behaviour pasted as a string.
    if (rawName.startsWith('on')) {
      walker.notes.push(Object.freeze({
        code: 'attribute-dropped',
        nodeId,
        message: `"${rawName}" was dropped. Pasted markup cannot bring behaviour with it; add `
          + 'the interaction in a code component.',
      }))
      continue
    }

    const tagName = element.tagName.toLowerCase()

    if (rawName === 'size' && tagName !== 'input' && tagName !== 'select') {
      walker.notes.push(Object.freeze({
        code: 'presentational-attribute',
        nodeId,
        message: '"size" styles the element outside the theme here. Use a class instead.',
      }))
      continue
    }

    if (PRESENTATIONAL_ATTRIBUTES.has(rawName)
      && !((rawName === 'width' || rawName === 'height')
        && DIMENSION_BEARING_ELEMENTS.has(tagName))) {
      walker.notes.push(Object.freeze({
        code: 'presentational-attribute',
        nodeId,
        message: `"${rawName}" styles the element outside the theme, so a token change would `
          + 'move the rest of the page and leave this alone. Use a class instead.',
      }))
      continue
    }

    const jsxName = JSX_ATTRIBUTE_NAMES[rawName]
    if (jsxName !== undefined) {
      walker.notes.push(Object.freeze({
        code: 'attribute-renamed',
        nodeId,
        message: `"${rawName}" became "${jsxName}". React ignores the HTML spelling, so the `
          + 'attribute would have had no effect.',
      }))
    }

    const name = jsxName ?? rawName

    if (URL_ATTRIBUTES.has(name) && isDangerousUrl(value)) {
      walker.notes.push(Object.freeze({
        code: 'attribute-dropped',
        nodeId,
        message: `"${rawName}" was dropped: its URL carries an executable scheme, which runs on `
          + 'click exactly as an event handler would. There is no safe form of it to keep.',
      }))
      continue
    }

    // Wrapped as a literal expression, which is the shape AttributeValueSchema declares.
    // A bare string typechecks through `unknown` and then crashes the generator when it
    // reads `.kind` off it — so the shape has to be right here, not merely plausible.
    attributes[name] = Object.freeze({
      kind: 'expression',
      expression: Object.freeze({ kind: 'literal', value: attributeValue(walker, name, value, nodeId) }),
    })
  }

  return { classTokens, attributes, style }
}

/**
 * Parse an inline style declaration into camelCased properties.
 *
 * React's `style` prop takes camelCase, not the CSS spelling, and a custom property must
 * keep its double dash exactly.
 */
export function parseInlineStyle(value: string): Record<string, string> {
  const declarations: Record<string, string> = {}
  for (const part of value.split(';')) {
    const separator = part.indexOf(':')
    if (separator === -1) continue
    const property = part.slice(0, separator).trim()
    const declared = part.slice(separator + 1).trim()
    if (property === '' || declared === '') continue
    declarations[property.startsWith('--') ? property : camelCase(property)] = declared
  }
  return declarations
}

/**
 * The value to store for an attribute.
 *
 * A boolean attribute becomes `true`, a numeric one becomes a number, everything else stays
 * a string. A numeric attribute whose value is not a number is kept as a string and
 * reported: `width="100%"` is legal HTML, and silently turning it into `NaN` would be worse
 * than leaving a value the compiler can object to.
 */
function attributeValue(
  walker: Walker,
  name: string,
  raw: string,
  nodeId: string,
): string | number | boolean {
  if (BOOLEAN_ATTRIBUTES.has(name)) return true
  if (!NUMERIC_ATTRIBUTES.has(name)) return raw

  const numeric = Number(raw)
  if (raw.trim() !== '' && Number.isFinite(numeric)) return numeric

  walker.notes.push(Object.freeze({
    code: 'attribute-dropped',
    nodeId,
    message: `"${name}" is typed as a number in React but carried "${raw}", which is not one. `
      + 'Kept as written so the compiler can object rather than storing NaN.',
  }))
  return raw
}

function camelCase(property: string): string {
  return property.toLowerCase().replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())
}

/** The JSX name for an HTML attribute, or the same name when React accepts it verbatim. */
export function jsxAttributeName(htmlName: string): string {
  return JSX_ATTRIBUTE_NAMES[htmlName.toLowerCase()] ?? htmlName.toLowerCase()
}

export function isVoidElement(tag: string): boolean {
  return VOID_ELEMENTS.has(tag.toLowerCase())
}

/**
 * Convert an HTML string straight to React IR.
 *
 * Deliberately does NOT call `stripUnsafe` first. That helper removes the `style` attribute
 * and does not count it, so a paste carrying inline styles would lose them in silence. This
 * path keeps them as the declared escape hatch and reports it, and removes what actually
 * matters itself — `<script>`, `on*` handlers and executable URLs — so nothing is traded away
 * for the difference.
 */
export function importHtmlToReactIr(
  source: string,
  options: Readonly<{ idPrefix?: string }> = {},
): HtmlImportResult {
  return documentToReactIr(new DOMParser().parseFromString(source, 'text/html'), options)
}

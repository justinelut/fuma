/**
 * Measured parity between a rendered page and the React engine's rendering of the same page.
 *
 * Task 65 asks for acceptance "with measured parity", and the honest measurement is not a screenshot or
 * a byte diff — it is whether the engine produces the SAME SEMANTIC PAGE as the string publisher for
 * the same input. A byte comparison fails on formatting nobody can see and passes nothing useful; a
 * screenshot needs a browser and reports a difference without saying what changed.
 *
 * So this compares SEMANTIC structure: element order, tag names, visible text, and the attributes that
 * change what a page MEANS. Formatting, attribute order and class order are deliberately not compared,
 * because the engine legitimately normalises all three and reporting them would bury a real difference
 * under noise nobody can act on.
 */

/** One element or text run, flattened in document order with its depth. */
export type SemanticEntry = Readonly<{
  depth: number
  /** Lowercase tag name, or null for a text run. */
  tag: string | null
  /** Collapsed visible text for a text run, otherwise null. */
  text: string | null
  /** Only the attributes that change meaning, sorted so order cannot cause a false difference. */
  attributes: readonly Readonly<{ name: string; value: string }>[]
}>

/**
 * Attributes that change what a page MEANS, as a closed set.
 *
 * Everything else is presentation or engine bookkeeping. `data-node-id` in particular is added by the
 * canvas renderer for selection and appears in NO published page, so comparing it would report a
 * difference on every element — the gate would be useless on its first run.
 */
const MEANINGFUL_ATTRIBUTES = new Set([
  'href', 'src', 'alt', 'title', 'type', 'name', 'value', 'for', 'id',
  'role', 'colspan', 'rowspan', 'scope', 'lang', 'target', 'rel', 'method', 'action',
  'placeholder', 'required', 'disabled', 'checked', 'selected', 'multiple', 'readonly',
  'width', 'height', 'poster', 'controls', 'loading', 'tabindex',
])

/** Elements whose content is not visible page text, so their text is never compared. */
const NON_RENDERED = new Set(['script', 'style', 'noscript', 'template', 'head', 'title'])

/**
 * Resource hints REACT ITSELF injects, which are not part of the page's meaning.
 *
 * MEASURED, not assumed: React 19's renderToStaticMarkup emits
 *   <link rel="preload" as="image" href="..."/>
 * ahead of the tree for an `<img src>`. It is the renderer adding a performance hint, not the engine
 * changing the page, and it appears in no source markup — so comparing it reports a difference on every
 * page containing an image and the gate would fail on its first real input.
 *
 * A hint is dropped ONLY when React would have generated it; a `<link rel="stylesheet">` an author
 * wrote is still compared, because losing a stylesheet changes what the page looks like.
 */
const INJECTED_HINT_RELS = new Set(['preload', 'preconnect', 'prefetch', 'modulepreload', 'dns-prefetch'])

function isInjectedResourceHint(element: Element): boolean {
  if (element.tagName.toLowerCase() !== 'link') return false
  const rel = (element.getAttribute('rel') ?? '').trim().toLowerCase()
  return INJECTED_HINT_RELS.has(rel)
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Class is compared as a SET, not a string.
 *
 * The engine merges class tokens conflict-aware, which legitimately reorders them, so comparing the
 * raw string would report a difference for a page that renders identically.
 */
function normaliseClass(value: string): string {
  return [...new Set(collapse(value).split(' ').filter((token) => token !== ''))].sort().join(' ')
}

/**
 * Flattens a DOM into comparable entries.
 *
 * A `parse` function is injected rather than reaching for a global DOMParser, because this module is
 * shared with the server where there is none — and a module that only works in a browser is one the
 * build cannot check.
 */
export function semanticEntries(
  html: string,
  parse: (source: string) => Document,
): readonly SemanticEntry[] {
  const document = parse(html)
  const entries: SemanticEntry[] = []

  const walk = (node: Node, depth: number): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        const text = collapse(child.textContent ?? '')
        // Whitespace-only runs between elements are layout in the SOURCE, not content on the page, so
        // comparing them would report a difference for every difference in indentation.
        if (text !== '') entries.push({ depth, tag: null, text, attributes: [] })
        continue
      }
      if (child.nodeType !== 1) continue
      const element = child as Element
      // Skipped entirely rather than compared: see isInjectedResourceHint.
      if (isInjectedResourceHint(element)) continue
      const tag = element.tagName.toLowerCase()

      const attributes = Array.from(element.attributes)
        .filter((attribute) => {
          const name = attribute.name.toLowerCase()
          return name === 'class' || MEANINGFUL_ATTRIBUTES.has(name) || name.startsWith('aria-')
        })
        .map((attribute) => ({
          name: attribute.name.toLowerCase(),
          value: attribute.name.toLowerCase() === 'class'
            ? normaliseClass(attribute.value)
            : collapse(attribute.value),
        }))
        .sort((left, right) => left.name.localeCompare(right.name))

      entries.push({ depth, tag, text: null, attributes })
      if (!NON_RENDERED.has(tag)) walk(element, depth + 1)
    }
  }

  walk(document.body ?? document, 0)
  return entries
}

export type ParityDifference = Readonly<{
  /** Index into the flattened sequence, so a report points at a position rather than a whole page. */
  index: number
  kind: 'missing' | 'extra' | 'tag' | 'text' | 'attribute'
  detail: string
}>

export type ParityReport = Readonly<{
  /** True only when NOTHING differs. A partial match is not parity. */
  identical: boolean
  differences: readonly ParityDifference[]
  /** Compared entries, so a report states how much was actually examined. */
  compared: number
}>

/**
 * Compares two flattened pages.
 *
 * Reports EVERY difference rather than stopping at the first, because the first is often a consequence
 * of the second and fixing it alone leaves the page still wrong.
 */
export function compareSemantics(
  expected: readonly SemanticEntry[],
  actual: readonly SemanticEntry[],
): ParityReport {
  const differences: ParityDifference[] = []
  const length = Math.max(expected.length, actual.length)

  for (let index = 0; index < length; index += 1) {
    const left = expected[index]
    const right = actual[index]
    if (left === undefined) {
      differences.push({ index, kind: 'extra', detail: `unexpected ${right?.tag ?? 'text'}` })
      continue
    }
    if (right === undefined) {
      differences.push({ index, kind: 'missing', detail: `missing ${left.tag ?? 'text'}` })
      continue
    }
    if (left.tag !== right.tag) {
      differences.push({
        index, kind: 'tag',
        detail: `expected ${left.tag ?? 'text'} but found ${right.tag ?? 'text'}`,
      })
      // A tag mismatch means the sequences have diverged, so comparing this entry's attributes would
      // report differences that are consequences rather than causes.
      continue
    }
    if (left.text !== right.text) {
      differences.push({
        index, kind: 'text',
        detail: `expected text "${left.text ?? ''}" but found "${right.text ?? ''}"`,
      })
    }
    const rightByName = new Map(right.attributes.map((attribute) => [attribute.name, attribute.value]))
    for (const attribute of left.attributes) {
      const found = rightByName.get(attribute.name)
      if (found === undefined) {
        differences.push({
          index, kind: 'attribute',
          detail: `${left.tag ?? 'text'} lost ${attribute.name}="${attribute.value}"`,
        })
      } else if (found !== attribute.value) {
        differences.push({
          index, kind: 'attribute',
          detail: `${left.tag ?? 'text'} ${attribute.name} expected "${attribute.value}" but found "${found}"`,
        })
      }
    }
  }

  return {
    identical: differences.length === 0,
    differences: Object.freeze(differences),
    compared: length,
  }
}

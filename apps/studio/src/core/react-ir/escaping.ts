/**
 * Escaping under React, which INVERTS the rule the string publisher needed.
 *
 * THE OLD CONTRACT, stated in core/publisher/utils.ts: escapeProps() ran escapeHtml() over every
 * string prop BEFORE render(), and a module's render() had to NOT escape again because doing so
 * double-escapes (CWE-116). That was right: render() concatenated strings into markup, so somebody
 * had to escape, and doing it once at the boundary was the discipline.
 *
 * UNDER REACT IT IS EXACTLY BACKWARDS. React escapes text children and attribute values itself,
 * as part of rendering. So a value that arrives ALREADY escaped is escaped a second time and the
 * visitor SEES THE ENTITIES: a heading reading "Ben &amp; Jerry" instead of "Ben & Jerry". Nothing
 * errors. It is not a security failure this time - it is a visible content defect, and it appears
 * on exactly the copy most likely to contain an ampersand or an apostrophe, which is a business
 * name.
 *
 * SO THE DANGEROUS INSTINCT IS TO CONCLUDE "REACT HANDLES ESCAPING, DROP THE WHOLE LAYER". That is
 * wrong, and this file exists to draw the line precisely - a line I got wrong at first and
 * corrected by MEASURING what React 19 actually does:
 *
 *  - React BLOCKS `javascript:` in href, including `JavaScript:` and even `java\tscript:`
 *    (measured: it substitutes a throwing URL). I had claimed it did not check schemes at all;
 *    that was false and the test caught it.
 *  - React ALLOWS `vbscript:` and every `data:` URL, including
 *    `data:text/html,<script>alert(1)</script>` and `data:image/svg+xml,<svg onload=...>`
 *    (all three measured as ALLOWED). So the scheme check is still required - just for a
 *    narrower and more precise reason than "React does nothing".
 *  - React does NOT sanitise HTML given to dangerouslySetInnerHTML, which is the only way rich
 *    text renders, nor SVG for the same reason.
 *
 * So escaping goes, and the scheme check plus the sanitisers stay - the scheme check covering
 * exactly the ground React leaves open.
 */
import { isSafeUrl } from '@core/html-sanitize'

/** How a prop reaches the rendered output, which is what decides its treatment. */
export type PropSink =
  /** Rendered as a text child or an ordinary attribute value. React escapes this. */
  | 'text'
  /** Rendered into href/src/action. React does NOT check the scheme. */
  | 'url'
  /** Rendered through dangerouslySetInnerHTML. React does NOT sanitise this. */
  | 'html'
  /** Inline SVG markup, also through dangerouslySetInnerHTML. */
  | 'svg'

export type PreparedProp = Readonly<{
  value: string
  /** What was done, so a caller and a reviewer can see the treatment rather than infer it. */
  treatment: 'passed-through' | 'url-validated' | 'url-refused' | 'requires-sanitiser'
  /** Present when the value was changed or refused, naming why. */
  note: string | null
}>

/** A URL React would happily render and a browser would happily execute. */
export const REFUSED_URL = '#'

/**
 * Prepares one string prop for React.
 *
 * TEXT IS PASSED THROUGH UNCHANGED, and that is the whole point. Escaping here is the defect,
 * not the protection.
 */
export function prepareProp(value: string, sink: PropSink): PreparedProp {
  if (sink === 'text') {
    // Deliberately no transformation. React escapes this when it renders it, and doing it here
    // too is what puts &amp; on the page.
    return frozen(value, 'passed-through', null)
  }

  if (sink === 'url') {
    // React already blocks `javascript:` itself (measured). This check covers what it does NOT:
    // `vbscript:` and every `data:` URL, both measured as rendered through unchanged. Keeping it
    // also means the refusal does not depend on which React version is installed.
    if (!isSafeUrl(value)) {
      return frozen(
        REFUSED_URL,
        'url-refused',
        'This URL uses a scheme that can execute code, so it was replaced with a link that goes nowhere rather than rendered.',
      )
    }
    // NOT html-escaped: React escapes the attribute value itself. Escaping it here would put
    // &amp; inside a query string and change the address the link points at.
    return frozen(value, 'url-validated', null)
  }

  // html and svg both reach the DOM through dangerouslySetInnerHTML, which is precisely the API
  // that bypasses React's escaping. This function does NOT sanitise - it reports that a
  // sanitiser is required, because returning the value unchanged with no signal is how raw
  // markup reaches innerHTML while looking like it went through a safety layer.
  return frozen(
    value,
    'requires-sanitiser',
    sink === 'svg'
      ? 'SVG reaches the DOM through dangerouslySetInnerHTML, so it must be sanitised with an SVG profile before rendering.'
      : 'Rich text reaches the DOM through dangerouslySetInnerHTML, so it must be sanitised before rendering.',
  )
}

function frozen(value: string, treatment: PreparedProp['treatment'], note: string | null): PreparedProp {
  return Object.freeze({ value, treatment, note })
}

/**
 * Whether a value still needs a sanitiser before it may be rendered.
 *
 * Offered as a predicate so a caller cannot render an unsanitised value by forgetting to read
 * `treatment` - a boolean check is harder to skip than a string comparison.
 */
export function needsSanitiser(prepared: PreparedProp): boolean {
  return prepared.treatment === 'requires-sanitiser'
}

/**
 * Detects a value that has ALREADY been HTML-escaped, which under React is a defect.
 *
 * WHY DETECTION RATHER THAN UNESCAPING: reversing it is not safely decidable. A value that
 * legitimately contains the literal text "&amp;" - documentation about escaping, a code sample -
 * is indistinguishable from one that was escaped once. Unescaping would corrupt the first case
 * silently, and this file exists to stop silent corruption rather than to add another kind.
 *
 * So it REPORTS, and the migration decides. The commonest real cause is a value that came through
 * the old escapeProps path.
 */
export function looksPreEscaped(value: string): boolean {
  // These five are what escapeHtml produces. Matching the pattern rather than the individual
  // characters, because a bare '&' is ordinary text and only the entity form is suspicious.
  return /&(?:amp|lt|gt|quot|#39);/.test(value)
}

export type EscapingProblem = Readonly<{ code: string, message: string }>

/**
 * Reviews a set of props about to be handed to a React component.
 *
 * Each problem here renders as something OTHER than a security failure, which is why they survive
 * review: the page looks broken or looks fine, rather than looking unsafe.
 */
export function reviewProps(
  props: Readonly<Record<string, string>>,
  sinks: Readonly<Record<string, PropSink>>,
): readonly EscapingProblem[] {
  const problems: EscapingProblem[] = []

  for (const [key, value] of Object.entries(props)) {
    const sink = sinks[key] ?? 'text'

    if (sink === 'text' && looksPreEscaped(value)) {
      problems.push({
        code: 'double-escaped-text',
        message: `Prop "${key}" appears to be HTML-escaped already. React escapes text itself, so this renders the entities visibly (for example "Ben &amp; Jerry" instead of "Ben & Jerry").`,
      })
    }

    if (sink === 'url' && !isSafeUrl(value)) {
      problems.push({
        code: 'executable-url',
        message: `Prop "${key}" carries a URL scheme that can execute code. React renders href values without checking the scheme, so this must be refused before it reaches the attribute.`,
      })
    }

    if ((sink === 'html' || sink === 'svg') && value.length > 0) {
      // Reported for EVERY such prop, not only suspicious ones: the point is that the sink itself
      // bypasses React's escaping, so the requirement holds regardless of the current value.
      problems.push({
        code: 'unsanitised-raw-markup',
        message: `Prop "${key}" is rendered as raw markup, which bypasses React's escaping entirely. It must pass a sanitiser first.`,
      })
    }
  }

  return Object.freeze(problems)
}

/**
 * The rule the OLD publisher followed, recorded so a migration can see what changes.
 *
 * Kept as data rather than prose because the two contracts are opposites, and somebody reading one
 * file needs to know the other exists - copying the string publisher's discipline into a React
 * component is the exact mistake this module prevents.
 */
export const ESCAPING_CONTRACTS = Object.freeze({
  stringPublisher: 'escapeProps() escapes every string prop before render(); render() must not escape again.',
  reactEngine: 'Props are passed through unchanged because React escapes text and attributes itself; only URL schemes are validated and raw-markup sinks are sanitised.',
})

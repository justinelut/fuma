/**
 * How the built-in modules become React, and why most of them do not become components.
 *
 * THE OLD MODEL: every built-in is a ModuleDefinition with `render: (props) => string`. It emits
 * markup, and the publisher concatenates the result. Under the React engine nothing concatenates
 * markup, so each one has to land somewhere in the node union.
 *
 * THE FINDING THAT DECIDES THE SHAPE OF THIS WORK, established by reading all eighteen: EXACTLY
 * ONE of them ships client JavaScript (base.form, via formRuntimeJs). Every other module resolves
 * to a plain HTML tag - `htmlTag: 'img'`, `'a'`, `'body'`, or a small function picking among a
 * closed tag set. They carry no behaviour at all.
 *
 * SO THE RIGHT ANSWER FOR MOST OF THEM IS NOT A COMPONENT. It is the IR's own element node, which
 * already expresses a tag, Tailwind class tokens, attributes and children. Wrapping them in
 * components would be actively worse in three ways:
 *
 *  1. THE GENERATED SOURCE STOPS BEING WORTH READING. `<TextModule tag="h1" text="Hello" />` in
 *     place of `<h1 className="text-4xl">Hello</h1>` is what a tenant opens their own repository to
 *     find. The product's stated output is source a developer would have written; an indirection
 *     per paragraph is not that.
 *  2. EVERY PAGE WOULD DEPEND ON OUR RUNTIME. A tenant's site would import eighteen components
 *     from somewhere, so their site is only as portable as our package. The point of emitting real
 *     TSX is that they can take it and leave.
 *  3. IT ADDS A LAYER THAT CANNOT BE STYLED FROM THE CANVAS without inventing prop pass-through
 *     for className, which is the exact indirection Tailwind class tokens removed.
 *
 * So this module is mostly a RETIREMENT MAP with the reasoning attached, and it names the small
 * number of modules that genuinely have to become components.
 */

/** What a built-in module becomes under the React engine. */
export type ConversionKind =
  /**
   * Retires into the IR's element node. Nothing is generated for it; the tag it resolved to
   * becomes the element's tag directly.
   */
  | 'native-element'
  /**
   * Retires into an engine primitive the node union already models (repeat / outlet / component).
   * These were never really markup - they were structure the old model had to express as modules.
   */
  | 'engine-primitive'
  /**
   * Becomes a real React component, because it carries behaviour a static element cannot.
   */
  | 'react-component'

export type ModuleConversion = Readonly<{
  moduleId: string
  kind: ConversionKind
  /** For native-element: the tag or closed tag set it resolves to. */
  tags?: readonly string[]
  /** For engine-primitive: the node kind that replaces it. */
  nodeKind?: 'repeat' | 'outlet' | 'component'
  /** Stated for every entry, because a conversion nobody can justify is one nobody can review. */
  reason: string
}>

function conversion(entry: ModuleConversion): ModuleConversion {
  return Object.freeze(entry)
}

/**
 * The nine modules that are plain elements.
 *
 * Each is listed with the tags it can produce, so the mapping is checkable against the shipped
 * module rather than asserted. A tag set that is CLOSED is what makes the element node sufficient:
 * the IR needs no logic to decide the tag, because the author chose it.
 */
const NATIVE_ELEMENTS: readonly ModuleConversion[] = Object.freeze([
  conversion({
    moduleId: 'base.body',
    kind: 'native-element',
    tags: ['body'],
    reason: 'A fixed body tag. Under Next this is app/layout.tsx\'s own body element, so the module has nowhere left to exist.',
  }),
  conversion({
    moduleId: 'base.container',
    kind: 'native-element',
    tags: ['div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav'],
    reason: 'A layout box choosing among semantic sectioning tags. The element node holds the tag and the class tokens, which is all it ever was.',
  }),
  conversion({
    moduleId: 'base.text',
    kind: 'native-element',
    tags: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'div'],
    reason: 'A tag plus text. Its render() turns newlines into <br>, which under React becomes separate text children rather than markup - the one behaviour it had is expressible as tree shape.',
  }),
  conversion({
    moduleId: 'base.link',
    kind: 'native-element',
    tags: ['a'],
    reason: 'An anchor with an href. The URL check that mattered now lives in the escaping model rather than in the module.',
  }),
  conversion({
    moduleId: 'base.button',
    kind: 'native-element',
    tags: ['button', 'a'],
    reason: 'A button, or an anchor when it carries an href. Both are elements; which one is a tag decision the author already makes.',
  }),
  conversion({
    moduleId: 'base.image',
    kind: 'native-element',
    tags: ['img'],
    reason: 'An img with src/alt/width/height. Whether it should become next/image is a separate decision about the generated site, not a reason to keep a module.',
  }),
  conversion({
    moduleId: 'base.list',
    kind: 'native-element',
    tags: ['ul', 'ol'],
    reason: 'An ordered or unordered list. The list type is the tag.',
  }),
  conversion({
    moduleId: 'base.svg',
    kind: 'native-element',
    tags: ['svg'],
    reason: 'Inline SVG markup. It reaches the DOM through a raw-markup sink, so the sanitiser the escaping model requires is what protects it - not the module.',
  }),
  conversion({
    moduleId: 'base.video',
    kind: 'native-element',
    tags: ['video', 'iframe'],
    reason: 'A video element, or an iframe for an embedded provider. Neither needs our code to play; the browser does it.',
  }),
])

/**
 * The four modules that were structure rather than markup.
 *
 * These are the ones a naive conversion would get wrong by making them components, because the
 * node union ALREADY has a kind for each - and having both would mean two ways to express one
 * thing, which is how a tree becomes ambiguous.
 */
const ENGINE_PRIMITIVES: readonly ModuleConversion[] = Object.freeze([
  conversion({
    moduleId: 'base.loop',
    kind: 'engine-primitive',
    nodeKind: 'repeat',
    reason: 'A repeat node already expresses a collection, an item scope and a key. A loop module would be a second way to say the same thing.',
  }),
  conversion({
    moduleId: 'base.outlet',
    kind: 'engine-primitive',
    nodeKind: 'outlet',
    reason: 'This IS Next\'s {props.children}. The outlet node generates it, and the reader recovers it.',
  }),
  conversion({
    moduleId: 'base.slot-outlet',
    kind: 'engine-primitive',
    nodeKind: 'outlet',
    reason: 'A named slot is children under another name. Keeping both would let one tree contain two mechanisms for the same hole.',
  }),
  conversion({
    moduleId: 'base.visual-component-ref',
    kind: 'engine-primitive',
    nodeKind: 'component',
    reason: 'A reference to another component is exactly what the component node is, and its props are checked against derived controls rather than stored per usage.',
  }),
])

/**
 * The modules that genuinely become React components.
 *
 * base.form is the only built-in shipping client JavaScript, and task 63 already decided what it
 * becomes: a client component validating with react-hook-form + zod and posting to the platform
 * endpoint. So it is a component because it has behaviour, not because it was a module.
 *
 * Its FIELD modules (label/input/select/checkbox/radio/submit/form-message) are deliberately NOT
 * separate components: shadcn's Field composition is what task 75 ships, and emitting our own
 * parallel set would give a tenant two field vocabularies in one form.
 */
const REACT_COMPONENTS: readonly ModuleConversion[] = Object.freeze([
  conversion({
    moduleId: 'base.form',
    kind: 'react-component',
    reason: 'The only built-in with client behaviour: it validates, submits and reports a result. A submission is a visitor interaction, so it cannot be a server component.',
  }),
])

export const MODULE_CONVERSIONS: readonly ModuleConversion[] = Object.freeze([
  ...NATIVE_ELEMENTS,
  ...ENGINE_PRIMITIVES,
  ...REACT_COMPONENTS,
])

export function conversionFor(moduleId: string): ModuleConversion | null {
  // Null rather than a default, because guessing 'native-element' for an unrecognised module would
  // silently drop whatever behaviour it had - and a plugin's module is exactly the unknown case.
  return MODULE_CONVERSIONS.find((entry) => entry.moduleId === moduleId) ?? null
}

/**
 * Whether a module's conversion removes it from the engine entirely.
 *
 * Offered as a predicate so a migration can ask rather than re-deriving the classification, which
 * is how two answers to the same question start disagreeing.
 */
export function retires(entry: ModuleConversion): boolean {
  return entry.kind === 'native-element' || entry.kind === 'engine-primitive'
}

export type ConversionProblem = Readonly<{ moduleId: string; code: string; message: string }>

/**
 * Checks a proposed conversion against the properties that make it sound.
 *
 * The mistake this exists to catch is the one a bulk rewrite makes: converting a module WITH
 * behaviour into a native element, which drops the behaviour while leaving the page looking
 * approximately right.
 */
export function reviewConversion(proposed: Readonly<{
  moduleId: string
  kind: ConversionKind
  /** Whether the shipped module emits client JavaScript. */
  shipsClientJs: boolean
  /** Whether the shipped module resolves to a closed set of HTML tags. */
  resolvesToHtmlTag: boolean
}>): readonly ConversionProblem[] {
  const problems: ConversionProblem[] = []

  if (proposed.shipsClientJs && proposed.kind === 'native-element') {
    problems.push({
      moduleId: proposed.moduleId,
      code: 'behaviour-dropped',
      message: 'This module ships client JavaScript, so converting it to a plain element silently removes what it does. The page still renders, which is why the loss is easy to miss.',
    })
  }

  if (!proposed.shipsClientJs && proposed.kind === 'react-component') {
    problems.push({
      moduleId: proposed.moduleId,
      code: 'needless-component',
      message: 'This module has no behaviour, so a component adds an indirection the generated source has to carry and the canvas cannot style directly.',
    })
  }

  if (!proposed.resolvesToHtmlTag && proposed.kind === 'native-element') {
    problems.push({
      moduleId: proposed.moduleId,
      code: 'no-tag-to-become',
      message: 'This module does not resolve to an HTML tag, so there is no element for it to become. It is structure, and belongs on an engine primitive.',
    })
  }

  return Object.freeze(problems)
}

/** Recorded so the scale of the change is stated rather than discovered. */
export const CONVERSION_SUMMARY = Object.freeze({
  nativeElements: NATIVE_ELEMENTS.length,
  enginePrimitives: ENGINE_PRIMITIVES.length,
  reactComponents: REACT_COMPONENTS.length,
  note: 'Most built-ins retire rather than convert. The engine already expresses what they did, and a component per element would make the generated source worse and tie every tenant page to our runtime.',
})

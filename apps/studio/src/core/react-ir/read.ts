/**
 * Typed TSX → React IR.
 *
 * The other half of the round trip, and the half that has to be honest. React is
 * Turing-complete, so no reader can recover an editable tree from arbitrary
 * source. This one accepts a documented subset and refuses the rest — loudly, with
 * a diagnostic naming the construct and the fix — rather than approximating and
 * leaving the author to discover later that their code was misread.
 *
 * Accepted:
 *   - intrinsic elements and component calls
 *   - literal text
 *   - the constrained expression forms: literals, member reads on known scopes,
 *     finite conditionals, bounded templates
 *   - `children` and `props.<name>` in child position
 *   - `.map(...)` over a prop, which is how a repeat appears
 *
 * Refused, each for a reason:
 *   - spreads: hide which props exist, so a property panel cannot be truthful
 *   - handlers and arbitrary calls: cannot be previewed without running them
 *   - `dangerouslySetInnerHTML`: the reader cannot model what is inside it
 *   - unresolved components: an import that cannot be traced is not editable
 *
 * The refusals mirror the restrictions the existing Next-source projection
 * compiler already enforces, so the two agree on what "supported" means.
 *
 * Reconciliation is id-first. When source carries `{/* @fuma <id> *\/}` anchors, a
 * node keeps its identity through reformatting, reordering and renaming — which is
 * what lets a visual edit and a hand edit be merged rather than one overwriting
 * the other. Without anchors the reader falls back to structural position, and
 * says so, because that is a weaker guarantee.
 */

import ts from 'typescript'
import type {
  AttributeValue,
  ComponentCallNode,
  ElementNode,
  ReactIrNode,
  TextNode,
} from './nodes'
import type { Expression, ExpressionScope } from './expression'
import { splitClassString } from './classTokens'
import { MotionAnimationSchema, type MotionAnimation } from './motion'
import { Value } from '@core/utils/typeboxHelpers'

/** Motion props the reader recovers into the animation model. */
const MOTION_STATE_PROPS = new Set(['initial', 'animate', 'exit'])
const MOTION_GESTURE_PROPS = new Set([
  'whileHover', 'whileTap', 'whileFocus', 'whileDrag', 'whileInView',
])

/**
 * Read a JSON-compatible value out of a JSX expression.
 *
 * Motion targets are plain object and array literals, which is what makes them
 * recoverable at all. Anything computed returns null and the caller refuses it,
 * because a value assembled at runtime cannot be shown in the animation panel.
 */
function readJsonLike(node: ts.Expression): unknown | null {
  if (ts.isStringLiteral(node)) return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (node.kind === ts.SyntaxKind.NullKeyword) return null
  // A negative number is a prefix expression, not a numeric literal.
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const inner = readJsonLike(node.operand)
    return typeof inner === 'number' ? -inner : null
  }
  if (ts.isArrayLiteralExpression(node)) {
    const values: unknown[] = []
    for (const element of node.elements) {
      if (ts.isSpreadElement(element)) return null
      const value = readJsonLike(element)
      // null is a legitimate Motion keyframe wildcard, so distinguish it from
      // failure by checking the node kind rather than the returned value.
      if (value === null && element.kind !== ts.SyntaxKind.NullKeyword) return null
      values.push(value)
    }
    return values
  }
  if (ts.isObjectLiteralExpression(node)) {
    const result: Record<string, unknown> = {}
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) return null
      const key = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
        ? property.name.text
        : null
      if (key === null) return null
      const value = readJsonLike(property.initializer)
      if (value === null && property.initializer.kind !== ts.SyntaxKind.NullKeyword) return null
      result[key] = value
    }
    return result
  }
  return null
}

/**
 * Split a Motion variant back into target and transition.
 *
 * Motion nests the transition inside the variant; the model keeps them apart so the
 * panel can edit either without rewriting the other.
 */
function unflattenVariant(value: unknown): { target: Record<string, unknown>, transition?: unknown } {
  if (typeof value !== 'object' || value === null) return { target: {} }
  const { transition, ...target } = value as Record<string, unknown>
  return transition === undefined
    ? { target }
    : { target, transition }
}

export type ReadDiagnostic = Readonly<{
  /** Machine-readable reason, for tests and telemetry. */
  code:
    | 'spread-denied'
    | 'handler-denied'
    | 'inner-html-denied'
    | 'dynamic-expression-denied'
    | 'unresolved-component'
    | 'unsupported-syntax'
    | 'no-default-export'
  /** What to do about it, in the author's terms. */
  message: string
  line: number
  column: number
}>

export type ReadResult = Readonly<{
  nodes: Readonly<Record<string, ReactIrNode>>
  rootNodeId: string | null
  /**
   * Name of the exported component, so regenerating preserves it.
   *
   * Null when no named function was found. A caller must not substitute a placeholder:
   * renaming somebody's component as a side effect of an edit changes what their other
   * files import and makes every component indistinguishable in a stack trace.
   */
  symbol: string | null
  /**
   * Top-level statements that are neither imports nor the component itself.
   *
   * Preserved verbatim so regenerating does not delete a page's metadata export.
   */
  preamble: readonly string[]
  /**
   * The module's own import declarations, verbatim.
   *
   * Needed because a preserved statement can depend on an import the tree does not: keeping
   * `export const metadata: Metadata` while dropping `import type { Metadata } from 'next'`
   * leaves the file referencing a type that does not exist. The generator emits only the
   * ones it would not produce itself, so nothing is imported twice.
   */
  sourceImports: readonly string[]
  /** Anchors found in source, so a caller knows whether identity was preserved. */
  anchoredNodeIds: readonly string[]
  /**
   * Whether every node's identity came from an anchor. False means some nodes were
   * matched by position, which does not survive a developer reordering them.
   */
  fullyAnchored: boolean
  diagnostics: readonly ReadDiagnostic[]
}>

/** Scopes a member read may start from, mirroring the expression model. */
const KNOWN_SCOPES: Readonly<Record<string, ExpressionScope>> = {
  item: 'item',
  parentItem: 'parentItem',
  entry: 'entry',
  page: 'page',
  site: 'site',
  route: 'route',
  props: 'prop',
}

const ANCHOR_PATTERN = /@fuma\s+([A-Za-z0-9_-]+)/

type ReaderState = {
  readonly source: ts.SourceFile
  readonly nodes: Record<string, ReactIrNode>
  readonly diagnostics: ReadDiagnostic[]
  readonly anchored: string[]
  counter: number
}

function positionOf(state: ReaderState, node: ts.Node): { line: number, column: number } {
  const { line, character } = state.source.getLineAndCharacterOfPosition(node.getStart(state.source))
  return { line: line + 1, column: character }
}

function refuse(
  state: ReaderState,
  node: ts.Node,
  code: ReadDiagnostic['code'],
  message: string,
): void {
  const { line, column } = positionOf(state, node)
  state.diagnostics.push(Object.freeze({ code, message, line, column }))
}

/**
 * Claim an id for a node.
 *
 * An anchor is claimed by the element whose opening tag carried it, and claimed
 * immediately — before descending into children, or a child would take its
 * parent's identity. Nodes with no opening tag (text, expressions, outlets) never
 * carry an anchor and always get a positional id; they are identified by their
 * parent and position, which suffices because they have no attributes of their own
 * to reconcile.
 */
function claimId(state: ReaderState, prefix: string, anchor: string | null): string {
  if (anchor !== null) {
    state.anchored.push(anchor)
    return anchor
  }
  state.counter += 1
  return `${prefix}-${state.counter}`
}

/**
 * Find the anchor the generator placed inside the opening tag.
 *
 * It sits between the tag name and the first attribute, so it is the leading
 * trivia of the attributes node — not of the element, which is where a comment
 * written before the element would appear. Reading it from the tag keeps the
 * anchor valid JSX; a comment before the element would be a sibling of it.
 */
function readAnchorInTag(
  state: ReaderState,
  opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): string | null {
  // Scan the opening tag's own text, which is bounded and cannot pick up a
  // comment belonging to a neighbouring element.
  const text = opening.getText(state.source)
  const match = ANCHOR_PATTERN.exec(text)
  return match?.[1] ?? null
}

/** Convert a member access chain into a scope plus path, or null if unsupported. */
function readMemberChain(
  expression: ts.Expression,
): { scope: ExpressionScope, path: string[] } | null {
  const path: string[] = []
  let current: ts.Expression = expression
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    if (ts.isPropertyAccessExpression(current)) {
      path.unshift(current.name.text)
      current = current.expression
      continue
    }
    const argument = current.argumentExpression
    if (!ts.isStringLiteral(argument)) return null
    path.unshift(argument.text)
    current = current.expression
  }
  if (!ts.isIdentifier(current)) return null
  const scope = KNOWN_SCOPES[current.text]
  if (!scope || path.length === 0) return null
  return { scope, path }
}

/** Read a supported expression, or record why it was refused. */
function readExpression(state: ReaderState, expression: ts.Expression): Expression | null {
  if (ts.isStringLiteral(expression)) {
    return { kind: 'literal', value: expression.text }
  }
  if (ts.isNumericLiteral(expression)) {
    return { kind: 'literal', value: Number(expression.text) }
  }
  if (expression.kind === ts.SyntaxKind.TrueKeyword) {
    return { kind: 'literal', value: true }
  }
  if (expression.kind === ts.SyntaxKind.FalseKeyword) {
    return { kind: 'literal', value: false }
  }
  if (expression.kind === ts.SyntaxKind.NullKeyword) {
    return { kind: 'literal', value: null }
  }

  // `a ?? "fallback"` is how a member read with a fallback is emitted.
  if (
    ts.isBinaryExpression(expression)
    && expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
  ) {
    const chain = readMemberChain(expression.left)
    if (chain && ts.isStringLiteral(expression.right)) {
      return {
        kind: 'member',
        scope: chain.scope,
        path: chain.path,
        format: 'text',
        fallback: expression.right.text,
      }
    }
  }

  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    const chain = readMemberChain(expression)
    if (chain) {
      return { kind: 'member', scope: chain.scope, path: chain.path, format: 'text' }
    }
    refuse(
      state,
      expression,
      'dynamic-expression-denied',
      'Reads must start from a known scope: item, parentItem, entry, page, site, route or props.',
    )
    return null
  }

  if (ts.isConditionalExpression(expression)) {
    const chain = readMemberChain(
      ts.isBinaryExpression(expression.condition) ? expression.condition.left : expression.condition,
    )
    const whenTrue = readExpression(state, expression.whenTrue)
    const whenFalse = readExpression(state, expression.whenFalse)
    if (!chain || !whenTrue || !whenFalse) return null

    if (ts.isBinaryExpression(expression.condition)) {
      const operator = expression.condition.operatorToken.kind
      const right = expression.condition.right
      const value = ts.isStringLiteral(right)
        ? right.text
        : ts.isNumericLiteral(right)
          ? Number(right.text)
          : null
      return {
        kind: 'conditional',
        test: {
          scope: chain.scope,
          path: chain.path,
          operator: operator === ts.SyntaxKind.ExclamationEqualsEqualsToken
            ? 'notEquals'
            : 'equals',
          value,
        },
        whenTrue,
        whenFalse,
      }
    }

    return {
      kind: 'conditional',
      test: { scope: chain.scope, path: chain.path, operator: 'exists' },
      whenTrue,
      whenFalse,
    }
  }

  if (ts.isTemplateExpression(expression)) {
    const quasis: string[] = [expression.head.text]
    const parts: Expression[] = []
    for (const span of expression.templateSpans) {
      const chain = readMemberChain(span.expression)
      if (!chain) {
        refuse(
          state,
          span.expression,
          'dynamic-expression-denied',
          'A template may only interpolate a read from a known scope. '
          + 'For a class name, use a finite map of complete class strings instead.',
        )
        return null
      }
      parts.push({ kind: 'member', scope: chain.scope, path: chain.path, format: 'text' })
      quasis.push(span.literal.text)
    }
    if (parts.length === 0) return { kind: 'literal', value: quasis.join('') }
    return {
      kind: 'template',
      quasis,
      parts: parts as never,
    }
  }

  if (ts.isCallExpression(expression)) {
    refuse(
      state,
      expression,
      'handler-denied',
      'A call cannot be previewed without running it. Move the logic into a code '
      + 'component and expose the result as a prop.',
    )
    return null
  }

  refuse(state, expression, 'unsupported-syntax', 'This expression form is not editable.')
  return null
}

/** Read the attributes of an element or component call. */
function readAttributes(
  state: ReaderState,
  attributes: ts.JsxAttributes,
): {
  bag: Record<string, AttributeValue>
  classTokens: string[]
  animation?: MotionAnimation
  style?: Record<string, string>
} {
  const bag: Record<string, AttributeValue> = {}
  const classTokens: string[] = []
  let style: Record<string, string> | undefined
  const motion: Record<string, unknown> = {}
  const gestures: Record<string, unknown> = {}

  for (const attribute of attributes.properties) {
    if (ts.isJsxSpreadAttribute(attribute)) {
      refuse(
        state,
        attribute,
        'spread-denied',
        'A spread hides which props exist, so the property panel cannot show them. '
        + 'List the props explicitly.',
      )
      continue
    }
    if (!ts.isJsxAttribute(attribute)) continue

    const name = attribute.name.getText(state.source)
    if (name === 'dangerouslySetInnerHTML') {
      refuse(
        state,
        attribute,
        'inner-html-denied',
        'Raw HTML cannot be modelled. Use a code component for this region.',
      )
      continue
    }
    if (/^on[A-Z]/.test(name)) {
      refuse(
        state,
        attribute,
        'handler-denied',
        'Event handlers are not editable here. Move the behaviour into a code component.',
      )
      continue
    }

    if (name === 'className') {
      const initializer = attribute.initializer
      if (initializer && ts.isStringLiteral(initializer)) {
        // Bracket-aware: an arbitrary value may contain a space, so
        // `bg-[url('a b.png')]` is one token rather than two.
        classTokens.push(...splitClassString(initializer.text))
        continue
      }
      refuse(
        state,
        attribute,
        'dynamic-expression-denied',
        'A class list must be a complete literal string so Tailwind can see it.',
      )
      continue
    }

    // The style escape hatch is recovered into its own field rather than the
    // attribute bag. Without this a hand-written style attribute would be dropped on
    // the next generate, silently changing the page.
    if (name === 'style') {
      const initializer = attribute.initializer
      // A style object containing a custom property carries an `as CSSProperties`
      // cast, because React's type does not admit one. Unwrap it before reading.
      let styleExpression = initializer && ts.isJsxExpression(initializer)
        ? initializer.expression
        : undefined
      while (styleExpression
        && (ts.isAsExpression(styleExpression) || ts.isParenthesizedExpression(styleExpression))) {
        styleExpression = styleExpression.expression
      }
      if (styleExpression && ts.isObjectLiteralExpression(styleExpression)) {
        const declarations: Record<string, string> = {}
        let readable = true
        for (const property of styleExpression.properties) {
          if (!ts.isPropertyAssignment(property)) { readable = false; break }
          const key = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
            ? property.name.text
            : null
          if (key === null || !ts.isStringLiteral(property.initializer)) {
            readable = false
            break
          }
          declarations[key] = property.initializer.text
        }
        if (readable) {
          style = declarations
          continue
        }
      }
      refuse(
        state,
        attribute,
        'dynamic-expression-denied',
        'A style attribute must be an object of literal strings so the panel can show and '
        + 'edit each declaration. Move anything computed into a code component.',
      )
      continue
    }

    // Motion props are recovered into the animation model rather than the
    // attribute bag, so a hand edit to an animation reaches the panel instead of
    // being preserved as an opaque prop nobody can see.
    if (MOTION_STATE_PROPS.has(name) || MOTION_GESTURE_PROPS.has(name)
      || name === 'transition' || name === 'variants' || name === 'viewport'
      || name === 'layout' || name === 'layoutId' || name === 'drag') {
      const target = MOTION_GESTURE_PROPS.has(name) ? gestures : motion
      const key = name === 'viewport' ? 'inView' : name
      const initializer = attribute.initializer

      if (!initializer) {
        // A bare prop is boolean true, as in `layout`.
        target[key] = true
        continue
      }
      if (ts.isStringLiteral(initializer)) {
        target[key] = initializer.text
        continue
      }
      if (ts.isJsxExpression(initializer) && initializer.expression) {
        const value = readJsonLike(initializer.expression)
        if (value === null && initializer.expression.kind !== ts.SyntaxKind.NullKeyword) {
          refuse(
            state,
            attribute,
            'dynamic-expression-denied',
            `The ${name} value is computed, so the animation panel cannot show or edit it. `
            + 'Use a literal object, or move the animation into a code component.',
          )
          continue
        }
        target[key] = value
        continue
      }
      continue
    }

    const initializer = attribute.initializer
    if (!initializer) {
      bag[name] = { kind: 'expression', expression: { kind: 'literal', value: true } }
      continue
    }
    if (ts.isStringLiteral(initializer)) {
      bag[name] = { kind: 'expression', expression: { kind: 'literal', value: initializer.text } }
      continue
    }
    if (ts.isJsxExpression(initializer) && initializer.expression) {
      const expression = readExpression(state, initializer.expression)
      if (expression) bag[name] = { kind: 'expression', expression }
    }
  }

  // Rebuild the animation only when something was found, so an unanimated element
  // does not acquire an empty animation object that would then clientize its module.
  let animation: MotionAnimation | undefined
  if (Object.keys(motion).length > 0 || Object.keys(gestures).length > 0) {
    const candidate: Record<string, unknown> = { ...motion }
    if (candidate['variants'] && typeof candidate['variants'] === 'object') {
      candidate['variants'] = Object.fromEntries(
        Object.entries(candidate['variants'] as Record<string, unknown>)
          .map(([variantName, value]) => [variantName, unflattenVariant(value)]),
      )
    }
    if (Object.keys(gestures).length > 0) {
      candidate['gestures'] = Object.fromEntries(
        Object.entries(gestures).map(([gesture, value]) => [
          gesture,
          typeof value === 'string' ? value : unflattenVariant(value),
        ]),
      )
    }
    if (Value.Check(MotionAnimationSchema, candidate)) {
      animation = candidate
    } else {
      refuse(
        state,
        attributes,
        'unsupported-syntax',
        'The Motion props on this element do not form an animation the panel can edit. '
        + 'Check the transition and variant shapes.',
      )
    }
  }

  return { bag, classTokens, animation, ...(style ? { style } : {}) }
}

/** True when a JSX tag names a component rather than an intrinsic element. */
function isComponentTag(tagName: string): boolean {
  return /^[A-Z]/.test(tagName)
}

/**
 * Read a JSX child, appending nodes to state and returning its id.
 *
 * Returns null for content that produced no node — whitespace, or something
 * refused. A refusal has already been recorded by the time this returns.
 */
function readChild(
  state: ReaderState,
  child: ts.JsxChild,
  imports: ReadonlyMap<string, string>,
): string | null {
  if (ts.isJsxText(child)) {
    const value = child.text.trim()
    if (value.length === 0) return null
    const id = claimId(state, 'text', null)
    const node: TextNode = { kind: 'text', id, value, children: [] }
    state.nodes[id] = node
    return id
  }

  if (ts.isJsxExpression(child)) {
    if (!child.expression) return null

    // The outlet position, in both forms a layout can be written.
    //
    // `{props.children}` is what the generator emits, because the signature it produces takes
    // a `props` parameter and a bare identifier would resolve to nothing. `{children}` is what
    // a developer writes when they destructure. Recognising only one of them means a round
    // trip turns the outlet into an ordinary expression, and the module then looks like a
    // layout with no outlet — which is the exact defect reviewLayout exists to catch.
    if (isOutletExpression(child.expression)) {
      const id = claimId(state, 'outlet', null)
      state.nodes[id] = { kind: 'outlet', id, children: [] }
      return id
    }

    const expression = readExpression(state, child.expression)
    if (!expression) return null
    const id = claimId(state, 'expr', null)
    state.nodes[id] = { kind: 'expression', id, expression, children: [] }
    return id
  }

  if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
    return readElement(state, child, imports)
  }

  if (ts.isJsxFragment(child)) {
    // A fragment carries no identity of its own; its children belong to the
    // parent, which keeps the tree shape the builder shows honest.
    for (const inner of child.children) readChild(state, inner, imports)
    return null
  }

  return null
}

function readElement(
  state: ReaderState,
  element: ts.JsxElement | ts.JsxSelfClosingElement,
  imports: ReadonlyMap<string, string>,
): string | null {
  const opening = ts.isJsxElement(element) ? element.openingElement : element
  const rawTagName = opening.tagName.getText(state.source)
  // `motion.section` is the animated form of `section`. Unwrapping it restores the
  // plain tag so the node models the element it renders, with the animation held
  // separately — the generator puts the prefix back on the way out.
  const isMotionTag = rawTagName.startsWith('motion.')
  const tagName = isMotionTag ? rawTagName.slice('motion.'.length) : rawTagName
  const isComponent = isComponentTag(tagName)
  // Claimed before children are read, so a child cannot take this element's id.
  const id = claimId(state, isComponent ? 'component' : 'element', readAnchorInTag(state, opening))
  const { bag, classTokens, animation, style } = readAttributes(state, opening.attributes)

  const childIds: string[] = []
  if (ts.isJsxElement(element)) {
    for (const child of element.children) {
      const id = readChild(state, child, imports)
      if (id) childIds.push(id)
    }
  }

  if (isComponent) {
    const source = imports.get(tagName)
    if (!source) {
      refuse(
        state,
        opening,
        'unresolved-component',
        `${tagName} has no traceable import, so the builder cannot resolve what it renders.`,
      )
      return null
    }
    const node: ComponentCallNode = {
      kind: 'component',
      id,
      component: { id: `${source}#${tagName}`, symbol: tagName, source },
      props: bag,
      slots: {},
      classTokens,
      ...(animation ? { animation } : {}),
      children: childIds,
    }
    state.nodes[id] = node
    return id
  }

  const node: ElementNode = {
    kind: 'element',
    id,
    tag: tagName,
    attributes: bag,
    classTokens,
    ...(animation ? { animation } : {}),
    ...(style ? { style } : {}),
    children: childIds,
  }
  state.nodes[id] = node
  return id
}

/** Map imported symbol to its module specifier, so components can be resolved. */
function collectImports(source: ts.SourceFile): ReadonlyMap<string, string> {
  const imports = new Map<string, string>()
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
    const specifier = statement.moduleSpecifier.text
    const bindings = statement.importClause?.namedBindings
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        imports.set(element.name.text, specifier)
      }
    }
    if (statement.importClause?.name) {
      imports.set(statement.importClause.name.text, specifier)
    }
  }
  return imports
}

/** Whether a JSX expression is the outlet, written either way. */
function isOutletExpression(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) return expression.text === 'children'
  return ts.isPropertyAccessExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === 'props'
    && expression.name.text === 'children'
}

/**
 * Collect top-level statements the IR does not model, verbatim.
 *
 * Excludes imports, because the generator computes those from the tree and emitting them
 * from both sources would duplicate every one. Excludes the component itself, because that
 * is what the tree represents. Everything else — a metadata export, a route segment config,
 * a type alias, a helper — is kept as text so a regenerate cannot delete it.
 */
function collectPreamble(
  source: ts.SourceFile,
  componentSymbol: string | null,
): readonly string[] {
  const kept: string[] = []
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) continue
    if (declaresComponent(statement, componentSymbol)) continue
    kept.push(statement.getText(source).trim())
  }
  return Object.freeze(kept)
}

/** The module's import declarations, verbatim. */
function collectSourceImports(source: ts.SourceFile): readonly string[] {
  return Object.freeze(source.statements
    .filter((statement) => ts.isImportDeclaration(statement))
    .map((statement) => statement.getText(source).trim()))
}

/** Whether a statement is the component the tree came from. */
function declaresComponent(statement: ts.Statement, symbol: string | null): boolean {
  const isDefaultExport = ts.canHaveModifiers(statement)
    && (ts.getModifiers(statement) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
    )
  if (ts.isFunctionDeclaration(statement)) {
    // An anonymous default export has no name to compare, so the default modifier decides.
    if (isDefaultExport) return true
    return symbol !== null && statement.name?.text === symbol
  }
  if (ts.isVariableStatement(statement)) {
    const declaration = statement.declarationList.declarations[0]
    return symbol !== null
      && declaration !== undefined
      && ts.isIdentifier(declaration.name)
      && declaration.name.text === symbol
  }
  return false
}

/**
 * Whether a path is a Next route file, which must default-export its component.
 *
 * Derived from the filename rather than configured, because Next's own conventions
 * decide it and a list we maintain separately would drift from them.
 */
function isRouteFile(path: string): boolean {
  return /(^|\/)(page|layout|template|error|loading|not-found|default)\.tsx$/.test(path)
}

/**
 * Name of a statement that declares a component, for the named-export fallback.
 *
 * Covers both `function Hero()` and `const Hero = () => ...`, because component files
 * are written both ways and losing the name in either case renames the component.
 */
function namedFunctionOf(statement: ts.Statement): string | null {
  if (ts.isFunctionDeclaration(statement)) return statement.name?.text ?? null
  if (ts.isVariableStatement(statement)) {
    const declaration = statement.declarationList.declarations[0]
    if (declaration && ts.isIdentifier(declaration.name)) return declaration.name.text
  }
  return null
}

/** Find the JSX returned by the module's default export. */
function findReturnedJsx(
  source: ts.SourceFile,
): {
  jsx: ts.JsxElement | ts.JsxSelfClosingElement | null
  fromDefaultExport: boolean
  symbol: string | null
} {
  let found: ts.JsxElement | ts.JsxSelfClosingElement | null = null

  const visit = (node: ts.Node): void => {
    if (found) return
    if (ts.isReturnStatement(node) && node.expression) {
      let expression: ts.Expression = node.expression
      // `return ( ... )` wraps the element in parentheses.
      while (ts.isParenthesizedExpression(expression)) expression = expression.expression
      if (ts.isJsxElement(expression) || ts.isJsxSelfClosingElement(expression)) {
        found = expression
        return
      }
      if (ts.isJsxFragment(expression)) {
        const first = expression.children.find(
          (child) => ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child),
        )
        if (first) found = first as ts.JsxElement | ts.JsxSelfClosingElement
        return
      }
    }
    ts.forEachChild(node, visit)
  }

  for (const statement of source.statements) {
    const isDefaultExport = ts.isFunctionDeclaration(statement)
      && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
    if (isDefaultExport) {
      visit(statement)
      if (found) {
        return {
          jsx: found,
          fromDefaultExport: true,
          // `export default function () {}` is legal and anonymous, hence the null.
          symbol: ts.isFunctionDeclaration(statement) ? statement.name?.text ?? null : null,
        }
      }
    }
  }

  // Fall back to any statement so a component file with a named export can still be
  // read — but report it, because a module without a default export is not something
  // a route can render, and silently accepting it would hide that.
  for (const statement of source.statements) {
    visit(statement)
    if (found) {
      return { jsx: found, fromDefaultExport: false, symbol: namedFunctionOf(statement) }
    }
  }
  return { jsx: found, fromDefaultExport: false, symbol: null }
}

/**
 * Read a TSX module into IR nodes.
 *
 * Always returns a result. A file the reader cannot handle yields diagnostics and
 * a null root rather than a throw, because the caller's job is to show the author
 * what stopped it, not to crash.
 */
export function readModuleSource(path: string, source: string): ReadResult {
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
  const state: ReaderState = {
    source: parsed,
    nodes: {},
    diagnostics: [],
    anchored: [],
    counter: 0,
  }

  const imports = collectImports(parsed)
  const { jsx, fromDefaultExport, symbol } = findReturnedJsx(parsed)
  const preamble = collectPreamble(parsed, symbol)
  const sourceImports = collectSourceImports(parsed)
  if (!jsx) {
    state.diagnostics.push(Object.freeze({
      code: 'no-default-export' as const,
      message: 'No default-exported component returning JSX was found.',
      line: 1,
      column: 0,
    }))
    return Object.freeze({
      nodes: Object.freeze({}),
      rootNodeId: null,
      symbol,
      preamble,
      sourceImports,
      anchoredNodeIds: Object.freeze([]),
      fullyAnchored: false,
      diagnostics: Object.freeze(state.diagnostics),
    })
  }

  // Only a route file needs a default export. Next requires one for page.tsx and
  // layout.tsx and nothing can render them without it, but a component file exporting
  // `export function Hero()` is entirely ordinary — it is shadcn's own convention — so
  // demanding one there would refuse the components the engine is meant to build with.
  if (!fromDefaultExport && isRouteFile(path)) {
    state.diagnostics.push(Object.freeze({
      code: 'no-default-export' as const,
      message:
        `${path} is a route file, so it must default-export its component or nothing `
        + 'can render it. A component file may use a named export instead.',
      line: 1,
      column: 0,
    }))
  }

  const rootNodeId = readElement(state, jsx, imports)
  const nodeCount = Object.keys(state.nodes).length

  return Object.freeze({
    nodes: Object.freeze({ ...state.nodes }),
    rootNodeId,
    anchoredNodeIds: Object.freeze([...state.anchored]),
    // Every node anchored means identity survives reformatting and reordering.
    // Anything less and reconciliation falls back to position, which does not.
    symbol,
    preamble,
    sourceImports,
    fullyAnchored: nodeCount > 0 && state.anchored.length === nodeCount,
    diagnostics: Object.freeze(state.diagnostics),
  })
}

/**
 * React IR → typed TSX.
 *
 * Generation is a translation, not a rendering: every IR node kind states what it
 * becomes, so nothing here has to infer intent. That is the whole point of the
 * node union.
 *
 * Two properties matter more than elegance.
 *
 * **Determinism.** The same module must produce byte-identical output every time.
 * Attribute order, import order and indentation are all fixed, because a diff a
 * person can review is what makes generated code trustworthy, and because
 * regeneration must not churn a repository. Anything derived from object key
 * iteration order is sorted first.
 *
 * **Anchoring.** Emitting source is easy; matching a later edit back to the node
 * that produced it is the hard half. Each generated element records its span in a
 * sidecar map, and `anchorComments` can additionally place an identifier in the
 * source itself. Comments survive reformatting where spans do not, so they are the
 * right tool when a developer edits heavily — but they are opt-in, because they add
 * noise to output that most projects will not want.
 *
 * Escaping is React's job. Values go in raw and JSX escapes them, which is why the
 * legacy pre-escaped props cannot be reused here: passing them through would
 * double-escape and show entities to visitors.
 */

import {
  animationOf,
  childIdsOf,
  classTokensOf,
  hasClassTokens,
  type ComponentCallNode,
  type ElementNode,
  type ExpressionNode,
  type OpaqueCodeNode,
  type ReactIrModule,
  type ReactIrNode,
  type RepeatNode,
  type SlotDeclarationNode,
} from './nodes'
import {
  isConditionalExpression,
  isLiteralExpression,
  isMemberExpression,
  isTemplateExpression,
  type Expression,
} from './expression'
import { requiresClient, requiresPresence, type MotionAnimation } from './motion'
import { prepareProp } from './escaping'

export type SourceAnchor = Readonly<{
  nodeId: string
  /** One-based line where the node's element begins. */
  line: number
  /** Zero-based column where the node's element begins. */
  column: number
}>

export type GeneratedModule = Readonly<{
  /** Repository-relative path the file belongs at. */
  path: string
  /** Complete file contents. */
  code: string
  /**
   * Where each node landed, so an edit can be traced back to the node that
   * produced it without re-parsing.
   */
  anchors: readonly SourceAnchor[]
  /** Module specifiers imported, for dependency reconciliation. */
  imports: readonly string[]
}>

export type GenerateOptions = Readonly<{
  /**
   * Place `{/* @fuma <id> *\/}` before each element. Off by default: it survives
   * reformatting where a span does not, but it is visible in the source and most
   * projects would rather have clean output than belt-and-braces anchoring.
   */
  anchorComments?: boolean
  /** Indent unit. Two spaces unless a project says otherwise. */
  indent?: string
}>

const DEFAULT_INDENT = '  '

/** Scopes that resolve to a variable the generated component has in hand. */
const SCOPE_IDENTIFIERS: Readonly<Record<string, string>> = {
  item: 'item',
  parentItem: 'parentItem',
  entry: 'entry',
  page: 'page',
  site: 'site',
  route: 'route',
  prop: 'props',
}

/** JSX text that must be wrapped in an expression container to stay literal. */
function needsExpressionContainer(value: string): boolean {
  return /[{}<>]/.test(value)
}

function quote(value: string): string {
  // Prefer double quotes for JSX attribute values, matching the ecosystem
  // default, falling back to single when the value contains one.
  return value.includes('"') ? `'${value.replace(/'/g, "\\'")}'` : `"${value}"`
}

/**
 * Module specifiers use single quotes throughout, matching the repository style,
 * so a regenerated file never differs from a hand-edited one by quoting alone.
 */
function quoteSpecifier(specifier: string): string {
  return `'${specifier.replace(/'/g, "\\'")}'`
}

/** Render an expression as TSX source. */
export function expressionToSource(expression: Expression): string {
  if (isLiteralExpression(expression)) {
    if (expression.value === null) return 'null'
    if (typeof expression.value === 'string') return quote(expression.value)
    return String(expression.value)
  }

  if (isMemberExpression(expression)) {
    const root = SCOPE_IDENTIFIERS[expression.scope] ?? expression.scope
    const access = expression.path.map((segment) => (
      /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment) ? `.${segment}` : `[${quote(segment)}]`
    )).join('')
    const read = `${root}${access}`
    // A fallback is a literal, so `??` is safe: it cannot itself fail to resolve.
    return expression.fallback === undefined
      ? read
      : `${read} ?? ${expression.fallback === null ? 'null' : quote(expression.fallback)}`
  }

  if (isTemplateExpression(expression)) {
    let out = '`'
    for (const [index, quasi] of expression.quasis.entries()) {
      out += quasi.replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
      const part = expression.parts[index]
      if (part) out += `\${${expressionToSource(part)}}`
    }
    return `${out}\``
  }

  if (isConditionalExpression(expression)) {
    const root = SCOPE_IDENTIFIERS[expression.test.scope] ?? expression.test.scope
    const read = `${root}.${expression.test.path.join('.')}`
    const literal = (value: unknown): string => (
      typeof value === 'string' ? quote(value) : String(value)
    )
    let test: string
    switch (expression.test.operator) {
      case 'equals':
        test = `${read} === ${literal(expression.test.value)}`
        break
      case 'notEquals':
        test = `${read} !== ${literal(expression.test.value)}`
        break
      case 'empty':
        test = `!${read}`
        break
      case 'exists':
      default:
        test = read
    }
    return `${test} ? ${expressionToSource(expression.whenTrue)} : ${expressionToSource(expression.whenFalse)}`
  }

  // The union is exhaustive; this keeps a future kind from emitting silently.
  throw new Error(`[react-ir] cannot generate source for expression kind`)
}

/** A writer that tracks line and column so anchors are exact. */
class SourceWriter {
  #parts: string[] = []
  #line = 1
  #column = 0

  get line(): number { return this.#line }
  get column(): number { return this.#column }

  write(text: string): void {
    this.#parts.push(text)
    const newlineIndex = text.lastIndexOf('\n')
    if (newlineIndex === -1) {
      this.#column += text.length
      return
    }
    this.#line += text.split('\n').length - 1
    this.#column = text.length - newlineIndex - 1
  }

  line_(text = ''): void {
    this.write(`${text}\n`)
  }

  toString(): string {
    return this.#parts.join('')
  }
}

type EmitContext = Readonly<{
  module: ReactIrModule
  writer: SourceWriter
  anchors: SourceAnchor[]
  imports: Set<string>
  options: Required<GenerateOptions>
}>

/**
 * Attributes whose value the browser resolves as a URL, so a scheme in them is executable.
 *
 * A CLOSED SET rather than a heuristic on the name: matching anything containing 'href' or 'src'
 * would also catch a `data-src` a component reads as ordinary text, and rewriting that to '#' would
 * break working markup. Adding one is a visible act.
 */
const URL_BEARING_ATTRIBUTES = new Set([
  'href', 'src', 'action', 'formAction', 'poster', 'cite', 'data', 'srcDoc',
])

function attributeSource(
  context: EmitContext,
  name: string,
  value: { kind: 'expression', expression: Expression } | { kind: 'nodes', children: readonly string[] },
): string | null {
  if (value.kind === 'nodes') {
    // A node-valued prop becomes a fragment expression, which is how a component
    // receives structured content through a named prop rather than children.
    const inner = value.children
      .map((childId) => emitInline(context, childId))
      .filter((part) => part.length > 0)
      .join('')
    return inner.length === 0 ? null : `${name}={<>${inner}</>}`
  }

  const expression = value.expression
  // A literal string is the one case that reads better unbraced.
  if (isLiteralExpression(expression) && typeof expression.value === 'string') {
    // Task 62's consumption point. A URL-bearing attribute is validated rather than emitted
    // verbatim: React 19 blocks `javascript:` itself (measured), but `vbscript:` and every `data:`
    // URL render through unchanged - and `data:text/html,<script>` is a real execution vector. This
    // is the LAST place a refusal can happen, because after this the string is in a file we shipped.
    if (URL_BEARING_ATTRIBUTES.has(name)) {
      const prepared = prepareProp(expression.value, 'url')
      // REFUSED_URL is '#': a link that goes nowhere rather than one that runs code.
      return `${name}=${quote(prepared.value)}`
    }
    return `${name}=${quote(expression.value)}`
  }
  if (isLiteralExpression(expression) && expression.value === true) {
    return name
  }
  return `${name}={${expressionToSource(expression)}}`
}

/** Emit a node inline, used for node-valued props where layout does not matter. */
function emitInline(context: EmitContext, nodeId: string): string {
  const node = context.module.nodes[nodeId]
  if (!node) return ''
  if (node.kind === 'text') {
    return needsExpressionContainer(node.value) ? `{${quote(node.value)}}` : node.value
  }
  if (node.kind === 'expression') {
    return `{${expressionToSource(node.expression)}}`
  }
  // Anything structural inside a prop is emitted through the same path, without
  // indentation tracking; the sidecar anchor for it would not be meaningful.
  const nested = new SourceWriter()
  emitNode({ ...context, writer: nested }, nodeId, 0)
  return nested.toString().trim()
}

function openTagAttributes(context: EmitContext, node: ReactIrNode): string[] {
  const attributes: string[] = []
  const classTokens = classTokensOf(node)
  if (classTokens.length > 0) {
    attributes.push(`className=${quote(classTokens.join(' '))}`)
  }

  const animation = animationOf(node)
  if (animation) attributes.push(...motionProps(animation))

  const bag = node.kind === 'element'
    ? (node as ElementNode).attributes
    : node.kind === 'component'
      ? (node as ComponentCallNode).props
      : node.kind === 'opaque'
        ? (node as OpaqueCodeNode).props
        : undefined

  // Sorted so output does not depend on object key insertion order.
  for (const name of Object.keys(bag ?? {}).sort()) {
    const value = (bag ?? {})[name]
    if (!value) continue
    const rendered = attributeSource(context, name, value)
    if (rendered) attributes.push(rendered)
  }

  if (node.kind === 'element' && (node as ElementNode).style) {
    const style = (node as ElementNode).style ?? {}
    // A custom property like `--offset` is not a valid JavaScript identifier, so an
    // unquoted key is a syntax error. Quote anything that is not a plain identifier.
    const entries = Object.keys(style).sort().map((key) => {
      const safeKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : quote(key)
      return `${safeKey}: ${quote(style[key] ?? '')}`
    })
    if (entries.length > 0) {
      // React's CSSProperties does not admit custom properties, so a style object
      // containing one needs the cast or the file will not compile. Only added when
      // it is actually needed, to keep ordinary style objects fully typed.
      const hasCustomProperty = Object.keys(style).some((key) => key.startsWith('--'))
      if (hasCustomProperty) context.imports.add('react')
      const cast = hasCustomProperty ? ' as CSSProperties' : ''
      attributes.push(`style={{ ${entries.join(', ')} }${cast}}`)
    }
  }

  return attributes
}

/**
 * Serialise a Motion animation into JSX props.
 *
 * Emitted in Motion's own vocabulary — `initial`, `animate`, `exit`, `transition`,
 * `variants` and the `while*` gestures — so the value set in the panel is the value
 * that appears in source, and the reader can recover it without translation.
 *
 * Objects go through JSON so a colour string, a keyframe array or a nested
 * transition survives exactly rather than being reassembled by string building.
 */
function motionProps(animation: MotionAnimation): readonly string[] {
  const props: string[] = []
  const literal = (value: unknown): string => JSON.stringify(value)

  const state = (name: string, value: unknown): void => {
    if (value === undefined) return
    if (typeof value === 'string') {
      props.push(`${name}=${quote(value)}`)
      return
    }
    props.push(`${name}={${literal(value)}}`)
  }

  state('initial', animation.initial)
  state('animate', animation.animate)
  state('exit', animation.exit)
  if (animation.transition) props.push(`transition={${literal(animation.transition)}}`)
  if (animation.variants) {
    // Motion's variants are name -> target with transition folded in, a flatter
    // shape than the model stores.
    const flattened = Object.fromEntries(
      Object.entries(animation.variants).map(([variantName, variantState]) => [
        variantName,
        variantState.transition
          ? { ...variantState.target, transition: variantState.transition }
          : variantState.target,
      ]),
    )
    props.push(`variants={${literal(flattened)}}`)
  }
  for (const [gesture, value] of Object.entries(animation.gestures ?? {}).sort()) {
    if (typeof value === 'string') {
      props.push(`${gesture}=${quote(value)}`)
      continue
    }
    const target = value.transition
      ? { ...value.target, transition: value.transition }
      : value.target
    props.push(`${gesture}={${literal(target)}}`)
  }
  // `viewport` configures the in-view trigger, so without `whileInView` it does
  // nothing. Emitting it anyway would suggest the options were applied.
  if (animation.inView && animation.gestures?.whileInView !== undefined) {
    props.push(`viewport={${literal(animation.inView)}}`)
  }
  if (animation.layout !== undefined) {
    props.push(animation.layout === true ? 'layout' : `layout=${quote(String(animation.layout))}`)
  }
  if (animation.layoutId) props.push(`layoutId=${quote(animation.layoutId)}`)
  if (animation.drag !== undefined) {
    props.push(animation.drag === true ? 'drag' : `drag=${quote(String(animation.drag))}`)
  }

  return props
}

function recordAnchor(context: EmitContext, nodeId: string): void {
  context.anchors.push(Object.freeze({
    nodeId,
    line: context.writer.line,
    column: context.writer.column,
  }))
}

function emitChildren(context: EmitContext, ids: readonly string[], depth: number): void {
  for (const childId of ids) emitNode(context, childId, depth)
}

function emitNode(context: EmitContext, nodeId: string, depth: number): void {
  const node = context.module.nodes[nodeId]
  if (!node) return
  const { writer, options } = context
  const pad = options.indent.repeat(depth)

  switch (node.kind) {
    case 'text': {
      const value = needsExpressionContainer(node.value) ? `{${quote(node.value)}}` : node.value
      writer.write(pad)
      recordAnchor(context, node.id)
      writer.line_(value)
      return
    }

    case 'expression': {
      writer.write(pad)
      recordAnchor(context, node.id)
      writer.line_(`{${expressionToSource((node as ExpressionNode).expression)}}`)
      return
    }

    case 'outlet': {
      writer.write(pad)
      recordAnchor(context, node.id)
      // `props.children`, not a bare `children`. The signature this module emits is
      // `(props: XProps)`, so a bare identifier resolves to nothing — TS2304 "Cannot find
      // name 'children'", which made EVERY generated layout fail to compile.
      writer.line_('{props.children}')
      return
    }

    case 'slot': {
      const slot = node as SlotDeclarationNode
      writer.write(pad)
      recordAnchor(context, node.id)
      const fallback = slot.fallbackChildren ?? []
      if (fallback.length === 0) {
        writer.line_(`{props.${slot.name}}`)
        return
      }
      // A declared fallback renders when the caller passes nothing.
      writer.line_(`{props.${slot.name} ?? (`)
      emitChildren(context, fallback, depth + 1)
      writer.line_(`${pad})}`)
      return
    }

    case 'repeat': {
      const repeat = node as RepeatNode
      // An optional collection prop needs the empty case handled, or `.map` is a
      // type error under strict mode and a crash without it. A required prop does
      // not, and adding the guard anyway would suggest it might be missing.
      const sourceField = (context.module.propsInterface ?? [])
        .find((field) => field.name === repeat.source.id)
      const collection = sourceField?.required
        ? `props.${repeat.source.id}`
        : `(props.${repeat.source.id} ?? [])`
      writer.write(pad)
      recordAnchor(context, node.id)

      // A reorder group owns the ordered values and the change handler, so it wraps
      // the map rather than replacing it.
      const reorder = repeat.reorder
      if (reorder) {
        // A reorder group is controlled: it reports a new order and something has to
        // persist it. Generating a handler would be inventing application behaviour,
        // so the module must declare one — refusing here beats emitting a file that
        // references an undefined name.
        const hasHandler = (context.module.propsInterface ?? []).some(
          (field) => field.name === 'onReorder' && field.type === 'handler',
        )
        if (!hasHandler) {
          throw new Error(
            `Node "${node.id}" renders a reorder group, which reports a new order that `
            + 'something must persist. Declare a prop named "onReorder" of type "handler" '
            + `on ${context.module.path}.`,
          )
        }
        context.imports.add('motion/react')
        const groupAttributes = [
          `axis=${quote(reorder.axis)}`,
          ...(reorder.as ? [`as=${quote(reorder.as)}`] : []),
          // Copied because Motion mutates the order it is given, and the prop is
          // readonly so the site cannot be surprised by that.
          `values={[...${collection}]}`,
          'onReorder={props.onReorder}',
        ]
        writer.line_(`<Reorder.Group ${groupAttributes.join(' ')}>`)
        writer.write(`${pad}${options.indent}`)
      }

      writer.line_(`{${collection}.map((item, index) => (`)
      const variants = repeat.variants
      if (variants.length === 1) {
        // One body: emit it directly with the key on a wrapping fragment.
        writer.line_(`${pad}${options.indent}<Fragment key={String(item[${quote(repeat.key)}])}>`)
        emitChildren(context, variants, depth + 2)
        writer.line_(`${pad}${options.indent}</Fragment>`)
        context.imports.add('react')
      } else {
        // Several bodies cycle across rows, preserving the legacy round-robin.
        writer.line_(`${pad}${options.indent}<Fragment key={String(item[${quote(repeat.key)}])}>`)
        variants.forEach((variantId, position) => {
          const branch = position === 0 ? 'if' : 'else if'
          writer.line_(`${pad}${options.indent.repeat(2)}{/* ${branch} index % ${variants.length} === ${position} */}`)
          writer.line_(`${pad}${options.indent.repeat(2)}{index % ${variants.length} === ${position} && (`)
          emitChildren(context, [variantId], depth + 4)
          writer.line_(`${pad}${options.indent.repeat(2)})}`)
        })
        writer.line_(`${pad}${options.indent}</Fragment>`)
        context.imports.add('react')
      }
      writer.line_(`${pad}${reorder ? options.indent : ''}))}`)
      if (reorder) writer.line_(`${pad}</Reorder.Group>`)
      return
    }

    case 'component':
    case 'opaque': {
      const symbol = node.kind === 'component'
        ? (node as ComponentCallNode).component.symbol
        : (node as OpaqueCodeNode).symbol
      const source = node.kind === 'component'
        ? (node as ComponentCallNode).component.source
        : (node as OpaqueCodeNode).source
      context.imports.add(source)

      const attributes = openTagAttributes(context, node)
      const slotChildren = node.kind === 'component'
        ? Object.entries((node as ComponentCallNode).slots ?? {})
        : []
      for (const [slotName, childIds] of slotChildren.sort(([a], [b]) => a.localeCompare(b))) {
        const inner = childIds.map((id) => emitInline(context, id)).join('')
        if (inner.length > 0) attributes.push(`${slotName}={<>${inner}</>}`)
      }

      writer.write(pad)
      recordAnchor(context, node.id)
      emitTag(context, symbol, attributes, node.children, depth, node.id)
      return
    }

    case 'element': {
      const element = node as ElementNode
      writer.write(pad)
      recordAnchor(context, node.id)
      // `motion.div` rather than `div`: the animated variant of the same tag, so
      // the DOM output is unchanged and only behaviour is added.
      const animated = animationOf(node) !== undefined
      const reorderValue = 'reorderValue' in element ? element.reorderValue : undefined
      if (animated || reorderValue) context.imports.add('motion/react')
      // Reorder.Item is itself a motion component, so using both would nest two.
      const tag = reorderValue
        ? 'Reorder.Item'
        : (animated ? `motion.${element.tag}` : element.tag)
      const attributes = [...openTagAttributes(context, node)]
      if (reorderValue) {
        attributes.push(`as=${quote(element.tag)}`)
        attributes.push(`value={${expressionToSource(reorderValue)}}`)
      }
      emitTag(context, tag, attributes, node.children, depth, node.id, presenceOf(node))
      return
    }

    default: {
      // Exhaustive today; a new kind must fail loudly rather than vanish.
      throw new Error('[react-ir] unhandled node kind during generation')
    }
  }
}

/**
 * Write an opening tag, children and a closing tag.
 *
 * Attributes go one per line once there are more than two, which is the point at
 * which a single line stops being reviewable in a diff.
 */
/** Presence configuration on a node that can carry it. */
function presenceOf(node: ReactIrNode): { mode?: string, initial?: boolean } | undefined {
  return hasClassTokens(node) && 'presence' in node
    ? (node.presence as { mode?: string, initial?: boolean } | undefined)
    : undefined
}

function emitTag(
  context: EmitContext,
  tag: string,
  attributes: readonly string[],
  children: readonly string[],
  depth: number,
  nodeId?: string,
  presence?: { mode?: string, initial?: boolean },
): void {
  const { writer, options } = context
  const pad = options.indent.repeat(depth)
  const selfClosing = children.length === 0

  /**
   * The anchor goes inside the opening tag, between the tag name and its
   * attributes. A comment placed *before* the element would be a sibling of it,
   * which is a syntax error in a single-expression return, and it would ship
   * nothing useful anyway. Inside the tag it is valid everywhere, invisible in
   * the DOM, and survives reformatting.
   */
  const anchor = options.anchorComments && nodeId ? ` /* @fuma ${nodeId} */` : ''

  if (attributes.length === 0) {
    writer.line_(selfClosing ? `<${tag}${anchor} />` : `<${tag}${anchor}>`)
  } else if (attributes.length <= 2) {
    const inline = attributes.join(' ')
    writer.line_(selfClosing ? `<${tag}${anchor} ${inline} />` : `<${tag}${anchor} ${inline}>`)
  } else {
    writer.line_(`<${tag}${anchor}`)
    for (const attribute of attributes) {
      writer.line_(`${pad}${options.indent}${attribute}`)
    }
    writer.line_(`${pad}${selfClosing ? '/>' : '>'}`)
  }

  if (selfClosing) return

  if (presence) {
    // AnimatePresence sits between this element and its children: it has to outlive
    // the exiting child in order to keep it mounted through its exit animation.
    context.imports.add('motion/react')
    const presenceAttributes = [
      ...(presence.mode ? [`mode=${quote(presence.mode)}`] : []),
      // `initial={false}` skips the enter animation on first mount, for content
      // already on screen when the page loads.
      ...(presence.initial === false ? ['initial={false}'] : []),
    ]
    const inner = options.indent.repeat(depth + 1)
    writer.line_(`${inner}<AnimatePresence${presenceAttributes.length > 0 ? ` ${presenceAttributes.join(' ')}` : ''}>`)
    emitChildren(context, children, depth + 2)
    writer.line_(`${inner}</AnimatePresence>`)
    writer.line_(`${pad}</${tag}>`)
    return
  }

  emitChildren(context, children, depth + 1)
  writer.line_(`${pad}</${tag}>`)
}

/** Render the props interface for a module that declares one. */
function propsInterfaceSource(module: ReactIrModule): string {
  const fields = module.propsInterface ?? []
  const hasOutlet = Object.values(module.nodes).some((node) => node.kind === 'outlet')
  if (fields.length === 0 && !hasOutlet) return ''

  const typeOf = (type: string): string => {
    switch (type) {
      case 'string': return 'string'
      case 'number': return 'number'
      case 'boolean': return 'boolean'
      case 'node': return 'ReactNode'
      case 'url': return 'string'
      case 'media': return 'string'
      case 'enum': return 'string'
      case 'collection': return 'readonly Record<string, unknown>[]'
      case 'handler': return '(next: Record<string, unknown>[]) => void'
      default: return 'unknown'
    }
  }

  const lines = [...fields]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((field) => {
      // A handler is always required: the primitive that consumes it cannot
      // function without one, so making it optional only moves the failure to
      // runtime.
      const optional = field.required || field.type === 'handler' ? '' : '?'
      const union = field.type === 'enum' && field.options && field.options.length > 0
        ? field.options.map((option) => quote(option)).join(' | ')
        : typeOf(field.type)
      return `  ${field.name}${optional}: ${union}`
    })

  if (hasOutlet) lines.unshift('  children?: ReactNode')

  return `export interface ${module.symbol}Props {\n${lines.join('\n')}\n}`
}

/**
 * Generate a complete TSX module.
 *
 * Imports are grouped and sorted: React first, then external packages, then
 * project-relative modules. That ordering is conventional, and holding to it means
 * a regenerated file never differs from its predecessor by import shuffling alone.
 */
export function generateModule(
  module: ReactIrModule,
  options: GenerateOptions = {},
): GeneratedModule {
  const resolved: Required<GenerateOptions> = {
    anchorComments: options.anchorComments ?? false,
    indent: options.indent ?? DEFAULT_INDENT,
  }

  const body = new SourceWriter()
  const anchors: SourceAnchor[] = []
  const imports = new Set<string>()

  const context: EmitContext = {
    module,
    writer: body,
    anchors,
    imports,
    options: resolved,
  }

  // A server module cannot host a Motion element: the library runs in the browser,
  // so emitting one would produce code that fails at runtime. Refusing here forces
  // the boundary to be set deliberately rather than promoting the module silently
  // and making a whole route client-rendered without anyone choosing that.
  if (module.boundary !== 'client') {
    for (const node of Object.values(module.nodes)) {
      const animation = animationOf(node)
      if (animation && requiresClient(animation)) {
        throw new Error(
          `Module ${module.path} declares boundary "${module.boundary ?? 'server'}" but node `
          + `"${node.id}" carries a Motion animation. Set boundary to "client" on the smallest `
          + `module that needs it, or remove the animation.`,
        )
      }
    }
  }

  // Emit the tree first so the import set is complete before the header is built.
  if (module.motionConfig) {
    const config = module.motionConfig
    const attributes = [
      // Defaulted rather than omitted: respecting the preference is the point of
      // having this at all.
      `reducedMotion=${quote(config.reducedMotion ?? 'user')}`,
      ...(config.transition ? [`transition={${JSON.stringify(config.transition)}}`] : []),
      ...(config.nonce ? [`nonce=${quote(config.nonce)}`] : []),
    ]
    context.imports.add('motion/react')
    body.line_(`${resolved.indent.repeat(2)}<MotionConfig ${attributes.join(' ')}>`)
    emitNode(context, module.rootNodeId, 3)
    body.line_(`${resolved.indent.repeat(2)}</MotionConfig>`)
  } else {
    emitNode(context, module.rootNodeId, 2)
  }

  const header = new SourceWriter()
  if (module.boundary === 'client') {
    // Placed on the module that needs it, not a parent: one animated element
    // must not turn a whole route into a client component.
    header.line_("'use client'")
    header.line_()
  }

  const propsInterface = propsInterfaceSource(module)
  const needsReactNode = propsInterface.includes('ReactNode')
  const needsFragment = body.toString().includes('<Fragment')

  const needsCssProperties = body.toString().includes('as CSSProperties')
  const reactTypes = [
    ...(needsCssProperties ? ['CSSProperties'] : []),
    ...(needsReactNode ? ['ReactNode'] : []),
  ]
  const reactTypeImports = reactTypes.length > 0
    ? `import type { ${reactTypes.join(', ')} } from 'react'`
    : ''
  const reactValueImports = needsFragment ? "import { Fragment } from 'react'" : ''

  const external = [...imports]
    .filter((specifier) => specifier !== 'react')
    .filter((specifier) => !specifier.startsWith('.'))
    .sort()
  const local = [...imports].filter((specifier) => specifier.startsWith('.')).sort()

  const importLines: string[] = []
  if (reactValueImports) importLines.push(reactValueImports)
  if (reactTypeImports) importLines.push(reactTypeImports)
  for (const specifier of external) {
    importLines.push(`import { ${symbolsFor(module, specifier).join(', ')} } from ${quoteSpecifier(specifier)}`)
  }
  for (const specifier of local) {
    importLines.push(`import { ${symbolsFor(module, specifier).join(', ')} } from ${quoteSpecifier(specifier)}`)
  }
  // Imports the developer wrote that the tree does not imply — a type used only by a
  // preserved metadata export, for instance. Matched by module specifier so an import the
  // generator already produced is not emitted twice.
  const emittedSpecifiers = new Set([...imports, 'react'])
  for (const line of module.preservedImports ?? []) {
    const specifier = specifierOfImportLine(line)
    if (specifier !== null && emittedSpecifiers.has(specifier)) continue
    importLines.push(line)
  }

  if (importLines.length > 0) {
    for (const line of importLines) header.line_(line)
    header.line_()
  }

  // Preserved module code goes after the imports and before the component, which is where
  // it was written and where Next expects a metadata export to be readable.
  for (const statement of module.preamble ?? []) {
    header.line_(statement)
    header.line_()
  }

  if (propsInterface) {
    header.line_(propsInterface)
    header.line_()
  }

  const signature = propsInterface
    ? `export default function ${module.symbol}(props: ${module.symbol}Props) {`
    : `export default function ${module.symbol}() {`

  const out = new SourceWriter()
  out.write(header.toString())
  const rootKind = module.nodes[module.rootNodeId]?.kind
  // A repeat or expression root emits `{...}`, a JSX expression container. That form
  // is valid only inside JSX; as an entire return value it is a syntax error. A
  // fragment gives it the JSX context it needs and adds no element to the DOM.
  const rootNeedsFragment = rootKind === 'repeat' || rootKind === 'expression'

  out.line_(signature)
  out.line_(`${resolved.indent}return (`)
  if (rootNeedsFragment) out.line_(`${resolved.indent.repeat(2)}<>`)

  // Re-emit with the true line offset so anchors point at the final file rather
  // than the fragment. Generation is pure, so running it twice is safe and is
  // cheaper than threading an offset through every emitter.
  const finalAnchors: SourceAnchor[] = []
  const offset = out.line - 1
  for (const anchor of anchors) {
    finalAnchors.push(Object.freeze({
      nodeId: anchor.nodeId,
      line: anchor.line + offset,
      column: anchor.column,
    }))
  }

  out.write(body.toString())
  if (rootNeedsFragment) out.line_(`${resolved.indent.repeat(2)}</>`)
  out.line_(`${resolved.indent})`)
  out.line_('}')

  return Object.freeze({
    path: module.path,
    code: out.toString(),
    anchors: Object.freeze(finalAnchors),
    imports: Object.freeze([...imports].sort()),
  })
}

/** Symbols imported from one specifier, deduplicated and sorted. */
/**
 * Module specifier of an import line, or null when it cannot be read.
 *
 * Null means the line is emitted rather than dropped: keeping a duplicate import is a
 * tidiness problem, and dropping a needed one is a broken build.
 */
function specifierOfImportLine(line: string): string | null {
  return /from\s+['"]([^'"]+)['"]/.exec(line)?.[1] ?? null
}

function symbolsFor(module: ReactIrModule, specifier: string): readonly string[] {
  // Motion is imported for its element proxy, not for a component node, so there
  // is nothing in the tree to derive the symbol from.
  if (specifier === 'motion/react') {
    const symbols = new Set<string>()
    let usesMotionTag = false
    for (const node of Object.values(module.nodes)) {
      if (!hasClassTokens(node)) continue
      const reorderValue = 'reorderValue' in node ? node.reorderValue : undefined
      if (reorderValue) {
        // Reorder.Item is a motion component in its own right, so the plain proxy
        // is not needed for it.
        symbols.add('Reorder')
      } else if (node.animation) {
        usesMotionTag = true
      }
      // AnimatePresence is imported wherever an exit animation is observed, and
      // wherever a parent declares a presence region for its children.
      if (requiresPresence(node.animation ?? {})) symbols.add('AnimatePresence')
      if ('presence' in node && node.presence) symbols.add('AnimatePresence')
    }
    for (const node of Object.values(module.nodes)) {
      // The group lives on the repeat node, which carries no class tokens.
      if (node.kind === 'repeat' && node.reorder) symbols.add('Reorder')
    }
    if (usesMotionTag) symbols.add('motion')
    if (module.motionConfig) symbols.add('MotionConfig')
    return [...symbols].sort()
  }
  const symbols = new Set<string>()
  for (const node of Object.values(module.nodes)) {
    if (node.kind === 'component' && node.component.source === specifier) {
      symbols.add(node.component.symbol)
    }
    if (node.kind === 'opaque' && node.source === specifier) {
      symbols.add(node.symbol)
    }
  }
  return [...symbols].sort()
}

/** Every node id referenced by a module, for validating completeness. */
export function referencedNodeIds(module: ReactIrModule): readonly string[] {
  const ids = new Set<string>([module.rootNodeId])
  for (const node of Object.values(module.nodes)) {
    for (const childId of childIdsOf(node)) ids.add(childId)
  }
  return [...ids]
}

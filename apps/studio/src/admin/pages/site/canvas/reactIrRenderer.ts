/**
 * Rendering the React IR to live DOM for the canvas.
 *
 * The canvas needs the tree as real elements — selectable, measurable, hoverable —
 * not as generated source. This is the counterpart to the generator: same IR, two
 * outputs. The generator emits TSX for the build; this emits React elements for the
 * editor.
 *
 * Keeping them separate is deliberate. The canvas needs things the shipped page must
 * never contain: `data-node-id` for selection, placeholders for empty containers,
 * visible stand-ins for content that only exists at build time. Trying to serve both
 * from one code path is how editor attributes end up in published markup.
 *
 * The rule this file follows: **it renders, it never mutates.** Every edit goes
 * through `edit.ts`. A renderer that could also change the tree would make the
 * undo history depend on what happened to be on screen.
 */

import { createElement, type ReactElement, type ReactNode } from 'react'
import {
  childIdsOf,
  classTokensOf,
  isHidden,
  type ComponentCallNode,
  type ElementNode,
  type ExpressionNode,
  type OpaqueCodeNode,
  type ReactIrModule,
  type ReactIrNode,
  type RepeatNode,
  type TextNode,
} from '@core/react-ir/nodes'
import type { Expression } from '@core/react-ir/expression'

/** The attribute the canvas selects and measures by. */
export const CANVAS_NODE_ATTRIBUTE = 'data-node-id'

export type RenderContext = Readonly<{
  module: ReactIrModule
  /**
   * Sample rows for repeat nodes, by collection id.
   *
   * The canvas cannot run a loader, so a repeat has nothing real to iterate. Sample
   * rows make the loop visible and countable; without them a list renders as nothing
   * and looks broken rather than empty-because-unbound.
   */
  sampleRows?: Readonly<Record<string, readonly Record<string, unknown>[]>>
  /** Props in effect, for resolving prop expressions. */
  props?: Readonly<Record<string, unknown>>
  /** How many sample rows to show. Kept small: the canvas is for judging design. */
  sampleLimit?: number
}>

/**
 * Resolve an expression to something displayable.
 *
 * The canvas shows a *representation*, not the real value — that only exists at build
 * time with real data. A visible placeholder naming the binding is more useful than
 * an empty space, because the author can see the binding exists and where it lands.
 */
export function resolveForCanvas(
  expression: Expression,
  context: RenderContext,
  row?: Readonly<Record<string, unknown>>,
): string {
  switch (expression.kind) {
    case 'literal':
      return String(expression.value)

    case 'member': {
      const path = expression.path.join('.')
      if (expression.scope === 'item' && row) {
        const value = expression.path.reduce<unknown>(
          (current, segment) =>
            typeof current === 'object' && current !== null
              ? (current as Record<string, unknown>)[segment]
              : undefined,
          row,
        )
        if (value !== undefined && value !== null) return String(value)
      }
      if (expression.scope === 'prop' && context.props) {
        const value = context.props[expression.path[0] ?? '']
        if (value !== undefined && value !== null) return String(value)
      }
      // The declared fallback is what the page will actually show when the value is
      // missing, so preferring it keeps the canvas honest.
      if (expression.fallback !== undefined && expression.fallback !== null) {
        return String(expression.fallback)
      }
      return `{${expression.scope}.${path}}`
    }

    case 'template':
      return expression.quasis.reduce((accumulated, quasi, index) => {
        const part = expression.parts[index]
        return accumulated + quasi
          + (part === undefined ? '' : resolveForCanvas(part, context, row))
      }, '')

    case 'conditional': {
      // Both branches are real outcomes; the canvas shows the one a viewer would see
      // most often, which is the consequent when the test cannot be evaluated here.
      const branch = expression.whenTrue ?? expression.whenFalse
      return branch ? resolveForCanvas(branch, context, row) : ''
    }

    default:
      return ''
  }
}

/** Attribute values the DOM can accept, resolved for display. */
function domAttributes(
  node: ElementNode | ComponentCallNode,
  context: RenderContext,
  row?: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const source = node.kind === 'element' ? node.attributes : node.props
  const attributes: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(source ?? {})) {
    if (value.kind !== 'expression') continue
    // React would warn about several of these on an intrinsic element, and none of
    // them affect layout, so the canvas is better off without them.
    if (/^on[A-Z]/.test(name)) continue
    attributes[name] = resolveForCanvas(value.expression, context, row)
  }
  return attributes
}

/**
 * Render one node.
 *
 * Returns null for a node the canvas deliberately shows nothing for, so callers can
 * filter without needing to know which kinds those are.
 */
function renderNode(
  nodeId: string,
  context: RenderContext,
  row?: Readonly<Record<string, unknown>>,
  keySuffix = '',
): ReactNode {
  const node = context.module.nodes[nodeId]
  if (!node) return null

  // A hidden node stays out of the rendered tree but remains in the IR, which is what
  // makes hiding reversible rather than a delete.
  if (isHidden(node)) return null

  const key = `${nodeId}${keySuffix}`

  switch (node.kind) {
    case 'text':
      return (node as TextNode).value

    case 'expression':
      return resolveForCanvas((node as ExpressionNode).expression, context, row)

    case 'element': {
      const element = node as ElementNode
      const children = childIdsOf(element)
        .map((childId) => renderNode(childId, context, row, keySuffix))
        .filter((child) => child !== null && child !== undefined)

      return createElement(
        element.tag,
        {
          key,
          [CANVAS_NODE_ATTRIBUTE]: nodeId,
          className: classTokensOf(element).join(' ') || undefined,
          ...(element.style ? { style: element.style } : {}),
          ...domAttributes(element, context, row),
        },
        // A void element must not be given children at all, not even an empty array:
        // React throws rather than ignoring them.
        children.length > 0 ? children : undefined,
      )
    }

    case 'component': {
      const call = node as ComponentCallNode
      // A code component's own implementation is not available here, so the canvas
      // shows a labelled stand-in of the right shape rather than nothing. Guessing at
      // its markup would be worse: the author would trust a layout that is not real.
      const children = childIdsOf(call)
        .map((childId) => renderNode(childId, context, row, keySuffix))
        .filter((child) => child !== null && child !== undefined)

      return createElement(
        'div',
        {
          key,
          [CANVAS_NODE_ATTRIBUTE]: nodeId,
          'data-component-symbol': call.component.symbol,
          className: classTokensOf(call).join(' ') || undefined,
        },
        children.length > 0 ? children : undefined,
      )
    }

    case 'repeat': {
      const repeat = node as RepeatNode
      const rows = context.sampleRows?.[repeat.source.id] ?? []
      const limit = context.sampleLimit ?? 3
      const variants = repeat.variants

      if (rows.length === 0) {
        // Nothing to iterate. One variant is rendered unbound so the design is still
        // visible and editable — an empty region would look like a broken loop.
        return createElement(
          'div',
          { key, [CANVAS_NODE_ATTRIBUTE]: nodeId, 'data-repeat-unbound': '' },
          renderNode(variants[0] ?? '', context, undefined, `${keySuffix}-unbound`),
        )
      }

      return createElement(
        'div',
        { key, [CANVAS_NODE_ATTRIBUTE]: nodeId, 'data-repeat': '' },
        rows.slice(0, limit).map((sampleRow, index) =>
          // Variants cycle across rows, matching what the generator emits, so the
          // canvas shows the same alternation the page will.
          renderNode(
            variants[index % variants.length] ?? '',
            context,
            sampleRow,
            `${keySuffix}-${index}`,
          )),
      )
    }

    case 'outlet':
      // A layout's content position. The page that fills it is not part of this
      // module, so the canvas marks the slot rather than inventing content.
      return createElement('div', {
        key,
        [CANVAS_NODE_ATTRIBUTE]: nodeId,
        'data-outlet': '',
      })

    case 'slot':
      return createElement(
        'div',
        { key, [CANVAS_NODE_ATTRIBUTE]: nodeId, 'data-slot': '' },
        childIdsOf(node)
          .map((childId) => renderNode(childId, context, row, keySuffix))
          .filter((child) => child !== null && child !== undefined),
      )

    case 'opaque': {
      const opaque = node as OpaqueCodeNode
      // Preserved source the IR does not model. Rendering it is impossible without
      // executing it, so it is marked and left alone — which is also what keeps it
      // from being silently dropped on the next generate.
      return createElement('div', {
        key,
        [CANVAS_NODE_ATTRIBUTE]: nodeId,
        'data-opaque': opaque.symbol,
      })
    }

    default:
      return null
  }
}

/** Render a module's tree for the canvas. */
export function renderModuleForCanvas(context: RenderContext): ReactElement | null {
  const root = renderNode(context.module.rootNodeId, context)
  // A string root cannot carry the selection attribute, so it is wrapped. This
  // happens when a module's root is a text or expression node.
  if (typeof root === 'string') {
    return createElement('div', { [CANVAS_NODE_ATTRIBUTE]: context.module.rootNodeId }, root)
  }
  return (root as ReactElement | null) ?? null
}

/**
 * Node ids in the order they appear on the canvas.
 *
 * Hidden nodes are excluded, because the layer list and keyboard navigation should
 * agree with what is actually on screen.
 */
export function visibleNodeIds(module: ReactIrModule): readonly string[] {
  const order: string[] = []
  const visit = (nodeId: string): void => {
    const node = module.nodes[nodeId]
    if (!node || isHidden(node)) return
    order.push(nodeId)
    for (const childId of childIdsOf(node)) visit(childId)
  }
  visit(module.rootNodeId)
  return Object.freeze(order)
}

/** The node a DOM element belongs to, walking up to the nearest marked ancestor. */
export function nodeIdFromElement(element: Element | null): string | null {
  const found = element?.closest(`[${CANVAS_NODE_ATTRIBUTE}]`) ?? null
  return found?.getAttribute(CANVAS_NODE_ATTRIBUTE) ?? null
}

/** Whether a node can be selected on the canvas. */
export function isSelectable(node: ReactIrNode | undefined): boolean {
  if (!node) return false
  // Text and expression nodes render as bare strings with no element of their own, so
  // there is nothing for a pointer to hit — selecting them happens through the layer
  // list instead.
  return node.kind !== 'text' && node.kind !== 'expression'
}

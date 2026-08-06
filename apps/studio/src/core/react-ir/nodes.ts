/**
 * The React IR node union.
 *
 * The legacy document is a flat map of `{ id, moduleId, props, children }`, where
 * `moduleId` names a registry entry and several entries are secretly control flow
 * rather than markup: a loop, a component reference, a transparent slot. Emitting
 * React from that means an adapter guessing which of those a node is.
 *
 * This makes the kinds explicit. Each node says what it becomes in TSX, so codegen
 * is a translation rather than an inference, and a reader can map TSX back onto a
 * kind instead of pattern-matching markup.
 *
 * Two things carry over deliberately from the legacy model, because they are good:
 *
 *   - the flat id map with ordered `children` id arrays. O(1) lookup, narrow
 *     patches for undo, and a deterministic depth-first emission order.
 *   - the separation of editor metadata from output. `label`, `locked` and
 *     `hidden` shape the canvas and never reach generated source.
 *
 * What is new is `version`, which the legacy `Page` contract lacks entirely. Without
 * a discriminator a migration cannot tell an old document from a new one, so both
 * parsers would have to guess.
 */

import { Type, withFallback, type Static } from '@core/utils/typeboxHelpers'
import { ExpressionSchema } from './expression'

/** Bumped when a stored node shape changes incompatibly. */
export const REACT_IR_VERSION = 1

const NodeIdSchema = Type.String({ minLength: 1, maxLength: 128 })

/**
 * Ordered Tailwind class tokens.
 *
 * A list rather than a joined string because order is meaningful for conflicting
 * utilities, and because editing one token should not require re-parsing the rest.
 * Serialisation to `className` happens in codegen, which is also where the
 * variant grammar is understood — whitespace inside brackets, escaped
 * underscores, nested brackets and variant stacks all make a naive split wrong.
 */
const ClassTokensSchema = Type.Optional(
  Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 256 }),
)

/**
 * A JSX attribute value: either a constrained expression or a nested node used as
 * a `ReactNode` prop, which is how a component receives a named slot.
 */
const AttributeValueSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('expression'),
    expression: ExpressionSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('nodes'),
    children: Type.Array(NodeIdSchema),
  }, { additionalProperties: false }),
])
export type AttributeValue = Static<typeof AttributeValueSchema>

/**
 * Fields every node carries, whatever its kind.
 *
 * Editor metadata is `Type.Optional` rather than `withFallback` on purpose.
 * `withFallback` marks a default the *parser* applies, and TypeBox cannot apply
 * one inside a `Type.Union`: resolving the branch fails before any repair
 * happens, so a node missing the field throws "Expected union value" instead of
 * being filled in. Since every node here is a union member, a fallback would
 * promise leniency it cannot deliver. Optional plus a default accessor is honest,
 * and `isLocked`/`isHidden` below are where the default actually lives.
 *
 * `children` stays required because traversal depends on it and our own writer
 * always emits it; a document without it is broken rather than incomplete.
 */
const NodeCommonSchema = Type.Object({
  id: NodeIdSchema,
  /** Ordered child ids. Empty for kinds that cannot contain children. */
  children: Type.Array(NodeIdSchema),
  /** Canvas label. Editor-only; never emitted. */
  label: Type.Optional(Type.String({ maxLength: 200 })),
  /** Blocks selection and movement on canvas. Editor-only. */
  locked: Type.Optional(Type.Boolean()),
  /**
   * Hidden on canvas while kept in the document. Editor-only, and distinct from
   * conditional rendering: a hidden node still generates source. Anything that
   * should be absent from output belongs in a conditional expression instead.
   */
  hidden: Type.Optional(Type.Boolean()),
}, { additionalProperties: false })

/**
 * An intrinsic element: `div`, `section`, `a`. Becomes a JSX element with the
 * same tag.
 */
const ElementNodeSchema = Type.Composite([
  NodeCommonSchema,
  Type.Object({
    kind: Type.Literal('element'),
    tag: Type.String({ minLength: 1, maxLength: 64, pattern: '^[a-zA-Z][a-zA-Z0-9-]*$' }),
    attributes: Type.Optional(Type.Record(Type.String(), AttributeValueSchema)),
    classTokens: ClassTokensSchema,
    /**
     * Literal style declarations for values Tailwind cannot express. Kept
     * narrow on purpose: this is an escape hatch, and a wide one would quietly
     * become the styling system again.
     */
    style: Type.Optional(Type.Record(Type.String(), Type.String())),
  }, { additionalProperties: false }),
])

/**
 * A call to a component: one from the library, an imported shadcn primitive, or
 * one the author wrote.
 *
 * `component` is a stable reference, not a bare name, so a rename in source does
 * not orphan every call site. `slots` are named `ReactNode` props, which is how a
 * component takes structured children — the legacy slot-outlet and slot-instance
 * control nodes disappear, because they have no equivalent in emitted JSX.
 */
const ComponentCallNodeSchema = Type.Composite([
  NodeCommonSchema,
  Type.Object({
    kind: Type.Literal('component'),
    component: Type.Object({
      /** Stable id in the site's component library. */
      id: Type.String({ minLength: 1, maxLength: 128 }),
      /** Exported symbol, for generating the import. */
      symbol: Type.String({ minLength: 1, maxLength: 128 }),
      /** Module specifier the symbol is imported from. */
      source: Type.String({ minLength: 1, maxLength: 256 }),
    }, { additionalProperties: false }),
    props: Type.Optional(Type.Record(Type.String(), AttributeValueSchema)),
    slots: Type.Optional(Type.Record(Type.String(), Type.Array(NodeIdSchema))),
    classTokens: ClassTokensSchema,
  }, { additionalProperties: false }),
])

/** Literal text. */
const TextNodeSchema = Type.Composite([
  NodeCommonSchema,
  Type.Object({
    kind: Type.Literal('text'),
    value: Type.String({ maxLength: 100_000 }),
  }, { additionalProperties: false }),
])

/** An interpolated expression in child position. */
const ExpressionNodeSchema = Type.Composite([
  NodeCommonSchema,
  Type.Object({
    kind: Type.Literal('expression'),
    expression: ExpressionSchema,
  }, { additionalProperties: false }),
])

/**
 * Repetition over a data source. Becomes a loader plus `.map`.
 *
 * `variants` preserves the legacy round-robin behaviour, where a loop's children
 * are alternating templates cycled across rows. `key` is explicit because React
 * needs a stable one and inferring it from the row shape would be a guess.
 */
const RepeatNodeSchema = Type.Composite([
  NodeCommonSchema,
  Type.Object({
    kind: Type.Literal('repeat'),
    source: Type.Object({
      /** Collection or data source id. */
      id: Type.String({ minLength: 1, maxLength: 128 }),
      filters: Type.Optional(Type.Array(Type.Object({
        field: Type.String({ minLength: 1, maxLength: 128 }),
        operator: Type.Union([
          Type.Literal('equals'),
          Type.Literal('notEquals'),
          Type.Literal('contains'),
          Type.Literal('exists'),
        ]),
        value: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Boolean()])),
      }, { additionalProperties: false }))),
      orderBy: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
      direction: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')])),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
    }, { additionalProperties: false }),
    /** Field used for the React key. */
    key: Type.String({ minLength: 1, maxLength: 128 }),
    /** Root ids of each body template, cycled across rows. */
    variants: Type.Array(NodeIdSchema, { minItems: 1, maxItems: 8 }),
  }, { additionalProperties: false }),
])

/**
 * A named slot a component declares. Becomes a `ReactNode` prop in the component's
 * own props interface, and the position its value renders at.
 */
const SlotDeclarationNodeSchema = Type.Composite([
  NodeCommonSchema,
  Type.Object({
    kind: Type.Literal('slot'),
    /** Stable id, so renaming the slot does not break existing call sites. */
    slotId: Type.String({ minLength: 1, maxLength: 128 }),
    name: Type.String({ minLength: 1, maxLength: 128 }),
    /** Rendered when a caller passes nothing. */
    fallbackChildren: Type.Optional(Type.Array(NodeIdSchema)),
  }, { additionalProperties: false }),
])

/** Where a layout's page content renders. Becomes the `children` position. */
const LayoutOutletNodeSchema = Type.Composite([
  NodeCommonSchema,
  Type.Object({
    kind: Type.Literal('outlet'),
  }, { additionalProperties: false }),
])

/**
 * Developer code the builder does not model.
 *
 * The honest half of the design. React is Turing-complete, so a total inverse from
 * arbitrary source to an editable tree does not exist. Rather than mangle what it
 * cannot represent, the builder keeps the source verbatim, renders it, and exposes
 * only a declared prop surface — selectable and movable on canvas, never rewritten.
 *
 * `sourceHash` detects whether the region changed underneath the document, which
 * is what lets a merge report a conflict instead of silently overwriting an edit.
 */
const OpaqueCodeNodeSchema = Type.Composite([
  NodeCommonSchema,
  Type.Object({
    kind: Type.Literal('opaque'),
    /** Exported symbol this region renders. */
    symbol: Type.String({ minLength: 1, maxLength: 128 }),
    source: Type.String({ minLength: 1, maxLength: 256 }),
    props: Type.Optional(Type.Record(Type.String(), AttributeValueSchema)),
    sourceHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    /** Why it is opaque, shown to the author rather than left mysterious. */
    reason: Type.Optional(Type.String({ maxLength: 512 })),
  }, { additionalProperties: false }),
])

export const ReactNodeSchema = Type.Union([
  ElementNodeSchema,
  ComponentCallNodeSchema,
  TextNodeSchema,
  ExpressionNodeSchema,
  RepeatNodeSchema,
  SlotDeclarationNodeSchema,
  LayoutOutletNodeSchema,
  OpaqueCodeNodeSchema,
])
export type ReactIrNode = Static<typeof ReactNodeSchema>

export type ElementNode = Static<typeof ElementNodeSchema>
export type ComponentCallNode = Static<typeof ComponentCallNodeSchema>
export type TextNode = Static<typeof TextNodeSchema>
export type ExpressionNode = Static<typeof ExpressionNodeSchema>
export type RepeatNode = Static<typeof RepeatNodeSchema>
export type SlotDeclarationNode = Static<typeof SlotDeclarationNodeSchema>
export type LayoutOutletNode = Static<typeof LayoutOutletNodeSchema>
export type OpaqueCodeNode = Static<typeof OpaqueCodeNodeSchema>

/**
 * Whether a subtree must render on the client.
 *
 * Motion, hooks and event handlers all require it. Tracked per document so the
 * generator can place `use client` at the narrowest correct point: one animated
 * element should not turn an entire route into a client component.
 */
export const ClientBoundarySchema = Type.Union([
  /** Server component. The default, and the cheapest. */
  Type.Literal('server'),
  /** This component and its subtree render on the client. */
  Type.Literal('client'),
])
export type ClientBoundary = Static<typeof ClientBoundarySchema>

/**
 * A generated module: one route or one component.
 *
 * Carries what codegen cannot infer — where the file goes, what it exports, and
 * whether it is a client component — none of which the legacy `Page` contract has
 * anywhere to put.
 */
export const ReactIrModuleSchema = Type.Object({
  version: Type.Literal(REACT_IR_VERSION),
  id: Type.String({ minLength: 1, maxLength: 128 }),
  /** Repository-relative path of the generated file. */
  path: Type.String({ minLength: 1, maxLength: 512 }),
  /** Exported symbol. */
  symbol: Type.String({ minLength: 1, maxLength: 128 }),
  kind: Type.Union([
    Type.Literal('page'),
    Type.Literal('layout'),
    Type.Literal('component'),
  ]),
  boundary: withFallback(ClientBoundarySchema, 'server'),
  /** Props this module declares, for components. */
  propsInterface: withFallback(Type.Array(Type.Object({
    name: Type.String({ minLength: 1, maxLength: 128 }),
    type: Type.Union([
      Type.Literal('string'),
      Type.Literal('number'),
      Type.Literal('boolean'),
      Type.Literal('node'),
      Type.Literal('url'),
      Type.Literal('media'),
      Type.Literal('enum'),
    ]),
    required: withFallback(Type.Boolean(), false),
    /** Permitted values, for enum props. */
    options: Type.Optional(Type.Array(Type.String({ maxLength: 128 }), { maxItems: 64 })),
  }, { additionalProperties: false })), []),
  nodes: Type.Record(NodeIdSchema, ReactNodeSchema),
  rootNodeId: NodeIdSchema,
}, { additionalProperties: false })
export type ReactIrModule = Static<typeof ReactIrModuleSchema>

/**
 * Defaults for the optional editor metadata.
 *
 * These exist so no caller repeats `node.locked ?? false`. Optionality is a
 * storage detail; behaviour should read as though the field is always there.
 */
export function isLocked(node: ReactIrNode): boolean {
  return node.locked === true
}

export function isHidden(node: ReactIrNode): boolean {
  return node.hidden === true
}

/** Class tokens for a node that can carry them, defaulting to none. */
export function classTokensOf(node: ReactIrNode): readonly string[] {
  return hasClassTokens(node) ? node.classTokens ?? [] : []
}

/** Kinds that may contain ordered children. */
const CONTAINER_KINDS: ReadonlySet<ReactIrNode['kind']> = new Set([
  'element',
  'component',
  'repeat',
  'slot',
])

export function canHaveChildren(node: ReactIrNode): boolean {
  return CONTAINER_KINDS.has(node.kind)
}

/** Kinds that carry Tailwind class tokens. */
export function hasClassTokens(
  node: ReactIrNode,
): node is ElementNode | ComponentCallNode {
  return node.kind === 'element' || node.kind === 'component'
}

/**
 * Depth-first node ids from a root, guarding against cycles.
 *
 * A cycle cannot be produced by the editor, but a hand-edited or migrated
 * document could contain one, and an unguarded walk would hang the canvas rather
 * than report a broken document.
 */
export function walkNodeIds(
  module: ReactIrModule,
  rootId: string = module.rootNodeId,
): readonly string[] {
  const order: string[] = []
  const seen = new Set<string>()
  const stack: string[] = [rootId]
  while (stack.length > 0) {
    const id = stack.pop()
    if (id === undefined || seen.has(id)) continue
    const node = module.nodes[id]
    if (!node) continue
    seen.add(id)
    order.push(id)
    // Reverse so siblings emit left to right once popped.
    const descendants = [...childIdsOf(node)].reverse()
    stack.push(...descendants)
  }
  return order
}

/**
 * Every child id a node references, across children, slots, attribute values and
 * repeat variants. Codegen and the canvas both need the complete set; missing one
 * would orphan a subtree.
 */
export function childIdsOf(node: ReactIrNode): readonly string[] {
  const ids: string[] = [...node.children]

  /** Pull node ids out of an attribute or prop bag, which may be absent. */
  const fromValues = (
    bag: Readonly<Record<string, AttributeValue>> | undefined,
  ): void => {
    for (const value of Object.values(bag ?? {})) {
      if (value.kind === 'nodes') ids.push(...value.children)
    }
  }

  if (node.kind === 'component') {
    for (const slotChildren of Object.values(node.slots ?? {})) ids.push(...slotChildren)
    fromValues(node.props)
  }
  if (node.kind === 'element') fromValues(node.attributes)
  if (node.kind === 'repeat') ids.push(...node.variants)
  if (node.kind === 'slot') ids.push(...(node.fallbackChildren ?? []))
  if (node.kind === 'opaque') fromValues(node.props)
  return ids
}

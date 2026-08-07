/**
 * Motion animation as serialisable data.
 *
 * Motion for React is declarative: `initial`, `animate`, `exit`, `transition`,
 * `variants` and the `while*` gesture props are all just props. That is what makes
 * a visual animation editor possible — the panel edits data, the generator emits
 * the same data as props, and the reader recovers it. An imperative animation
 * library could not be edited this way at all.
 *
 * The model mirrors Motion's own shape rather than inventing a parallel vocabulary,
 * so a value set in the panel is the value that appears in source. Anything Motion
 * does not accept is not representable here.
 *
 * Deliberately excluded:
 *
 *   - Motion+ components (`AnimateNumber`, `Carousel`, `Cursor`, `ScrambleText`,
 *     `Ticker`, `Typewriter`) are paid. Nothing may depend on them.
 *   - imperative sequences through `useAnimate`, which are code rather than data
 *     and belong in a code component
 */

import { Type, type Static } from '@core/utils/typeboxHelpers'

/**
 * Values Motion animates.
 *
 * Transforms are listed separately from CSS properties because Motion animates each
 * transform axis independently — that independence is the reason a gesture can
 * scale something while an entrance animation is still translating it.
 */
export const MotionValueSchema = Type.Union([
  Type.Number(),
  /** A string carrying its own unit, or a colour, or a complex value. */
  Type.String(),
  /**
   * Keyframes. A leading null is Motion's wildcard, meaning "start from wherever
   * this value currently is", which keeps an interrupted animation smooth.
   */
  Type.Array(Type.Union([Type.Number(), Type.String(), Type.Null()]), { maxItems: 16 }),
])
export type MotionValue = Static<typeof MotionValueSchema>

/** A target: the properties to animate to, keyed by property name. */
export const MotionTargetSchema = Type.Record(Type.String({ maxLength: 64 }), MotionValueSchema)
export type MotionTarget = Static<typeof MotionTargetSchema>

/** Easing curves Motion accepts by name. */
export const MotionEasingSchema = Type.Union([
  Type.Literal('linear'),
  Type.Literal('easeIn'),
  Type.Literal('easeOut'),
  Type.Literal('easeInOut'),
  Type.Literal('circIn'),
  Type.Literal('circOut'),
  Type.Literal('circInOut'),
  Type.Literal('backIn'),
  Type.Literal('backOut'),
  Type.Literal('backInOut'),
  Type.Literal('anticipate'),
])
export type MotionEasing = Static<typeof MotionEasingSchema>

/**
 * Transition options.
 *
 * Motion picks sensible defaults per value type — springs for physical properties
 * like `x` and `scale`, duration-based easing for `opacity` and colour — so every
 * field here is optional. Writing a default explicitly would override that
 * behaviour with something worse.
 */
export const MotionTransitionSchema = Type.Object({
  type: Type.Optional(Type.Union([
    Type.Literal('tween'),
    Type.Literal('spring'),
    Type.Literal('inertia'),
  ])),
  duration: Type.Optional(Type.Number({ minimum: 0, maximum: 60 })),
  delay: Type.Optional(Type.Number({ minimum: 0, maximum: 60 })),
  ease: Type.Optional(Type.Union([
    MotionEasingSchema,
    /** A cubic bézier as four control points. */
    Type.Array(Type.Number(), { minItems: 4, maxItems: 4 }),
  ])),
  /** Spring parameters, meaningful only when type is spring. */
  stiffness: Type.Optional(Type.Number({ minimum: 0, maximum: 10_000 })),
  damping: Type.Optional(Type.Number({ minimum: 0, maximum: 1000 })),
  mass: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
  bounce: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  /** Repeat count, or Infinity expressed as -1 since JSON has no Infinity. */
  repeat: Type.Optional(Type.Number({ minimum: -1, maximum: 1000 })),
  repeatType: Type.Optional(Type.Union([
    Type.Literal('loop'),
    Type.Literal('reverse'),
    Type.Literal('mirror'),
  ])),
  /**
   * Keyframe positions between 0 and 1, one per keyframe. Without this Motion
   * spaces keyframes evenly, which is rarely what a designer wants for a hold.
   */
  times: Type.Optional(Type.Array(Type.Number({ minimum: 0, maximum: 1 }), { maxItems: 16 })),
  /** Order relative to children, for a parent orchestrating a sequence. */
  when: Type.Optional(Type.Union([
    Type.Literal('beforeChildren'),
    Type.Literal('afterChildren'),
  ])),
  /** Seconds between each child starting. This is Motion's stagger. */
  staggerChildren: Type.Optional(Type.Number({ minimum: 0, maximum: 10 })),
  /** Delay before any child starts. */
  delayChildren: Type.Optional(Type.Number({ minimum: 0, maximum: 60 })),
}, { additionalProperties: false })
export type MotionTransition = Static<typeof MotionTransitionSchema>

/** A target plus the transition that carries it. */
export const MotionStateSchema = Type.Object({
  target: MotionTargetSchema,
  transition: Type.Optional(MotionTransitionSchema),
}, { additionalProperties: false })
export type MotionState = Static<typeof MotionStateSchema>

/**
 * Gesture states.
 *
 * Note on the record below: TypeBox's `Type.Record` with a finite literal-union
 * key builds an object where every key is *required*, so declaring one gesture
 * would demand all five. `Type.Partial` is what makes it the optional map the
 * name implies.
 *
 * Each maps to a Motion prop of the same name. When the gesture ends the element
 * returns to `animate`, or `initial` if there is no animate — behaviour Motion
 * provides, which is why these are plain states rather than needing an exit of
 * their own.
 */
export const MotionGestureSchema = Type.Union([
  Type.Literal('whileHover'),
  Type.Literal('whileTap'),
  Type.Literal('whileFocus'),
  Type.Literal('whileDrag'),
  Type.Literal('whileInView'),
])
export type MotionGesture = Static<typeof MotionGestureSchema>

/** Options for the in-view trigger. */
export const MotionInViewSchema = Type.Object({
  /** Animate only the first time it enters view. */
  once: Type.Optional(Type.Boolean()),
  /** How much must be visible, 0 to 1. */
  amount: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  /** Margin around the viewport, e.g. "-100px". */
  margin: Type.Optional(Type.String({ maxLength: 64 })),
}, { additionalProperties: false })
export type MotionInView = Static<typeof MotionInViewSchema>

/**
 * A node's complete animation.
 *
 * `variants` plus a named `animate` is what enables orchestration: a parent sets a
 * variant name and every descendant with that name in its own variants responds.
 * That propagation is how real entrance sequences are built, and it cannot be
 * expressed by per-element targets alone.
 */
export const MotionAnimationSchema = Type.Object({
  /** Starting state. `false` disables the enter animation entirely. */
  initial: Type.Optional(Type.Union([MotionTargetSchema, Type.String(), Type.Boolean()])),
  /** Target state, or a variant name to inherit from a parent. */
  animate: Type.Optional(Type.Union([MotionTargetSchema, Type.String()])),
  /** Exit state. Requires an AnimatePresence ancestor to be observed. */
  exit: Type.Optional(Type.Union([MotionTargetSchema, Type.String()])),
  /** Default transition for this element's states. */
  transition: Type.Optional(MotionTransitionSchema),
  /** Named states, referenced by name from initial, animate and exit. */
  variants: Type.Optional(Type.Record(
    Type.String({ minLength: 1, maxLength: 64 }),
    MotionStateSchema,
  )),
  /**
   * Gesture states, keyed by the Motion prop they become.
   *
   * A gesture may name a variant instead of declaring a target inline, which is
   * how hovering a parent drives its children's own hover states — the effect is
   * impossible to express with per-element targets.
   */
  gestures: Type.Optional(Type.Partial(Type.Record(
    MotionGestureSchema,
    Type.Union([MotionStateSchema, Type.String({ minLength: 1, maxLength: 64 })]),
  ))),
  inView: Type.Optional(MotionInViewSchema),
  /** Animate layout changes with transforms rather than layout thrash. */
  layout: Type.Optional(Type.Union([
    Type.Boolean(),
    Type.Literal('position'),
    Type.Literal('size'),
  ])),
  /** Shared layout identity, for animating between two elements. */
  layoutId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  /** Draggable, optionally constrained to one axis. */
  drag: Type.Optional(Type.Union([Type.Boolean(), Type.Literal('x'), Type.Literal('y')])),
}, { additionalProperties: false })
export type MotionAnimation = Static<typeof MotionAnimationSchema>

/** Motion values that are transforms, animated independently of each other. */
export const TRANSFORM_VALUES: ReadonlySet<string> = new Set([
  'x', 'y', 'z',
  'scale', 'scaleX', 'scaleY',
  'rotate', 'rotateX', 'rotateY', 'rotateZ',
  'skew', 'skewX', 'skewY',
  'originX', 'originY', 'originZ',
  'transformPerspective',
])

/** Whether a property is a transform rather than a CSS property. */
export function isTransformValue(property: string): boolean {
  return TRANSFORM_VALUES.has(property)
}

/**
 * Whether an animation needs the element to render on the client.
 *
 * Any Motion animation does — the library runs in the browser. This exists so the
 * generator can place `use client` on the narrowest module that needs it rather
 * than assuming, and so a node carrying an empty animation object does not
 * needlessly clientize a route.
 */
export function requiresClient(animation: MotionAnimation): boolean {
  return Boolean(
    animation.initial
    || animation.animate
    || animation.exit
    || animation.variants
    || animation.gestures
    || animation.layout
    || animation.layoutId
    || animation.drag,
  )
}

/** Whether an exit animation is declared, which needs an AnimatePresence ancestor. */
export function requiresPresence(animation: MotionAnimation): boolean {
  if (animation.exit) return true
  // A variant named for exit is only observed through AnimatePresence too.
  return Boolean(animation.variants && 'exit' in animation.variants)
}

/**
 * Whether this element orchestrates its children.
 *
 * Stagger and ordering live on the parent's transition in Motion, so the panel has
 * to show them there rather than on each child — which is also the only place they
 * work.
 */
export function orchestratesChildren(animation: MotionAnimation): boolean {
  const transitions = [
    animation.transition,
    ...Object.values(animation.variants ?? {}).map((state) => state.transition),
    ...Object.values(animation.gestures ?? {})
      .map((state) => (typeof state === 'string' ? undefined : state.transition)),
  ]
  return transitions.some((transition) => Boolean(
    transition
    && (transition.staggerChildren !== undefined
      || transition.delayChildren !== undefined
      || transition.when !== undefined),
  ))
}

/** Every variant name an animation references, for validating them. */
export function referencedVariantNames(animation: MotionAnimation): readonly string[] {
  const names = new Set<string>()
  for (const value of [animation.initial, animation.animate, animation.exit]) {
    if (typeof value === 'string') names.add(value)
  }
  // A gesture naming a variant references it just as animate does.
  for (const state of Object.values(animation.gestures ?? {})) {
    if (typeof state === 'string') names.add(state)
  }
  return [...names]
}

/**
 * Variant names referenced but never declared.
 *
 * Motion fails silently on an unknown variant name: the element simply does not
 * animate, with nothing in the console. Surfacing it is the difference between a
 * fixable mistake and a mysterious one.
 */
export function undeclaredVariantNames(animation: MotionAnimation): readonly string[] {
  const declared = new Set(Object.keys(animation.variants ?? {}))
  return referencedVariantNames(animation).filter((name) => !declared.has(name))
}

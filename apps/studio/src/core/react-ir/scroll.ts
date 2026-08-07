/**
 * Scroll-linked animation and reduced motion.
 *
 * Two things Motion supports that the plain prop model cannot express, and one
 * accessibility obligation that has to be handled by construction rather than left
 * to whoever remembers.
 *
 * Scroll linking uses `useScroll` plus `useTransform`, which are hooks — code, not
 * props. So the model describes the *intent* and the generator writes the hooks. The
 * alternative, letting authors write the hooks by hand, puts the animation outside
 * anything the canvas can show.
 *
 * Reduced motion is not an option here. Roughly one in three people who enable
 * `prefers-reduced-motion` do so because motion makes them ill, and a decorative
 * parallax is not worth that. The model therefore has no "ignore reduced motion"
 * setting: every scroll-linked and transform animation degrades, and the only
 * question is how.
 */

import { Type, type Static } from '@core/utils/typeboxHelpers'
import { isTransformValue, type MotionAnimation } from './motion'

/** What drives a scroll-linked value. */
export const ScrollSourceSchema = Type.Union([
  /** Progress of the whole page, 0 at top and 1 at bottom. */
  Type.Literal('page'),
  /** Progress of this element passing through the viewport. */
  Type.Literal('element'),
])
export type ScrollSource = Static<typeof ScrollSourceSchema>

/**
 * Where the element's scroll range starts and ends.
 *
 * Motion's offset vocabulary: a pair of `<element> <viewport>` positions. The
 * default covers the element entering the bottom and leaving the top.
 */
export const ScrollOffsetSchema = Type.Object({
  start: Type.String({ maxLength: 32 }),
  end: Type.String({ maxLength: 32 }),
}, { additionalProperties: false })
export type ScrollOffset = Static<typeof ScrollOffsetSchema>

/**
 * One property driven by scroll position.
 *
 * `from` and `to` are the output range mapped across the scroll range. Both ends are
 * required because an open-ended mapping has no meaning.
 */
export const ScrollBindingSchema = Type.Object({
  /** Property to drive, e.g. `y`, `opacity`, `scale`. */
  property: Type.String({ minLength: 1, maxLength: 64 }),
  /** Output at the start of the range. */
  from: Type.Union([Type.Number(), Type.String()]),
  /** Output at the end of the range. */
  to: Type.Union([Type.Number(), Type.String()]),
  /**
   * Smooth the value with a spring rather than tracking scroll exactly.
   * Wired to `useSpring`, which is what stops a parallax feeling jittery.
   */
  smooth: Type.Optional(Type.Boolean()),
}, { additionalProperties: false })
export type ScrollBinding = Static<typeof ScrollBindingSchema>

/**
 * How an animation degrades when the visitor asks for reduced motion.
 *
 * There is no option to ignore the preference. `transforms-only` is the default
 * because movement is what causes harm, while a cross-fade generally does not — so
 * dropping transforms and keeping opacity preserves the intent of most animations
 * without the cost.
 */
export const ReducedMotionPolicySchema = Type.Union([
  /** Drop transforms, keep opacity and colour. The default. */
  Type.Literal('transforms-only'),
  /** Skip the animation entirely and render the final state. */
  Type.Literal('disable'),
], { default: 'transforms-only' })
export type ReducedMotionPolicy = Static<typeof ReducedMotionPolicySchema>

export const ScrollAnimationSchema = Type.Object({
  source: ScrollSourceSchema,
  offset: Type.Optional(ScrollOffsetSchema),
  bindings: Type.Array(ScrollBindingSchema, { minItems: 1, maxItems: 8 }),
  /**
   * How this degrades under reduced motion. Scroll-linked movement is the most
   * common trigger for motion sickness, so `disable` is the default here even
   * though `transforms-only` is the default elsewhere.
   */
  reducedMotion: Type.Optional(ReducedMotionPolicySchema),
}, { additionalProperties: false })
export type ScrollAnimation = Static<typeof ScrollAnimationSchema>

/** Motion's default scroll offset, matching its documented behaviour. */
export const DEFAULT_SCROLL_OFFSET: ScrollOffset = Object.freeze({
  start: 'start end',
  end: 'end start',
})

/**
 * Split a target into the parts reduced motion keeps and drops.
 *
 * Transforms move things and are what cause harm; opacity and colour do not. This is
 * what makes `transforms-only` a real degradation rather than a blunt off switch.
 */
export function splitForReducedMotion(
  target: Record<string, unknown>,
): { kept: Record<string, unknown>, dropped: readonly string[] } {
  const kept: Record<string, unknown> = {}
  const dropped: string[] = []
  for (const [property, value] of Object.entries(target)) {
    if (isTransformValue(property)) {
      dropped.push(property)
      continue
    }
    kept[property] = value
  }
  return { kept, dropped: Object.freeze(dropped) }
}

/**
 * The animation to use when the visitor prefers reduced motion.
 *
 * Returns null when the animation should not run at all. Under `transforms-only` the
 * final state still has to be reachable, so the *initial* transform is dropped as
 * well — otherwise an element that animates in from `opacity: 0, y: 20` would keep
 * the offset permanently and sit in the wrong place.
 */
export function reduceAnimation(
  animation: MotionAnimation,
  policy: ReducedMotionPolicy = 'transforms-only',
): MotionAnimation | null {
  if (policy === 'disable') return null

  const reduceState = (value: unknown): unknown => {
    if (typeof value !== 'object' || value === null) return value
    return splitForReducedMotion(value as Record<string, unknown>).kept
  }

  const reduced: MotionAnimation = {
    ...animation,
    ...(animation.initial !== undefined && typeof animation.initial === 'object'
      ? { initial: reduceState(animation.initial) as MotionAnimation['initial'] }
      : {}),
    ...(animation.animate !== undefined
      ? { animate: reduceState(animation.animate) as MotionAnimation['animate'] }
      : {}),
    ...(animation.exit !== undefined
      ? { exit: reduceState(animation.exit) as MotionAnimation['exit'] }
      : {}),
    ...(animation.variants
      ? {
        variants: Object.fromEntries(
          Object.entries(animation.variants).map(([name, state]) => [name, {
            ...state,
            target: splitForReducedMotion(state.target).kept as typeof state.target,
          }]),
        ),
      }
      : {}),
  }

  // Dragging and layout animation are movement by definition, so neither survives.
  delete (reduced as { drag?: unknown }).drag
  delete (reduced as { layout?: unknown }).layout

  return reduced
}

/**
 * Whether an animation still does anything after reduction.
 *
 * A purely transform-based animation reduces to nothing, and emitting an empty
 * Motion element would clientize the module for no benefit.
 */
export function hasEffectAfterReduction(
  animation: MotionAnimation,
  policy: ReducedMotionPolicy = 'transforms-only',
): boolean {
  const reduced = reduceAnimation(animation, policy)
  if (!reduced) return false

  // A state may be a target object, a variant name, or a boolean. Only an object
  // can be empty in a way that means "nothing left to animate"; a variant name
  // still refers to something.
  const stateHasEffect = (state: unknown): boolean => {
    if (typeof state === 'string') return true
    if (typeof state !== 'object' || state === null) return false
    return Object.keys(state as Record<string, unknown>).length > 0
  }

  if ([reduced.initial, reduced.animate, reduced.exit].some(stateHasEffect)) return true
  return Object.values(reduced.variants ?? {})
    .some((state) => Object.keys(state.target).length > 0)
}

/**
 * Generate the hooks a scroll-linked animation needs.
 *
 * Emitted as source because `useScroll` and `useTransform` are hooks. The reduced
 * motion check is emitted alongside rather than left to the author: `useReducedMotion`
 * gates the mapping, so the preference is respected by construction.
 */
export function scrollHookSource(
  animation: ScrollAnimation,
  options: { refName?: string, indent?: string } = {},
): { hooks: readonly string[], style: readonly string[], imports: readonly string[] } {
  const refName = options.refName ?? 'scrollRef'
  const offset = animation.offset ?? DEFAULT_SCROLL_OFFSET
  const policy = animation.reducedMotion ?? 'disable'

  const imports = new Set(['useScroll', 'useTransform', 'useReducedMotion'])
  const hooks: string[] = []
  const style: string[] = []

  hooks.push('const prefersReducedMotion = useReducedMotion()')
  if (animation.source === 'element') {
    hooks.push(`const ${refName} = useRef<HTMLDivElement>(null)`)
    hooks.push(
      `const { scrollYProgress } = useScroll({ target: ${refName}, `
      + `offset: [${JSON.stringify(offset.start)}, ${JSON.stringify(offset.end)}] })`,
    )
  } else {
    hooks.push('const { scrollYProgress } = useScroll()')
  }

  for (const binding of animation.bindings) {
    const name = `${binding.property}Scroll`
    hooks.push(
      `const ${name} = useTransform(scrollYProgress, [0, 1], `
      + `[${JSON.stringify(binding.from)}, ${JSON.stringify(binding.to)}])`,
    )
    if (binding.smooth) {
      imports.add('useSpring')
      hooks.push(
        `const ${name}Smooth = useSpring(${name}, { stiffness: 100, damping: 30 })`,
      )
    }
    const valueName = binding.smooth ? `${name}Smooth` : name
    // The preference is applied here rather than at the hook, because hooks cannot be
    // called conditionally. Under `disable` the property falls back to undefined,
    // which leaves the element at its natural position.
    const fallback = policy === 'disable'
      ? 'undefined'
      : (isTransformValue(binding.property) ? 'undefined' : valueName)
    style.push(`${binding.property}: prefersReducedMotion ? ${fallback} : ${valueName}`)
  }

  return {
    hooks: Object.freeze(hooks),
    style: Object.freeze(style),
    imports: Object.freeze([...imports].sort()),
  }
}

/**
 * The canvas animation panel, as data.
 *
 * A panel hard-coded in JSX would drift from `MotionAnimation` the first time the model
 * gained a field. So the panel is described here and the component renders whatever it is
 * given, which means the model is the single source of truth for what is editable.
 *
 * The property this file exists to enforce: **a panel that always shows every Motion prop
 * is misleading.** `stiffness` does nothing when the transition type is `tween`, and `ease`
 * does nothing when it is `spring` — Motion ignores them silently. A designer who sets a
 * stiffness of 400 and sees no change has been lied to by the interface. Every field
 * therefore reports whether it is currently in effect, and why not when it is not.
 *
 * Presets exist because designers think in effects, not in props. "Fade up" is one
 * decision; expressing it as an initial target, an animate target and a transition is
 * three. The presets compose to exactly what a hand-written equivalent would be, so
 * nothing is hidden behind them.
 */

import {
  isTransformValue,
  requiresPresence,
  type MotionAnimation,
  type MotionTarget,
  type MotionTransition,
} from './motion'

/** Why a field is showing but has no effect. */
export type FieldInactiveReason = Readonly<{
  code:
    | 'spring-only'
    | 'tween-only'
    | 'needs-in-view-gesture'
    | 'needs-variants'
    | 'needs-presence'
    | 'needs-repeat'
    | 'needs-drag'
  message: string
}>

export type PanelField = Readonly<{
  /** Path into the animation, used by the writer. */
  key: string
  label: string
  kind: 'number' | 'text' | 'boolean' | 'enum' | 'target'
  value: unknown
  options?: readonly string[]
  min?: number
  max?: number
  step?: number
  /** Null when the field is in effect. */
  inactive: FieldInactiveReason | null
}>

export type PanelSection = Readonly<{
  id: string
  title: string
  fields: readonly PanelField[]
}>

export type AnimationPanel = Readonly<{
  sections: readonly PanelSection[]
  /**
   * Problems the author should see regardless of which section is open.
   *
   * Separate from field inactivity because these are mistakes rather than
   * irrelevance — an exit with no AnimatePresence ancestor is not a dormant field, it is
   * an animation that will never run.
   */
  warnings: readonly string[]
}>

const EASINGS = [
  'linear', 'easeIn', 'easeOut', 'easeInOut',
  'circIn', 'circOut', 'circInOut',
  'backIn', 'backOut', 'backInOut',
  'anticipate',
] as const

const springOnly: FieldInactiveReason = Object.freeze({
  code: 'spring-only',
  message: 'Only affects a spring transition. The current type is tween, so Motion ignores it.',
})

const tweenOnly: FieldInactiveReason = Object.freeze({
  code: 'tween-only',
  message: 'Only affects a tween transition. A spring derives its own curve, so easing is ignored.',
})

/**
 * Build the panel for a node's animation.
 *
 * Takes the sibling variant names so a gesture naming a variant can be offered as a
 * choice rather than typed, and the declared variant names so an unknown one is caught.
 */
export function animationPanel(
  animation: MotionAnimation,
  options: Readonly<{ hasPresenceAncestor?: boolean }> = {},
): AnimationPanel {
  const transition = animation.transition ?? {}
  const isSpring = transition.type === 'spring'
  const hasInView = animation.gestures?.whileInView !== undefined
  const repeats = transition.repeat !== undefined && transition.repeat !== 0
  const variantNames = Object.keys(animation.variants ?? {})

  const sections: PanelSection[] = [
    {
      id: 'states',
      title: 'States',
      fields: [
        field('initial', 'From', 'target', animation.initial, null),
        field('animate', 'To', 'target', animation.animate, null),
        field('exit', 'Exit', 'target', animation.exit,
          animation.exit !== undefined && options.hasPresenceAncestor === false
            ? {
              code: 'needs-presence',
              message:
                'An exit animation is only observed inside an AnimatePresence ancestor. '
                + 'Without one React removes the element immediately and the exit never plays.',
            }
            : null),
      ],
    },
    {
      id: 'timing',
      title: 'Timing',
      fields: [
        enumField('transition.type', 'Type', transition.type ?? 'tween', ['tween', 'spring', 'inertia']),
        // Duration is meaningful for both: Motion 12 accepts duration on a spring as an
        // alternative to stiffness and damping.
        numberField('transition.duration', 'Duration (s)', transition.duration, 0, 60, 0.05, null),
        numberField('transition.delay', 'Delay (s)', transition.delay, 0, 60, 0.05, null),
        {
          ...enumField('transition.ease', 'Easing', transition.ease, [...EASINGS]),
          inactive: isSpring ? tweenOnly : null,
        },
      ],
    },
    {
      id: 'spring',
      title: 'Spring',
      fields: [
        numberField('transition.stiffness', 'Stiffness', transition.stiffness, 0, 10_000, 10, isSpring ? null : springOnly),
        numberField('transition.damping', 'Damping', transition.damping, 0, 1000, 1, isSpring ? null : springOnly),
        numberField('transition.mass', 'Mass', transition.mass, 0, 100, 0.1, isSpring ? null : springOnly),
        numberField('transition.bounce', 'Bounce', transition.bounce, 0, 1, 0.05, isSpring ? null : springOnly),
      ],
    },
    {
      id: 'repeat',
      title: 'Repeat',
      fields: [
        // -1 stands for Infinity because JSON cannot carry it.
        numberField('transition.repeat', 'Count (-1 for forever)', transition.repeat, -1, 1000, 1, null),
        {
          ...enumField('transition.repeatType', 'Mode', transition.repeatType ?? 'loop', ['loop', 'reverse', 'mirror']),
          inactive: repeats ? null : {
            code: 'needs-repeat',
            message: 'Set a repeat count above zero for a repeat mode to have any effect.',
          },
        },
      ],
    },
    {
      id: 'orchestration',
      title: 'Children',
      fields: [
        numberField('transition.staggerChildren', 'Stagger (s)', transition.staggerChildren, 0, 10, 0.02,
          variantNames.length > 0 ? null : {
            code: 'needs-variants',
            message:
              'Stagger only reaches children through variants. Give this element named '
              + 'variants and the same names to its children, or nothing is staggered.',
          }),
        numberField('transition.delayChildren', 'Delay children (s)', transition.delayChildren, 0, 60, 0.05,
          variantNames.length > 0 ? null : {
            code: 'needs-variants',
            message: 'Only applies to children driven by a variant on this element.',
          }),
        enumField('transition.when', 'Order', transition.when ?? 'beforeChildren', ['beforeChildren', 'afterChildren']),
      ],
    },
    {
      id: 'inView',
      title: 'In view',
      fields: [
        booleanField('inView.once', 'Only once', animation.inView?.once,
          hasInView ? null : needsInView()),
        numberField('inView.amount', 'Visible amount', animation.inView?.amount, 0, 1, 0.05,
          hasInView ? null : needsInView()),
        {
          ...textField('inView.margin', 'Viewport margin', animation.inView?.margin),
          inactive: hasInView ? null : needsInView(),
        },
      ],
    },
    {
      id: 'layout',
      title: 'Layout',
      fields: [
        enumField('layout', 'Animate layout', String(animation.layout ?? 'false'), ['false', 'true', 'position', 'size']),
        textField('layoutId', 'Shared id', animation.layoutId),
        enumField('drag', 'Drag', String(animation.drag ?? 'false'), ['false', 'true', 'x', 'y']),
      ],
    },
  ]

  return Object.freeze({
    sections: Object.freeze(sections.map((section) => Object.freeze({
      ...section,
      fields: Object.freeze(section.fields),
    }))),
    warnings: Object.freeze(collectWarnings(animation, options)),
  })
}

function needsInView(): FieldInactiveReason {
  return Object.freeze({
    code: 'needs-in-view-gesture',
    message:
      'These options configure the whileInView trigger. Add a whileInView gesture first, '
      + 'or they are read by nothing.',
  })
}

function collectWarnings(
  animation: MotionAnimation,
  options: Readonly<{ hasPresenceAncestor?: boolean }>,
): string[] {
  const warnings: string[] = []

  if (requiresPresence(animation) && options.hasPresenceAncestor === false) {
    warnings.push(
      'This element has an exit animation but no AnimatePresence ancestor, so the exit '
      + 'will never play. Declare presence on the parent that removes it.',
    )
  }

  // A variant name that resolves to nothing is Motion's quietest failure: no error, no
  // animation.
  for (const name of [animation.initial, animation.animate, animation.exit]) {
    if (typeof name !== 'string') continue
    if (animation.variants?.[name] === undefined) {
      warnings.push(
        `"${name}" is used as a variant name but is not declared in this element's variants. `
        + 'Motion does not warn about this; the element simply does not animate. It may be '
        + 'inherited from a parent, which is valid — confirm the parent declares it.',
      )
    }
  }

  if (animation.transition?.staggerChildren !== undefined
    && Object.keys(animation.variants ?? {}).length === 0) {
    warnings.push(
      'A stagger is set but this element has no variants, so it has no way to drive its '
      + 'children. Stagger propagates through variant names only.',
    )
  }

  return warnings
}

function field(
  key: string,
  label: string,
  kind: PanelField['kind'],
  value: unknown,
  inactive: FieldInactiveReason | null,
): PanelField {
  return Object.freeze({ key, label, kind, value, inactive })
}

function numberField(
  key: string,
  label: string,
  value: number | undefined,
  min: number,
  max: number,
  step: number,
  inactive: FieldInactiveReason | null,
): PanelField {
  return Object.freeze({ key, label, kind: 'number', value, min, max, step, inactive })
}

function enumField(
  key: string,
  label: string,
  value: unknown,
  options: readonly string[],
): PanelField {
  return Object.freeze({
    key, label, kind: 'enum', value, options: Object.freeze([...options]), inactive: null,
  })
}

function booleanField(
  key: string,
  label: string,
  value: boolean | undefined,
  inactive: FieldInactiveReason | null,
): PanelField {
  return Object.freeze({ key, label, kind: 'boolean', value, inactive })
}

function textField(key: string, label: string, value: string | undefined): PanelField {
  return Object.freeze({ key, label, kind: 'text', value, inactive: null })
}

/* Presets. */

export type AnimationPreset = Readonly<{
  id: string
  title: string
  /** What the preset produces. Stated so nothing is hidden behind the name. */
  describe: string
  build: () => MotionAnimation
}>

/** Distance a slide travels, in pixels. Small enough to read as motion, not as a jump. */
const SLIDE = 24

function entrance(from: MotionTarget): MotionAnimation {
  return {
    initial: { opacity: 0, ...from },
    // Every transform returns to its identity value rather than being omitted: leaving
    // `y` out of animate makes Motion animate to the element's computed style, which is
    // usually right but silently differs once a class sets a transform.
    animate: { opacity: 1, ...identityOf(from) },
    transition: { duration: 0.4, ease: 'easeOut' },
  }
}

/** The resting value for each transform in a target. */
function identityOf(target: MotionTarget): MotionTarget {
  const identity: Record<string, number> = {}
  for (const property of Object.keys(target)) {
    if (!isTransformValue(property)) continue
    identity[property] = property === 'scale' || property === 'scaleX' || property === 'scaleY'
      ? 1
      : 0
  }
  return identity
}

export const ANIMATION_PRESETS: readonly AnimationPreset[] = Object.freeze([
  {
    id: 'fade-in',
    title: 'Fade in',
    describe: 'Opacity 0 to 1 over 0.4s.',
    build: (): MotionAnimation => entrance({}),
  },
  {
    id: 'fade-up',
    title: 'Fade up',
    describe: `Opacity 0 to 1 while moving up ${SLIDE}px over 0.4s.`,
    build: (): MotionAnimation => entrance({ y: SLIDE }),
  },
  {
    id: 'fade-down',
    title: 'Fade down',
    describe: `Opacity 0 to 1 while moving down ${SLIDE}px over 0.4s.`,
    build: (): MotionAnimation => entrance({ y: -SLIDE }),
  },
  {
    id: 'scale-in',
    title: 'Scale in',
    describe: 'Opacity 0 to 1 while scaling from 0.95 over 0.4s.',
    build: (): MotionAnimation => entrance({ scale: 0.95 }),
  },
  {
    id: 'slide-in-left',
    title: 'Slide in from left',
    describe: `Opacity 0 to 1 while moving in ${SLIDE}px from the left.`,
    build: (): MotionAnimation => entrance({ x: -SLIDE }),
  },
  {
    id: 'spring-in',
    title: 'Spring in',
    describe: `Springs up ${SLIDE}px with a soft bounce rather than a fixed duration.`,
    build: (): MotionAnimation => ({
      initial: { opacity: 0, y: SLIDE },
      animate: { opacity: 1, y: 0 },
      transition: { type: 'spring', stiffness: 300, damping: 24 },
    }),
  },
  {
    id: 'stagger-children',
    title: 'Stagger children',
    describe:
      'Declares hidden and visible variants on this element with a 0.08s stagger. Children '
      + 'need the same variant names to participate.',
    build: (): MotionAnimation => ({
      initial: 'hidden',
      animate: 'visible',
      variants: {
        hidden: { target: { opacity: 0 } },
        visible: { target: { opacity: 1 } },
      },
      transition: { staggerChildren: 0.08, delayChildren: 0.1 },
    }),
  },
  {
    id: 'on-scroll',
    title: 'Reveal on scroll',
    describe: `Fades and moves up ${SLIDE}px the first time 30% of it enters view.`,
    build: (): MotionAnimation => ({
      initial: { opacity: 0, y: SLIDE },
      gestures: { whileInView: { target: { opacity: 1, y: 0 } } },
      inView: { once: true, amount: 0.3 },
      transition: { duration: 0.5, ease: 'easeOut' },
    }),
  },
])

export type PresetApplication = Readonly<{
  animation: MotionAnimation
  /**
   * Set when the preset replaced work already there.
   *
   * Applying a preset over a hand-tuned animation is destructive, and doing it silently
   * means the author loses their work with no signal. The caller decides whether to
   * confirm; this only reports.
   */
  replaced: string | null
}>

/** Apply a preset, reporting whether it displaced an existing animation. */
export function applyPreset(
  presetId: string,
  existing: MotionAnimation,
): PresetApplication | null {
  const preset = ANIMATION_PRESETS.find((candidate) => candidate.id === presetId)
  if (!preset) return null

  return Object.freeze({
    animation: preset.build(),
    replaced: describesAnyAnimation(existing)
      ? 'The preset replaced the animation already on this element.'
      : null,
  })
}

/** Whether an animation says anything at all. */
export function describesAnyAnimation(animation: MotionAnimation): boolean {
  return Object.keys(animation).length > 0
}

/**
 * Write one panel field back into the animation.
 *
 * Returns a new animation. Keeping this beside the reader is what stops the panel
 * writing a field the reader would not have shown.
 *
 * A field cleared to `undefined` is removed rather than stored as undefined, so a
 * round trip through the generator does not emit `duration: undefined`.
 */
export function setPanelField(
  animation: MotionAnimation,
  key: string,
  value: unknown,
): MotionAnimation {
  if (key.startsWith('transition.')) {
    return withTransition(animation, key.slice('transition.'.length), value)
  }
  if (key.startsWith('inView.')) {
    return withInView(animation, key.slice('inView.'.length), value)
  }
  return withTop(animation, key, value)
}

function prune<T extends object>(source: T): T | undefined {
  const entries = Object.entries(source).filter(([, entryValue]) => entryValue !== undefined)
  return entries.length === 0 ? undefined : Object.fromEntries(entries) as T
}

function withTransition(
  animation: MotionAnimation,
  property: string,
  value: unknown,
): MotionAnimation {
  const transition = prune({
    ...(animation.transition ?? {}),
    [property]: value,
  } as MotionTransition)
  const next = { ...animation, transition }
  if (transition === undefined) delete next.transition
  return next
}

function withInView(
  animation: MotionAnimation,
  property: string,
  value: unknown,
): MotionAnimation {
  const inView = prune({ ...(animation.inView ?? {}), [property]: value })
  const next = { ...animation, inView }
  if (inView === undefined) delete next.inView
  return next
}

function withTop(animation: MotionAnimation, key: string, value: unknown): MotionAnimation {
  const next = { ...animation, [key]: normaliseTop(key, value) }
  if (next[key as keyof MotionAnimation] === undefined) {
    delete next[key as keyof MotionAnimation]
  }
  return next
}

/**
 * Convert the string an enum control produces back into the model's own type.
 *
 * `layout` and `drag` are unions of boolean and string literals, and a select control can
 * only hand back a string. Storing the string `"false"` would make `layout` truthy, which
 * is the opposite of what the author chose.
 */
function normaliseTop(key: string, value: unknown): unknown {
  if (key !== 'layout' && key !== 'drag') return value
  if (value === 'false' || value === false) return undefined
  if (value === 'true' || value === true) return true
  return value
}

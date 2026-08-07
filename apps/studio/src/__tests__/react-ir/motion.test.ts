import { describe, it, expect } from 'bun:test'
import { Value } from '@core/utils/typeboxHelpers'
import {
  MotionAnimationSchema,
  MotionTransitionSchema,
  isTransformValue,
  orchestratesChildren,
  referencedVariantNames,
  requiresClient,
  requiresPresence,
  undeclaredVariantNames,
  type MotionAnimation,
} from '@core/react-ir/motion'

describe('Motion model contracts', () => {
  it('accepts a plain enter animation', () => {
    const animation: MotionAnimation = {
      initial: { opacity: 0, y: 12 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.3, ease: 'easeOut' },
    }
    expect(Value.Check(MotionAnimationSchema, animation)).toBe(true)
  })

  it('accepts keyframes including the wildcard', () => {
    // A leading null means "start from the current value", which is what keeps an
    // interrupted animation from jumping.
    expect(Value.Check(MotionAnimationSchema, {
      animate: { x: [null, 100, 0] },
    })).toBe(true)
  })

  it('accepts a cubic bezier as four control points', () => {
    expect(Value.Check(MotionTransitionSchema, { ease: [0.4, 0, 0.2, 1] })).toBe(true)
    expect(Value.Check(MotionTransitionSchema, { ease: [0.4, 0, 0.2] })).toBe(false)
  })

  it('accepts spring parameters', () => {
    expect(Value.Check(MotionTransitionSchema, {
      type: 'spring', stiffness: 300, damping: 30, mass: 1,
    })).toBe(true)
  })

  it('accepts initial false to disable the enter animation', () => {
    expect(Value.Check(MotionAnimationSchema, { initial: false, animate: { y: 0 } })).toBe(true)
  })

  it('accepts a gesture naming a variant', () => {
    // Hovering a parent driving children's own hover states cannot be expressed
    // with per-element targets, so a gesture must accept a variant name.
    expect(Value.Check(MotionAnimationSchema, {
      variants: { hovered: { target: { scale: 1.05 } } },
      gestures: { whileHover: 'hovered' },
    })).toBe(true)
  })

  it('rejects a property bag it does not model', () => {
    expect(Value.Check(MotionAnimationSchema, { onAnimationComplete: 'run' })).toBe(false)
  })
})

describe('transform values', () => {
  it('knows transforms from CSS properties', () => {
    // Motion animates each transform axis independently, which is why a gesture can
    // scale something while an entrance is still translating it.
    for (const property of ['x', 'y', 'scale', 'rotate', 'skewX', 'originX']) {
      expect(isTransformValue(property)).toBe(true)
    }
    for (const property of ['opacity', 'backgroundColor', 'filter']) {
      expect(isTransformValue(property)).toBe(false)
    }
  })
})

describe('client boundary', () => {
  it('requires the client for any real animation', () => {
    expect(requiresClient({ animate: { opacity: 1 } })).toBe(true)
    expect(requiresClient({ layout: true })).toBe(true)
    expect(requiresClient({ drag: 'x' })).toBe(true)
  })

  it('does not clientize a node carrying nothing', () => {
    // An empty animation object must not turn a server component into a client one,
    // or one stray node would clientize a whole route.
    expect(requiresClient({})).toBe(false)
    expect(requiresClient({ transition: { duration: 0.2 } })).toBe(false)
  })
})

describe('presence requirement', () => {
  it('flags an exit animation as needing AnimatePresence', () => {
    // Without an AnimatePresence ancestor an exit animation never runs, and React
    // removes the element instantly instead.
    expect(requiresPresence({ exit: { opacity: 0 } })).toBe(true)
    expect(requiresPresence({ variants: { exit: { target: { opacity: 0 } } } })).toBe(true)
  })

  it('does not flag an animation without one', () => {
    expect(requiresPresence({ animate: { opacity: 1 } })).toBe(false)
  })
})

describe('orchestration', () => {
  it('detects stagger and ordering on the parent', () => {
    // These only work on the parent's transition, so the panel has to show them
    // there rather than on each child.
    expect(orchestratesChildren({
      transition: { staggerChildren: 0.08 },
    })).toBe(true)
    expect(orchestratesChildren({
      variants: { visible: { target: { opacity: 1 }, transition: { when: 'beforeChildren' } } },
    })).toBe(true)
    expect(orchestratesChildren({
      transition: { delayChildren: 0.2 },
    })).toBe(true)
  })

  it('does not claim orchestration for an ordinary transition', () => {
    expect(orchestratesChildren({ transition: { duration: 0.3 } })).toBe(false)
  })
})

describe('variant references', () => {
  it('collects every referenced name', () => {
    const animation: MotionAnimation = {
      initial: 'hidden',
      animate: 'visible',
      exit: 'hidden',
      gestures: { whileHover: 'hovered' },
      variants: {
        hidden: { target: { opacity: 0 } },
        visible: { target: { opacity: 1 } },
        hovered: { target: { scale: 1.05 } },
      },
    }
    expect([...referencedVariantNames(animation)].sort()).toEqual(['hidden', 'hovered', 'visible'])
    expect(undeclaredVariantNames(animation)).toEqual([])
  })

  it('reports a name that was never declared', () => {
    // Motion fails silently on an unknown variant name — the element simply does
    // not animate, with nothing logged. Surfacing it is what makes the mistake
    // fixable rather than mysterious.
    const animation: MotionAnimation = {
      animate: 'visible',
      variants: { hidden: { target: { opacity: 0 } } },
    }
    expect(undeclaredVariantNames(animation)).toEqual(['visible'])
  })

  it('ignores inline targets, which reference nothing', () => {
    expect(referencedVariantNames({ animate: { opacity: 1 } })).toEqual([])
  })
})

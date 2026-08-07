import { describe, it, expect } from 'bun:test'
import { Value } from '@core/utils/typeboxHelpers'
import {
  DEFAULT_SCROLL_OFFSET,
  ScrollAnimationSchema,
  hasEffectAfterReduction,
  reduceAnimation,
  scrollHookSource,
  splitForReducedMotion,
  type ScrollAnimation,
} from '@core/react-ir/scroll'
import type { MotionAnimation } from '@core/react-ir/motion'

describe('reduced motion policy', () => {
  it('separates transforms from properties that do not move anything', () => {
    // Movement is what causes harm; a cross-fade generally does not. That is what
    // makes transforms-only a real degradation rather than an off switch.
    const { kept, dropped } = splitForReducedMotion({
      opacity: 1, y: 20, scale: 1.1, backgroundColor: '#fff',
    })
    expect(kept).toEqual({ opacity: 1, backgroundColor: '#fff' })
    expect([...dropped].sort()).toEqual(['scale', 'y'])
  })

  it('keeps the fade and drops the movement', () => {
    const animation: MotionAnimation = {
      initial: { opacity: 0, y: 24 },
      animate: { opacity: 1, y: 0 },
    }
    const reduced = reduceAnimation(animation)
    expect(reduced?.initial).toEqual({ opacity: 0 })
    expect(reduced?.animate).toEqual({ opacity: 1 })
  })

  it('drops the initial transform too, so nothing is left displaced', () => {
    // Keeping `y: 24` on initial while dropping it from animate would leave the
    // element permanently offset — worse than no animation at all.
    const reduced = reduceAnimation({ initial: { y: 24 }, animate: { y: 0 } })
    expect(reduced?.initial).toEqual({})
    expect(reduced?.animate).toEqual({})
  })

  it('reduces inside variants as well', () => {
    const reduced = reduceAnimation({
      variants: {
        hidden: { target: { opacity: 0, y: 12 } },
        visible: { target: { opacity: 1, y: 0 } },
      },
    })
    expect(reduced?.variants?.['hidden']?.target).toEqual({ opacity: 0 })
    expect(reduced?.variants?.['visible']?.target).toEqual({ opacity: 1 })
  })

  it('removes drag and layout, which are movement by definition', () => {
    const reduced = reduceAnimation({ animate: { opacity: 1 }, drag: 'x', layout: true })
    expect(reduced?.drag).toBeUndefined()
    expect(reduced?.layout).toBeUndefined()
  })

  it('returns nothing at all under the disable policy', () => {
    expect(reduceAnimation({ animate: { opacity: 1 } }, 'disable')).toBeNull()
  })

  it('reports when a reduced animation would do nothing', () => {
    // A purely transform-based animation reduces to nothing, and emitting an empty
    // Motion element would clientize the module for no benefit.
    expect(hasEffectAfterReduction({ initial: { y: 20 }, animate: { y: 0 } })).toBe(false)
    expect(hasEffectAfterReduction({ initial: { opacity: 0 }, animate: { opacity: 1 } })).toBe(true)
    expect(hasEffectAfterReduction({ animate: { opacity: 1 } }, 'disable')).toBe(false)
  })

  it('has no policy that ignores the preference', () => {
    // Deliberate: there is no escape hatch, because a decorative parallax is not
    // worth making somebody ill.
    expect(Value.Check(ScrollAnimationSchema, {
      source: 'element',
      bindings: [{ property: 'y', from: 0, to: -100 }],
      reducedMotion: 'ignore',
    })).toBe(false)
  })
})

describe('scroll animation model', () => {
  it('accepts a page-progress binding', () => {
    expect(Value.Check(ScrollAnimationSchema, {
      source: 'page',
      bindings: [{ property: 'scaleX', from: 0, to: 1 }],
    })).toBe(true)
  })

  it('requires at least one binding', () => {
    // A scroll animation that drives nothing is a mistake, not a default.
    expect(Value.Check(ScrollAnimationSchema, { source: 'page', bindings: [] })).toBe(false)
  })

  it('defaults the offset to Motion’s own range', () => {
    expect(DEFAULT_SCROLL_OFFSET).toEqual({ start: 'start end', end: 'end start' })
  })
})

describe('generating scroll hooks', () => {
  const parallax: ScrollAnimation = {
    source: 'element',
    bindings: [{ property: 'y', from: 0, to: -80 }],
  }

  it('emits useScroll targeted at the element with its offset', () => {
    const { hooks, imports } = scrollHookSource(parallax)
    expect(hooks.some((line) => line.includes('useRef<HTMLDivElement>(null)'))).toBe(true)
    expect(hooks.some((line) =>
      line.includes('useScroll({ target: scrollRef, offset: ["start end", "end start"] })')))
      .toBe(true)
    expect(imports).toContain('useScroll')
    expect(imports).toContain('useTransform')
  })

  it('emits page progress without a ref when the source is the page', () => {
    const { hooks } = scrollHookSource({
      source: 'page',
      bindings: [{ property: 'scaleX', from: 0, to: 1 }],
    })
    expect(hooks.some((line) => line.includes('useScroll()'))).toBe(true)
    expect(hooks.some((line) => line.includes('useRef'))).toBe(false)
  })

  it('maps the scroll range onto the output range', () => {
    const { hooks } = scrollHookSource(parallax)
    expect(hooks.some((line) =>
      line.includes('useTransform(scrollYProgress, [0, 1], [0, -80])'))).toBe(true)
  })

  it('adds a spring when smoothing is asked for', () => {
    // Tracking scroll exactly is what makes a parallax feel jittery.
    const { hooks, imports } = scrollHookSource({
      source: 'page',
      bindings: [{ property: 'y', from: 0, to: -80, smooth: true }],
    })
    expect(imports).toContain('useSpring')
    expect(hooks.some((line) => line.includes('useSpring(yScroll'))).toBe(true)
  })

  it('always gates on the reduced motion preference', () => {
    // Emitted by construction rather than left to the author to remember.
    const { hooks, style, imports } = scrollHookSource(parallax)
    expect(imports).toContain('useReducedMotion')
    expect(hooks).toContain('const prefersReducedMotion = useReducedMotion()')
    expect(style[0]).toBe('y: prefersReducedMotion ? undefined : yScroll')
  })

  it('keeps a non-transform binding under the transforms-only policy', () => {
    // Opacity driven by scroll does not move anything, so it can survive.
    const { style } = scrollHookSource({
      source: 'page',
      bindings: [{ property: 'opacity', from: 0, to: 1 }],
      reducedMotion: 'transforms-only',
    })
    expect(style[0]).toBe('opacity: prefersReducedMotion ? opacityScroll : opacityScroll')
  })

  it('drops even a non-transform binding under disable', () => {
    const { style } = scrollHookSource({
      source: 'page',
      bindings: [{ property: 'opacity', from: 0, to: 1 }],
      reducedMotion: 'disable',
    })
    expect(style[0]).toBe('opacity: prefersReducedMotion ? undefined : opacityScroll')
  })
})

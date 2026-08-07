import { describe, it, expect } from 'bun:test'
import {
  isMinWidth,
  maxWidthOf,
  planMobileFirstMigration,
  resolveLegacyRanges,
  retargetClassToken,
  variantForContext,
  type LegacyContext,
} from '@core/react-ir/breakpoints'

/** The shipped defaults, which are what real sites actually carry. */
const SHIPPED: readonly LegacyContext[] = [
  { id: 'mobile', label: 'Mobile', width: 375, mediaQuery: '(max-width: 375px)' },
  { id: 'tablet', label: 'Tablet', width: 768, mediaQuery: '(max-width: 768px)' },
  { id: 'desktop', label: 'Desktop', width: 1440, mediaQuery: '(max-width: 1440px)' },
]

describe('reading a legacy context', () => {
  it('reads a plain max-width query', () => {
    expect(maxWidthOf({ id: 'a', label: 'A', width: 768, mediaQuery: '(max-width: 768px)' }))
      .toBe(768)
  })

  it('defaults a context with no query to max-width at its own frame width', () => {
    // That was the legacy default, so a row without a query is not unconditional.
    expect(maxWidthOf({ id: 'a', label: 'A', width: 900 })).toBe(900)
  })

  it('returns null for a query it cannot invert', () => {
    expect(maxWidthOf({
      id: 'a', label: 'A', width: 768,
      mediaQuery: '(min-width: 400px) and (max-width: 768px)',
    })).toBeNull()
  })

  it('recognises a context that is already mobile-first', () => {
    expect(isMinWidth({ id: 'a', label: 'A', width: 768, mediaQuery: '(min-width: 768px)' }))
      .toBe(true)
  })
})

describe('resolving what each context governed', () => {
  it('derives contiguous ranges from the widths', () => {
    expect(resolveLegacyRanges(SHIPPED)).toEqual([
      { from: 0, to: 375, sourceContextId: 'mobile' },
      { from: 376, to: 768, sourceContextId: 'tablet' },
      { from: 769, to: 1440, sourceContextId: 'desktop' },
      { from: 1441, to: null, sourceContextId: null },
    ])
  })

  it('gives the unconditional base the range above the widest context', () => {
    // The part that catches people: with a max-width on the widest context, the
    // unconditional base only applied above it.
    const ranges = resolveLegacyRanges(SHIPPED)
    const base = ranges.find((range) => range.sourceContextId === null)
    expect(base).toEqual({ from: 1441, to: null, sourceContextId: null })
  })

  it('treats a site with no max-width contexts as base-only', () => {
    expect(resolveLegacyRanges([
      { id: 'a', label: 'A', width: 768, mediaQuery: '(min-width: 768px)' },
    ])).toEqual([{ from: 0, to: null, sourceContextId: null }])
  })

  it('sorts unordered contexts before deriving ranges', () => {
    const shuffled = [SHIPPED[2]!, SHIPPED[0]!, SHIPPED[1]!]
    expect(resolveLegacyRanges(shuffled)[0]?.sourceContextId).toBe('mobile')
  })
})

describe('planning the migration', () => {
  it('makes the narrowest context the unprefixed base', () => {
    // Not the old unconditional base: at the smallest viewport the narrowest
    // max-width context is what actually won.
    const plan = planMobileFirstMigration(SHIPPED)
    expect(plan.stops[0]).toEqual({ variant: null, minWidth: 0, sourceContextId: 'mobile' })
  })

  it('makes the original base the widest stop', () => {
    const plan = planMobileFirstMigration(SHIPPED)
    const last = plan.stops[plan.stops.length - 1]
    expect(last?.sourceContextId).toBeNull()
    expect(last?.minWidth).toBe(1441)
  })

  it('starts each stop one pixel above the previous boundary', () => {
    // An off-by-one here leaves a one-pixel viewport with no styles at all.
    const plan = planMobileFirstMigration(SHIPPED)
    expect(plan.stops.map((stop) => stop.minWidth)).toEqual([0, 376, 769, 1441])
  })

  it('snaps a near-conventional width onto a Tailwind screen name', () => {
    // The generated classes are what people read afterwards, so md: beats
    // min-[769px]: when the width is close enough to mean the same thing.
    const plan = planMobileFirstMigration([
      { id: 'small', label: 'Small', width: 639, mediaQuery: '(max-width: 639px)' },
      { id: 'medium', label: 'Medium', width: 767, mediaQuery: '(max-width: 767px)' },
    ])
    expect(plan.stops[1]?.variant).toBe('sm')
    expect(plan.stops[2]?.variant).toBe('md')
  })

  it('uses an arbitrary variant when no conventional screen is close', () => {
    // Better explicit than implying the site uses standard breakpoints.
    const plan = planMobileFirstMigration([
      { id: 'a', label: 'A', width: 300, mediaQuery: '(max-width: 300px)' },
    ])
    expect(plan.stops[1]?.variant).toBe('min-[301px]')
  })

  it('declares screens only for conventional variants', () => {
    const plan = planMobileFirstMigration([
      { id: 'small', label: 'Small', width: 639, mediaQuery: '(max-width: 639px)' },
      { id: 'odd', label: 'Odd', width: 900, mediaQuery: '(max-width: 900px)' },
    ])
    expect(plan.screens).toEqual({ sm: '640px' })
  })

  it('never assigns one Tailwind name to two stops', () => {
    const plan = planMobileFirstMigration([
      { id: 'a', label: 'A', width: 636, mediaQuery: '(max-width: 636px)' },
      { id: 'b', label: 'B', width: 645, mediaQuery: '(max-width: 645px)' },
    ])
    const variants = plan.stops.map((stop) => stop.variant).filter((variant) => variant !== null)
    expect(new Set(variants).size).toBe(variants.length)
  })

  it('reports a query it cannot invert rather than guessing', () => {
    const plan = planMobileFirstMigration([
      {
        id: 'weird', label: 'Weird', width: 768,
        mediaQuery: '(min-width: 400px) and (max-width: 768px)',
      },
    ])
    expect(plan.unsupported[0]?.contextId).toBe('weird')
    expect(plan.unsupported[0]?.reason).toMatch(/by hand/)
  })

  it('does not report an already mobile-first context as unsupported', () => {
    const plan = planMobileFirstMigration([
      { id: 'a', label: 'A', width: 768, mediaQuery: '(min-width: 768px)' },
    ])
    expect(plan.unsupported).toEqual([])
  })
})

describe('placing a context’s declarations', () => {
  it('maps the narrowest context to the base', () => {
    expect(variantForContext(planMobileFirstMigration(SHIPPED), 'mobile')).toBeNull()
  })

  it('maps the middle context to its variant', () => {
    const plan = planMobileFirstMigration(SHIPPED)
    expect(variantForContext(plan, 'tablet')).toBe('min-[376px]')
  })

  it('maps the old base to the widest variant', () => {
    const plan = planMobileFirstMigration(SHIPPED)
    expect(variantForContext(plan, null)).toBe('min-[1441px]')
  })

  it('throws for a context the plan cannot place', () => {
    // Silently dropping its styles would change the site without saying so.
    expect(() => variantForContext(planMobileFirstMigration(SHIPPED), 'ghost'))
      .toThrow(/silently drop/)
  })
})

describe('retargeting a class token', () => {
  it('leaves a base token alone', () => {
    expect(retargetClassToken('p-4', null)).toBe('p-4')
  })

  it('prefixes the breakpoint ahead of an existing variant', () => {
    // Tailwind applies variants left to right, and md:hover: is the conventional
    // order.
    expect(retargetClassToken('hover:bg-primary', 'md')).toBe('md:hover:bg-primary')
  })

  it('carries an arbitrary variant through', () => {
    expect(retargetClassToken('p-4', 'min-[376px]')).toBe('min-[376px]:p-4')
  })
})

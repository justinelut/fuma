/**
 * The Zustand store scaffold.
 *
 * The assertions that matter are about what the generated code must NOT contain. A
 * module-level store is created once per server process and shared by every request, so one
 * visitor's state becomes the initial state of the next visitor's HTML — and that does not
 * reproduce in development, where there is only ever one visitor. So the scaffold is checked
 * for the absence of that pattern as carefully as for the presence of the right one.
 */

import { describe, it, expect } from 'bun:test'
import {
  STORE_SLICES,
  findSlice,
  providerInstructions,
  storeSource,
} from '@core/generatedSite/storeScaffold'

const both = storeSource(['Navigation', 'Cart'])

describe('the generated store avoids the cross-request leak', () => {
  it('exports a factory rather than a store instance', () => {
    expect(both).toContain('export function createSiteStore()')
  })

  it('creates no store at module scope', () => {
    // `const useStore = create(...)` at module scope is the leak. Checked as an absence
    // because that is the shape a well-meaning edit would reintroduce. Matched on `create(`
    // and `createStore(` specifically, so `createContext` is not a false positive.
    expect(both).not.toMatch(/^(export )?const \w+ = create[<(]/m)
    expect(both).not.toMatch(/^(export )?const \w+ = createStore[<(]/m)
  })

  it('creates the store inside the provider', () => {
    expect(both).toContain('storeRef.current ??= createSiteStore()')
  })

  it('uses a ref rather than state to hold it', () => {
    // useState would run the initialiser on every render in strict mode.
    expect(both).toContain('useRef<SiteStore | null>(null)')
    expect(both).not.toContain('useState(() => createSiteStore')
  })

  it('reads through context, so there is no singleton to import', () => {
    expect(both).toContain('useContext(SiteStoreContext)')
  })

  it('explains the leak in a comment, so the pattern is not undone by a tidy-up', () => {
    expect(both).toMatch(/shared by every request/)
  })
})

describe('the generated store is a client module', () => {
  it('declares use client, or the hooks cannot run', () => {
    expect(both.startsWith("'use client'")).toBe(true)
  })

  it('imports createStore and useStore rather than create', () => {
    // `create` is the singleton API; `createStore` is the factory one.
    expect(both).toContain("import { createStore, useStore } from 'zustand'")
  })
})

describe('the hook fails loudly without a provider', () => {
  it('throws rather than returning undefined', () => {
    // A component silently reading no state renders an empty version of itself and looks
    // like a data problem instead of a missing provider.
    expect(both).toContain('throw new Error(')
    expect(both).toMatch(/called outside SiteStoreProvider/)
  })

  it('names the file to change', () => {
    expect(both).toContain('app/layout.tsx')
  })
})

describe('slice selection', () => {
  it('includes only the slices asked for', () => {
    const navOnly = storeSource(['Navigation'])
    expect(navOnly).toContain('mobileNavOpen')
    expect(navOnly).not.toContain('addItem')
  })

  it('omits the cart type when the cart is not selected', () => {
    // An unused interface is a thing a tenant has to wonder about.
    expect(storeSource(['Navigation'])).not.toContain('interface CartLine')
  })

  it('declares the cart type when the cart is selected', () => {
    expect(both).toContain('interface CartLine')
  })

  it('generates an empty store when nothing is selected', () => {
    // Still worth generating: it is the seam the first real state goes into, and adding a
    // provider later means retrofitting it around an already-built tree.
    const empty = storeSource([])
    expect(empty).toContain('export function createSiteStore()')
    expect(empty).toContain('SiteStoreProvider')
  })

  it('refuses an unknown slice rather than skipping it', () => {
    // Silently omitting it produces a missing-property error somewhere else entirely.
    expect(() => storeSource(['Nonexistent'])).toThrow(/Unknown store slice/)
  })

  it('names the available slices in the refusal', () => {
    expect(() => storeSource(['Nonexistent'])).toThrow(/Navigation/)
  })

  it('preserves the order slices were requested in', () => {
    const source = storeSource(['Cart', 'Navigation'])
    expect(source.indexOf('items:')).toBeLessThan(source.indexOf('mobileNavOpen:'))
  })
})

describe('the cart slice is correct about quantities', () => {
  it('merges a repeated SKU rather than appending a second line', () => {
    // Two lines for one product show it twice and total correctly only by accident.
    expect(both).toMatch(/quantity: item\.quantity \+ line\.quantity/)
  })

  it('explains why', () => {
    expect(both).toMatch(/would\s+\/\/ show the same product twice|show the same product twice/)
  })

  it('derives the count rather than storing it', () => {
    // A stored count is a second source of truth that drifts from the items.
    expect(both).toContain('count: () => get().items.reduce(')
  })
})

describe('the slice catalogue', () => {
  it('states a reason for every slice', () => {
    for (const slice of STORE_SLICES) {
      expect(slice.reason.length).toBeGreaterThan(30)
    }
  })

  it('declares members for every slice', () => {
    for (const slice of STORE_SLICES) {
      expect(slice.stateMembers.length).toBeGreaterThan(0)
    }
  })

  it('finds a slice by name', () => {
    expect(findSlice('Cart')?.name).toBe('Cart')
    expect(findSlice('Nope')).toBeUndefined()
  })
})

describe('provider guidance', () => {
  it('tells the caller where the provider goes without rewriting their layout', () => {
    // The layout is the tenant's file; rewriting it silently is what the engine promises
    // not to do.
    const guidance = providerInstructions()
    expect(guidance).toContain('app/layout.tsx')
    expect(guidance).toContain('SiteStoreProvider')
  })
})

describe('determinism', () => {
  it('produces identical source for identical input', () => {
    expect(storeSource(['Navigation', 'Cart'])).toBe(storeSource(['Navigation', 'Cart']))
  })

  it('ends with a newline', () => {
    expect(both.endsWith('\n')).toBe(true)
  })
})

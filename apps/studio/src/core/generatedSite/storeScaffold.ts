/**
 * Zustand store scaffold for generated sites.
 *
 * The reason this is generated rather than left to whoever writes the site: **a
 * module-level Zustand store is a cross-request state leak under Next.** The obvious
 * pattern —
 *
 *   export const useStore = create<State>()(...)
 *
 * — creates the store once when the module is first imported. On the client that is
 * exactly right. On the server the module is imported once per process and shared by every
 * request, so one visitor's state becomes the initial state of the next visitor's rendered
 * HTML. With a cart or a signed-in name in the store that is a data leak, and it will not
 * reproduce in development where there is one visitor.
 *
 * So the scaffold emits the store *factory* plus a provider that creates one instance per
 * mount, and the hook reads from context. There is deliberately no exported singleton for
 * anybody to reach for.
 *
 * Slices are declared as data so a site gets only the state it uses. An empty store is
 * still worth generating: it is the seam the first real piece of state goes into, and
 * adding it later means retrofitting a provider around an already-built tree.
 */

export type StoreSlice = Readonly<{
  /** Identifier used for the slice's type name and creator function. */
  name: string
  /** Why a generated site would want it. */
  reason: string
  /** The slice's state and actions, as TypeScript members. */
  stateMembers: readonly string[]
  /** Body of the slice creator, returning the initial state and its actions. */
  creatorBody: string
}>

/**
 * Slices offered to a generated site.
 *
 * Each is genuinely client state — something that must survive a route change without a
 * round trip. Anything the server already knows belongs in a server component, not here;
 * duplicating it into a store is how two sources of truth start disagreeing.
 */
export const STORE_SLICES: readonly StoreSlice[] = Object.freeze([
  Object.freeze({
    name: 'Navigation',
    reason:
      'Whether the mobile menu is open. Client state by nature — the server has no opinion '
      + 'about it and it must survive a route change without a round trip.',
    stateMembers: Object.freeze([
      'mobileNavOpen: boolean',
      'openMobileNav: () => void',
      'closeMobileNav: () => void',
      'toggleMobileNav: () => void',
    ]),
    creatorBody: `  mobileNavOpen: false,
  openMobileNav: () => set({ mobileNavOpen: true }),
  closeMobileNav: () => set({ mobileNavOpen: false }),
  toggleMobileNav: () => set((state) => ({ mobileNavOpen: !state.mobileNavOpen })),`,
  }),
  Object.freeze({
    name: 'Cart',
    reason:
      'Line items chosen before checkout. Held on the client so adding an item does not '
      + 'need a server round trip, and reconciled against the server at checkout because a '
      + 'price the client holds is a price the client can edit.',
    stateMembers: Object.freeze([
      'items: readonly CartLine[]',
      'addItem: (line: CartLine) => void',
      'removeItem: (sku: string) => void',
      'clear: () => void',
      'count: () => number',
    ]),
    creatorBody: `  items: [],
  addItem: (line) => set((state) => {
    // Quantities merge rather than appending a second line for the same SKU, which would
    // show the same product twice and total correctly only by accident.
    const existing = state.items.find((item) => item.sku === line.sku)
    return existing
      ? {
        items: state.items.map((item) => (item.sku === line.sku
          ? { ...item, quantity: item.quantity + line.quantity }
          : item)),
      }
      : { items: [...state.items, line] }
  }),
  removeItem: (sku) => set((state) => ({
    items: state.items.filter((item) => item.sku !== sku),
  })),
  clear: () => set({ items: [] }),
  count: () => get().items.reduce((total, item) => total + item.quantity, 0),`,
  }),
])

export function findSlice(name: string): StoreSlice | undefined {
  return STORE_SLICES.find((slice) => slice.name === name)
}

/**
 * Generate the store module for a site.
 *
 * `sliceNames` selects what the site actually uses. An unknown name is refused rather than
 * skipped: silently generating a store without the slice a caller asked for produces a
 * missing-property error somewhere else entirely.
 */
export function storeSource(sliceNames: readonly string[]): string {
  const slices = sliceNames.map((name) => {
    const slice = findSlice(name)
    if (!slice) {
      throw new Error(
        `Unknown store slice "${name}". Available slices: `
        + `${STORE_SLICES.map((candidate) => candidate.name).join(', ')}.`,
      )
    }
    return slice
  })

  const stateMembers = slices.flatMap((slice) => slice.stateMembers)
  const bodies = slices.map((slice) => slice.creatorBody)
  const needsCartType = slices.some((slice) => slice.name === 'Cart')

  return `'use client'

/**
 * Client state for this site.
 *
 * There is no exported store instance here on purpose. A module-level store is created once
 * per server process and shared by every request, so one visitor's state would become the
 * initial state of the next visitor's HTML. That does not reproduce in development, where
 * there is only ever one visitor.
 *
 * Instead: a factory, a provider that creates one store per mount, and a hook that reads
 * from context.
 */

import { createContext, useContext, useRef, type ReactNode } from 'react'
import { createStore, useStore } from 'zustand'
${needsCartType ? `
export interface CartLine {
  sku: string
  name: string
  quantity: number
}
` : ''}
export interface SiteState {
${stateMembers.map((member) => `  ${member}`).join('\n')}
}

export type SiteStore = ReturnType<typeof createSiteStore>

/** Create one store. Called by the provider, never at module scope. */
export function createSiteStore() {
  return createStore<SiteState>()((set, get) => ({
${bodies.join('\n')}
  }))
}

const SiteStoreContext = createContext<SiteStore | null>(null)

export function SiteStoreProvider({ children }: { children: ReactNode }) {
  // useRef, not useState: the store is created once per mount and never replaced, and
  // useState would run the initialiser on every render in strict mode.
  const storeRef = useRef<SiteStore | null>(null)
  storeRef.current ??= createSiteStore()

  return (
    <SiteStoreContext.Provider value={storeRef.current}>
      {children}
    </SiteStoreContext.Provider>
  )
}

/**
 * Read from the store.
 *
 * Throws when no provider is above it rather than returning undefined, because a component
 * silently reading no state renders an empty version of itself and looks like a data
 * problem instead of a missing provider.
 */
export function useSiteStore<T>(selector: (state: SiteState) => T): T {
  const store = useContext(SiteStoreContext)
  if (!store) {
    throw new Error(
      'useSiteStore was called outside SiteStoreProvider. Wrap the tree in '
      + '<SiteStoreProvider> — usually in app/layout.tsx, inside ThemeProvider.',
    )
  }
  return useStore(store, selector)
}
`
}

/**
 * The layout change a site needs for the store to work.
 *
 * Returned as guidance rather than applied, because the layout is the tenant's file and
 * rewriting it silently is exactly what the engine promises not to do.
 */
export function providerInstructions(): string {
  return 'Wrap the children of app/layout.tsx in <SiteStoreProvider>, inside ThemeProvider. '
    + 'Without the provider every useSiteStore call throws.'
}

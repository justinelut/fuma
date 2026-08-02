/**
 * Bounded collection provisioning.
 *
 * Closes the one gap between "AI edits existing collections" and "AI can model
 * any business": it lets AI define collections in the universal `data_tables`
 * model within bounded, owner-confirmed field contracts. Verticals such as
 * events and hospitality are content blueprints here; contention-sensitive
 * capacity stays with the FUMA-093 bookings authority.
 */
export * from './contracts'
export * from './service'
export * from './blueprints'
export * from './capabilities'
export * from './postgres'

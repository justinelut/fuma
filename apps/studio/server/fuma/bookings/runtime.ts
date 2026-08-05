/**
 * Bookings production composition (FUMA-093).
 *
 * The pack shipped with domain logic, a memory repository and reviewed
 * capability definitions but no production seam, so nothing could reach it. This
 * module is that seam: it binds the PostgreSQL repository, a real identity
 * source and the capability authority, and exposes a `register` function so the
 * shared reviewed-capability registry can adopt the pack without this module
 * reaching into global state itself.
 */
import type { DbClient } from '../../db/client'
import type { ReviewedBackendCapabilityRegistry } from '../aiBackendCapabilities/registry'
import { LifecycleBookingCapabilityAuthority } from './authority'
import { registerBookingCapabilities } from './capabilities'
import { PostgresBookingRepository } from './postgres'
import { createBookingScopedRouteDeclarations } from './routes'
import type { FumaScopedRouteDeclaration } from '../context'
import {
  BookingLifecycleService,
  type BookingIdentityPort,
  type BookingScope,
} from './service'

/** Crockford-style alphabet: no I, L, O or U, so references stay unambiguous aloud. */
const REFERENCE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const REFERENCE_LENGTH = 10

/**
 * Production identity source.
 *
 * Booking ids are UUIDs so they are unguessable — a sequential id would let
 * anyone holding one reference enumerate a tenant's whole diary. Customer-facing
 * references are shorter but still drawn from a CSPRNG, and the schema's unique
 * constraint remains the final arbiter.
 */
export class CryptoBookingIdentity implements BookingIdentityPort {
  bookingId(): string { return `bk-${crypto.randomUUID()}` }
  holdId(): string { return `hd-${crypto.randomUUID()}` }
  eventId(): string { return `ev-${crypto.randomUUID()}` }
  reminderId(): string { return `rm-${crypto.randomUUID()}` }

  reference(): string {
    const bytes = new Uint8Array(REFERENCE_LENGTH)
    crypto.getRandomValues(bytes)
    let out = ''
    for (const byte of bytes) out += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length]
    return out
  }
}

export type HostedBookingRuntimeInput = Readonly<{
  db: DbClient
  identity?: BookingIdentityPort
  now?: () => Date
}>

export type HostedBookingRuntime = Readonly<{
  repository: PostgresBookingRepository
  lifecycle: BookingLifecycleService
  authority: LifecycleBookingCapabilityAuthority
  scopedRoutes: readonly FumaScopedRouteDeclaration[]
  /** Adopt the pack's reviewed capabilities into a shared registry. */
  register: (registry: ReviewedBackendCapabilityRegistry) => ReviewedBackendCapabilityRegistry
  /** Transition holds whose TTL elapsed. Safe to call repeatedly. */
  sweepExpiredHolds: (scope: BookingScope, limit?: number) => Promise<number>
}>

export function createHostedBookingRuntime(input: HostedBookingRuntimeInput): HostedBookingRuntime {
  if (input.db.dialect !== 'postgres') {
    throw new TypeError('Bookings authority requires PostgreSQL.')
  }
  const repository = new PostgresBookingRepository(input.db)
  const lifecycle = new BookingLifecycleService({
    repository,
    identity: input.identity ?? new CryptoBookingIdentity(),
    ...(input.now ? { now: input.now } : {}),
  })
  const authority = new LifecycleBookingCapabilityAuthority(lifecycle)
  return Object.freeze({
    repository,
    lifecycle,
    authority,
    scopedRoutes: createBookingScopedRouteDeclarations({ repository, lifecycle }),
    register: (registry) => registerBookingCapabilities(registry, authority),
    sweepExpiredHolds: async (scope, limit) => {
      const moved = await repository.expireElapsedHolds(scope, limit)
      return moved.length
    },
  })
}

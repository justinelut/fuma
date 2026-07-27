const product = Object.freeze({
  name: 'Fuma',
  host: 'app.fuma.co.ke',
} as const)

const marketing = Object.freeze({
  host: 'fuma.co.ke',
  status: 'deferred',
} as const)

const launchDefaults = Object.freeze({
  locale: 'en-KE',
  currency: 'KES',
  timeZone: 'Africa/Nairobi',
} as const)

/**
 * Public identity metadata ratified by the Fuma configuration contract.
 * This data describes public surfaces; it does not grant routing or runtime authority.
 */
export const FUMA_PUBLIC_IDENTITY = Object.freeze({
  product,
  marketing,
  launchDefaults,
} as const)

export type FumaPublicIdentity = typeof FUMA_PUBLIC_IDENTITY

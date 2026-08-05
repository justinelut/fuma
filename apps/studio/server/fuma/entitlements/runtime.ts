import type { DbClient } from '../../db/client'
import { PostgresProviderCostCatalog } from '../metering/postgres'
import { PostgresEntitlementRepository, PostgresOfferDestinationAuthority } from './postgres'
import { EntitlementService } from './service'

export type HostedKesCostConversion = Readonly<{
  version: string
  numerator: bigint
  denominator: bigint
  convert: (usdMicros: bigint) => number
}>

export function readHostedKesCostConversion(
  env: Readonly<Record<string, unknown>> = process.env,
): HostedKesCostConversion {
  const version = env.FUMA_KES_FX_VERSION
  const numeratorText = env.FUMA_KES_MINOR_NUMERATOR
  const denominatorText = env.FUMA_USD_MICROS_DENOMINATOR
  if (typeof version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(version)
    || typeof numeratorText !== 'string' || !/^[1-9][0-9]{0,17}$/.test(numeratorText)
    || typeof denominatorText !== 'string' || !/^[1-9][0-9]{0,17}$/.test(denominatorText)) {
    throw new TypeError('Hosted entitlement economics require versioned positive integer KES FX authority.')
  }
  const numerator = BigInt(numeratorText)
  const denominator = BigInt(denominatorText)
  const convert = (usdMicros: bigint): number => {
    if (usdMicros < 0n) return Number.NaN
    const roundedUp = (usdMicros * numerator + denominator - 1n) / denominator
    return roundedUp <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(roundedUp) : Number.NaN
  }
  return Object.freeze({ version, numerator, denominator, convert })
}

export function createHostedEntitlementRuntime(input: Readonly<{
  db: DbClient
  usdMicrosToKesMinor: (usdMicros: bigint) => number
  costConversionVersion: string
  now?: () => Date
}>) {
  const compose = (db: DbClient) => {
    const repository = new PostgresEntitlementRepository(db)
    const destinations = new PostgresOfferDestinationAuthority(db)
    const catalog = new PostgresProviderCostCatalog(db, input.now)
    const service = new EntitlementService({
      repository,
      destinations,
      catalog,
      usdMicrosToKesMinor: input.usdMicrosToKesMinor,
      costConversionVersion: input.costConversionVersion,
      now: input.now,
    })
    return Object.freeze({ repository, destinations, catalog, service })
  }
  const runtime = compose(input.db)
  return Object.freeze({
    ...runtime,
    serviceFor: (db: DbClient) => compose(db).service,
  })
}

import {
  Type,
  safeParseValue,
  type Static,
} from '@core/utils/typeboxHelpers'

const IdSchema = Type.String({ minLength: 1, maxLength: 255 })
const TimestampSchema = Type.String({ format: 'date-time' })
const HttpsUrlSchema = Type.String({ minLength: 1, maxLength: 2048, pattern: '^https://' })
const SourceSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('public-plan'),
    planId: IdSchema,
    priceBookVersion: Type.String({ minLength: 1, maxLength: 100 }),
    cadence: Type.Union([Type.Literal('monthly'), Type.Literal('annual')]),
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('private-offer'),
    offerId: IdSchema,
    offerVersion: Type.Integer({ minimum: 1 }),
  }, { additionalProperties: false }),
])
const ObligationSchema = Type.Object({
  kind: Type.Union([Type.Literal('setup'), Type.Literal('recurring')]),
  amountMinor: Type.Integer({ minimum: 1 }),
  currency: Type.Literal('KES'),
  reference: Type.Union([Type.String({ minLength: 16 }), Type.Null()]),
  authorizationUrl: Type.Union([HttpsUrlSchema, Type.Null()]),
  state: Type.Union([
    Type.Literal('pending'),
    Type.Literal('initializing'),
    Type.Literal('ready'),
    Type.Literal('callback-verified'),
    Type.Literal('failed'),
  ]),
  callbackVerifiedAt: Type.Union([TimestampSchema, Type.Null()]),
}, { additionalProperties: false })

export const PlatformCheckoutWireSchema = Type.Object({
  checkoutId: IdSchema,
  state: Type.Union([Type.Literal('awaiting-payment'), Type.Literal('cancelled')]),
  source: SourceSchema,
  destination: Type.Object({
    organizationId: IdSchema,
    workspaceId: IdSchema,
    siteId: IdSchema,
    profileId: IdSchema,
  }, { additionalProperties: false }),
  cadence: Type.Union([Type.Literal('monthly'), Type.Literal('annual')]),
  currency: Type.Literal('KES'),
  setup: Type.Union([ObligationSchema, Type.Null()]),
  recurring: ObligationSchema,
  createdAt: TimestampSchema,
  cancelledAt: Type.Union([TimestampSchema, Type.Null()]),
}, { additionalProperties: false })
export type PlatformCheckoutWire = Readonly<Static<typeof PlatformCheckoutWireSchema>>
export type PlatformCheckoutSource = Readonly<Static<typeof SourceSchema>>

export function parsePlatformCheckoutWire(candidate: unknown): PlatformCheckoutWire {
  const parsed = safeParseValue(PlatformCheckoutWireSchema, candidate)
  if (!parsed.ok) throw new Error('Checkout response did not match its strict public contract.')
  return Object.freeze(parsed.value)
}

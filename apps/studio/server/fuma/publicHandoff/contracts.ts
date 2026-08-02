import {
  OpaqueCorrelationSchema,
  PublicHandoffRequestSchema,
  PublicHandoffSourceSchema,
  PublicIdSchema,
  PublicPriceBookVersionSchema,
  PublicProfileSchema,
  PublicTimestampSchema,
} from '@fuma/public-contracts'
import { Type, type Static, type TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

export const APP_HANDOFF_AUDIENCE = 'fuma-app' as const
export const APP_HANDOFF_CALLBACK = '/resume' as const
export const APP_HANDOFF_SESSION_COOKIE = '__Host-fuma_app' as const
export const AUTH_HANDOFF_SESSION_COOKIE = '__Host-fuma_auth' as const

export const HandoffOpaqueTokenSchema = Type.String({
  minLength: 32,
  maxLength: 128,
  pattern: '^[A-Za-z0-9_-]+$',
})

const IdentityResolutionSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('sign_up'),
    source: PublicHandoffSourceSchema,
    profile: Type.Optional(PublicProfileSchema),
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('sign_in'),
    source: PublicHandoffSourceSchema,
    profile: Type.Optional(PublicProfileSchema),
  }, { additionalProperties: false }),
])

export const AppHandoffResolutionSchema = Type.Union([
  IdentityResolutionSchema,
  Type.Object({
    kind: Type.Literal('create_site'),
    source: PublicHandoffSourceSchema,
    profile: PublicProfileSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('choose_plan'),
    source: PublicHandoffSourceSchema,
    planId: PublicIdSchema,
    priceBookVersion: PublicPriceBookVersionSchema,
    cadence: Type.Union([Type.Literal('monthly'), Type.Literal('annual')]),
    profile: PublicProfileSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('use_template'),
    source: PublicHandoffSourceSchema,
    templateId: PublicIdSchema,
    releaseId: PublicIdSchema,
    profiles: Type.Array(PublicProfileSchema, { minItems: 1, maxItems: 2, uniqueItems: true }),
    authorityVersion: Type.Integer({ minimum: 1 }),
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('contact_expert'),
    source: PublicHandoffSourceSchema,
    expertId: PublicIdSchema,
  }, { additionalProperties: false }),
])
export type AppHandoffResolution = Static<typeof AppHandoffResolutionSchema>

export const StoredPublicIntentSchema = Type.Object({
  version: Type.Literal(1),
  recordKind: Type.Literal('public-intent'),
  audience: Type.Literal(APP_HANDOFF_AUDIENCE),
  callback: Type.Literal(APP_HANDOFF_CALLBACK),
  request: PublicHandoffRequestSchema,
  correlation: OpaqueCorrelationSchema,
  issuedAt: PublicTimestampSchema,
  expiresAt: PublicTimestampSchema,
}, { additionalProperties: false })
export type StoredPublicIntent = Static<typeof StoredPublicIntentSchema>

export const StoredAppAuthCodeSchema = Type.Object({
  version: Type.Literal(1),
  recordKind: Type.Literal('app-auth-code'),
  audience: Type.Literal(APP_HANDOFF_AUDIENCE),
  callback: Type.Literal(APP_HANDOFF_CALLBACK),
  userId: Type.String({ minLength: 1, maxLength: 255, pattern: '^[^\\s\\u0000-\\u001F\\u007F]+$' }),
  identitySessionId: Type.String({ minLength: 1, maxLength: 255, pattern: '^[^\\s\\u0000-\\u001F\\u007F]+$' }),
  intent: StoredPublicIntentSchema,
  state: OpaqueCorrelationSchema,
  issuedAt: PublicTimestampSchema,
  expiresAt: PublicTimestampSchema,
}, { additionalProperties: false })
export type StoredAppAuthCode = Static<typeof StoredAppAuthCodeSchema>

export const AppHandoffStartQuerySchema = Type.Object({
  intent: HandoffOpaqueTokenSchema,
  correlation: OpaqueCorrelationSchema,
}, { additionalProperties: false })
export type AppHandoffStartQuery = Static<typeof AppHandoffStartQuerySchema>

export const AppHandoffExchangeRequestSchema = Type.Object({
  code: HandoffOpaqueTokenSchema,
  state: OpaqueCorrelationSchema,
}, { additionalProperties: false })
export type AppHandoffExchangeRequest = Static<typeof AppHandoffExchangeRequestSchema>

export const AppHandoffCancelRequestSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('intent'),
    intent: HandoffOpaqueTokenSchema,
    correlation: OpaqueCorrelationSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('code'),
    code: HandoffOpaqueTokenSchema,
    state: OpaqueCorrelationSchema,
  }, { additionalProperties: false }),
])
export type AppHandoffCancelRequest = Static<typeof AppHandoffCancelRequestSchema>

export const AppHandoffReadyResponseSchema = Type.Object({
  kind: Type.Literal('ready'),
  correlation: OpaqueCorrelationSchema,
  resolution: AppHandoffResolutionSchema,
  sessionExpiresAt: PublicTimestampSchema,
}, { additionalProperties: false })
export type AppHandoffReadyResponse = Static<typeof AppHandoffReadyResponseSchema>

export const AppHandoffErrorCodeSchema = Type.Union([
  Type.Literal('invalid'),
  Type.Literal('expired'),
  Type.Literal('replayed'),
  Type.Literal('cancelled'),
  Type.Literal('authority-unavailable'),
])
export type AppHandoffErrorCode = Static<typeof AppHandoffErrorCodeSchema>

export function parseHandoffValue<T extends TSchema>(schema: T, value: unknown, label: string): Static<T> {
  if (!Value.Check(schema, value)) throw new TypeError(`${label} failed strict validation.`)
  return structuredClone(value) as Static<T>
}

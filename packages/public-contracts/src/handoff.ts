import { Type, type Static } from '@sinclair/typebox'
import { OpaqueCorrelationSchema, PublicIdSchema, PublicTimestampSchema } from './scalars'

export const PublicProfileSchema = Type.Union([
  Type.Literal('website'),
  Type.Literal('publication'),
])
export type PublicProfile = Static<typeof PublicProfileSchema>

export const PublicHandoffSourceSchema = Type.Union([
  Type.Literal('direct'),
  Type.Literal('home'),
  Type.Literal('product'),
  Type.Literal('solution'),
  Type.Literal('pricing'),
  Type.Literal('template'),
  Type.Literal('showcase'),
  Type.Literal('expert'),
  Type.Literal('plugin'),
  Type.Literal('docs'),
  Type.Literal('guide'),
  Type.Literal('blog'),
  Type.Literal('changelog'),
])
export type PublicHandoffSource = Static<typeof PublicHandoffSourceSchema>

const PublicIdentityHandoffSchema = Type.Union([
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

export const PublicHandoffRequestSchema = Type.Union([
  PublicIdentityHandoffSchema,
  Type.Object({
    kind: Type.Literal('create_site'),
    source: PublicHandoffSourceSchema,
    profile: PublicProfileSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('choose_plan'),
    source: PublicHandoffSourceSchema,
    planId: PublicIdSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('use_template'),
    source: PublicHandoffSourceSchema,
    templateId: PublicIdSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('contact_expert'),
    source: PublicHandoffSourceSchema,
    expertId: PublicIdSchema,
  }, { additionalProperties: false }),
])
export type PublicHandoffRequest = Static<typeof PublicHandoffRequestSchema>

export const PublicHandoffIntentSchema = Type.Object({
  intent: Type.String({
    minLength: 32,
    maxLength: 1_024,
    pattern: '^[A-Za-z0-9_-]+$',
  }),
  correlation: OpaqueCorrelationSchema,
  expiresAt: PublicTimestampSchema,
}, { additionalProperties: false })
export type PublicHandoffIntent = Static<typeof PublicHandoffIntentSchema>

import { createPublicReadEnvelopeSchema } from './reads'

export const PublicHandoffEnvelopeSchema = createPublicReadEnvelopeSchema(PublicHandoffIntentSchema)
export type PublicHandoffEnvelope = Static<typeof PublicHandoffEnvelopeSchema>

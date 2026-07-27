import { Type, type Static } from '@sinclair/typebox'
import { OpaqueCorrelationSchema, PublicIdSchema, PublicTimestampSchema } from './scalars'

export const PublicRouteClassSchema = Type.Union([
  Type.Literal('home'),
  Type.Literal('product'),
  Type.Literal('solution'),
  Type.Literal('pricing'),
  Type.Literal('template'),
  Type.Literal('showcase'),
  Type.Literal('expert'),
  Type.Literal('plugin'),
  Type.Literal('resource'),
  Type.Literal('company'),
  Type.Literal('legal'),
])
export type PublicRouteClass = Static<typeof PublicRouteClassSchema>

export const PublicCampaignSourceSchema = Type.Union([
  Type.Literal('direct'),
  Type.Literal('organic'),
  Type.Literal('referral'),
  Type.Literal('campaign'),
])
export type PublicCampaignSource = Static<typeof PublicCampaignSourceSchema>

export const PublicConsentStateSchema = Type.Union([
  Type.Literal('granted'),
  Type.Literal('denied'),
  Type.Literal('not_required'),
])
export type PublicConsentState = Static<typeof PublicConsentStateSchema>

const EventContext = {
  version: Type.Literal(1),
  routeClass: PublicRouteClassSchema,
  timestamp: PublicTimestampSchema,
  consent: PublicConsentStateSchema,
  campaignSource: Type.Optional(PublicCampaignSourceSchema),
} as const

const OptionalTarget = {
  planId: Type.Optional(PublicIdSchema),
  templateId: Type.Optional(PublicIdSchema),
} as const

export const PublicAcquisitionEventSchema = Type.Union([
  Type.Object({
    ...EventContext,
    kind: Type.Literal('page_view'),
  }, { additionalProperties: false }),
  Type.Object({
    ...EventContext,
    kind: Type.Literal('cta_selected'),
    ...OptionalTarget,
  }, { additionalProperties: false }),
  Type.Object({
    ...EventContext,
    kind: Type.Literal('handoff_started'),
    ...OptionalTarget,
    handoffCorrelation: OpaqueCorrelationSchema,
  }, { additionalProperties: false }),
])
export type PublicAcquisitionEvent = Static<typeof PublicAcquisitionEventSchema>

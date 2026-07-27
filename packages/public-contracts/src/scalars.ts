import { Type, type Static } from '@sinclair/typebox'

export const PublicIdSchema = Type.String({
  minLength: 1,
  maxLength: 96,
  pattern: '^[a-z0-9](?:[a-z0-9._-]{0,94}[a-z0-9])?$',
})
export type PublicId = Static<typeof PublicIdSchema>

export const PublicTimestampSchema = Type.String({
  minLength: 20,
  maxLength: 35,
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z$',
})
export type PublicTimestamp = Static<typeof PublicTimestampSchema>

export const OpaqueCorrelationSchema = Type.String({
  minLength: 16,
  maxLength: 128,
  pattern: '^[A-Za-z0-9_-]+$',
})
export type OpaqueCorrelation = Static<typeof OpaqueCorrelationSchema>

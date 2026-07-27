import { Type, type Static } from '@sinclair/typebox'

const SafeErrorMessageSchema = Type.String({
  minLength: 1,
  maxLength: 160,
  pattern: '^[^\\u0000-\\u001F\\u007F]+$',
})

const SafeRetryAfterSecondsSchema = Type.Integer({ minimum: 1, maximum: 3_600 })

export const SafeErrorSchema = Type.Union([
  Type.Object({
    code: Type.Literal('invalid_request'),
    message: SafeErrorMessageSchema,
  }, { additionalProperties: false }),
  Type.Object({
    code: Type.Literal('not_found'),
    message: SafeErrorMessageSchema,
  }, { additionalProperties: false }),
  Type.Object({
    code: Type.Literal('rate_limited'),
    message: SafeErrorMessageSchema,
    retryAfterSeconds: Type.Optional(SafeRetryAfterSecondsSchema),
  }, { additionalProperties: false }),
  Type.Object({
    code: Type.Literal('temporarily_unavailable'),
    message: SafeErrorMessageSchema,
    retryAfterSeconds: Type.Optional(SafeRetryAfterSecondsSchema),
  }, { additionalProperties: false }),
])
export type SafeError = Static<typeof SafeErrorSchema>

export const SafeErrorEnvelopeSchema = Type.Object({
  error: SafeErrorSchema,
}, { additionalProperties: false })
export type SafeErrorEnvelope = Static<typeof SafeErrorEnvelopeSchema>

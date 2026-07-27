import { Type, type Static } from '@sinclair/typebox'

const ContactSafeText = Type.String({ minLength: 1, maxLength: 100, pattern: '^[^<>\\u0000-\\u001F\\u007F]+$' })
const ContactEmail = Type.String({ minLength: 3, maxLength: 254, pattern: '^[^\\s@<>\\u0000-\\u001F\\u007F]+@[^\\s@<>\\u0000-\\u001F\\u007F]+\\.[^\\s@<>\\u0000-\\u001F\\u007F]+$' })
const ContactMessage = Type.String({ minLength: 10, maxLength: 4_000, pattern: '^[^\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]+$' })
const ContactReplayToken = Type.String({ minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' })
const ContactExpertId = Type.String({ minLength: 1, maxLength: 96, pattern: '^[a-z0-9](?:[a-z0-9._-]{0,94}[a-z0-9])?$' })

const ContactBase = {
  name: ContactSafeText,
  email: ContactEmail,
  message: ContactMessage,
  consentVersion: Type.Literal('2026-07-26'),
  replayToken: ContactReplayToken,
} as const

export const ContactRequestSchema = Type.Union([
  Type.Object({
    kind: Type.Union([Type.Literal('general'), Type.Literal('security'), Type.Literal('privacy'), Type.Literal('abuse')]),
    ...ContactBase,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('expert_inquiry'),
    ...ContactBase,
    expertId: ContactExpertId,
  }, { additionalProperties: false }),
])
export type ContactRequest = Static<typeof ContactRequestSchema>

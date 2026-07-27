import { Type, type Static, type TSchema } from '@sinclair/typebox'

export const PUBLIC_PAGE_SIZE_MAX = 100

export const PublicCursorSchema = Type.String({
  minLength: 1,
  maxLength: 512,
  pattern: '^[A-Za-z0-9_-]+$',
})
export type PublicCursor = Static<typeof PublicCursorSchema>

export const CursorPageRequestSchema = Type.Object({
  cursor: Type.Optional(PublicCursorSchema),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: PUBLIC_PAGE_SIZE_MAX })),
}, { additionalProperties: false })
export type CursorPageRequest = Static<typeof CursorPageRequestSchema>

export const CursorPageStateSchema = Type.Union([
  Type.Object({
    hasMore: Type.Literal(true),
    nextCursor: PublicCursorSchema,
  }, { additionalProperties: false }),
  Type.Object({
    hasMore: Type.Literal(false),
    nextCursor: Type.Null(),
  }, { additionalProperties: false }),
])
export type CursorPageState = Static<typeof CursorPageStateSchema>

export function createCursorPageSchema<TItem extends TSchema>(itemSchema: TItem) {
  return Type.Object({
    items: Type.Array(itemSchema, { maxItems: PUBLIC_PAGE_SIZE_MAX }),
    page: CursorPageStateSchema,
  }, { additionalProperties: false })
}

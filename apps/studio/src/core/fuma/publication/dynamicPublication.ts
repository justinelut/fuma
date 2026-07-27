import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'

const IdSchema = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const TimestampSchema = Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?Z$' })
const TargetKindSchema = Type.Union([
  Type.Literal('post'), Type.Literal('page'), Type.Literal('author'),
  Type.Literal('tag'), Type.Literal('date'), Type.Literal('collection'),
])
export const DynamicPublicationTargetSchema = Type.Object({
  kind: TargetKindSchema,
  targetId: Type.Union([IdSchema, Type.Null()]),
}, { additionalProperties: false })
export type DynamicPublicationTarget = Readonly<Static<typeof DynamicPublicationTargetSchema>>

export const DynamicPublicationBindingSchema = Type.Union([
  Type.Literal('archive.title'), Type.Literal('archive.description'), Type.Literal('archive.count'),
  Type.Literal('content.title'), Type.Literal('content.excerpt'), Type.Literal('content.url'),
  Type.Literal('content.publishedAt'), Type.Literal('item.title'), Type.Literal('item.excerpt'),
  Type.Literal('item.url'), Type.Literal('item.publishedAt'),
])
export type DynamicPublicationBinding = Static<typeof DynamicPublicationBindingSchema>

const TemplateValueSchema = Type.Union([
  Type.Object({ kind: Type.Literal('literal'), value: Type.String({ maxLength: 10_000 }) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('binding'), binding: DynamicPublicationBindingSchema }, { additionalProperties: false }),
])
export const DynamicPublicationTemplateBlockSchema = Type.Object({
  blockId: IdSchema,
  scope: Type.Union([Type.Literal('root'), Type.Literal('item')]),
  element: Type.Union([
    Type.Literal('article'), Type.Literal('section'), Type.Literal('header'), Type.Literal('main'),
    Type.Literal('footer'), Type.Literal('h1'), Type.Literal('h2'), Type.Literal('p'),
    Type.Literal('a'), Type.Literal('li'), Type.Literal('time'),
  ]),
  value: TemplateValueSchema,
  href: Type.Union([TemplateValueSchema, Type.Null()]),
}, { additionalProperties: false })
export const DynamicPublicationTemplateDocumentSchema = Type.Object({
  version: Type.Literal(1),
  blocks: Type.Array(DynamicPublicationTemplateBlockSchema, { minItems: 1, maxItems: 200 }),
}, { additionalProperties: false })
export type DynamicPublicationTemplateDocument = Readonly<Static<typeof DynamicPublicationTemplateDocumentSchema>>

export const DynamicPublicationTemplateSchema = Type.Object({
  templateId: IdSchema,
  name: Type.String({ minLength: 1, maxLength: 160 }),
  target: DynamicPublicationTargetSchema,
  document: DynamicPublicationTemplateDocumentSchema,
  emptyState: Type.String({ minLength: 1, maxLength: 500 }),
  version: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  active: Type.Boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}, { additionalProperties: false })
export type DynamicPublicationTemplate = Readonly<Static<typeof DynamicPublicationTemplateSchema>>

export const DynamicPublicationAudienceSchema = Type.Object({
  member: Type.Boolean(),
  paid: Type.Boolean(),
  memberId: Type.Optional(Type.Union([IdSchema, Type.Null()])),
  segmentIds: Type.Array(IdSchema, { maxItems: 64, uniqueItems: true }),
}, { additionalProperties: false })
export type DynamicPublicationAudience = Readonly<Static<typeof DynamicPublicationAudienceSchema>>
export const DynamicPublicationLoopQuerySchema = Type.Object({
  target: DynamicPublicationTargetSchema,
  page: Type.Integer({ minimum: 1, maximum: 10_000 }),
  pageSize: Type.Integer({ minimum: 1, maximum: 50 }),
  audience: DynamicPublicationAudienceSchema,
  asOf: TimestampSchema,
}, { additionalProperties: false })
export type DynamicPublicationLoopQuery = Readonly<Static<typeof DynamicPublicationLoopQuerySchema>>

export const DynamicPublicationLoopItemSchema = Type.Object({
  contentId: IdSchema,
  kind: Type.Union([Type.Literal('post'), Type.Literal('page')]),
  title: Type.String({ minLength: 1, maxLength: 300 }),
  slug: Type.String({ minLength: 1, maxLength: 160 }),
  excerpt: Type.String({ maxLength: 1000 }),
  publishedAt: TimestampSchema,
  authorIds: Type.Array(IdSchema, { maxItems: 32, uniqueItems: true }),
  tagIds: Type.Array(IdSchema, { maxItems: 64, uniqueItems: true }),
}, { additionalProperties: false })
export type DynamicPublicationLoopItem = Readonly<Static<typeof DynamicPublicationLoopItemSchema>>

export const DynamicPublicationLoopPageSchema = Type.Object({
  target: DynamicPublicationTargetSchema,
  page: Type.Integer({ minimum: 1, maximum: 10_000 }),
  pageSize: Type.Integer({ minimum: 1, maximum: 50 }),
  total: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  items: Type.Array(DynamicPublicationLoopItemSchema, { maxItems: 50 }),
  canonicalPath: Type.String({ minLength: 1, maxLength: 1024, pattern: '^/' }),
  previousPath: Type.Union([Type.String({ minLength: 1, maxLength: 1024, pattern: '^/' }), Type.Null()]),
  nextPath: Type.Union([Type.String({ minLength: 1, maxLength: 1024, pattern: '^/' }), Type.Null()]),
}, { additionalProperties: false })
export type DynamicPublicationLoopPage = Readonly<Static<typeof DynamicPublicationLoopPageSchema>>

export class DynamicPublicationContractError extends Error {
  readonly contract: string
  constructor(contract: string) {
    super(`Dynamic Publication ${contract} contract failed validation.`)
    this.name = 'DynamicPublicationContractError'
    this.contract = contract
  }
}

export function parseDynamicPublicationContract<T extends TSchema>(contract: string, schema: T, value: unknown): Readonly<Static<T>> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new DynamicPublicationContractError(contract)
  return deepFreeze(structuredClone(parsed.value))
}

export function canonicalDynamicPublicationPath(target: DynamicPublicationTarget, page = 1): string {
  const parsed = parseDynamicPublicationContract('target', DynamicPublicationTargetSchema, target)
  if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) throw new RangeError('Publication page is outside the canonical range.')
  if (parsed.targetId === null) throw new DynamicPublicationContractError('routable target')
  const id = encodeURIComponent(parsed.targetId)
  const base = parsed.kind === 'post' ? `/posts/${id}`
    : parsed.kind === 'page' ? `/pages/${id}`
      : parsed.kind === 'author' ? `/authors/${id}`
        : parsed.kind === 'tag' ? `/tags/${id}`
          : parsed.kind === 'date' ? `/archive/${parsed.targetId.split('-').map(encodeURIComponent).join('/')}`
            : `/collections/${id}`
  return page === 1 || parsed.kind === 'post' || parsed.kind === 'page' ? base : `${base}?page=${page}`
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

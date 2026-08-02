/**
 * Bounded collection provisioning contracts.
 *
 * The decisive gap this closes: Site AI could already read collection schemas
 * and create/edit rows, but it could not *define* a collection. Without that a
 * human had to pre-create "Services" or "Case Studies" before AI could model a
 * business. This contract lets AI provision collections while keeping every
 * dangerous schema power out of reach.
 *
 * Deliberate limits, all enforced at the contract boundary:
 *  - only presentation-safe field types; `pageTree`/`fieldSchema` are structural
 *    editor documents and are never AI-provisionable;
 *  - `relation` targets are named by collection slug, never by raw table id, so
 *    AI cannot address arbitrary storage;
 *  - bounded field counts, label/option lengths and select option counts;
 *  - reserved and system collection slugs are refused;
 *  - extension is additive only: no field removal, retype, or primary-field
 *    change, so existing rows can never be orphaned or silently reinterpreted;
 *  - no SQL, table name, predicate, credential or caller scope crosses here.
 */
import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'

const Strict = { additionalProperties: false } as const

/** Collection slugs Fuma owns; provisioning must never collide with them. */
export const RESERVED_COLLECTION_SLUGS: readonly string[] = Object.freeze([
  'posts', 'pages', 'components', 'layouts',
])

export const COLLECTION_FIELD_LIMIT = 40
export const COLLECTION_SELECT_OPTION_LIMIT = 40

export const CollectionSlugSchema = Type.String({
  minLength: 2,
  maxLength: 48,
  pattern: '^[a-z][a-z0-9-]*[a-z0-9]$',
})
export const CollectionFieldIdSchema = Type.String({
  minLength: 1,
  maxLength: 48,
  pattern: '^[a-z][a-zA-Z0-9]*$',
})
const Label = Type.String({ minLength: 1, maxLength: 80 })
const Description = Type.String({ maxLength: 240 })

/**
 * Field types AI may provision. This is intentionally narrower than
 * `DataFieldSchema`: `pageTree` and `fieldSchema` hold whole editor documents
 * and are excluded.
 */
export const PROVISIONABLE_FIELD_TYPES = Object.freeze([
  'text', 'longText', 'richText', 'number', 'boolean',
  'date', 'dateTime', 'select', 'multiSelect', 'url', 'email',
  'media', 'relation',
] as const)
export type ProvisionableFieldType = typeof PROVISIONABLE_FIELD_TYPES[number]

const FieldBase = {
  id: CollectionFieldIdSchema,
  label: Label,
  description: Type.Optional(Description),
  required: Type.Optional(Type.Boolean()),
} as const

const SimpleFieldSchema = Type.Object({
  ...FieldBase,
  type: Type.Union([
    Type.Literal('text'),
    Type.Literal('longText'),
    Type.Literal('boolean'),
    Type.Literal('date'),
    Type.Literal('dateTime'),
    Type.Literal('url'),
    Type.Literal('email'),
  ]),
}, Strict)

const RichTextFieldSchema = Type.Object({
  ...FieldBase,
  type: Type.Literal('richText'),
  format: Type.Union([Type.Literal('markdown'), Type.Literal('html')]),
}, Strict)

const NumberFieldSchema = Type.Object({
  ...FieldBase,
  type: Type.Literal('number'),
  format: Type.Optional(Type.Union([
    Type.Literal('number'),
    Type.Literal('currency'),
    Type.Literal('percent'),
  ])),
  /** KES is the only currency Fuma presents today. */
  currency: Type.Optional(Type.Literal('KES')),
}, Strict)

const SelectOptionSchema = Type.Object({
  value: Type.String({ minLength: 1, maxLength: 64 }),
  label: Label,
}, Strict)

const SelectFieldSchema = Type.Object({
  ...FieldBase,
  type: Type.Union([Type.Literal('select'), Type.Literal('multiSelect')]),
  options: Type.Array(SelectOptionSchema, {
    minItems: 1,
    maxItems: COLLECTION_SELECT_OPTION_LIMIT,
  }),
}, Strict)

const MediaFieldSchema = Type.Object({
  ...FieldBase,
  type: Type.Literal('media'),
  mediaKind: Type.Optional(Type.Union([
    Type.Literal('image'),
    Type.Literal('video'),
    Type.Literal('any'),
  ])),
  allowMultiple: Type.Optional(Type.Boolean()),
}, Strict)

/** Relations are declared by collection slug; raw table ids are never accepted. */
const RelationFieldSchema = Type.Object({
  ...FieldBase,
  type: Type.Literal('relation'),
  targetCollectionSlug: CollectionSlugSchema,
  allowMultiple: Type.Optional(Type.Boolean()),
}, Strict)

export const ProvisionedFieldSchema = Type.Union([
  SimpleFieldSchema,
  RichTextFieldSchema,
  NumberFieldSchema,
  SelectFieldSchema,
  MediaFieldSchema,
  RelationFieldSchema,
])
export type ProvisionedField = Readonly<Static<typeof ProvisionedFieldSchema>>

export const ProvisionCollectionInputSchema = Type.Object({
  slug: CollectionSlugSchema,
  name: Label,
  singularLabel: Label,
  pluralLabel: Label,
  /**
   * `content` becomes a routable post type with editorial workflow; `records`
   * becomes a plain data collection edited in the grid.
   */
  shape: Type.Union([Type.Literal('content'), Type.Literal('records')]),
  primaryFieldId: CollectionFieldIdSchema,
  fields: Type.Array(ProvisionedFieldSchema, { minItems: 1, maxItems: COLLECTION_FIELD_LIMIT }),
}, Strict)
export type ProvisionCollectionInput = Readonly<Static<typeof ProvisionCollectionInputSchema>>

export const ProvisionCollectionOutputSchema = Type.Object({
  collectionId: Type.String({ minLength: 1, maxLength: 128 }),
  slug: CollectionSlugSchema,
  shape: Type.Union([Type.Literal('content'), Type.Literal('records')]),
  routeBase: Type.String({ maxLength: 96 }),
  fieldIds: Type.Array(CollectionFieldIdSchema, { maxItems: COLLECTION_FIELD_LIMIT }),
  /** True when an identical collection already existed, making this idempotent. */
  alreadyExisted: Type.Boolean(),
}, Strict)

export const ExtendCollectionInputSchema = Type.Object({
  slug: CollectionSlugSchema,
  addFields: Type.Array(ProvisionedFieldSchema, { minItems: 1, maxItems: COLLECTION_FIELD_LIMIT }),
}, Strict)
export type ExtendCollectionInput = Readonly<Static<typeof ExtendCollectionInputSchema>>

export const ExtendCollectionOutputSchema = Type.Object({
  slug: CollectionSlugSchema,
  addedFieldIds: Type.Array(CollectionFieldIdSchema, { maxItems: COLLECTION_FIELD_LIMIT }),
  /** Fields that already existed unchanged, so retries stay idempotent. */
  unchangedFieldIds: Type.Array(CollectionFieldIdSchema, { maxItems: COLLECTION_FIELD_LIMIT }),
  totalFieldCount: Type.Integer({ minimum: 1, maximum: COLLECTION_FIELD_LIMIT }),
}, Strict)

export const DescribeCollectionsInputSchema = Type.Object({
  limit: Type.Integer({ minimum: 1, maximum: 200 }),
}, Strict)

export const DescribedCollectionSchema = Type.Object({
  slug: CollectionSlugSchema,
  name: Label,
  shape: Type.Union([Type.Literal('content'), Type.Literal('records'), Type.Literal('system')]),
  routeBase: Type.String({ maxLength: 96 }),
  primaryFieldId: Type.String({ maxLength: 48 }),
  /** Only provisionable field types are projected; structural fields are hidden. */
  fields: Type.Array(Type.Object({
    id: Type.String({ maxLength: 48 }),
    label: Type.String({ maxLength: 80 }),
    type: Type.Union(PROVISIONABLE_FIELD_TYPES.map((type) => Type.Literal(type))),
    required: Type.Boolean(),
  }, Strict), { maxItems: COLLECTION_FIELD_LIMIT }),
  editable: Type.Boolean(),
}, Strict)

export const DescribeCollectionsOutputSchema = Type.Object({
  collections: Type.Array(DescribedCollectionSchema, { maxItems: 200 }),
}, Strict)

export class CollectionProvisioningError extends Error {
  override readonly name = 'CollectionProvisioningError'
  readonly code:
    | 'invalid-contract'
    | 'reserved-slug'
    | 'unknown-collection'
    | 'system-collection'
    | 'conflicting-shape'
    | 'unknown-relation-target'
    | 'primary-field-missing'
    | 'duplicate-field'
    | 'field-limit'
    | 'destructive-change'

  constructor(code: CollectionProvisioningError['code'], message: string) {
    super(message)
    this.code = code
  }
}

export function parseCollectionContract<T extends TSchema>(boundary: string, schema: T, value: unknown): Static<T> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new CollectionProvisioningError('invalid-contract', `${boundary} failed strict validation.`)
  return structuredClone(parsed.value)
}

/** Reserved slug guard, shared by the service and its tests. */
export function assertProvisionableSlug(slug: string): void {
  if (RESERVED_COLLECTION_SLUGS.includes(slug)) {
    throw new CollectionProvisioningError('reserved-slug', `Collection slug "${slug}" is reserved by Fuma.`)
  }
}

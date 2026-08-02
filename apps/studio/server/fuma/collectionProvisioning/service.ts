/**
 * Bounded collection provisioning service.
 *
 * Translates safe, slug-addressed requests into the existing universal
 * `data_tables` model. It never writes SQL and never invents storage: content
 * collections become `kind: 'postType'` tables with editorial workflow, record
 * collections become `kind: 'data'` grids.
 *
 * Safety properties proven by the tests:
 *  - reserved and system collections are refused;
 *  - relation targets must already exist, resolved slug → id here so callers
 *    never handle raw table ids;
 *  - provisioning the same collection twice is idempotent;
 *  - extension is additive only: an existing field with a different type or a
 *    request to drop a field is a destructive change and is refused.
 */
import type { DataField, DataTable } from '@core/data/schemas'
import {
  CollectionProvisioningError,
  DescribeCollectionsInputSchema,
  DescribeCollectionsOutputSchema,
  ExtendCollectionInputSchema,
  ExtendCollectionOutputSchema,
  PROVISIONABLE_FIELD_TYPES,
  ProvisionCollectionInputSchema,
  ProvisionCollectionOutputSchema,
  RESERVED_COLLECTION_SLUGS,
  assertProvisionableSlug,
  parseCollectionContract,
  type ExtendCollectionInput,
  type ProvisionCollectionInput,
  type ProvisionedField,
} from './contracts'

/** Narrow port over the existing data-table repository. */
export interface CollectionStore {
  listCollections(): Promise<readonly DataTable[]>
  getCollectionBySlug(slug: string): Promise<DataTable | null>
  createCollection(input: Readonly<{
    name: string
    slug: string
    kind: 'postType' | 'data'
    routeBase: string
    singularLabel: string
    pluralLabel: string
    primaryFieldId: string
    fields: readonly DataField[]
  }>): Promise<DataTable>
  updateCollectionFields(collectionId: string, fields: readonly DataField[]): Promise<DataTable | null>
}

const PROVISIONABLE = new Set<string>(PROVISIONABLE_FIELD_TYPES)

function shapeOf(table: DataTable): 'content' | 'records' | 'system' {
  if (table.system) return 'system'
  return table.kind === 'postType' ? 'content' : 'records'
}

/** Compare only what the caller can control, so unrelated stored metadata cannot cause a false conflict. */
function sameField(existing: DataField, requested: DataField): boolean {
  if (existing.type !== requested.type) return false
  if (existing.label !== requested.label) return false
  return true
}

export class CollectionProvisioningService {
  readonly #store: CollectionStore

  constructor(store: CollectionStore) {
    this.#store = store
  }

  async describe(rawInput: unknown): Promise<ReturnType<typeof describeOutput>> {
    const input = parseCollectionContract('collections.describe', DescribeCollectionsInputSchema, rawInput)
    const tables = await this.#store.listCollections()
    const visible = tables
      .filter((table) => table.kind === 'postType' || table.kind === 'data')
      .slice(0, input.limit)
    return describeOutput(visible)
  }

  async provision(rawInput: unknown): Promise<ReturnType<typeof provisionOutput>> {
    const input = parseCollectionContract(
      'collections.provision',
      ProvisionCollectionInputSchema,
      rawInput,
    ) as ProvisionCollectionInput
    assertProvisionableSlug(input.slug)
    assertUniqueFieldIds(input.fields)
    assertPrimaryField(input)

    const existing = await this.#store.getCollectionBySlug(input.slug)
    if (existing) {
      if (existing.system) {
        throw new CollectionProvisioningError('system-collection', `Collection "${input.slug}" is a protected system collection.`)
      }
      const existingShape = shapeOf(existing)
      if (existingShape !== input.shape) {
        throw new CollectionProvisioningError(
          'conflicting-shape',
          `Collection "${input.slug}" already exists as ${existingShape}; it cannot be recreated as ${input.shape}.`,
        )
      }
      // Idempotent: an existing compatible collection is returned unchanged.
      return provisionOutput(existing, true)
    }

    const fields = await this.#materialise(input.fields)
    const created = await this.#store.createCollection({
      name: input.name,
      slug: input.slug,
      kind: input.shape === 'content' ? 'postType' : 'data',
      // Only content collections are publicly routable.
      routeBase: input.shape === 'content' ? `/${input.slug}` : '',
      singularLabel: input.singularLabel,
      pluralLabel: input.pluralLabel,
      primaryFieldId: input.primaryFieldId,
      fields,
    })
    return provisionOutput(created, false)
  }

  async extend(rawInput: unknown): Promise<ReturnType<typeof extendOutput>> {
    const input = parseCollectionContract(
      'collections.extend',
      ExtendCollectionInputSchema,
      rawInput,
    ) as ExtendCollectionInput
    assertProvisionableSlug(input.slug)
    assertUniqueFieldIds(input.addFields)

    const table = await this.#store.getCollectionBySlug(input.slug)
    if (!table) throw new CollectionProvisioningError('unknown-collection', `Collection "${input.slug}" does not exist.`)
    if (table.system) {
      throw new CollectionProvisioningError('system-collection', `Collection "${input.slug}" is a protected system collection.`)
    }

    const requested = await this.#materialise(input.addFields)
    const byId = new Map(table.fields.map((field) => [field.id, field]))
    const added: DataField[] = []
    const unchanged: string[] = []

    for (const field of requested) {
      const existing = byId.get(field.id)
      if (!existing) { added.push(field); continue }
      // A retype or relabel of a live field would reinterpret stored cells.
      if (!sameField(existing, field)) {
        throw new CollectionProvisioningError(
          'destructive-change',
          `Field "${field.id}" already exists on "${input.slug}" with a different definition; changing it is destructive.`,
        )
      }
      unchanged.push(field.id)
    }

    const total = table.fields.length + added.length
    if (total > 40) {
      throw new CollectionProvisioningError('field-limit', `Collection "${input.slug}" would exceed the bounded field limit.`)
    }

    if (added.length > 0) {
      const updated = await this.#store.updateCollectionFields(table.id, [...table.fields, ...added])
      if (!updated) throw new CollectionProvisioningError('unknown-collection', `Collection "${input.slug}" disappeared during extension.`)
    }

    return extendOutput(input.slug, added.map((field) => field.id), unchanged, total)
  }

  /** Resolve slug-addressed relations into stored field definitions. */
  async #materialise(fields: readonly ProvisionedField[]): Promise<readonly DataField[]> {
    const resolved: DataField[] = []
    for (const field of fields) {
      if (field.type !== 'relation') {
        resolved.push({ ...field } as DataField)
        continue
      }
      const target = await this.#store.getCollectionBySlug(field.targetCollectionSlug)
      if (!target) {
        throw new CollectionProvisioningError(
          'unknown-relation-target',
          `Relation field "${field.id}" targets unknown collection "${field.targetCollectionSlug}".`,
        )
      }
      const { targetCollectionSlug: _slug, ...rest } = field
      resolved.push({ ...rest, targetTableId: target.id } as DataField)
    }
    return Object.freeze(resolved)
  }
}

function assertUniqueFieldIds(fields: readonly ProvisionedField[]): void {
  const seen = new Set<string>()
  for (const field of fields) {
    if (seen.has(field.id)) {
      throw new CollectionProvisioningError('duplicate-field', `Field id "${field.id}" is duplicated.`)
    }
    seen.add(field.id)
  }
}

function assertPrimaryField(input: ProvisionCollectionInput): void {
  const primary = input.fields.find((field) => field.id === input.primaryFieldId)
  if (!primary) {
    throw new CollectionProvisioningError(
      'primary-field-missing',
      `Primary field "${input.primaryFieldId}" is not one of the declared fields.`,
    )
  }
  // A media or relation primary field cannot render as a row title.
  if (primary.type === 'media' || primary.type === 'relation') {
    throw new CollectionProvisioningError(
      'primary-field-missing',
      `Primary field "${input.primaryFieldId}" must be a readable scalar field.`,
    )
  }
}

function provisionOutput(table: DataTable, alreadyExisted: boolean) {
  return parseCollectionContract('collections.provision.output', ProvisionCollectionOutputSchema, {
    collectionId: table.id,
    slug: table.slug,
    shape: table.kind === 'postType' ? 'content' : 'records',
    routeBase: table.routeBase,
    fieldIds: table.fields.map((field) => field.id).filter((id) => /^[a-z][a-zA-Z0-9]*$/.test(id)),
    alreadyExisted,
  })
}

function extendOutput(
  slug: string,
  addedFieldIds: readonly string[],
  unchangedFieldIds: readonly string[],
  totalFieldCount: number,
) {
  return parseCollectionContract('collections.extend.output', ExtendCollectionOutputSchema, {
    slug,
    addedFieldIds: [...addedFieldIds],
    unchangedFieldIds: [...unchangedFieldIds],
    totalFieldCount,
  })
}

function describeOutput(tables: readonly DataTable[]) {
  return parseCollectionContract('collections.describe.output', DescribeCollectionsOutputSchema, {
    collections: tables.map((table) => ({
      slug: table.slug,
      name: table.name,
      shape: shapeOf(table),
      routeBase: table.routeBase,
      primaryFieldId: table.primaryFieldId,
      // Structural fields are never projected to AI.
      fields: table.fields
        .filter((field) => PROVISIONABLE.has(field.type))
        .map((field) => ({
          id: field.id,
          label: field.label,
          type: field.type,
          required: field.required === true,
        })),
      editable: !table.system,
    })),
  })
}

export { RESERVED_COLLECTION_SLUGS }

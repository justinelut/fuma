/**
 * Visual data binding.
 *
 * A designer picks a collection and then picks a field for each piece of text. That is the
 * whole interaction; this file is what makes it safe and what it compiles to.
 *
 * The reason it needs a declared schema rather than free-form paths: **a binding to a field
 * the collection does not have renders nothing.** `{item.titel}` is `undefined`, React
 * renders undefined as empty, and the designer sees a blank heading and concludes the data
 * is missing. There is no error anywhere. So a binding is checked against the collection's
 * declared fields and refused when it does not match — the one moment at which the mistake
 * is cheap to fix.
 *
 * What it compiles to is deliberately ordinary: an async function that fetches the rows once
 * and a `.map()` over them. Not a client-side fetch, because a list that arrives after the
 * page does is a list search engines never see and visitors watch appear.
 */

import { Type, type Static } from '@core/utils/typeboxHelpers'

/** Field types a collection can declare, and what each binds to. */
export const FieldTypeSchema = Type.Union([
  Type.Literal('text'),
  Type.Literal('richText'),
  Type.Literal('number'),
  Type.Literal('boolean'),
  Type.Literal('date'),
  Type.Literal('url'),
  Type.Literal('media'),
  Type.Literal('reference'),
])
export type FieldType = Static<typeof FieldTypeSchema>

export const CollectionFieldSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z_][A-Za-z0-9_]*$' }),
  type: FieldTypeSchema,
  /**
   * Whether every row has a value.
   *
   * Drives the generated code: an optional field needs a fallback, because rendering
   * `undefined` produces an empty element rather than an error and the gap looks like a
   * layout bug.
   */
  required: Type.Boolean(),
  /** Collection this reference points at, for a reference field. */
  references: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
}, { additionalProperties: false })
export type CollectionField = Readonly<Static<typeof CollectionFieldSchema>>

export const CollectionSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 128 }),
  /** Name shown in the binding picker. */
  title: Type.String({ minLength: 1, maxLength: 200 }),
  fields: Type.Array(CollectionFieldSchema, { minItems: 1, maxItems: 200 }),
  /**
   * Field that uniquely identifies a row, used for the React key.
   *
   * Required rather than inferred: React falls back to the array index when a key is
   * missing, which makes it reuse the wrong DOM node when rows are reordered — text ends up
   * in the wrong card, and only in production where the order actually changes.
   */
  identity: Type.String({ minLength: 1, maxLength: 128 }),
}, { additionalProperties: false })
export type Collection = Readonly<Static<typeof CollectionSchema>>

export type BindingRefusal = Readonly<{
  code:
    | 'unknown-collection'
    | 'unknown-field'
    | 'wrong-field-type'
    | 'identity-not-declared'
    | 'client-module-cannot-load'
    | 'order-field-unknown'
    | 'filter-field-unknown'
  message: string
}>

/** What a binding target expects, so the picker offers only fields that fit. */
const ACCEPTED_TYPES: Readonly<Record<string, readonly FieldType[]>> = Object.freeze({
  text: Object.freeze(['text', 'richText', 'number', 'date'] as FieldType[]),
  href: Object.freeze(['url', 'text', 'reference'] as FieldType[]),
  src: Object.freeze(['media', 'url'] as FieldType[]),
  alt: Object.freeze(['text'] as FieldType[]),
  visible: Object.freeze(['boolean'] as FieldType[]),
})

export type BindingTarget = keyof typeof ACCEPTED_TYPES

/**
 * Fields a target can bind to.
 *
 * The picker offers these rather than every field, because a `boolean` in a heading renders
 * the word "true" — legal, never intended, and the sort of thing that reaches production
 * because it looks like a data problem rather than a binding mistake.
 */
export function bindableFields(
  collection: Collection,
  target: BindingTarget,
): readonly CollectionField[] {
  const accepted = ACCEPTED_TYPES[target] ?? []
  return Object.freeze(collection.fields.filter((field) => accepted.includes(field.type)))
}

/** Check a binding against the collection, refusing what would render nothing. */
export function validateBinding(
  collection: Collection,
  fieldName: string,
  target: BindingTarget,
): BindingRefusal | null {
  const field = collection.fields.find((candidate) => candidate.name === fieldName)
  if (!field) {
    return Object.freeze({
      code: 'unknown-field',
      message:
        `"${fieldName}" is not a field on ${collection.title}. Binding it would render nothing `
        + `at all rather than failing. Available: ${collection.fields.map((f) => f.name).join(', ')}.`,
    })
  }

  const accepted = ACCEPTED_TYPES[target] ?? []
  if (!accepted.includes(field.type)) {
    return Object.freeze({
      code: 'wrong-field-type',
      message:
        `"${fieldName}" is a ${field.type} field and ${target} accepts ${accepted.join(', ')}. `
        + 'Binding it would render a value nobody meant to show rather than erroring.',
    })
  }

  return null
}

/**
 * Check a whole repeat binding: the collection, its identity, ordering and filters.
 *
 * Ordering and filters are checked too, because a query naming a column that does not exist
 * fails at the database rather than in the builder, and the message a designer would see
 * comes from Postgres.
 */
export function validateRepeatBinding(
  collections: readonly Collection[],
  binding: Readonly<{
    collectionId: string
    orderBy?: string
    filters?: readonly Readonly<{ field: string }>[]
  }>,
  moduleBoundary: 'server' | 'client',
): readonly BindingRefusal[] {
  const refusals: BindingRefusal[] = []

  const collection = collections.find((candidate) => candidate.id === binding.collectionId)
  if (!collection) {
    return Object.freeze([Object.freeze({
      code: 'unknown-collection' as const,
      message:
        `No collection "${binding.collectionId}" exists. Available: `
        + `${collections.map((candidate) => candidate.id).join(', ') || 'none yet'}.`,
    })])
  }

  if (!collection.fields.some((field) => field.name === collection.identity)) {
    refusals.push(Object.freeze({
      code: 'identity-not-declared',
      message:
        `${collection.title} names "${collection.identity}" as its identity but does not declare `
        + 'it as a field. Without a real key React reuses the wrong element when rows reorder, '
        + 'which puts one row\u2019s text in another row\u2019s card.',
    }))
  }

  if (moduleBoundary === 'client') {
    refusals.push(Object.freeze({
      code: 'client-module-cannot-load',
      message:
        'This module is a client component, so it cannot await a loader. Fetch the rows in the '
        + 'server component above it and pass them in as a prop.',
    }))
  }

  if (binding.orderBy !== undefined
    && !collection.fields.some((field) => field.name === binding.orderBy)) {
    refusals.push(Object.freeze({
      code: 'order-field-unknown',
      message:
        `Ordering by "${binding.orderBy}" names a column ${collection.title} does not have. `
        + 'The query would fail at the database, and the error a designer sees comes from there.',
    }))
  }

  for (const filter of binding.filters ?? []) {
    if (!collection.fields.some((field) => field.name === filter.field)) {
      refusals.push(Object.freeze({
        code: 'filter-field-unknown',
        message:
          `Filtering on "${filter.field}" names a column ${collection.title} does not have.`,
      }))
    }
  }

  return Object.freeze(refusals)
}

export type LoaderPlan = Readonly<{
  /** Name of the generated async function. */
  functionName: string
  /** Name of the row type it returns. */
  typeName: string
  source: string
  /**
   * Seconds before the page is regenerated, emitted as a route segment config.
   *
   * NOT passed to `fetch` as `next: { revalidate }`. That option is a Next augmentation of
   * `RequestInit`, so it only typechecks once Next has generated `next-env.d.ts` — which has
   * not happened on a fresh checkout, and `tsc --noEmit` fails there with an error about
   * `fetch` rather than about caching. `export const revalidate` is plain TypeScript and
   * needs no augmentation, and it is the documented way to control a route's caching.
   */
  segmentRevalidateSeconds: number
  /** The statement to place in the route's preamble. */
  segmentConfig: string
}>

/**
 * Generate the loader for a collection.
 *
 * One function per collection per module, fetching the whole page of rows in a single call.
 * Deliberately not a function per row: a loader called inside the map is the N+1 query that
 * makes a list of twenty items twenty round trips, and it looks fine with three rows in
 * development.
 */
export function loaderSource(
  collection: Collection,
  query: Readonly<{
    orderBy?: string
    direction?: 'asc' | 'desc'
    limit?: number
    filters?: readonly Readonly<{ field: string, operator: string, value?: unknown }>[]
  }> = {},
): LoaderPlan {
  const typeName = `${pascalCase(collection.id)}Row`
  const functionName = `load${pascalCase(collection.id)}`

  const fields = collection.fields
    .map((field) => `  ${field.name}${field.required ? '' : '?'}: ${tsTypeOf(field)}`)
    .join('\n')

  const options: string[] = [`    collection: ${JSON.stringify(collection.id)},`]
  if (query.orderBy !== undefined) {
    options.push(`    orderBy: ${JSON.stringify(query.orderBy)},`)
    // Direction is emitted whenever ordering is, because leaving it implicit means the
    // database's default decides, and that differs between engines.
    options.push(`    direction: ${JSON.stringify(query.direction ?? 'asc')},`)
  }
  if (query.limit !== undefined) options.push(`    limit: ${query.limit},`)
  for (const filter of query.filters ?? []) {
    options.push(
      `    // filter: ${filter.field} ${filter.operator} ${JSON.stringify(filter.value ?? null)}`,
    )
  }

  const source = `export interface ${typeName} {
${fields}
}

/**
 * Fetch ${collection.title}.
 *
 * Runs on the server, so the rows are in the first response rather than arriving after it.
 * A list fetched on the client is a list search engines never see and visitors watch appear.
 */
export async function ${functionName}(): Promise<${typeName}[]> {
  const response = await fetch(collectionEndpoint(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
${options.join('\n')}
    }),
    // Only standard RequestInit options here. Caching is declared by the route's
    // revalidate constant, which needs no Next type augmentation in order to compile.
    cache: 'force-cache',
  })

  if (!response.ok) {
    // Thrown rather than returning an empty array, because an empty list and a failed
    // request look identical on screen and need opposite responses.
    throw new Error(\`Could not load ${collection.title} (\${response.status}).\`)
  }

  return (await response.json()) as ${typeName}[]
}
`

  const segmentRevalidateSeconds = 60
  return Object.freeze({
    functionName,
    typeName,
    source,
    segmentRevalidateSeconds,
    segmentConfig: `export const revalidate = ${segmentRevalidateSeconds}`,
  })
}

/** The TypeScript type a field binds as. */
export function tsTypeOf(field: CollectionField): string {
  switch (field.type) {
    case 'number': return 'number'
    case 'boolean': return 'boolean'
    // A date arrives as a string over JSON. Typing it as Date would be a lie that only
    // surfaces when somebody calls a Date method on it.
    case 'date': return 'string'
    default: return 'string'
  }
}

/**
 * Source for rendering a bound list, including its empty state.
 *
 * The empty state is not optional. A collection with no rows renders nothing at all, so the
 * page shows a blank region where a list belongs — which reads as a broken page rather than
 * as an empty one, and is the state a new site is in on its first day.
 */
export function listSource(
  plan: LoaderPlan,
  collection: Collection,
  options: Readonly<{ emptyMessage?: string, itemBody?: string }> = {},
): string {
  const empty = options.emptyMessage ?? `No ${collection.title.toLowerCase()} yet.`
  const body = options.itemBody ?? `<li key={row.${collection.identity}}>{row.${
    collection.fields.find((field) => field.type === 'text')?.name ?? collection.identity
  }}</li>`

  return `const rows = await ${plan.functionName}()

  if (rows.length === 0) {
    return <p className="text-muted-foreground">${empty}</p>
  }

  return (
    <ul>
      {rows.map((row) => (
        ${body}
      ))}
    </ul>
  )`
}

function pascalCase(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part !== '')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('') || 'Collection'
}

/**
 * The expression a bound field compiles to.
 *
 * Uses `item` scope, which is what the expression model already declares for a repeat body,
 * so a binding is an ordinary member read rather than a new concept.
 */
export function bindingExpression(fieldName: string): Readonly<{
  kind: 'member'
  scope: 'item'
  path: readonly string[]
  format: 'text'
}> {
  return Object.freeze({
    kind: 'member',
    scope: 'item',
    path: Object.freeze([fieldName]),
    format: 'text',
  })
}

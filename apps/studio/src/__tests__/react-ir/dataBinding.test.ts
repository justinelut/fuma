/**
 * Visual data binding.
 *
 * The assertions centre on refusals, because a binding mistake does not error — it renders
 * nothing. `{item.titel}` is `undefined`, React renders undefined as empty, and a designer
 * sees a blank heading and concludes the data is missing. Every check here exists to move
 * that discovery to the moment the binding is made.
 */

import { describe, it, expect } from 'bun:test'
import {
  bindableFields,
  bindingExpression,
  listSource,
  loaderSource,
  tsTypeOf,
  validateBinding,
  validateRepeatBinding,
  type Collection,
} from '@core/react-ir/dataBinding'
import { enumerateLiteralOutcomes } from '@core/react-ir/expression'

const posts: Collection = {
  id: 'blog_posts',
  title: 'Blog posts',
  identity: 'id',
  fields: [
    { name: 'id', type: 'text', required: true },
    { name: 'title', type: 'text', required: true },
    { name: 'excerpt', type: 'text', required: false },
    { name: 'publishedAt', type: 'date', required: true },
    { name: 'featured', type: 'boolean', required: true },
    { name: 'cover', type: 'media', required: false },
    { name: 'canonical', type: 'url', required: false },
  ],
}

describe('the picker offers only fields that fit the target', () => {
  it('offers text-like fields for text', () => {
    const names = bindableFields(posts, 'text').map((field) => field.name)
    expect(names).toContain('title')
    expect(names).toContain('publishedAt')
  })

  it('does not offer a boolean for text', () => {
    // A boolean in a heading renders the word "true" — legal, never intended, and it reaches
    // production because it looks like a data problem rather than a binding mistake.
    expect(bindableFields(posts, 'text').map((field) => field.name)).not.toContain('featured')
  })

  it('offers media for an image source', () => {
    expect(bindableFields(posts, 'src').map((field) => field.name)).toEqual(['cover', 'canonical'])
  })

  it('offers only a boolean for visibility', () => {
    expect(bindableFields(posts, 'visible').map((field) => field.name)).toEqual(['featured'])
  })
})

describe('a binding to a field that does not exist is refused', () => {
  it('refuses an unknown field and lists what is available', () => {
    const refusal = validateBinding(posts, 'titel', 'text')
    expect(refusal?.code).toBe('unknown-field')
    expect(refusal?.message).toContain('render nothing')
    expect(refusal?.message).toContain('title')
  })

  it('accepts a declared field of the right type', () => {
    expect(validateBinding(posts, 'title', 'text')).toBeNull()
  })

  it('refuses a field of the wrong type and names what the target accepts', () => {
    const refusal = validateBinding(posts, 'featured', 'text')
    expect(refusal?.code).toBe('wrong-field-type')
    expect(refusal?.message).toContain('boolean')
  })

  it('accepts a media field for an image', () => {
    expect(validateBinding(posts, 'cover', 'src')).toBeNull()
  })
})

describe('the repeat binding as a whole', () => {
  it('accepts a sound binding', () => {
    expect(validateRepeatBinding([posts], { collectionId: 'blog_posts' }, 'server')).toEqual([])
  })

  it('refuses an unknown collection and names the ones that exist', () => {
    const refusals = validateRepeatBinding([posts], { collectionId: 'nope' }, 'server')
    expect(refusals[0]?.code).toBe('unknown-collection')
    expect(refusals[0]?.message).toContain('blog_posts')
  })

  it('says so plainly when there are no collections yet', () => {
    const refusals = validateRepeatBinding([], { collectionId: 'x' }, 'server')
    expect(refusals[0]?.message).toContain('none yet')
  })

  it('refuses an identity the collection does not declare', () => {
    // React falls back to the array index without a real key, then reuses the wrong element
    // when rows reorder — one row's text ends up in another row's card, in production only.
    const broken: Collection = { ...posts, identity: 'slug' }
    const refusals = validateRepeatBinding([broken], { collectionId: 'blog_posts' }, 'server')
    expect(refusals.some((refusal) => refusal.code === 'identity-not-declared')).toBe(true)
  })

  it('refuses a loader in a client module and says what to do instead', () => {
    // A client component cannot await; the advice has to name the fix.
    const refusals = validateRepeatBinding([posts], { collectionId: 'blog_posts' }, 'client')
    const refusal = refusals.find((candidate) => candidate.code === 'client-module-cannot-load')
    expect(refusal?.message).toContain('pass them in as a prop')
  })

  it('refuses ordering by a column the collection does not have', () => {
    // Otherwise the query fails at the database and the designer sees Postgres's error.
    const refusals = validateRepeatBinding(
      [posts],
      { collectionId: 'blog_posts', orderBy: 'published' },
      'server',
    )
    expect(refusals.some((refusal) => refusal.code === 'order-field-unknown')).toBe(true)
  })

  it('accepts ordering by a real column', () => {
    expect(validateRepeatBinding(
      [posts],
      { collectionId: 'blog_posts', orderBy: 'publishedAt' },
      'server',
    )).toEqual([])
  })

  it('refuses filtering on a column the collection does not have', () => {
    const refusals = validateRepeatBinding(
      [posts],
      { collectionId: 'blog_posts', filters: [{ field: 'author' }] },
      'server',
    )
    expect(refusals.some((refusal) => refusal.code === 'filter-field-unknown')).toBe(true)
  })

  it('reports every problem rather than stopping at the first', () => {
    const refusals = validateRepeatBinding(
      [posts],
      { collectionId: 'blog_posts', orderBy: 'nope', filters: [{ field: 'alsoNope' }] },
      'client',
    )
    expect(refusals.length).toBeGreaterThanOrEqual(3)
  })
})

describe('the generated loader', () => {
  const plan = loaderSource(posts, { orderBy: 'publishedAt', direction: 'desc', limit: 10 })

  it('declares a row type from the collection fields', () => {
    expect(plan.source).toContain('export interface BlogPostsRow')
    expect(plan.source).toContain('title: string')
  })

  it('marks an optional field optional, so a fallback is required', () => {
    // Rendering undefined produces an empty element rather than an error, and the gap reads
    // as a layout bug.
    expect(plan.source).toContain('excerpt?: string')
  })

  it('types a date as string, which is what JSON carries', () => {
    // Typing it as Date would be a lie that only surfaces when somebody calls a Date method.
    expect(tsTypeOf({ name: 'publishedAt', type: 'date', required: true })).toBe('string')
  })

  it('is async and returns the rows', () => {
    expect(plan.source).toContain('export async function loadBlogPosts(): Promise<BlogPostsRow[]>')
  })

  it('fetches once rather than per row', () => {
    // A loader called inside the map is the N+1 that turns twenty items into twenty round
    // trips, and it looks fine with three rows in development.
    expect((plan.source.match(/await fetch\(/g) ?? [])).toHaveLength(1)
  })

  it('emits the ordering direction explicitly whenever it orders', () => {
    // Leaving it implicit lets the database default decide, and that differs between engines.
    expect(plan.source).toContain('direction: "desc"')
  })

  it('throws on a failed request rather than returning an empty list', () => {
    // An empty list and a failed request look identical on screen and need opposite responses.
    expect(plan.source).toContain('throw new Error')
    expect(plan.source).not.toMatch(/return \[\]/)
  })

  it('uses only standard fetch options', () => {
    // `next: { revalidate }` is a Next augmentation of RequestInit, so it fails tsc on a
    // fresh checkout before next-env.d.ts exists — with an error about fetch, not caching.
    expect(plan.source).not.toContain('next: {')
    expect(plan.source).toContain("cache: 'force-cache'")
  })

  it('declares caching as a route segment config instead', () => {
    expect(plan.segmentConfig).toBe('export const revalidate = 60')
    expect(plan.segmentRevalidateSeconds).toBe(60)
  })

  it('names the function and type after the collection', () => {
    expect(plan.functionName).toBe('loadBlogPosts')
    expect(plan.typeName).toBe('BlogPostsRow')
  })

  it('omits ordering entirely when none was asked for', () => {
    expect(loaderSource(posts).source).not.toContain('orderBy')
  })
})

describe('the rendered list', () => {
  const plan = loaderSource(posts)

  it('handles an empty collection explicitly', () => {
    // A collection with no rows renders nothing, so the page shows a blank region where a
    // list belongs — which reads as broken rather than empty, and is the state a new site is
    // in on its first day.
    const source = listSource(plan, posts)
    expect(source).toContain('rows.length === 0')
    expect(source).toContain('No blog posts yet.')
  })

  it('accepts an empty message supplied by the caller', () => {
    expect(listSource(plan, posts, { emptyMessage: 'Nothing published.' }))
      .toContain('Nothing published.')
  })

  it('keys each row by the declared identity', () => {
    expect(listSource(plan, posts)).toContain('key={row.id}')
  })

  it('awaits the loader once, outside the map', () => {
    const source = listSource(plan, posts)
    expect(source.indexOf('await')).toBeLessThan(source.indexOf('.map('))
  })
})

describe('a binding compiles to an ordinary member read', () => {
  it('uses the item scope the expression model already declares', () => {
    expect(bindingExpression('title')).toEqual({
      kind: 'member', scope: 'item', path: ['title'], format: 'text',
    })
  })

  it('is an open set to the Tailwind safety gate, as a data value should be', () => {
    // enumerateLiteralOutcomes returns null for anything whose value is not knowable in
    // advance — which is correct here and is why a class can never be data-bound.
    expect(enumerateLiteralOutcomes(bindingExpression('title') as never)).toBeNull()
  })
})
